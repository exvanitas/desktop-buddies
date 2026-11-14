# Installing, updating and removing

## What you need
Windows 10 or 11, 64-bit, with Microsoft Edge WebView2, which draws the app's windows. It comes with Windows 11 and most up-to-date Windows 10 PCs, and the installer downloads it from Microsoft if it's missing. If the zip version won't open on Windows 10, install the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) from Microsoft, then start it again.

## The installer
`desktop-buddies-X.Y.Z-setup-x64.exe`, from [Releases](https://github.com/exvanitas/desktop-buddies/releases). It installs for you alone, with no admin prompt, into `%LOCALAPPDATA%\Desktop Buddies`, and adds Desktop Buddies to the Start menu.

- **Updating:** a winget upgrade, or a newer setup run with `/S`, installs over the old version and keeps your buddies and Start with Windows. A newer setup run by hand removes the old version first: your buddies stay, but Start with Windows goes off, so turn it back on in the app. Files the new version no longer has may stay in the program folder, which does no harm.
- **Removing:** from Installed apps in Windows Settings.

## The portable zip
`desktop-buddies-X.Y.Z-windows-x64.zip`, from [Releases](https://github.com/exvanitas/desktop-buddies/releases). Unzip the whole folder somewhere you'll keep it, like Documents, keep the `app` folder next to `desktop-buddies.exe`, and run the exe.

- **Updating:** quit from the tray, then replace the folder with the new one.
- **Removing:** turn Start with Windows off if you turned it on, so its startup entry goes too, quit from the tray, and delete the folder.

## winget
Coming soon, once the package is in the winget catalogue:

```
winget install --id exvanitas.DesktopBuddies -e
```

It installs the same installer as above, and `winget upgrade` updates it.

## Windows' warnings
The installer and the zip aren't signed. Windows may say "Windows protected your PC": click More info, then Run anyway. If Smart App Control is on, Windows checks each unsigned version with Microsoft's cloud service and may block it outright, with no way past, and a new version can be blocked where an older one ran. Please don't turn Smart App Control off for this. winget installs the same unsigned installer, so it gets the same checks. [releases.md](releases.md) has the code signing policy.

## Your buddies and settings
They're in `%APPDATA%\dev.exvanitas.desktop-buddies`. Removing the app leaves them there, unless you tick the uninstaller's box to delete them, and you can delete the folder yourself. Export and Import move buddies between PCs. [PRIVACY.md](../PRIVACY.md) has what's in the folder.
