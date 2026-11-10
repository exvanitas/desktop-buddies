/* The Manager page. It joins the client to the page and the view to the client. Its logic is in
   manager-client.ts, and the hub owns everything it shows. */
import { fromShimeji } from '@buddies/art';
import { outlineOfImage } from '@buddies/art/outline-canvas';
import { createOutlines } from './manager/outlines';
import { fit } from './manager/sticker';
import { createManagerClient } from './manager-client';
import { mountView } from './manager-view';
import { MANAGER } from './manager-window';
import { cspSeen, errorSeen, rejectionSeen } from './log-safe';
import { createShell } from './shell';
import { broadcastWire } from './wire';

const shell = createShell(window.__TAURI__);
addEventListener('error', e => { void shell.log(`manager error ${errorSeen(e)}`); });
addEventListener('unhandledrejection', e => { void shell.log(`manager rejected ${rejectionSeen(e)}`); });
addEventListener('securitypolicyviolation', e => { void shell.log(`manager error csp ${cspSeen(e)}`); });

mountView(document.getElementById('root')!, createManagerClient({
  wire: broadcastWire(),
  session: Date.now().toString(36) + Math.random().toString(36).slice(2),
  after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); },
  shimeji: fromShimeji,
  closeWindow: () => shell.windowClose(MANAGER.label)
}), {
  minimize: () => shell.windowMinimize(MANAGER.label),
  outline: createOutlines(url => outlineOfImage(url, (w, h) => fit(w, h))),
  store: () => localStorage,
  moves: () => !matchMedia('(prefers-reduced-motion: reduce)').matches,
  now: () => performance.now(),
  after: (ms, f) => { setTimeout(f, ms); }
});
void shell.log('manager page up');
