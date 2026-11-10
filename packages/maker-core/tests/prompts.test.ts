/* The prompt kit's words, with no Maker around them. */
import assert from 'node:assert';
import { POSES, SITUATIONS } from '@buddies/buddy-file';
import { LIMIT } from '@buddies/buddy-file';
import { test } from 'vitest';
import { DEFAULT_KIT, NEGATIVE, POSE_PROMPTS, dialoguePrompt, imagePrompts, parseReply, poseFromFile, splitAppearance } from '../src';

const kit = (more = {}) => ({ ...DEFAULT_KIT, appearance: 'round creature, green fur', ...more });

for (const [name, key] of [
  ['walk_2.png', 'walk'], ['pip-main.png', 'main'], ['base.webp', 'main'], ['stand_up_2.png', 'stand_up'], ['stand_from_sit_2.png', 'stand_from_sit'],
  ['stand_up.png', 'stand_up'], ['stand_1.png', 'stand'], ['CRY.PNG', 'cry'], ['dragL.png', 'dragL'], ['holiday.png', null],
  ['stand_up_from_sleep_2.png', 'stand_up_from_sleep'], ['pip-stand_up_from_knocked_out_10.png', 'stand_up_from_knocked_out'],
  ['sit_down_1.png', 'sit_down'], ['fall_asleep.png', 'fall_asleep'], ['roll_3.png', 'roll']
] as const) {
  test(`${name} is ${key}`, () => { assert.strictEqual(poseFromFile(name), key); });
}

test('every pose can be named by a file', () => {
  for (const p of POSES) assert.strictEqual(poseFromFile(p.key + '.png'), p.key);
});

test('an empty appearance is empty', () => {
  assert.deepStrictEqual(splitAppearance(' '), { kind: 'empty', keep: [], emo: [], text: '' });
  assert.strictEqual(splitAppearance(undefined).kind, 'empty');
});

test('tags split into looks and expressions, and pose words go', () => {
  const a = splitAppearance('green fur, smile, standing, white background, big eyes');
  assert.strictEqual(a.kind, 'tags');
  assert.deepStrictEqual(a.keep, ['green fur', 'big eyes']);
  assert.deepStrictEqual(a.emo, ['smile']);
});

test('a sentence stays whole and notes its expression', () => {
  const a = splitAppearance('A small round creature who is always smiling.');
  assert.strictEqual(a.kind, 'text');
  assert.strictEqual(a.text, 'A small round creature who is always smiling');
  assert.deepStrictEqual(a.emo, ['smiling']);
});

test('no appearance, no prompts', () => {
  assert.strictEqual(imagePrompts(DEFAULT_KIT), null);
});

test('there is a prompt for every frame, and the essentials come first', () => {
  const list = imagePrompts(kit())!;
  assert.strictEqual(list.length, POSE_PROMPTS.reduce((n, p) => n + p.frames.length, 0));
  assert.strictEqual(list.length, 31);
  assert.strictEqual(list.filter(x => x.core).length, 11);
  assert.strictEqual(list.findIndex(x => !x.core), 11);
});

test('files are named for the pose, with a number when it has several frames', () => {
  const list = imagePrompts(kit())!;
  assert.deepStrictEqual(list.slice(0, 3).map(x => x.file), ['main', 'walk_1', 'walk_2']);
  assert.strictEqual(list[0]!.label, 'Main image');
  assert.strictEqual(list[1]!.label, 'Walk');
});

test('a tag prompt is deduplicated and ends in its plain sentence', () => {
  const main = imagePrompts(kit({ appearance: 'solo, green fur' }))![0]!;
  assert.strictEqual(main.text.split('solo').length - 1, 1);
  assert.match(main.text, /^masterpiece, best quality, chibi, solo/);
  assert.match(main.text, /shown in full on a plain white background\. No shadow\.$/);
});

test('a sentence prompt reads as sentences', () => {
  const main = imagePrompts(kit({ mode: 'text' }))![0]!;
  assert.match(main.text, /^Cute chibi mascot sticker illustration, clean outlines, flat colours\. masterpiece, best quality\. The character: round creature, green fur\. Pose: /);
});

test('a pose with its own emotion overrides the expression in the appearance', () => {
  const cry = imagePrompts(kit({ mode: 'text', appearance: 'green fur, smile' }))!.find(x => x.key === 'cry')!;
  assert.match(cry.text, /Expression \(overrides any expression mentioned above\): sobbing/);
});

test('the direction follows the art', () => {
  assert.match(imagePrompts(kit(), 'left')!.find(x => x.file === 'walk_1')!.text, /facing left/);
  assert.match(imagePrompts(kit(), 'right')!.find(x => x.file === 'walk_1')!.text, /facing right/);
});

test('the negative prompt keeps its words', () => {
  assert.match(NEGATIVE, /^lowres, worst quality/);
});

test('the dialogue prompt lists every situation', () => {
  const text = dialoguePrompt({ name: 'Ann' }, kit());
  for (const [k, when] of Object.entries(SITUATIONS)) assert.ok(text.includes(`- ${k}: ${when}`), k);
  assert.strictEqual(Object.keys(SITUATIONS).length, 33);
});

test('with no appearance it asks for one, in the kit\'s mode', () => {
  assert.match(dialoguePrompt({}, { mode: 'tags' }), /Also include an "appearance" key: a comma-separated list/);
  assert.match(dialoguePrompt({}, { mode: 'text' }), /Also include an "appearance" key: one or two sentences/);
  assert.doesNotMatch(dialoguePrompt({}, kit()), /Also include/);
});

test('with no name or description it says so', () => {
  const text = dialoguePrompt({}, {});
  assert.match(text, /named "Buddy"/);
  assert.match(text, /\(No description given — invent a charming, consistent personality\.\)/);
});

test('it never leaves two blank lines in a row', () => {
  assert.doesNotMatch(dialoguePrompt({ name: 'A' }, {}), /\n\n\n/);
});

test('a reply is found among chatter and fences', () => {
  const r = parseReply('Here you go:\n```json\n{"chat": ["a", "b"], "hello": ["c"]}\n```\nEnjoy!');
  assert.deepStrictEqual(r, { lines: { chat: ['a', 'b'], hello: ['c'] }, count: 3, keys: 2, appearance: '' });
});

test('a reply is trimmed, loses its blanks, and is never cut', () => {
  const r = parseReply(JSON.stringify({ chat: [' a ', '', 'x'.repeat(60)], hello: [] }));
  assert.deepStrictEqual(r.lines, { chat: ['a', 'x'.repeat(60)] });
  assert.strictEqual(r.count, 2);
});

test('a reply can go right up to the file\'s limits', () => {
  const r = parseReply(JSON.stringify({ chat: ['x'.repeat(LIMIT.line)], hello: Array<string>(LIMIT.lines).fill('y') }));
  assert.strictEqual(r.lines.chat![0]!.length, LIMIT.line);
  assert.strictEqual(r.lines.hello!.length, LIMIT.lines);
});

for (const [name, reply, why] of [
  ['a line too long', { chat: ['fine', 'x'.repeat(LIMIT.line + 1)] }, /A line in "chat" is 301 characters long, and the limit is 300/],
  ['too many lines', { hello: Array<string>(LIMIT.lines + 1).fill('y') }, /"hello" has 65 lines, and the limit is 64/],
  ['a situation there isn\'t', { chat: ['a'], nonsense: ['z'] }, /"nonsense" isn't a situation a buddy has/],
  ['a line that isn\'t words', { chat: ['a', 5] }, /Something in "chat" isn't a line of words/],
  ['lines that aren\'t a list', { hello: 'no' }, /"hello" has to be a list of lines/]
] as const) {
  test(`a reply with ${name} is refused, naming what's wrong`, () => {
    assert.throws(() => parseReply(JSON.stringify(reply)), why);
  });
}

test('an appearance comes as text or a list', () => {
  assert.strictEqual(parseReply('{"appearance": " round "}').appearance, 'round');
  assert.strictEqual(parseReply('{"appearance": ["a", "b"]}').appearance, 'a, b');
  assert.strictEqual(parseReply('{"appearance": 5}').appearance, '');
});

test('no object in the reply throws', () => {
  assert.throws(() => parseReply('nothing here'), /No JSON object found in the reply/);
  assert.throws(() => parseReply('} backwards {'), /No JSON object found in the reply/);
});
