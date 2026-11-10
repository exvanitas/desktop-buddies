/* Scripted runs for the golden traces. Each scenario gets a Driver and plays input at it. Choices
   made here use d.rng, never the engine's random, so a scenario never disturbs what it records. */
'use strict';

const img = tag => 'data:image/png;base64,' + Buffer.from(tag).toString('base64');
const BB = { x0: .2, y0: .05, x1: .8, y1: 1 };
const OFF_BB = { x0: .1, y0: .22, x1: .66, y1: .93 };
const POSE_KEYS = ['stand', 'walk', 'run', 'sit', 'sleep', 'think', 'jump', 'fall', 'land', 'sprawl', 'drag', 'dragL', 'dragR', 'climb', 'wall', 'crawl', 'hang', 'happy', 'wave', 'shy', 'cry', 'angry', 'dizzy', 'eat', 'dance', 'sing'];

/* no pose frames: everything is procedural, and walls and ceilings rotate the main image */
const plain = (id = 'a', name = 'Ann', size = 120) => ({ id, name, size, faces: 'right', poses: {}, base: { src: img('base-' + id), bb: BB } });
/* every pose has frames, at varied rates and scales, with its own lines */
function full(id = 'b', name = 'Bo', size = 96) {
  const poses = {};
  POSE_KEYS.forEach((k, i) => {
    const n = k === 'dragL' || k === 'dragR' ? 2 : 1 + i % 4;
    poses[k] = { fps: 3 + i % 9, scale: 1 + (i % 5 - 2) * .07, frames: Array.from({ length: n }, (_, j) => ({ src: img(`${id}-${k}-${j}`), bb: { x0: .15 + j * .02, y0: .1, x1: .85 - i % 3 * .03, y1: .98 - j * .02 } })) };
  });
  return { id, name, size, faces: 'left', poses, base: { src: img('base-' + id), bb: OFF_BB }, lines: { hello: ['Yo', 'Sup'], chat: ['Own line'], love: [], bye: ['Later'] } };
}
/* some poses only, so fallbacks run, including the wall and ceiling chains */
function mixed(id = 'c', name = '', size = 150) {
  const f = (k, n) => ({ fps: 6, frames: Array.from({ length: n }, (_, j) => ({ src: img(`${id}-${k}-${j}`), bb: BB })) });
  return { id, name, size, faces: 'right', poses: { walk: f('walk', 3), wall: f('wall', 1), hang: f('hang', 2), dragL: f('dragL', 1), fall: f('fall', 2), sit: f('sit', 1) }, base: { src: img('base-' + id), bb: { x0: .3, y0: 0, x1: .7, y1: 1 } } };
}
const ART = { plain, full, mixed };

const state = (pets, o) => Object.assign({ pets, bubbles: true, names: true, chatter: 'normal' }, o);
const settle = d => d.runUntil(() => [...d.ctl.pets.values()].every(p => p.P.surf === 'floor' && p.P.state !== 'land'), 800);
const spot = (d, i) => { const P = d.P(i); return { x: P.x, y: P.y - 40 }; };

function click(d, i) { const s = spot(d, i), e = d.el(i); d.fire(e, 'pointerdown', s.x, s.y); d.fire(e, 'pointerup', s.x, s.y); }
/* press, move along a straight line for n frames, let go */
function throwFrom(d, i, from, v, n = 6, release = true) {
  const e = d.el(i), a = spot(d, i);
  d.fire(e, 'pointerdown', a.x, a.y); d.frame();
  let x = from.x, y = from.y;
  d.fire(e, 'pointermove', x, y); d.frame();
  for (let k = 0; k < n; k++) { x += v.x; y += v.y; d.fire(e, 'pointermove', x, y); d.frame(); }
  if (release) d.fire(e, 'pointerup', x, y);
}
function rub(d, i, times = 6, reach = 30) {
  const e = d.el(i), s = spot(d, i);
  d.fire(e, 'pointerenter', s.x, s.y);
  for (let k = 0; k < times; k++) { d.fire(e, 'pointermove', s.x + (k % 2 ? reach : -reach), s.y); d.frame(); d.frame(); }
  d.fire(e, 'pointerleave', s.x, s.y);
}
/* Everyone at once. The original took 'all' as an id for that; the engine now has its own call. */
const everyone = (d, a) => d.ctl.actAll ? d.ctl.actAll(a) : d.ctl.act('all', a);
function toWall(d, i) { d.ctl.act(d.pet(i).id, 'climbGo'); return d.runUntil(() => ['left', 'right'].includes(d.P(i).surf), 3000); }
function toCeil(d, i) { d.ctl.act(d.pet(i).id, 'ceilGo'); return d.runUntil(() => d.P(i).surf === 'ceil', 900); }

const ACTS = ['love', 'wave', 'cry', 'angry', 'shy', 'sleep', 'sit', 'think', 'dance', 'sing', 'eat', 'jump', 'run', 'trip', 'roll', 'spin', 'dizzy', 'chase', 'climbGo', 'ceilGo', 'drop', 'held', 'walk', 'idle',
  'stand', 'happy', 'fall', 'land', 'sprawl', 'climb', 'wall', 'crawl', 'hang', 'drag', 'jump', 'nonsense'];

const S = [];
const add = (name, opt, fn) => S.push({ name, opt, fn });
const seeds = (n, from = 1) => Array.from({ length: n }, (_, i) => from + i);

/* long idle runs */
for (const seed of seeds(12)) add(`idle-plain-${seed}`, { seed }, d => { d.ctl.sync(state([plain()])); d.run(9000); });
for (const seed of seeds(12, 20)) add(`idle-full-${seed}`, { seed }, d => { d.ctl.sync(state([full()])); d.run(9000); });
for (const seed of seeds(6, 40)) add(`idle-mixed-${seed}`, { seed }, d => { d.ctl.sync(state([mixed()])); d.run(9000); });
for (const seed of seeds(4, 50)) add(`idle-small-${seed}`, { seed, w: 420, h: 360 }, d => { d.ctl.sync(state([full()])); d.run(9000); });
for (const c of ['off', 'low', 'high']) add(`idle-chatter-${c}`, { seed: 60 }, d => { d.ctl.sync(state([plain()], { chatter: c })); d.run(6000); });
add('idle-quiet', { seed: 61 }, d => { d.ctl.sync(state([plain()], { bubbles: false, names: false })); d.run(5000); });

for (const art of Object.keys(ART)) {
  const mk = ART[art];
  /* click */
  add(`click-${art}`, { seed: 100 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (let i = 0; i < 12; i++) { click(d, 0); d.run(30 + (d.rng() * 120 | 0)); settle(d); }
    for (let i = 0; i < 6; i++) { click(d, 0); d.run(5); } /* too many: angry */
    click(d, 0); d.run(40); click(d, 0); d.run(300);
    settle(d); d.ctl.act(d.pet(0).id, 'sleep'); d.run(40); click(d, 0); d.run(100);
    if (toWall(d, 0)) { click(d, 0); d.run(120); }
    settle(d); if (toCeil(d, 0)) { click(d, 0); d.run(120); }
    click(d, 0); d.run(60); /* in the air or wherever it got to */
  });
  /* pet */
  add(`pet-${art}`, { seed: 110 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    rub(d, 0); d.run(120); settle(d);
    for (const a of ['cry', 'angry', 'dizzy', 'sleep']) { d.ctl.act(d.pet(0).id, a); d.run(20); rub(d, 0, 8); d.run(100); settle(d); d.run(100); }
    rub(d, 0, 3, 5); d.run(60); /* not enough to count */
    if (toWall(d, 0)) { rub(d, 0, 8); d.run(100); }
    settle(d);
    rub(d, 0, 12); rub(d, 0, 12); d.run(200); /* cooling down */
  });
  /* hover */
  add(`shy-${art}`, { seed: 120, steady: true }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (let i = 0; i < 4; i++) {
      const s = spot(d, 0), e = d.el(0);
      d.fire(e, 'pointerenter', s.x, s.y); d.run(350);
      d.fire(e, 'pointerleave', s.x, s.y); d.mouse(5, 5); d.run(60);
    }
  });
  /* drag and throw, varied speeds, all over the screen */
  for (const seed of seeds(6, 130)) add(`throw-${art}-${seed}`, { seed }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (let i = 0; i < 36; i++) {
      const sp = [0, 1, 3, 5, 9, 15, 22, 32, 45, 70][d.rng() * 10 | 0], a = d.rng() * Math.PI * 2;
      const from = { x: d.rng() * d.w, y: d.rng() * d.h };
      throwFrom(d, 0, from, { x: Math.cos(a) * sp, y: Math.sin(a) * sp }, 3 + (d.rng() * 8 | 0));
      d.run(20 + (d.rng() * 200 | 0));
    }
  });
  /* hold still, then let go; swing; a very long hold; a stale release */
  add(`hold-${art}`, { seed: 140 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    throwFrom(d, 0, { x: 400, y: 200 }, { x: 0, y: 0 }, 10); d.run(90); settle(d);
    throwFrom(d, 0, { x: 300, y: 300 }, { x: 25, y: 0 }, 14, false);
    d.fire(d.el(0), 'pointermove', 660, 300); d.run(20);
    for (let k = 0; k < 40; k++) { d.fire(d.el(0), 'pointermove', 660 - k * 20, 300 + k); d.frame(); }
    d.fire(d.el(0), 'pointerup', 0, 0); d.run(80); settle(d);
    throwFrom(d, 0, { x: 500, y: 200 }, { x: 8, y: 2 }, 4, false); d.run(700); d.fire(d.el(0), 'pointerup', 0, 0); d.run(120); settle(d);
    throwFrom(d, 0, { x: 500, y: 300 }, { x: -6, y: 1 }, 5, false); d.fire(d.el(0), 'pointercancel', 0, 0); d.run(120); settle(d);
    /* press and let go without leaving the dead zone */
    const s = spot(d, 0); d.fire(d.el(0), 'pointerdown', s.x, s.y); d.fire(d.el(0), 'pointermove', s.x + 3, s.y); d.fire(d.el(0), 'pointerup', s.x + 3, s.y); d.run(80);
    d.fire(d.el(0), 'pointerdown', 10, 10, { button: 2 }); d.fire(d.el(0), 'pointerup', 10, 10, { button: 2 }); d.run(10);
  });
  /* released past the edges of the page, moving either way */
  add(`outside-${art}`, { seed: 150 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    const spots = [[-80, 300, 10, 0], [-80, 300, -10, 0], [1400, 300, 10, 0], [1400, 300, -12, 0], [600, 900, 0, -12], [600, 900, 0, 9], [600, -90, 0, -12], [600, -90, 0, 14], [-50, -60, -9, -9], [1350, 800, 7, 7], [20, 300, 8, 0], [1260, 200, -8, 1], [640, 700, 5, -30], [15, 690, 12, -6]];
    for (const [x, y, vx, vy] of spots) { throwFrom(d, 0, { x, y }, { x: vx, y: vy }, 4); d.run(150); settle(d); }
  });
  /* hard throws into each edge */
  add(`hard-${art}`, { seed: 160 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    const dirs = [[40, 0], [-40, 0], [0, 40], [0, -40], [30, -30], [-30, 30], [45, 45], [-45, -45], [60, 5], [-27, 3], [28, 0], [0, 27]];
    for (const [vx, vy] of dirs) { throwFrom(d, 0, { x: 640, y: 360 }, { x: vx, y: vy }, 3); d.run(330); settle(d); }
  });
  /* throws made to grab walls and ceilings */
  add(`grab-${art}`, { seed: 170 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    const cases = [[900, 200, 12, -2], [300, 200, -12, -2], [1100, 100, 8, 1], [200, 600, -9, 3], [640, 200, 2, -14], [640, 120, -3, -9], [640, 80, 0, -6], [640, 300, 0, -4], [1200, 650, 6, 2], [80, 690, -6, 1]];
    for (const [x, y, vx, vy] of cases) { throwFrom(d, 0, { x, y }, { x: vx, y: vy }, 5); d.run(400); click(d, 0); d.run(60); settle(d); }
  });
  /* chase */
  for (const seed of seeds(3, 180)) add(`chase-${art}-${seed}`, { seed }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (let i = 0; i < 12; i++) {
      d.ctl.act(d.pet(0).id, 'chase');
      const mode = i % 3;
      for (let k = 0; k < 120; k++) {
        const P = d.P(0);
        if (mode === 0) d.mouse(P.x + 200 * Math.sin(k / 9), d.h - 20); /* near the floor: caught */
        else if (mode === 1) d.mouse(P.x + 10, 100 + (k % 50)); /* above: jumps */
        else d.mouse(d.rng() * d.w, d.rng() * d.h);
        d.frame();
      }
      d.run(30);
    }
    d.ctl.act(d.pet(0).id, 'chase'); d.mouse(5, 5); d.run(1000); /* gives up */
  });
  /* each action from each place */
  add(`acts-floor-${art}`, { seed: 190 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (const a of ACTS) { d.ctl.act(d.pet(0).id, a); d.run(90 + (d.rng() * 300 | 0)); settle(d); }
  });
  add(`acts-wall-${art}`, { seed: 191 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (const a of ACTS) { if (toWall(d, 0)) { d.run(d.rng() * 60 | 0); d.ctl.act(d.pet(0).id, a); } d.run(200); settle(d); }
  });
  add(`acts-ceil-${art}`, { seed: 192 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (const a of ACTS) { if (toCeil(d, 0)) { d.run(d.rng() * 60 | 0); d.ctl.act(d.pet(0).id, a); } d.run(200); settle(d); }
  });
  add(`acts-air-${art}`, { seed: 193 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (const a of ACTS) { d.ctl.act(d.pet(0).id, 'jump'); d.run(6); d.ctl.act(d.pet(0).id, a); d.run(200); settle(d); }
  });
  add(`acts-held-${art}`, { seed: 194 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (const a of ACTS.slice(0, 12)) { throwFrom(d, 0, { x: 500, y: 300 }, { x: 4, y: 0 }, 3, false); d.ctl.act(d.pet(0).id, a); d.run(5); d.fire(d.el(0), 'pointerup', 0, 0); d.run(100); settle(d); }
  });
  /* the walls and ceiling, long runs */
  for (const seed of seeds(3, 200)) add(`climb-${art}-${seed}`, { seed, w: 700, h: 500 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    for (let i = 0; i < 18; i++) { toWall(d, 0); d.run(1000); settle(d); toCeil(d, 0); d.run(400); settle(d); }
  });
  /* resize in every place a buddy can be */
  add(`resize-${art}`, { seed: 210 }, d => {
    d.ctl.sync(state([mk()])); settle(d);
    const sizes = [[900, 500], [1400, 800], [640, 400], [1280, 720]];
    let n = 0;
    const next = () => { const [w, h] = sizes[n++ % 4]; d.resize(w, h); };
    for (let i = 0; i < 8; i++) {
      d.run(40); next(); d.run(60); settle(d);
      if (toWall(d, 0)) { d.run(20); next(); d.run(60); } settle(d);
      if (toCeil(d, 0)) { d.run(20); next(); d.run(60); } settle(d);
      d.ctl.act(d.pet(0).id, 'jump'); d.run(4); next(); d.run(90); settle(d);
      throwFrom(d, 0, { x: 300, y: 200 }, { x: 10, y: 0 }, 3, false); next(); d.run(3); d.fire(d.el(0), 'pointerup', 0, 0); d.run(120); settle(d);
      d.ctl.act(d.pet(0).id, 'cry'); d.run(30); next(); d.run(60); settle(d);
      d.ctl.act(d.pet(0).id, 'eat'); d.run(30); next(); d.run(60); settle(d);
    }
  });
  /* dismiss, as the exported page does it */
  add(`dismiss-${art}`, { seed: 220, menu: true }, d => {
    let pets = [mk('a', 'One'), full('b', 'Two'), plain('c', 'Three')];
    const sync = () => d.ctl.sync(state(pets));
    sync(); settle(d);
    const leave = id => {
      const pet = d.ctl.pets.get(id);
      if (pet.P.surf === 'floor') pet.go('wave');
      pet.say(pet.line('bye'));
      d.ctx.setTimeout(() => { d.ctl.poof(id); pets = pets.filter(p => p.id !== id); sync(); }, 900);
    };
    d.run(100); d.fire(d.el(0), 'contextmenu', 50, 60); leave('a'); d.run(120);
    toWall(d, 0); leave('b'); d.run(90); d.run(60);
    d.ctl.act('c', 'jump'); d.run(5); leave('c'); d.run(120);
    pets = [mk('a', 'One')]; sync(); d.run(200);
  });
}

/* meetings */
for (const seed of seeds(6, 300)) add(`pair-two-${seed}`, { seed, w: 460, h: 320 }, d => { d.ctl.sync(state([plain('a', 'Ann', 80), full('b', 'Bo', 80)])); d.run(8000); });
for (const seed of seeds(6, 310)) add(`pair-three-${seed}`, { seed, w: 520, h: 320 }, d => { d.ctl.sync(state([plain('a', 'Ann', 80), mixed('b', 'Bo', 90), full('c', 'Cy', 70)])); d.run(8000); });
add('pair-dismissed', { seed: 320, w: 460, h: 320 }, d => {
  let pets = [plain('a', 'Ann', 80), plain('b', 'Bo', 80)];
  d.ctl.sync(state(pets));
  for (let i = 0; i < 40; i++) { d.run(150); pets = pets.slice().reverse(); pets = i % 2 ? [plain('a', 'Ann', 80), plain('b', 'Bo', 80)] : [plain('a', 'Ann', 80)]; d.ctl.sync(state(pets)); }
});

/* settings changing under a live world */
add('sync-changes', { seed: 330 }, d => {
  const a = plain(), b = full();
  d.ctl.sync(state([a, b])); d.run(200);
  d.ctl.sync(state([Object.assign({}, a, { name: 'Renamed', size: 200 }), b])); d.run(100);
  d.ctl.sync(state([Object.assign({}, a, { faces: 'left' }), Object.assign({}, b, { poses: {}, name: '' })])); d.run(100);
  d.ctl.sync(state([a, b], { names: false })); d.run(100);
  d.ctl.sync(state([a, b], { bubbles: false })); everyone(d, 'dance'); d.run(100);
  d.ctl.sync(state([a, b], { chatter: 'high' })); everyone(d, 'love'); d.run(500);
  d.ctl.sync(state([b])); d.run(100);
  d.ctl.sync(state([])); d.run(30);
  d.ctl.sync(state([a])); d.run(100);
});
add('everyone-acts', { seed: 331 }, d => {
  d.ctl.sync(state([plain('a'), full('b'), mixed('c')])); d.run(100);
  for (const a of ['dance', 'love', 'sleep', 'drop', 'drop', 'climbGo', 'ceilGo', 'drop']) { everyone(d, a); d.run(260); }
  d.ctl.act('nobody', 'love'); d.run(10);
});
add('pause-and-step', { seed: 332 }, d => {
  d.ctl.sync(state([plain(), full()])); d.run(120);
  everyone(d, 'love'); d.run(3);
  d.ctl.pause(); d.run(180); /* a bubble's timer still runs while paused */
  d.ctl.step(5); d.run(5); d.ctl.step(20); d.run(5);
  d.ctl.pet = null; d.ctl.pause(false); d.run(200);
  d.ctl.pause(true); d.pet(0).say('Paused'); d.pet(1).go('spin'); d.run(4); d.ctl.poof('a'); d.run(40); d.ctl.pause(false); d.run(100);
});
add('odd-corners', { seed: 334 }, d => {
  d.ctl.sync(state([plain(), Object.assign(mixed('b', 'Bo'), { size: undefined, poses: { walk: { frames: [{ src: img('x'), bb: BB }] } } })])); d.run(20);
  click(d, 0); d.run(5); /* a click in mid-air */
  d.fire(d.el(0), 'contextmenu', 10, 10); d.run(5); /* no menu on this page */
  settle(d);
  d.pet(0).go('wave', { line: 'Own words' }); d.run(120);
  d.pet(0).go('wave', { line: '' }); d.run(120);
  d.pet(0).go('run', { dir: -1 }); d.run(100); settle(d);
  d.ctl.act('a', 'chase'); d.mouse(1e5, d.h - 300); d.run(1200); /* runs at a wall until tired */
});
add('poof-all', { seed: 333 }, d => {
  d.ctl.sync(state([plain('a'), full('b')])); d.run(100);
  d.ctl.poof('a'); d.ctl.poof('b'); d.ctl.poof('none'); d.run(60);
});

module.exports = { scenarios: S, ART, state };
