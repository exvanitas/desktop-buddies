# Releases

Releases are `.exe` builds attached to the repo's GitHub releases: the exe and its `app` folder in one zip, and the same in a per-user installer, built and packed by `.github/workflows/release.yml`. No buddies are included. Signing through SignPath is applied for; until it's in place, builds are unsigned.

## Code signing policy
Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Only the exe built from this repository's source, by its release workflow on GitHub-hosted runners, is signed. Nothing built elsewhere is.

### Team roles
- **Committers and reviewers:** the maintainer, Severian (@severian-dev), and anyone the maintainer adds.
- **Approvers:** the maintainer, Severian (@severian-dev). Each signing request is approved by hand.

### Privacy
This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. Desktop Buddies has no network use at all: see `SECURITY.md`.

## Before the first release
Protect the release tags, so a tag can't move once it's pushed. In the repo's Settings, under Rules, add a tag ruleset: target tags matching `v*`, turn on **Restrict updates** and **Restrict deletions**, enforce it, and add no bypass. A tag that's wrong is then left as it is, and the fix is a new version. The workflow also refuses to draft if the tag points anywhere but the commit it built.

## Making a release
1. **Bump the version** in four places, in one commit: `version` in `package.json`, a new top section `## X.Y.Z (date)` in `CHANGELOG.md`, the first line of `apps/desktop/preview/README.txt`, `Desktop Buddies X.Y.Z`, and `version` in `apps/desktop/src-tauri/tauri.conf.json`, which the installer and the exe take theirs from. The CHANGELOG section becomes the release notes.
2. **Tag it** `vX.Y.Z` and push the tag. The workflow refuses a tag that doesn't match all four.
3. **Review the draft.** The workflow makes a draft release for the tag, with the zip, the installer, the MSIX, `SHA256SUMS.txt` and the notes. Download them, check them, and publish the draft by hand. Nothing is public until then.
4. **Update winget**, once the release is public: `packaging/winget/README.md` says how.

To build a tag again, after a failed run, start the workflow by hand with the tag. The workflow never changes a release that exists, draft or published: if the tag has a draft, delete the draft first. A published release stays as it is, and the fix is a new version.

## What the workflow does
It runs on GitHub-hosted runners only, as SignPath requires. Every action is pinned to a full commit, with its version in a comment.

1. **Fix the commit:** a pushed tag builds the commit it was pushed at. A manual run looks the tag up once, and every job then builds that commit.
2. **Check** the tag against `package.json`, the CHANGELOG's top section, the README and `tauri.conf.json` (`tools/release/version.py`), before anything slow.
3. **Test** on `ubuntu-latest`, as `ci.yml` does: `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`. The suite isn't Windows-portable yet.
4. **Build** on `windows-latest`, once the tests pass: the app folder (`pnpm --filter @buddies/desktop build`), `cargo test --locked` on `shell-core`, and `cargo build --release --locked` in `apps/desktop/src-tauri`. Node 22, pnpm from `packageManager` in `package.json`, Rust at the version in the workflow. Nothing is cached.
5. **Notices:** cargo-about, at the pinned version, writes `THIRD-PARTY-NOTICES.txt` for the crates in the exe, from `tools/release/about.toml` and `about.hbs`. `about.toml` accepts only the licences those crates use today (MIT, Apache-2.0, BSD-3-Clause, MPL-2.0, Unicode-3.0 and Zlib), so a crate with any other licence fails the build until someone looks.
6. **Upload** the unsigned exe as a workflow artifact.
7. **Sign:** not yet. See below.
8. **Pack** with `preview.py --release`. The zip `desktop-buddies-X.Y.Z-windows-x64.zip` holds one folder with the exe, the `app` folder, `README.txt`, `LICENSE`, `NOTICE`, `TRADEMARKS.md` and `THIRD-PARTY-NOTICES.txt`. The fonts' licences are in `app/fonts`. The packer refuses an exe that isn't an x64 Windows executable, an app folder with a buddy to seed, a font file (`.woff2`, `.woff`, `.ttf` or `.otf`) without an OFL text beside it, and a README for another version. `SHA256SUMS.txt` goes beside the zip.
9. **MSIX** with `apps/desktop/packaging/msix/msix.py`: the Microsoft Store's package, `desktop-buddies-X.Y.Z-x64.msix`, from the same exe and app folder, with `LICENSE`, `NOTICE`, `TRADEMARKS.md`, `THIRD-PARTY-NOTICES.txt` and icons drawn from the app's icon. Version `X.Y.Z.0`, by the Store's rule: each part at most 65535, the first at least 1, the last 0 (Microsoft's "Version numbering for Windows 10 and 11 packages"), so `0.y.z` is refused before anything is staged. Each Store submission needs a higher version than the last. MakePri and MakeAppx come from the runner's Windows SDK. It's unsigned, since the Store signs what it publishes, and its line goes in `SHA256SUMS.txt`. Until `apps/desktop/packaging/msix/identity.json` holds the Partner Center values, it warns that the identity is a placeholder, and the Store won't take it.
10. **Installer** with `installer.py`: `desktop-buddies-X.Y.Z-setup-x64.exe`, a per-user NSIS installer from Tauri's bundler (`tauri-cli` at the pinned version, built with `cargo install --locked`). It's built from the zip Pack made, and installs what the zip holds but its README into `%LOCALAPPDATA%\Desktop Buddies` for the one user, with no admin prompt: the exe, the `app` folder beside it, `LICENSE`, `NOTICE`, `TRADEMARKS.md` and `THIRD-PARTY-NOTICES.txt`, and a Start menu entry. `/S` installs and uninstalls silently, and the uninstaller leaves the buddies in `%APPDATA%`. The zip is unpacked into a staging folder, the bundler takes the exe and the files from there and is told not to patch or sign the exe, and its settings are merged in for this build only, so `tauri.conf.json` and the exe are the same as without it. The script then opens the installer with 7-Zip and checks it holds the zip's files, byte for byte, with nothing else in `app`. Its line goes into `SHA256SUMS.txt`.
11. **Draft** the GitHub release, after checking the tag still points at the commit that was built, that no release exists for it, and that every asset has its line in `SHA256SUMS.txt` and matches it. Only this job can write to the repo (`contents: write`, with the workflow's own token).

Release mode takes the exe the workflow built. Previews still take only the frozen exe in `apps/desktop/preview/exe.sha256`, so a preview never ships a new exe by accident.

## The Microsoft Store
The Store version is the MSIX from the draft, uploaded to Partner Center by hand as a new submission's package. Once the app is registered there, its Product identity page gives four values:
- **Package/Identity/Name** goes in `identity.json` as `name`.
- **Package/Identity/Publisher**, `CN=` and a GUID, goes in `identity.json` as `publisher`.
- **Package/Properties/PublisherDisplayName** goes in `identity.json` as `publisherDisplayName`. It's `exvanitas` now.
- **Package Family Name** goes in `tools/mcp/server.mjs` as `PACKAGE_FAMILY`. `msix.py --family` prints what the identity gives, and a test fails until the two agree.

`shell.yml` builds the same package from each run's exe with a test identity, signs it with a certificate it makes and throws away, installs it, and checks it (`apps/desktop/shell-check/store-package.ps1`).

## Turning on signing
The signing step is in the workflow, commented out, between the upload and the packing. Once SignPath has accepted the project:

1. **In SignPath:** make the project, with this repository as its source, and a GitHub Actions trusted build system. Give it an artifact configuration for the uploaded artifact, a zip holding `desktop-buddies.exe`, whose body is `<zip-file><pe-file path="desktop-buddies.exe"><authenticode-sign/></pe-file></zip-file>`. Make it the project's default, or name it with `artifact-configuration-slug`. Add a signing policy that signs with the SignPath Foundation certificate and needs an approver, and a CI user that may submit to it.
2. **In GitHub:** add the CI user's API token as the repository secret `SIGNPATH_API_TOKEN`.
3. **In the workflow:** uncomment the step and fill in its values, then set `EXE` in the Pack step to `signed/desktop-buddies.exe`. The Installer step takes the exe from the zip. The installer itself is a second file to sign, if SignPath takes it too.

The step's values:
- `api-token`: `${{ secrets.SIGNPATH_API_TOKEN }}`, the secret above. Never write the token itself in the workflow.
- `organization-id`: the SignPath organization's id, a GUID in its settings. The placeholder is all zeros.
- `project-slug`: the SignPath project's slug. The placeholder is `desktop-buddies`.
- `signing-policy-slug`: the signing policy's slug. The placeholder is `release-signing`.
- `github-artifact-id`: the unsigned exe's artifact, `${{ steps.unsigned.outputs.artifact-id }}`. Leave it as it is.
- `wait-for-completion` and `wait-for-completion-timeout-in-seconds`: the job waits up to an hour for an approver.
- `output-artifact-directory`: `signed`, where the signed exe lands for packing.

Once signing is on, the README's and `preview/README.txt`'s lines about unsigned builds need updating too.
