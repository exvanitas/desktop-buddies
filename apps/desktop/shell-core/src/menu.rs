//! Tray menu specs. The app writes the menu. The exe only checks it and adds Quit, which must work
//! with the hub dead.

use serde::Deserialize;
use std::collections::HashSet;

pub const QUIT_ID: &str = "shell:quit";
pub const QUIT_LABEL: &str = "Quit";
const MAX_DEPTH: usize = 4;
const MAX_ITEMS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Item {
    pub id: String,
    pub label: String,
    pub checked: Option<bool>,
    pub enabled: Option<bool>,
    pub separator: bool,
    pub items: Option<Vec<Item>>,
}

impl Item {
    pub fn is_enabled(&self) -> bool {
        self.enabled.unwrap_or(true)
    }
}

fn check(items: &[Item], depth: usize, seen: &mut HashSet<String>, count: &mut usize) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err("menu is too deep".into());
    }
    for it in items {
        *count += 1;
        if *count > MAX_ITEMS {
            return Err("menu is too long".into());
        }
        if it.separator {
            continue;
        }
        if it.label.is_empty() {
            return Err("menu item has no label".into());
        }
        if let Some(sub) = &it.items {
            check(sub, depth + 1, seen, count)?;
            continue;
        }
        if it.id.is_empty() {
            return Err(format!("menu item {:?} has no id", it.label));
        }
        if it.id.starts_with("shell:") {
            return Err(format!("menu id {:?} is the shell's", it.id));
        }
        if !seen.insert(it.id.clone()) {
            return Err(format!("menu id {:?} is used twice", it.id));
        }
    }
    Ok(())
}

/// The menu as the tray shows it: the app's items, checked, with Quit always last.
pub fn with_quit(items: Vec<Item>) -> Result<Vec<Item>, String> {
    check(&items, 1, &mut HashSet::new(), &mut 0)?;
    let mut out = items;
    if !out.is_empty() {
        out.push(Item { separator: true, ..Item::default() });
    }
    out.push(Item { id: QUIT_ID.into(), label: QUIT_LABEL.into(), ..Item::default() });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{from_value, json};

    fn items(v: serde_json::Value) -> Vec<Item> {
        from_value(v).unwrap()
    }

    #[test]
    fn quit_is_always_last_and_cannot_be_taken_away() {
        let empty = with_quit(vec![]).unwrap();
        assert_eq!(empty.len(), 1);
        assert_eq!(empty[0].id, QUIT_ID);
        let m = with_quit(items(json!([{ "id": "a", "label": "A" }]))).unwrap();
        assert_eq!(m.iter().map(|i| i.separator).collect::<Vec<_>>(), [false, true, false]);
        assert_eq!(m.last().unwrap().id, QUIT_ID);
    }

    #[test]
    fn an_app_item_cannot_pose_as_quit() {
        assert!(with_quit(items(json!([{ "id": QUIT_ID, "label": "Stay" }]))).is_err());
        assert!(with_quit(items(json!([{ "label": "Sub", "items": [{ "id": "shell:x", "label": "X" }] }]))).is_err());
    }

    #[test]
    fn submenus_and_flags() {
        let m = with_quit(items(json!([
            { "label": "Call", "items": [{ "id": "a", "label": "A", "checked": true }, { "separator": true }, { "id": "b", "label": "B", "enabled": false }] }
        ])))
        .unwrap();
        let sub = m[0].items.as_ref().unwrap();
        assert_eq!(sub[0].checked, Some(true));
        assert!(sub[1].separator);
        assert!(!sub[2].is_enabled());
    }

    #[test]
    fn bad_menus_are_refused() {
        assert!(with_quit(items(json!([{ "id": "a" }]))).is_err(), "no label");
        assert!(with_quit(items(json!([{ "label": "A" }]))).is_err(), "no id");
        assert!(with_quit(items(json!([{ "id": "a", "label": "A" }, { "id": "a", "label": "B" }]))).is_err(), "twice");
        let mut deep = json!({ "id": "x", "label": "X" });
        for _ in 0..5 {
            deep = json!({ "label": "S", "items": [deep] });
        }
        assert!(with_quit(items(json!([deep]))).is_err(), "too deep");
        assert!(from_value::<Vec<Item>>(json!([{ "id": "a", "label": "A", "colour": "red" }])).is_err(), "unknown field");
    }
}
