//! The log file. With no `--log` it's capped, with one old file kept, because testers' bug reports
//! will come with it.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

pub const CAP: u64 = 1024 * 1024;

struct Sink {
    file: File,
    path: PathBuf,
    size: u64,
    cap: Option<u64>,
}

pub struct Log {
    sink: Mutex<Option<Sink>>,
    started: Instant,
}

fn open(path: &Path) -> Option<File> {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    OpenOptions::new().create(true).append(true).open(path).ok()
}

impl Log {
    /// A log that writes nowhere yet.
    pub fn new(started: Instant) -> Log {
        Log { sink: Mutex::new(None), started }
    }

    /// Starts writing to `path`. With a cap, the file rolls over to `<name>.old.log` past it.
    pub fn attach(&self, path: &Path, cap: Option<u64>) {
        let Some(file) = open(path) else { return };
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        if let Ok(mut g) = self.sink.lock() {
            *g = Some(Sink { file, path: path.to_path_buf(), size, cap });
        }
    }

    pub fn line(&self, s: &str) {
        let Ok(mut g) = self.sink.lock() else { return };
        let Some(sink) = g.as_mut() else { return };
        let text = format!("{:>8.2} {s}\n", self.started.elapsed().as_secs_f64());
        if sink.cap.is_some_and(|cap| sink.size + text.len() as u64 > cap) {
            let old = sink.path.with_extension("old.log");
            let _ = fs::remove_file(&old);
            let _ = fs::rename(&sink.path, &old);
            if let Some(f) = open(&sink.path) {
                sink.file = f;
                sink.size = 0;
            }
        }
        if sink.file.write_all(text.as_bytes()).is_ok() {
            sink.size += text.len() as u64;
            let _ = sink.file.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("shell-core-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn writes_lines_and_makes_its_folder() {
        let d = temp("plain");
        let p = d.join("logs/app.log");
        let l = Log::new(Instant::now());
        l.line("dropped, nothing attached yet");
        l.attach(&p, None);
        l.line("hello");
        let text = fs::read_to_string(&p).unwrap();
        assert!(text.ends_with(" hello\n") && !text.contains("dropped"));
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn rolls_over_at_the_cap_and_keeps_one_old_file() {
        let d = temp("cap");
        let p = d.join("app.log");
        let l = Log::new(Instant::now());
        l.attach(&p, Some(100));
        for i in 0..40 {
            l.line(&format!("line {i}"));
        }
        assert!(fs::metadata(&p).unwrap().len() <= 100);
        let old = fs::read_to_string(d.join("app.old.log")).unwrap();
        assert!(old.len() <= 100 && old.contains("line"));
        assert_eq!(fs::read_dir(&d).unwrap().count(), 2);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn a_new_run_counts_what_is_already_there() {
        let d = temp("again");
        let p = d.join("app.log");
        fs::create_dir_all(&d).unwrap();
        fs::write(&p, vec![b'x'; 90]).unwrap();
        let l = Log::new(Instant::now());
        l.attach(&p, Some(100));
        l.line("this one goes over");
        assert!(d.join("app.old.log").exists());
        fs::remove_dir_all(d).unwrap();
    }
}
