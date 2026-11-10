/* Puts a buddy together: its state, voice, body and look, played by the runner from the book. */
import { canShow, hasArt, type PoseKey } from '@buddies/buddy-file';
import type { Actor } from './actor';
import { BOOK } from './behaviours';
import { createBody } from './body';
import { CONDITIONS } from './conditions';
import { CUES } from './cues';
import { CHAT } from './data';
import { createHands } from './hands';
import { createLook } from './look';
import { MOTIONS } from './motions';
import { createRunner, type Arg } from './runner';
import { createState, type Character } from './state';
import { toolsFor } from './tools';
import { createVoice } from './voice';
import type { BuddyData, WorldState } from './world';

export function createPet(world: WorldState, data: BuddyData) {
  const { random, now, pace, terrain } = world, tools = toolsFor(random);
  const me: Character = { data, size: 120, natural: 1 };
  const P = createState(tools);
  const emit = (event: string, arg?: Arg) => runner.emit(event, arg);
  const voice = createVoice(world, me, P, tools);
  const body = createBody(world, me, P, tools, voice, emit);
  const look = createLook(world, me, P, voice, body);
  const hands = createHands(world, P, voice, look, emit);

  function update(d: BuddyData) {
    me.data = d; me.size = d.size || 120; me.natural = d.faces === 'left' ? -1 : 1;
    look.refresh();
  }
  update(data);
  body.arrive();

  const { moves, place, ...physics } = body;
  const actor: Actor = {
    ...physics, ...tools, P, world, pace, terrain, random, place,
    fx: look.fx, fxSize: look.fxSize, head: look.head, geo: look.geo,
    say: voice.say, line: voice.line, canShow: pose => canShow(me.data, pose), hasArt: pose => hasArt(me.data, pose), size: () => me.size,
    down: look.down,
    clipLength(pose) { const p = me.data.poses[pose as PoseKey]; return p ? p.frames.length / (p.fps || 6) * 60 : 0; },
    loop(pose) { const p = me.data.poses[pose as PoseKey]; return p && p.frames.length > 1 ? p.frames.length / (p.fps || 6) * 60 : 0; },
    signature: () => me.data.signature,
    struggle() { runner.clip('struggle', hands.letGo); }, emit, dragHistory: hands.history,
    duration: name => pace[name as keyof typeof pace] as number | [number, number],
    weight(name) { const own = name === 'signature' && me.data.signature; return own && own.weight !== undefined ? own.weight : pace.weights[name] ?? 0; }
  };
  const runner = createRunner(BOOK, { motions: MOTIONS, cues: CUES, conditions: CONDITIONS, moves }, actor);

  /* Carry, grip, check, then the behaviour, then whatever else the tick brings. */
  function tick(dt: number) {
    P.t += dt; P.awake += dt; if (P.cool > 0) P.cool -= dt;
    body.footing(dt);
    runner.tick(dt);
    const calm = runner.calm();
    if (calm && world.bubbles && now() - P.lastSay > pace.quietMs) {
      P.chatT -= dt;
      if (P.chatT <= 0) { voice.say(voice.line(random() < .3 ? 'think' : 'chat')); P.chatT = CHAT[world.chatter] * tools.between(.6, 1.4); }
    }
    if (P.hover && !P.shyDone && world.mouse.still > 100 && P.surf === 'floor' && calm) { P.shyDone = true; emit('hovered'); }
    look.render(runner.pose(), runner.anim(), runner.once(), dt, runner.entry());
  }

  runner.go('air');
  return {
    id: data.id, P, update, tick, act: runner.act, say: voice.say, go: runner.go, fit: body.fit, frame: look.frame, line: voice.line, here: body.here,
    pressed: hands.pressed, moved: hands.moved, released: hands.released, entered: hands.entered, left: hands.left,
    bw: body.bw, calm: runner.calm, center: look.center,
    faceTo(x: number) { P.dir = x < P.x ? -1 : 1; },
    /* Drawn where she lands at once, so a paused world shows her there too. */
    bring(at: { x: number; y: number }) { hands.drop(); body.bring(at); look.render(runner.pose(), runner.anim(), runner.once(), 0, runner.entry()); },
    /* Wave says its own hello, so bye comes after. A host removes the pet GOODBYE_MS later. */
    farewell() { if (P.surf === 'floor') runner.go('wave'); voice.say(voice.line('bye')); }
  };
}
export type Pet = ReturnType<typeof createPet>;
