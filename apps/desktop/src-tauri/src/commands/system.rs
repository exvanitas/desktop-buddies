use crate::platform;
use shell_core::system::System;

#[tauri::command(async)]
pub fn system() -> System {
    platform::system()
}

/// Reads, or sets then reads. Current user only.
#[tauri::command(async)]
pub fn autostart(on: Option<bool>) -> Result<bool, String> {
    if let Some(on) = on {
        platform::set_autostart(on)?;
    }
    platform::autostart()
}

/// Reads, or sets then reads. Current user only.
#[tauri::command(async)]
pub fn file_assoc(on: Option<bool>) -> Result<bool, String> {
    if let Some(on) = on {
        platform::set_file_assoc(on)?;
    }
    platform::file_assoc()
}
