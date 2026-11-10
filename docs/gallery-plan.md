# The buddy gallery: data, files and hosting

A plan only. No site, domain or repo exists yet; making them is the owner's step. The gallery is part of a later Desktop Buddies site on our host, with a landing page, links to the GitHub repo, and a short docs page on making your own buddy and on the local API and MCP. The app ships no buddies, so the gallery is where most people will find one. The approved shape is in `roadmap-plan.md`, section 2, and the file rules are in `buddy-format-safety.md`.

## One buddy's record
`buddies/<slug>/record.json` in the gallery repo.

| Field | What it holds |
|---|---|
| `slug` | The address part: `a-z 0-9 -`, 1 to 48, unique, never reused |
| `name` | Her name, from the file's `name` |
| `character` | The file's character id, so a new version is the same buddy |
| `artist` | `{ name, link }`. The link is `https:` only, and shown as text beside it |
| `uploader` | The GitHub login that opened the pull request |
| `licence` | One of the site's list |
| `artNotMine` | `true` when the uploader isn't the artist |
| `permission` | Required when `artNotMine`: how the artist said yes |
| `tags` | From the site's list, so search stays tidy |
| `poses` | How many poses have their own art |
| `bytes`, `sha256` | Of the current `.buddy` |
| `versions` | `[{ sha256, bytes, date }]`, newest last |
| `created`, `updated` | Dates |

The record's own fields are refused if unknown, the same rule as the file.

## Files
- `buddies/<slug>/<slug>.buddy`: the file, as submitted.
- `buddies/<slug>/thumb.webp`: made by CI from the main image, never submitted.
- `buddies/<slug>/preview.webp`: optional, an animated WebP of a few poses. Also made by CI, so the only file a person sends is the `.buddy`.

## CI on each submission
A submission is a pull request. On every push to it:
1. **Paths:** only files under one `buddies/<slug>/` may change. Anything else fails it.
2. **The file:** `pnpm -s validate-buddy --json` on the `.buddy`, from a pinned commit of this repo. Any problem fails it and is posted on the pull request.
3. **The record:** fields as above. `bytes` and `sha256` match the file, `name` and `character` match what `read()` gives, `licence` and `tags` come from the lists, and `artNotMine` has its `permission`.
4. **Thumbnail and preview:** made only after 2 passes, so every canvas and frame size the decoder allocates from is within the caps. The validator doesn't check the compressed data, so the decoder still runs with a memory and time cap of its own, and a decode error fails the submission.
5. **Review:** a person looks before merging. Nothing is public before that.

The workflow runs on `pull_request`, without secrets, and never runs anything from the submission. A public gallery repo gets GitHub's standard runners free; this repo's Actions were blocked by billing in November 2026, so a private gallery repo would need that fixed or a runner of our own.

## Hosting
- **First, static:** the repo builds a static site, an index (`index.json`) and a page per buddy, served from a static site on our host, for example `buddies.exvanitas.ai`. Downloads need no account.
- **Serving:** `.buddy` files go out as `application/octet-stream` with `Content-Disposition: attachment`, with `X-Content-Type-Options: nosniff` on everything, and a content security policy allowing only the site's own files.
- **Later, if wanted:** a dynamic upload service on the same host, with its own login, storage and a moderation queue. Its uploads go through the same validator.
- **The look:** the project's own, laid out as a tool. Not built yet.
- **Analytics and link previews:** per the public-site standard. The analytics ID is injected at deploy and never kept in the repo.
- **Reports and takedowns:** a report link on every buddy, and a published takedown contact.

## Open questions for the owner and the project manager
From the roadmap plan:
1. Public from the start, or invite-only at first?
2. The gallery's name, and which sub-domain of exvanitas.ai?
3. Is submitting with a GitHub account fine at first?
4. Content rules: is explicit art allowed? Anything else banned?
5. Which licences should the site offer? Is "art not mine" allowed at all, and with what proof of permission?
6. Who moderates?
7. Should the project manager's name or brand be on the gallery?

New from this work:

8. Should the app's import run the validator too? `buddy-format-safety.md` lists which rules fit.
9. Is the preview made by CI enough, or may uploaders send their own?
