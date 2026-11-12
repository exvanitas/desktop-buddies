/* A fake exe. It answers the same commands the real one does, so tests run the real client in
   shell.ts against it, argument names and all. It only holds what tests need to see. `api` picks
   which exe: 1, the default, is the frozen one, and 2 adds what the next one does. */
import { createShell, type Events, type Listed, type Monitor, type Opened, type Shell, type System, type Tauri, type WindowEntry, type WindowSpec } from './shell';

const CAP = 64 * 1024 * 1024;
const bad = (path: string) => path.split(/[/\\]/).some(n => !n || n === '.' || n === '..' || /[<>:"|?*\0]/.test(n));

export interface FakeOptions {
  monitors?: Monitor[]; args?: string[]; api?: number; opened?: Opened[]; system?: Partial<System>;
  /* The Store's package: autostart is its startup task, and .buddy files are declared. */
  packaged?: boolean;
  /* called as each page listener goes on, for events that arrive while the rest are going on */
  listening?(event: string, exe: FakeExe): void;
}
export interface FakeExe {
  shell: Shell;
  /* The command door itself, for a page that has its own client. */
  invoke: Tauri['core']['invoke'];
  /* what the exe would hold */
  files: Map<string, Uint8Array>; windows: Map<string, WindowSpec & { hidden: boolean; minimized?: boolean }>; tray: Parameters<Shell['traySet']>[0] | null;
  autostart: boolean; system: System; monitors: Monitor[];
  /* Packaged: the person turned the startup task off in Windows Settings, so the app can't turn
     it on, as the real one refuses. */
  offInWindows: boolean;
  /* What's on the desktop. Like the tracker, this speaks only while watched, only on a change, and
     once at the start of every watch. */
  watching: boolean;
  setWindows(list: WindowEntry[]): void;
  /* the window that last took focus */
  focused: string | null;
  /* API 2: whether keeping on top is on */
  raising: boolean;
  /* What the save dialog answers. `saved` is what it was handed, whatever the answer. Set
     `dialog` to a promise to hold the dialog open until it settles. */
  saved: { name: string; filters: unknown; content: string }[];
  dialog: boolean | Promise<boolean>;
  /* every command, in order, with the path a write went to */
  calls: { cmd: string; args: unknown; path?: string }[]; logs: string[];
  emit<E extends keyof Events>(event: E, payload: Events[E]): void;
  /* The next call of `cmd` fails, or the next one `when` picks out by its arguments. */
  failNext(cmd: string, why: string, when?: (args: never) => boolean): void;
  /* A close from outside the page: Alt+F4 or the taskbar. With a page listening it only tells the
     page, and with none the window goes, as Tauri does it. */
  closeFromOutside(label: string): void;
  /* Every call of `cmd` that `when` picks out fails, until the function it returns is called. */
  failUntil(cmd: string, why: string, when: (args: never) => boolean): () => void;
  /* The nth change to the data folder from now fails. With `crash`, so does every command after it,
     until `revive`, which is the next run. With `torn`, a delete it stops gets partway first, as a
     real one can. */
  faultAt(n: number, crash?: boolean, torn?: boolean): void;
  /* The next call of `cmd` that `when` picks out waits, until the function this returns is called. */
  hold(cmd: string, when?: (args: never) => boolean): () => void;
  /* The next call of `cmd` does its work at once, but its answer waits until the function this
     returns is called: done, as far as the world goes, before the caller hears. */
  holdAnswer(cmd: string): () => void;
  revive(): void;
}
const CHANGES = new Set(['data_write', 'data_move', 'data_delete']);

export function createFakeExe(o: FakeOptions = {}): FakeExe {
  const listeners = new Map<string, ((e: { payload: never }) => void)[]>(), closeAsked = new Map<string, ((e: { payload: never }) => void)[]>(), failing = new Map<string, { why: string; when?: (args: never) => boolean }>();
  const lasting = new Set<{ cmd: string; why: string; when: (args: never) => boolean }>();
  let opened = o.opened || [], fault = 0, crashing = false, tearing = false, down = false;
  const held = new Set<{ cmd: string; when?: (args: never) => boolean; wait: Promise<void> }>();
  const answers = new Set<{ cmd: string; wait: Promise<void> }>();
  /* When each file was written, as the real listing says, so a page can see a buddy has changed. */
  const stamps = new Map<string, number>();
  let clock = 1000;
  let desktop: WindowEntry[] = [], seq = 0;
  const snapshot = () => ({ seq: ++seq, foreground: desktop[0]?.id ?? 0, list: desktop });
  const exe: FakeExe = {
    shell: null as unknown as Shell, invoke: null as unknown as Tauri['core']['invoke'],
    files: new Map(), windows: new Map(), tray: null, autostart: false, offInWindows: false, focused: null, raising: false, saved: [], dialog: false,
    system: { userState: 'normal', onBattery: false, saver: false, ...o.system },
    monitors: o.monitors || [],
    watching: false,
    setWindows(list) {
      const changed = JSON.stringify(list) !== JSON.stringify(desktop);
      desktop = list;
      if (changed && exe.watching) exe.emit('windows', snapshot());
    },
    calls: [], logs: [],
    emit(event, payload) { for (const f of listeners.get(event) || []) f({ payload: payload as never }); },
    failNext(cmd, why, when) { failing.set(cmd, { why, when }); },
    failUntil(cmd, why, when) { const f = { cmd, why, when }; lasting.add(f); return () => { lasting.delete(f); }; },
    /* As tauri does it: only that window's own listeners hear, and with none, it just goes. */
    closeFromOutside(label) {
      const asked = closeAsked.get(label) || [];
      if (asked.length) for (const f of asked) f({ payload: null as never });
      else gone(label);
    },
    faultAt(n, crash = false, torn = false) { fault = n; crashing = crash; tearing = torn; },
    holdAnswer(cmd) {
      let go = () => {};
      answers.add({ cmd, wait: new Promise(r => { go = r; }) });
      return () => go();
    },
    hold(cmd, when) {
      let go = () => {};
      held.add({ cmd, when, wait: new Promise(r => { go = r; }) });
      return () => go();
    },
    revive() { down = false; }
  };
  const path = (p: string) => { if (!p || bad(p)) throw new Error(`refused path ${JSON.stringify(p)}`); return p; };
  const under = (dir: string) => dir ? dir + '/' : '';
  const changed = (p: string) => exe.emit('data-changed', { path: p });

  function list(dir: string): Listed[] {
    if (dir && bad(dir)) throw new Error('refused path');
    const seen = new Map<string, Listed>();
    for (const [p, bytes] of exe.files) {
      if (!p.startsWith(under(dir))) continue;
      const [name, more] = p.slice(under(dir).length).split(/\/(.*)/s);
      seen.set(name!, { name: name!, dir: more !== undefined, size: bytes.length, modified: stamps.get(p) ?? 1 });
    }
    if (dir && !seen.size) throw new Error('no such folder');
    return [...seen.values()].sort((a, b) => a.name < b.name ? -1 : 1);
  }
  function write(args: unknown, headers: Record<string, string>) {
    const p = path(decodeURIComponent(headers['x-path']!)), bytes = args as Uint8Array;
    if (bytes.length > CAP) throw new Error('too big');
    exe.files.set(p, bytes); stamps.set(p, ++clock); changed(p);
  }
  function move(from: string, to: string) {
    path(from); path(to);
    if ([...exe.files.keys()].some(k => k === to || k.startsWith(to + '/'))) throw new Error('already exists');
    for (const [k, v] of [...exe.files]) if (k === from || k.startsWith(from + '/')) {
      const at = to + k.slice(from.length), stamp = stamps.get(k);
      exe.files.delete(k); stamps.delete(k); exe.files.set(at, v);
      if (stamp !== undefined) stamps.set(at, stamp);
    }
    changed(from); changed(to);
  }
  function remove(p: string) {
    path(p);
    for (const k of [...exe.files.keys()]) if (k === p || k.startsWith(p + '/')) { exe.files.delete(k); stamps.delete(k); }
    changed(p);
  }
  const win = (label: string) => { const w = exe.windows.get(label); if (!w) throw new Error('no window ' + label); return w; };
  const api = o.api ?? 1, newer = api >= 2;
  /* A window went, however it closed. Only API 2 says so. */
  function gone(label: string) {
    if (!exe.windows.delete(label)) return;
    if (newer) exe.emit('window-closed', { label });
  }
  /* API 1 refuses fields it doesn't know, as serde's deny_unknown_fields does. */
  const known = (fields: string[], v: object, what: string) => {
    for (const k of Object.keys(v)) if (!fields.includes(k)) throw new Error(`${what}: unknown field \`${k}\``);
  };
  const WINDOW_V1 = ['label', 'kind', 'page', 'boot', 'x', 'y', 'w', 'h', 'width', 'height', 'minWidth', 'minHeight', 'center', 'title', 'resizable', 'decorations', 'transparent', 'shadow', 'alwaysOnTop', 'skipTaskbar', 'visible'];
  const CAN = ['raise', 'tool-overlays', 'window-focus-spec', 'window-closed', 'focus-restores', 'save-atomic', 'save-owner', 'quit-wait'];

  const commands: Record<string, (a: never, h: Record<string, string>) => unknown> = {
    shell_info: () => ({ api, version: '0.1.0', platform: 'windows', args: o.args || [], dataDir: 'C:\\data', ...(newer ? { can: CAN } : {}), ...(o.packaged ? { packaged: true } : {}) }),
    quit: () => { exe.emit('quitting', newer ? { grace: 250, bound: 10000 } : null); },
    ...(newer ? {
      quit_wait: () => {},
      quit_ready: () => {},
      raise: (a: { on: boolean }) => { exe.raising = a.on; }
    } : {}),
    log_line: (a: { line: string }) => { exe.logs.push(a.line); },
    open_external: (a: { url: string }) => { if (!a.url.startsWith('https://')) throw new Error('refused url'); },
    monitors: () => exe.monitors,
    window_open: (a: { spec: WindowSpec }) => {
      if (!newer) known(WINDOW_V1, a.spec, 'window_open');
      if (exe.windows.has(a.spec.label)) throw new Error('already open');
      exe.windows.set(a.spec.label, { ...a.spec, hidden: a.spec.kind === 'window' && a.spec.visible === false });
      if (a.spec.kind === 'window' && a.spec.focused !== false) exe.focused = a.spec.label;
    },
    window_close: (a: { label: string }) => { win(a.label); gone(a.label); },
    window_show: (a: { label: string }) => { win(a.label).hidden = false; },
    window_hide: (a: { label: string }) => { win(a.label).hidden = true; },
    /* As tao does it on API 1: focusing a minimized window does nothing, and says nothing. API 2
       restores it first. */
    window_focus: (a: { label: string }) => {
      const w = win(a.label);
      if (newer) w.minimized = false;
      if (!w.minimized) exe.focused = a.label;
    },
    'plugin:window|is_minimized': (a: { label: string }) => { if (!exe.windows.has(a.label)) throw new Error('window not found'); return !!win(a.label).minimized; },
    'plugin:window|minimize': (a: { label: string }) => { win(a.label).minimized = true; },
    window_place: (a: { label: string; x: number; y: number; w: number; h: number }) => { Object.assign(win(a.label), { x: a.x, y: a.y, w: a.w, h: a.h }); },
    window_icon: (a: { label: string }) => { win(a.label); },
    capture: () => {},
    tray_set: (a: { spec: FakeExe['tray'] }) => { exe.tray = a.spec; },
    data_list: (a: { dir: string }) => list(a.dir),
    data_read: (a: { path: string }) => {
      const bytes = exe.files.get(path(a.path)); if (!bytes) throw new Error('no such file');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    data_write: write,
    data_move: (a: { from: string; to: string }) => move(a.from, a.to),
    data_delete: (a: { path: string }) => remove(a.path),
    open_data_folder: () => {},
    save_as: (a: Uint8Array, h: Record<string, string>) => {
      const spec = JSON.parse(decodeURIComponent(h['x-spec']!)) as { name: string; filters: unknown; owner?: string };
      if (!newer) known(['name', 'filters'], spec, 'save_as');
      exe.saved.push({ ...spec, content: new TextDecoder().decode(a) });
      return exe.dialog;
    },
    take_opened: () => { const out = opened; opened = []; return out; },
    windows_watch: (a: { on: boolean }) => {
      exe.watching = a.on;
      if (a.on) queueMicrotask(() => { if (exe.watching) exe.emit('windows', snapshot()); });
    },
    windows_now: () => ({ seq, foreground: desktop[0]?.id ?? 0, list: desktop }),
    system: () => exe.system,
    autostart: (a: { on?: boolean }) => {
      if (o.packaged && exe.offInWindows) {
        exe.autostart = false;
        if (a.on) throw new Error('the startup task was turned off in Windows Settings');
      }
      if (a.on !== undefined) exe.autostart = a.on;
      return exe.autostart;
    },
    file_assoc: (a: { on?: boolean }) => {
      if (!o.packaged) return false;
      if (a.on !== undefined) throw new Error('the package declares .buddy files, so Windows handles them');
      return true;
    }
  };

  const tauri: Tauri = {
    core: {
      invoke: async (cmd, args, options) => {
        const to = options?.headers['x-path'];
        exe.calls.push({ cmd, args, ...(to !== undefined ? { path: decodeURIComponent(to) } : {}) });
        for (const h of held) if (h.cmd === cmd && (!h.when || h.when(args as never))) { held.delete(h); await h.wait; break; }
        if (down) throw new Error('the exe is gone');
        if (CHANGES.has(cmd) && fault && --fault === 0) {
          down = crashing;
          if (tearing && cmd === 'data_delete') {
            const p = (args as { path: string }).path, doomed = [...exe.files.keys()].filter(k => k === p || k.startsWith(p + '/'));
            for (const k of doomed.slice(0, Math.ceil(doomed.length / 2))) exe.files.delete(k);
          }
          throw new Error('disk fault');
        }
        for (const l of lasting) if (l.cmd === cmd && l.when(args as never)) throw new Error(l.why);
        const fail = failing.get(cmd);
        if (fail && (!fail.when || fail.when(args as never))) { failing.delete(cmd); throw new Error(fail.why); }
        const f = commands[cmd];
        if (!f) throw new Error('unknown command ' + cmd);
        const result = f(args as never, options?.headers || {});
        for (const a of answers) if (a.cmd === cmd) { answers.delete(a); await a.wait; break; }
        return result;
      }
    },
    event: {
      listen: async (name, f, options) => {
        if (name === 'tauri://close-requested' && options) closeAsked.set(options.target.label, [...(closeAsked.get(options.target.label) || []), f]);
        else listeners.set(name, [...(listeners.get(name) || []), f]);
        o.listening?.(name, exe);
      }
    }
  };
  exe.shell = createShell(tauri); exe.invoke = tauri.core.invoke;
  return exe;
}
