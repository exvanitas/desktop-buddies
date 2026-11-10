# Releases

Releases are `.exe` builds attached to the repo's GitHub releases: the exe and its `app` folder in one zip, built and packed by `.github/workflows/release.yml`. No buddies are included. Signing starts once the repo is public; until then, builds are unsigned.

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
1. **Bump the version** in three places, in one commit: `version` in `package.json`, a new top section `## X.Y.Z (date)` in `CHANGELOG.md`, and the first line of `apps/desktop/preview/README.txt`, `Desktop Buddies X.Y.Z`. The CHANGELOG section becomes the release notes.
2. **Tag it** `vX.Y.Z` and push the tag. The workflow refuses a tag that doesn't match all three.
3. **Review the draft.** The workflow makes a draft release for the tag, with the zip, `SHA256SUMS.txt` and the notes. Download the zip, check it, and publish the draft by hand. Nothing is public until then.

To build a tag again, after a failed run, start the workflow by hand with the tag. The workflow never changes a release that exists, draft or published: if the tag has a draft, delete the draft first. A published release stays as it is, and the fix is a new version.

## What the workflow does
It runs on GitHub-hosted runners only, as SignPath requires. Every action is pinned to a full commit, with its version in a comment.

1. **Fix the commit:** a pushed tag builds the commit it was pushed at. A manual run looks the tag up once, and every job then builds that commit.
2. **Check** the tag against `package.json`, the CHANGELOG's top section and the README (`tools/release/version.py`), before anything slow.
3. **Test** on `ubuntu-latest`, as `ci.yml` does: `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`. The suite isn't Windows-portable yet.
4. **Build** on `windows-latest`, once the tests pass: the app folder (`pnpm --filter @buddies/desktop build`), `cargo test --locked` on `shell-core`, and `cargo build --release --locked` in `apps/desktop/src-tauri`. Node 22, pnpm from `packageManager` in `package.json`, Rust at the version in the workflow. Nothing is cached.
5. **Notices:** cargo-about, at the pinned version, writes `THIRD-PARTY-NOTICES.txt` for the crates in the exe, from `tools/release/about.toml` and `about.hbs`. `about.toml` accepts only the licences those crates use today (MIT, Apache-2.0, BSD-3-Clause, MPL-2.0, Unicode-3.0 and Zlib), so a crate with any other licence fails the build until someone looks.
6. **Upload** the unsigned exe as a workflow artifact.
7. **Sign:** not yet. See below.
8. **Pack** with `preview.py --release`. The zip `desktop-buddies-X.Y.Z-windows-x64.zip` holds one folder with the exe, the `app` folder, `README.txt`, `LICENSE`, `NOTICE`, `TRADEMARKS.md` and `THIRD-PARTY-NOTICES.txt`. The fonts' licences are in `app/fonts`. The packer refuses an exe that isn't an x64 Windows executable, an app folder with a buddy to seed, a font file (`.woff2`, `.woff`, `.ttf` or `.otf`) without an OFL text beside it, and a README for another version. `SHA256SUMS.txt` goes beside the zip.
9. **Draft** the GitHub release, after checking the tag still points at the commit that was built and that no release exists for it. Only this job can write to the repo (`contents: write`, with the workflow's own token).

Release mode takes the exe the workflow built. Previews still take only the frozen exe in `apps/desktop/preview/exe.sha256`, so a preview never ships a new exe by accident.

## Turning on signing
The signing step is in the workflow, commented out, between the upload and the packing. Once SignPath has accepted the project:

1. **In SignPath:** make the project, with this repository as its source, and a GitHub Actions trusted build system. Give it an artifact configuration for the uploaded artifact, a zip holding `desktop-buddies.exe`, whose body is `<zip-file><pe-file path="desktop-buddies.exe"><authenticode-sign/></pe-file></zip-file>`. Make it the project's default, or name it with `artifact-configuration-slug`. Add a signing policy that signs with the SignPath Foundation certificate and needs an approver, and a CI user that may submit to it.
2. **In GitHub:** add the CI user's API token as the repository secret `SIGNPATH_API_TOKEN`.
3. **In the workflow:** uncomment the step and fill in its values, then set `EXE` in the Pack step to `signed/desktop-buddies.exe`.

The step's values:
- `api-token`: `${{ secrets.SIGNPATH_API_TOKEN }}`, the secret above. Never write the token itself in the workflow.
- `organization-id`: the SignPath organization's id, a GUID in its settings. The placeholder is all zeros.
- `project-slug`: the SignPath project's slug. The placeholder is `desktop-buddies`.
- `signing-policy-slug`: the signing policy's slug. The placeholder is `release-signing`.
- `github-artifact-id`: the unsigned exe's artifact, `${{ steps.unsigned.outputs.artifact-id }}`. Leave it as it is.
- `wait-for-completion` and `wait-for-completion-timeout-in-seconds`: the job waits up to an hour for an approver.
- `output-artifact-directory`: `signed`, where the signed exe lands for packing.

Once signing is on, the README's and `preview/README.txt`'s lines about unsigned builds need updating too.
