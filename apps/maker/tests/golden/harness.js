/* Runs the engine in a small fake DOM with seeded randomness and a manual clock, and records what
   a browser would paint: after every animation frame, each element's state, each buddy's numbers,
   and how many random numbers have been drawn. The same harness drives the original engine and
   the refactor, so a trace is only ever compared with a trace made the same way. */
'use strict';
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

/* The original engine, kept in original/ (see its README). */
const ORIGINAL = '6e32c15';
const CHUNK = 200;

function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

class ClassList {
  constructor() { this.s = new Set(); }
  add(c) { this.s.add(c); }
  remove(c) { this.s.delete(c); }
  contains(c) { return this.s.has(c); }
  toggle(c, on) { if (on === undefined) on = !this.s.has(c); if (on) this.s.add(c); else this.s.delete(c); return on; }
}

class FakeEl {
  constructor(tag) {
    this.tag = tag; this.children = []; this.parent = null; this.listeners = {}; this.classList = new ClassList();
    this.hidden = false; this.text = ''; this.html = ''; this.src = ''; this.alt = undefined; this.draggable = undefined; this.reflowed = false;
    this.style = new Proxy({}, { set(t, k, v) { t[k] = String(v); return true; } });
  }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.s].join(' '); }
  set textContent(v) { this.text = String(v); }
  get textContent() { return this.text; }
  set innerHTML(v) { this.html = String(v); }
  get innerHTML() { return this.html; }
  get offsetWidth() { this.reflowed = true; return 0; }
  append(...kids) { for (const k of kids) { if (k.parent) k.remove(); k.parent = this; this.children.push(k); } }
  remove() { if (!this.parent) return; const c = this.parent.children; c.splice(c.indexOf(this), 1); this.parent = null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}

const P_FIELDS = ['x', 'y', 'vx', 'vy', 'dir', 'state', 't', 'dur', 'surf', 'swing', 'swv', 'hx', 'hy', 'chatT', 'awake', 'cool', 'hover', 'shyDone', 'sp', 'lastSay', 'thrown', 'hard', 'roll', 'next'];

class Driver {
  constructor({ scripts, create, seed = 1, w = 1280, h = 720, steady = false, keep = false, menu = false }) {
    this.w = w; this.h = h; this.seed = seed; this.keep = keep; this.lines = []; this.hashes = [];
    this.steady = steady; this.frames = 0; this.rand = 0; this.now = 1000; this.menuCalls = [];
    this.rng = mulberry32(seed * 2654435761 + 7);
    this.pace = mulberry32(seed * 40503 + 11);
    this.timers = []; this.timerSeq = 1; this.rafs = [];
    this.winListeners = {};
    this.ids = new Map(); this.nextId = 0; this.seen = new Map(); this.order = '';
    this.hash = crypto.createHash('sha1');

    const engineRandom = mulberry32(seed);
    const box = {
      console,
      __rand: () => { this.rand++; return engineRandom(); },
      performance: { now: () => this.now },
      requestAnimationFrame: f => { this.rafs.push(f); return this.rafs.length; },
      setTimeout: (f, ms) => { const id = this.timerSeq++; this.timers.push({ id, at: this.now + (ms || 0), f }); return id; },
      clearTimeout: id => { this.timers = this.timers.filter(t => t.id !== id); },
      addEventListener: (t, f) => { (this.winListeners[t] = this.winListeners[t] || []).push(f); },
      document: { createElement: t => new FakeEl(t) }
    };
    box.window = box;
    this.root = new FakeEl('div');
    this.root.ownerDocument = box.document;
    const opt = {
      root: this.root,
      bounds: () => ({ w: this.w, h: this.h }),
      onMenu: menu ? (id, x, y) => this.menuCalls.push([id, x, y]) : undefined
    };
    if (create) {
      /* the engine as it stands, handed the same fake browser */
      this.ctx = box;
      this.ctl = create(Object.assign(opt, { env: { random: box.__rand, now: box.performance.now, after: (ms, f) => box.setTimeout(f, ms), cancel: box.clearTimeout, frame: box.requestAnimationFrame, listen: box.addEventListener } }));
    } else {
      /* the original, as the classic script it was */
      this.ctx = vm.createContext(box);
      vm.runInContext('Math.random = __rand;', this.ctx);
      for (const s of scripts) vm.runInContext(s.code, this.ctx, { filename: s.name });
      this.ctl = box.DesktopBuddies.createWorld(opt);
    }
  }

  /* one display frame: timers that fall due, then the animation callback, then a snapshot */
  frame() {
    const r = this.pace();
    const ms = this.steady || r < .85 ? 16.667 : r < .95 ? 33.3 : r < .99 ? 50 : 140;
    const target = this.now + ms;
    for (;;) {
      const due = this.timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter(t => t !== due);
      this.now = Math.max(this.now, due.at);
      due.f();
    }
    this.now = target;
    const q = this.rafs; this.rafs = [];
    for (const f of q) f(this.now);
    this.record();
  }
  run(n) { for (let i = 0; i < n; i++) this.frame(); }
  runUntil(test, max = 4000) { for (let i = 0; i < max; i++) { if (test()) return true; this.frame(); } return false; }

  record() {
    this.frames++;
    const changed = [];
    const alive = new Set();
    const walk = el => {
      if (!this.ids.has(el)) this.ids.set(el, this.nextId++);
      const id = this.ids.get(el); alive.add(id);
      const st = Object.keys(el.style).filter(k => el.style[k] !== '').sort().map(k => k + ':' + el.style[k]).join(';');
      const s = JSON.stringify([el.tag, [...el.classList.s].sort().join(' '), el.hidden, el.text, el.html, el.src, el.alt, el.draggable, st]);
      if (this.seen.get(id) !== s) { this.seen.set(id, s); changed.push([id, s]); }
      if (el.reflowed) { el.reflowed = false; changed.push([id, 'restart']); }
      el.children.forEach(walk);
    };
    this.root.children.forEach(walk);
    const gone = [...this.seen.keys()].filter(id => !alive.has(id));
    gone.forEach(id => this.seen.delete(id));
    const order = this.root.children.map(e => this.ids.get(e)).join(',');
    const orderChanged = order !== this.order; this.order = order;
    const pets = [...this.ctl.pets.values()].map(p => [p.id, ...P_FIELDS.map(f => p.P[f])]);
    const menu = this.menuCalls.splice(0);
    const line = JSON.stringify([this.frames, this.rand, pets, changed, gone, orderChanged ? order : 0, menu]);
    this.hash.update(line + '\n');
    if (this.keep) this.lines.push(line);
    if (this.frames % CHUNK === 0) { this.hashes.push(this.hash.digest('hex').slice(0, 16)); this.hash = crypto.createHash('sha1'); }
  }
  finish() { if (this.frames % CHUNK) this.hashes.push(this.hash.digest('hex').slice(0, 16)); return { frames: this.frames, rand: this.rand, hashes: this.hashes }; }

  /* input */
  el(i) { return this.root.children.filter(e => e.classList.contains('db-pet'))[i]; }
  pet(i) { return [...this.ctl.pets.values()][i]; }
  P(i) { return this.pet(i).P; }
  fire(el, type, x, y, extra) {
    const e = Object.assign({ type, button: 0, clientX: x, clientY: y, pointerId: 1, preventDefault() {} }, extra);
    for (const f of (el.listeners[type] || []).slice()) f(e);
    if (type === 'pointermove') this.mouse(x, y, e);
  }
  mouse(x, y, e) { for (const f of (this.winListeners.pointermove || []).slice()) f(e || { clientX: x, clientY: y }); }
  resize(w, h) { this.w = w; this.h = h; for (const f of (this.winListeners.resize || []).slice()) f({}); }
}

function originalScripts() {
  const code = fs.readFileSync(path.join(__dirname, 'original', 'engine.js'), 'utf8').replace(/\r\n/g, '\n');
  return [{ name: 'engine.js', code }];
}
module.exports = { Driver, originalScripts, mulberry32, ORIGINAL, CHUNK };
