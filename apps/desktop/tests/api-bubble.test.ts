// @vitest-environment happy-dom
/* A line another app asked for: the host puts it in her bubble with the app's name, the frame
   carries the name only then, and the view shows it as a badge, as text. */
import type { BuddyData, Frame, Input } from '@buddies/engine';
import assert from '@buddies/test-support/dom-assert';
import { createView } from '@buddies/view';
import { test } from 'vitest';
import { createHost, type Area, type Port } from '../src/host';
import { whole } from './areas';

const AREA: Area = whole({ i: 0, x: 0, y: 0, w: 1920, h: 1040, scale: 1 });
const BUDDY: BuddyData = { id: 'b0', name: 'Olive', size: 120, faces: 'right', poses: {}, base: { src: 'data:image/png;base64,AAAA', bb: { x0: .2, y0: 0, x1: .8, y1: 1 } } };

function desk() {
  const clock = { t: 0 }, timers: { at: number; f: () => void }[] = [], every: { ms: number; f: () => void; next: number }[] = [];
  const host = createHost({
    random: () => .5, now: () => clock.t, note: () => {},
    after: (ms, f) => { timers.push({ at: clock.t + ms, f }); return timers.length; }, cancel(id) { const t = timers[id - 1]; if (t) t.f = () => {}; },
    every: (ms, f) => { every.push({ ms, f, next: ms }); }
  });
  const frames: Frame[] = [];
  const port = (keep: boolean): Port => ({ postMessage(m) { const x = m as { k: string; frame: Frame }; if (keep && x.k === 'frame') frames.push(JSON.parse(JSON.stringify(x.frame))); } });
  const hub = port(false), top = port(true);
  host.connect(hub); host.connect(top);
  host.message(hub, { k: 'start', all: [AREA], pets: [BUDDY] });
  host.message(top, { k: 'join', me: AREA, n: 0 });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock.t += 16; for (const t of timers) if (t.at <= clock.t) { t.at = Infinity; t.f(); } for (const e of every) if (clock.t >= e.next) { e.next += e.ms; e.f(); } } };
  return { host, hub, tick, frames, last: () => frames[frames.length - 1]!.pets[0]! };
}

test('the host says an app\'s line with its name, and her own lines carry none', () => {
  const d = desk();
  d.tick(60);
  assert.ok(!('from' in d.last().bubble), 'a frame without an app line has no from at all');
  d.host.message(d.hub, { k: 'say', id: 'b0', text: 'Build passed!', from: 'Claude Code' });
  d.tick(2);
  const b = d.last().bubble;
  assert.strictEqual(b.text, 'Build passed!');
  assert.strictEqual(b.from, 'Claude Code');
  assert.strictEqual(b.hidden, false);
  d.host.sim!.pets.get('b0')!.say('hello');
  d.tick(2);
  assert.ok(!('from' in d.last().bubble), 'her own line next shows no badge');
  d.host.message(d.hub, { k: 'say', id: 'nobody', text: 'x', from: 'A' });
  d.tick(1);
});

test('an app\'s line stays up long enough to read', () => {
  const d = desk();
  d.tick(10);
  d.host.message(d.hub, { k: 'say', id: 'b0', text: 'x'.repeat(120), from: 'A' });
  d.tick(Math.ceil(5000 / 16));
  assert.strictEqual(d.last().bubble.hidden, false);
});

test('the view shows the badge as text, and markup as text', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const input = { down() {}, move() {}, up() {}, enter() {}, leave() {}, pointer() {} } as unknown as Input;
  const view = createView({ root, input, viewport: { x: 0, y: 0, scale: 1, w: 1920, h: 1040 } });
  const pet = (bubble: Frame['pets'][number]['bubble']): Frame => ({ fx: [], pets: [{ id: 'b0', size: '120px', src: null, origin: null, body: null, grab: false, off: false, box: { l: 0, t: 0, size: 120, ox: 0, oy: 0 }, tf: null, bubble, tag: { text: '', hidden: true, tf: null } }] });
  view.apply(pet({ text: '<img src=x onerror=alert(1)>', from: '<b>App</b>', hidden: false, pop: 1, below: false, tf: null, at: null }));
  const bub = root.querySelector('.db-bubble')!;
  assert.ok(bub.classList.contains('app'));
  const badge = bub.querySelector('.db-from')!;
  assert.strictEqual(badge.textContent, 'From <b>App</b>');
  assert.strictEqual(bub.querySelectorAll('*').length, 1, 'the badge is the only element');
  assert.strictEqual(bub.textContent, 'From <b>App</b><img src=x onerror=alert(1)>');
  view.apply(pet({ text: 'hi', hidden: false, pop: 2, below: false, tf: null, at: null }));
  assert.ok(!bub.classList.contains('app'));
  assert.strictEqual(bub.querySelectorAll('*').length, 0);
  assert.strictEqual(bub.textContent, 'hi');
});
