//! Writes that land whole. The new bytes go to a temp file beside the target, so the move stays
//! on one volume. A temp file is only ever made new, under a name nobody can guess: a name that's
//! already there, or a link, is never opened. A failure removes only the temp file this write made.

use std::collections::hash_map::RandomState;
use std::fs::{self, OpenOptions};
use std::hash::BuildHasher;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Temp files start with this, and data listings never show them.
pub const PREFIX: &str = ".~";

static NEXT: AtomicU64 = AtomicU64::new(0);

/// `.~` and 16 hex digits from the process's random hashing keys.
pub fn random_name() -> String {
    format!("{PREFIX}{:016x}", RandomState::new().hash_one(NEXT.fetch_add(1, Ordering::Relaxed)))
}

/// Makes a new file in `dir` holding `bytes`, flushed, under the first of `names` that isn't
/// taken. Never opens one that is.
pub fn write_temp_named(dir: &Path, bytes: &[u8], names: impl IntoIterator<Item = String>) -> io::Result<PathBuf> {
    for name in names {
        let p = dir.join(name);
        let mut f = match OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        };
        let wrote = f.write_all(bytes).and_then(|_| f.sync_all());
        drop(f);
        if let Err(e) = wrote {
            let _ = fs::remove_file(&p);
            return Err(e);
        }
        return Ok(p);
    }
    Err(io::Error::other("no free name for a temp file"))
}

pub fn write_temp(dir: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    write_temp_named(dir, bytes, std::iter::repeat_with(random_name).take(8))
}

/// For the data folder: a temp file, then a rename over the target.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = target.parent().ok_or_else(|| io::Error::other("no folder"))?;
    let temp = write_temp(dir, bytes)?;
    fs::rename(&temp, target).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

/// How a finished temp file takes its place. The OS's own on Windows.
pub trait Swap {
    /// Puts `temp` in place of `target`, which is there, keeping what the target is: its
    /// permissions, encryption and attributes. The old file goes to `backup`, a name that isn't
    /// taken. On a failure the files may be left part way (see `recover`).
    fn replace(&self, target: &Path, temp: &Path, backup: &Path) -> io::Result<()>;
    /// Moves `temp` to `target`, which isn't there. Fails rather than overwrite.
    fn place(&self, temp: &Path, target: &Path) -> io::Result<()>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    New,
    File,
}

/// What's at a path a save would write. A link is refused, never written through.
pub fn target(path: &Path) -> Result<Target, String> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => Err("refused: there's a link at that name, and a save never writes through one".into()),
        Ok(m) if m.is_dir() => Err("refused: there's a folder at that name".into()),
        Ok(_) => Ok(Target::File),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Target::New),
        Err(e) => Err(e.to_string()),
    }
}

/// A file the person chose: a temp file beside it, then the OS's replace with a backup, or a move
/// if there was nothing there. Whatever fails, the chosen name ends up holding the old file or the
/// new one, never neither, unless no move at all works there: then both are kept beside it and the
/// error names them.
pub fn save(path: &Path, bytes: &[u8], swap: &dyn Swap) -> Result<(), String> {
    let was = target(path)?;
    let dir = path.parent().ok_or("no folder")?;
    let temp = write_temp(dir, bytes).map_err(|e| e.to_string())?;
    if was == Target::New {
        return swap.place(&temp, path).map_err(|e| {
            let _ = fs::remove_file(&temp);
            e.to_string()
        });
    }
    // The backup's name is proven free the same exclusive way, then freed for the OS to take.
    let backup = match write_temp(dir, b"") {
        Ok(b) => b,
        Err(e) => {
            let _ = fs::remove_file(&temp);
            return Err(e.to_string());
        }
    };
    let _ = fs::remove_file(&backup);
    match swap.replace(path, &temp, &backup) {
        Ok(()) => {
            // The name holds the new file, so the old one can go.
            let _ = fs::remove_file(&backup);
            Ok(())
        }
        Err(e) => recover(path, &temp, &backup, &e.to_string(), swap),
    }
}

fn here(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

fn name_of(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// After a failed replace, from what's on disk rather than the error. With a backup named,
/// Windows documents three states:
/// - 1175, 1176 and any other error: both files keep their names, so the name still holds the old
///   file. The temp file goes.
/// - 1177: the old file is at the backup's name and the new one still at the temp's, with nothing
///   at the chosen name. The new one is moved in, or else the old one is moved back.
/// - Should the new file be at the name after all, the save is done.
pub fn recover(path: &Path, temp: &Path, backup: &Path, why: &str, swap: &dyn Swap) -> Result<(), String> {
    match (here(path), here(temp)) {
        (true, true) => {
            // The new file never moved, so the name holds the old one: the extra copies can go.
            let _ = fs::remove_file(temp);
            let _ = fs::remove_file(backup);
            Err(why.to_string())
        }
        (true, false) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        (false, new_kept) => {
            if new_kept && swap.place(temp, path).is_ok() {
                let _ = fs::remove_file(backup);
                return Ok(());
            }
            if here(backup) && swap.place(backup, path).is_ok() {
                let _ = fs::remove_file(temp);
                return Err(format!("{why}: the old file is back"));
            }
            Err(format!("{why}: neither file could be put at its name, so both are kept beside it: the old one as {}, the new one as {}", name_of(backup), name_of(temp)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("shell-core-temp-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn names(d: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    /// What a failed replace leaves, as Windows documents it with a backup named.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    enum Fail {
        /// 1175, 1176 or any other error: both keep their names.
        Untouched,
        /// 1177: the old file at the backup's name, the new one still at the temp's.
        OldAtBackup,
        /// An error after the new file went in.
        AfterAll,
    }

    /// Plain renames, with failures on demand, and a log of what was asked.
    #[derive(Default)]
    struct Fake {
        calls: RefCell<Vec<&'static str>>,
        fail: Option<Fail>,
        /// moves from these names fail
        place_fails: RefCell<Vec<PathBuf>>,
    }
    impl Swap for Fake {
        fn replace(&self, target: &Path, temp: &Path, backup: &Path) -> io::Result<()> {
            self.calls.borrow_mut().push("replace");
            assert!(!backup.exists(), "the backup's name is free");
            let failed = || Err(io::Error::other("replace failed"));
            match self.fail {
                Some(Fail::Untouched) => return failed(),
                Some(Fail::OldAtBackup) => {
                    fs::rename(target, backup)?;
                    return failed();
                }
                _ => {}
            }
            fs::rename(target, backup)?;
            fs::rename(temp, target)?;
            if self.fail == Some(Fail::AfterAll) {
                return failed();
            }
            Ok(())
        }
        fn place(&self, from: &Path, to: &Path) -> io::Result<()> {
            self.calls.borrow_mut().push("place");
            if self.place_fails.borrow().iter().any(|p| p == from) {
                return Err(io::Error::other("place failed"));
            }
            if to.exists() {
                return Err(io::Error::from(io::ErrorKind::AlreadyExists));
            }
            fs::rename(from, to)
        }
    }
    /// A Fake whose moves fail from every `.~` name, so no recovery move works.
    fn stuck(fail: Fail) -> Fake {
        Fake { fail: Some(fail), ..Fake::default() }
    }
    fn block_moves_from(f: &Fake, d: &Path, which: &str) {
        for n in names(d).into_iter().filter(|n| n.starts_with(PREFIX)) {
            let content = fs::read(d.join(&n)).unwrap();
            if (which == "new" && content == b"new") || (which == "old" && content == b"old") {
                f.place_fails.borrow_mut().push(d.join(n));
            }
        }
    }
    /// A Swap that blocks a recovery move once the replace has run, by what the file holds.
    struct Blocking<'a> {
        inner: &'a Fake,
        dir: PathBuf,
        block: &'static [&'static str],
    }
    impl Swap for Blocking<'_> {
        fn replace(&self, target: &Path, temp: &Path, backup: &Path) -> io::Result<()> {
            let r = self.inner.replace(target, temp, backup);
            for w in self.block {
                block_moves_from(self.inner, &self.dir, w);
            }
            r
        }
        fn place(&self, from: &Path, to: &Path) -> io::Result<()> {
            self.inner.place(from, to)
        }
    }

    #[test]
    fn temp_names_are_hidden_and_unguessable() {
        let (a, b) = (random_name(), random_name());
        assert_ne!(a, b);
        assert!(a.starts_with(PREFIX) && a.len() == 18 && a[2..].bytes().all(|c| c.is_ascii_hexdigit()), "{a}");
    }

    #[test]
    fn temp_names_are_not_a_count() {
        let n: Vec<u64> = (0..64).map(|_| u64::from_str_radix(&random_name()[2..], 16).unwrap()).collect();
        assert!(n.windows(2).all(|w| w[1] != w[0].wrapping_add(1)), "{n:?}");
        assert!(n.iter().filter(|v| **v > 1 << 48).count() > 32, "they use the whole range: {n:?}");
    }

    #[test]
    fn a_temp_never_opens_a_name_that_is_taken() {
        let d = temp("exclusive");
        fs::write(d.join("taken"), "keep me").unwrap();
        let p = write_temp_named(&d, b"new", ["taken".to_string(), "free".to_string()]).unwrap();
        assert_eq!(p, d.join("free"));
        assert_eq!(fs::read(d.join("taken")).unwrap(), b"keep me", "never truncated");
        assert!(write_temp_named(&d, b"x", ["taken".to_string()]).is_err(), "and never reused");
        assert_eq!(fs::read(d.join("taken")).unwrap(), b"keep me");
        fs::remove_dir_all(d).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_temp_never_follows_a_link() {
        let d = temp("link");
        fs::write(d.join("important"), "keep me").unwrap();
        std::os::unix::fs::symlink(d.join("important"), d.join("bait")).unwrap();
        std::os::unix::fs::symlink(d.join("nowhere"), d.join("dangling")).unwrap();
        let p = write_temp_named(&d, b"new", ["bait".to_string(), "dangling".to_string(), "free".to_string()]).unwrap();
        assert_eq!(p, d.join("free"));
        assert_eq!(fs::read(d.join("important")).unwrap(), b"keep me");
        assert!(!d.join("nowhere").exists(), "a dangling link isn't made real");
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn an_atomic_write_replaces_whole_and_leaves_nothing() {
        let d = temp("atomic");
        let f = d.join("a.json");
        write_atomic(&f, b"old").unwrap();
        write_atomic(&f, b"new").unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"new");
        assert_eq!(names(&d), ["a.json"]);
        fs::create_dir(d.join("dir")).unwrap();
        fs::write(d.join("dir/x"), "x").unwrap();
        assert!(write_atomic(&d.join("dir"), b"over a folder").is_err());
        assert_eq!(names(&d), ["a.json", "dir"], "no temp left");
        assert!(write_atomic(&d.join("missing/a"), b"x").is_err());
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn a_save_over_a_file_replaces_it_and_a_new_one_is_placed() {
        let d = temp("save");
        let f = Fake::default();
        save(&d.join("a.buddy"), b"one", &f).unwrap();
        save(&d.join("a.buddy"), b"two", &f).unwrap();
        assert_eq!(*f.calls.borrow(), ["place", "replace"]);
        assert_eq!(fs::read(d.join("a.buddy")).unwrap(), b"two");
        assert_eq!(names(&d), ["a.buddy"], "the backup goes once the new file is in");
        fs::remove_dir_all(d).unwrap();
    }

    /// A save over "old" that fails as `fail`, with recovery moves blocked from the files that hold
    /// `block`. What the chosen name holds, and every name left in the folder.
    fn over_old(name: &str, fail: Fail, block: &'static [&'static str]) -> (Result<(), String>, Option<Vec<u8>>, Vec<String>, PathBuf) {
        let d = temp(name);
        fs::write(d.join("a.buddy"), "old").unwrap();
        fs::write(d.join(".~other"), "not ours").unwrap();
        let f = stuck(fail);
        let r = save(&d.join("a.buddy"), b"new", &Blocking { inner: &f, dir: d.clone(), block });
        let at = fs::read(d.join("a.buddy")).ok();
        let left = names(&d);
        (r, at, left, d)
    }

    #[test]
    fn replace_failed_with_nothing_moved_1175_1176_keeps_the_old_file() {
        let (r, at, left, d) = over_old("r1175", Fail::Untouched, &[]);
        assert_eq!(r, Err("replace failed".into()));
        assert_eq!(at.as_deref(), Some(&b"old"[..]));
        assert_eq!(left, [".~other", "a.buddy"], "only this save's temp went");
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn replace_1177_moves_the_new_file_in() {
        let (r, at, left, d) = over_old("r1177", Fail::OldAtBackup, &[]);
        assert_eq!(r, Ok(()));
        assert_eq!(at.as_deref(), Some(&b"new"[..]));
        assert_eq!(left, [".~other", "a.buddy"], "the backup goes once the new file is in");
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn replace_1177_with_the_new_file_stuck_puts_the_old_one_back() {
        let (r, at, left, d) = over_old("r1177-back", Fail::OldAtBackup, &["new"]);
        assert!(r.unwrap_err().contains("the old file is back"));
        assert_eq!(at.as_deref(), Some(&b"old"[..]));
        assert_eq!(left, [".~other", "a.buddy"]);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn replace_1177_with_nothing_movable_keeps_both_and_names_them() {
        let (r, at, left, d) = over_old("r1177-stuck", Fail::OldAtBackup, &["new", "old"]);
        let e = r.unwrap_err();
        assert!(e.contains("both are kept"), "{e}");
        assert_eq!(at, None);
        let kept: Vec<Vec<u8>> = left.iter().filter(|n| *n != ".~other").map(|n| fs::read(d.join(n)).unwrap()).collect();
        assert!(kept.contains(&b"old".to_vec()) && kept.contains(&b"new".to_vec()), "{left:?}");
        for n in left.iter().filter(|n| *n != ".~other") {
            assert!(e.contains(n.as_str()), "{e} names {n}");
        }
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn an_error_after_the_new_file_went_in_is_a_save() {
        let (r, at, left, d) = over_old("r-after", Fail::AfterAll, &[]);
        assert_eq!(r, Ok(()));
        assert_eq!(at.as_deref(), Some(&b"new"[..]));
        assert_eq!(left, [".~other", "a.buddy"]);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn whatever_fails_the_name_holds_old_or_new_unless_nothing_moves() {
        for fail in [Fail::Untouched, Fail::OldAtBackup, Fail::AfterAll] {
            for block in [&[][..], &["new"][..], &["old"][..]] as [&'static [&'static str]; 3] {
                let (_, at, _, d) = over_old("rule", fail, block);
                assert!(matches!(at.as_deref(), Some(b"old") | Some(b"new")), "{fail:?} {block:?}: {at:?}");
                fs::remove_dir_all(d).unwrap();
            }
        }
    }

    #[test]
    fn a_failed_place_leaves_nothing() {
        let d = temp("place-fail");
        struct AllFail;
        impl Swap for AllFail {
            fn replace(&self, _: &Path, _: &Path, _: &Path) -> io::Result<()> {
                Err(io::Error::other("no"))
            }
            fn place(&self, _: &Path, _: &Path) -> io::Result<()> {
                Err(io::Error::other("no"))
            }
        }
        assert!(save(&d.join("a.buddy"), b"new", &AllFail).is_err());
        assert!(names(&d).is_empty());
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn a_folder_at_the_name_is_refused_with_nothing_written() {
        let d = temp("save-dir");
        fs::create_dir(d.join("a.buddy")).unwrap();
        let f = Fake::default();
        assert!(save(&d.join("a.buddy"), b"new", &f).unwrap_err().contains("folder"));
        assert!(f.calls.borrow().is_empty());
        assert_eq!(names(&d), ["a.buddy"]);
        fs::remove_dir_all(d).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_at_the_name_is_refused_never_written_through() {
        let d = temp("save-link");
        fs::write(d.join("important"), "keep me").unwrap();
        std::os::unix::fs::symlink(d.join("important"), d.join("a.buddy")).unwrap();
        std::os::unix::fs::symlink(d.join("nowhere"), d.join("b.buddy")).unwrap();
        let f = Fake::default();
        assert!(save(&d.join("a.buddy"), b"new", &f).unwrap_err().contains("link"));
        assert!(save(&d.join("b.buddy"), b"new", &f).unwrap_err().contains("link"), "a dangling one too");
        assert!(f.calls.borrow().is_empty());
        assert_eq!(fs::read(d.join("important")).unwrap(), b"keep me");
        assert_eq!(names(&d), ["a.buddy", "b.buddy", "important"]);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn what_a_save_finds_at_a_name() {
        let d = temp("target");
        assert_eq!(target(&d.join("none")), Ok(Target::New));
        fs::write(d.join("f"), "").unwrap();
        assert_eq!(target(&d.join("f")), Ok(Target::File));
        assert!(target(&d).is_err());
        fs::remove_dir_all(d).unwrap();
    }
}
