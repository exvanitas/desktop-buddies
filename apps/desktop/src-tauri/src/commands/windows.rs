use crate::{pages, shell::Shell, tray::app_image, watch};
use shell_core::{monitors::Monitor, windows::Spec};
use std::time::Instant;
use tauri::{AppHandle, Manager, State, WebviewWindow};

fn by_label(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    app.get_webview_window(label).ok_or_else(|| format!("no window {label}"))
}

fn text<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command(async)]
pub fn monitors(app: AppHandle) -> Result<Vec<Monitor>, String> {
    watch::monitors(&app).map_err(text)
}

/// `async` because building a window from the main thread deadlocks on Windows.
#[tauri::command(async)]
pub fn window_open(app: AppHandle, spec: Spec) -> Result<(), String> {
    pages::open(&app, &spec)
}

#[tauri::command(async)]
pub fn window_close(app: AppHandle, label: String) -> Result<(), String> {
    by_label(&app, &label)?.destroy().map_err(text)
}

#[tauri::command(async)]
pub fn window_show(app: AppHandle, label: String) -> Result<(), String> {
    by_label(&app, &label)?.show().map_err(text)
}

#[tauri::command(async)]
pub fn window_hide(app: AppHandle, label: String) -> Result<(), String> {
    by_label(&app, &label)?.hide().map_err(text)
}

/// Restores a minimized window first, so it really comes forward.
#[tauri::command(async)]
pub fn window_focus(app: AppHandle, label: String) -> Result<(), String> {
    let w = by_label(&app, &label)?;
    if w.is_minimized().map_err(text)? {
        w.unminimize().map_err(text)?;
    }
    w.set_focus().map_err(text)
}

#[tauri::command(async)]
pub fn window_place(app: AppHandle, label: String, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    pages::place(&by_label(&app, &label)?, x, y, w, h).map_err(text)
}

#[tauri::command(async)]
pub fn window_icon(app: AppHandle, label: String, file: String) -> Result<(), String> {
    by_label(&app, &label)?.set_icon(app_image(&app, &file)?).map_err(text)
}

/// The calling overlay takes the mouse. A lease: it lapses unless the page keeps renewing.
#[tauri::command(async)]
pub fn capture(window: WebviewWindow, on: bool, shell: State<Shell>) -> Result<(), String> {
    let label = window.label();
    if !shell.overlays.lock().map_err(text)?.contains(label) {
        return Err(format!("{label} is not an overlay"));
    }
    // Held across the call, so the lease and the window change in one order. It can't deadlock
    // with the main thread: off that thread the call only posts to the event loop and never waits.
    let mut leases = shell.leases.lock().map_err(text)?;
    let change = if on { leases.take(label, Instant::now()) } else { leases.give(label) };
    if change {
        window.set_ignore_cursor_events(!on).map_err(text)?;
    }
    Ok(())
}
