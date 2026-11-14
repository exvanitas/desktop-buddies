/* A short menu of named actions. Arrow keys move along it, over any line between groups. */
import { button, h } from './dom';

/* `rule` starts a new group, with a line above it. `checked` makes it a switch, ticked when on. */
export interface MenuItem { words: string; act(): void; bad?: boolean; rule?: boolean; checked?: boolean }

export function menuOf(items: MenuItem[], label: string) {
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': label }, ...items.flatMap(i => [
    ...i.rule ? [h('div', { class: 'rule', role: 'separator' })] : [],
    button(i.words, i.act, i.checked === undefined ? { role: 'menuitem', class: i.bad ? 'bad' : null } : { role: 'menuitemcheckbox', 'aria-checked': String(i.checked), class: i.bad ? 'bad' : null })]));
  menu.addEventListener('keydown', e => {
    const all = [...menu.querySelectorAll('button')], at = all.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    all[(to + all.length) % all.length]!.focus();
  });
  return menu;
}
