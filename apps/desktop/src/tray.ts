/* The tray menu, enough to use the app with no Manager. All its words live here, not in the exe,
   which only adds Quit. */
import type { MenuItem } from './shell';

export interface TrayState {
  buddies: { id: string; name: string; out: boolean }[];
  hidden: boolean; paused: boolean; autostart: boolean;
}
export const BUDDY = 'buddy:';

export function menu(s: TrayState): MenuItem[] {
  const buddies: MenuItem[] = s.buddies.map(b => ({ id: BUDDY + b.id, label: b.name, checked: b.out }));
  return [
    { id: 'manager', label: 'Open Manager' },
    { separator: true },
    { label: 'Buddies', enabled: buddies.length > 0, items: buddies.length ? buddies : [{ id: 'none', label: 'None yet', enabled: false }] },
    /* also reopens the overlays, for one stuck behind windows */
    { id: 'bring', label: 'Bring everyone here' },
    { separator: true },
    { id: 'hide', label: 'Hide all', checked: s.hidden },
    { id: 'pause', label: 'Pause', checked: s.paused },
    { separator: true },
    { id: 'library', label: 'Open library folder' },
    { id: 'autostart', label: 'Start with Windows', checked: s.autostart }
  ];
}
