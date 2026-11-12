//! Waiting on an OS call that answers later, never for longer than a limit. A WinRT operation's own
//! blocking wait can hang for good if its completion never signals, so the shell asks for its
//! status instead, and gives up, cancelling it, once the limit has passed.

use std::time::Duration;

/// How long the shell waits for one WinRT operation, and how often it looks.
pub const LIMIT: Duration = Duration::from_secs(5);
pub const STEP: Duration = Duration::from_millis(10);

/// `poll` says Some once the call has finished, with its result, or None while it runs. An error
/// from `poll` ends the wait with that error. Past `limit` by `clock`, `cancel` runs once and the
/// wait fails. `clock` is time since any fixed point.
pub fn within<T>(
    what: &str,
    limit: Duration,
    step: Duration,
    mut poll: impl FnMut() -> Result<Option<T>, String>,
    cancel: impl FnOnce(),
    mut clock: impl FnMut() -> Duration,
    mut sleep: impl FnMut(Duration),
) -> Result<T, String> {
    let start = clock();
    loop {
        if let Some(v) = poll()? {
            return Ok(v);
        }
        if clock().saturating_sub(start) >= limit {
            cancel();
            return Err(format!("{what}: no answer in {} ms", limit.as_millis()));
        }
        sleep(step);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const MS: Duration = Duration::from_millis(1);

    /// A fake clock that only `sleep` moves.
    fn run<T>(limit_ms: u64, poll: impl FnMut() -> Result<Option<T>, String>) -> (Result<T, String>, u32, Duration) {
        let now = Cell::new(Duration::from_secs(100));
        let cancels = Cell::new(0);
        let r = within("task", Duration::from_millis(limit_ms), 10 * MS, poll, || cancels.set(cancels.get() + 1), || now.get(), |d| now.set(now.get() + d));
        (r, cancels.get(), now.get() - Duration::from_secs(100))
    }

    #[test]
    fn an_answer_comes_back_as_soon_as_it_is_there() {
        let mut n = 0;
        let (r, cancels, waited) = run(5000, || {
            n += 1;
            Ok((n == 3).then_some("done"))
        });
        assert_eq!((r, cancels, waited), (Ok("done"), 0, 20 * MS));
    }

    #[test]
    fn a_failure_ends_the_wait_at_once_and_cancels_nothing() {
        let (r, cancels, waited) = run::<u8>(5000, || Err("refused".into()));
        assert_eq!((r, cancels, waited), (Err("refused".into()), 0, Duration::ZERO));
    }

    #[test]
    fn no_answer_cancels_once_and_says_so_when_the_limit_is_up() {
        let (r, cancels, waited) = run::<u8>(50, || Ok(None));
        assert_eq!(r, Err("task: no answer in 50 ms".into()));
        assert_eq!(cancels, 1);
        assert_eq!(waited, 50 * MS, "not a step past the limit");
    }

    #[test]
    fn an_answer_on_the_last_look_still_counts() {
        let mut n = 0;
        let (r, cancels, _) = run(50, || {
            n += 1;
            Ok((n == 6).then_some(7))
        });
        assert_eq!((r, cancels), (Ok(7), 0));
    }
}
