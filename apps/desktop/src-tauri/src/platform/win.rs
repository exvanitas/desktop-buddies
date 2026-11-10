//! Windows. Every OS call the shell makes is in this file.

use super::Filter;
use shell_core::{
    system::{full_screen, user_state, System},
    temp::Swap,
    tracker::{Dirty, Entry},
};
use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    io,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    thread,
};
use windows::{
    core::{HSTRING, PCWSTR, PWSTR},
    Win32::{
        Foundation::{
            CloseHandle, ERROR_CANCELLED, ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, HWND, LPARAM, LRESULT, POINT, RECT, WIN32_ERROR, WPARAM,
        },
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
        Storage::FileSystem::{MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH, REPLACE_FILE_FLAGS},
        System::{
            Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED},
            Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
            Registry::{RegDeleteKeyValueW, RegDeleteTreeW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ},
            Threading::{GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION},
        },
        UI::{
            Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK},
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON},
            Shell::{
                Common::COMDLG_FILTERSPEC, DefSubclassProc, FileSaveDialog, IFileSaveDialog, RemoveWindowSubclass, SHChangeNotify, SHQueryUserNotificationState,
                SetWindowSubclass, ShellExecuteW, SHCNE_ASSOCCHANGED, SHCNF_IDLIST, SIGDN_FILESYSPATH,
            },
            WindowsAndMessaging::*,
        },
    },
};

/* ---------- input and small things ---------- */

/// Physical pixels on the virtual desktop.
pub fn cursor() -> (i32, i32) {
    let mut p = POINT { x: 0, y: 0 };
    let _ = unsafe { GetCursorPos(&mut p) };
    (p.x, p.y)
}

fn key_down(vk: i32) -> bool {
    (unsafe { GetAsyncKeyState(vk) } as u16) & 0x8000 != 0
}

pub fn left_button_down() -> bool {
    key_down(VK_LBUTTON.0 as i32)
}

pub fn right_button_down() -> bool {
    key_down(VK_RBUTTON.0 as i32)
}

pub fn message_box(title: &str, text: &str) {
    unsafe { MessageBoxW(None, &HSTRING::from(text), &HSTRING::from(title), MB_OK | MB_ICONERROR) };
}

fn shell_open(target: &HSTRING) -> Result<(), String> {
    let r = unsafe { ShellExecuteW(None, &HSTRING::from("open"), target, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    // Values above 32 mean it worked.
    if r.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("ShellExecute failed: {}", r.0 as isize))
    }
}

/// The caller has already checked this is `https`.
pub fn open_url(url: &str) -> Result<(), String> {
    shell_open(&HSTRING::from(url))
}

pub fn open_folder(path: &Path) -> Result<(), String> {
    shell_open(&HSTRING::from(path))
}

/* ---------- the save dialog ---------- */

/// This thread's COM apartment. Hold it longer than any interface made in it.
struct Apartment;

impl Apartment {
    fn enter() -> windows::core::Result<Apartment> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok()?;
        Ok(Apartment)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn run_save_dialog(name: &str, filters: &[Filter], owner: Option<HWND>) -> windows::core::Result<Option<PathBuf>> {
    let _apartment = Apartment::enter()?;
    unsafe {
        let d: IFileSaveDialog = CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)?;
        d.SetFileName(&HSTRING::from(name))?;
        let names: Vec<HSTRING> = filters.iter().map(|f| HSTRING::from(&f.name)).collect();
        let specs: Vec<HSTRING> =
            filters.iter().map(|f| HSTRING::from(f.extensions.iter().map(|e| format!("*.{e}")).collect::<Vec<_>>().join(";"))).collect();
        let types: Vec<COMDLG_FILTERSPEC> =
            names.iter().zip(&specs).map(|(n, s)| COMDLG_FILTERSPEC { pszName: PCWSTR(n.as_ptr()), pszSpec: PCWSTR(s.as_ptr()) }).collect();
        if !types.is_empty() {
            d.SetFileTypes(&types)?;
        }
        if let Err(e) = d.Show(owner) {
            if e.code() == ERROR_CANCELLED.to_hresult() {
                return Ok(None);
            }
            return Err(e);
        }
        let raw: PWSTR = d.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
        let path = raw.to_string().map(PathBuf::from);
        CoTaskMemFree(Some(raw.0 as *const _));
        Ok(path.ok())
    }
}

/// Blocks until the user answers. None if they cancelled. It gets a thread of its own, because
/// the dialog needs an apartment that the pool's threads don't have. With an owner, the dialog is
/// modal to that window and stays in front of it.
pub fn save_dialog(name: &str, filters: &[Filter], owner: Option<isize>) -> Result<Option<PathBuf>, String> {
    let (name, filters) = (name.to_string(), filters.to_vec());
    thread::spawn(move || run_save_dialog(&name, &filters, owner.map(hwnd)).map_err(|e| e.to_string())).join().map_err(|_| "the dialog crashed".to_string())?
}

/* ---------- saving a chosen file ---------- */

/// The OS's own replace keeps the old file's permissions, encryption and attributes, and with a
/// backup named the old file is never lost: `shell_core::temp::recover` handles what a failure
/// leaves. A file that wasn't there is moved in, never over one that appeared meanwhile.
pub struct OsSwap;

impl Swap for OsSwap {
    fn replace(&self, target: &Path, temp: &Path, backup: &Path) -> io::Result<()> {
        unsafe { ReplaceFileW(&HSTRING::from(target), &HSTRING::from(temp), &HSTRING::from(backup), REPLACE_FILE_FLAGS(0), None, None) }.map_err(io::Error::from)
    }

    fn place(&self, temp: &Path, target: &Path) -> io::Result<()> {
        unsafe { MoveFileExW(&HSTRING::from(temp), &HSTRING::from(target), MOVEFILE_WRITE_THROUGH) }.map_err(io::Error::from)
    }
}

/* ---------- the session ---------- */

pub fn system() -> System {
    let quns = unsafe { SHQueryUserNotificationState() }.map_or(0, |q| q.0);
    let mut power = SYSTEM_POWER_STATUS::default();
    let known = unsafe { GetSystemPowerStatus(&mut power) }.is_ok();
    System { user_state: user_state(quns), on_battery: known && power.ACLineStatus == 0, saver: known && power.SystemStatusFlag == 1 }
}

/* ---------- the registry, current user only ---------- */

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE: &str = "Desktop Buddies";
const EXT_KEY: &str = "Software\\Classes\\.buddy";
const PROG_ID: &str = "dev.exvanitas.desktop-buddies.buddy";
const PROG_KEY: &str = "Software\\Classes\\dev.exvanitas.desktop-buddies.buddy";

fn exe() -> Result<String, String> {
    std::env::current_exe().map(|p| p.display().to_string()).map_err(|e| e.to_string())
}

fn ok(e: WIN32_ERROR) -> Result<(), String> {
    if e == ERROR_SUCCESS || e == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(format!("registry error {}", e.0))
    }
}

/// The value as text, or None if it isn't there. An empty value name is the key's default.
fn reg_get(key: &str, value: &str) -> Option<String> {
    let (key, value) = (HSTRING::from(key), HSTRING::from(value));
    let mut buf = vec![0u16; 2048];
    let mut size = (buf.len() * 2) as u32;
    let e = unsafe { RegGetValueW(HKEY_CURRENT_USER, &key, &value, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut size)) };
    if e != ERROR_SUCCESS {
        return None;
    }
    let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..end]))
}

fn reg_set(key: &str, value: &str, data: &str) -> Result<(), String> {
    let wide: Vec<u16> = data.encode_utf16().chain([0]).collect();
    let e = unsafe {
        RegSetKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(key), &HSTRING::from(value), REG_SZ.0, Some(wide.as_ptr().cast()), (wide.len() * 2) as u32)
    };
    ok(e)
}

pub fn autostart() -> Result<bool, String> {
    Ok(reg_get(RUN_KEY, RUN_VALUE) == Some(format!("\"{}\"", exe()?)))
}

pub fn set_autostart(on: bool) -> Result<(), String> {
    if on {
        reg_set(RUN_KEY, RUN_VALUE, &format!("\"{}\"", exe()?))
    } else {
        ok(unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN_KEY), &HSTRING::from(RUN_VALUE)) })
    }
}

fn open_command() -> Result<String, String> {
    Ok(format!("\"{}\" \"%1\"", exe()?))
}

pub fn file_assoc() -> Result<bool, String> {
    let command = reg_get(&format!("{PROG_KEY}\\shell\\open\\command"), "");
    Ok(reg_get(EXT_KEY, "").as_deref() == Some(PROG_ID) && command == Some(open_command()?))
}

pub fn set_file_assoc(on: bool) -> Result<(), String> {
    if on {
        reg_set(PROG_KEY, "", "Desktop Buddy")?;
        reg_set(&format!("{PROG_KEY}\\DefaultIcon"), "", &format!("\"{}\",0", exe()?))?;
        reg_set(&format!("{PROG_KEY}\\shell\\open\\command"), "", &open_command()?)?;
        reg_set(EXT_KEY, "", PROG_ID)?;
    } else {
        if reg_get(EXT_KEY, "").as_deref() == Some(PROG_ID) {
            ok(unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(EXT_KEY)) })?;
        }
        ok(unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(PROG_KEY)) })?;
    }
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    Ok(())
}

/* ---------- windows on screen ---------- */

/// Each process's exe name, so a snapshot opens no process twice.
#[derive(Default)]
pub struct ExeNames(HashMap<u32, String>);

impl ExeNames {
    fn get(&mut self, pid: u32) -> String {
        self.0.entry(pid).or_insert_with(|| exe_name(pid)).clone()
    }

    /// Process ids get reused, so names for ones that are gone are dropped.
    fn keep(&mut self, live: &HashSet<u32>) {
        self.0.retain(|pid, _| live.contains(pid));
    }
}

fn exe_name(pid: u32) -> String {
    unsafe {
        let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let got = QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size);
        let _ = CloseHandle(p);
        if got.is_err() {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..size as usize]);
        path.rsplit('\\').next().unwrap_or_default().to_string()
    }
}

fn class_name(h: HWND) -> String {
    let mut buf = [0u16; 256];
    let n = unsafe { GetClassNameW(h, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

fn cloaked(h: HWND) -> bool {
    let mut v = 0u32;
    let got = unsafe { DwmGetWindowAttribute(h, DWMWA_CLOAKED, (&raw mut v).cast(), 4) };
    got.is_ok() && v != 0
}

fn bounds(h: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    unsafe { DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, (&raw mut r).cast(), size_of::<RECT>() as u32) }.ok()?;
    Some(r)
}

unsafe extern "system" fn collect(h: HWND, list: LPARAM) -> windows::core::BOOL {
    let list = unsafe { &mut *(list.0 as *mut Vec<HWND>) };
    list.push(h);
    true.into()
}

/// The foreground window, and what's on screen with the top of the z-order first. Dropped here:
/// invisible, minimized, cloaked, and our own. Anything that could be a taste call is the app's.
pub fn windows_now(names: &mut ExeNames) -> (u64, Vec<Entry>) {
    let mut all: Vec<HWND> = vec![];
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&raw mut all as isize)) };
    let me = std::process::id();
    let (mut list, mut live) = (vec![], HashSet::new());
    for h in all {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        live.insert(pid);
        if pid == me || !unsafe { IsWindowVisible(h) }.as_bool() || unsafe { IsIconic(h) }.as_bool() || cloaked(h) {
            continue;
        }
        let Some(r) = bounds(h) else { continue };
        let ex = unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) } as u32;
        list.push(Entry {
            id: h.0 as u64,
            x: r.left,
            y: r.top,
            w: r.right - r.left,
            h: r.bottom - r.top,
            z: list.len() as u32,
            max: unsafe { IsZoomed(h) }.as_bool(),
            topmost: ex & WS_EX_TOPMOST.0 != 0,
            tool: ex & WS_EX_TOOLWINDOW.0 != 0,
            layered: ex & WS_EX_LAYERED.0 != 0,
            class: class_name(h),
            exe: names.get(pid),
        });
    }
    names.keep(&live);
    (unsafe { GetForegroundWindow() }.0 as u64, list)
}

static DIRTY: OnceLock<Arc<Dirty>> = OnceLock::new();

/* The hook only marks the list dirty. It's on the pump's thread, so it must stay quick. */
unsafe extern "system" fn on_event(_: HWINEVENTHOOK, event: u32, h: HWND, object: i32, child: i32, _: u32, _: u32) {
    if object != OBJID_WINDOW.0 || child != CHILDID_SELF as i32 {
        return;
    }
    // A child window's events are noise. A destroyed window can't be asked, so those all count.
    if event != EVENT_OBJECT_DESTROY && unsafe { GetAncestor(h, GA_ROOT) } != h {
        return;
    }
    if let Some(d) = DIRTY.get() {
        d.mark();
    }
}

/// Listens for every change that can matter, on a thread with a message pump.
pub struct Hook {
    thread: u32,
}

impl Hook {
    pub fn start(dirty: Arc<Dirty>) -> Hook {
        let _ = DIRTY.set(dirty);
        let (tx, rx) = std::sync::mpsc::channel();
        thread::spawn(move || unsafe {
            let ranges = [
                (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
                (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
                (EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE),
                (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
                (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
            ];
            let hooks: Vec<HWINEVENTHOOK> = ranges.iter().map(|(a, b)| SetWinEventHook(*a, *b, None, Some(on_event), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS)).collect();
            let _ = tx.send(GetCurrentThreadId());
            let mut m = MSG::default();
            while GetMessageW(&mut m, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&m);
                DispatchMessageW(&m);
            }
            for h in hooks {
                let _ = UnhookWinEvent(h);
            }
        });
        Hook { thread: rx.recv().unwrap_or(0) }
    }

    pub fn stop(self) {
        let _ = unsafe { PostThreadMessageW(self.thread, WM_QUIT, WPARAM(0), LPARAM(0)) };
    }
}

/* ---------- overlays as tool windows ---------- */

fn hwnd(handle: isize) -> HWND {
    HWND(handle as *mut _)
}

const TOOL_SUBCLASS: usize = 1;

/* tao rewrites the whole extended style whenever one of its own flags changes (showing, hiding,
   click-through), which wipes a bit set by hand. Every such rewrite passes through here first. */
unsafe extern "system" fn keep_tool(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _: usize, _: usize) -> LRESULT {
    if msg == WM_STYLECHANGING && wp.0 as i32 == GWL_EXSTYLE.0 {
        let s = unsafe { &mut *(lp.0 as *mut STYLESTRUCT) };
        s.styleNew = (s.styleNew | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;
    } else if msg == WM_NCDESTROY {
        let _ = unsafe { RemoveWindowSubclass(h, Some(keep_tool), TOOL_SUBCLASS) };
    }
    unsafe { DefSubclassProc(h, msg, wp, lp) }
}

/// Makes a window a tool window for as long as it lives, so Windows' full-screen detection, and
/// Chromium's occlusion tracking in other apps, leave it out. Runs on the window's own thread.
pub fn keep_tool_window(handle: isize) -> Result<(), String> {
    let h = hwnd(handle);
    unsafe {
        if !SetWindowSubclass(h, Some(keep_tool), TOOL_SUBCLASS, 0).as_bool() {
            return Err("couldn't hook the window's styles".into());
        }
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
        SetWindowLongPtrW(h, GWL_EXSTYLE, ((ex | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0) as isize);
        SetWindowPos(h, None, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED).map_err(|e| e.to_string())?;
        if GetWindowLongPtrW(h, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 == 0 {
            return Err("the tool window style didn't hold".into());
        }
    }
    Ok(())
}

/* ---------- keeping ours on top ---------- */

/// Whether something is full screen right now, so nothing is raised over it.
pub fn full_screen_now() -> bool {
    full_screen(unsafe { SHQueryUserNotificationState() }.map_or(0, |q| q.0))
}

/// Puts each window back on top, in order, each above the last. A window that isn't this
/// process's, or isn't showing, is left alone. Never activates, moves or resizes one. Runs on the
/// main thread, which owns our windows, so none can go during the pass.
pub fn raise_windows(handles: &[isize]) {
    let me = std::process::id();
    for h in handles.iter().map(|h| hwnd(*h)) {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        if pid != me || !unsafe { IsWindowVisible(h) }.as_bool() {
            continue;
        }
        let _ = unsafe { SetWindowPos(h, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER) };
    }
}

/// The safety net, for a window that went above ours without taking the foreground.
const RAISE_EVERY_MS: u32 = 1000;
/// Once more after a foreground change, for a window that raises itself after it's activated.
const RAISE_AGAIN_MS: u32 = 150;

thread_local! {
    /// What a trigger calls, on the raiser's own thread.
    static TRIGGER: RefCell<Option<Box<dyn Fn()>>> = const { RefCell::new(None) };
    /// The one-shot timer after a foreground change, if one is set.
    static AGAIN: Cell<usize> = const { Cell::new(0) };
}

fn trigger() {
    TRIGGER.with_borrow(|t| {
        if let Some(t) = t {
            t()
        }
    });
}

unsafe extern "system" fn on_foreground(_: HWINEVENTHOOK, _: u32, _: HWND, _: i32, _: i32, _: u32, _: u32) {
    trigger();
    let again = AGAIN.get();
    if again != 0 {
        let _ = unsafe { KillTimer(None, again) };
    }
    AGAIN.set(unsafe { SetTimer(None, 0, RAISE_AGAIN_MS, None) });
}

/// A thread with a message pump that calls `trigger` at each foreground change (a WinEvent hook,
/// out of context), 150 ms after, and once a second. Stopping it removes the hook and the timers.
pub struct Raiser {
    thread: u32,
}

impl Raiser {
    pub fn start(call: Box<dyn Fn() + Send>) -> Raiser {
        let (tx, rx) = std::sync::mpsc::channel();
        thread::spawn(move || unsafe {
            TRIGGER.set(Some(call));
            let hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_foreground), 0, 0, WINEVENT_OUTOFCONTEXT);
            let every = SetTimer(None, 0, RAISE_EVERY_MS, None);
            let _ = tx.send(GetCurrentThreadId());
            let mut m = MSG::default();
            while GetMessageW(&mut m, None, 0, 0).as_bool() {
                if m.message == WM_TIMER {
                    if m.wParam.0 == AGAIN.get() {
                        let _ = KillTimer(None, m.wParam.0);
                        AGAIN.set(0);
                    }
                    trigger();
                    continue;
                }
                let _ = TranslateMessage(&m);
                DispatchMessageW(&m);
            }
            let again = AGAIN.get();
            if again != 0 {
                let _ = KillTimer(None, again);
            }
            let _ = KillTimer(None, every);
            let _ = UnhookWinEvent(hook);
        });
        Raiser { thread: rx.recv().unwrap_or(0) }
    }

    pub fn stop(self) {
        let _ = unsafe { PostThreadMessageW(self.thread, WM_QUIT, WPARAM(0), LPARAM(0)) };
    }
}
