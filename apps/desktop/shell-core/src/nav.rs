//! Pages stay local. A page's navigation is allowed on the local origin and refused anywhere else,
//! and only `https` goes on to the default browser.

#[derive(Debug, PartialEq, Eq)]
pub enum Nav {
    Stay,
    External,
    Refuse,
}

/// Decides from a parsed URL's scheme and host. The local origin is `http://tauri.localhost` on
/// Windows and `tauri://localhost` elsewhere.
pub fn decide(scheme: &str, host: Option<&str>, port: Option<u16>) -> Nav {
    match (scheme, host, port) {
        ("http" | "https", Some("tauri.localhost"), None) | ("tauri", Some("localhost"), None) => Nav::Stay,
        ("https", Some(h), _) if !h.is_empty() => Nav::External,
        _ => Nav::Refuse,
    }
}

/// What `open_external` accepts.
pub fn is_https(url: &str) -> bool {
    let start = url.get(..8).is_some_and(|s| s.eq_ignore_ascii_case("https://"));
    start && url.len() > 8 && url.len() <= 2048 && !url.chars().any(|c| c.is_control() || c == ' ' || c == '"')
}

/// What the log may say about a URL: its scheme, if it looks like one, and nothing else. A
/// gallery link can carry what someone shared.
pub fn scheme(url: &str) -> &str {
    match url.split_once(':') {
        Some((s, _)) if !s.is_empty() && s.len() <= 16 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"+.-".contains(&b)) => s,
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_local_origin_stays() {
        assert_eq!(decide("http", Some("tauri.localhost"), None), Nav::Stay);
        assert_eq!(decide("https", Some("tauri.localhost"), None), Nav::Stay);
        assert_eq!(decide("tauri", Some("localhost"), None), Nav::Stay);
    }

    #[test]
    fn https_goes_out_and_the_rest_is_refused() {
        assert_eq!(decide("https", Some("example.com"), None), Nav::External);
        assert_eq!(decide("http", Some("example.com"), None), Nav::Refuse);
        assert_eq!(decide("file", None, None), Nav::Refuse);
        assert_eq!(decide("javascript", None, None), Nav::Refuse);
        assert_eq!(decide("data", None, None), Nav::Refuse);
        assert_eq!(decide("about", None, None), Nav::Refuse);
    }

    #[test]
    fn lookalikes_are_not_local() {
        assert_eq!(decide("http", Some("tauri.localhost.example.com"), None), Nav::Refuse);
        assert_eq!(decide("https", Some("tauri.localhost.example.com"), None), Nav::External);
        assert_eq!(decide("http", Some("tauri.localhost"), Some(8080)), Nav::Refuse);
        assert_eq!(decide("http", Some("localhost"), None), Nav::Refuse);
    }

    #[test]
    fn open_external_is_https_only() {
        assert!(is_https("https://example.com/a?b=c"));
        assert!(is_https("HTTPS://example.com"));
        for bad in ["http://example.com", "file:///c:/x", "javascript:alert(1)", "https://", "calc.exe", "https://a b", "https://a\"b", "https://a\nb", "", "é"] {
            assert!(!is_https(bad), "{bad:?}");
        }
        assert!(!is_https(&format!("https://{}", "a".repeat(3000))));
    }

    #[test]
    fn the_log_gets_a_scheme_and_nothing_more() {
        assert_eq!(scheme("https://example.com/g/secret?k=v"), "https");
        assert_eq!(scheme("javascript:alert(1)"), "javascript");
        assert_eq!(scheme("file:///C:/Users/x"), "file");
        assert_eq!(scheme("no scheme here"), "unknown");
        assert_eq!(scheme("C:\\Users\\x"), "C", "a drive letter says nothing more");
        assert_eq!(scheme(":x"), "unknown");
        assert_eq!(scheme(&format!("{}:x", "a".repeat(17))), "unknown");
        assert_eq!(scheme("we ird:x"), "unknown");
    }
}
