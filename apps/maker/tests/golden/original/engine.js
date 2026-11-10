/* Desktop Buddies — pet engine
   A buddy has one main image plus optional per-pose frame sets (like Shimeji).
   Any pose without frames falls back along a chain, ending at the main image,
   which is then animated procedurally (squash, hop, tilt, rotate onto walls). */
(function (G) {
  'use strict';
  const pick = a => a[Math.random() * a.length | 0];
  const R = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const DEG = Math.PI / 180;
  const GRAV = 0.6;

  const LINES = {
    hello: ['Hi!', 'You called?', 'Hm?', 'Here I am!', 'Yes?'],
    love: ['Yay!', 'Hehe', 'Best day ever', 'More pats please', 'So happy!'],
    cry: ['Waaah…', 'Sniff…', 'Play with me…', 'So lonely…'],
    hurt: ['Ouch!', 'Owie…', 'Be gentle!', 'Everything is spinning…'],
    wake: ['Mm…?', 'Good nap!', 'Is it morning?', 'I was awake! Totally.'],
    climb: ['Up I go!', 'Hup, hup', 'So high!'],
    drop: ['Wheee!', 'Whoa!', 'Look out below!'],
    held: ['Put me down!', 'Where are we going?', 'Wow, the view!'],
    comfort: ['Thank you…', 'I feel better', 'Hehe, thanks'],
    grab: ['Got it!', 'Phew!', 'Safe!'],
    sleep: ['So sleepy…', 'Just a quick nap', 'Zzz…'],
    dance: ["Let's dance!", 'Groovy!', 'Dance party!', 'Bust a move~'],
    sing: ['La la la~', 'Hmm hm hmm~', 'Sing along!'],
    yawn: ['*yaaawn*', 'Getting sleepy…'],
    shy: ['W-what?', "Don't stare…", 'Hehe…', "You're making me blush"],
    angry: ['Stop poking me!', 'Hmph!', 'Enough!', "I'm not a button!"],
    chase: ['Wait up!', "I'll catch you!", 'Come back!'],
    caught: ['Gotcha!', 'I win!'],
    eat: ['Nom nom', 'Yummy!', 'Snack time!', 'Delicious'],
    think: ["What's for dinner?", 'I want to see clouds', 'What should we play?', 'Hungry…', 'Hmm…'],
    trip: ['Oops!', 'I tripped…'],
    getup: ["I'm okay!", 'Hup!', "Didn't hurt!"],
    chat: ["You're doing great!", 'Whatcha doing?', "I'm right here", "Let's play!", 'Take a break sometimes', 'Drink some water!', 'Have a nice day!', 'Bored…', 'Working hard, huh?'],
    spin: ['Round and round~', 'Dizzy…'],
    roll: ['Rolly polly~', 'Here I go~'],
    bye: ['Bye bye!', 'See you later!', 'Off I go!', 'Call me anytime!'],
    greet: ['Hello, friend!', "Oh, it's you!", 'Wanna play?', 'Hiya!'],
    hug: ['Hug!', 'Love you!', 'So warm'],
    bump: ['Sorry!', 'You okay?'],
    bumped: ['Ow…', 'Hey!'],
    tired: ['Phew…', 'Too fast…', 'I give up!'],
    full: ['That hit the spot!', 'So full…', '*burp* Oops'],
    grumpy: ['Hmph!', 'Still mad.', 'Not talking to you.'],
    dragme: ['Try dragging me!', 'Pick me up!']
  };
  /* When each line set is spoken — used to brief an AI writing a character's dialogue. */
  const SITUATIONS = {
    chat: 'idle chatter while wandering, talking to the user',
    think: 'musing to itself while thinking',
    hello: 'the user clicks on it',
    love: 'the user pets it; feeling happy',
    comfort: 'the user pets it while it was sad or angry, and it feels better',
    shy: 'the user hovers the mouse over it and stares',
    angry: 'the user clicks it too many times',
    grumpy: 'clicked again while still angry',
    cry: 'feeling sad and lonely, crying',
    hurt: 'thrown too hard, slams into the floor or a wall',
    getup: 'getting back up after tripping or being dizzy',
    trip: 'tripping while running',
    held: 'being picked up and dragged around by the mouse',
    drop: 'falling or being dropped',
    grab: 'catching onto a wall or the ceiling after being thrown',
    climb: 'starting to climb up the side of the screen',
    yawn: 'getting sleepy, about to nap',
    wake: 'woken up from a nap',
    dance: 'starting to dance',
    sing: 'starting to sing (can include lyrics)',
    eat: 'eating a snack',
    full: 'finished eating',
    chase: 'starts chasing the mouse cursor',
    caught: 'catches the mouse cursor',
    tired: 'gives up chasing, out of breath',
    spin: 'spinning around',
    roll: 'rolling along the floor',
    bye: 'is dismissed by the user and leaves the screen (a goodbye)',
    greet: 'meets another desktop pet',
    hug: 'hugs another desktop pet',
    bump: 'bumps into another pet (apologizing)',
    bumped: 'gets bumped by another pet',
    dragme: 'a hint telling the user they can drag it'
  };

  /* Pose slots. fb = what to show when this pose has no frames.
     '@wall' / '@ceil' = rotate the main image onto that surface. */
  const POSES = [
    { key: 'stand', label: 'Stand / idle', fb: null, group: 'Basics' },
    { key: 'walk', label: 'Walk', fb: 'stand', group: 'Basics' },
    { key: 'run', label: 'Run', fb: 'walk', group: 'Basics' },
    { key: 'sit', label: 'Sit', fb: 'stand', group: 'Basics' },
    { key: 'sleep', label: 'Sleep', fb: 'sit', group: 'Basics' },
    { key: 'think', label: 'Think / look up', fb: 'stand', group: 'Basics' },
    { key: 'jump', label: 'Jump (going up)', fb: 'fall', group: 'Movement' },
    { key: 'fall', label: 'Falling', fb: 'stand', group: 'Movement' },
    { key: 'land', label: 'Landing bounce', fb: 'stand', group: 'Movement' },
    { key: 'sprawl', label: 'Sprawled / tripped', fb: null, group: 'Movement' },
    { key: 'drag', label: 'Held (still)', fb: 'fall', group: 'Being dragged' },
    { key: 'dragL', label: 'Held, swung left', fb: 'drag', group: 'Being dragged', hint: '1–2 frames: mild, strong' },
    { key: 'dragR', label: 'Held, swung right', fb: 'drag', group: 'Being dragged', hint: '1–2 frames: mild, strong' },
    { key: 'climb', label: 'Climb wall', fb: '@wall', group: 'Walls & ceiling', hint: 'Side view, facing the same way as "Art faces", hands reaching forward onto the wall' },
    { key: 'wall', label: 'Hold on wall', fb: 'climb', group: 'Walls & ceiling', hint: 'Side view, facing the same way as "Art faces", hands reaching forward onto the wall' },
    { key: 'crawl', label: 'Crawl ceiling', fb: '@ceil', group: 'Walls & ceiling' },
    { key: 'hang', label: 'Hang from ceiling', fb: 'crawl', group: 'Walls & ceiling' },
    { key: 'happy', label: 'Happy / hearts', fb: 'stand', group: 'Reactions' },
    { key: 'wave', label: 'Wave / greet', fb: 'happy', group: 'Reactions' },
    { key: 'shy', label: 'Shy', fb: 'happy', group: 'Reactions' },
    { key: 'cry', label: 'Cry', fb: 'sit', group: 'Reactions' },
    { key: 'angry', label: 'Angry', fb: 'stand', group: 'Reactions' },
    { key: 'dizzy', label: 'Dizzy', fb: 'sprawl', group: 'Reactions' },
    { key: 'eat', label: 'Eat snack', fb: 'sit', group: 'Activities' },
    { key: 'dance', label: 'Dance', fb: 'happy', group: 'Activities' },
    { key: 'sing', label: 'Sing', fb: 'happy', group: 'Activities' }
  ];
  const POSE = Object.fromEntries(POSES.map(p => [p.key, p]));

  /* Standard Shimeji-ee image numbering (shime1.png … shime46.png), approximate. */
  const SHIMEJI_MAP = {
    stand: [1], walk: [1, 2, 1, 3], run: [1, 2, 1, 3], sit: [11], sleep: [21], think: [26],
    jump: [22], fall: [4], land: [18, 19], sprawl: [21],
    drag: [1], dragL: [7, 9], dragR: [8, 10],
    climb: [14, 12, 13], wall: [13], crawl: [25, 23, 24], hang: [23]
  };
  const SHIMEJI_FPS = { walk: 6, run: 12, land: 6, climb: 5, crawl: 5 };

  /* ---------- image processing ---------- */
  const MAX_SRC = 1024, MAX_OUT = 320;
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
  function canvasOf(im) {
    const k = Math.min(1, MAX_SRC / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    c._ow = im.naturalWidth; c._oh = im.naturalHeight;
    return c;
  }
  function isOpaque(c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0, t = 0; for (let i = 3; i < d.length; i += 64) { n++; if (d[i] < 250) t++; }
    return t / n < 0.01;
  }
  /* AI-generated art usually sits on a plain background (white, grey, flat colour).
     If the border is mostly one colour, flood-fill that colour away from the edges.
     Returns null when the background isn't plain, so real photos still become stickers. */
  function removePlainBg(c, TOL = 30, SOFT = 75) {
    const w = c.width, h = c.height, x = c.getContext('2d'), img = x.getImageData(0, 0, w, h), d = img.data;
    const border = [];
    for (let i = 0; i < w; i++) border.push(i, (h - 1) * w + i);
    for (let j = 1; j < h - 1; j++) border.push(j * w, j * w + w - 1);
    const diff = (i, r) => Math.max(Math.abs(d[i * 4] - r[0]), Math.abs(d[i * 4 + 1] - r[1]), Math.abs(d[i * 4 + 2] - r[2]));
    let ref = null, best = 0;
    for (const ci of [0, w - 1, (h - 1) * w, h * w - 1]) {
      const r = [d[ci * 4], d[ci * 4 + 1], d[ci * 4 + 2]];
      let n = 0; for (let k = 0; k < border.length; k += 7) if (diff(border[k], r) < TOL) n++;
      if (n > best) { best = n; ref = r; }
    }
    if (best / Math.ceil(border.length / 7) < 0.8) return null;
    const mark = new Uint8Array(w * h), stack = [];
    for (const i of border) if (!mark[i] && diff(i, ref) < TOL) { mark[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop(), px = i % w;
      const nb = [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const n of nb) if (n >= 0 && n < w * h && !mark[n] && diff(n, ref) < TOL) { mark[n] = 1; stack.push(n); }
    }
    for (let i = 0; i < w * h; i++) {
      if (mark[i]) { d[i * 4 + 3] = 0; continue; }
      /* soften the anti-aliased fringe next to the removed area */
      const px = i % w;
      if ((px > 0 && mark[i - 1]) || (px < w - 1 && mark[i + 1]) || (i >= w && mark[i - w]) || (i + w < w * h && mark[i + w])) {
        const df = diff(i, ref); if (df < SOFT) d[i * 4 + 3] = Math.round(255 * (df - TOL) / (SOFT - TOL));
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  /* A photo with no transparency becomes a rounded sticker. */
  function sticker(c) {
    const s = Math.min(c.width, c.height), side = 360, b = 12, r = 48;
    const o = document.createElement('canvas'); o.width = o.height = side;
    const x = o.getContext('2d');
    const rr = (p, rad) => { x.beginPath(); x.roundRect(p, p, side - 2 * p, side - 2 * p, rad); };
    x.save(); x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = 8; x.shadowOffsetY = 3; rr(6, r); x.fillStyle = '#fff'; x.fill(); x.restore();
    x.save(); rr(6 + b, r - b); x.clip();
    x.drawImage(c, (c.width - s) / 2, (c.height - s) / 2, s, s, 6 + b, 6 + b, side - 2 * (6 + b), side - 2 * (6 + b));
    x.restore();
    o._ow = o._oh = -1; // never matches a sprite canvas
    return o;
  }
  function alphaBox(c) {
    const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }
  function union(a, b) { if (!a) return b; if (!b) return a; return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }; }
  /* Draw canvases (with offsets) into a square region and export frames with normalized content boxes. */
  function pack(items, reg) {
    const O = clamp(Math.ceil(reg.side), 32, MAX_OUT), k = O / reg.side;
    return items.map(({ c, ox, oy }) => {
      const o = document.createElement('canvas'); o.width = o.height = O;
      const x = o.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(c, (ox - reg.x0) * k, (oy - reg.y0) * k, c.width * k, c.height * k);
      const b = alphaBox(o);
      return { src: o.toDataURL('image/png'), bb: b ? { x0: b.x0 / O, y0: b.y0 / O, x1: b.x1 / O, y1: b.y1 / O } : { x0: 0, y0: 0, x1: 1, y1: 1 } };
    });
  }
  function squareAround(cx, bottom, box) {
    const half = Math.max(cx - box.x0, box.x1 - cx);
    const side = Math.max(2 * half, bottom - box.y0, 8);
    return { x0: cx - side / 2, y0: bottom - side, side };
  }
  /* Main image: trim empty margins, feet on the bottom edge. Returns the frame and a
     reference so later pose frames drawn on the same-size canvas keep the same scale. */
  async function processBase(src) {
    let c = canvasOf(await loadImg(src));
    let photo = false; if (isOpaque(c)) { if (!removePlainBg(c)) { photo = true; c = sticker(c); } }
    const box = alphaBox(c) || { x0: 0, y0: 0, x1: c.width, y1: c.height };
    const cx = (box.x0 + box.x1) / 2, reg = squareAround(cx, box.y1, box);
    const [frame] = pack([{ c, ox: 0, oy: 0 }], reg);
    return { frame, photo, ref: { ow: c._ow, oh: c._oh, w: c.width, h: c.height, cx, by: box.y1, side: reg.side } };
  }
  /* Pose frames: all frames in a batch share one crop so the animation stays aligned. */
  async function processFrames(srcs, ref, opts) {
    if (opts && opts.independent) ref = null;
    /* repeated frames (e.g. walk 1,2,1,3) are processed once and shared */
    const uniq = [...new Set(srcs)], cs = [], idx = new Map();
    for (const s of uniq) { try { let c = canvasOf(await loadImg(s)); if (isOpaque(c) && !removePlainBg(c)) c = sticker(c); idx.set(s, cs.length); cs.push(c); } catch (e) { /* skip */ } }
    if (!cs.length) return null;
    const order = srcs.filter(s => idx.has(s)).map(s => idx.get(s));
    const out = await processCanvases(cs, ref);
    out.frames = order.map(i => out.frames[i]);
    return out;
  }
  async function processCanvases(cs, ref) {
    const same = ref && cs.every(c => c._ow === ref.ow && c._oh === ref.oh && c.width === ref.w);
    if (same) {
      let U = null; cs.forEach(c => { U = union(U, alphaBox(c)); });
      U = U || { x0: 0, y0: 0, x1: ref.w, y1: ref.h };
      const reg = squareAround(ref.cx, Math.max(ref.by, U.y1), union(U, { x0: ref.cx - ref.side / 2, y0: ref.by - ref.side, x1: ref.cx + ref.side / 2, y1: ref.by }));
      return { frames: pack(cs.map(c => ({ c, ox: 0, oy: 0 })), reg), scale: +(reg.side / ref.side).toFixed(3) };
    }
    const mw = Math.max(...cs.map(c => c.width)), mh = Math.max(...cs.map(c => c.height));
    const items = cs.map(c => ({ c, ox: (mw - c.width) / 2, oy: mh - c.height }));
    let U = null; items.forEach(it => { const b = alphaBox(it.c); if (b) U = union(U, { x0: b.x0 + it.ox, y0: b.y0 + it.oy, x1: b.x1 + it.ox, y1: b.y1 + it.oy }); });
    U = U || { x0: 0, y0: 0, x1: mw, y1: mh };
    const reg = squareAround((U.x0 + U.x1) / 2, U.y1, U);
    return { frames: pack(items, reg), scale: 1 };
  }
  /* Size matching for separately generated images. AI images come out at slightly different
     sizes, and trimming each frame on its own makes poses with raised arms look smaller.
     The body (largest connected blob, so floating notes, zzz and tears don't count) should
     cover the same area as in the main image, so scale = sqrt(main area / pose area). */
  function bodyFrac(c) {
    const N = 128, t = document.createElement('canvas'); t.width = t.height = N;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N).data, m = new Uint8Array(N * N), st = [];
    for (let i = 0; i < N * N; i++) m[i] = d[i * 4 + 3] > 128 ? 1 : 0;
    let best = 0;
    for (let i = 0; i < N * N; i++) {
      if (m[i] !== 1) continue;
      let n = 0; m[i] = 2; st.push(i);
      while (st.length) {
        const j = st.pop(), px = j % N; n++;
        if (px > 0 && m[j - 1] === 1) { m[j - 1] = 2; st.push(j - 1); }
        if (px < N - 1 && m[j + 1] === 1) { m[j + 1] = 2; st.push(j + 1); }
        if (j >= N && m[j - N] === 1) { m[j - N] = 2; st.push(j - N); }
        if (j + N < N * N && m[j + N] === 1) { m[j + N] = 2; st.push(j + N); }
      }
      if (n > best) best = n;
    }
    return best / (N * N);
  }
  const fracCache = new Map();
  async function frameFrac(src) {
    if (!fracCache.has(src)) { try { fracCache.set(src, bodyFrac(canvasOf(await loadImg(src)))); } catch (e) { fracCache.set(src, 0); } }
    return fracCache.get(src);
  }
  /* returns the pose scale that makes these frames match the main image's body size, or null */
  async function matchScale(baseFrame, frames) {
    const fb = await frameFrac(baseFrame.src); if (!fb) return null;
    const fs = []; for (const s of new Set(frames.map(f => f.src))) { const v = await frameFrac(s); if (v) fs.push(v); }
    if (!fs.length) return null;
    fs.sort((a, b) => a - b);
    const med = fs[fs.length >> 1];
    return +clamp(Math.sqrt(fb / med), .4, 2.5).toFixed(3);
  }
  const natSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  /* Build a whole buddy from a Shimeji image folder. files: [{name, src}] */
  async function fromShimeji(files) {
    const byNum = {};
    files.forEach(f => { const m = /shime(\d+)\.png$/i.exec(f.name); if (m) byNum[+m[1]] = f.src; });
    if (!byNum[1]) return null;
    const base = await processBase(byNum[1]);
    const poses = {};
    for (const [key, nums] of Object.entries(SHIMEJI_MAP)) {
      if (!nums.every(n => byNum[n])) continue;
      if (key === 'stand' || key === 'drag') continue; // same as main image
      const r = await processFrames(nums.map(n => byNum[n]), base.ref);
      if (r) poses[key] = { frames: r.frames, fps: SHIMEJI_FPS[key] || 4, scale: r.scale };
    }
    return { base: base.frame, ref: base.ref, poses, faces: 'left', size: Math.round(clamp(base.ref.side, 64, 200)) };
  }

  /* ---------- world ---------- */
  const CHAT = { off: Infinity, low: 2600, normal: 1200, high: 480 };
  const CALM = new Set(['idle', 'walk', 'sit', 'think', 'climb', 'wall', 'crawl', 'hang']);
  const HEART = '<svg viewBox="0 0 32 30"><path d="M16 29C6 21 0 15.5 0 9.5A8.5 8.5 0 0 1 16 5.4 8.5 8.5 0 0 1 32 9.5C32 15.5 26 21 16 29z"/></svg>';
  const STAR = (() => { let p = ''; for (let i = 0; i < 10; i++) { const r = i % 2 ? 5 : 12, a = -Math.PI / 2 + i * Math.PI / 5; p += (i ? 'L' : 'M') + (12 + r * Math.cos(a)).toFixed(1) + ' ' + (12 + r * Math.sin(a)).toFixed(1); } return `<svg viewBox="0 0 24 24"><path d="${p}z"/></svg>`; })();
  const TEAR = '<svg viewBox="0 0 24 32"><path d="M12 1C10 6 3 13 3 20a9 9 0 0 0 18 0C21 13 14 6 12 1z" fill="#8ccfff"/><ellipse cx="8.5" cy="20" rx="2.2" ry="3.4" fill="#fff" opacity=".75"/></svg>';
  const ANGER = '<svg viewBox="0 0 24 24"><path d="M9 2v5.5Q9 9 7.5 9H2M15 2v5.5Q15 9 16.5 9H22M9 22v-5.5Q9 15 7.5 15H2M15 22v-5.5Q15 15 16.5 15H22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';

  function createWorld(opt) {
    const root = opt.root;
    const world = { root, onMenu: opt.onMenu || null, w: 0, h: 0, bubbles: true, names: true, chatter: 'normal', mouse: { x: -1e4, y: -1e4, still: 0 }, fx: [] };
    const pets = new Map();
    const pairCool = new Map();
    const bounds = () => { const b = opt.bounds(); world.w = b.w; world.h = b.h; };
    bounds();
    addEventListener('resize', () => { bounds(); pets.forEach(p => p.fit()); });
    addEventListener('pointermove', e => {
      const r = root.getBoundingClientRect();
      world.mouse.x = e.clientX - r.left; world.mouse.y = e.clientY - r.top; world.mouse.still = 0;
    }, { passive: true });

    /* particles */
    world.spawn = (kind, x, y, o) => {
      const e = document.createElement('div'); e.className = 'db-fx db-fx-' + kind;
      const size = (o && o.size) || 20;
      if (kind === 'heart') { e.innerHTML = HEART; e.style.color = pick(['#ff6f9a', '#ff8fb1', '#ff5c8a', '#ffa3c0']); }
      else if (kind === 'star') { e.innerHTML = STAR; e.style.color = pick(['#ffd34d', '#ffe27a', '#ffc130']); }
      else if (kind === 'anger') { e.innerHTML = ANGER; }
      else if (kind === 'tear') { e.innerHTML = TEAR; }
      if (o && o.color && kind !== 'heart' && kind !== 'star') e.style.background = o.color;
      else if (kind === 'text') { e.textContent = o.text; e.style.fontSize = size + 'px'; }
      e.style.width = e.style.height = kind === 'text' ? '' : size + 'px';
      if (o && o.h) e.style.height = o.h + 'px';
      root.append(e);
      world.fx.push(Object.assign({ e, x, y, vx: 0, vy: 0, g: 0, life: 0, max: 60, rot: 0, vr: 0, sway: 0, ph: Math.random() * 6 }, o || {}));
    };
    function fxStep(dt) {
      for (let i = world.fx.length - 1; i >= 0; i--) {
        const p = world.fx[i]; p.life += dt;
        if (p.until && !p.until()) p.life = Math.max(p.life, p.max - 10);
        if (p.follow) { const q = p.follow(p); p.x = q.x; p.y = q.y; }
        else { p.vy += p.g * dt; p.x += p.vx * dt + Math.sin(p.life * .12 + p.ph) * p.sway; p.y += p.vy * dt; }
        p.rot += p.vr * dt;
        if (p.orient) p.rot = Math.atan2(p.vy, p.vx) * 180 / Math.PI - 90; /* point trails the motion */
        const k = p.life / p.max;
        if (p.floor != null && p.y > p.floor && p.rest) { /* land and sit there, then fade */
          p.y = p.floor; p.vx = p.vy = p.g = p.vr = 0; p.life = Math.max(p.life, p.max - p.rest); p.floor = null;
        }
        if (k >= 1 || (p.floor != null && p.y > p.floor)) { p.e.remove(); world.fx.splice(i, 1); continue; }
        const sc = p.grow ? Math.min(1, .15 + p.life / p.grow) : p.pop ? Math.min(1, p.life / 8) : 1;
        p.e.style.opacity = k > .7 ? (1 - k) / .3 : 1;
        p.e.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%) rotate(${p.rot}deg) scale(${sc})`;
      }
    }

    function pairs() {
      const arr = [...pets.values()];
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        if (a.P.surf !== 'floor' || b.P.surf !== 'floor' || !a.calm() || !b.calm()) continue;
        const key = a.id < b.id ? a.id + b.id : b.id + a.id;
        if ((pairCool.get(key) || 0) > 0) continue;
        if (Math.abs(a.P.x - b.P.x) > (a.bw() + b.bw()) * .45) continue;
        pairCool.set(key, R(900, 1600));
        a.faceTo(b.P.x); b.faceTo(a.P.x);
        const r = Math.random();
        if (r < .45) { a.go('wave'); a.say(a.line('greet')); setTimeout(() => { b.go('wave'); b.say(b.line('greet')); }, 700); }
        else if (r < .75) { a.go('love', { line: a.line('hug') }); b.go('love', { line: '' }); }
        else { a.say(a.line('bump')); b.say(b.line('bumped')); a.go('walk', { dir: a.P.x < b.P.x ? -1 : 1 }); b.go('walk', { dir: b.P.x < a.P.x ? -1 : 1 }); }
      }
      pairCool.forEach((v, k) => pairCool.set(k, v - 1));
    }

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(3, (now - last) / 16.667); last = now;
      if (world.paused) return requestAnimationFrame(frame);
      world.mouse.still += dt;
      pets.forEach(p => p.tick(dt));
      pairs();
      fxStep(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      world,
      sync(state) {
        world.bubbles = state.bubbles !== false; world.names = state.names !== false; world.chatter = state.chatter || 'normal';
        const ids = new Set(state.pets.map(p => p.id));
        pets.forEach((p, id) => { if (!ids.has(id)) { p.destroy(); pets.delete(id); } });
        state.pets.forEach(d => { if (pets.has(d.id)) pets.get(d.id).update(d); else pets.set(d.id, createPet(world, d)); });
      },
      act(id, a) { if (id === 'all') pets.forEach(p => p.act(a)); else pets.get(id) && pets.get(id).act(a); },
      /* debugging: advance n frames by hand, inspect buddies */
      step(n = 1) { for (let i = 0; i < n; i++) { pets.forEach(p => p.tick(1)); pairs(); fxStep(1); } },
      pets,
      pause(v = true) { world.paused = v; },
      /* a burst of stars where a buddy is (used when it's dismissed) */
      poof(id) {
        const p = pets.get(id); if (!p) return; const c = p.center();
        for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; world.spawn('star', c.x, c.y, { vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2 - 1, size: Math.max(12, c.s * .14), max: 38, vr: 6, pop: true }); }
      }
    };
  }

  /* ---------- a single buddy ---------- */
  function createPet(world, data) {
    const root = world.root;
    const el = document.createElement('div'); el.className = 'db-pet';
    const body = document.createElement('div'); body.className = 'db-body';
    const img = document.createElement('img'); img.alt = ''; img.draggable = false;
    body.append(img); el.append(body);
    const bub = document.createElement('div'); bub.className = 'db-bubble'; bub.hidden = true;
    const tag = document.createElement('div'); tag.className = 'db-tag';
    root.append(el, bub, tag);

    let S = 120, natural = 1, curSrc = '';
    const cache = new Map();
    const P = {
      x: 0, y: 0, surf: 'air', vx: 0, vy: 0, dir: 1, state: 'air', t: 0, dur: 0, arg: null,
      thrown: false, hard: false, sp: R(.9, 1.12), chatT: R(300, 900), awake: 0,
      swing: 0, swv: 0, hx: 0, hy: 0, roll: 0, next: null, cool: 0, shyDone: false, hover: false, lastSay: 0
    };
    const geo = { cx: 0, cy: 0, ux: 0, uy: -1, ch: 0, cw: 0, top: 0, ext: 0 };
    let bubT = 0;

    /* main-image dimensions drive physics so swapping poses doesn't jitter */
    const bw = () => (data.base.bb.x1 - data.base.bb.x0) * S;
    const bh = () => (data.base.bb.y1 - data.base.bb.y0) * S;
    const wallExt = () => Math.max(bw(), bh()) / 2 + 2;

    function update(d) {
      data = d; S = d.size || 120; natural = d.faces === 'left' ? -1 : 1; cache.clear();
      tag.textContent = d.name || '';
    }
    update(data);
    P.x = world.w * R(.25, .75); P.y = -R(0, 200); P.vy = 2;

    function resolve(key) {
      if (cache.has(key)) return cache.get(key);
      let k = key, r = null;
      while (k && k[0] !== '@') {
        const p = data.poses && data.poses[k];
        if (p && p.frames && p.frames.length) {
          let bb = null; p.frames.forEach(f => { bb = union(bb, f.bb); });
          r = { key: k, frames: p.frames, fps: p.fps || 6, scale: p.scale || 1, bb };
          break;
        }
        k = POSE[k] ? POSE[k].fb : null;
      }
      if (!r) r = { key: null, frames: [data.base], fps: 1, scale: 1, bb: data.base.bb };
      r.exact = r.key === key; r.custom = !!r.key;
      cache.set(key, r);
      return r;
    }

    /* speech */
    /* dialogue: this buddy's own lines if it has them, else the defaults */
    function L(key) { const own = data.lines && data.lines[key]; return pick(own && own.length ? own : LINES[key] || [""]); }
    function say(t) {
      if (!world.bubbles || !t) return;
      bub.textContent = t; bub.hidden = false; bub.classList.remove('pop'); void bub.offsetWidth; bub.classList.add('pop');
      clearTimeout(bubT); bubT = setTimeout(() => { bub.hidden = true; }, 2600);
      P.lastSay = performance.now();
    }

    /* effect helpers (positions from last render geometry) */
    const head = (k = .3) => ({ x: geo.cx + geo.ux * geo.ch * k, y: geo.cy + geo.uy * geo.ch * k });
    const fx = (kind, o) => { const h = head(o.at == null ? .35 : o.at); world.spawn(kind, h.x + (o.ox || 0), h.y + (o.oy || 0), o); };
    const fs = k => Math.max(12, S * k);

    /* ---------- states ---------- */
    const floorOnly = new Set(['love', 'cry', 'sleep', 'dance', 'sing', 'eat', 'angry', 'shy', 'wave', 'spin', 'roll', 'think', 'sit', 'walk', 'run', 'trip', 'dizzy', 'jump', 'climbGo', 'ceilGo', 'chase', 'idle']);
    const lift = (A, ch, k) => { A.dy -= Math.abs(Math.sin(P.t * k)) * ch; };
    const ST = {
      idle: {
        pose: 'stand', enter() { P.dur = R(60, 200); },
        tick() { if (P.t > P.dur) decideFloor(); },
        anim(A, ex) { if (!ex) { A.sy = 1 + Math.sin(P.t * .07) * .018; A.sx = 2 - A.sy; } }
      },
      walk: {
        pose: 'walk',
        enter(a) { P.dir = a && a.dir || (P.x < world.w * .2 ? 1 : P.x > world.w * .8 ? -1 : (Math.random() < .5 ? -1 : 1)); P.dur = R(120, 380); },
        tick(dt) { move(dt, 1.1 * P.sp); if (P.t > P.dur) decideFloor(); },
        anim(A, ex, ch) { if (!ex) { lift(A, ch * .045, .22); A.rot = Math.sin(P.t * .22) * 4; } }
      },
      run: {
        pose: 'run', enter(a) { P.dir = a && a.dir || P.dir; P.dur = R(60, 170); },
        tick(dt) { move(dt, 3 * P.sp); if (Math.random() < .0025 * dt) return go('trip'); if (P.t > P.dur) decideFloor(); },
        anim(A, ex, ch) { if (!ex) { lift(A, ch * .07, .4); A.rot = 6 * P.dir + Math.sin(P.t * .4) * 4; } }
      },
      climbGo: {
        pose: 'run', enter() { P.dir = P.x < world.w / 2 ? -1 : 1; P.dur = 1e9; },
        tick(dt) { move(dt, 2.2 * P.sp, true); },
        anim(A, ex, ch) { if (!ex) { lift(A, ch * .06, .35); A.rot = 5 * P.dir; } }
      },
      chase: {
        pose: 'run', enter() { P.dur = 900; say(L('chase')); },
        tick(dt) {
          const m = world.mouse, dx = m.x - P.x;
          if (Math.abs(dx) > bw() * .3) { P.dir = Math.sign(dx); move(dt, Math.min(3.4, Math.abs(dx) * .05 + 1.2) * P.sp); }
          if (Math.abs(dx) < bw() * .4 && m.y > world.h - bh() * 1.4 && m.y < world.h + 5) { say(L('caught')); return go('love', { line: '' }); }
          if (Math.abs(dx) < bw() * .5 && m.y < world.h - bh() * 1.4 && m.y > 0 && Math.random() < .02 * dt) { jump(-Math.min(17, Math.sqrt(2 * GRAV * (world.h - m.y)) + 1), 0); P.next = 'chase'; return; }
          if (P.t > P.dur) { say(L('tired')); go('sit'); }
        },
        anim(A, ex, ch) { if (!ex) { lift(A, ch * .07, .4); A.rot = 6 * P.dir; } }
      },
      sit: { pose: 'sit', enter() { P.dur = R(150, 420); }, tick() { if (P.t > P.dur) decideFloor(); }, anim(A, ex) { if (!ex) { A.sy = .9; A.sx = 1.07; } } },
      think: {
        pose: 'think', enter() { P.dur = 170; say(L('think')); fx('text', { text: '…', size: fs(.2), at: .62, ox: S * .25, follow: () => { const h = head(.62); return { x: h.x + S * .25, y: h.y }; }, max: 150, pop: true }); },
        tick() { if (P.t > P.dur) decideFloor(); }, anim(A, ex) { if (!ex) A.rot = Math.sin(P.t * .035) * 6; }
      },
      sleep: {
        pose: 'sleep', enter() { P.dur = R(500, 1100); if (Math.random() < .6) say(L('yawn')); },
        tick(dt) {
          if ((P.t | 0) % 55 === 0 && P.t - dt < (P.t | 0)) fx('text', { text: 'z', size: fs(.15) + Math.random() * 6, at: .45, ox: S * .2, vx: .35, vy: -.55, sway: .4, max: 110, pop: true });
          if (P.t > P.dur) { say(L('wake')); P.awake = 0; go('idle'); }
        },
        anim(A, ex) { if (!ex) { A.sy = .86 + Math.sin(P.t * .045) * .025; A.sx = 1.1; } }
      },
      love: {
        pose: 'happy',
        enter(a) { P.dur = 150; const line = a && a.line != null ? a.line : L('love'); say(line); for (let i = 0; i < 7; i++) fx('heart', { size: fs(R(.14, .22)), at: .4, vx: R(-2.2, 2.2), vy: R(-4.6, -2.2), g: .07, max: R(60, 95), pop: true }); },
        tick(dt) { if (Math.random() < .05 * dt) fx('heart', { size: fs(.13), at: .5, ox: R(-S * .3, S * .3), vy: -1, sway: .3, max: 70, pop: true }); if (P.t > P.dur) go('idle'); },
        anim(A, ex, ch) { lift(A, ch * (ex ? .05 : .12), .17); if (!ex) { const k = Math.abs(Math.cos(P.t * .17)); A.sy = 1 - k * .06 * (1 - Math.abs(Math.sin(P.t * .17))); } }
      },
      cry: {
        pose: 'cry',
        enter(a) {
          P.dur = (a && a.dur) || 300; say(L('cry'));
          /* a puddle that spreads under the buddy while it cries, then dries up */
          const w = Math.max(30, bw() * 1.1), h = Math.max(6, w * .16);
          world.spawn('puddle', P.x, world.h - h / 2, { size: w, h, grow: 220, max: 1e6, follow: () => ({ x: P.x, y: world.h - h / 2 }), until: () => P.state === 'cry' });
        },
        tick(dt) {
          /* two streams of tears arcing out of the eyes (eyes guessed at ~40% down the face) */
          if (Math.random() < .55 * dt) {
            const side = Math.random() < .5 ? -1 : 1, sz = fs(.06);
            fx('tear', { size: sz, h: sz * 1.33, at: .12, ox: side * geo.cw * .17, vx: side * R(1, 2.4), vy: R(-2.6, -1.2), g: .22, max: 90, orient: true, floor: world.h - 4 });
          }
          if (P.t > P.dur) go('sit');
        },
        anim(A, ex) { if (!ex) { A.dx = Math.sin(P.t * 1.1) * 1.6; A.sy = .95 + Math.sin(P.t * .3) * .02; } }
      },
      angry: {
        pose: 'angry',
        enter() { P.dur = 170; say(L('angry')); fx('anger', { size: fs(.2), max: 170, pop: true, follow: () => { const h = head(.55); return { x: h.x + S * .28, y: h.y }; }, until: () => P.state === 'angry' }); },
        tick() { if (P.t > P.dur) go('idle'); },
        anim(A, ex) { A.dx = Math.sin(P.t * 1.4) * (ex ? 1 : 2.5); if (!ex) { A.sy = 1 + Math.sin(P.t * .5) * .04; } }
      },
      shy: {
        pose: 'shy',
        enter() { P.dur = 160; say(L('shy')); fx('text', { text: '///', size: fs(.13), max: 160, follow: () => head(.15), until: () => P.state === 'shy' }); },
        tick() { if (P.t > P.dur) go('idle'); },
        anim(A, ex) { if (!ex) { A.sy = .94; A.sx = 1.03; A.rot = Math.sin(P.t * .05) * 4 - 3 * P.dir; } }
      },
      eat: {
        pose: 'eat',
        /* The snack is in the buddy's own art (eat frames), so no prop is drawn here.
           Crumbs come out in little bursts from the middle of the buddy, where the mouth and
           hands usually are on a chibi. Kept generic on purpose: art varies too much to aim at
           the actual mouth. They scatter both ways, land, sit for a moment, then fade. */
        enter() { P.dur = 240; P.crumbT = 10; say(L('eat')); },
        tick(dt) {
          P.crumbT -= dt;
          if (P.crumbT <= 0) {
            P.crumbT = R(12, 28);
            const n = 1 + Math.floor(Math.random() * 3);
            for (let i = 0; i < n; i++) {
              const side = Math.random() < .5 ? -1 : 1;
              fx('crumb', { size: fs(R(.022, .04)), at: R(-.02, .1), ox: side * geo.cw * R(.02, .16), vx: side * R(.4, 1.8), vy: R(-2.4, -.6), g: .25, vr: R(-8, 8), max: 110, floor: world.h - 2, rest: 40, color: pick(['#c78a4a', '#d9a066', '#b5763a', '#e8bd80']) });
            }
          }
          if (P.t > P.dur) { say(L('full')); go('idle'); }
        },
        anim(A, ex) { if (!ex) A.sy = 1 + Math.sin(P.t * .45) * .045; }
      },
      dance: {
        pose: 'dance', enter() { P.dur = 360; say(L('dance')); },
        tick(dt) {
          if (Math.random() < .035 * dt) fx('text', { text: pick(['♪', '♫']), size: fs(.17), at: .55, ox: R(-S * .4, S * .4), vy: -1, sway: .5, max: 80, pop: true });
          if (Math.floor(P.t / 60) !== Math.floor((P.t - dt) / 60)) P.dir = -P.dir;
          if (P.t > P.dur) go('idle');
        },
        anim(A, ex, ch) { A.rot = Math.sin(P.t * .15) * (ex ? 5 : 14); if (!ex) lift(A, ch * .07, .3); }
      },
      sing: {
        pose: 'sing', enter() { P.dur = 320; say(L('sing')); },
        tick(dt) { if (Math.random() < .03 * dt) fx('text', { text: pick(['♪', '♫', '♩']), size: fs(.16), at: .4, ox: P.dir * S * .25, vx: P.dir * .5, vy: -.8, sway: .4, max: 90, pop: true }); if (P.t > P.dur) go('idle'); },
        anim(A, ex) { if (!ex) A.rot = Math.sin(P.t * .06) * 7; }
      },
      wave: {
        pose: 'wave', enter(a) { P.dur = 100; if (!a || a.line !== '') say(a && a.line || L('hello')); },
        tick() { if (P.t > P.dur) go('idle'); },
        anim(A, ex, ch) { if (!ex && P.t < 60) { A.rot = Math.sin(P.t * .35) * 9; lift(A, ch * .03, .35); } }
      },
      spin: {
        pose: 'happy', enter() { P.dur = 46; if (Math.random() < .5) say(L('spin')); },
        tick() { if (P.t > P.dur) go(Math.random() < .2 ? 'dizzy' : 'idle'); },
        anim(A, ex, ch) { A.pivot = ch / 2; A.rot = (P.t / P.dur) * 360 * P.dir; }
      },
      roll: {
        pose: 'stand', enter() { P.dur = 130; P.roll = 0; say(L('roll')); },
        tick(dt) { const v = 2.8 * P.sp; move(dt, v); P.roll += v * dt * P.dir; if (P.t > P.dur) go('dizzy', { short: true }); },
        anim(A, ex, ch) { A.pivot = ch / 2; A.rot = P.roll / (ch / 2) / DEG; }
      },
      trip: {
        pose: 'sprawl', enter() { P.dur = 100; say(L('trip')); },
        tick() { if (P.t > P.dur) { say(L('getup')); go('idle'); } },
        anim(A, ex, ch, cw) { if (!ex) { A.dy = -cw / 2; A.rot = 90 * P.dir; } }
      },
      dizzy: {
        pose: 'dizzy',
        enter(a) {
          P.dur = a && a.short ? 90 : 170;
          for (let i = 0; i < 3; i++) fx('star', { size: fs(.12), max: P.dur, ang: i * 2.1, follow: p => { p.ang += .12; const h = head(.55); return { x: h.x + Math.cos(p.ang) * S * .3, y: h.y + Math.sin(p.ang) * S * .08 }; }, until: () => P.state === 'dizzy' });
        },
        tick() { if (P.t > P.dur) { if (P.arg && P.arg.hurt && Math.random() < .4) go('cry', { dur: 200 }); else { if (P.arg && P.arg.hurt) say(L('getup')); go('idle'); } } },
        anim(A, ex) { A.rot = Math.sin(P.t * .14) * (ex ? 4 : 12); }
      },
      land: {
        pose: 'land', enter(a) { P.dur = a && a.big ? 26 : 16; },
        tick() { if (P.t > P.dur) { const n = P.next; P.next = null; n ? act(n) : go('idle'); } },
        anim(A, ex) { if (!ex) { const k = 1 - P.t / P.dur; A.sy = 1 - .22 * k; A.sx = 1 + .16 * k; } }
      },
      air: {
        pose: () => P.vy < 0 ? 'jump' : 'fall',
        enter() { P.surf = 'air'; },
        tick: airTick,
        anim(A, ex) { if (!ex) { A.sy = 1 + clamp(Math.abs(P.vy) * .006, 0, .08); A.sx = 2 - A.sy; } A.rot = clamp(P.vx * 1.6, -25, 25); }
      },
      held: {
        pose: () => P.swing > 10 ? 'dragL' : P.swing < -10 ? 'dragR' : 'drag',
        enter() { P.surf = 'air'; P.swing = 0; P.swv = 0; if (Math.random() < .5) say(L('held')); },
        tick(dt) {
          const h = drag && drag.hist, n = h && h.length > 1 ? h[h.length - 1] : null, o = h && h.length > 1 ? h[0] : null;
          const vx = n ? (n.x - o.x) / Math.max(1, (n.t - o.t) / 16.667) : 0;
          const target = clamp(vx * 2.4, -55, 55);
          P.swv += ((target - P.swing) * .08 - P.swv * .18) * dt; P.swing += P.swv * dt;
          if (P.t > 420 && Math.random() < .004 * dt) say(L('held'));
        },
        anim(A, ex) { A.rot = P.swing * (ex ? .25 : 1); }
      },
      climb: {
        pose: 'climb', enter(a) { if (a && a.dir) P.dir = a.dir; P.dur = R(120, 400); },
        tick(dt) {
          P.y += P.dir * .85 * P.sp * dt;
          const ext = wallExt();
          if (P.y <= ext) { P.y = ext; if (Math.random() < .65) return toCeil(); P.dir = 1; }
          if (P.y >= world.h - ext) return toFloor();
          if (Math.random() < .0012 * dt) return leap();
          if (P.t > P.dur) go('wall');
        },
        anim(A, ex) { if (!ex) A.rot = Math.sin(P.t * .25) * 5; }
      },
      wall: {
        pose: 'wall', enter() { P.dur = R(60, 240); },
        tick() { if (P.t > P.dur) { const r = Math.random(); if (r < .12) leap(); else go('climb', { dir: r < .6 ? -1 : 1 }); } }
      },
      crawl: {
        pose: 'crawl', enter(a) { if (a && a.dir) P.dir = a.dir; P.dur = R(150, 420); },
        tick(dt) {
          P.x += P.dir * .8 * P.sp * dt;
          const m = wallExt();
          if (P.x < m || P.x > world.w - m) {
            P.x = clamp(P.x, m, world.w - m);
            if (Math.random() < .45) { P.surf = P.x < world.w / 2 ? 'left' : 'right'; P.x = P.surf === 'left' ? 0 : world.w; P.y = m; return go('climb', { dir: 1 }); }
            P.dir = -P.dir;
          }
          if (Math.random() < .0012 * dt) return dropDown();
          if (P.t > P.dur) go('hang');
        },
        anim(A, ex) { if (!ex) A.rot = Math.sin(P.t * .25) * 5; }
      },
      hang: {
        pose: 'hang', enter() { P.dur = R(80, 260); },
        tick() { if (P.t > P.dur) Math.random() < .3 ? dropDown() : go('crawl', { dir: Math.random() < .5 ? -1 : 1 }); },
        anim(A, ex) { if (!ex) A.rot = Math.sin(P.t * .05) * 6; }
      }
    };

    function go(name, arg) {
      P.state = name; P.t = 0; P.dur = 0; P.arg = arg || null;
      ST[name].enter && ST[name].enter(arg);
    }
    function decideFloor() {
      const W = [['idle', 3], ['walk', 5], ['sit', 1.5], ['think', .7], ['sleep', P.awake > 4000 ? 2.5 : .25], ['jump', .45], ['climbGo', .55], ['run', .5],
        ['dance', .2], ['sing', .25], ['eat', .12], ['roll', .12], ['spin', .1], ['ceilGo', .06]];
      let s = W.reduce((a, b) => a + b[1], 0) * Math.random();
      for (const [n, w] of W) { s -= w; if (s <= 0) return act(n); }
      go('idle');
    }
    /* walk along floor; returns at walls */
    function move(dt, v, wantWall) {
      P.x += P.dir * v * dt;
      const m = bw() / 2;
      if (P.x < m || P.x > world.w - m) {
        P.x = clamp(P.x, m, world.w - m);
        if (wantWall || (P.state === 'walk' && Math.random() < .2)) return mountWall(P.x < world.w / 2 ? 'left' : 'right');
        P.dir = -P.dir;
      }
    }
    function mountWall(side) {
      P.surf = side; P.x = side === 'left' ? 0 : world.w; P.y = world.h - wallExt();
      if (Math.random() < .4) say(L('climb'));
      go('climb', { dir: -1 });
    }
    function toCeil() { P.surf = 'ceil'; P.dir = P.x === 0 ? 1 : -1; P.x = P.dir > 0 ? wallExt() : world.w - wallExt(); P.y = 0; go('crawl'); }
    function toFloor() { const left = P.surf === 'left'; P.surf = 'floor'; P.y = world.h; P.x = left ? bw() / 2 : world.w - bw() / 2; P.dir = left ? 1 : -1; go('idle'); }
    function leap() { const left = P.surf === 'left'; P.surf = 'air'; P.x = left ? bw() / 2 : world.w - bw() / 2; P.y += bh() / 2; P.vx = (left ? 1 : -1) * R(3, 5); P.vy = -R(2, 5); P.thrown = false; P.dir = left ? 1 : -1; go('air'); }
    function dropDown() {
      if (P.surf === 'ceil') { P.y = bh(); } else if (P.surf === 'left' || P.surf === 'right') { P.x = P.surf === 'left' ? bw() / 2 : world.w - bw() / 2; P.y += bh() / 2; }
      P.surf = 'air'; P.vx = 0; P.vy = 0; P.thrown = false; P.hard = false;
      if (Math.random() < .6) say(L('drop'));
      go('air');
    }
    function jump(vy, vx) { P.surf = 'air'; P.vy = vy; P.vx = vx; P.thrown = false; P.hard = false; go('air'); }

    function airTick(dt) {
      P.vy += GRAV * dt; P.x += P.vx * dt; P.y += P.vy * dt;
      const m = bw() / 2, h = bh(), W = world.w, H = world.h;
      const speed = Math.hypot(P.vx, P.vy);
      if (P.x < m || P.x > W - m) {
        const side = P.x < m ? 'left' : 'right';
        P.x = clamp(P.x, m, W - m);
        if (P.thrown && Math.abs(P.vx) > 3 && speed < 34 && P.y < H - h * .3) {
          P.surf = side; P.x = side === 'left' ? 0 : W; P.y = clamp(P.y - h / 2, wallExt(), H - wallExt());
          P.thrown = P.hard = false; P.vx = P.vy = 0; say(L('grab')); return go('wall');
        }
        if (speed >= 34) { say(L('hurt')); P.hard = true; }
        P.vx = -P.vx * .35;
      }
      if (P.y - h < 0 && P.vy < 0) {
        if (P.thrown && P.vy < -5) { P.surf = 'ceil'; P.y = 0; P.x = clamp(P.x, wallExt(), W - wallExt()); P.dir = P.vx >= 0 ? 1 : -1; P.thrown = P.hard = false; P.vx = P.vy = 0; say(L('grab')); return go('hang'); }
        P.y = h; P.vy = -P.vy * .3;
      }
      if (P.y >= H) {
        P.y = H; P.surf = 'floor';
        const vy = P.vy; P.vx = P.vy = 0;
        if (P.hard) { P.hard = P.thrown = false; P.next = null; say(L('hurt')); return go('dizzy', { hurt: true }); }
        P.thrown = false;
        go('land', { big: vy > 14 });
      }
    }

    /* public action entry (panel buttons + brain) */
    function act(a) {
      if (P.state === 'held') return;
      if (a === 'drop') { if (P.surf === 'floor') { P.surf = 'air'; P.y = -bh() * .2; P.x = clamp(P.x, bw(), world.w - bw()); P.vx = 0; P.vy = 0; P.thrown = P.hard = false; go('air'); } else if (P.surf !== 'air') dropDown(); return; }
      if (a === 'held') { say(L('dragme')); return; }
      if (floorOnly.has(a) && P.surf !== 'floor') { P.next = a; if (P.surf !== 'air') dropDown(); return; }
      if (a === 'jump') return jump(-R(10, 14), P.dir * R(1, 3));
      if (a === 'ceilGo') { P.dir = Math.random() < .5 ? -1 : 1; jump(-Math.sqrt(2 * GRAV * world.h) * 1.08, P.dir * R(.5, 1.5)); P.thrown = true; return; }
      if (a === 'climb' || a === 'wall') return act('climbGo');
      if (a === 'crawl' || a === 'hang') return act('ceilGo');
      if (a === 'happy') return go('love');
      if (a === 'stand') return go('idle');
      if (a === 'fall' || a === 'land') return act('drop');
      if (a === 'sprawl') return go('trip');
      if (ST[a]) go(a);
    }

    /* ---------- input ---------- */
    let drag = null;
    const rub = { lx: 0, dir: 0, rev: [], dist: 0 };
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
      drag = { sx: e.clientX, sy: e.clientY, moved: false, hist: [] };
    });
    el.addEventListener('pointermove', e => {
      const r = root.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) {
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) { drag.moved = true; P.next = null; go('held'); }
        if (drag.moved) {
          P.hx = mx; P.hy = my;
          const now = performance.now(); drag.hist.push({ x: mx, y: my, t: now });
          while (drag.hist.length > 2 && now - drag.hist[0].t > 90) drag.hist.shift();
        }
        return;
      }
      /* rubbing = quick back-and-forth over the buddy */
      const now = performance.now(), dx = e.clientX - rub.lx; rub.lx = e.clientX;
      if (Math.abs(dx) > 1) { const s = Math.sign(dx); if (s !== rub.dir) { rub.dir = s; rub.rev.push(now); } rub.dist += Math.abs(dx); }
      rub.rev = rub.rev.filter(t => now - t < 1300);
      if (rub.rev.length >= 4 && rub.dist > 70) { rub.rev = []; rub.dist = 0; petted(); }
      if (!rub.rev.length) rub.dist = 0;
    });
    el.addEventListener('pointerenter', () => { P.hover = true; });
    el.addEventListener('pointerleave', () => { P.hover = false; P.shyDone = false; rub.rev = []; rub.dist = 0; });
    const end = e => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.moved) return click();
      const h = d.hist, a = h[0], b = h[h.length - 1];
      let vx = 0, vy = 0;
      if (h.length > 1 && performance.now() - b.t < 80) { const f = Math.max(1, (b.t - a.t) / 16.667); vx = (b.x - a.x) / f; vy = (b.y - a.y) / f; }
      vx = clamp(vx, -45, 45); vy = clamp(vy, -45, 45);
      const g = geo; // feet below the grab point
      P.x = P.hx; P.y = P.hy + g.ch * .88; P.vx = vx; P.vy = vy;
      const sp = Math.hypot(vx, vy);
      P.thrown = sp > 4; P.hard = sp > 26;
      if (P.hard) say(L('drop'));
      go('air');
    };
    /* right-click menu, only when the host page asks for one (the exported desktop page does) */
    el.addEventListener('contextmenu', e => { if (!world.onMenu) return; e.preventDefault(); world.onMenu(data.id, e.clientX, e.clientY); });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    function click() {
      const now = performance.now();
      P.clicks = (P.clicks || []).filter(t => now - t < 2500); P.clicks.push(now);
      if (P.surf === 'left' || P.surf === 'right' || P.surf === 'ceil') return dropDown();
      if (P.surf !== 'floor') return;
      if (P.state === 'sleep') { say(L('wake')); fx('text', { text: '!', size: fs(.22), at: .62, vy: -.6, max: 45, pop: true }); P.awake = 0; return go('idle'); }
      if (P.clicks.length >= 5) { P.clicks = []; return go('angry'); }
      if (P.state === 'angry') return say(L('grumpy'));
      Math.random() < .55 ? go('wave') : go('spin');
    }
    function petted() {
      if (P.cool > 0 || P.state === 'held') return;
      P.cool = 90;
      if (P.state === 'sleep') { fx('heart', { size: fs(.13), at: .5, vy: -1, max: 60, pop: true }); return; }
      if (P.surf !== 'floor') { fx('heart', { size: fs(.15), at: .5, vy: -1.2, max: 60, pop: true }); return; }
      if (P.state === 'cry' || P.state === 'angry' || P.state === 'dizzy') return go('love', { line: L('comfort') });
      go('love');
    }

    /* ---------- per-frame ---------- */
    function tick(dt) {
      P.t += dt; P.awake += dt; if (P.cool > 0) P.cool -= dt;
      ST[P.state].tick && ST[P.state].tick(dt);
      const calm = CALM.has(P.state);
      if (calm && world.bubbles && performance.now() - P.lastSay > 4000) {
        P.chatT -= dt;
        if (P.chatT <= 0) { say(L(Math.random() < .3 ? 'think' : 'chat')); P.chatT = CHAT[world.chatter] * R(.6, 1.4); }
      }
      if (P.hover && !P.shyDone && world.mouse.still > 100 && P.surf === 'floor' && calm) { P.shyDone = true; go('shy'); }
      render();
    }

    function render() {
      const st = ST[P.state];
      const key = typeof st.pose === 'function' ? st.pose() : st.pose;
      const r = resolve(key);
      let fi;
      if ((key === 'dragL' || key === 'dragR') && r.exact && r.frames.length === 2) fi = Math.abs(P.swing) > 30 ? 1 : 0;
      else fi = Math.floor(P.t * r.fps / 60) % r.frames.length;
      const f = r.frames[fi];
      if (f.src !== curSrc) { curSrc = f.src; img.src = f.src; }
      const Sz = S * r.scale, bb = r.bb;
      const cw = (bb.x1 - bb.x0) * Sz, ch = (bb.y1 - bb.y0) * Sz, cxU = (bb.x0 + bb.x1) / 2 * Sz;
      const A = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, pivot: 0 };
      st.anim && st.anim(A, r.exact, ch, cw);

      const onWall = P.surf === 'left' || P.surf === 'right';
      let rot = 0, oy, ox = P.x, oyS = P.y, face = P.dir;
      if (P.state === 'held') { oy = bb.y0 * Sz + ch * .12; ox = P.hx; oyS = P.hy; }
      else if (onWall && r.custom) { oy = (bb.y0 + bb.y1) / 2 * Sz; ox = P.surf === 'left' ? cw / 2 : world.w - cw / 2; face = P.surf === 'left' ? -1 : 1; }
      else if (P.surf === 'ceil' && r.custom) { oy = bb.y0 * Sz; }
      else {
        oy = bb.y1 * Sz;
        if (P.surf === 'left') { rot = 90; } else if (P.surf === 'right') { rot = -90; face = -P.dir; } else if (P.surf === 'ceil') { rot = 180; face = -P.dir; }
      }
      const flip = face === natural ? 1 : -1;
      el.style.width = el.style.height = Sz + 'px';
      el.style.transform = `translate(${(ox - cxU).toFixed(1)}px,${(oyS - oy).toFixed(1)}px)`;
      body.style.transformOrigin = `${cxU.toFixed(1)}px ${oy.toFixed(1)}px`;
      body.style.transform = `rotate(${rot}deg) translate(${A.dx.toFixed(1)}px,${A.dy.toFixed(1)}px) translateY(${-A.pivot}px) rotate(${A.rot.toFixed(1)}deg) translateY(${A.pivot}px) scale(${(A.sx * flip).toFixed(3)},${A.sy.toFixed(3)})`;
      el.classList.toggle('grab', P.state === 'held');

      /* geometry for effects & labels */
      const cyRel = (bb.y0 + bb.y1) / 2 * Sz - oy, a = rot * DEG;
      geo.cx = ox - cyRel * Math.sin(a); geo.cy = oyS + cyRel * Math.cos(a);
      geo.ux = Math.sin(a); geo.uy = -Math.cos(a);
      if (P.state === 'held' || (r.custom && P.surf !== 'floor' && P.surf !== 'air')) { geo.ux = 0; geo.uy = -1; }
      geo.ch = ch; geo.cw = cw;
      const extV = Math.abs(Math.sin(a)) > .5 ? cw / 2 : ch / 2;
      const top = geo.cy - extV, bottom = geo.cy + extV;
      if (!bub.hidden) {
        const bx = clamp(geo.cx, 70, world.w - 70);
        const below = top < 50;
        bub.classList.toggle('below', below);
        bub.style.transform = below ? `translate(${bx}px,${bottom + (world.names && data.name ? 30 : 8)}px) translate(-50%,0)` : `translate(${bx}px,${top - 6}px) translate(-50%,-100%)`;
      }
      tag.hidden = !world.names || !data.name;
      if (!tag.hidden) tag.style.transform = `translate(${clamp(geo.cx, 40, world.w - 40)}px,${Math.min(bottom + 4, world.h - 20)}px) translate(-50%,0)`;
    }

    function fit() {
      if (P.surf === 'floor') { P.y = world.h; P.x = clamp(P.x, bw() / 2, world.w - bw() / 2); }
      else if (P.surf === 'right') P.x = world.w;
      else if (P.surf === 'ceil') P.x = clamp(P.x, wallExt(), world.w - wallExt());
      if (P.surf === 'left' || P.surf === 'right') P.y = clamp(P.y, wallExt(), world.h - wallExt());
    }

    go('air');
    return {
      id: data.id, P, update, tick, act, say, go, fit, line: L,
      bw, calm: () => CALM.has(P.state), center: () => ({ x: geo.cx, y: geo.cy, s: S }),
      faceTo(x) { P.dir = x < P.x ? -1 : 1; },
      destroy() { el.remove(); bub.remove(); tag.remove(); }
    };
  }

  G.DesktopBuddies = { createWorld, processBase, processFrames, fromShimeji, matchScale, POSES, POSE, SHIMEJI_MAP, LINES, SITUATIONS, natSort };
})(window);
