# What a `.buddy` may contain

A `.buddy` goes from one person's machine to another's: through the gallery, a chat, an email. Whoever opens it should only ever get data: pictures and words, never something that runs, fetches or draws itself. This page sets out the rules and why, and which of them the app already keeps.

Two places check a file:
- **The app's reader**, `read()` in `packages/buddy-file`. Every import already goes through it.
- **The validator**, `pnpm validate-buddy`, in `packages/validate-buddy`. It runs `read()` first, then the checks below. The gallery runs it on every submission.

## What the reader already enforces
- **The envelope.** One JSON object, `{ app, version, buddy }`. `app` is `desktop-buddies`, and `version` is 1 or 2.
- **Unknown fields are refused**, at every level. Pose names come from the pose list, line sets from the situation list, and the kit's `mode` from its two values. A file can't carry anything the app doesn't know.
- **Numbers** are finite and in range. **The character id** is 1 to 64 of `A-Z a-z 0-9 _ -`.
- **`LIMIT` caps:**

| What | Cap |
|---|---|
| The file's text | 64,000,000 characters |
| One image, as its data URL | 8,000,000 characters, about 6 MB of bytes |
| Frames in one pose | 120 |
| Name | 64 characters |
| Lines in one situation | 64 |
| One line, and the signature line | 300 characters |
| Each kit field | 4,000 characters |
| Lift | half her size, either way |

- **Images are data URLs only:** `data:image/png`, `webp`, `jpeg` or `gif`, then `;base64,` and base64. There's no field for a link, so nothing in a file can make anyone fetch anything. An SVG, which can carry script, isn't one of the four, and neither is `text/html` or an `http:` address.
- **On import, `unpack()` reads each image's first bytes** and refuses anything that isn't one of the four, since the shell serves only those from the library and anything else could load as a page. It names the file on disk for what the bytes are, not what the file said.

## What the validator adds
The reader's checks stop at the first bytes of an image, and a picture's real cost is in its header.

### A gate, not a decoder
The validator is a fast first gate. It doesn't prove an image decodes. It keeps four promises:
- **What a decoder sizes memory from is bounded.** Every header field a decoder would size a buffer or a loop from is checked against the caps: the canvas, and every frame's rectangle. Each frame header is whole and inside the canvas.
- **Counts agree.** A declared frame count matches the frames that are there.
- **The format is what it says.** The bytes are one of the four, and the data URL names that one.
- **Cheap impossibilities are refused,** where the check is one line. The list is in the table below.

Anything that would only matter to a full decoder is out of scope: the compressed data itself, Huffman and quantisation tables, colour profiles, and most fields' values. Full decoding stays with a hardened decoder under resource limits: the gallery CI's thumbnail step, and the browser engine in the app.

| Rule | Why |
|---|---|
| **At most 64 MB on disk, read with the cap.** The file's size is checked before a byte is read, and the read stops one byte past the cap. | A huge file can't fill memory before it's refused. |
| **Only one plain file.** The last part of the path is never a link: it's refused when looked at, the open doesn't follow one where the system allows (`O_NOFOLLOW`), and the file opened must be the file looked at (device and inode), which also catches a swap on Windows. Folders, devices and pipes are refused before opening. Links in the folders above the file are followed, as the system resolves them. A zip is refused by its first bytes. | A `.buddy` is one JSON file. See "Folders and zips" below. The core, `validate(bytes)`, takes bytes, so the gallery and the app never need this path code. |
| **Strict UTF-8.** Stray bytes, overlong forms and encoded surrogates are refused. | The app's decoder would quietly replace them, so what a person saw in the gallery could differ from what the app shows. |
| **JSON nests at most 16 deep,** counted before `JSON.parse`. A real file goes 6 deep. | Deep nesting costs memory and time in every parser that reads it. |
| **Whole base64.** | The reader's pattern lets through a length that doesn't decode. |
| **Raster only, checked by the bytes.** Each image's structure is walked to its end, without decoding: PNG chunks, WebP's RIFF chunks (`VP8`, `VP8L`, `VP8X`), JPEG markers, GIF blocks. | The first bytes alone can front anything. |
| **The declared type is what the bytes are.** | A file that says PNG and holds a GIF is lying about something. |
| **At most 2048 px a side** for the canvas, checked the moment the header gives it. Every frame's rectangle must sit inside the canvas: APNG `fcTL`, WebP `ANMF`, GIF image descriptors. JPEG has one frame. | A 100,000 x 100,000 PNG is about 100 bytes and would need 40 GB to draw. |
| **At most 120 frames in one animated image** (GIF, animated WebP, APNG), and an APNG's `acTL` count matches its `fcTL` frames. | A frame costs a few bytes in the file and a whole canvas when drawn. |
| **At most 16.8 Mpx in one image,** canvas width x height x frames (2048 x 2048 x 4), checked on every image, still or not. | The same bomb, spread over frames instead of size. |
| **At most 537 Mpx across all of a file's images,** each distinct image once (2048 x 2048 x 128). | The bomb spread over many small files. The largest real file met so far uses 121 Mpx. |
| **At most 65,536 pieces in one image:** PNG and WebP chunks, JPEG segments and restart markers, GIF blocks and data sub-blocks. | Every walk is linear, and this keeps it short. |
| **Cheap impossibilities are refused:** a truncated structure; a length that runs past its container; a PNG chunk failing its checksum, a second `IHDR` or `acTL`, an unknown critical chunk, indexed colour without `PLTE`, image data in two runs, an `fcTL` that isn't 26 bytes or has an unknown dispose or blend; a WebP second `VP8X`, an `ANIM` that isn't 6 bytes, a frame holding a different size than it says; a JPEG segment too short to move past, a second frame, a scan before the frame, a frame or scan header whose length doesn't match its parts; a GIF LZW code size outside 2 to 8, a graphic control that isn't 4 bytes. | Each costs one line, and each is a sign the file wasn't made by an encoder. |
| **Nothing after the end:** no bytes after PNG's `IEND`, JPEG's `EOI`, GIF's trailer, or the RIFF size. | Trailing bytes are how a picture doubles as another kind of file. |

Every cap is in `packages/validate-buddy/src/caps.ts`.

## Text is only text
Names, lines, the kit and the signature line are words. The app and the gallery show them as text, never as HTML: `textContent`, not `innerHTML`, and escaped in any page the gallery builds. A name that becomes a file name goes through `saveName()`. Nothing else in a file is text anyone sees.

## Nothing runs, nothing is fetched
The validator never decodes a pixel, never draws, and never runs anything from the file. It reads structure from bytes, and that's all. The file can't name an address, so nothing is fetched.

## Folders and zips
Refused. A `.buddy` is one JSON file, and that's the only thing the gallery takes. A Shimeji folder is imported in the app, which makes a buddy of it, and the buddy it exports is what can be shared. A folder or zip mode would need its own rules for absolute paths, `..`, drive letters, links, duplicate names, and entry and byte counts, and nothing needs one yet.

## What the app's import should adopt
The validator's checks don't touch the DOM or Node, so the app can run them as they are: `validate()` from `@buddies/validate-buddy`.

| Rule | For the app? |
|---|---|
| Image headers, sizes, frames and pixel budgets | **Yes.** Today an import writes any image whose first bytes look right. A size bomb then waits in the library for the first page that draws it. |
| Strict UTF-8 | **Yes.** `text()` in `apps/desktop/src/shell.ts` replaces bad bytes today. |
| JSON depth | **Yes.** It's cheap. |
| Whole base64, nothing after the end | **Yes.** |
| Declared type matches the bytes | **Leave it.** The app relabels by the bytes on purpose, since a `.png` that's really WebP is a fair upload. The gallery refuses it so what it lists is exact. |
| Byte cap before reading | Partly: `read()` refuses an over-cap text, but only after it's been read. Whether the import path can check the size first wasn't looked at here. |

Whether to switch it on, and what to tell someone whose old file no longer imports, is the lead's call.

## The command
```
pnpm -s validate-buddy [--json] <file>...
```
- **Exit code:** 0 when every file is clean, 1 when any has a problem, 2 for bad usage.
- **Output:** one line per problem, `<file>: <where>: <what> [<code>]`, or `<file>: ok, ...` with counts and time. `--json` prints `{ files: [{ file, ok, bytes, images, pixels, ms, problems: [{ code, where, message }] }] }`.
- `-s` keeps pnpm's own banner out of the output. Paths are taken from where pnpm was run.

**Codes:** `too-big`, `zip`, `folder`, `symlink`, `not-file`, `unreadable`, `not-utf8`, `too-deep`, `not-json`, `reader` (the app's reader refused it, with its reason), `base64`, `not-image`, `type-mismatch`, `truncated`, `malformed`, `trailing`, `too-wide`, `too-many-frames`, `too-many-segments`, `image-pixels`, `total-pixels`. `internal` would mean a bug in the validator: the fuzz test holds it at zero.
