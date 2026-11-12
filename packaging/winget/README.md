# winget

Desktop Buddies goes into the Windows Package Manager as `exvanitas.DesktopBuddies` once its first manifest is merged into [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). It installs the release's per-user installer, `desktop-buddies-X.Y.Z-setup-x64.exe`:

    winget install --id exvanitas.DesktopBuddies -e

winget checks the installer's SHA-256 against the manifest before it runs it. An upgrade runs the new setup over the old install (`UpgradeBehavior: install`), with /S and nothing uninstalled first, which leaves the rest as it was: the buddies in `%APPDATA%`, and Start with Windows. The interactive setup is different: run by hand over an older version, it offers to uninstall that first, and does by default, which turns Start with Windows off. A download through winget carries no mark of the web, so SmartScreen doesn't ask. Smart App Control still judges an unsigned exe by itself, wherever it came from.

- `manifest.py` writes the three manifests for a version: `exvanitas.DesktopBuddies.yaml` (version), `.installer.yaml` and `.locale.en-US.yaml` (defaultLocale), in schema 1.28.0. Each is checked against the schema before anything is written.
- `schema/1.28.0/` holds winget's own schemas for that version, from [microsoft/winget-cli](https://github.com/microsoft/winget-cli/tree/master/schemas/JSON/manifests/v1.28.0), under its MIT licence in `schema/LICENSE`. The tests in `tools/release/tests/test_winget.py` check the manifests against them.
- `manifests/` is where `manifest.py` writes, laid out as in winget-pkgs: `manifests/e/exvanitas/DesktopBuddies/X.Y.Z/`.

## For each release
Once the GitHub release is published, so its asset URL works:

1. **Get the hash** from the release's own `SHA256SUMS.txt`:

       gh release download vX.Y.Z -R exvanitas/desktop-buddies -p SHA256SUMS.txt -D <folder>

2. **Write the manifests:**

       python3 -I packaging/winget/manifest.py --version X.Y.Z --sums <folder>/SHA256SUMS.txt

   It takes the hash of `desktop-buddies-X.Y.Z-setup-x64.exe` from that file, and the URL `https://github.com/exvanitas/desktop-buddies/releases/download/vX.Y.Z/desktop-buddies-X.Y.Z-setup-x64.exe`. `--sha256 <hex>` gives the hash instead, and `--url` another https URL for the same file. Commit them, as the record of what went to winget.
3. **Validate them on Windows:** `winget validate --manifest packaging\winget\manifests\e\exvanitas\DesktopBuddies\X.Y.Z` should say the validation succeeded. To try the install itself, do it in Windows Sandbox, not on a PC in use: `winget settings --enable LocalManifestFiles` (as admin) and then `winget install --manifest <that folder>`.
4. **Open the pull request** to microsoft/winget-pkgs, from a fork:
   - Fork it (`gh repo fork microsoft/winget-pkgs --clone=false`). The repository is very large, so clone the fork sparsely: `git clone --filter=blob:none --sparse <fork URL>`, then `git sparse-checkout set manifests/e/exvanitas`.
   - On a new branch, copy the three files into `manifests/e/exvanitas/DesktopBuddies/X.Y.Z/`, nothing else.
   - Commit with the title winget-pkgs uses: `New package: exvanitas.DesktopBuddies version X.Y.Z` the first time, `New version: exvanitas.DesktopBuddies version X.Y.Z` after.
   - Push the branch to the fork and open the pull request against `master` with that title: `gh pr create -R microsoft/winget-pkgs --base master`. Tick the template's checklist: no other open pull request for this version, `winget validate` passed, the install was tested, and the manifests use the latest schema.
   - The first pull request from an account asks for the Microsoft CLA to be signed, by a comment on it.
   - winget-pkgs' pipeline then installs the package on its own machine and scans it. The first submission is also reviewed by a moderator. A label like `Needs-Author-Feedback` means it's waiting on us. Once merged, the package reaches `winget` within hours.

A published release's installer must never be replaced: winget holds its hash, and a new file under the same URL fails every install. A fix is a new version.

Later versions can also go through Microsoft's `wingetcreate update exvanitas.DesktopBuddies --version X.Y.Z --urls <url> --submit`, but this script keeps the manifests checked here first.
