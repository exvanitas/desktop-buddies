//! The Store build runs as an MSIX package. What changes there is decided here: whether this is
//! one, the startup task that stands in for the Run key, the file type the package declares, and
//! where its data lives.

use std::path::{Path, PathBuf};

/// What `GetCurrentPackageFullName` says when asked with no room for the name: a packaged process
/// gets "insufficient buffer". Anything else, `APPMODEL_ERROR_NO_PACKAGE` (15700) above all, isn't one.
pub const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

pub fn packaged(code: u32) -> bool {
    code == ERROR_INSUFFICIENT_BUFFER
}

/// The startup task's id. The manifest declares it with the same id.
pub const STARTUP_TASK: &str = "DesktopBuddiesStartup";

/// `StartupTaskState`'s values.
pub const DISABLED: i32 = 0;
pub const DISABLED_BY_USER: i32 = 1;
pub const ENABLED: i32 = 2;
pub const DISABLED_BY_POLICY: i32 = 3;
pub const ENABLED_BY_POLICY: i32 = 4;

/// Whether the task runs at sign-in.
pub fn task_on(state: i32) -> bool {
    matches!(state, ENABLED | ENABLED_BY_POLICY)
}

/// What setting the task takes, from where it is.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    Nothing,
    Enable,
    Disable,
}

/// Only the person, in Windows Settings, can undo their own off, and only policy its own.
pub fn startup_step(on: bool, state: i32) -> Result<Step, String> {
    match (on, state) {
        (true, ENABLED | ENABLED_BY_POLICY) | (false, DISABLED | DISABLED_BY_USER | DISABLED_BY_POLICY) => Ok(Step::Nothing),
        (true, DISABLED) => Ok(Step::Enable),
        (false, ENABLED) => Ok(Step::Disable),
        _ => Err(refused(state)),
    }
}

/// What asking Windows to enable it came to.
pub fn enabled(state: i32) -> Result<(), String> {
    if task_on(state) {
        Ok(())
    } else {
        Err(refused(state))
    }
}

fn refused(state: i32) -> String {
    match state {
        DISABLED_BY_USER => "the startup task was turned off in Windows Settings".into(),
        DISABLED_BY_POLICY | ENABLED_BY_POLICY => "the startup task is set by policy".into(),
        DISABLED => "Windows didn't enable the startup task".into(),
        s => format!("the startup task is in an unknown state {s}"),
    }
}

/// `file_assoc` in a package: the manifest declares `.buddy`, so it's always there and Windows
/// handles it. It reads true and can't be set either way.
pub fn file_assoc(on: Option<bool>) -> Result<bool, String> {
    match on {
        None => Ok(true),
        Some(_) => Err("the package declares .buddy files, so Windows handles them".into()),
    }
}

/// The package's own folders, both real ones that Explorer sees too: the data folder, and
/// WebView2's beside it, in `%LOCALAPPDATA%\Packages\<family>\LocalState`, the folder
/// `ApplicationData.Current.LocalFolder` names. Nothing goes in `%APPDATA%`, which Windows would
/// virtualize, merging in whatever the zip build left there.
pub fn roots(local_appdata: &Path, family: &str) -> (PathBuf, PathBuf) {
    let state = local_appdata.join("Packages").join(family).join("LocalState");
    (state.join("data"), state.join("webview"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_insufficient_buffer_is_a_package() {
        assert!(packaged(122));
        for code in [0, 15700, 87, 1] {
            assert!(!packaged(code), "{code}");
        }
    }

    #[test]
    fn on_is_enabled_by_anyone() {
        let on: Vec<i32> = (0..=5).filter(|s| task_on(*s)).collect();
        assert_eq!(on, [ENABLED, ENABLED_BY_POLICY]);
    }

    #[test]
    fn turning_on_enables_only_a_plain_disabled_task() {
        assert_eq!(startup_step(true, DISABLED), Ok(Step::Enable));
        assert_eq!(startup_step(true, ENABLED), Ok(Step::Nothing));
        assert_eq!(startup_step(true, ENABLED_BY_POLICY), Ok(Step::Nothing));
        assert_eq!(startup_step(true, DISABLED_BY_USER), Err("the startup task was turned off in Windows Settings".into()));
        assert_eq!(startup_step(true, DISABLED_BY_POLICY), Err("the startup task is set by policy".into()));
        assert!(startup_step(true, 9).unwrap_err().contains("unknown state 9"));
    }

    #[test]
    fn turning_off_disables_only_what_the_app_may() {
        assert_eq!(startup_step(false, ENABLED), Ok(Step::Disable));
        for s in [DISABLED, DISABLED_BY_USER, DISABLED_BY_POLICY] {
            assert_eq!(startup_step(false, s), Ok(Step::Nothing), "{s}");
        }
        assert_eq!(startup_step(false, ENABLED_BY_POLICY), Err("the startup task is set by policy".into()));
        assert!(startup_step(false, -1).is_err());
    }

    #[test]
    fn an_enable_counts_only_once_it_runs() {
        assert_eq!(enabled(ENABLED), Ok(()));
        assert_eq!(enabled(ENABLED_BY_POLICY), Ok(()));
        assert_eq!(enabled(DISABLED_BY_USER), Err("the startup task was turned off in Windows Settings".into()));
        assert_eq!(enabled(DISABLED), Err("Windows didn't enable the startup task".into()));
        assert!(enabled(DISABLED_BY_POLICY).is_err());
    }

    #[test]
    fn the_file_type_is_declared_and_fixed() {
        assert_eq!(file_assoc(None), Ok(true));
        assert!(file_assoc(Some(true)).is_err());
        assert!(file_assoc(Some(false)).is_err());
    }

    #[test]
    fn the_folders_are_the_packages_own_local_state() {
        let (data, webview) = roots(Path::new("L"), "Fam_abc");
        assert_eq!(data, Path::new("L").join("Packages").join("Fam_abc").join("LocalState").join("data"));
        assert_eq!(webview, Path::new("L").join("Packages").join("Fam_abc").join("LocalState").join("webview"));
    }
}
