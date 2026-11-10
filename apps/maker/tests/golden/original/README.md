# The original engine

`engine.js` is the engine of the original web maker that this project grew from, copied byte for byte (`desktop-buddies/engine.js` at commit `6e32c15` of the project's private history). Its author, credited in NOTICE at the root, agreed to release it under the MIT licence.

The golden traces in `../traces.json` were recorded from it, and `golden.test.ts` replays it to show the first frame where the engine today paints something different. It's a test fixture: don't edit it.
