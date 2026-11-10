//! What the library may serve. Tauri guesses a type from the bytes and falls back to `text/html`,
//! so anything it can't name would run on the local origin if opened as a document. Only bytes
//! that start like one of these four formats get through, and those it names as images.

/// The names `buddy-file` gives images on disk.
pub const EXTENSIONS: [&str; 4] = ["png", "webp", "jpg", "gif"];

pub fn named(file: &str) -> bool {
    file.rsplit_once('.').is_some_and(|(_, ext)| EXTENSIONS.contains(&ext))
}

pub fn is_image(b: &[u8]) -> bool {
    b.starts_with(b"\x89PNG\r\n\x1a\n")
        || b.starts_with(&[0xff, 0xd8, 0xff])
        || b.starts_with(b"GIF87a")
        || b.starts_with(b"GIF89a")
        || (b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_four_formats_pass() {
        for good in [
            &b"\x89PNG\r\n\x1a\n"[..],
            &[0xff, 0xd8, 0xff, 0xe0],
            b"GIF87a",
            b"GIF89a....",
            b"RIFF\0\0\0\0WEBP",
            b"RIFF\x24\0\0\0WEBPVP8 ",
        ] {
            assert!(is_image(good), "{good:?}");
        }
    }

    #[test]
    fn a_signature_followed_by_html_is_still_named_an_image() {
        assert!(is_image(b"\x89PNG\r\n\x1a\n<script>alert(1)</script>"));
    }

    #[test]
    fn everything_else_is_refused() {
        for bad in [
            &b""[..],
            b"<!doctype html><script>alert(1)</script>",
            b"<script>alert(1)</script>",
            b"<svg onload=alert(1)>",
            b" \x89PNG\r\n\x1a\n",
            b"\x89PNG",
            b"\x89PNG\r\n\x1a",
            &[0xff, 0xd8],
            b"GIF",
            b"GIF88a",
            b"RIFF",
            b"RIFF\0\0\0\0WEB",
            b"RIFF\0\0\0\0WAVE",
            b"XXXX\0\0\0\0WEBP",
            b"BM\0\0",
        ] {
            assert!(!is_image(bad), "{bad:?}");
        }
    }

    #[test]
    fn only_the_four_extensions_count() {
        for good in ["a.png", "a.webp", "a.jpg", "a.gif", "a.b.png"] {
            assert!(named(good), "{good}");
        }
        for bad in ["a", "png", "a.html", "a.svg", "a.json", "a.png.html", "a.PNG", "a.jpeg", "a."] {
            assert!(!named(bad), "{bad}");
        }
    }
}
