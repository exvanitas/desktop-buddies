//! Every window comes through here, because WebView2 windows sharing a data folder must share
//! the same browser arguments.

use crate::{platform, shell::Shell};
use serde_json::Value;
use shell_core::{
    nav::{self, Nav},
    windows::{boot_script, Kind, Spec, HUB},
};
use std::{sync::mpsc, time::Duration};
use tauri::{
    webview::NewWindowResponse, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry,
};

/// Tauri's defaults, which a custom value replaces, plus sound with no click first. Sound effects
/// can't be added later without a new exe.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

fn decide(url: &Url) -> Nav {
    nav::decide(url.scheme(), url.host_str(), url.port())
}

fn page<'a>(app: &'a AppHandle, label: &str, file: &str, boot: &Value) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    let shell = app.state::<Shell>();
    let (nav_app, new_app) = (app.clone(), app.clone());
    let leave = move |app: &AppHandle, url: &Url| {
        let log = &app.state::<Shell>().log;
        match decide(url) {
            Nav::External => {
                log.line("navigation sent to the browser: an https link");
                if let Err(e) = platform::open_url(url.as_str()) {
                    log.line(&format!("open_external failed: {e}"));
                }
            }
            _ => log.line(&format!("navigation refused: a {} link", url.scheme())),
        }
    };
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(file.into()))
        .additional_browser_args(BROWSER_ARGS)
        .data_directory(shell.webview_dir.clone())
        .devtools(shell.devtools)
        .initialization_script(boot_script(boot))
        // Pages take drops themselves, through the web's own drag events.
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            let stay = decide(url) == Nav::Stay;
            if !stay {
                leave(&nav_app, url);
            }
            stay
        })
        .on_new_window(move |url, _| {
            leave(&new_app, &url);
            NewWindowResponse::Deny
        })
}

/// The one page the exe opens by itself. It stays open and hidden for the whole run.
pub fn open_hub(app: &AppHandle) -> tauri::Result<()> {
    page(app, HUB, "hub.html", &Value::Null).title("Desktop Buddies").visible(false).focused(false).focusable(false).skip_taskbar(true).build()?;
    Ok(())
}

/// The native handle, as a number. Zero where there is none.
pub fn handle(w: &WebviewWindow) -> isize {
    #[cfg(windows)]
    return w.hwnd().map_or(0, |h| h.0 as isize);
    #[cfg(not(windows))]
    {
        let _ = w;
        0
    }
}

/// A window went, however it closed. Called for every window from the app's own event handler,
/// on the main thread, from the moment it's made.
pub fn forget(app: &AppHandle, label: &str) {
    let shell = app.state::<Shell>();
    let _ = shell.leases.lock().map(|mut l| l.give(label));
    let _ = shell.overlays.lock().map(|mut o| o.remove(label));
    shell.quit().ready(label);
    let _ = app.emit("window-closed", serde_json::json!({ "label": label }));
}

/// Runs on the window's own thread and waits for it, as subclassing a window must.
fn tool_window(w: &WebviewWindow) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let h = handle(w);
    w.run_on_main_thread(move || {
        let _ = tx.send(platform::keep_tool_window(h));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "the window's thread didn't answer".to_string())?
}

fn open_overlay(app: &AppHandle, spec: &Spec) -> tauri::Result<WebviewWindow> {
    let w = page(app, &spec.label, &spec.page, &spec.boot)
        .title(spec.title.as_deref().unwrap_or("Desktop Buddies"))
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        // Clicking a buddy must not take focus from what the user is typing in. Setting
        // WS_EX_NOACTIVATE by hand doesn't last: tao wipes it when it rebuilds the styles.
        .focusable(false)
        .visible(false)
        .build()?;
    // A tool window, kept so through tao's rebuilds. Failing that, the overlay still works.
    if let Err(e) = tool_window(&w) {
        app.state::<Shell>().log.line(&format!("overlay {} isn't a tool window: {e}", spec.label));
    }
    place(&w, spec.x.unwrap_or(0), spec.y.unwrap_or(0), spec.w.unwrap_or(1), spec.h.unwrap_or(1))?;
    w.set_ignore_cursor_events(true)?;
    w.show()?;
    Ok(w)
}

fn open_window(app: &AppHandle, spec: &Spec) -> tauri::Result<WebviewWindow> {
    let mut b = page(app, &spec.label, &spec.page, &spec.boot)
        .title(spec.title.as_deref().unwrap_or("Desktop Buddies"))
        .resizable(spec.resizable.unwrap_or(true))
        .decorations(spec.decorations.unwrap_or(true))
        .transparent(spec.transparent.unwrap_or(false))
        .shadow(spec.shadow.unwrap_or(true))
        .always_on_top(spec.always_on_top.unwrap_or(false))
        .skip_taskbar(spec.skip_taskbar.unwrap_or(false))
        .visible(spec.visible.unwrap_or(true));
    if let Some(f) = spec.focused {
        b = b.focused(f);
    }
    if let Some(f) = spec.focusable {
        b = b.focusable(f);
    }
    if let (Some(w), Some(h)) = (spec.width, spec.height) {
        b = b.inner_size(w, h);
    }
    if let (Some(w), Some(h)) = (spec.min_width, spec.min_height) {
        b = b.min_inner_size(w, h);
    }
    if spec.center.unwrap_or(false) {
        b = b.center();
    }
    b.build()
}

pub fn open(app: &AppHandle, spec: &Spec) -> Result<(), String> {
    spec.check()?;
    if app.get_webview_window(&spec.label).is_some() {
        return Err(format!("window {} is already open", spec.label));
    }
    let overlays = &app.state::<Shell>().overlays;
    // Known as an overlay before it exists, so a window that goes at once is forgotten in order.
    let mark = |on: bool| {
        if let Ok(mut o) = overlays.lock() {
            if on { o.insert(spec.label.clone()) } else { o.remove(&spec.label) };
        }
    };
    if spec.kind == Kind::Overlay {
        mark(true);
    }
    let opened = match spec.kind {
        Kind::Overlay => open_overlay(app, spec),
        Kind::Window => open_window(app, spec),
    };
    if opened.is_err() && spec.kind == Kind::Overlay {
        mark(false);
    }
    opened.map(|_| ()).map_err(|e| e.to_string())
}

/// Position first: moving to a monitor with other scaling changes what a size means.
pub fn place(w: &WebviewWindow, x: i32, y: i32, width: u32, height: u32) -> tauri::Result<()> {
    w.set_position(PhysicalPosition::new(x, y))?;
    w.set_size(PhysicalSize::new(width, height))
}
