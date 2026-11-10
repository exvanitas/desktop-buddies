//! Serves pages from the app folder, and `library/` from the data folder. Both keep the local
//! origin, so commands work and hit testing can read image pixels. Remote origins can't call app
//! commands, which is why it's done this way. A library file is only served if it really is an
//! image: it came from a `.buddy` file, and an unknown type would load here as a page.

use shell_core::{
    data, image,
    paths::{self, Asset},
};
use std::{
    borrow::Cow,
    path::PathBuf,
    sync::{Arc, OnceLock},
};
use tauri::{
    utils::assets::{AssetKey, AssetsIter, CspHash},
    Assets, Runtime,
};

pub struct FolderAssets {
    pub app: PathBuf,
    pub data: Arc<OnceLock<PathBuf>>,
}

impl<R: Runtime> Assets<R> for FolderAssets {
    /// Tauri cuts the query string and fragment off before it gets here.
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let bytes = match paths::asset(key.as_ref())? {
            Asset::App(rel) => std::fs::read(self.app.join(rel)).ok()?,
            Asset::Library(rel) => data::read_capped(&self.data.get()?.join(rel)).ok().filter(|b| image::is_image(b))?,
        };
        Some(Cow::Owned(bytes))
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
