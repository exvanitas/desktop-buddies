/* The local API's test harness: the real hub on the fake exe, a page on the wire, and a clock the
   test moves. Shared by the local API's test files. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { read, type Buddy } from '@buddies/buddy-file';
import { replyPath } from '../src/api-replies';
import type { Message } from '../src/host';
import { createHub, type HubIO } from '../src/hub-core';
import type { Reply } from '../src/local-api';
import type { Answer, Command, HubState, Said } from '../src/manager-api';
import { text, type Monitor } from '../src/shell';
import { createFakeExe, type FakeExe, type FakeOptions } from '../src/shell-fake';
import { createBus } from '../src/wire';

/* By path, not URL: a page's own URL class stands in for Node's under happy-dom, and fs refuses it. */
export const SAMPLE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/test-support/fixtures/sample.json'), 'utf8');
export const SAMPLE_ID = read(SAMPLE).character!;
export const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
export const small = (character: string, name = 'Pip'): Buddy => ({ character, name, base: { src: 'base.png', bb: box }, poses: {} });
export const manifest = (id: string, name: string) => JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: small(id, name) });
export const monitor = (): Monitor => ({ i: 0, name: 'A', primary: true, scale: 1, x: 0, y: 0, w: 1920, h: 1040, full: { x: 0, y: 0, w: 1920, h: 1080 } });
export const tick = () => new Promise(r => setTimeout(r));

/* Olive out, Pip at home, unless `prepare` says otherwise. The clock is the test's. */
export async function setup(o: FakeOptions = {}, prepare?: (e: FakeExe) => Promise<void>, io: Partial<HubIO> = {}) {
  const exe = createFakeExe({ monitors: [monitor()], ...o, args: [...o.args ?? [], '--no-manager'] });
  await (prepare ?? (async e => {
    await e.shell.dataWrite(`library/${SAMPLE_ID}/buddy.json`, JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { ...read(SAMPLE), base: { src: 'base.png', bb: box }, poses: { wave: { frames: [{ src: 'w.png', bb: box }] } } } }));
    await e.shell.dataWrite('library/pip/buddy.json', manifest('pip', 'Pip'));
    await e.shell.dataWrite('settings.json', JSON.stringify({ out: [SAMPLE_ID] }));
  }))(exe);
  const sent: Message[] = [], timers: { ms: number; f: () => void }[] = [], bus = createBus<Said>(), page = bus.wire();
  const clock = { t: 1_000_000 };
  let state: HubState | null = null, n = 0;
  const answers = new Map<string, (a: Answer) => void>();
  page.listen(m => { if (m.k === 'state') state = m.state; else if (m.k === 'done') answers.get(m.id)?.(m.answer); });
  const hub = createHub({ shell: exe.shell, send: m => sent.push(m), seed: async () => SAMPLE, after: (ms, f) => { timers.push({ ms, f }); }, wire: bus.wire(), now: () => clock.t, ...io });
  await hub.start();
  const done = async () => { for (let i = 0; i < 6; i++) { await tick(); await hub.settled; } };
  await done();
  /* The Manager asking the hub, as a page would. */
  const command = async (cmd: Command) => {
    const id = `t${++n}`, a = new Promise<Answer>(r => answers.set(id, r));
    page.post({ k: 'do', id, cmd });
    const answer = await a; await done(); return answer;
  };
  let rid = 0;
  /* One request, as a second launch. A string goes as it is. */
  const launch = async (req: object | string) => {
    exe.emit('second-launch', { args: ['--api', typeof req === 'string' ? req : JSON.stringify(req)] });
    await done();
  };
  /* The reply in this id's slot, if it's this id's. */
  const replyTo = (id: string): Reply | undefined => { const f = exe.files.get(replyPath(id)); const r = f && JSON.parse(text(f)) as Reply; return r && r.id === id ? r : undefined; };
  /* A request from `app` with a fresh id, and its reply. */
  const ask = async (body: object, app = 'Claude Code') => {
    const id = `request-${++rid}`;
    await launch({ v: 1, id, app, ...body });
    return replyTo(id);
  };
  /* Another page on the hub's wire, for a real Manager view. */
  const wire = () => bus.wire();
  return { exe, hub, sent, timers, clock, done, command, launch, replyTo, ask, wire, get state() { return state!; } };
}
export type Run = Awaited<ReturnType<typeof setup>>;
export const managerOpens = (exe: FakeExe) => exe.calls.filter(c => c.cmd === 'window_open' && (c.args as { spec: { label: string } }).spec.label === 'manager').length;
export const errorOf = (r: Reply | undefined) => r && !r.ok ? r.error : r ? 'ok' : 'no reply';
/* Everything a request could change, to compare before and after. */
export const lasting = (s: Run) => JSON.stringify([...s.exe.files].filter(([p]) => !p.startsWith('api/')).map(([p, b]) => [p, text(b)]));
export async function allowed(app = 'Claude Code', io: Partial<HubIO> = {}) {
  const s = await setup({}, undefined, io);
  await s.command({ k: 'api', on: true });
  await s.ask({ do: 'list' }, app);
  await s.command({ k: 'api-answer', app, allow: true });
  return s;
}
