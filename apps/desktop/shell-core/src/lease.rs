//! The capture lease. A page that dies mid-drag must not leave an invisible window eating every
//! click on its monitor, so taking the mouse only lasts as long as the page keeps asking.

use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const LEASE: Duration = Duration::from_millis(1500);

#[derive(Default)]
pub struct Leases(HashMap<String, Instant>);

impl Leases {
    /// Takes or renews the mouse. True when the window didn't hold it, so it must be told.
    pub fn take(&mut self, label: &str, now: Instant) -> bool {
        self.0.insert(label.to_string(), now + LEASE).is_none()
    }

    /// Gives it back. True when the window held it.
    pub fn give(&mut self, label: &str) -> bool {
        self.0.remove(label).is_some()
    }

    /// The windows whose lease ran out, which no longer hold the mouse.
    pub fn expired(&mut self, now: Instant) -> Vec<String> {
        let gone: Vec<String> = self.0.iter().filter(|(_, until)| **until <= now).map(|(l, _)| l.clone()).collect();
        for l in &gone {
            self.0.remove(l);
        }
        gone
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lease_runs_out_unless_renewed() {
        let t = Instant::now();
        let mut l = Leases::default();
        assert!(l.take("a", t));
        assert!(l.expired(t + LEASE - Duration::from_millis(1)).is_empty());
        assert!(!l.take("a", t + Duration::from_millis(1000)), "a renewal needs no OS call");
        assert!(l.expired(t + LEASE).is_empty());
        assert_eq!(l.expired(t + Duration::from_millis(2500)), ["a"]);
        assert!(l.expired(t + Duration::from_secs(9)).is_empty(), "only once");
        assert!(l.take("a", t + Duration::from_secs(9)), "taking it again needs the OS");
    }

    #[test]
    fn giving_back_ends_it() {
        let t = Instant::now();
        let mut l = Leases::default();
        l.take("a", t);
        assert!(l.give("a"));
        assert!(!l.give("a"));
        assert!(l.expired(t + LEASE).is_empty());
    }

    #[test]
    fn windows_lease_separately() {
        let t = Instant::now();
        let mut l = Leases::default();
        l.take("a", t);
        l.take("b", t + Duration::from_secs(1));
        assert_eq!(l.expired(t + LEASE), ["a"]);
    }
}
