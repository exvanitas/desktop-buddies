//! How a quit waits for pages. The exe tells every page, then gives them `GRACE` to say they have
//! something to finish. It waits for each one that said so to say it's done, or for its window to
//! go, and never longer than `BOUND` from the start. Nothing here needs a page to answer.

use std::collections::HashSet;
use std::time::{Duration, Instant};

pub const GRACE: Duration = Duration::from_millis(250);
pub const BOUND: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct QuitWait {
    started: Option<Instant>,
    waiting: HashSet<String>,
    over: bool,
}

impl QuitWait {
    /// False if a quit had already started.
    pub fn start(&mut self, now: Instant) -> bool {
        if self.started.is_some() {
            return false;
        }
        self.started = Some(now);
        true
    }

    /// A page asks to be waited for. Refused before a quit starts and once it's decided.
    pub fn wait(&mut self, label: &str) -> Result<(), String> {
        if self.started.is_none() {
            return Err("not quitting".into());
        }
        if self.over {
            return Err("too late".into());
        }
        self.waiting.insert(label.to_string());
        Ok(())
    }

    /// A page is done, or its window went.
    pub fn ready(&mut self, label: &str) {
        self.waiting.remove(label);
    }

    /// Whether the run can end now. Once true, it stays true.
    pub fn done(&mut self, now: Instant) -> bool {
        let Some(start) = self.started else { return false };
        let since = now.saturating_duration_since(start);
        self.over = self.over || since >= BOUND || (since >= GRACE && self.waiting.is_empty());
        self.over
    }

    /// How many are still being waited for, for the log.
    pub fn left(&self) -> usize {
        self.waiting.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn with_nobody_waiting_it_ends_after_the_grace() {
        let t = Instant::now();
        let mut q = QuitWait::default();
        assert!(!q.done(t), "not started");
        assert!(q.start(t));
        assert!(!q.start(t + ms(1)), "once");
        assert!(!q.done(t + GRACE - ms(1)));
        assert!(q.done(t + GRACE));
    }

    #[test]
    fn it_waits_for_each_page_that_asked() {
        let t = Instant::now();
        let mut q = QuitWait::default();
        assert!(q.wait("maker").is_err(), "nothing to wait for before a quit");
        q.start(t);
        q.wait("maker-1").unwrap();
        q.wait("maker-2").unwrap();
        assert!(!q.done(t + ms(2000)));
        q.ready("maker-1");
        q.ready("someone-else");
        assert!(!q.done(t + ms(3000)));
        assert_eq!(q.left(), 1);
        q.ready("maker-2");
        assert!(q.done(t + ms(3001)));
    }

    #[test]
    fn a_page_that_never_answers_is_waited_for_only_so_long() {
        let t = Instant::now();
        let mut q = QuitWait::default();
        q.start(t);
        q.wait("hung").unwrap();
        assert!(!q.done(t + BOUND - ms(1)));
        assert!(q.done(t + BOUND));
        assert_eq!(q.left(), 1);
    }

    #[test]
    fn once_decided_nobody_can_hold_it() {
        let t = Instant::now();
        let mut q = QuitWait::default();
        q.start(t);
        assert!(q.done(t + GRACE));
        assert!(q.wait("late").is_err());
        assert!(q.done(t + GRACE));
        assert!(q.done(t), "however it's asked after");
    }

    #[test]
    fn a_page_can_ask_after_the_grace_while_others_hold_it() {
        let t = Instant::now();
        let mut q = QuitWait::default();
        q.start(t);
        q.wait("a").unwrap();
        assert!(!q.done(t + ms(500)));
        q.wait("b").unwrap();
        q.ready("a");
        assert!(!q.done(t + ms(600)));
        q.ready("b");
        assert!(q.done(t + ms(700)));
    }
}
