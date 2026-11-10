/* Other apps: the question an app's first request asks, at the top of the sheet, and the setting
   that lets them ask at all, with each app the person has answered. Names are only text. */
import type { ApiApp } from '../manager-api';
import { button, h } from '@buddies/peel/dom';

export interface AskingIO { answer(app: string, allow: boolean): void }
export interface ApiSettingIO { setOn(on: boolean): void; forget(app: string): void }
export interface ApiView { on: boolean; apps: ApiApp[]; asking: string[]; ready: boolean }

export const askWords = (app: string) => `${app} wants your buddies to wave and talk`;
export const SETTING = 'Let other apps ask buddies to do things';

export function createAsking(io: AskingIO) {
  const el = h('div', { class: 'asking' });
  let shown = '';
  return {
    el,
    update(v: ApiView) {
      const now = v.on ? v.asking : [];
      el.hidden = !now.length;
      if (now.join('\n') === shown) return;
      shown = now.join('\n');
      el.replaceChildren(...now.map(app => h('div', { class: 'ask', role: 'alert', 'data-app': app },
        h('p', {}, h('b', { dir: 'auto' }, askWords(app)), 'Any app can use any name, so allow only one you started.'),
        button('Allow', () => io.answer(app, true), { class: 'btn sm go' }),
        button('Not now', () => io.answer(app, false), { class: 'btn sm' }))));
    }
  };
}

/* Made once and carried from panel to panel, like Walk on windows. It shows what the hub says. */
export function createApiSetting(io: ApiSettingIO) {
  let now: ApiView = { on: false, apps: [], asking: [], ready: false }, shown = '';
  const master = button(h('i'), () => io.setOn(!now.on), { class: 'tg', role: 'switch', 'aria-checked': 'false', 'aria-label': SETTING });
  const list = h('div', { class: 'api-apps' }), head = h('p', { class: 'api-head' }, 'Apps that asked');
  const el = h('div', { class: 'api-setting' }, h('div', { class: 'setting' }, h('span', {}, SETTING), master),
    h('p', { class: 'api-head' }, 'They can wave and say a line, nothing else.'), head, list);
  return {
    el,
    update(v: ApiView) {
      now = v;
      master.setAttribute('aria-checked', String(v.on));
      master.disabled = !v.ready;
      const key = v.apps.map(a => `${a.name}\n${a.allow}`).join('\n') + `\n${v.ready}`;
      head.hidden = list.hidden = !v.apps.length;
      if (key === shown) return;
      shown = key;
      list.replaceChildren(...v.apps.map(a => h('div', { class: 'setting', 'data-app': a.name },
        h('span', { title: a.name }, a.name, h('small', {}, a.allow ? ' Allowed' : ' Not allowed')),
        button('Remove', () => io.forget(a.name), { class: 'btn sm', 'aria-label': `Remove ${a.name}`, disabled: !v.ready }))));
    }
  };
}
