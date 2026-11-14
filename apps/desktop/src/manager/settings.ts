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

export const FILES_SWITCH = 'Open .buddy files with Desktop Buddies';
export interface FilesState { files: boolean; packaged: boolean; ready: boolean }
/* Anywhere else, a switch: it shows what the hub says Windows has, like Walk on windows. Made once
   and carried from panel to panel. */
export function createFilesSetting(set: (on: boolean) => void) {
  let now: FilesState = { files: false, packaged: false, ready: false };
  const on = button(h('i'), () => set(!now.files), { class: 'tg', role: 'switch', 'aria-checked': 'false', 'aria-label': FILES_SWITCH });
  const row = h('div', { class: 'setting files-setting', hidden: true }, h('span', {}, FILES_SWITCH), on);
  const note = createFilesNote();
  return {
    el: h('div', { class: 'files' }, row, note.el),
    update(s: FilesState) {
      now = s;
      row.hidden = s.packaged;
      note.update(s.packaged);
      on.setAttribute('aria-checked', String(s.files));
      on.disabled = !s.ready;
    }
  };
}

export interface LookIO { names(on: boolean): void; talk(on: boolean): void }
export interface LookState { names: boolean; talk: boolean; ready: boolean }
export const TALK_NOTE = 'Lines other apps send still show.';
/* Show names and Buddies talk, for every buddy. A buddy's own Talks is in her menu. Made once and
   carried from panel to panel, and it shows what the hub says. */
export function createLookSetting(io: LookIO) {
  let now: LookState = { names: true, talk: true, ready: false };
  const flip = (words: string, f: () => void) => button(h('i'), f, { class: 'tg', role: 'switch', 'aria-checked': 'true', 'aria-label': words });
  const names = flip('Show names', () => io.names(!now.names)), talk = flip('Buddies talk', () => io.talk(!now.talk));
  return {
    el: h('div', { class: 'look' },
      h('div', { class: 'setting' }, h('span', {}, 'Show names'), names),
      h('div', { class: 'setting' }, h('span', {}, 'Buddies talk'), talk),
      h('p', { class: 'look-note' }, TALK_NOTE)),
    update(s: LookState) {
      now = s;
      names.setAttribute('aria-checked', String(s.names));
      talk.setAttribute('aria-checked', String(s.talk));
      names.disabled = talk.disabled = !s.ready;
    }
  };
}

export function settingsPanel(theme: Theme, pick: (t: Theme) => void, walk: HTMLElement, api: HTMLElement, files: HTMLElement, look: HTMLElement) {
  const choice = (t: Theme, words: string) => button(words, () => pick(t), { role: 'radio', 'aria-checked': String(t === theme), 'data-theme-choice': t });
  return h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Settings' },
    h('h2', {}, 'Settings'),
    h('div', { class: 'setting' }, h('span', {}, 'Theme'),
      h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'Theme' }, choice('dark', 'Dark'), choice('light', 'Light'))),
    look, files, walk, api);
}
