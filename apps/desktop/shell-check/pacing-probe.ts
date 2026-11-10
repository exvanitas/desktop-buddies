/* The pacing check adds this to its own copy of overlay.html, after overlay.js. It never ships. On
   the first monitor's overlay it sets her falling and running, asks for nothing else, and on every
   animation frame reads where the overlay drew her. Then it says what pacing-measure makes of that,
   in the app's log, as numbers only. pacing.ps1 judges from that. */
import type { OverlayBoot } from '../src/hub-core';
import type { Message } from '../src/host';
import { createShell } from '../src/shell';
import { measure, poseKey, verdict, type Sample } from './pacing-measure';

const WARM_MS = 4000, SAMPLE_MS = 16000, EVERY_MS = 1600;
const ORDERS = ['drop', 'jump', 'drop', 'run'];

const boot = window.__BUDDIES__ as OverlayBoot;
if (boot.me.i === 0 && boot.mode !== 'empty') {
  const shell = createShell(window.__TAURI__);
  const say = (line: string) => { void shell.log('PACING ' + line); };
  const world = new SharedWorker('world.js', { name: 'world' }).port;
  world.start();
  const send = (m: Message) => world.postMessage(m);
  const samples: Sample[] = [], told: number[] = [];
  let sampling = false, n = 0;
  const read = (t: number) => {
    const el = document.querySelector<HTMLElement>('.db-pet'), body = el && el.firstElementChild as HTMLElement | null;
    const at = el && /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(el.style.transform);
    if (sampling && body && at && !el.hidden) {
      const o = body.style.transformOrigin.split(' ').map(parseFloat);
      samples.push([t, +at[1]! + (o[0] || 0), +at[2]! + (o[1] || 0), el.classList.contains('grab') ? 1 : 0, poseKey(el.style.width, body.style.transformOrigin, body.style.transform)]);
    }
    requestAnimationFrame(read);
  };
  /* registered after the overlay's own, so each one reads what that frame drew */
  setTimeout(() => {
    requestAnimationFrame(read);
    const order = setInterval(() => { told.push(performance.now()); send({ k: 'act-all', a: ORDERS[n++ % ORDERS.length]! }); }, EVERY_MS);
    sampling = true;
    setTimeout(() => {
      sampling = false; clearInterval(order);
      const p = measure(samples, told, performance.now());
      say(`result ${JSON.stringify({ ...p, hz: +p.hz.toFixed(1), steady: +p.steady.toFixed(3), worst: +p.worst.toFixed(1), travel: +p.travel.toFixed(1), uneven: +((p.still + p.doubled) / Math.max(1, p.counted)).toFixed(4), verdict: verdict(p) })}`);
    }, SAMPLE_MS);
  }, WARM_MS);
  say('probe up');
}
