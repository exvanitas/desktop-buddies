fn main() {
    println!("cargo:rerun-if-env-changed=SHELL_CHECK_ONLY");
    // A type check from Linux can't compile Windows resources, and that step panics.
    // Everything the check needs is done by then. Real builds never take this path.
    if std::env::var_os("SHELL_CHECK_ONLY").is_some() {
        let _ = std::panic::catch_unwind(|| tauri_build::try_build(tauri_build::Attributes::new()));
        return;
    }
    tauri_build::build();
}
