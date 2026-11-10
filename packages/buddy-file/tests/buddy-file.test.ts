/* .buddy.json v2: hostile files for every field, and characters that last. */
import assert from 'node:assert';
import { test } from 'vitest';
import { LIMIT, VERSION, check, checkLines, located, pack, read, readManifest, saveName, unpack, write } from '../src/index';

/* a file as it might arrive, which is anything */
type Loose = any; // eslint-disable-line

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
const WEBP = 'data:image/webp;base64,UklGRgAAAABXRUJQ';
/* the shortest bytes each format can start with */
const STARTS = { png: 'iVBORw0KGgo=', webp: 'UklGRgAAAABXRUJQ', jpeg: '/9j/', gif: 'R0lGODlh' };
const box = () => ({ x0: 0, y0: 0, x1: 1, y1: 1 });
const good = (): Loose => ({
  character: 'c123', name: 'Olive', size: 120, lift: { floor: -.05, wall: .1, ceiling: -.2 }, faces: 'left', base: { src: IMG, bb: box() },
  ref: { ow: 1024, oh: 1024, w: 1024, h: 1024, cx: 512, by: 900, side: 800 },
  poses: { walk: { frames: [{ src: WEBP, bb: box() }], fps: 6, scale: 1.1 } },
  lines: { chat: ['Hi'], hello: [] },
  kit: { mode: 'tags', appearance: 'moss', personality: 'sleepy', quality: 'best', styleTags: 'chibi', styleText: 'cute' },
  signature: { weight: .5, line: 'Ta-da!' }
});
const file = (buddy: unknown, o?: object) => JSON.stringify(Object.assign({ app: 'desktop-buddies', version: 2, buddy }, o));
const rejects = (mutate: (b: Loose) => void, what?: string) => {
  const b = good(); mutate(b);
  assert.throws(() => read(file(b)), Error, what);
};

test('a good file reads back whole', () => {
  assert.deepStrictEqual(read(file(good())), good());
});

/* the slots from an artist's notes: Roll, a stand up for each way down, and the clips into Sit and Sleep */
const TRANSITIONS = ['roll', 'stand_up_from_sleep', 'stand_up_from_sprawl', 'stand_up_from_dizzy', 'stand_up_from_knocked_out', 'sit_down', 'fall_asleep'];

test('the transition slots read back whole, each held to the frame cap', () => {
  const b = good();
  for (const k of TRANSITIONS) b.poses[k] = { frames: Array(LIMIT.frames).fill({ src: IMG, bb: box() }), fps: 8 };
  assert.deepStrictEqual(read(file(b)), b);
  assert.strictEqual(LIMIT.frames, 120);
  for (const k of TRANSITIONS) rejects(x => { x.poses[k] = { frames: Array(LIMIT.frames + 1).fill({ src: IMG, bb: box() }) }; }, 'too many frames');
});

test('write and read round trip, and the working id stays out of the file', () => {
  const text = write(Object.assign({ id: 'b123' }, good()));
  const d = JSON.parse(text);
  assert.strictEqual(d.version, VERSION); assert.strictEqual(d.buddy.id, undefined);
  assert.deepStrictEqual(read(text), good());
});

test('jpeg and gif are images too', () => {
  for (const t of ['jpeg', 'gif', 'png', 'webp']) { const b = good(); b.base.src = `data:image/${t};base64,AAAA`; assert.ok(read(file(b))); }
});

test('version 1 files upgrade: a character is made on import, once', () => {
  const b = good(); delete b.character;
  const a = read(file(b, { version: 1 })), c = read(file(b, { version: 1 }));
  assert.match(a.character!, /^[A-Za-z0-9_-]+$/);
  assert.notStrictEqual(a.character, c.character);
  assert.deepStrictEqual(read(write(a)).character, a.character, 'then it stays');
});

test('a version 1 file with only what the maker wrote then', () => {
  const b = { name: 'Old', size: 120, faces: 'right', base: { src: IMG, bb: box() }, poses: {} };
  assert.strictEqual(read(file(b, { version: 1 })).name, 'Old');
});

test("a version 1 file with the kit and lines the original maker saved", () => {
  const kit = { mode: 'tags', appearance: 'a', personality: 'p', quality: 'q', styleTags: 'chibi', styleText: 'Cute' };
  const b = { name: 'Old', size: 120, faces: 'right', base: { src: IMG, bb: box() }, poses: {}, kit, lines: { greet: ['hi'] } };
  assert.deepStrictEqual(read(file(b, { version: 1 })).kit, kit);
});

test('a version 2 file must carry a character', () => {
  rejects(b => { delete b.character; });
});

for (const [name, text] of [
  ['not JSON', 'nope'], ['null', 'null'], ['an array', '[]'], ['a number', '3'],
  ['another app', file(good(), { app: 'other' })], ['no app', JSON.stringify({ version: 2, buddy: good() })],
  ['a future version', file(good(), { version: 3 })], ['version as text', file(good(), { version: '2' })],
  ['no buddy', JSON.stringify({ app: 'desktop-buddies', version: 2 })],
  ['a buddy that is not an object', file([1])],
  ['an extra top-level field', file(good(), { extra: 1 })]
]) test(`rejects ${name}`, () => assert.throws(() => read(text)));

test('rejects a file past the size limit before parsing it', () => assert.throws(() => read(' '.repeat(LIMIT.file + 1)), /too big/));

const HOSTILE_IMAGES = [
  '"><script>alert(1)</script>', 'javascript:alert(1)', 'https://example.com/x.png', 'data:text/html;base64,PHNjcmlwdD4=',
  'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/svg+xml,<svg onload=alert(1)>', 'data:image/png,raw', 'data:image/png;base64,AAAA"onerror="alert(1)',
  'data:image/png;base64,AAAA)x', 'data:image/png;base64,', ' data:image/png;base64,AAAA', 'DATA:IMAGE/PNG;BASE64,AAAA', 7, null, {}, ['data:image/png;base64,AAAA']
];
for (const v of HOSTILE_IMAGES) {
  test(`rejects the image ${JSON.stringify(v)}`, () => {
    rejects(b => { b.base.src = v; });
    rejects(b => { b.poses.walk.frames[0].src = v; });
  });
}
test('rejects an image past the size limit', () => rejects(b => { b.base.src = 'data:image/png;base64,' + 'A'.repeat(LIMIT.image); }));

const FIELD: Record<string, (b: Loose) => void> = {
  'an unknown buddy field': b => { b.script = 'x'; },
  'the working id in the file': b => { b.id = 'b1'; },
  'a __proto__ key': b => { Object.defineProperty(b, '__proto__', { value: { polluted: 1 }, enumerable: true }); },
  'character with markup': b => { b.character = '<b>'; }, 'character too long': b => { b.character = 'c'.repeat(65); }, 'empty character': b => { b.character = ''; }, 'character as a number': b => { b.character = 1; },
  'name too long': b => { b.name = 'n'.repeat(LIMIT.name + 1); }, 'name as a number': b => { b.name = 3; }, 'name as an object': b => { b.name = {}; },
  'size too big': b => { b.size = 1e6; }, 'size too small': b => { b.size = 1; }, 'size as text': b => { b.size = '120'; }, 'size null': b => { b.size = null; },
  'faces sideways': b => { b.faces = 'up'; },
  'lift as a number': b => { b.lift = .1; }, 'lift null': b => { b.lift = null; }, 'lift as a list': b => { b.lift = [.1]; }, 'a lift for a surface nobody has': b => { b.lift.window = .1; },
  'floor lift too high': b => { b.lift.floor = LIMIT.lift + .001; }, 'wall lift too low': b => { b.lift.wall = -LIMIT.lift - .001; }, 'ceiling lift as text': b => { b.lift.ceiling = '0.1'; }, 'a wall lift null': b => { b.lift.wall = null; },
  'no main image': b => { delete b.base; }, 'main image not an object': b => { b.base = IMG; }, 'extra in main image': b => { b.base.onload = 'x'; },
  'no box': b => { delete b.base.bb; }, 'a box past 1': b => { b.base.bb.x1 = 2; }, 'a box below 0': b => { b.base.bb.y0 = -.1; }, 'a box inside out': b => { b.base.bb.x0 = .9; b.base.bb.x1 = .1; }, 'a box of text': b => { b.base.bb.x0 = '0'; }, 'an extra box field': b => { b.base.bb.z = 0; },
  'ref of text': b => { b.ref.side = 'x'; }, 'ref huge': b => { b.ref.side = 1e9; }, 'ref extra': b => { b.ref.evil = 1; }, 'ref missing a field': b => { delete b.ref.cx; },
  'poses as a list': b => { b.poses = []; }, 'an unknown pose': b => { b.poses.fly = b.poses.walk; }, 'a pose named toString': b => { b.poses.toString = b.poses.walk; }, 'a pose with no frames list': b => { b.poses.walk.frames = 'x'; },
  'too many frames': b => { b.poses.walk.frames = Array(LIMIT.frames + 1).fill(b.poses.walk.frames[0]); }, 'an extra pose field': b => { b.poses.walk.loop = true; },
  'an extra frame field': b => { b.poses.walk.frames[0].t = 1; }, 'a bad frame box': b => { b.poses.walk.frames[0].bb = null; },
  'fps zero': b => { b.poses.walk.fps = 0; }, 'fps huge': b => { b.poses.walk.fps = 1000; }, 'fps of text': b => { b.poses.walk.fps = '6'; },
  'scale zero': b => { b.poses.walk.scale = 0; }, 'scale huge': b => { b.poses.walk.scale = 1e4; },
  'lines as a list': b => { b.lines = ['Hi']; }, 'an unknown situation': b => { b.lines.secret = ['x']; }, 'a line as a number': b => { b.lines.chat = [1]; }, 'lines not a list': b => { b.lines.chat = 'Hi'; }, 'a line too long': b => { b.lines.chat = ['x'.repeat(LIMIT.line + 1)]; }, 'too many lines': b => { b.lines.chat = Array(LIMIT.lines + 1).fill('x'); },
  'signature as text': b => { b.signature = 'jump'; }, 'code in a signature': b => { b.signature.run = 'alert(1)'; }, 'a signature weight too big': b => { b.signature.weight = 50; }, 'a signature line too long': b => { b.signature.line = 'x'.repeat(LIMIT.line + 1); },
  'kit as text': b => { b.kit = 'x'; }, 'an unknown kit field': b => { b.kit.url = 'x'; }, 'a kit mode nobody knows': b => { b.kit.mode = 'evil'; }, 'kit text too long': b => { b.kit.appearance = 'x'.repeat(LIMIT.kit + 1); }, 'kit text as a number': b => { b.kit.personality = 1; }
};
for (const [name, mutate] of Object.entries(FIELD)) test(`rejects ${name}`, () => rejects(mutate, name));

for (const n of [Infinity, -Infinity, NaN]) test(`rejects ${n} for a number, built by hand`, () => {
  const b = good(); b.size = n; assert.throws(() => check(b));
});

test('every number at the end of its range is fine', () => {
  const b = good(); b.size = 16; b.poses.walk.fps = 60; b.poses.walk.scale = .05; b.ref.ow = -1; b.ref.oh = -1;
  assert.ok(read(file(b)));
  for (const x of [LIMIT.lift, -LIMIT.lift]) assert.deepStrictEqual(read(file({ ...good(), lift: { floor: x, wall: x, ceiling: x } })).lift, { floor: x, wall: x, ceiling: x });
});

/* The file never holds an entry that does nothing. JSON can't spell -0, so it's checked by hand too. */
test('a lift of 0 for a surface is no lift for it, and a lift with none left is no lift at all', () => {
  const lifted = (lift: unknown) => read(file({ ...good(), lift }));
  for (const lift of [{}, { floor: 0, wall: 0, ceiling: 0 }, { wall: 0 }]) {
    const b = lifted(lift);
    assert.ok(!('lift' in b), JSON.stringify(lift));
    assert.ok(!write(b).includes('lift'), 'and is not written: ' + JSON.stringify(lift));
  }
  for (const lift of [{ floor: -0 }, { floor: -0, wall: -0, ceiling: -0 }]) assert.ok(!('lift' in check({ ...good(), lift })), 'nor -0');
  assert.strictEqual(JSON.stringify(check({ ...good(), lift: { floor: -0, wall: .1 } }).lift), '{"wall":0.1}', '-0 never comes out as 0');
  assert.strictEqual(JSON.stringify(lifted({ floor: 0, wall: .1 }).lift), '{"wall":0.1}', 'only what does something stays');
  assert.strictEqual(JSON.stringify(lifted({ ceiling: -.2, wall: 0, floor: .1 }).lift), '{"floor":0.1,"ceiling":-0.2}');
  assert.strictEqual(write(read(write(lifted({ floor: 0, wall: .1 })))), write(lifted({ wall: .1 })), 'and it stays that way');
});

test('a lift of zeros is still refused for anything else wrong in it', () => {
  for (const lift of [{ floor: 0, window: 0 }, { floor: 0, wall: '0' }, { wall: 0, ceiling: null }, { floor: 0, wall: LIMIT.lift + .001 }, { floor: 0, ceiling: NaN }])
    assert.throws(() => check({ ...good(), lift }), /lift/, JSON.stringify(lift));
  for (const lift of [0, null, [], [0]]) assert.throws(() => check({ ...good(), lift }), /lift/, JSON.stringify(lift));
});

test('a lift is one share of her size per surface, either way, each roughly what a pose\'s own Lift allows', () => {
  assert.strictEqual(LIMIT.lift, .5);
  const { lift: _, ...none } = good();
  assert.ok(!('lift' in read(file(none))), 'no lift read stays no lift');
  assert.ok(!write(read(file(none))).includes('lift'), 'and is not written');
  assert.deepStrictEqual(read(write(read(file(good())))).lift, { floor: -.05, wall: .1, ceiling: -.2 });
  assert.deepStrictEqual(read(file({ ...good(), lift: { wall: .1 } })).lift, { wall: .1 }, 'each surface on its own');
  assert.strictEqual(write(read(file({ ...good(), lift: { ceiling: .3, floor: .1 } }))).match(/"lift":\{[^}]*\}/)![0], '"lift":{"floor":0.1,"ceiling":0.3}', 'written in one order');
});

test('a version that doesn\'t know lift refuses her file, saying which field', () => {
  assert.throws(() => check({ ...good(), wings: 1 }), /unknown field in buddy: wings/);
});

/* A buddy on disk: the file with its images pulled out beside it. */
const onDisk = (b = good()) => { const u = unpack(b), files = new Map(u.images.map(f => [f.name, f.bytes])); return { ...u, files, get: (n: string) => files.get(n) }; };

test('unpack and pack give back the same buddy, byte for byte', () => {
  const d = onDisk();
  assert.deepStrictEqual(d.images.map(f => f.name), ['base.png', 'walk-0.webp']);
  assert.deepStrictEqual([...d.images[0]!.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.deepStrictEqual(pack(d.manifest, d.get), good());
});

test('the manifest holds names, not images', () => {
  const b = readManifest(onDisk().manifest);
  assert.strictEqual(b.base.src, 'base.png');
  assert.strictEqual(b.poses.walk!.frames[0]!.src, 'walk-0.webp');
  assert.ok(!onDisk().manifest.includes('base64'));
});

test('the same image twice is one file', () => {
  const b = good(); b.poses.sit = { frames: [{ src: IMG, bb: box() }] };
  const d = onDisk(b);
  assert.strictEqual(d.images.length, 2);
  assert.strictEqual(readManifest(d.manifest).poses.sit!.frames[0]!.src, 'base.png');
  assert.deepStrictEqual(pack(d.manifest, d.get), b);
});

test('every image type keeps its type through the disk', () => {
  for (const [type, ext] of [['png', 'png'], ['webp', 'webp'], ['jpeg', 'jpg'], ['gif', 'gif']] as const) {
    const b = good(); b.base.src = `data:image/${type};base64,${STARTS[type]}`;
    const d = onDisk(b);
    assert.strictEqual(d.images[0]!.name, 'base.' + ext);
    assert.strictEqual(pack(d.manifest, d.get).base.src, b.base.src);
  }
});

test('big images survive the trip', () => {
  const bytes = new Uint8Array(300000).map((_, i) => i * 7);
  bytes.set(Buffer.from(STARTS.png, 'base64'));
  const b = good(); b.base.src = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
  const d = onDisk(b);
  assert.deepStrictEqual(Buffer.from(d.images[0]!.bytes), Buffer.from(bytes));
  assert.strictEqual(pack(d.manifest, d.get).base.src, b.base.src);
});

test('a file is named for what its bytes are, not what it declared', () => {
  for (const [declared, real, ext] of [['png', 'webp', 'webp'], ['webp', 'png', 'png'], ['gif', 'jpeg', 'jpg'], ['jpeg', 'gif', 'gif']] as const) {
    const b = good(); b.base.src = `data:image/${declared};base64,${STARTS[real]}`;
    const d = onDisk(b);
    assert.strictEqual(d.images[0]!.name, 'base.' + ext);
    assert.strictEqual(readManifest(d.manifest).base.src, 'base.' + ext);
    assert.strictEqual(pack(d.manifest, d.get).base.src, `data:image/${real};base64,${STARTS[real]}`, 'and it comes back as what it is');
  }
});

const base64 = (s: string) => Buffer.from(s, 'latin1').toString('base64');
for (const [what, bytes] of [
  ['html', '<!doctype html><script>alert(1)</script>'], ['a script tag', '<script>alert(1)</script>'], ['svg', '<svg onload=alert(1)>'],
  ['a signature that starts late', ' \x89PNG\r\n\x1a\n'], ['a cut-off png signature', '\x89PNG'], ['a cut-off webp', 'RIFF\0\0\0\0WEB'], ['a wav', 'RIFF\0\0\0\0WAVE'],
  ['a gif of no known version', 'GIF88a'], ['a bitmap', 'BM\0\0\0\0']
] as const) {
  test(`unpack refuses ${what} declared as an image, in any frame`, () => {
    const src = `data:image/png;base64,${base64(bytes)}`;
    const main = good(), frame = good(); main.base.src = src; frame.poses.walk.frames[0].src = src;
    assert.ok(read(file(main)), 'read stays as it was, so the web maker is unchanged');
    assert.ok(check(main));
    assert.throws(() => unpack(main), /base is not a png, webp, jpeg or gif/);
    assert.throws(() => unpack(frame), /walk-0 is not a png, webp, jpeg or gif/);
  });
}

test('unpack leaves the buddy it was given alone', () => {
  const b = good(); unpack(b);
  assert.deepStrictEqual(b, good());
});

test('a manifest is checked like any file, and its names can only be plain image names', () => {
  const m = (src: string) => JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { character: 'c1', base: { src, bb: box() }, poses: {} } });
  assert.strictEqual(readManifest(m('a-1.webp')).base.src, 'a-1.webp');
  for (const bad of ['../x.png', 'a/b.png', 'a.html', 'A.PNG', 'a.png?x', IMG, 'https://example.com/a.png', '']) assert.throws(() => readManifest(m(bad)), Error, bad);
  assert.throws(() => readManifest(JSON.stringify({ app: 'desktop-buddies', version: 2, buddy: { base: { src: 'a.png', bb: box() }, poses: {} } })), /no character/);
  assert.throws(() => readManifest(JSON.stringify({ app: 'other', version: 2, buddy: {} })), /not a buddy/);
});

test('pack refuses a manifest with an image missing', () => {
  const d = onDisk();
  assert.throws(() => pack(d.manifest, n => n === 'base.png' ? d.files.get(n) : undefined), /missing image walk-0\.webp/);
});

test('located turns names into URLs and leaves the rest', () => {
  const b = readManifest(onDisk().manifest), l = located(b, n => 'library/c123/' + n + '?v=1');
  assert.strictEqual(l.base.src, 'library/c123/base.png?v=1');
  assert.strictEqual(l.poses.walk!.frames[0]!.src, 'library/c123/walk-0.webp?v=1');
  assert.strictEqual(b.base.src, 'base.png');
  assert.strictEqual(l.name, 'Olive');
});

test('a name is saved as .buddy, cleaned for Windows and kept in its own script', () => {
  assert.strictEqual(saveName('Pip'), 'Pip.buddy');
  assert.strictEqual(saveName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij.buddy');
  assert.strictEqual(saveName('ぬい'), 'ぬい.buddy');
  assert.strictEqual(saveName('dots...  '), 'dots.buddy');
  assert.strictEqual(saveName('...'), 'buddy.buddy');
  assert.strictEqual(saveName(''), 'buddy.buddy');
  assert.strictEqual(saveName(), 'buddy.buddy');
});

test('the rule for lines can be used on its own, and is the file\'s', () => {
  assert.doesNotThrow(() => checkLines({ chat: ['x'.repeat(LIMIT.line)], hello: Array(LIMIT.lines).fill('y') }));
  assert.throws(() => checkLines({ chat: ['x'.repeat(LIMIT.line + 1)] }), /chat line is not a short string/);
  assert.throws(() => checkLines({ hello: Array(LIMIT.lines + 1).fill('y') }), /hello has too many lines/);
  assert.throws(() => checkLines({ secret: ['y'] }), /unknown field in lines: secret/);
});
