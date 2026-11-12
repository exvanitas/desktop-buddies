//! The data folder. Paths are checked in `shell_core::data`. Bytes travel as raw IPC bodies, so
//! an image doesn't turn into a JSON array on the way.

use crate::{platform, shell::Shell};
use shell_core::{
    data::{decode_header, Listed},
    package,
};
use std::path::{Path, PathBuf};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Emitter, Manager, State,
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
pub fn open_data_folder(app: AppHandle, shell: State<Shell>) -> Result<(), String> {
    platform::open_folder(&outside(&app, shell.data.root()))
}

/// In the Store's package, Windows keeps what the app writes in roaming AppData in the package's
/// own folder, which Explorer, outside the package, doesn't see at the usual path. So Explorer gets
/// that folder, if it's there. Anywhere else, the folder as it is.
fn outside(app: &AppHandle, root: &Path) -> PathBuf {
    let Some(family) = platform::package_family() else { return root.to_path_buf() };
    let (Ok(roaming), Ok(local)) = (app.path().data_dir(), app.path().local_data_dir()) else { return root.to_path_buf() };
    let cache = local.join("Packages").join(family).join("LocalCache");
    match package::outside(&root.display().to_string(), &roaming.display().to_string(), &cache.display().to_string()) {
        Some(real) if Path::new(&real).is_dir() => real.into(),
        _ => root.to_path_buf(),
    }
}
