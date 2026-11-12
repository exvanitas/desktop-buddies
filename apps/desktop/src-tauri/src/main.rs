//! Desktop Buddies, the native shell. It reports facts and does what it's told. Every decision
//! lives in the `app` folder beside it, because each new exe gets a fresh Smart App Control
//! verdict and app changes must not need one. See docs/native-shell-design.md.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod commands;
mod pages;
mod platform;
mod raise;
mod shell;
mod tracker;
mod tray;
mod watch;

use assets::FolderAssets;
use shell::Shell;
use shell_core::{args::Args, log::Log, opened, package};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

fn beside_exe() -> PathBuf {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("app"))).unwrap_or_else(|| "app".into())
}

/// A second launch hands its arguments here, then exits.
fn second_launch(app: &AppHandle, argv: Vec<String>, cwd: String) {
    let args = Args::parse(argv.into_iter().skip(1).collect());
    let shell = app.state::<Shell>();
    shell.log.line(&format!("second launch: {}", args.summary()));
    let _ = app.emit("second-launch", serde_json::json!({ "args": args.raw }));
    let app = app.clone();
    // Files can be big, and this runs on the main thread.
    std::thread::spawn(move || {
        let shell = app.state::<Shell>();
        for f in &args.files {
            let file = opened::read(&Path::new(&cwd).join(f));
            let ready = shell.inbox.lock().ok().and_then(|mut i| i.arrive(file));
            if let Some(file) = ready {
                let _ = app.emit("open-file", file);
            }
        }
    });
}

/// The one thing the exe says by itself: a dead start, with no page to say it.
fn give_up(log: &Log, text: &str) -> ! {
    log.line(&format!("error {text}"));
    platform::message_box("Desktop Buddies", text);
    std::process::exit(1);
}

fn start(app: &AppHandle, args: Args, app_dir: PathBuf, log: Arc<Log>, library: &OnceLock<PathBuf>) -> tauri::Result<()> {
    // The Store's package keeps both in its own LocalState, never in AppData, which Windows
    // would virtualize. See shell_core::package::roots.
    let boxed = match (&args.data_dir, platform::package_family()) {
        (None, Some(family)) => Some(package::roots(&app.path().local_data_dir()?, &family)),
        _ => None,
    };
    let data_root = match (&args.data_dir, &boxed) {
        (Some(d), _) => d.clone(),
        (None, Some((data, _))) => data.clone(),
        (None, None) => app.path().app_data_dir()?,
    };
    // A run with its own data folder gets its own WebView2 folder too, kept out of the library's way.
    let webview_dir = match (&args.data_dir, &boxed) {
        (Some(d), _) => d.with_file_name(format!("{}-webview", d.file_name().unwrap_or_default().to_string_lossy())),
        (None, Some((_, webview))) => webview.clone(),
        (None, None) => app.path().app_local_data_dir()?,
    };
    let _ = std::fs::create_dir_all(&data_root);
    let _ = library.set(data_root.clone());
    match &args.log {
        Some(p) => log.attach(p, None),
        None => log.attach(&data_root.join("logs/app.log"), Some(shell_core::log::CAP)),
    }
    let packaged = if platform::packaged() { " packaged" } else { "" };
    log.line(&format!("start {} api {} app {} data {}{packaged}", env!("CARGO_PKG_VERSION"), shell::API, app_dir.display(), data_root.display()));

    if !app_dir.join("hub.html").is_file() {
        give_up(&log, &format!("The app folder is missing or broken. It should sit beside the exe.\n\nLooked in: {}", app_dir.display()));
    }

    let seconds = args.seconds;
    app.manage(Shell::new(app_dir, data_root, webview_dir, args.raw.clone(), args.devtools, log.clone()));
    let shell = app.state::<Shell>();
    if let Ok(mut inbox) = shell.inbox.lock() {
        let cwd = std::env::current_dir().unwrap_or_default();
        for f in &args.files {
            inbox.arrive(opened::read(&cwd.join(f)));
        }
    }

    if let Err(e) = tray::create(app).and_then(|_| pages::open_hub(app)) {
        give_up(&log, &format!("Desktop Buddies couldn't start.\n\n{e}"));
    }
    watch::start(app);
    if let Some(s) = seconds {
        watch::time_limit(app, s);
    }
    Ok(())
}

fn main() {
    let started = Instant::now();
    let args = Args::parse(std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned()).collect());
    let app_dir = args.app_dir.clone().unwrap_or_else(beside_exe);
    // The data folder is only known once the app exists, and the assets go in before that.
    let library = Arc::new(OnceLock::new());
    let log = Arc::new(Log::new(started));
    // There's no console, so a crash has to reach the log or it says nothing.
    let last_words = log.clone();
    std::panic::set_hook(Box::new(move |info| last_words.line(&format!("error panic: {info}"))));

    let mut context = tauri::generate_context!();
    context.set_assets(Box::new(FolderAssets { app: app_dir.clone(), data: library.clone() }));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(second_launch))
        .invoke_handler(commands::handler())
        .on_window_event(|w, e| {
            if matches!(e, tauri::WindowEvent::Destroyed) {
                pages::forget(w.app_handle(), w.label());
            }
        })
        .setup(move |app| Ok(start(app.handle(), args, app_dir, log, &library)?))
        .build(context)
        .expect("the shell failed to start");

    app.run(|_, event| {
        // Windows can all close while the tray stays. Only Quit ends the run.
        if let RunEvent::ExitRequested { code: None, api, .. } = event {
            api.prevent_exit();
        }
    });
}
