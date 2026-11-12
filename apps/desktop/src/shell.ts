/* The contract with the exe, typed. This is the only file that touches `__TAURI__`. Everything
   else takes a Shell, so tests can hand it one on a fake exe (shell-fake.ts). See
   docs/native-shell-design.md. */

/* The newest exe contract this app knows, and the oldest it runs on. On API 1 it keeps that exe's
   ways; from API 2 it uses what that exe added. See docs/native-shell-design.md. */
export const API = 2;
export const MIN_API = 1;

export interface Rect { x: number; y: number; w: number; h: number }
/* x y w h are the work area, `full` the whole screen. All physical pixels on the virtual desktop. */
export interface Monitor extends Rect { i: number; name: string; primary: boolean; scale: number; full: Rect }
/* `can`: what the exe does beyond API 1, by name. API 1 has none. `packaged`: running as the Store's
   MSIX package. Only an exe that knows says so: a missing field is not packaged. */
export interface Info { api: number; version: string; platform: string; args: string[]; dataDir: string; can?: string[]; packaged?: boolean }
export interface Cursor { x: number; y: number; down: boolean; right: boolean }
export interface System { userState: 'normal' | 'fullscreen' | 'presentation' | 'busy' | 'away'; onBattery: boolean; saver: boolean }
export interface Listed { name: string; dir: boolean; size: number; modified: number }
export interface Opened { name: string; content: string; error?: string }
export interface WindowEntry { id: number; x: number; y: number; w: number; h: number; z: number; max: boolean; topmost: boolean; tool: boolean; layered: boolean; class: string; exe: string }
export interface WindowSnapshot { seq: number; foreground: number; list: WindowEntry[] }
export interface MenuItem { id?: string; label?: string; checked?: boolean; enabled?: boolean; separator?: boolean; items?: MenuItem[] }
export interface TraySpec { tooltip?: string; icon?: string; items?: MenuItem[] }
export interface FileFilter { name: string; extensions: string[] }
/* `owner`: the window the dialog belongs to. API 2 only: API 1 refuses the field. */
export interface SaveSpec { name: string; filters?: FileFilter[]; owner?: string; content: Uint8Array | string }

interface WindowCommon { label: string; page: string; boot?: unknown; title?: string }
export interface OverlaySpec extends WindowCommon, Rect { kind: 'overlay' }
export interface PlainWindowSpec extends WindowCommon {
  kind: 'window'; width?: number; height?: number; minWidth?: number; minHeight?: number; center?: boolean;
  resizable?: boolean; decorations?: boolean; transparent?: boolean; shadow?: boolean; alwaysOnTop?: boolean; skipTaskbar?: boolean; visible?: boolean;
  /* API 2 only: API 1 refuses the spec. */
  focused?: boolean; focusable?: boolean;
}
export type WindowSpec = OverlaySpec | PlainWindowSpec;

export interface Events {
  cursor: Cursor; monitors: Monitor[]; tray: { id: string }; 'tray-click': null; windows: WindowSnapshot; system: System;
  'second-launch': { args: string[] }; 'open-file': Opened; 'data-changed': { path: string };
  /* API 1 sends null. API 2 says how long a page has to call quit_wait, and the most the run waits. */
  quitting: { grace: number; bound: number } | null;
  /* API 2: any window the app opened went, however it closed. */
  'window-closed': { label: string };
}

export interface Shell {
  info(): Promise<Info>;
  quit(): Promise<void>;
  /* API 2. After `quitting`: wait for this page, then it's done. */
  quitWait(): Promise<void>;
  quitReady(): Promise<void>;
  /* API 2. Keep overlays, then always-on-top windows, on top. Off until asked. */
  raise(on: boolean): Promise<void>;
  log(line: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  monitors(): Promise<Monitor[]>;
  windowOpen(spec: WindowSpec): Promise<void>;
  windowClose(label: string): Promise<void>;
  windowShow(label: string): Promise<void>;
  windowHide(label: string): Promise<void>;
  /* On API 2 it restores a minimized window first. On API 1 it does nothing to one. */
  windowFocus(label: string): Promise<void>;
  /* Tauri's own getter, granted by core:window:default, not one of the exe's commands. It fails if
     there's no such window. */
  windowMinimized(label: string): Promise<boolean>;
  /* Tauri's own too, for a custom title bar. */
  windowMinimize(label: string): Promise<void>;
  windowPlace(label: string, r: Rect): Promise<void>;
  windowIcon(label: string, file: string): Promise<void>;
  capture(on: boolean): Promise<void>;
  traySet(spec: TraySpec): Promise<void>;
  dataList(dir: string): Promise<Listed[]>;
  dataRead(path: string): Promise<Uint8Array>;
  dataWrite(path: string, bytes: Uint8Array | string): Promise<void>;
  dataMove(from: string, to: string): Promise<void>;
  dataDelete(path: string): Promise<void>;
  openDataFolder(): Promise<void>;
  saveAs(spec: SaveSpec): Promise<boolean>;
  takeOpened(): Promise<Opened[]>;
  windowsWatch(on: boolean): Promise<void>;
  windowsNow(): Promise<WindowSnapshot>;
  system(): Promise<System>;
  autostart(on?: boolean): Promise<boolean>;
  fileAssoc(on?: boolean): Promise<boolean>;
  on<E extends keyof Events>(event: E, f: (payload: Events[E]) => void): Promise<void>;
  /* Someone asked this window to close from outside the page: Alt+F4 or the taskbar. Tauri's own, not
     one of the exe's commands. Once a page listens, the window stays until the page closes it, so
     `window_close`, which doesn't ask, is then the page's job. */
  onCloseAsked(label: string, f: () => void): Promise<void>;
}

/* the little the exe's script tag gives a page */
export interface Tauri {
  core: { invoke(cmd: string, args?: unknown, options?: { headers: Record<string, string> }): Promise<unknown> };
  event: { listen(name: string, f: (e: { payload: never }) => void, options?: { target: { kind: 'Window'; label: string } }): Promise<unknown> };
}
declare global { interface Window { __TAURI__: Tauri; __BUDDIES__: unknown } }

const CLOSE_ASKED = 'tauri://close-requested';
const bytesOf = (v: Uint8Array | string) => typeof v === 'string' ? new TextEncoder().encode(v) : v;

export function createShell(tauri: Tauri): Shell {
  const call = <T>(cmd: string, args?: object) => tauri.core.invoke(cmd, args) as Promise<T>;
  return {
    info: () => call('shell_info'),
    quit: () => call('quit'),
    quitWait: () => call('quit_wait'),
    quitReady: () => call('quit_ready'),
    raise: on => call('raise', { on }),
    log: line => call('log_line', { line }),
    openExternal: url => call('open_external', { url }),
    monitors: () => call('monitors'),
    windowOpen: spec => call('window_open', { spec }),
    windowClose: label => call('window_close', { label }),
    windowShow: label => call('window_show', { label }),
    windowHide: label => call('window_hide', { label }),
    windowFocus: label => call('window_focus', { label }),
    windowMinimized: label => call('plugin:window|is_minimized', { label }),
    windowMinimize: label => call('plugin:window|minimize', { label }),
    windowPlace: (label, r) => call('window_place', { label, ...r }),
    windowIcon: (label, file) => call('window_icon', { label, file }),
    capture: on => call('capture', { on }),
    traySet: spec => call('tray_set', { spec }),
    dataList: dir => call('data_list', { dir }),
    dataRead: async path => new Uint8Array(await call<ArrayBuffer>('data_read', { path })),
    /* Bytes go as the raw body, so the path goes in a header. */
    dataWrite: (path, bytes) => tauri.core.invoke('data_write', bytesOf(bytes), { headers: { 'x-path': encodeURIComponent(path) } }) as Promise<void>,
    dataMove: (from, to) => call('data_move', { from, to }),
    dataDelete: path => call('data_delete', { path }),
    openDataFolder: () => call('open_data_folder'),
    saveAs: ({ content, ...spec }) => tauri.core.invoke('save_as', bytesOf(content), { headers: { 'x-spec': encodeURIComponent(JSON.stringify(spec)) } }) as Promise<boolean>,
    takeOpened: () => call('take_opened'),
    windowsWatch: on => call('windows_watch', { on }),
    windowsNow: () => call('windows_now'),
    system: () => call('system'),
    autostart: on => call('autostart', { on }),
    fileAssoc: on => call('file_assoc', { on }),
    on: async (event, f) => { await tauri.event.listen(event, e => f(e.payload)); },
    onCloseAsked: async (label, f) => { await tauri.event.listen(CLOSE_ASKED, () => f(), { target: { kind: 'Window', label } }); }
  };
}

export const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
