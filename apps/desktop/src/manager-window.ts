/* The Manager's window: opened when it's wanted, really closed when it's done. There's no hidden
   copy, because each open window costs about 20 MB. Whether it's open is asked each time. */
import { reason } from './failures';
import type { PlainWindowSpec, Shell } from './shell';

/* Peel's sizes. The view draws the title bar, and Windows keeps the shadow and snapping. */
export const MANAGER: PlainWindowSpec = {
  label: 'manager', kind: 'window', page: 'manager.html', title: 'Desktop Buddies Manager',
  width: 760, height: 580, minWidth: 560, minHeight: 440, center: true, decorations: false, shadow: true
};

/* `newer`: the exe is API 2, whose focus restores a minimized window. */
export function createManagerWindow(shell: Shell, newer: () => boolean = () => false) {
  const { label } = MANAGER;
  /* Two clicks can race a window that's still opening. */
  const open = () => shell.windowOpen(MANAGER).catch(e => {
    if (!/already open/.test(reason(e))) throw e;
    return shell.windowFocus(label);
  });

  return {
    /* Opens it, or brings it forward. On API 1 the exe's focus does nothing to a minimized window
       and has no way to restore one, so a fresh window does it: the page holds no state of its own. */
    async raise() {
      if (newer()) return open();
      const minimized = await shell.windowMinimized(label).catch(() => null);
      if (minimized === null) return open();
      if (!minimized) return shell.windowFocus(label);
      await shell.windowClose(label);
      return open();
    }
  };
}
