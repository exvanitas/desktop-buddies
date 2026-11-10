use serde::Deserialize;
use shell_core::menu::Item;
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraySpec {
    tooltip: Option<String>,
    icon: Option<String>,
    #[serde(default)]
    items: Vec<Item>,
}

#[tauri::command(async)]
pub fn tray_set(app: AppHandle, spec: TraySpec) -> Result<(), String> {
    crate::tray::set(&app, spec.tooltip, spec.icon, spec.items)
}
