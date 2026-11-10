/* The right-click menu's page. The hub opens its window hidden on the first right-click, keeps it for
   the run, and does everything to it. Its logic is in buddy-menu-view.ts. A close from outside,
   Alt+F4, asks the hub to hide it like Esc does, so the window the hub keeps is always there. */
import { mountMenu } from './buddy-menu-view';
import type { Said } from './manager-api';
import { cspSeen, errorSeen, rejectionSeen } from './log-safe';
import { createShell } from './shell';
import { MENU_CHANNEL, broadcastWire } from './wire';

const shell = createShell(window.__TAURI__);
addEventListener('error', e => { void shell.log(`menu error ${errorSeen(e)}`); });
addEventListener('unhandledrejection', e => { void shell.log(`menu rejected ${rejectionSeen(e)}`); });
addEventListener('securitypolicyviolation', e => { void shell.log(`menu error csp ${cspSeen(e)}`); });

/* each window has its own label, which the hub opened it with */
const { label } = window.__BUDDIES__ as { label: string };
const menu = mountMenu(document.getElementById('root')!, {
  wire: broadcastWire<Said>(MENU_CHANNEL),
  label,
  store: () => localStorage,
  stamp: () => performance.timeOrigin + performance.now(),
  focused: () => document.hasFocus()
});
void shell.onCloseAsked(label, () => menu.close('alt-f4'));
void shell.log('menu page up');
