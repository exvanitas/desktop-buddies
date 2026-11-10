//! The window tracker's data and its pacing. The hook only marks the list dirty, a snapshot runs
//! at most every 16 ms while dirty, and once a second anyway in case the hook missed something.

use serde::Serialize;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

pub const MIN_GAP: Duration = Duration::from_millis(16);
pub const BACKSTOP: Duration = Duration::from_secs(1);

/// One window. No title on purpose: titles hold private things like document names, nothing here
/// needs them, and reading one can hang on a stuck app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Entry {
    pub id: u64,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub z: u32,
    pub max: bool,
    pub topmost: bool,
    pub tool: bool,
    pub layered: bool,
    pub class: String,
    pub exe: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Snapshot {
    pub seq: u64,
    pub foreground: u64,
    pub list: Vec<Entry>,
}

impl Snapshot {
    /// Equal but for `seq`, which is only a counter.
    pub fn same(&self, other: &Snapshot) -> bool {
        self.foreground == other.foreground && self.list == other.list
    }
}

/// Keeps the sequence, and says which snapshots are worth sending.
#[derive(Default)]
pub struct Stream {
    last: Option<Snapshot>,
    seq: u64,
}

impl Stream {
    /// The snapshot to send, or None if nothing changed.
    pub fn next(&mut self, mut s: Snapshot) -> Option<Snapshot> {
        if self.last.as_ref().is_some_and(|l| l.same(&s)) {
            return None;
        }
        self.seq += 1;
        s.seq = self.seq;
        self.last = Some(s.clone());
        Some(s)
    }

    /// A new watch sends its first snapshot whatever it holds.
    pub fn restart(&mut self) {
        self.last = None;
    }

    pub fn seq(&self) -> u64 {
        self.seq
    }
}

/// When the tracker's thread should next take a snapshot.
pub struct Pace {
    last: Option<Instant>,
}

impl Pace {
    pub fn new() -> Pace {
        Pace { last: None }
    }

    /// How long to wait from `now`, given whether anything is marked dirty.
    pub fn wait(&self, now: Instant, dirty: bool) -> Duration {
        let gap = if dirty { MIN_GAP } else { BACKSTOP };
        self.last.map_or(Duration::ZERO, |last| (last + gap).saturating_duration_since(now))
    }

    pub fn taken(&mut self, now: Instant) {
        self.last = Some(now);
    }
}

impl Default for Pace {
    fn default() -> Self {
        Pace::new()
    }
}

/// The mark the hook leaves. The tracker's thread sleeps on it.
#[derive(Default)]
pub struct Dirty {
    set: Mutex<bool>,
    woken: Condvar,
}

impl Dirty {
    pub fn mark(&self) {
        if let Ok(mut s) = self.set.lock() {
            *s = true;
            self.woken.notify_all();
        }
    }

    pub fn is_set(&self) -> bool {
        self.set.lock().map(|s| *s).unwrap_or(false)
    }

    pub fn clear(&self) {
        if let Ok(mut s) = self.set.lock() {
            *s = false;
        }
    }

    /// Sleeps for `wait`, or until marked if it isn't yet.
    pub fn sleep(&self, wait: Duration) {
        let Ok(s) = self.set.lock() else { return };
        if *s {
            drop(s);
            std::thread::sleep(wait);
        } else {
            let _ = self.woken.wait_timeout(s, wait);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u64, x: i32) -> Entry {
        Entry { id, x, y: 0, w: 10, h: 10, z: 0, max: false, topmost: false, tool: false, layered: false, class: "c".into(), exe: "e".into() }
    }

    fn snap(list: Vec<Entry>) -> Snapshot {
        Snapshot { seq: 0, foreground: 1, list }
    }

    #[test]
    fn only_changes_go_out_and_each_gets_a_number() {
        let mut s = Stream::default();
        assert_eq!(s.next(snap(vec![entry(1, 0)])).unwrap().seq, 1);
        assert!(s.next(snap(vec![entry(1, 0)])).is_none());
        assert_eq!(s.next(snap(vec![entry(1, 5)])).unwrap().seq, 2);
        assert_eq!(s.seq(), 2);
    }

    #[test]
    fn a_change_of_order_or_foreground_is_a_change() {
        let mut s = Stream::default();
        s.next(snap(vec![entry(1, 0), entry(2, 0)]));
        assert!(s.next(snap(vec![entry(2, 0), entry(1, 0)])).is_some());
        let mut other = snap(vec![entry(2, 0), entry(1, 0)]);
        other.foreground = 2;
        assert!(s.next(other).is_some());
    }

    #[test]
    fn a_restart_sends_the_same_list_again() {
        let mut s = Stream::default();
        s.next(snap(vec![]));
        s.restart();
        assert_eq!(s.next(snap(vec![])).unwrap().seq, 2);
    }

    #[test]
    fn a_snapshot_has_no_title_field() {
        let v = serde_json::to_value(entry(1, 0)).unwrap();
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["class", "exe", "h", "id", "layered", "max", "tool", "topmost", "w", "x", "y", "z"]);
    }

    #[test]
    fn a_mark_wakes_the_sleeper_early() {
        let d = std::sync::Arc::new(Dirty::default());
        let other = d.clone();
        let t = Instant::now();
        let h = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            other.mark();
        });
        d.sleep(Duration::from_secs(5));
        h.join().unwrap();
        assert!(t.elapsed() < Duration::from_secs(4));
        assert!(d.is_set());
        d.clear();
        assert!(!d.is_set());
    }

    #[test]
    fn pace_is_16ms_while_dirty_and_a_second_otherwise() {
        let t = Instant::now();
        let mut p = Pace::new();
        assert_eq!(p.wait(t, true), Duration::ZERO, "the first one goes at once");
        p.taken(t);
        assert_eq!(p.wait(t, true), MIN_GAP);
        assert_eq!(p.wait(t, false), BACKSTOP);
        assert_eq!(p.wait(t + Duration::from_millis(10), true), Duration::from_millis(6));
        assert_eq!(p.wait(t + Duration::from_secs(2), false), Duration::ZERO);
    }
}
