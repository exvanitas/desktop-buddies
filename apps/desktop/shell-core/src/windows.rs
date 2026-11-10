//! `window_open`'s spec: what a page may ask for.

use crate::paths;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Overlay,
    Window,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Spec {
    pub label: String,
    pub kind: Kind,
    pub page: String,
    #[serde(default)]
    pub boot: Value,
    /* an overlay's place, in physical pixels */
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub w: Option<u32>,
    pub h: Option<u32>,
    /* a window's size, in logical pixels */
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    pub center: Option<bool>,
    pub title: Option<String>,
    pub resizable: Option<bool>,
    pub decorations: Option<bool>,
    pub transparent: Option<bool>,
    pub shadow: Option<bool>,
    pub always_on_top: Option<bool>,
    pub skip_taskbar: Option<bool>,
    /// A page can open hidden and show itself once it has drawn.
    pub visible: Option<bool>,
    /// Whether it takes the keyboard when it opens. Windows only: an overlay never does.
    pub focused: Option<bool>,
    /// Whether it can ever take the keyboard. Windows only.
    pub focusable: Option<bool>,
}

/// The hub's window is the exe's own, so no page can open one over it.
pub const HUB: &str = "hub";

fn label_ok(label: &str) -> bool {
    !label.is_empty() && label.len() <= 64 && label != HUB && label.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
}

impl Spec {
    pub fn check(&self) -> Result<(), String> {
        if !label_ok(&self.label) {
            return Err(format!("bad window label {:?}", self.label));
        }
        if self.page.is_empty() || paths::asset(&self.page).is_none() {
            return Err(format!("bad page {:?}", self.page));
        }
        if self.kind == Kind::Overlay && (self.x.is_none() || self.y.is_none() || self.w.is_none() || self.h.is_none()) {
            return Err("an overlay needs x, y, w and h".into());
        }
        if self.kind == Kind::Overlay && (self.focused.is_some() || self.focusable.is_some()) {
            return Err("an overlay never takes the keyboard".into());
        }
        Ok(())
    }
}

/// The script that gives a page its boot value.
pub fn boot_script(boot: &Value) -> String {
    format!("window.__BUDDIES__={boot};")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{from_value, json};

    fn spec(v: Value) -> Result<Spec, String> {
        from_value::<Spec>(v).map_err(|e| e.to_string()).and_then(|s| s.check().map(|_| s))
    }

    #[test]
    fn an_overlay_needs_a_place() {
        assert!(spec(json!({ "label": "o", "kind": "overlay", "page": "overlay.html", "x": 0, "y": 0, "w": 9, "h": 9 })).is_ok());
        assert!(spec(json!({ "label": "o", "kind": "overlay", "page": "overlay.html", "x": 0 })).is_err());
    }

    #[test]
    fn a_window_takes_the_design_fields() {
        let s = spec(json!({
            "label": "manager", "kind": "window", "page": "manager.html", "boot": { "a": 1 },
            "width": 420, "height": 520, "minWidth": 300, "minHeight": 400, "center": true,
            "title": "Buddies", "resizable": false, "decorations": false, "transparent": true,
            "shadow": true, "alwaysOnTop": false, "skipTaskbar": false
        }))
        .unwrap();
        assert_eq!((s.min_width, s.center, s.always_on_top), (Some(300.0), Some(true), Some(false)));
    }

    #[test]
    fn a_window_says_whether_it_takes_the_keyboard() {
        let s = spec(json!({ "label": "menu", "kind": "window", "page": "m.html", "focused": false, "focusable": true })).unwrap();
        assert_eq!((s.focused, s.focusable), (Some(false), Some(true)));
        let s = spec(json!({ "label": "menu", "kind": "window", "page": "m.html" })).unwrap();
        assert_eq!((s.focused, s.focusable), (None, None));
        let o = |extra: Value| {
            let mut v = json!({ "label": "o", "kind": "overlay", "page": "overlay.html", "x": 0, "y": 0, "w": 9, "h": 9 });
            v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            spec(v)
        };
        assert!(o(json!({ "focused": false })).is_err());
        assert!(o(json!({ "focusable": false })).is_err());
        assert!(spec(json!({ "label": "a", "kind": "window", "page": "a.html", "focused": "yes" })).is_err());
    }

    #[test]
    fn labels_and_pages_are_checked() {
        let w = |label: &str, page: &str| spec(json!({ "label": label, "kind": "window", "page": page }));
        assert!(w("ok-1_a", "a.html").is_ok());
        assert!(w("hub", "a.html").is_err(), "the hub is the exe's");
        assert!(w("", "a.html").is_err());
        assert!(w("a b", "a.html").is_err());
        assert!(w("a", "").is_err());
        assert!(w("a", "../a.html").is_err());
        assert!(w("a", "https://example.com").is_err());
    }

    #[test]
    fn unknown_kinds_and_fields_are_refused() {
        assert!(spec(json!({ "label": "a", "kind": "popup", "page": "a.html" })).is_err());
        assert!(spec(json!({ "label": "a", "kind": "window", "page": "a.html", "url": "x" })).is_err());
    }

    #[test]
    fn boot_is_json_in_a_script() {
        assert_eq!(boot_script(&json!({ "a": "</script>\"" })), r#"window.__BUDDIES__={"a":"</script>\""};"#);
        assert_eq!(boot_script(&Value::Null), "window.__BUDDIES__=null;");
    }
}
