/* Stands in for maker.js in the browser check: the real page logic and the real page environment,
   with the Maker put where the check can reach it. */
import { pageIO } from '../../src/maker-env';
import { mountMaker } from '../../src/maker-page';
import { createMakerView } from '@buddies/maker-view';

Object.assign(window, { M: mountMaker(pageIO(createMakerView)) });
