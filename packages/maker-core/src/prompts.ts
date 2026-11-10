/* The prompt kit. Builds (1) an LLM prompt that writes a character's dialogue (and appearance, if
   missing) and (2) one image prompt per pose frame: appearance + pose + emotion + framing.
   Two output styles: comma tags (Anima / Stable Diffusion) or plain sentences (other generators). */
import { LIMIT, POSE, POSES, SITUATIONS, checkLines, type Buddy, type Kit, type PoseKey, type Situation } from '@buddies/buddy-file';
import { LINES } from '@buddies/engine';

interface Phrase { t: string; n: string }
export interface PosePrompt { key: string; label?: string; core?: boolean; frames: Phrase[]; emo: Phrase | null; note?: string }
export interface Appearance { kind: 'empty' | 'tags' | 'text'; keep: string[]; emo: string[]; text: string }
export interface ImagePrompt { summary: string; key: string; file: string; label: string; core: boolean; frame: number; frames: number; note?: string; text: string }
export interface Reply { lines: Partial<Record<Situation, string[]>>; count: number; keys: number; appearance: string }
export type FullKit = Required<Kit>;

/* t = tags, n = natural-language phrase. {dir} becomes left/right from "Art faces".
   emo: null = keep the character's default expression (from the appearance, else a gentle smile). */
const E: Record<string, Phrase> = {
  happy: { t: 'happy, smile, open mouth, sparkling eyes', n: 'beaming with joy, big open-mouthed smile' },
  excited: { t: 'excited, open mouth, smile', n: 'excited, mouth open' },
  surprised: { t: 'surprised, wide-eyed, open mouth', n: 'surprised, eyes wide, mouth open' },
  sleeping: { t: 'sleeping, closed eyes, drooling, zzz', n: 'fast asleep with eyes closed, a little drool' },
  pensive: { t: 'thinking, looking up, closed mouth', n: 'thoughtful, gazing upward' },
  dazed: { t: 'dazed, spiral eyes, open mouth', n: 'dazed with swirly spiral eyes' },
  annoyed: { t: 'annoyed, frown, pout', n: 'annoyed and pouting' },
  shy: { t: 'blush, embarrassed, looking away, wavy mouth', n: 'blushing bright red, embarrassed, looking away' },
  crying: { t: 'crying, streaming tears, open mouth, sad', n: 'sobbing with big streaming tears' },
  angry: { t: 'angry, v-shaped eyebrows, frown, puffed cheeks, anger vein', n: 'furious, eyebrows angled down, cheeks puffed' },
  content: { t: 'smile, closed eyes, happy', n: 'smiling contentedly with eyes closed' },
  chewing: { t: 'eating, chewing, food on face, happy', n: 'happily chewing, cheeks full' },
  determined: { t: 'determined, open mouth', n: 'determined' },
  flustered: { t: 'surprised, sweatdrop, open mouth', n: 'flustered, with a sweat drop' },
  singing: { t: 'singing, open mouth, closed eyes, happy', n: 'mouth wide open in song, eyes happily closed' }
};
const SIDE = 'from side, facing {dir}', SIDE_N = 'seen from the side, facing {dir}';
export const POSE_PROMPTS: PosePrompt[] = [
  { key: 'main', label: 'Main image', core: true, frames: [{ t: 'standing, front view, looking at viewer, arms at sides', n: 'standing upright facing the viewer, arms relaxed' }], emo: null },
  { key: 'walk', core: true, frames: [{ t: `walking, ${SIDE}, left leg forward`, n: `walking, ${SIDE_N}, left foot stepping forward` }, { t: `walking, ${SIDE}, right leg forward`, n: `walking, ${SIDE_N}, right foot stepping forward` }], emo: null },
  { key: 'sit', core: true, frames: [{ t: 'sitting, legs forward, front view, hands on lap', n: 'sitting on the ground with legs out in front, facing the viewer' }], emo: null },
  { key: 'sleep', core: true, frames: [{ t: 'sitting, sleeping, head tilt, slouching, front view', n: 'sitting and dozing off, head tilted, slouched' }], emo: E.sleeping! },
  { key: 'happy', core: true, frames: [{ t: 'arms up, cheering, front view, jumping slightly', n: 'cheering with both arms raised high' }], emo: E.happy! },
  { key: 'cry', core: true, frames: [{ t: 'sitting, crying, rubbing eyes, front view', n: 'sitting and crying, rubbing its eyes' }, { t: 'sitting, crying, hands on face, front view', n: 'sitting and wailing, hands on its cheeks' }], emo: E.crying! },
  { key: 'angry', core: true, frames: [{ t: 'standing, hands on hips, front view, stomping', n: 'standing with hands on hips, stomping a foot' }], emo: E.angry! },
  { key: 'fall', core: true, frames: [{ t: 'falling, arms up, legs apart, flailing, front view', n: 'falling through the air, arms flailing above its head' }], emo: E.surprised! },
  { key: 'drag', core: true, frames: [{ t: 'dangling, floating, arms down, legs dangling, limbs hanging, front view', n: 'dangling in the air, floating, limbs hanging' }], emo: E.annoyed! },
  { key: 'stand', frames: [{ t: 'standing, front view, closed eyes, blinking', n: 'standing upright facing the viewer, mid-blink with eyes closed' }], emo: null, note: 'Blink frame: it gets mixed in with the main image automatically, so the buddy blinks now and then.' },
  { key: 'run', frames: [{ t: `running, ${SIDE}, leaning forward, left leg forward, motion lines`, n: `running fast, ${SIDE_N}, leaning forward, left foot forward` }, { t: `running, ${SIDE}, leaning forward, right leg forward, motion lines`, n: `running fast, ${SIDE_N}, leaning forward, right foot forward` }], emo: E.determined! },
  { key: 'think', frames: [{ t: 'standing, hand on own chin, looking up, front view', n: 'standing with a hand on its chin, looking upward' }], emo: E.pensive! },
  { key: 'jump', frames: [{ t: 'jumping, arms up, knees bent, front view', n: 'leaping upward with arms raised and knees tucked' }], emo: E.excited! },
  { key: 'land', frames: [{ t: 'squatting, landing, knees bent, arms out, front view', n: 'landing in a squat, knees bent, arms out for balance' }], emo: E.surprised! },
  { key: 'sprawl', frames: [{ t: 'lying, on stomach, sprawled, arms out, full body', n: 'lying flat on its belly, sprawled out after a fall' }], emo: E.dazed! },
  { key: 'dragL', frames: [{ t: 'dangling, being lifted, body swinging to the left, legs trailing to the left, front view', n: 'dangling in the air, body swinging to the left, legs trailing behind' }], emo: E.flustered! },
  { key: 'dragR', frames: [{ t: 'dangling, being lifted, body swinging to the right, legs trailing to the right, front view', n: 'dangling in the air, body swinging to the right, legs trailing behind' }], emo: E.flustered! },
  { key: 'climb', frames: [{ t: `climbing, ${SIDE}, arms up, left arm higher, gripping`, n: `climbing up a vertical surface, ${SIDE_N}, hands reaching forward and up, left hand higher` }, { t: `climbing, ${SIDE}, arms up, right arm higher, gripping`, n: `climbing up a vertical surface, ${SIDE_N}, hands reaching forward and up, right hand higher` }], emo: E.determined!, note: 'Leave the wall itself out — just the character in a climbing pose.' },
  { key: 'hang', frames: [{ t: 'hanging, arms up, holding ledge, legs dangling, front view', n: 'hanging by both hands from an invisible ledge, legs dangling' }], emo: null, note: 'Hands should touch the very top of the image.' },
  { key: 'wave', frames: [{ t: 'waving, one arm up, front view', n: 'waving hello with one hand raised' }], emo: E.happy! },
  { key: 'shy', frames: [{ t: 'standing, hands on own cheeks, looking away, front view, fidgeting', n: 'standing bashfully, hands pressed to its cheeks' }], emo: E.shy! },
  { key: 'dizzy', frames: [{ t: 'sitting, swaying, head tilt, front view', n: 'sitting wobbly, head tilted' }], emo: E.dazed! },
  { key: 'eat', frames: [{ t: 'sitting, eating, holding cookie, both hands, front view', n: 'sitting and taking a bite of a cookie held in both hands' }, { t: 'sitting, chewing, holding cookie, bitten cookie, bite mark, both hands, front view', n: 'sitting and munching, holding a cookie in both hands with a visible bite missing from it' }], emo: E.chewing! },
  { key: 'dance', frames: [{ t: 'dancing, arms out, left leg up, front view', n: 'dancing with arms out and left leg kicked up' }, { t: 'dancing, arms out, right leg up, front view', n: 'dancing with arms out and right leg kicked up' }], emo: E.happy! },
  { key: 'sing', frames: [{ t: 'singing, hand on own chest, music notes, front view', n: 'singing with a hand on its chest' }], emo: E.singing! }
];

/* Words that describe pose, framing or background are dropped from the appearance (each pose adds its own);
   expression words become the character's default expression. */
const EMO_WORDS = ['smile', 'smiling', 'grin', 'grinning', 'happy', ':d', ':)', ':3', ':o', ';)', '^_^', '>_<', '@_@', 'open mouth', 'closed mouth', 'closed eyes', 'sad', 'crying', 'tears', 'teary eyes', 'angry', 'annoyed', 'frown', 'frowning', 'pout', 'pouting', 'blush', 'blushing', 'embarrassed', 'surprised', 'shocked', 'scared', 'sleepy', 'expressionless', 'serious', 'smug', 'laughing', 'wink', 'winking', 'tongue out', 'wide-eyed', 'excited', 'cheerful', 'grumpy', 'shy', 'nervous', 'confident', 'bored', 'tired', 'sleeping', 'determined', 'gentle smile', 'light smile', 'fang', 'skin fang'];
const DROP_WORDS = ['standing', 'sitting', 'walking', 'running', 'lying', 'kneeling', 'squatting', 'jumping', 'waving', 'arms up', 'arms behind back', 'hands on hips', 'crossed arms', 'looking at viewer', 'looking away', 'from side', 'from behind', 'from above', 'from below', 'upper body', 'portrait', 'close-up', 'cowboy shot', 'full body', 'dynamic pose', 'leaning forward', 'on back', 'on stomach', 'flying', 'floating', 'simple background', 'white background', 'transparent background', 'grey background', 'gray background', 'outdoors', 'indoors', 'sky', 'scenery', 'background', 'solo', 'centered', 'front view', 'sticker', 'chibi'];
const norm = (s: string) => s.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
const isTagList = (s: string) => s.includes(',') && s.split(',').every(p => p.trim().split(/\s+/).length <= 5);
export function splitAppearance(text?: string): Appearance {
  text = (text || '').trim();
  if (!text) return { kind: 'empty', keep: [], emo: [], text: '' };
  if (isTagList(text)) {
    const keep: string[] = [], emo: string[] = [];
    text.split(',').map(s => s.trim()).filter(Boolean).forEach(tag => {
      const n = norm(tag);
      if (EMO_WORDS.includes(n)) emo.push(tag);
      else if (!DROP_WORDS.includes(n) && !/background$/.test(n)) keep.push(tag);
    });
    return { kind: 'tags', keep, emo, text };
  }
  /* a sentence: keep it whole, just note whether it already sets an expression */
  const low = ' ' + text.toLowerCase().replace(/[^a-z0-9:;)(^_@<>\-' ]+/g, ' ') + ' ';
  const emo = EMO_WORDS.filter(w => low.includes(' ' + w + ' '));
  return { kind: 'text', keep: [], emo, text: text.replace(/[.\s]+$/, '') };
}
/* sentences ↔ tags when the user wrote the "other" kind */
const toTags = (s: string) => s.replace(/[.;]\s*/g, ', ').replace(/\b(a|an|the|with|and|has|have|is|it|its|who)\b\s*/gi, '').replace(/\s*,\s*,+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '');
const dedupe = (arr: string[]) => { const seen = new Set<string>(); return arr.filter(t => { const n = norm(t); if (!n || seen.has(n)) return false; seen.add(n); return true; }); };

export function imagePrompts(kit: Kit, faces?: string): ImagePrompt[] | null {
  const dir = faces === 'left' ? 'left' : 'right';
  let ap = splitAppearance(kit.appearance);
  if (ap.kind === 'empty') return null;
  const mode = kit.mode || 'tags';
  if (mode === 'tags' && ap.kind === 'text') { const t = splitAppearance(toTags(ap.text)); if (t.kind === 'tags') ap = t; }
  const quality = (kit.quality || '').trim();
  const style = (mode === 'tags' ? kit.styleTags : kit.styleText) || '';
  const defEmoT = ap.emo.length ? (ap.kind === 'tags' ? ap.emo.join(', ') : '') : 'smile';
  const defEmoN = ap.emo.length ? (ap.kind === 'tags' ? ap.emo.join(', ') : '') : 'a gentle smile';
  const sub = (s: string) => s.replace(/\{dir\}/g, dir);
  const out: ImagePrompt[] = [];
  POSE_PROMPTS.forEach(p => {
    p.frames.forEach((f, i) => {
      const file = p.frames.length > 1 ? `${p.key}_${i + 1}` : p.key;
      let text: string;
      if (mode === 'tags') {
        const look = ap.kind === 'tags' ? ap.keep : [toTags(ap.text)];
        const emo = p.emo ? p.emo.t : defEmoT;
        const tags = dedupe([...quality.split(','), ...style.split(','), ...look.join(',').split(','), ...sub(f.t).split(','), ...emo.split(',')].map(s => s.trim()));
        const tail = `The character is ${sub(f.n)}${p.emo ? ', ' + p.emo.n : ''}, shown in full on a plain white background. No shadow.`;
        text = tags.join(', ') + '. ' + tail;
      } else {
        const look = ap.kind === 'text' ? ap.text : ap.keep.join(', ');
        const emo = p.emo ? p.emo.n : defEmoN;
        text = `${style ? style.replace(/[.\s]+$/, '') + '. ' : ''}${quality ? quality.replace(/[.\s]+$/, '') + '. ' : ''}The character: ${look}. Pose: ${sub(f.n)}${emo ? (p.emo && ap.emo.length ? '. Expression (overrides any expression mentioned above): ' : '. Expression: ') + emo : ''}. Show the whole body from head to feet, centered with some empty space around it, on a plain flat white background. No shadow, no ground, no scenery, no text, only this one character.`;
      }
      const emoN = p.emo ? p.emo.n : (mode === 'tags' ? (defEmoT || 'default expression') : (defEmoN || 'expression as described'));
      out.push({ summary: sub(f.n) + ' · ' + emoN, key: p.key, file, label: p.label || (POSE[p.key as PoseKey] || {}).label || p.key, core: !!p.core, frame: i + 1, frames: p.frames.length, note: p.note, text });
    });
  });
  return out;
}
export const NEGATIVE = 'lowres, worst quality, bad anatomy, cropped, out of frame, multiple views, reference sheet, text, watermark, signature, shadow, ground, scenery, detailed background, border, frame';

export function dialoguePrompt(pet: Pick<Buddy, 'name'>, kit: Kit) {
  const mode = kit.mode || 'tags';
  const keys = Object.keys(SITUATIONS) as Situation[];
  const needLook = !(kit.appearance || '').trim();
  const example: Record<string, string[]> = {}; keys.slice(0, 3).forEach(k => { example[k] = LINES[k].slice(0, 2); });
  const lookSpec = mode === 'tags'
    ? 'a comma-separated list of 10–25 Danbooru-style tags describing ONLY how the character looks (species/body type, colours, hair, eyes, clothing, accessories, distinctive features). No pose, expression, framing or background tags.'
    : 'one or two sentences describing ONLY how the character looks (body type, colours, clothing, accessories, distinctive features). No pose, expression, setting or background.';
  return [
    `You are writing speech-bubble dialogue for a desktop pet character named "${pet.name || 'Buddy'}".`,
    '',
    'CHARACTER',
    (kit.personality || '').trim() || '(No description given — invent a charming, consistent personality.)',
    needLook ? '' : `Appearance: ${kit.appearance!.trim()}`,
    '',
    'CONTEXT',
    "The pet lives on the user's computer screen. It wanders around, climbs the screen edges, naps, and reacts when the user clicks, pets, or drags it. In each situation below it shows one short line in a small speech bubble.",
    '',
    'RULES',
    "- Write every line in this character's own voice: their personality, vocabulary, catchphrases, speech quirks, how formal or silly they are.",
    '- Keep lines very short: ideally 2–5 words, never more than 32 characters. Sound effects and *actions in asterisks* are welcome.',
    '- 4–6 different lines per situation. Do not reuse lines across situations.',
    '- Speak to the user as "you" where it fits. Keep it friendly and safe for work.',
    '',
    'SITUATIONS (JSON key: when it is said)',
    ...keys.map(k => `- ${k}: ${SITUATIONS[k]}`),
    '',
    'OUTPUT',
    'Reply with ONLY a JSON object (no commentary, no code fence). One key per situation above, each holding an array of strings.' + (needLook ? ` Also include an "appearance" key: ${lookSpec}` : ''),
    `Shape example (generic placeholder lines — replace them): ${JSON.stringify(Object.assign(needLook ? { appearance: '…' } : {}, example))}`
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/* What the file's rule for lines said, for someone reading a chatbot's reply. */
function plainly(why: string, said: Record<string, unknown>) {
  const many = /^(.+) has too many lines$/.exec(why), long = /^(.+) line is not a short string$/.exec(why), unknown = /^unknown field in lines: (.+)$/.exec(why);
  if (many) {
    const list = said[many[1]!];
    return Array.isArray(list) ? `"${many[1]}" has ${list.length} lines, and the limit is ${LIMIT.lines}` : `"${many[1]}" has to be a list of lines`;
  }
  if (long) {
    const list = said[long[1]!] as unknown[], over = list.find(l => typeof l !== 'string' || l.length > LIMIT.line);
    return typeof over === 'string' ? `A line in "${long[1]}" is ${over.length} characters long, and the limit is ${LIMIT.line}` : `Something in "${long[1]}" isn't a line of words`;
  }
  if (unknown) return `"${unknown[1]}" isn't a situation a buddy has`;
  return why;
}

/* Parse an AI reply (tolerates code fences / chatter around the JSON). It goes by the file's own rule
   for lines: a reply that breaks it is refused whole, and nothing is ever cut to fit. */
export function parseReply(text: string): Reply {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('No JSON object found in the reply');
  const obj = JSON.parse(text.slice(s, e + 1)), { appearance: _, ...raw } = obj as Record<string, unknown>;
  const said = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.map(x => typeof x === 'string' ? x.trim() : x).filter(x => x !== '') : v]));
  try { checkLines(said); }
  catch (err) { throw new Error(`${plainly((err as Error).message, said)}. Nothing was changed.`); }
  const lines: Reply['lines'] = {};
  let n = 0;
  (Object.keys(SITUATIONS) as Situation[]).forEach(k => {
    const arr = said[k] as string[] | undefined;
    if (arr && arr.length) { lines[k] = arr; n += arr.length; }
  });
  return { lines, count: n, keys: Object.keys(lines).length, appearance: typeof obj.appearance === 'string' ? obj.appearance.trim() : Array.isArray(obj.appearance) ? obj.appearance.join(', ') : '' };
}

/* Map uploaded file names to poses: "walk_2.png" → walk, "pip-main.png" → main image. */
export function poseFromFile(name: string): PoseKey | 'main' | null {
  const toks = name.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-z0-9]+/).filter(Boolean);
  const keys = POSES.map(p => p.key.toLowerCase() as string), most = Math.max(...keys.map(k => k.split('_').length));
  /* poses of several words first, longest first: stand_up_2.png is stand_up, not stand, and
     stand_up_from_sleep_2.png is that, not stand_up */
  for (let n = most; n > 1; n--) for (let i = 0; i + n <= toks.length; i++) { const k = keys.indexOf(toks.slice(i, i + n).join('_')); if (k >= 0) return POSES[k]!.key; }
  for (let i = toks.length - 1; i >= 0; i--) {
    if (toks[i] === 'main' || toks[i] === 'base') return 'main';
    const k = keys.indexOf(toks[i]!); if (k >= 0) return POSES[k]!.key;
  }
  return null;
}

export const DEFAULT_KIT: FullKit = {
  mode: 'tags', appearance: '', personality: '', quality: 'masterpiece, best quality',
  styleTags: 'chibi, solo, full body, simple background, white background, centered',
  styleText: 'Cute chibi mascot sticker illustration, clean outlines, flat colours'
};
/* AI images get trimmed one by one, so shorter poses would blow up to full height: start them at a sensible scale. */
/* After body-size matching: sitting poses hide the legs, so the body area shrinks a little
   and matching would blow them up slightly. Nudge those back down. */
export const AREA_ADJ: Record<string, number> = { sit: .95, sleep: .95, cry: .95, eat: .95, dizzy: .95, land: .97 };
/* fallback when size matching can't measure an image */
export const SCALE_HINT: Record<string, number> = { sit: .85, sleep: .85, cry: .85, eat: .85, dizzy: .85, happy: 1.1, jump: 1.1, fall: 1.15, hang: 1.2, climb: 1.1, wall: 1.1, drag: 1.05, dragL: 1.05, dragR: 1.05, wave: 1.05, land: .9 };
