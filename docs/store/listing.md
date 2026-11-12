# Microsoft Store listing

What to paste into Partner Center for the Desktop Buddies MSIX submission, field by field, in the order Partner Center shows them. Each field's text is in a box, ready to copy. Limits are Microsoft's, from the pages listed at the bottom, and `tools/store/tests/listing.test.mjs` checks every box against its limit. Facts about the app point to the code or doc they rest on.

The owner fills Partner Center in by hand. Nothing here is submitted by a script.

## Before the first submission
1. Reserve the name **Desktop Buddies** in Partner Center. The package's identity (name, publisher) comes from there and goes into the package.
2. Make the sample buddy and attach it to the GitHub release the testers will use:
   ```
   pnpm store:sample
   ```
   This writes `desktop-buddies-sample.buddy`, the repo's code-drawn sample (Olive), checked as the app checks a file. `--from <file>` exports another buddy instead, so the sample can be swapped without changing anything else here. Upload it to the release as `desktop-buddies-sample.buddy`, so the link in the notes for certification works.
3. Make the screenshots if anything in the app's look changed: `pnpm store:shots`. See [Screenshots](#screenshots).

## Properties

### Category
Entertainment. It has no subcategories. No secondary category.

Entertainment is "apps which entertain and/or provide information through audio, visual or other content types". Personalization was the other candidate, but its subcategories are ringtones, themes and wallpapers.

### Privacy policy
Answer **No** to "does it access, collect or transmit personal information": the app sends nothing and collects nothing (README, Network use; [PRIVACY.md](../../PRIVACY.md)). Give the URL anyway. Store Policy 10.5.1 says Win32 products "must always have privacy policies", and this is one.

```text
https://github.com/exvanitas/desktop-buddies/blob/main/PRIVACY.md
```

### Website
```text
https://github.com/exvanitas/desktop-buddies
```

### Support contact info
A URL, never an email. The field takes either.

```text
https://github.com/exvanitas/desktop-buddies/issues
```

### Product declarations
- **Purchases outside the Store's commerce system:** leave unticked. The app sells nothing.
- **Tested to meet accessibility guidelines:** leave unticked. It hasn't been tested to that list (Narrator, High Contrast, Inspect).
- **Install to alternate drives:** leave ticked, the default.
- **OneDrive backups:** leave ticked, the default.
- **Pen and ink:** leave unticked.
- **Generative AI features:** leave unticked. The app runs no AI model and calls none. The Maker's prompt kit only writes text for you to take to an image AI yourself, and the local API lets other programs on the PC, AI agents among them, show a line of their own in a bubble when you allow it. See [Decisions for the owner](#decisions-for-the-owner).

### System requirements
Leave the hardware table empty. The app needs nothing beyond a PC: buddies get about by themselves, and a mouse or touchpad is how you pick them up.

The OS and architecture come from the package: Windows 10 or 11, 64-bit (README, Install).

## Age ratings
Partner Center asks the International Age Rating Coalition's (IARC) questionnaire, and the questions themselves aren't published: Microsoft's page describes only how it works. The answers below are for the topics IARC asks about. Pick the matching option for each question as it's worded on the day, and read its info icon.

The first question is the kind of product. Choose the app type that fits an entertainment app or "other" app, **not** a game, a social or communication app, or a browser.

| Topic | Answer | What it rests on |
|---|---|---|
| Violence | See [Decisions for the owner](#decisions-for-the-owner): mild and comic at most. | You can drag and throw a buddy. She lands, may be dizzy for a moment, and says a line like "Ouch!" from her own list. A buddy can also have a Knocked out pose. The sample is a cartoon chick and draws no blood or injury. The sample's lines are in `packages/test-support/fixtures/sample.json`. |
| Fear, horror | No | Nothing in the app's own content. |
| Sexual content, nudity | No | Nothing in the app's own content. |
| Language (swearing) | No | The sample's lines have none. A buddy's lines are whatever the person who made her wrote. |
| Drugs, alcohol, tobacco | No | Nothing in the app's own content. |
| Gambling, simulated gambling | No | None. |
| Crude humour | No | None. |
| Users interact or exchange content with other users | No | The app has no network use of any kind: no accounts, chat, sharing or uploads (README, Network use; SECURITY.md). A `.buddy` file only moves between people outside the app, as any file does. |
| Shares the user's location | No | It never reads location. It reads where windows are on the screen, which isn't a place (PRIVACY.md). |
| Shares personal information with third parties | No | It sends nothing anywhere (README, Network use; PRIVACY.md). |
| Digital purchases | No | It sells nothing and has no store or add-ons. |
| Ads | No | None. |
| Unrestricted internet or web browser | No | It shows no web pages and fetches nothing. Each page's Content-Security-Policy lets it connect only to the app itself (`apps/desktop/public/*.html`). |
| User-generated content | No, in IARC's and the Store's sense | Store Policy 11.12 defines it as content "viewed or accessed by other users in an online state". Buddies people make or import stay on their own PC: the library is a folder in the app's data folder (`apps/desktop/README.md`, The library). |

Two facts to keep in mind while answering, so nothing is missed:
- **The local API is off by default.** When the person turns it on and allows an app, other programs on the same PC can show a line of up to 120 characters, with no links, in a buddy's bubble under a "From <app>" badge. Nothing outside the PC can reach it ([docs/local-api.md](../local-api.md)).
- **Content the person adds stays on their PC.** Pictures and lines in a buddy are the person's own, or come from a file they chose to open.

## Store listing (English)

### Product name
Pick the reserved name. Microsoft recommends the same name as the package's display name, which is Desktop Buddies.

```text
Desktop Buddies
```

### Description
Plain text, up to 10,000 characters. No links in it: Microsoft asks for those in their own fields.

```text
Little characters that live on your Windows desktop. They walk along your windows, climb the sides, hang underneath, nap, chat and get thrown about.

No buddies come with the app: open a .buddy file someone shared, make your own in the Maker from one picture or a full set of poses, or bring in a Shimeji folder.

Buddies on your desktop
One world across all your monitors. Buddies walk along your windows, climb the sides, hang underneath, nap and chat, and ride along when you move a window. Drag them and throw them. Right-click one to give her a treat, have her chase your mouse, or call another copy.

The Manager
Call buddies out and send them home, call more copies, and import, export or delete them. Settings can turn walking on windows off, or keep buddies off one program.

The Maker
Make a buddy from one image or a full set of poses. Write what she says for each mood and moment, set how she sits on floors, walls and ceilings, and try her out on your screen. A prompt kit helps you ask an image AI for matching poses.

Yours, and on your PC
No accounts, ads, purchases, analytics, update checks or telemetry. The app sends nothing anywhere. To use your windows as terrain it reads which windows are open, where they are and which program each belongs to, never their titles or contents, and none of it leaves your PC.

For tinkerers
A local API, off by default, lets apps and AI agents on your PC ask buddies to wave or say a line, after you allow each app. An MCP server for it is in the source repository.

Free and open source, under the MIT licence.
```

### What's new in this version
Leave it empty for the first submission, as Microsoft asks. For an update, paste that version's CHANGELOG section, trimmed to fit 1,500 characters.

### Product features
Up to 20, each up to 200 characters. One per line here: paste each into its own box, with no bullet.

```text
One world across all your monitors
Buddies walk on your windows, climb the sides and hang underneath
Drag them, throw them, give a treat, or let one chase your mouse
Call buddies out, call more copies, and send them home
Make a buddy from one picture or a full set of poses
Write what she says for each mood and moment
Bring in Shimeji folders
Share a buddy as one .buddy file
Keep buddies off any program, or off windows altogether
Dark and light themes
A local API for apps and AI agents on your PC, off by default
No accounts, ads or purchases, and no network use
Free and open source (MIT)
```

### Screenshots
Desktop, 1920x1080 PNG, in this order. Each caption is up to 200 characters.

| File | Caption |
|---|---|
| `screenshots/01-manager.png` | The Manager: call buddies out, send them home, and bring in new ones. |
| `screenshots/03-desktop.png` | Buddies walk on your windows, climb the sides and chat. |
| `screenshots/02-maker.png` | The Maker: her poses, and what she says when. |
| `screenshots/04-settings.png` | Settings: keep buddies off a program, and let other apps ask them to wave, only if you allow it. |
| `screenshots/05-maker-light.png` | The Maker in the light theme. |

The captions in a box, in the same order, for pasting:

```text
The Manager: call buddies out, send them home, and bring in new ones.
Buddies walk on your windows, climb the sides and chat.
The Maker: her poses, and what she says when.
Settings: keep buddies off a program, and let other apps ask them to wave, only if you allow it.
The Maker in the light theme.
```

What they show:
- **01-manager:** the real Manager page on the real hub, with the sample in the library and out on the desktop, standing on a window beside it.
- **02-maker:** the real Maker page, editing her on the Feelings sheet.
- **03-desktop:** three copies of her, drawn by the real view from the real world, on a drawn desktop: one on a window, one climbing a window's side, one thinking aloud.
- **04-settings:** the Manager's Settings, with Walk on windows, three programs to stay off, and the local API on with one app allowed.
- **05-maker-light:** the Maker in the light theme, on the Hanging around sheet.

`pnpm store:shots` makes them again (`tools/store/screenshots.mjs`). The desktop and its windows are drawn: a plain wallpaper, a taskbar and boxes with no words in them, never anyone's real desktop. The buddy is one input, `--sample <file>`, the repo's code-drawn sample by default. The same buddy gives the same pictures, byte for byte. On Windows, speech bubbles use Windows' own font; these show the Linux one they were made on.

### Store logos
Partner Center asks for these, all optional for an app:

| Image | Size | Where it comes from |
|---|---|---|
| 1:1 App tile icon | 300x300 PNG | **Not in the package.** Upload one made from the app icon. Microsoft "strongly recommends" it, and uses it before the package's. |
| 16:9 Super hero art | 1920x1080 or 3840x2160 PNG | Not in the package. Recommended. It must have no text, should avoid showing the app's UI, and keeps key things out of the bottom third. |
| 2:3 Poster art, 1:1 Box art | 720x1080, 1080x1080 | Games only. Skip. |
| Xbox and Holographic images | | Skip: the app is for desktop PCs. |

The package carries the logos Windows itself uses, all made from the app icon: Square44x44Logo (with target sizes 16, 24, 32, 48 and 256, plated and unplated), Square71x71Logo, Square150x150Logo, Wide310x150Logo, Square310x310Logo and StoreLogo (50x50), each at scale 100, 125, 150, 200 and 400. The Store falls back to these where no Store logo is uploaded.

### Trailers
None.

### Short description
Up to 1,000 characters, and best under 270, as some views show only that much.

```text
Little characters that live on your desktop. They walk on your windows, climb, nap, chat and get thrown about. Make your own from one picture in the built-in Maker, or bring in a Shimeji folder.
```

### Additional system requirements
Leave empty. Nothing beyond the PC is needed.

### Keywords
Up to 7, each up to 40 characters (Microsoft's FAQ elsewhere says 30, so each stays under 30), and no more than 21 words across all of them.

```text
desktop pet
shimeji
virtual pet
desktop mascot
screen pet
desktop companion
animated characters
```

### Copyright and trademark info
Up to 200 characters. LICENSE names the copyright holder and this line doesn't: add the name from LICENSE if you'd like it here.

```text
Code copyright 2026, under the MIT licence: see LICENSE. The Desktop Buddies name, logo and mascot are not covered by it: see TRADEMARKS.md.
```

### Additional license terms
Up to 10,000 characters of plain text, or one URL shown as a link. Plain text here, so both pages are named: the Store shows the addresses as text, not links.

```text
Desktop Buddies is free and open source. Its code is under the MIT licence: https://github.com/exvanitas/desktop-buddies/blob/main/LICENSE

The Desktop Buddies name, logo, mascot and official buddies are not covered by that licence: https://github.com/exvanitas/desktop-buddies/blob/main/TRADEMARKS.md

Buddies you make are yours. The bundled fonts are under the SIL Open Font License 1.1.
```

Leaving this empty would put the app under Microsoft's Standard Application License Terms. The MIT licence is what the code is under, so it goes here.

### Developed by
Up to 255 characters. "Published by" always shows the account's publisher display name.

```text
exvanitas
```

## Submission options

### Notes for certification
```text
Desktop Buddies has no sign-in, no accounts and no network use. It ships with no characters ("buddies"), so the Manager opens on an empty library. To try it:

1. Download the sample buddy, a .buddy file made from the app's own code-drawn test sample:
https://github.com/exvanitas/desktop-buddies/releases/latest/download/desktop-buddies-sample.buddy
2. Double-click the file: the app adds her and calls her out onto the desktop. Or, in the Manager, click Import, choose the file, then click her picture to call her out.
3. She walks along open windows, climbs their sides and naps. Drag her and throw her. Right-click her for her actions (give a treat, chase the mouse, call another, dismiss).
4. In the Manager, New buddy opens the Maker, which makes a buddy from any picture. Settings is at the bottom right.
5. Closing the Manager leaves the app running in the notification area. Its tray icon opens the Manager again, and Quit is in the tray menu.

The local API is off by default. When turned on in Settings, other programs on the same PC can ask buddies to wave or say a line, after the user allows each one in the Manager. Nothing listens on any network address.

runFullTrust: Desktop Buddies is a desktop app (Tauri, on WebView2). It draws transparent, always-on-top overlay windows across monitors that take the mouse only over a character, reads the list of open windows (position and owning program only, never titles or contents) so characters can walk on them, and keeps a tray icon. These need a full-trust desktop process.
```

### Restricted capabilities
If Partner Center asks why the package declares `runFullTrust`, paste the last paragraph of the notes above.

## Decisions for the owner
- **Violence in the age questionnaire.** Throwing a buddy, with her dizzy or knocked-out pose and an "Ouch!", may count as mild cartoon or comic violence. Answering yes to the mildest option is the safe reading. IARC sets the rating from the answers.
- **The privacy question.** "No" above is the plain reading: the app collects and sends nothing, and an exe name of a window isn't personal information. Store Policy 10.5.1 also says Win32 products inherently have access to personal information. If you read the question that way, answer Yes: the privacy policy URL is the same either way.
- **"shimeji" as a keyword.** The app imports Shimeji folders, so it's accurate, but Microsoft asks to avoid others' brand names. It's a project and genre name rather than a company's brand; drop it if you'd rather not.
- **The empty first run.** Store Policy 10.1.1 asks that "the value proposition of your product must be clear during the first run experience". The Manager opens empty, with Import and New buddy. The notes point testers to the sample. If certification still calls it incomplete, a Store build could seed the sample on first run: `apps/desktop/public/seed.json` exists for that, but the release packer refuses an app folder with a seed today.
- **Generative AI declaration.** Left unticked above, because the app runs and calls no model. Tick it only if you read the local API's lines from AI agents as the app's own.
- **The sample's name in the notes.** The notes never name her, so swapping the sample changes nothing in them.
- **Markets and price.** Free, and every market, unless you choose otherwise.

## Where the docs were unclear
- **Keywords:** the MSIX page says 7 keywords of up to 40 characters and 21 words in all; an older FAQ says 30 characters. Each keyword here is under 30.
- **Age ratings:** Microsoft doesn't publish IARC's questions, only that the first one is the product's kind and the rest follow from it.
- **Privacy policy question:** Microsoft marks it Yes itself when the package declares capabilities that could reach personal information. Whether `runFullTrust` triggers that isn't said. The URL is given either way.
- **Store logo FAQ:** the screenshots page's FAQ calls a Store logo "mandatory", while its own Store logos section calls them all optional for apps. The 300x300 tile icon is recommended here either way.
- **Developed by:** 255 characters on the MSIX page, with nothing about the form it takes.

## Sources
Read on 2026-11-12.
- [Add and edit Store listing info for MSIX app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info): product name, description, what's new, product features, short description, additional system requirements.
- [Add additional information for MSIX app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information): keywords, copyright and trademark info, additional license terms, developed by.
- [App screenshots, images, and trailers for MSIX app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images): screenshots, captions, Store logos, hero art.
- [Enter app properties for MSIX app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/enter-app-properties), [Categories and subcategories](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/categories-and-subcategories), [Product declarations](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/product-declarations), [System requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/system-requirements).
- [Support info for MSIX app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info): privacy policy, website, support contact info.
- [Age ratings for MSIX app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/age-ratings).
- [Manage submission options for MSIX app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options): notes for certification, restricted capabilities.
- [Microsoft Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies): 10.1.1, 10.5.1, 11.11 and 11.12.
- [How packaged desktop apps run on Windows](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes): where the Store version's data goes, for PRIVACY.md.
