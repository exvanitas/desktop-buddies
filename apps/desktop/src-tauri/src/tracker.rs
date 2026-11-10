//! The window tracker. A hook marks the list dirty and this thread takes snapshots, so nothing
//! polls while nothing changes, beyond the one-a-second backstop.

use crate::{platform, shell::Shell};
use shell_core::tracker::{Dirty, Pace, Snapshot, Stream};
use std::{
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    thread,
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct Tracker {
    running: Mutex<Option<Arc<AtomicBool>>>,
    dirty: Arc<Dirty>,
    stream: Mutex<Stream>,
    names: Mutex<platform::ExeNames>,
}

impl Tracker {
    pub fn snapshot(&self) -> Snapshot {
        let mut names = self.names.lock().unwrap_or_else(|e| e.into_inner());
        let (foreground, list) = platform::windows_now(&mut names);
        let seq = self.stream.lock().map(|s| s.seq()).unwrap_or(0);
        Snapshot { seq, foreground, list }
    }
}

fn run(app: AppHandle, stop: Arc<AtomicBool>) {
    let shell = app.state::<Shell>();
    let t = &shell.tracker;
    let hook = platform::Hook::start(t.dirty.clone());
    let mut pace = Pace::new();
    while !stop.load(Ordering::SeqCst) {
        let now = Instant::now();
        let wait = pace.wait(now, t.dirty.is_set());
        if !wait.is_zero() {
            t.dirty.sleep(wait);
            continue;
        }
        t.dirty.clear();
        pace.taken(now);
        let snap = t.snapshot();
        if let Some(s) = t.stream.lock().ok().and_then(|mut st| st.next(snap)) {
            let _ = app.emit("windows", s);
        }
    }
    hook.stop();
}

pub fn watch(app: &AppHandle, on: bool) {
    let shell = app.state::<Shell>();
    let t = &shell.tracker;
    let Ok(mut running) = t.running.lock() else { return };
    if let Some(stop) = running.take() {
        stop.store(true, Ordering::SeqCst);
        t.dirty.mark(); // so its thread wakes and sees it
    }
    if on {
        if let Ok(mut s) = t.stream.lock() {
            s.restart();
        }
        let stop = Arc::new(AtomicBool::new(false));
        *running = Some(stop.clone());
        let app = app.clone();
        thread::spawn(move || run(app, stop));
    }
}
