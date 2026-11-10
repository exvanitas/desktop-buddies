use crate::{pages, platform, shell::Shell};
use serde::Deserialize;
use shell_core::{data::decode_header, opened::Opened, temp};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Manager, State, WebviewWindow,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveSpec {
    name: String,
    #[serde(default)]
    filters: Vec<platform::Filter>,
    /// The window the dialog belongs to. With none, the one that asked, if it's showing.
    owner: Option<String>,
}

/// The dialog's owner: the window named if it's open and showing, or else the one that asked if
/// that's showing, or none.
fn owner(app: &AppHandle, asked: &WebviewWindow, label: Option<&str>) -> Option<isize> {
    let showing = |w: &WebviewWindow| w.is_visible().ok().filter(|v| *v).map(|_| pages::handle(w));
    label.and_then(|l| app.get_webview_window(l)).and_then(|w| showing(&w)).or_else(|| showing(asked))
}

/// The body is the file's bytes, and the `x-spec` header holds `{ name, filters, owner? }` as
/// JSON. The file is written beside its target and swapped in (see `shell_core::temp::save`), so a
/// full disk can't leave a cut-off file. Returns whether it saved.
#[tauri::command(async)]
pub fn save_as(request: Request, window: WebviewWindow, app: AppHandle, shell: State<Shell>) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected bytes".into()) };
    let header = request.headers().get("x-spec").and_then(|v| v.to_str().ok()).ok_or("no spec")?;
    let spec: SaveSpec = serde_json::from_str(&decode_header(header)?).map_err(|e| e.to_string())?;
    let owner = owner(&app, &window, spec.owner.as_deref());
    let Some(path) = platform::save_dialog(&spec.name, &spec.filters, owner)? else { return Ok(false) };
    temp::save(&path, bytes, &platform::OsSwap)?;
    shell.log.line("save_as saved a file");
    Ok(true)
}

/// Files passed at launch. Read once: after this, new ones arrive as `open-file`.
#[tauri::command(async)]
pub fn take_opened(shell: State<Shell>) -> Result<Vec<Opened>, String> {
    shell.inbox.lock().map(|mut i| i.take()).map_err(|e| e.to_string())
}
