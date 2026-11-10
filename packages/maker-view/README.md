# Maker view

The Maker in Peel, by moment: `docs/design/round-1/peel/maker-moments.html` built for real. DOM on top of `createMaker()`. Spec: `docs/design/round-1/peel/DESIGN.md`.

## Hosting it
```ts
const view = createMakerView(root, maker, host, io);   // io is optional
await maker.start();
```
- `root` fills the window. Call `start()` after, so the view hears the first draw.
- The page's css is `peel.css` then `maker-view.css`, joined at build. In a vite config: `plugins: [peelSheet('maker.css', ['../../packages/maker-view/src/maker-view.css'])]`, with `peelSheet` from `packages/peel/build.ts`, as in `apps/desktop/vite.manager.config.ts`. It copies the fonts too.
- A CSP like the Manager's works: `style-src 'self'; img-src 'self' data:`. The view sets sizes through CSSOM, never style attributes.
- `MakerViewHost` in `src/host.ts` is what it asks of a host. `window`, `tryOnScreen`, `exportPage` and `onToast` can be absent, and on the web they are.
- `io.worldSettings` fills a place at the bottom of Look with settings about every buddy. The app leaves it out, because those belong to the Manager. A web page passes `everyoneSettings(maker)`, which also has the only remove button: nothing else in the view removes a buddy.

## Files
| To change | Look in |
|---|---|
| Which sheet a pose or situation is on, captions, the sequences | `src/moments.ts`, data. `tests/moments.test.ts` holds it to the engine |
| What the engine really does, read from its book | `src/facts.ts` |
| What a slot shows, stickers, how big | `src/art.ts`, `src/draw-art.ts` |
| How a pose plays | `src/playback.ts` |
| A page of the board | `src/board.ts`, `src/kit-page.ts`, `src/look-page.ts` |
| The tray | `src/tray.ts`, `src/frames.ts` |
| Everything else in the window | `src/view.ts` joins it, and each part has its own file |

## Tests
- `tests/moments.test.ts`: every pose and situation on one sheet, captions against the book and the engine's source.
- `tests/view.test.ts`: the view on the real Maker with fake art, in happy-dom.
- `pnpm test:maker-view`: the real view in headless Chromium with real art. It covers every function of `apps/maker/src/panel.js`, and renders and measures every state at 1180x680, 960x600 and 150%, in both themes. `--shots=dir` keeps the pictures, `--only=word` runs one part, `--no-shots` skips the renders.
