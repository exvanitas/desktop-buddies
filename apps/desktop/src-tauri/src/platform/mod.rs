//! Every OS call lives behind this module. Only Windows is real so far. The stubs keep other
//! systems compiling, so macOS stays possible.

use serde::Deserialize;

/// One row of a save dialog's file types.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Filter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
mod stub;
#[cfg(not(windows))]
pub use stub::*;
