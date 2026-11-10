/* What only a real page has, for mountMaker: the same for the Maker page and the smoke run's probe. */
import { bottomOf, fromShimeji, matchScale, natSort, processBase, processFrames } from '@buddies/art';
import { build } from '../../maker/src/export';
import { createSamples, type MakerFile, type Paper, type Pen } from '@buddies/maker-core';
import type { MakerBoot } from './manager-api';
import { closingDialog } from './maker-closing';
import type { MakerPageIO, MakerView } from './maker-page';
import { cspSeen, errorSeen, rejectionSeen } from './log-safe';
import { createShell } from './shell';
import { broadcastWire } from './wire';

const art = { processBase, processFrames, matchScale, bottomOf, fromShimeji, natSort };
const paper: Paper = side => {
  const c = document.createElement('canvas'); c.width = c.height = side;
  return { pen: c.getContext('2d') as unknown as Pen, png: () => c.toDataURL('image/png') };
};
function readImage(f: MakerFile | null | undefined) {
  return new Promise<string | null>(res => {
    if (!f || !/^image\//.test(f.type)) return res(null);
    const rd = new FileReader(); rd.onload = () => res(rd.result as string); rd.onerror = () => res(null); rd.readAsDataURL(f as File);
  });
}

export function pageIO(view: MakerView): MakerPageIO {
  const shell = createShell(window.__TAURI__);
  addEventListener('error', e => { void shell.log(`maker error ${errorSeen(e)}`); });
  addEventListener('unhandledrejection', e => { void shell.log(`maker rejected ${rejectionSeen(e)}`); });
  addEventListener('securitypolicyviolation', e => { void shell.log(`maker error csp ${cspSeen(e)}`); });
  return {
    shell, view, art, readImage, samples: createSamples(paper, art), buildPage: build,
    wire: broadcastWire(),
    session: Date.now().toString(36) + Math.random().toString(36).slice(2),
    boot: (window.__BUDDIES__ ?? { n: 0 }) as MakerBoot,
    root: document.getElementById('root')!, closing: closingDialog(),
    after: (ms, f) => window.setTimeout(f, ms), cancel: id => clearTimeout(id), random: () => Math.random(),
    onLeaving: f => addEventListener('pagehide', f)
  };
}
