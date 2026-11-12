use crate::platform;
use shell_core::{package, system::System};

#[tauri::command(async)]
pub fn system() -> System {
    platform::system()
}

/// Reads, or sets then reads. Current user only. In the Store's package it's the package's
/// startup task, which the person can also turn off in Windows Settings.
#[tauri::command(async)]
pub fn autostart(on: Option<bool>) -> Result<bool, String> {
    if platform::packaged() {
        if let Some(on) = on {
            platform::set_startup(on)?;
        }
        return platform::startup();
    }
    if let Some(on) = on {
        platform::set_autostart(on)?;
    }
    platform::autostart()
}

/// Reads, or sets then reads. Current user only. In the Store's package the manifest declares
/// `.buddy`, so it reads true and can't be set.
#[tauri::command(async)]
pub fn file_assoc(on: Option<bool>) -> Result<bool, String> {
    if platform::packaged() {
        return package::file_assoc(on);
    }
    if let Some(on) = on {
        platform::set_file_assoc(on)?;
    }
    platform::file_assoc()
}
