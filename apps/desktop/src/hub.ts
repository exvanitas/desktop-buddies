/* The hub page: hidden, and open for the whole run. It keeps the SharedWorker alive through
   monitor changes. Its logic is in hub-core.ts. */
import { createHub } from './hub-core';
import type { Message } from './host';
import { cspSeen, errorSeen, rejectionSeen } from './log-safe';
import { createShell } from './shell';
import { MENU_CHANNEL, broadcastWire } from './wire';

(async () => {
  const shell = createShell(window.__TAURI__);
  addEventListener('error', e => { void shell.log(`error ${errorSeen(e)}`); });
  addEventListener('unhandledrejection', e => { void shell.log(`rejected ${rejectionSeen(e)}`); });
  addEventListener('securitypolicyviolation', e => { void shell.log(`error csp ${cspSeen(e)}`); });
  const worker = new SharedWorker('world.js', { name: 'world' }), world = worker.port;
  worker.onerror = e => { void shell.log(`error world ${errorSeen(e as ErrorEvent)}`); };
  world.onmessage = e => { if (e.data.k === 'note') void shell.log(e.data.text); };
  world.start();
  const hub = createHub({
    shell, send: (m: Message) => world.postMessage(m), wire: broadcastWire(), menuWire: broadcastWire(MENU_CHANNEL),
    /* No seed.json in the app folder: this build seeds no one. */
    seed: async () => { const r = await fetch('seed.json').catch(() => null); return r?.ok ? r.text() : null; },
    after: (ms, f) => { setTimeout(f, ms); }
  });
  await hub.start();
})();
