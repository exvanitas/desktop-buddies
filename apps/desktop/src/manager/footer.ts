/* The switches along the bottom, and Settings. A switch shows what the hub says, not what was
   clicked, so it can't tell a different story from the tray. */
import { button, h } from '@buddies/peel/dom';

export interface FooterIO { hide(on: boolean): void; pause(on: boolean): void; autostart(on: boolean): void; settings(anchor: HTMLElement): void }
export interface Switches { hidden: boolean; paused: boolean; autostart: boolean; ready: boolean }

function toggle(words: string, flip: () => void) {
  return button([h('i'), words], flip, { class: 'tg', role: 'switch', 'aria-checked': 'false' });
}

export function createFooter(io: FooterIO) {
  let now: Switches = { hidden: false, paused: false, autostart: false, ready: false };
  const hide = toggle('Hide all', () => io.hide(!now.hidden)), pause = toggle('Pause', () => io.pause(!now.paused));
  const auto = toggle('Start with Windows', () => io.autostart(!now.autostart));
  const settings: HTMLButtonElement = button('Settings', () => io.settings(settings), { class: 'btn sm' });
  const el = h('footer', { class: 'toolbar' }, hide, pause, auto, settings);
  return {
    el, settings,
    update(s: Switches) {
      now = s;
      for (const [b, on] of [[hide, s.hidden], [pause, s.paused], [auto, s.autostart]] as const) {
        b.setAttribute('aria-checked', String(on));
        b.disabled = !s.ready;
      }
    }
  };
}
