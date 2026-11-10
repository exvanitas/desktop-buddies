//! The order our windows are put back on top in. Overlays go up first and always-on-top app
//! windows after them, so a menu stays above the buddies. Which windows are ours is looked up
//! fresh for each pass, never kept.

/// `(handle, overlay)` for each window, in any order. Each raise puts its window above the ones
/// raised before it.
pub fn order(windows: &[(isize, bool)]) -> Vec<isize> {
    let pick = |overlay: bool| windows.iter().filter(move |w| w.1 == overlay).map(|w| w.0);
    pick(true).chain(pick(false)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlays_go_up_first_and_windows_after() {
        assert_eq!(order(&[(10, false), (1, true), (2, true), (20, false)]), [1, 2, 10, 20]);
        assert!(order(&[]).is_empty());
    }
}
