/* Which real windows are terrain, and how. A snapshot's list, the monitors and the user's exclude
   list go in, rectangles come out, and every rule is a row here.

   A window is one of three things:
   - not there at all: no terrain and no blocker. See REAL, and the exclude list.
   - a blocker: it hides what's behind it and gives no surfaces. Maximized, or no floor to give.
   - terrain: cut down to the run of monitors that shows its top, so nothing she can reach is
     somewhere an overlay can't draw her. What the cut took off stays on as a blocker.

   A cut side is no edge, so it gives no surface, and neither does an edge with no room beside it
   for her body. `cut` names them.

   Monitors here are work areas, as the world's terrain is, so a taskbar's strip counts as off them. */
import type { Rectangle } from '@buddies/terrain';
import type { Work as Area } from './host';
import type { WindowEntry } from './shell';

/* Lower case, because Windows ignores case in a class name. Checked against PowerToys, NVDA,
   Magpie, yasb and ManagedShell, which each keep a list like this. */
const SHELL_CLASSES = new Set([
  /* taskbars and the desktop */
  'shell_traywnd', 'shell_secondarytraywnd', 'progman', 'workerw',
  /* the taskbar's flyouts */
  'notifyiconoverflowwindow', 'toplevelwindowforoverflowxamlisland', 'tasklistthumbnailwnd',
  /* Start, Search, the action centre, Win+X, the language switcher */
  'windows.ui.core.corewindow', 'startmenusizingframe', 'shell_lightdismissoverlay', 'launchertipwnd', 'shell_inputswitchtoplevelwindow',
  /* Alt-Tab, Task View, Snap Layouts */
  'foregroundstaging', 'multitaskingviewframe', 'taskswitcherwnd', 'xamlexplorerhostislandwindow', 'xamlexplorerhostislandwindow_wasdk',
  /* menus, tooltips and popups, in anyone's app */
  '#32768', 'tooltips_class32', 'xaml_windowedpopupclass', 'microsoft.ui.content.popupwindowsitebridge'
]);
/* Physical pixels. Anything resizable is at least 136 wide at 100%, so this only catches odd bits. */
export const TINY = { w: 120, h: 40 };
/* The room an edge needs beyond it, up to the end of its monitors, in CSS pixels: a buddy at the
   default size. With less, part of her is off the screen. A top with less isn't a floor at all. */
export const ROOM = 120;
/* Monitors this close side by side are one run. The same gap as `seams` in the terrain. */
export const SEAM = 160;

const key = (s: string) => s.toLowerCase();
const REAL: ((e: WindowEntry) => boolean)[] = [
  e => !SHELL_CLASSES.has(key(e.class)),
  e => !e.tool,
  e => !(e.layered && e.topmost), /* overlays people can't see as windows: Nvidia's, and the like */
  e => e.w >= TINY.w && e.h >= TINY.h
];
const real = (e: WindowEntry) => REAL.every(rule => rule(e));

const shownOn = (e: WindowEntry, x0: number, x1: number) => Math.min(e.x + e.w, x1) - Math.max(e.x, x0);
const rightOf = (a: Area) => a.x + a.w;

/* The monitors side by side at the height of this window's top, with room above it, that show the
   most of that top. */
function standing(e: WindowEntry, areas: Area[]) {
  const runs: Area[][] = [];
  for (const a of areas.filter(a => e.y - a.y >= ROOM * a.scale && e.y < a.y + a.h).sort((a, b) => a.x - b.x)) {
    const run = runs.at(-1);
    if (run && a.x - rightOf(run.at(-1)!) <= SEAM) run.push(a); else runs.push([a]);
  }
  let best: Area[] | null = null, most = 0;
  for (const run of runs) {
    const shown = shownOn(e, run[0]!.x, rightOf(run.at(-1)!));
    if (shown > most) { best = run; most = shown; }
  }
  return best;
}

function rectanglesOf(e: WindowEntry, z: number, areas: Area[]): Rectangle[] {
  const id = 'window' + e.id, whole = { x: e.x, y: e.y, w: e.w, h: e.h };
  const blocker = (name: string): Rectangle => ({ id: name, kind: 'window', rect: whole, z, terrain: false, scale: 1 });
  const run = e.max ? null : standing(e, areas);
  if (!run) return [blocker(id)];
  const left = run[0]!.x, right = rightOf(run.at(-1)!), room = ROOM * Math.max(...run.map(a => a.scale));
  const x = Math.max(e.x, left), w = Math.min(e.x + e.w, right) - x;
  if (w < TINY.w) return [blocker(id)];
  /* The shortest of the monitors it reaches, or that a buddy on its side would. */
  const bottom = Math.min(...run.filter(a => shownOn(e, a.x - room, rightOf(a) + room) > 0).map(a => a.y + a.h));
  const h = Math.min(e.y + e.h, bottom) - e.y, sides = h >= room;
  const cut: Rectangle['cut'] = [];
  if (!sides || e.x < left + room) cut.push('left');
  if (!sides || e.x + e.w > right - room) cut.push('right');
  if (e.y + e.h > bottom - room) cut.push('bottom');
  const widest = run.reduce((a, b) => shownOn(e, b.x, rightOf(b)) > shownOn(e, a.x, rightOf(a)) ? b : a);
  const floor: Rectangle = { id, kind: 'window', rect: { x, y: e.y, w, h }, z, terrain: true, scale: widest.scale, cut };
  return w === e.w && h === e.h ? [floor] : [floor, blocker(id + ' rest')];
}

/* The exe counts down from the top, and the terrain counts up from the screens at 0. */
export function windowRects(list: WindowEntry[], areas: Area[], exclude: string[]): Rectangle[] {
  const bottom = Math.max(0, ...list.map(e => e.z)), left = new Set(exclude.map(key));
  return list.filter(e => real(e) && !left.has(key(e.exe))).flatMap(e => rectanglesOf(e, bottom - e.z + 1, areas));
}

/* What the exclude list can offer: the apps behind real windows. */
export const appsIn = (list: WindowEntry[]) => [...new Set(list.filter(real).map(e => key(e.exe)).filter(Boolean))].sort();
