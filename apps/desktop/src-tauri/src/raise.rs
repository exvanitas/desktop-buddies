//! Keeping our windows on top. A trigger only asks for a pass. A pass runs on the main thread,
//! which owns our windows, so none can be destroyed during it. Each pass finds the windows fresh
//! from Tauri's own list, so nothing is held that could outlive a window, and the OS calls check
//! each one is this process's.

use crate::{pages, platform, shell::Shell};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, PoisonError,
};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct Raise {
    on: AtomicBool,
    /// A pass is waiting for the main thread, so a busy one doesn't pile them up.
    queued: AtomicBool,
    raiser: Mutex<Option<platform::Raiser>>,
}

/// On starts the hook and the timers, off removes them.
pub fn set(app: &AppHandle, on: bool) {
    let r = &app.state::<Shell>().raise;
    r.on.store(on, Ordering::SeqCst);
    let mut raiser = r.raiser.lock().unwrap_or_else(PoisonError::into_inner);
    if on && raiser.is_none() {
        let a = app.clone();
        *raiser = Some(platform::Raiser::start(Box::new(move || request(&a))));
    } else if !on {
        if let Some(old) = raiser.take() {
            old.stop();
        }
    }
    drop(raiser);
    if on {
        request(app);
    }
}

fn request(app: &AppHandle) {
    let r = &app.state::<Shell>().raise;
    if !r.on.load(Ordering::SeqCst) || r.queued.swap(true, Ordering::SeqCst) {
        return;
    }
    let a = app.clone();
    if app.run_on_main_thread(move || pass(&a)).is_err() {
        r.queued.store(false, Ordering::SeqCst);
    }
}

/// Overlays, then visible always-on-top windows, unless raising went off meanwhile or something
/// is full screen.
fn pass(app: &AppHandle) {
    let shell = app.state::<Shell>();
    shell.raise.queued.store(false, Ordering::SeqCst);
    if !shell.raise.on.load(Ordering::SeqCst) || platform::full_screen_now() {
        return;
    }
    let overlays = shell.overlays.lock().map(|o| o.clone()).unwrap_or_default();
    let windows: Vec<(isize, bool)> = app
        .webview_windows()
        .into_iter()
        .filter_map(|(label, w)| {
            let overlay = overlays.contains(&label);
            let on_top = overlay || (w.is_always_on_top().unwrap_or(false) && w.is_visible().unwrap_or(false));
            on_top.then(|| (pages::handle(&w), overlay))
        })
        .collect();
    platform::raise_windows(&shell_core::raise::order(&windows));
}
