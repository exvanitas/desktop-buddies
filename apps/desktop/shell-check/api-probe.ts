/* The local API's end-to-end run adds this to its own copy of the app, after manager.js and after
   overlay.js, with data-role saying which. It never ships. It reports through the app's log, in
   plain ASCII, and api-e2e.ps1 judges from that.
   - Manager: the driver writes e2e/task-<n>.json in the data folder; this does it with the real
     view's buttons, as the person would, and says PROBE DID <n> PASS|FAIL <detail>.
   - Overlay: each line an app asked her to say, as the bubble shows it, PROBE SAID <from> <text> in
     UTF-8 hex, PROBE WAVED <n> each time she starts a wave, and PROBE TAGS <seen> <of> each time
     the number of name tags seen changes. So a line that's never told explains itself: PROBE LINE
     UP <from> <text> pose=<pose> was=<held> when an app's line comes into her bubble, and PROBE
     LINE GONE <from> <text> after=<ms> by=<held> pose=<pose> when it leaves untold, a held being
     hidden, own:<text> or app:<from>:<text>, its text in hex. */
import { readManifest } from '@buddies/buddy-file';
import type { HubState } from '../src/manager-api';
import { createManagerClient } from '../src/manager-client';
import { MANAGER } from '../src/manager-window';
import { createShell, text } from '../src/shell';
import { broadcastWire } from '../src/wire';
import { ascii, hex, lineGone, lineUp, perform, watchOverlay, type Task } from './api-probe-core';

const shell = createShell(window.__TAURI__);
const say = (line: string) => shell.log('PROBE ' + line);
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const role = document.currentScript?.dataset.role;

async function manager() {
  const client = createManagerClient({
    wire: broadcastWire(), session: 'api-e2e' + Date.now(),
    after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); },
    shimeji: async () => null,
    closeWindow: () => shell.windowClose(MANAGER.label)
  });
  client.subscribe(() => {});
  const until = async (f: (s: HubState) => boolean) => {
    for (let i = 0; i < 200; i++) { if (client.state && f(client.state)) return true; await pause(50); }
    return false;
  };
  if (!await until(s => s.ready)) void say('manager never ready');
  /* A window opened again picks up after the last task done, never doing one twice. */
  const DONE = 'api-e2e-done';
  const first = Number(localStorage.getItem(DONE) ?? 0) + 1;
  void say(`manager up at task ${first}`);
  for (let n = first; ; n++) {
    let task: Task | null = null;
    while (!task) {
      task = await shell.dataRead(`e2e/task-${n}.json`).then(b => JSON.parse(text(b)) as Task, () => null);
      if (!task) await pause(100);
    }
    let r;
    try { r = await perform(task, { root: document.body, state: () => client.state, until }); }
    catch (e) { r = { ok: false, detail: `threw: ${e}` }; }
    localStorage.setItem(DONE, String(n));
    void say(`DID ${n} ${r.ok ? 'PASS' : 'FAIL'} ${ascii(r.detail)}`);
  }
}

/* Every buddy's images, each with the pose it's from, read from the library once there's one to read. */
async function poseImages() {
  const poses = new Map<string, string>(), waves = new Set<string>();
  for (const e of await shell.dataList('library')) {
    if (!e.dir || e.name.startsWith('.')) continue;
    try {
      const m = readManifest(text(await shell.dataRead(`library/${e.name}/buddy.json`)));
      for (const f of m.base ? [m.base] : []) poses.set(f.src, 'base');
      for (const [pose, p] of Object.entries(m.poses)) for (const f of p?.frames ?? []) poses.set(f.src, pose);
      for (const f of m.poses.wave?.frames ?? []) waves.add(f.src);
    } catch { /* not a whole buddy yet */ }
  }
  return { poses, waves };
}

async function overlay() {
  let poses = new Map<string, string>(), waves = new Set<string>(), looked = 0;
  const refresh = () => {
    if (waves.size || performance.now() - looked < 1000) return;
    looked = performance.now();
    void poseImages().then(s => { ({ poses, waves } = s); }, () => {});
  };
  refresh();
  const w = watchOverlay(document.getElementById('root')!, {
    said: (from, line) => { void say(`SAID ${hex(from)} ${hex(line)}`); },
    waved: n => { void say(`WAVED ${n}`); },
    isWave: name => { refresh(); return waves.has(name); },
    cannot: why => { void say(`CANNOT ${ascii(why)}`); },
    tags: (seen, of) => { void say(`TAGS ${seen} ${of}`); },
    up: (from, line, at) => { void say(lineUp(from, line, at)); },
    gone: (from, line, at) => { void say(lineGone(from, line, at)); },
    poseOf: name => { refresh(); return poses.get(name) ?? (name ? 'unknown' : 'none'); }
  });
  /* What changes outside the overlay's elements, or an animation ending, is seen at the next look. */
  setInterval(w.recheck, 1000);
  void say('overlay up');
}

void (async () => {
  try {
    if (role === 'manager') await manager();
    else if (role === 'overlay') await overlay();
    else void say(`no role: ${ascii(role)}`);
  } catch (e) { void say(`threw ${ascii(String(e))}`); }
})();
