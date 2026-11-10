/* The exported page: a world, a right-click menu, and every buddy baked in. Built once into a
   single script that the export embeds in its html. */
import type { Buddy, Frame, Pose, PoseKey } from '@buddies/buddy-file';
import { GOODBYE_MS, canDo, type BuddyData, type Chatter } from '@buddies/engine';
import { createWorld } from './web-host';

/* images are stored once in `imgs`; frames point at them by index */
export type PackedFrame = Omit<Frame, 'src'> & { src: number };
export type PackedPose = Omit<Pose, 'frames'> & { frames: PackedFrame[] };
export type PackedBuddy = Omit<BuddyData, 'base' | 'poses'> & { base: PackedFrame; poses: Partial<Record<PoseKey, PackedPose>> };
export interface PlayerData { imgs: string[]; pets: PackedBuddy[]; bubbles: boolean; names: boolean; chatter: Chatter }

export function start(DATA: PlayerData) {
  const MAXP = 12;
  const root = document.getElementById('root')!;
  if (location.hash === '#transparent') document.documentElement.classList.add('clear');
  const uid = () => 'b' + Math.random().toString(36).slice(2, 9);
  const unpack = (f: PackedFrame): Frame => ({ ...f, src: DATA.imgs[f.src]! });
  const buddies: Buddy[] = DATA.pets.map(p => ({
    ...p, base: unpack(p.base),
    poses: Object.fromEntries(Object.entries(p.poses || {}).map(([k, ps]) => [k, { ...ps, frames: ps.frames.map(unpack) }]))
  }));
  const fresh = (): BuddyData[] => buddies.map(p => Object.assign({}, p, { id: uid() }));
  let pets = fresh();
  const menu = document.createElement('div'); menu.className = 'bm'; menu.hidden = true; menu.setAttribute('role', 'menu');
  const back = document.createElement('button'); back.type = 'button'; back.className = 'bm-back'; back.textContent = 'Bring buddies back'; back.hidden = true;
  document.body.append(menu, back);
  const ctl = createWorld({ root, bounds: () => ({ w: innerWidth, h: innerHeight }), onMenu: openMenu });
  const sync = () => { ctl.sync({ pets, bubbles: DATA.bubbles, names: DATA.names, chatter: DATA.chatter }); back.hidden = pets.length > 0; };
  back.onclick = () => { pets = fresh(); sync(); };

  const close = () => { menu.hidden = true; };
  addEventListener('pointerdown', e => { if (!menu.contains(e.target as Node)) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  addEventListener('blur', close);

  const leaving = new Set<string>();
  function dismiss(id: string) {
    const pet = ctl.pets.get(id); if (!pet || leaving.has(id)) return;
    leaving.add(id);
    pet.farewell();
    setTimeout(() => { ctl.poof(id); pets = pets.filter(p => p.id !== id); leaving.delete(id); sync(); }, GOODBYE_MS);
  }
  function openMenu(id: string, x: number, y: number) {
    const d = pets.find(p => p.id === id); if (!d || leaving.has(id)) return;
    const items: ([string, boolean, () => void] | null)[] = [
      ['Call another', pets.length < MAXP, () => { pets.push(Object.assign({}, d, { id: uid() })); sync(); }],
      ['Chase my cursor', true, () => ctl.act(id, 'chase')],
      ['Everyone dance', pets.length > 1 && pets.some(p => canDo(p, 'dance')), () => ctl.actAll('dance')],
      null,
      ['Dismiss', true, () => dismiss(id)],
      ['Dismiss all', pets.length > 1, () => pets.forEach((p, i) => setTimeout(() => dismiss(p.id), i * 120))]
    ];
    menu.innerHTML = '';
    const h = document.createElement('b'); h.textContent = d.name || 'Buddy'; menu.append(h);
    items.forEach(it => {
      if (!it) { menu.append(document.createElement('hr')); return; }
      if (!it[1]) return;
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = it[0];
      b.onclick = () => { close(); it[2](); };
      menu.append(b);
    });
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
    menu.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
    menu.querySelector('button')!.focus({ preventScroll: true });
  }
  sync();
  const hint = document.querySelector('.bm-hint'); if (hint) setTimeout(() => hint.classList.add('gone'), 6000);
  (window as unknown as { buddies: unknown }).buddies = ctl;
}
