//! What the OS says about the session, in the app's words.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct System {
    pub user_state: &'static str,
    pub on_battery: bool,
    pub saver: bool,
}

/// `SHQueryUserNotificationState`'s QUERY_USER_NOTIFICATION_STATE values.
pub fn user_state(quns: i32) -> &'static str {
    match quns {
        1 => "away",         // QUNS_NOT_PRESENT: locked, screen saver, another user
        2 | 7 => "busy",     // QUNS_BUSY, QUNS_APP
        3 => "fullscreen",   // QUNS_RUNNING_D3D_FULL_SCREEN
        4 => "presentation", // QUNS_PRESENTATION_MODE
        _ => "normal",       // QUNS_ACCEPTS_NOTIFICATIONS, QUNS_QUIET_TIME, and any failure
    }
}

/// Something is full screen: a full-screen app, a D3D one, a presentation or a store app. Keeping
/// buddies on top stops for these, whatever the app asked.
pub fn full_screen(quns: i32) -> bool {
    matches!(quns, 2 | 3 | 4 | 7)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_state_has_a_word() {
        let words: Vec<_> = (0..=8).map(user_state).collect();
        assert_eq!(words, ["normal", "away", "busy", "fullscreen", "presentation", "normal", "normal", "busy", "normal"]);
    }

    #[test]
    fn full_screen_is_busy_d3d_presentation_or_a_store_app() {
        let full: Vec<i32> = (0..=8).filter(|q| full_screen(*q)).collect();
        assert_eq!(full, [2, 3, 4, 7]);
    }

    #[test]
    fn the_app_sees_camel_case() {
        let s = System { user_state: "away", on_battery: true, saver: false };
        assert_eq!(serde_json::to_value(s).unwrap(), serde_json::json!({ "userState": "away", "onBattery": true, "saver": false }));
    }
}
