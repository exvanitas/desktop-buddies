/* The ••• menu, and the delete confirm that takes its place. */
import type { BuddyRow } from '../manager-api';
import { button, h } from '@buddies/peel/dom';
import type { MenuItem } from '@buddies/peel/menu';

export interface BuddyActions {
  bringHere(): void; treat(): void; chase(): void; another(): void; dismissOne(): void; edit(): void; exportIt(): void; remove(): void;
  /* the desktop's alone: the Manager has Dismiss as a button on her sticker */
  dismiss?(): void;
}

/* What a buddy offers, in the Manager's ••• menu or when she's right-clicked on the desktop. Pure. A
   treat and a chase only when she has the art for them. What she does on the desktop comes first,
   then her file, with a line between. On the desktop she's already where the click was, so Bring
   here is for her other copies, and Dismiss is there, as the Manager's sticker has it. */
export function buddyItems(b: BuddyRow, maker: boolean, a: BuddyActions, where: 'manager' | 'desktop' = 'manager'): MenuItem[] {
  const out = b.copies > 0, desktop = where === 'desktop';
  const desk: MenuItem[] = [
    ...out && (!desktop || b.copies > 1) ? [{ words: 'Bring here', act: a.bringHere }] : [],
    ...out && b.can.includes('eat') ? [{ words: 'Give a treat', act: a.treat }] : [],
    ...out && b.can.includes('chase') ? [{ words: 'Chase my mouse', act: a.chase }] : [],
    ...out ? [{ words: 'Call another', act: a.another }] : [],
    ...b.copies > 1 ? [{ words: 'Dismiss one', act: a.dismissOne }] : [],
    ...desktop && out && a.dismiss ? [{ words: 'Dismiss', act: a.dismiss }] : []
  ];
  const file: MenuItem[] = [
    ...maker ? [{ words: 'Edit', act: a.edit }] : [],
    { words: 'Export to a file', act: a.exportIt },
    { words: 'Delete', act: a.remove, bad: true }
  ];
  if (desk.length) file[0] = { ...file[0]!, rule: true };
  return [...desk, ...file];
}

/* Cancel is the big, focused button, and Escape, a click away or a scroll all mean Cancel too. */
export function confirmOf(b: BuddyRow, cancel: () => void, yes: () => void) {
  const stay = button('Cancel', cancel, { class: 'btn sm go' });
  const el = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': `Delete ${b.name}?` },
    h('h2', { dir: 'auto', title: b.name }, `Delete ${b.name}?`),
    h('p', {}, "This can't be undone.", b.copies ? ' It leaves your desktop too.' : ''),
    h('div', { class: 'row' }, stay, button('Delete', yes, { class: 'btn sm bad' })));
  return { el, stay };
}
