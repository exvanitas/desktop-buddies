# Test support

What tests share. Nothing here ships.

- `src/dom-assert.ts`: DOM checks that fail with a short message, never a deep diff.
- `fixtures/sample.json`: Olive, the sample buddy. She's the Maker's code-drawn Pip, warmed in colour and put through the Maker's own image pipeline, with a full set of poses and lines. Tests read her wherever they need a real buddy. `packages/maker-view/tests/browser/make-sample.mjs` draws her again; tests count her poses, frames and lines, so only do that on purpose.
- `art/`: images for the browser checks, all drawn in code. `pip` is the Maker's sample; `pudding` and `sprout` were samples until 1.0.0 and stay as test art. All are trimmed and saved as WebP. `derived` holds them recoloured, stretched or reduced to pixels, to fill a library and test extremes. `olive`, `derived/mint.webp`, the `test` images and `outlines.js` come from `art/make.py`, which also bakes the Python stand-in's cut lines that the Manager check compares with its own.
