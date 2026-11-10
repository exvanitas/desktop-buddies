//! The data folder. Pages get this and nothing else of the disk: plain names only, bytes in and
//! out, and writes that either land whole or not at all.

use crate::{paths, temp};
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::UNIX_EPOCH;

pub const MAX_BYTES: u64 = 64 * 1024 * 1024;
/// Half-written files carry this, and listings never show them.
const TEMP: &str = temp::PREFIX;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Listed {
    pub name: String,
    pub dir: bool,
    pub size: u64,
    /// Milliseconds since 1970.
    pub modified: u64,
}

pub struct DataDir {
    root: PathBuf,
    /// Every change to the folder comes through this one process, so holding this makes "won't
    /// overwrite" true. Reads don't need it: a write lands whole by renaming.
    changing: Mutex<()>,
}

fn text<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Everything a reader has, up to the cap. A hard limit, so a file that grows can't get past it.
fn limited(r: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = vec![];
    r.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(text)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("too big".into());
    }
    Ok(bytes)
}

/// A file's bytes, opened once. Its size only saves reading what would be refused anyway.
pub fn read_capped(path: &Path) -> Result<Vec<u8>, String> {
    // Windows won't open a folder as a file, and says so as access denied.
    let f = fs::File::open(path).map_err(|e| if path.is_dir() { "not a file".to_string() } else { text(e) })?;
    let m = f.metadata().map_err(text)?;
    if !m.is_file() {
        return Err("not a file".into());
    }
    if m.len() > MAX_BYTES {
        return Err("too big".into());
    }
    limited(f)
}

impl DataDir {
    pub fn new(root: PathBuf) -> DataDir {
        DataDir { root, changing: Mutex::default() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Nothing is held across a panic that needs protecting, so a poisoned lock is still good.
    fn changing(&self) -> MutexGuard<'_, ()> {
        self.changing.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A checked path. Only a listing may name the folder itself.
    fn file(&self, path: &str) -> Result<PathBuf, String> {
        if path.is_empty() {
            return Err("no path".into());
        }
        paths::inside(&self.root, path).ok_or_else(|| format!("refused path {path:?}"))
    }

    pub fn list(&self, dir: &str) -> Result<Vec<Listed>, String> {
        let at = paths::inside(&self.root, dir).ok_or_else(|| format!("refused path {dir:?}"))?;
        if dir.is_empty() && !at.exists() {
            return Ok(vec![]);
        }
        let mut out = vec![];
        for e in fs::read_dir(at).map_err(text)? {
            let e = e.map_err(text)?;
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with(TEMP) {
                continue;
            }
            let m = e.metadata().map_err(text)?;
            let modified = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
            out.push(Listed { name, dir: m.is_dir(), size: m.len(), modified });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    pub fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        read_capped(&self.file(path)?)
    }

    /// Writes beside the target, then renames over it, so a crash leaves the old file whole.
    pub fn write(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        let p = self.file(path)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("too big".into());
        }
        let dir = p.parent().ok_or("no folder")?;
        let _changing = self.changing();
        fs::create_dir_all(dir).map_err(text)?;
        temp::write_atomic(&p, bytes).map_err(text)
    }

    /// Moves a file or folder. It won't overwrite: a move that loses data should be a delete first.
    pub fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let (a, b) = (self.file(from)?, self.file(to)?);
        let _changing = self.changing();
        if b.exists() {
            return Err("already exists".into());
        }
        if let Some(dir) = b.parent() {
            fs::create_dir_all(dir).map_err(text)?;
        }
        fs::rename(a, b).map_err(text)
    }

    /// Deletes a file or a whole folder. Deleting what isn't there is fine.
    pub fn delete(&self, path: &str) -> Result<(), String> {
        let p = self.file(path)?;
        let _changing = self.changing();
        match fs::symlink_metadata(&p) {
            Err(_) => Ok(()),
            Ok(m) if m.is_dir() => fs::remove_dir_all(p).map_err(text),
            Ok(_) => fs::remove_file(p).map_err(text),
        }
    }
}

/// `data_write` carries its path in a header, percent-encoded by the client.
pub fn decode_header(value: &str) -> Result<String, String> {
    percent_encoding::percent_decode_str(value).decode_utf8().map(|s| s.into_owned()).map_err(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Barrier;
    use std::thread;

    fn temp(name: &str) -> DataDir {
        let d = std::env::temp_dir().join(format!("shell-core-data-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        DataDir::new(d)
    }

    #[test]
    fn bytes_go_in_and_come_out() {
        let d = temp("rw");
        d.write("library/olive/a.bin", &[0, 1, 255]).unwrap();
        assert_eq!(d.read("library/olive/a.bin").unwrap(), [0, 1, 255]);
        d.write("library/olive/a.bin", &[9]).unwrap();
        assert_eq!(d.read("library/olive/a.bin").unwrap(), [9]);
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn listing_shows_files_and_folders_and_no_half_writes() {
        let d = temp("list");
        d.write("b.txt", b"12").unwrap();
        d.write("a/x", b"").unwrap();
        fs::write(d.root().join(".~stale"), "x").unwrap();
        let l = d.list("").unwrap();
        assert_eq!(l.iter().map(|e| (e.name.as_str(), e.dir)).collect::<Vec<_>>(), [("a", true), ("b.txt", false)]);
        assert_eq!(l[1].size, 2);
        assert!(l[1].modified > 0);
        assert_eq!(d.list("a").unwrap().len(), 1);
        assert!(d.list("missing").is_err());
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn a_folder_not_made_yet_lists_empty() {
        let d = DataDir::new(std::env::temp_dir().join("shell-core-data-never-made"));
        assert!(d.list("").unwrap().is_empty());
    }

    #[test]
    fn every_command_refuses_paths_that_leave() {
        let d = temp("refuse");
        d.write("a", b"x").unwrap();
        for bad in ["../x", "a/../../x", "/etc/passwd", "C:\\x", "a:b", "nul"] {
            assert!(d.list(bad).is_err(), "{bad}");
            assert!(d.read(bad).is_err(), "{bad}");
            assert!(d.write(bad, b"x").is_err(), "{bad}");
            assert!(d.delete(bad).is_err(), "{bad}");
            assert!(d.rename(bad, "b").is_err(), "{bad}");
            assert!(d.rename("a", bad).is_err(), "{bad}");
        }
        assert!(d.read("").is_err());
        assert!(d.write("", b"x").is_err());
        assert!(d.delete("").is_err(), "not the whole folder");
        assert!(d.rename("", "b").is_err());
        assert_eq!(d.read("a").unwrap(), b"x");
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn writes_are_capped() {
        let d = temp("cap");
        d.write("a", b"old").unwrap();
        assert_eq!(d.write("a", &vec![0; MAX_BYTES as usize + 1]), Err("too big".into()));
        assert_eq!(d.read("a").unwrap(), b"old");
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn reads_are_capped_whatever_the_size_said() {
        assert_eq!(limited(std::io::repeat(7)), Err("too big".into()), "a file that never ends");
        assert_eq!(limited(std::io::repeat(7).take(MAX_BYTES + 1)), Err("too big".into()));
        assert_eq!(limited(std::io::repeat(7).take(MAX_BYTES)).unwrap().len() as u64, MAX_BYTES);
    }

    #[test]
    fn a_file_over_the_cap_is_refused_and_one_at_it_is_read() {
        let d = temp("read-cap");
        let f = fs::File::create(d.root().join("big")).unwrap();
        f.set_len(MAX_BYTES).unwrap();
        assert_eq!(d.read("big").unwrap().len() as u64, MAX_BYTES);
        f.set_len(MAX_BYTES + 1).unwrap();
        assert_eq!(d.read("big"), Err("too big".into()));
        drop(f);
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn reading_a_folder_says_so() {
        let d = temp("read-dir");
        d.write("a/b", b"x").unwrap();
        assert_eq!(d.read("a"), Err("not a file".into()));
        assert!(d.read("gone").is_err());
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn a_failed_write_leaves_the_old_file_and_no_scraps() {
        let d = temp("atomic");
        d.write("a/b", b"x").unwrap();
        assert!(d.write("a", b"over a folder").is_err());
        assert_eq!(fs::read_dir(d.root()).unwrap().count(), 1);
        assert_eq!(d.read("a/b").unwrap(), b"x");
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn a_write_never_opens_a_file_that_was_there() {
        let d = temp("exclusive");
        fs::write(d.root().join(".~0000000000000000"), "not ours").unwrap();
        for _ in 0..20 {
            d.write("a", b"x").unwrap();
        }
        assert_eq!(fs::read(d.root().join(".~0000000000000000")).unwrap(), b"not ours");
        assert_eq!(fs::read_dir(d.root()).unwrap().count(), 2);
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn moves_keep_data_and_never_overwrite() {
        let d = temp("move");
        d.write("a", b"1").unwrap();
        d.write("b", b"2").unwrap();
        assert!(d.rename("a", "b").is_err());
        assert_eq!(d.read("b").unwrap(), b"2");
        d.rename("a", "c/d").unwrap();
        assert_eq!(d.read("c/d").unwrap(), b"1");
        assert!(d.read("a").is_err());
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn moves_racing_for_one_name_leave_one_winner() {
        const N: usize = 8;
        let d = temp("move-race");
        for round in 0..200 {
            for i in 0..N {
                d.write(&format!("s{i}"), i.to_string().as_bytes()).unwrap();
            }
            let start = Barrier::new(N);
            let won: Vec<usize> = thread::scope(|s| {
                let moves: Vec<_> = (0..N)
                    .map(|i| {
                        let (d, start) = (&d, &start);
                        s.spawn(move || {
                            start.wait();
                            d.rename(&format!("s{i}"), "to").is_ok().then_some(i)
                        })
                    })
                    .collect();
                moves.into_iter().filter_map(|m| m.join().unwrap()).collect()
            });
            assert_eq!(won.len(), 1, "round {round}: {won:?}");
            assert_eq!(d.read("to").unwrap(), won[0].to_string().as_bytes(), "round {round}");
            for i in (0..N).filter(|i| *i != won[0]) {
                assert_eq!(d.read(&format!("s{i}")).unwrap(), i.to_string().as_bytes(), "round {round}: a loser keeps its file");
            }
            d.delete("to").unwrap();
        }
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn deleting_takes_files_and_folders() {
        let d = temp("delete");
        d.write("a/b/c", b"1").unwrap();
        d.write("x", b"1").unwrap();
        d.delete("x").unwrap();
        d.delete("x").unwrap();
        d.delete("a").unwrap();
        assert!(d.list("").unwrap().is_empty());
        fs::remove_dir_all(d.root()).unwrap();
    }

    #[test]
    fn header_paths_decode() {
        assert_eq!(decode_header("library%2Fn%C3%BCi%2Fa%20b.webp").unwrap(), "library/nüi/a b.webp");
        assert!(decode_header("%ff").is_err());
    }
}
