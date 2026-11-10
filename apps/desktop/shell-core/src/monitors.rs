//! What the exe reports about monitors. All in physical pixels on the virtual desktop.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// The work area at the top level, then the whole screen in `full`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Monitor {
    pub i: usize,
    pub name: String,
    pub primary: bool,
    pub scale: f64,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub full: Rect,
}
