//! The shell's state, and how a run ends.

use crate::{raise::Raise, tracker::Tracker};
use shell_core::{
    data::DataDir,
    lease::Leases,
    log::Log,
    opened::Inbox,
    quit::{QuitWait, BOUND, GRACE},
};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

pub use shell_core::api::API;

pub struct Shell {
    pub app_dir: PathBuf,
    pub data: DataDir,
    pub webview_dir: PathBuf,
    pub args: Vec<String>,
    pub devtools: bool,
    pub log: Arc<Log>,
    pub leases: Mutex<Leases>,
    pub inbox: Mutex<Inbox>,
    /// The labels of open overlays. Only these may `capture`.
    pub overlays: Mutex<HashSet<String>>,
    pub tracker: Tracker,
    pub raise: Raise,
    quit: Mutex<QuitWait>,
}

impl Shell {
    pub fn new(app_dir: PathBuf, data_root: PathBuf, webview_dir: PathBuf, args: Vec<String>, devtools: bool, log: Arc<Log>) -> Shell {
        Shell {
            app_dir,
            data: DataDir::new(data_root),
            webview_dir,
            args,
            devtools,
            log,
            leases: Mutex::default(),
            inbox: Mutex::default(),
            overlays: Mutex::default(),
            tracker: Tracker::default(),
            raise: Raise::default(),
            quit: Mutex::default(),
        }
    }

    /// Nothing is held across a panic that needs protecting, so a poisoned lock is still good.
    pub fn quit(&self) -> MutexGuard<'_, QuitWait> {
        self.quit.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Tells the pages, waits for those that asked (see `shell_core::quit`), then ends the run.
/// Nothing here depends on a page answering, so it works with the hub dead.
pub fn quit(app: &AppHandle, why: &str) {
    let shell = app.state::<Shell>();
    if !shell.quit().start(Instant::now()) {
        return;
    }
    shell.log.line(&format!("quit: {why}"));
    let _ = app.emit("quitting", serde_json::json!({ "grace": GRACE.as_millis() as u64, "bound": BOUND.as_millis() as u64 }));
    let app = app.clone();
    thread::spawn(move || {
        let shell = app.state::<Shell>();
        while !shell.quit().done(Instant::now()) {
            thread::sleep(Duration::from_millis(20));
        }
        let left = shell.quit().left();
        if left > 0 {
            shell.log.line(&format!("quit: stopped waiting for {left} pages"));
        }
        app.exit(0);
        thread::sleep(Duration::from_secs(3));
        std::process::exit(0);
    });
}
