use crate::{shell::Shell, tracker};
use shell_core::tracker::Snapshot;
use tauri::{AppHandle, State};

#[tauri::command(async)]
pub fn windows_watch(on: bool, app: AppHandle) {
    tracker::watch(&app, on);
}

#[tauri::command(async)]
pub fn windows_now(shell: State<Shell>) -> Snapshot {
    shell.tracker.snapshot()
}
