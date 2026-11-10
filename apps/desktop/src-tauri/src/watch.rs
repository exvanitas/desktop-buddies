//! The threads that turn OS state into events.

use crate::{platform, shell::{self, Shell}};
use shell_core::{
    monitors::{Monitor, Rect},
    system::System,
};
use std::{thread, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager};

pub fn monitors(app: &AppHandle) -> tauri::Result<Vec<Monitor>> {
    let primary = app.primary_monitor()?;
    Ok(app
        .available_monitors()?
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let (work, pos, size) = (m.work_area(), m.position(), m.size());
            Monitor {
                i,
                name: m.name().cloned().unwrap_or_default(),
                primary: primary.as_ref().is_some_and(|p| p.position() == pos && p.size() == size),
                scale: m.scale_factor(),
                x: work.position.x,
                y: work.position.y,
                w: work.size.width,
                h: work.size.height,
                full: Rect { x: pos.x, y: pos.y, w: size.width, h: size.height },
            }
        })
        .collect())
}

/// Polls the cursor, faster while a button is held, and sends only what changed. Capture leases
/// run out here too, so a dead page can't hold the mouse.
fn cursor(app: AppHandle) {
    let mut last = (i32::MIN, i32::MIN, false, false);
    loop {
        let (x, y) = platform::cursor();
        let (down, right) = (platform::left_button_down(), platform::right_button_down());
        if (x, y, down, right) != last {
            last = (x, y, down, right);
            let _ = app.emit("cursor", serde_json::json!({ "x": x, "y": y, "down": down, "right": right }));
        }
        let shell = app.state::<Shell>();
        // The lock stays held across the call, as in `capture`.
        let gone = shell.leases.lock().map(|mut l| {
            let gone = l.expired(Instant::now());
            for w in gone.iter().filter_map(|label| app.get_webview_window(label)) {
                let _ = w.set_ignore_cursor_events(true);
            }
            gone
        });
        for label in gone.unwrap_or_default() {
            shell.log.line(&format!("capture lease ran out on {label}"));
        }
        thread::sleep(Duration::from_millis(if down { 16 } else { 33 }));
    }
}

/// About once a second: monitors, which also catches a moved taskbar, and the session's state.
fn facts(app: AppHandle) {
    let (mut screens, mut system): (Vec<Monitor>, Option<System>) = (vec![], None);
    loop {
        if let Ok(now) = monitors(&app) {
            if now != screens {
                app.state::<Shell>().log.line(&format!("monitors {}", serde_json::to_string(&now).unwrap_or_default()));
                let _ = app.emit("monitors", &now);
                screens = now;
            }
        }
        let now = platform::system();
        if system.as_ref() != Some(&now) {
            let _ = app.emit("system", &now);
            system = Some(now);
        }
        thread::sleep(Duration::from_secs(1));
    }
}

pub fn start(app: &AppHandle) {
    let (a, b) = (app.clone(), app.clone());
    thread::spawn(move || cursor(a));
    thread::spawn(move || facts(b));
}

pub fn time_limit(app: &AppHandle, seconds: u64) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(seconds));
        shell::quit(&app, "time limit reached");
    });
}
