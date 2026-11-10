//! The contract: every command a page can call, one module per group. `api` in `shell_info` goes
//! up when this changes. Anything that blocks is `async`, because plain commands run on the main
//! thread.

mod data;
mod files;
mod system;
mod tracker;
mod tray;
mod windows;

use crate::{platform, shell::{self, Shell}};
use shell_core::{api, nav};
use tauri::{ipc::Invoke, AppHandle, State, WebviewWindow, Wry};

#[tauri::command]
fn shell_info(shell: State<Shell>) -> api::Info {
    api::info(env!("CARGO_PKG_VERSION"), std::env::consts::OS, shell.args.clone(), shell.data.root().display().to_string())
}

#[tauri::command]
fn quit(app: AppHandle) {
    shell::quit(&app, "page");
}

/// After `quitting`: the calling page has something to finish, so the run waits for it.
#[tauri::command]
fn quit_wait(window: WebviewWindow, shell: State<Shell>) -> Result<(), String> {
    shell.quit().wait(window.label())
}

/// The calling page has finished. A window that goes counts as this too.
#[tauri::command]
fn quit_ready(window: WebviewWindow, shell: State<Shell>) {
    shell.quit().ready(window.label());
}

/// Keeps overlays, then visible always-on-top windows, on top: at each foreground change and
/// once a second. Off until asked.
#[tauri::command(async)]
fn raise(on: bool, app: AppHandle) {
    crate::raise::set(&app, on);
}

#[tauri::command]
fn log_line(line: String, shell: State<Shell>) {
    shell.log.line(&line);
}

#[tauri::command(async)]
fn open_external(url: String) -> Result<(), String> {
    if !nav::is_https(&url) {
        return Err(format!("refused a {} link", nav::scheme(&url)));
    }
    platform::open_url(&url)
}

pub fn handler() -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        shell_info,
        quit,
        quit_wait,
        quit_ready,
        raise,
        log_line,
        open_external,
        windows::monitors,
        windows::window_open,
        windows::window_close,
        windows::window_show,
        windows::window_hide,
        windows::window_focus,
        windows::window_place,
        windows::window_icon,
        windows::capture,
        tray::tray_set,
        data::data_list,
        data::data_read,
        data::data_write,
        data::data_move,
        data::data_delete,
        data::open_data_folder,
        files::save_as,
        files::take_opened,
        tracker::windows_watch,
        tracker::windows_now,
        system::system,
        system::autostart,
        system::file_assoc,
    ]
}
