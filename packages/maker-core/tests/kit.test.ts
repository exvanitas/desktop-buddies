/* The prompt kit on a buddy: its fields, the reply it takes, and the sheet of prompts. */
import assert from 'node:assert';
import { LINES } from '@buddies/engine';
import { test } from 'vitest';
import { DEFAULT_KIT, NEGATIVE, kitOf, promptSheet, type ImagePrompt } from '../src';
import { buddy, started } from './harness';

test('reading a kit fills in the defaults on the buddy', () => {
  const p = buddy({ kit: { personality: 'shy' } });
  const k = kitOf(p);
  assert.strictEqual(k.personality, 'shy');
  assert.strictEqual(k.quality, DEFAULT_KIT.quality);
  assert.strictEqual(p.kit, k);
});

test('a buddy with no kit gets one by being read', () => {
  const p = buddy();
  kitOf(p);
  assert.deepStrictEqual(p.kit, DEFAULT_KIT);
});

test('kit fields change on the slow save, and tell the view to redo the prompts', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.setKitField('personality', 'grumpy'); h.maker.setKitField('appearance', 'round'); h.maker.setKitField('quality', 'best');
  assert.deepStrictEqual([p.kit!.personality, p.kit!.appearance, p.kit!.quality], ['grumpy', 'round', 'best']);
  assert.strictEqual(h.saves(), 0);
  assert.deepStrictEqual(h.changes.at(-1), { scope: 'prompts', pet: p });
  h.tick(250);
  assert.strictEqual(h.saves(), 1);
});

test('the style field writes to whichever mode is on', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.setKitField('style', 'tagged');
  h.maker.setKitMode('text');
  h.maker.setKitField('style', 'written');
  assert.deepStrictEqual([p.kit!.styleTags, p.kit!.styleText], ['tagged', 'written']);
});

test('the mode saves now, and only takes tags or text', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.setKitMode('text');
  assert.strictEqual(p.kit!.mode, 'text');
  assert.strictEqual(h.saves(), 1);
  assert.deepStrictEqual(h.changes.at(-1), { scope: 'kit', pet: p });
  h.maker.setKitMode('poems');
  assert.strictEqual(p.kit!.mode, 'text');
  assert.strictEqual(h.saves(), 1);
});

test('no appearance, no image prompts', async () => {
  const h = await started();
  assert.strictEqual(h.maker.imagePromptsFor(h.maker.current()!), null);
});

test('image prompts follow the way the buddy faces', async () => {
  const h = await started([buddy({ faces: 'left', kit: { appearance: 'round, green' } })]);
  const walk = h.maker.imagePromptsFor(h.maker.current()!)!.find(x => x.file === 'walk_1')!;
  assert.match(walk.text, /facing left/);
});

test('the dialogue prompt carries the name and the character', async () => {
  const h = await started([buddy({ kit: { personality: 'A sleepy spirit' } })]);
  const text = h.maker.dialoguePromptText()!;
  assert.match(text, /character named "Ann"/);
  assert.match(text, /A sleepy spirit/);
});

test('current lines are the buddy\'s own, then the defaults', async () => {
  const h = await started([buddy({ lines: { chat: ['mine'] } })]);
  const o = JSON.parse(h.maker.currentLines()!);
  assert.deepStrictEqual(o.chat, ['mine']);
  assert.deepStrictEqual(o.hello, LINES.hello);
});

test('why a reply was refused is kept for a view, until a reply is applied', async () => {
  const h = await started();
  assert.strictEqual(h.maker.replyProblem(), null);
  h.maker.applyReply('sorry, no');
  assert.strictEqual(h.maker.replyProblem(), "Couldn't read that: No JSON object found in the reply");
  h.maker.applyReply('{"chat": ["a"]}');
  assert.strictEqual(h.maker.replyProblem(), null);
});

test('with nobody selected there is no prompt and no lines', async () => {
  const h = await started([]);
  assert.strictEqual(h.maker.dialoguePromptText(), null);
  assert.strictEqual(h.maker.currentLines(), null);
  assert.strictEqual(h.maker.applyReply('{"chat":["x"]}'), false);
  h.maker.resetLines();
  assert.deepStrictEqual(h.toasts, []);
});

test('a reply adds to the lines, says what it did, and the buddy waves', async () => {
  const h = await started([buddy({ lines: { hello: ['kept'], chat: ['old'] } })]), p = h.maker.current()!;
  assert.strictEqual(h.maker.applyReply('Sure!\n```json\n{"chat": ["a", "b"]}\n```'), true);
  assert.deepStrictEqual(p.lines, { hello: ['kept'], chat: ['a', 'b'] });
  assert.deepStrictEqual(h.toasts, ['Applied 2 lines across 1 situations']);
  assert.strictEqual(h.saves(), 1);
  h.tick(300);
  assert.deepStrictEqual(h.acts, [[p.id, 'wave']]);
});

test('a reply fills in a blank appearance', async () => {
  const h = await started(), p = h.maker.current()!;
  h.maker.applyReply('{"chat": ["a"], "appearance": "round, green"}');
  assert.strictEqual(p.kit!.appearance, 'round, green');
  assert.deepStrictEqual(h.toasts, ['Applied 1 lines across 1 situations + appearance']);
});

test('a reply leaves an appearance already written', async () => {
  const h = await started([buddy({ kit: { appearance: 'mine' } })]), p = h.maker.current()!;
  h.maker.applyReply('{"chat": ["a"], "appearance": "theirs"}');
  assert.strictEqual(p.kit!.appearance, 'mine');
  assert.deepStrictEqual(h.toasts, ['Applied 1 lines across 1 situations']);
});

test('an appearance alone is a reply, with no wave', async () => {
  const h = await started(), p = h.maker.current()!;
  assert.strictEqual(h.maker.applyReply('{"appearance": ["round", "green"]}'), true);
  assert.strictEqual(p.kit!.appearance, 'round, green');
  assert.strictEqual(p.lines, undefined);
  h.tick(1000);
  assert.deepStrictEqual(h.acts, []);
});

for (const [name, text, why] of [
  ['no JSON at all', 'sorry, no', "Couldn't read that: No JSON object found in the reply"],
  ['nothing it knows', '{"nonsense": ["a"]}', 'Couldn\'t read that: "nonsense" isn\'t a situation a buddy has. Nothing was changed.'],
  ['nothing in it', '{"chat": []}', "Couldn't read that: No known situations in that JSON"]
] as const) {
  test(`a reply with ${name} is refused, and changes nothing`, async () => {
    const h = await started(), p = h.maker.current()!;
    assert.strictEqual(h.maker.applyReply(text), false);
    assert.deepStrictEqual(h.toasts, [why]);
    assert.strictEqual(p.lines, undefined);
    assert.strictEqual(h.saves(), 0);
  });
}

test('broken JSON is refused with what the parser said', async () => {
  const h = await started();
  assert.strictEqual(h.maker.applyReply('{"chat": [}'), false);
  assert.match(h.toasts[0]!, /^Couldn't read that: /);
});

test('back to the default lines', async () => {
  const h = await started([buddy({ lines: { chat: ['a'] } })]), p = h.maker.current()!;
  h.maker.resetLines();
  assert.strictEqual(p.lines, undefined);
  assert.deepStrictEqual(h.toasts, ['Back to default lines']);
  assert.strictEqual(h.saves(), 1);
});

const list = [{ file: 'main', text: 'one' }, { file: 'walk_1', text: 'two' }] as ImagePrompt[];

test('the sheet lists each prompt under its file, and the negative prompt in tags', () => {
  assert.strictEqual(promptSheet(list, 'tags'), `### main.png\none\n\n### walk_1.png\ntwo\n\n### negative prompt\n${NEGATIVE}`);
});

test('in sentences the sheet has no negative prompt', () => {
  assert.strictEqual(promptSheet(list, 'text'), '### main.png\none\n\n### walk_1.png\ntwo');
});

test('editing current lines and applying them changes nothing, however long they are', async () => {
  const long = 'x'.repeat(120), h = await started([buddy({ lines: { hello: [long, 'short'] } })]), p = h.maker.current()!;
  assert.strictEqual(h.maker.applyReply(h.maker.currentLines()!), true);
  assert.deepStrictEqual(p.lines!.hello, [long, 'short']);
});

test('a reply over a limit is refused whole: nothing lands, and it says why', async () => {
  const h = await started([buddy({ lines: { chat: ['kept'] } })]), p = h.maker.current()!;
  const reply = JSON.stringify({ chat: ['new'], appearance: 'round', hello: Array<string>(65).fill('y') });
  assert.strictEqual(h.maker.applyReply(reply), false);
  assert.deepStrictEqual(p.lines, { chat: ['kept'] });
  assert.strictEqual(p.kit?.appearance || '', '');
  assert.strictEqual(h.saves(), 0);
  assert.deepStrictEqual(h.toasts, ['Couldn\'t read that: "hello" has 65 lines, and the limit is 64. Nothing was changed.']);
});

test('whatever a reply is allowed to do, the file takes back', async () => {
  const h = await started();
  assert.strictEqual(h.maker.applyReply(JSON.stringify({ hello: Array<string>(64).fill('x'.repeat(300)) })), true);
  assert.ok(h.maker.buddyFile());
});

test('reading prompts writes nothing into the buddy', async () => {
  const h = await started([buddy()]), p = h.maker.current()!;
  h.maker.imagePromptsFor(p); h.maker.dialoguePromptText();
  assert.strictEqual(p.kit, undefined);
  assert.strictEqual(h.maker.peekKit(p).mode, DEFAULT_KIT.mode);
  assert.strictEqual(p.kit, undefined);
});
