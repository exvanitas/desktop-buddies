//! What `shell_info` says about this exe, so the app can tell which one it's on.

use serde::Serialize;

/// Goes up when the contract changes.
pub const API: u32 = 2;

/// What this exe can do beyond API 1, by name.
pub const CAN: &[&str] = &[
    "raise",
    "tool-overlays",
    "window-focus-spec",
    "window-closed",
    "focus-restores",
    "save-atomic",
    "save-owner",
    "quit-wait",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub api: u32,
    pub version: &'static str,
    pub platform: &'static str,
    pub args: Vec<String>,
    pub data_dir: String,
    pub can: Vec<&'static str>,
}

pub fn info(version: &'static str, platform: &'static str, args: Vec<String>, data_dir: String) -> Info {
    Info { api: API, version, platform, args, data_dir, can: CAN.to_vec() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn info_says_api_2_and_what_it_can_do() {
        let i = info("0.2.0", "windows", vec!["--x".into()], "D".into());
        assert_eq!(
            serde_json::to_value(&i).unwrap(),
            json!({
                "api": 2, "version": "0.2.0", "platform": "windows", "args": ["--x"], "dataDir": "D",
                "can": ["raise", "tool-overlays", "window-focus-spec", "window-closed", "focus-restores", "save-atomic", "save-owner", "quit-wait"]
            })
        );
    }

    #[test]
    fn each_thing_is_named_once() {
        let mut names = CAN.to_vec();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), CAN.len());
    }
}
