//! The parts of the native shell that are plain logic. Tauri and OS calls stay out of here, so
//! `cargo test` runs on any machine.

pub mod api;
pub mod args;
pub mod data;
pub mod image;
pub mod lease;
pub mod log;
pub mod menu;
pub mod monitors;
pub mod nav;
pub mod opened;
pub mod package;
pub mod paths;
pub mod quit;
pub mod raise;
pub mod system;
pub mod temp;
pub mod tracker;
pub mod windows;
