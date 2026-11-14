/* One overlay: draws this monitor's slice of the world, and takes the mouse only over a buddy's
   visible pixels. The hub opens it and says which monitor it has. */
import '@buddies/view/view.css';
import { createView } from '@buddies/view';
import { createCapture } from './capture';
import { explain, huntLine, make, noteWith, pointed, under } from './hit';
import { createHold, viewport, type Area, type Message } from './host';
import { createDrawing } from './pacing';
import type { OverlayBoot } from './hub-core';
import type { MenuToHub } from './manager-api';
import { herOnScreen, pointOnScreen } from './menu-ask';
import { createShell, type Cursor } from './shell';
import { cspSeen, errorSeen, modeSeen, rejectionSeen } from './log-safe';
import { MENU_CHANNEL, postOnce } from './wire';

/* how often the trace says where she's drawn */
const TRACE_MS = 250;

(async () => {
  const shell = createShell(window.__TAURI__), boot = window.__BUDDIES__ as OverlayBoot;
  let me: Area = boot.me;
  const log = (s: string) => { void shell.log(`[${me.i}] ${s}`); };
  noteWith(log);
  addEventListener('error', e => log(`error ${errorSeen(e)}`));
  addEventListener('unhandledrejection', e => log(`rejected ${rejectionSeen(e)}`));
  addEventListener('securitypolicyviolation', e => log(`error csp ${cspSeen(e)}`));
  log(`page up dpr=${devicePixelRatio} css=${innerWidth}x${innerHeight} mode=${modeSeen(boot.mode)}`);
  if (boot.mode === 'empty') return;

  const every = (ms: number, f: () => void) => { const id = setInterval(f, ms); return () => clearInterval(id); };
  const capture = createCapture(on => { void shell.capture(on); }, () => performance.now(), every);

  const world = new SharedWorker('world.js', { name: 'world' }).port;
  const send = (m: Message) => world.postMessage(m);

  /* The drag: this overlay keeps the mouse from the press until the button is seen to come up,
     wherever the cursor goes, even over transparent pixels and other monitors. */
  const hold = createHold(1000, () => performance.now());
  let over: string | null = null, cursor: Cursor = { x: -1e4, y: -1e4, down: false, right: false };
  const input = {
    pointer() {},
    /* Any press on a buddy closes her right-click menu. */
    down(id: string, x: number, y: number) { hold.press(); send({ k: 'down', id, x, y, from: me.i }); tell({ k: 'menu-press' }); },
    move(id: string, x: number, y: number) { send({ k: 'move', id, x, y }); },
    up(id: string) { hold.end(); send({ k: 'up', id }); },
    enter() {}, leave() {}
  };
  const root = document.getElementById('root')!;
  const vp = viewport(me); /* the view keeps this object, so a new place only has to change it */
  const view = createView({ root, input, viewport: vp, pointerCapture: false, hover: false });
  /* The browser's own menu has no place here. Hers does: the overlay only takes the mouse over her,
     so a right-click here is on whoever's under it, and never during a drag. */
  const tell = (m: MenuToHub) => postOnce(m, MENU_CHANNEL);
  addEventListener('contextmenu', e => {
    e.preventDefault();
    if (hold.active) return;
    const shown = view.shown(), id = under(shown, e.clientX, e.clientY), f = shown.find(p => p.id === id);
    if (f) tell({ k: 'menu-ask', copy: f.id, her: herOnScreen(f, me), at: pointOnScreen(me, e.clientX, e.clientY), t: performance.timeOrigin + performance.now() });
  });

  /* With --trace-hits: what the hit test made of each place the cursor went near her, and four times
     a second where each buddy this overlay shows is drawn and a point on her it shows, in screen
     pixels, wherever the cursor is, so a smoke run can aim straight at her. Ids, image paths and numbers only, never a name. */
  let traced = '', drawn = 0;
  function trace(x: number, y: number, inside: boolean) {
    const at = `${Math.round(x)},${Math.round(y)}`, e = inside ? explain(view.shown(), x, y) : null;
    const key = e ? `${at} ${e.answer}` : '';
    if (e && key !== traced) {
      const b = e.box;
      log(`hunt cursor ${at} over ${e.id} drawn ${Math.round(b.l)},${Math.round(b.t)} size ${Math.round(b.size)} image ${e.src} at ${e.u.toFixed(2)},${e.v.toFixed(2)}: ${e.answer}`);
    }
    traced = key;
    if (performance.now() - drawn < TRACE_MS) return;
    drawn = performance.now();
    for (const f of view.shown()) { const line = huntLine(f, me); if (line) log(line); }
  }

  function check() {
    hold.expired();
    if (hold.active) return capture.set(true);
    const { x, y, inside, id } = pointed(view.shown(), cursor, me, { w: innerWidth, h: innerHeight });
    if (boot.trace) trace(x, y, inside);
    capture.set(id !== null);
    if (id !== over) { over = id; send({ k: 'over', id }); }
  }

  /* Frames are drawn on the display's beat, two ticks behind the world: pacing.ts. It asks for
     animation frames only while there's something to draw. While the page's animation frames have
     stopped, each frame is drawn whole as it comes. */
  const drawing = createDrawing(f => { view.apply(f); check(); }, () => performance.now(), f => { requestAnimationFrame(f); });
  world.onmessage = e => {
    const m = e.data;
    if (m.k === 'frame') {
      for (const f of m.frame.pets) if (f.src) make(f.src);
      drawing.arrive(m.frame, m.t);
    }
    else if (m.k === 'area') { me = m.area; Object.assign(vp, viewport(me)); drawing.reset(); }
  };
  world.start();
  send({ k: 'join', me, n: boot.n });
  await shell.on('cursor', c => {
    cursor = c;
    hold.cursor(cursor.down);
    check();
  });
})();
