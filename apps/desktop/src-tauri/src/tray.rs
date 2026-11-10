//! The tray icon. The app writes the menu. Quit is the exe's own, so it works with the hub dead.

use crate::shell::{self, Shell};
use shell_core::menu::{self, Item, QUIT_ID};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

const ID: &str = "main";

fn add(app: &AppHandle, items: &[Item], to: &dyn Fn(&dyn IsMenuItem<Wry>) -> tauri::Result<()>) -> tauri::Result<()> {
    for it in items {
        if it.separator {
            to(&PredefinedMenuItem::separator(app)?)?;
        } else if let Some(sub) = &it.items {
            let s = Submenu::new(app, &it.label, it.is_enabled())?;
            add(app, sub, &|x| s.append(x))?;
            to(&s)?;
        } else if let Some(checked) = it.checked {
            to(&CheckMenuItem::with_id(app, &it.id, &it.label, it.is_enabled(), checked, None::<&str>)?)?;
        } else {
            to(&MenuItem::with_id(app, &it.id, &it.label, it.is_enabled(), None::<&str>)?)?;
        }
    }
    Ok(())
}

fn build_menu(app: &AppHandle, items: &[Item]) -> tauri::Result<Menu<Wry>> {
    let m = Menu::new(app)?;
    add(app, items, &|x| m.append(x))?;
    Ok(m)
}

/// A tray with only Quit, up before any page has run.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let items = menu::with_quit(vec![]).map_err(|e| tauri::Error::Anyhow(std::io::Error::other(e).into()))?;
    let mut tray = TrayIconBuilder::with_id(ID).menu(&build_menu(app, &items)?).tooltip("Desktop Buddies").show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, e| {
        if e.id().as_ref() == QUIT_ID {
            shell::quit(app, "tray");
        } else {
            let _ = app.emit("tray", serde_json::json!({ "id": e.id().as_ref() }));
        }
    })
    .on_tray_icon_event(|tray, e| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            let _ = tray.app_handle().emit("tray-click", ());
        }
    })
    .build(app)?;
    Ok(())
}

/// A PNG from the app folder.
pub fn app_image(app: &AppHandle, file: &str) -> Result<Image<'static>, String> {
    let shell = app.state::<Shell>();
    let path = shell_core::paths::inside(&shell.app_dir, file).filter(|_| !file.is_empty()).ok_or_else(|| format!("refused path {file:?}"))?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Image::from_bytes(&bytes).map(|i| i.to_owned()).map_err(|e| e.to_string())
}

pub fn set(app: &AppHandle, tooltip: Option<String>, icon: Option<String>, items: Vec<Item>) -> Result<(), String> {
    let items = menu::with_quit(items)?;
    let tray = app.tray_by_id(ID).ok_or("no tray")?;
    if let Some(file) = icon {
        tray.set_icon(Some(app_image(app, &file)?)).map_err(|e| e.to_string())?;
    }
    if tooltip.is_some() {
        tray.set_tooltip(tooltip).map_err(|e| e.to_string())?;
    }
    tray.set_menu(Some(build_menu(app, &items).map_err(|e| e.to_string())?)).map_err(|e| e.to_string())
}
