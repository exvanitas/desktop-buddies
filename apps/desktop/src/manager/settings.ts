/* Settings: a small panel, with room for pace and the rest later. Walk on windows belongs to the hub,
   like the switches along the bottom. */
import { button, h } from '@buddies/peel/dom';
import type { Theme } from '@buddies/peel/theme';

export interface WalkIO { walk(on: boolean): void; exclude(app: string, on: boolean): void }
export interface WalkState { walk: boolean; exclude: string[]; apps: string[]; ready: boolean }

/* Made once and carried from panel to panel, so its place in the list survives a redraw. It shows
   what the hub says, not what was clicked. An app on the list that isn't open stays on offer, or it
   could never come off. */
export function createWalkSetting(io: WalkIO) {
  let now: WalkState = { walk: true, exclude: [], apps: [], ready: false }, shown = '';
  const flip = (words: string, f: () => void) => button(h('i'), f, { class: 'tg', role: 'switch', 'aria-checked': 'false', 'aria-label': words });
  const master = flip('Walk on windows', () => io.walk(!now.walk));
  const rows = new Map<string, { el: HTMLElement; on: HTMLButtonElement }>();
  const row = (app: string) => {
    if (!rows.has(app)) {
      const on = flip(`Stay off ${app}`, () => io.exclude(app, !now.exclude.includes(app)));
      rows.set(app, { on, el: h('div', { class: 'setting' }, h('span', { title: app }, app), on) });
    }
    return rows.get(app)!;
  };
  const list = h('div', { class: 'apps' }), head = h('p', { class: 'apps-head' }, 'Stay off');
  const el = h('div', { class: 'walk' }, h('div', { class: 'setting' }, h('span', {}, 'Walk on windows'), master), head, list);
  return {
    el,
    update(s: WalkState) {
      now = s;
      const apps = [...new Set([...s.apps, ...s.exclude])].sort();
      if (apps.join() !== shown) {
        const had = document.activeElement;
        shown = apps.join();
        list.replaceChildren(...apps.map(a => row(a).el));
        if (had instanceof HTMLElement && list.contains(had)) had.focus();
      }
      head.hidden = list.hidden = !apps.length;
      master.setAttribute('aria-checked', String(s.walk));
      master.disabled = !s.ready;
      for (const a of apps) {
        const { on } = row(a);
        on.setAttribute('aria-checked', String(s.exclude.includes(a)));
        on.disabled = !s.ready || !s.walk;
      }
    }
  };
}

/* The Store's package declares .buddy files, so Windows opens them and there's nothing to switch.
   Shown only there. */
export function createFilesNote() {
  const el = h('p', { class: 'files-note', hidden: true }, 'Windows opens .buddy files with Desktop Buddies.');
  return { el, update(packaged: boolean) { el.hidden = !packaged; } };
}

export function settingsPanel(theme: Theme, pick: (t: Theme) => void, walk: HTMLElement, api: HTMLElement, files: HTMLElement) {
  const choice = (t: Theme, words: string) => button(words, () => pick(t), { role: 'radio', 'aria-checked': String(t === theme), 'data-theme-choice': t });
  return h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Settings' },
    h('h2', {}, 'Settings'),
    h('div', { class: 'setting' }, h('span', {}, 'Theme'),
      h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'Theme' }, choice('dark', 'Dark'), choice('light', 'Light'))),
    files, walk, api);
}
