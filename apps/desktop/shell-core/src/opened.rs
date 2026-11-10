//! Buddy files passed at launch. The exe reads them with a cap and hands them over as they are.
//! Whether one is a buddy is the app's call, like any import.

use crate::data;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Opened {
    pub name: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn read(path: &Path) -> Opened {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let failed = |e: String| Opened { name: name.clone(), content: String::new(), error: Some(e) };
    match data::read_capped(path).map(String::from_utf8) {
        Ok(Ok(content)) => Opened { name, content, error: None },
        Ok(Err(_)) => failed("not text".into()),
        Err(e) => failed(e),
    }
}

/// Holds files until the hub has asked once. A second launch before that would otherwise send
/// an event to a page that isn't listening yet.
#[derive(Default)]
pub struct Inbox {
    waiting: VecDeque<Opened>,
    open: bool,
}

impl Inbox {
    /// Returns the file back when it should go out as an event, because the hub is up.
    pub fn arrive(&mut self, f: Opened) -> Option<Opened> {
        if self.open {
            return Some(f);
        }
        self.waiting.push_back(f);
        None
    }

    /// Everything that was waiting. From here on, files go out as events.
    pub fn take(&mut self) -> Vec<Opened> {
        self.open = true;
        self.waiting.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str) -> Opened {
        Opened { name: name.into(), content: String::new(), error: None }
    }

    #[test]
    fn files_wait_for_the_first_take_and_are_read_once() {
        let mut i = Inbox::default();
        assert_eq!(i.arrive(file("a")), None);
        assert_eq!(i.arrive(file("b")), None);
        assert_eq!(i.take().len(), 2);
        assert!(i.take().is_empty());
        assert_eq!(i.arrive(file("c")), Some(file("c")));
    }

    #[test]
    fn reading_says_what_went_wrong() {
        let d = std::env::temp_dir().join(format!("shell-core-opened-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("ok.buddy"), "{}").unwrap();
        std::fs::write(d.join("bin.buddy"), [0xff, 0xfe, 0]).unwrap();
        let ok = read(&d.join("ok.buddy"));
        assert_eq!((ok.name.as_str(), ok.content.as_str(), ok.error), ("ok.buddy", "{}", None));
        assert_eq!(read(&d.join("bin.buddy")).error.as_deref(), Some("not text"));
        assert!(read(&d.join("gone.buddy")).error.is_some());
        assert_eq!(read(&d).error.as_deref(), Some("not a file"));
        std::fs::File::create(d.join("huge.buddy")).unwrap().set_len(data::MAX_BYTES + 1).unwrap();
        assert_eq!(read(&d.join("huge.buddy")).error.as_deref(), Some("too big"));
        std::fs::remove_dir_all(d).unwrap();
    }
}
