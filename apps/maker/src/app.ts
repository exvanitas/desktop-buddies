/* Page glue: the world, the browser's half of the Maker's I/O, and the panel. */
import { bottomOf, fromShimeji, matchScale, natSort, processBase, processFrames } from '@buddies/art';
import { createMaker, createSamples, indexedDbStore, poseFromFile, type MakerFile, type Paper, type Pen } from '@buddies/maker-core';
import { build, download } from './export';
import { createPanel } from './panel.js';
import { createWorld } from './web-host';

const $ = <E extends HTMLElement>(s: string) => document.querySelector<E>(s)!;
const desk = $('#desk');

let tt = 0;
function toast(m: string) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = window.setTimeout(() => { t.hidden = true; }, 3000); }

function readImage(f: MakerFile | null | undefined) {
  return new Promise<string | null>(res => {
    if (!f || !/^image\//.test(f.type)) return res(null);
    const rd = new FileReader(); rd.onload = () => res(rd.result as string); rd.onerror = () => res(null); rd.readAsDataURL(f as File);
  });
}
const paper: Paper = side => {
  const c = document.createElement('canvas'); c.width = c.height = side;
  return { pen: c.getContext('2d') as unknown as Pen, png: () => c.toDataURL('image/png') };
};

const ctl = createWorld({ root: $('#root'), bounds: () => ({ w: desk.clientWidth, h: desk.clientHeight }) });
/* For the console and the browser check. Nothing in here reads it. */
Object.assign(window, { buddies: Object.assign(ctl, { tools: { createWorld, poseFromFile, build } }) });

const art = { processBase, processFrames, matchScale, bottomOf, fromShimeji, natSort };
const maker = createMaker({
  store: indexedDbStore(() => indexedDB), world: ctl, art, samples: createSamples(paper, art), readImage,
  exportPage: state => download(state, toast), toast,
  after: (ms, f) => window.setTimeout(f, ms), cancel: id => clearTimeout(id), random: () => Math.random()
});
const panel = createPanel($('#panel'), maker, { toast });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files.length) void panel.addFiles([...e.dataTransfer.files]); });
void maker.start();
