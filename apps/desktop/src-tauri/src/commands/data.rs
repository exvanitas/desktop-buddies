//! The data folder. Paths are checked in `shell_core::data`. Bytes travel as raw IPC bodies, so
//! an image doesn't turn into a JSON array on the way.

use crate::{platform, shell::Shell};
use shell_core::data::{decode_header, Listed};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Emitter, State,
};

fn changed(app: &AppHandle, path: &str) {
    let _ = app.emit("data-changed", serde_json::json!({ "path": path }));
}

#[tauri::command(async)]
pub fn data_list(dir: String, shell: State<Shell>) -> Result<Vec<Listed>, String> {
    shell.data.list(&dir)
}

#[tauri::command(async)]
pub fn data_read(path: String, shell: State<Shell>) -> Result<Response, String> {
    shell.data.read(&path).map(Response::new)
}

/// The body is the file's bytes, and the `x-path` header says where they go.
#[tauri::command(async)]
pub fn data_write(request: Request, app: AppHandle, shell: State<Shell>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected bytes".into()) };
    let header = request.headers().get("x-path").and_then(|v| v.to_str().ok()).ok_or("no path")?;
    let path = decode_header(header)?;
    shell.data.write(&path, bytes)?;
    changed(&app, &path);
    Ok(())
}

#[tauri::command(async)]
pub fn data_move(from: String, to: String, app: AppHandle, shell: State<Shell>) -> Result<(), String> {
    shell.data.rename(&from, &to)?;
    changed(&app, &from);
    changed(&app, &to);
    Ok(())
}

#[tauri::command(async)]
pub fn data_delete(path: String, app: AppHandle, shell: State<Shell>) -> Result<(), String> {
    shell.data.delete(&path)?;
    changed(&app, &path);
    Ok(())
}

#[tauri::command(async)]
pub fn open_data_folder(shell: State<Shell>) -> Result<(), String> {
    platform::open_folder(shell.data.root())
}
