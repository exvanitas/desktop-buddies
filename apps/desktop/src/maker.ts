/* The Maker page. Its logic is in maker-page.ts, and the hub owns the library. */
import { createMakerView } from '@buddies/maker-view';
import { pageIO } from './maker-env';
import { mountMaker } from './maker-page';

const io = pageIO(createMakerView);
mountMaker(io);
void io.shell.log('maker page up');
