//! What the shell does on systems with no real implementation yet: nothing, and says so.

use super::Filter;
use shell_core::{system::System, tracker::{Dirty, Entry}};
use std::{path::{Path, PathBuf}, sync::Arc};

const NO: &str = "not on this system";

pub fn cursor() -> (i32, i32) {
    (-10000, -10000)
}
pub fn left_button_down() -> bool {
    false
}
pub fn right_button_down() -> bool {
    false
}
pub fn message_box(title: &str, text: &str) {
    eprintln!("{title}: {text}");
}
pub fn open_url(_: &str) -> Result<(), String> {
    Err(NO.into())
}
pub fn open_folder(_: &Path) -> Result<(), String> {
    Err(NO.into())
}
pub fn save_dialog(_: &str, _: &[Filter], _: Option<isize>) -> Result<Option<PathBuf>, String> {
    Err(NO.into())
}
pub fn keep_tool_window(_: isize) -> Result<(), String> {
    Ok(())
}
/// Plain renames.
pub struct OsSwap;
impl shell_core::temp::Swap for OsSwap {
    fn replace(&self, target: &Path, temp: &Path, _: &Path) -> std::io::Result<()> {
        std::fs::rename(temp, target)
    }
    fn place(&self, temp: &Path, target: &Path) -> std::io::Result<()> {
        std::fs::rename(temp, target)
    }
}
pub fn full_screen_now() -> bool {
    false
}
pub fn raise_windows(_: &[isize]) {}
pub struct Raiser;
impl Raiser {
    pub fn start(_: Box<dyn Fn() + Send>) -> Raiser {
        Raiser
    }
    pub fn stop(self) {}
}
pub fn system() -> System {
    System { user_state: "normal", on_battery: false, saver: false }
}
pub fn autostart() -> Result<bool, String> {
    Ok(false)
}
pub fn set_autostart(_: bool) -> Result<(), String> {
    Err(NO.into())
}
pub fn packaged() -> bool {
    false
}
pub fn package_family() -> Option<String> {
    None
}
pub fn startup() -> Result<bool, String> {
    Err(NO.into())
}
pub fn set_startup(_: bool) -> Result<(), String> {
    Err(NO.into())
}
pub fn file_assoc() -> Result<bool, String> {
    Ok(false)
}
pub fn set_file_assoc(_: bool) -> Result<(), String> {
    Err(NO.into())
}

#[derive(Default)]
pub struct ExeNames;

pub fn windows_now(_: &mut ExeNames) -> (u64, Vec<Entry>) {
    (0, vec![])
}

pub struct Hook;

impl Hook {
    pub fn start(_: Arc<Dirty>) -> Hook {
        Hook
    }
    pub fn stop(self) {}
}
