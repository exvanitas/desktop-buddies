//! The exe's own flags. Everything else reaches the app untouched, through `shell_info`.

use std::path::PathBuf;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Args {
    pub app_dir: Option<PathBuf>,
    pub data_dir: Option<PathBuf>,
    pub log: Option<PathBuf>,
    pub seconds: Option<u64>,
    pub devtools: bool,
    /// Paths that look like buddy files, in the order given.
    pub files: Vec<String>,
    /// Every argument, flags included.
    pub raw: Vec<String>,
}

pub fn is_buddy_file(arg: &str) -> bool {
    let a = arg.to_ascii_lowercase();
    a.ends_with(".buddy") || a.ends_with(".buddy.json")
}

impl Args {
    pub fn parse(raw: Vec<String>) -> Args {
        let mut a = Args::default();
        let mut it = raw.iter();
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--app-dir" => a.app_dir = it.next().map(PathBuf::from),
                "--data-dir" => a.data_dir = it.next().map(PathBuf::from),
                "--log" => a.log = it.next().map(PathBuf::from),
                "--seconds" => a.seconds = it.next().and_then(|v| v.parse().ok()),
                "--devtools" => a.devtools = true,
                other if is_buddy_file(other) => a.files.push(other.to_string()),
                _ => {}
            }
        }
        a.raw = raw;
        a
    }

    /// What a second launch puts in the log: counts, and which of the exe's flags were there.
    /// Never a value: arguments can hold paths, request text, anything.
    pub fn summary(&self) -> String {
        let flags: Vec<&str> = FLAGS.iter().copied().filter(|f| self.raw.iter().any(|a| a == f)).collect();
        let flags = if flags.is_empty() { "none".to_string() } else { flags.join(" ") };
        format!("args {}, files {}, flags {flags}", self.raw.len(), self.files.len())
    }
}

/// The exe's own flags.
pub const FLAGS: [&str; 5] = ["--app-dir", "--data-dir", "--log", "--seconds", "--devtools"];

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> Args {
        Args::parse(s.split_whitespace().map(String::from).collect())
    }

    #[test]
    fn flags() {
        let a = parse("--app-dir A --data-dir D --log L --seconds 30 --devtools");
        assert_eq!(a.app_dir, Some("A".into()));
        assert_eq!(a.data_dir, Some("D".into()));
        assert_eq!(a.log, Some("L".into()));
        assert_eq!(a.seconds, Some(30));
        assert!(a.devtools);
    }

    #[test]
    fn nothing_limits_the_run_unless_asked() {
        assert_eq!(parse("").seconds, None);
        assert_eq!(parse("--seconds nope").seconds, None);
        assert_eq!(parse("--seconds").seconds, None);
    }

    #[test]
    fn the_rest_reaches_the_app() {
        let a = parse("--buddies 6 --mode empty --seconds 5");
        assert_eq!(a.raw, ["--buddies", "6", "--mode", "empty", "--seconds", "5"]);
        assert!(a.files.is_empty());
    }

    #[test]
    fn buddy_files_count_as_files_to_open() {
        let a = parse("C:\\x\\olive.buddy --buddies 2 olive.BUDDY.JSON other.json");
        assert_eq!(a.files, ["C:\\x\\olive.buddy", "olive.BUDDY.JSON"]);
    }

    #[test]
    fn a_second_launch_logs_counts_and_flags_never_values() {
        let a = parse("--api {\"say\":\"secret\"} --data-dir C:\\Users\\x\\private D:\\x\\olive.buddy --devtools --seconds 5");
        let s = a.summary();
        assert_eq!(s, "args 8, files 1, flags --data-dir --seconds --devtools");
        for v in ["secret", "say", "Users", "private", "olive", "buddy", "5", "--api"] {
            assert!(!s.contains(v), "{v} leaked into {s:?}");
        }
        assert_eq!(parse("").summary(), "args 0, files 0, flags none");
        assert_eq!(parse("--log=x --LOG").summary(), "args 2, files 0, flags none", "only exact flags");
    }

    #[test]
    fn a_flag_value_is_never_a_file() {
        assert!(parse("--log run.buddy").files.is_empty());
    }
}
