/* The Maker store and the hub's `working`, on a wire of its own and a clock that moves only when
   told: a wait starts again while the hub gets somewhere, ends at 30 s when it doesn't, and once it
   has ended nothing the hub says brings it back. */
import assert from 'node:assert';
import { test } from 'vitest';
import type { Answer, Said } from '../src/manager-api';
import { createHubStore } from '../src/maker-store';
import { small } from './maker-harness';

const ANSWER_MS = 30000;

function rig() {
  let t = 0, hear: (m: Said) => void = () => {};
  const timers = new Set<{ at: number; f: () => void }>(), sent: Extract<Said, { k: 'do' }>[] = [];
  const store = createHubStore({
    session: 's', after: (ms, f) => { const x = { at: t + ms, f }; timers.add(x); return () => { timers.delete(x); }; },
    wire: { post: m => { if (m.k === 'do') sent.push(m); }, listen: f => { hear = f; }, close() {} }
  });
  const pass = (ms: number) => {
    const until = t + ms;
    for (;;) {
      const next = [...timers].filter(x => x.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers.delete(next); t = next.at; next.f();
    }
    t = until;
  };
  const say = (m: Said) => hear(m);
  const last = () => sent.at(-1)!;
  /* the timers waiting on an answer: ones that come due 30 s on */
  const answerTimers = () => [...timers].filter(x => x.at - t > ANSWER_MS - 20000).length;
  return { store, pass, say, last, sent, timers, answerTimers, now: () => t };
}
const turn = () => new Promise(r => setTimeout(r));
const OK: Answer = { ok: true };

test('an ask given up on at 30 s is forgotten: a working after it starts no timer and resolves nothing again', async () => {
  const r = rig();
  let answers = 0, got: Answer | null = null;
  void r.store.ask({ k: 'maker-open', id: 'c1' }).then(a => { answers++; got = a; });
  const id = r.last().id;
  r.pass(ANSWER_MS);
  await turn();
  assert.strictEqual(answers, 1);
  assert.strictEqual((got as Answer | null)?.ok, false);
  assert.deepStrictEqual(r.store.held(), { answers: 0, working: 0 }, 'nothing kept for it');
  const before = r.timers.size;
  r.say({ k: 'working', id });
  r.say({ k: 'done', id, answer: OK });
  r.pass(ANSWER_MS * 3);
  await turn();
  assert.strictEqual(r.timers.size, before, 'no new timer');
  assert.strictEqual(answers, 1, 'no second answer');
});

test('an ask answered is forgotten too, and a working after its answer does nothing', async () => {
  const r = rig();
  let answers = 0;
  void r.store.ask({ k: 'maker-open', id: 'c1' }).then(() => { answers++; });
  const id = r.last().id;
  assert.deepStrictEqual(r.store.held(), { answers: 1, working: 1 });
  r.pass(10000);
  r.say({ k: 'working', id });
  r.say({ k: 'done', id, answer: OK });
  await turn();
  assert.deepStrictEqual(r.store.held(), { answers: 0, working: 0 });
  assert.strictEqual(r.answerTimers(), 0, 'its wait is stopped');
  r.say({ k: 'working', id });
  assert.strictEqual(r.answerTimers(), 0, 'and not started again');
  assert.strictEqual(answers, 1);
});

test('a working for some other ask changes nothing: this one still gives up at 30 s', async () => {
  const r = rig();
  let got: Answer | null = null;
  void r.store.ask({ k: 'maker-open', id: 'c1' }).then(a => { got = a; });
  r.pass(20000);
  r.say({ k: 'working', id: 'someone-else:1' });
  r.pass(10000);
  await turn();
  assert.strictEqual((got as Answer | null)?.ok, false);
});

test('the edge, with nothing moving: no failure at 29.9 s, a failure at 30 s; a working at 29.9 s starts the 30 s again', async () => {
  const r = rig();
  let got: Answer | null = null;
  void r.store.ask({ k: 'maker-open', id: 'c1' }).then(a => { got = a; });
  const id = r.last().id;
  r.pass(29900); await turn();
  assert.strictEqual(got, null, 'not yet at 29.9 s');
  r.say({ k: 'working', id });
  r.pass(29900); await turn();
  assert.strictEqual(got, null, 'not 29.9 s after the working');
  r.pass(100); await turn();
  assert.strictEqual((got as Answer | null)?.ok, false, 'given up 30 s after the last working');
});

test('a save: no failure at 29.9 s, a failure at 30 s, its working forgotten then, and its late answer still lands', async () => {
  const r = rig();
  const states: string[] = [];
  r.store.onSave(s => { states.push(s.kind); });
  const pet = { ...small('c1'), id: 'p1' };
  const saving = r.store.save({ pets: [pet], bubbles: true, chatter: 'normal', names: true }).then(() => 'saved', () => 'not saved');
  r.pass(1000); /* its quiet second, then it goes */
  const id = r.last().id;
  assert.strictEqual(r.last().cmd.k, 'maker-save');
  assert.deepStrictEqual(r.store.held(), { answers: 1, working: 1 });
  r.pass(29900);
  assert.notStrictEqual(states.at(-1), 'failed', 'not at 29.9 s');
  r.pass(100);
  assert.strictEqual(states.at(-1), 'failed', 'at 30 s');
  assert.deepStrictEqual(r.store.held(), { answers: 1, working: 0 }, 'its answer still wanted, the working not');
  const before = r.timers.size;
  r.say({ k: 'working', id });
  assert.strictEqual(r.timers.size, before, 'a working after it starts nothing');
  r.say({ k: 'done', id, answer: { ok: true, value: { rev: 1 } } });
  assert.strictEqual(states.at(-1), 'saved', 'the late answer puts it right');
  assert.deepStrictEqual(r.store.held(), { answers: 0, working: 0 });
  r.pass(1000);
  assert.strictEqual(await saving, 'not saved', 'the save that was given up on said so at the time');
});
