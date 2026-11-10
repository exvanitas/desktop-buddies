/* Prompt kit: describe the buddy once, then carry prompts out to a chatbot and an image AI and bring
   back what they make. Same window, same rule: a click on a prompt picks it, and the tray reads it out
   in full. Each prompt sits beside the art it asks for, so what's still missing shows at a glance. */
import { LIMIT, POSE, SITUATIONS, type PoseKey } from '@buddies/buddy-file';
import { NEGATIVE, promptSheet, type ImagePrompt, type KitField } from '@buddies/maker-core';
import { button, h, type Kid } from '@buddies/peel/dom';
import { confirmOf } from './confirm';
import { isPrompt, type View } from './context';
import { createDivider } from './divider';
import { drawArt } from './draw-art';
import { label } from './captions';

const COUNT = Object.keys(SITUATIONS).length;

export function kitPage(v: View, head: HTMLElement, board: HTMLElement) {
  /* looking at a kit writes nothing: only a change does */
  const p = v.pet(), k = v.maker.peekKit(p), maker = v.maker;

  const textField = (words: Kid[], field: KitField, value: string, rows: number, place = '') => {
    const t = h('textarea', { class: 'in', rows, maxlength: LIMIT.kit, placeholder: place, dir: 'auto', 'data-kit': field });
    t.value = value;
    t.addEventListener('input', () => maker.setKitField(field, t.value));
    return h('label', { class: 'fld' }, h('span', {}, ...words), t);
  };
  const lineField = (words: string, field: KitField, value: string) => {
    const t = h('input', { class: 'in', maxlength: LIMIT.kit, dir: 'auto', 'data-kit': field });
    t.value = value;
    t.addEventListener('input', () => maker.setKitField(field, t.value));
    return h('label', { class: 'fld' }, h('span', {}, words), t);
  };

  /* Who it is, once. It goes into every prompt, for words and pictures both. */
  const about = h('section', { class: 'kit-part' },
    h('h3', {}, 'Describe them once'),
    textField(['Personality and description'], 'personality', k.personality, 2, 'e.g. A sleepy forest spirit who talks like an old poet and is obsessed with tea'),
    textField(['Appearance ', h('small', {}, 'Leave it blank and the dialogue reply brings one')], 'appearance', k.appearance, 2, 'e.g. Small round moss creature, green fur, leaf on head, big black eyes, tiny stubby legs'),
    );
  const style = h('section', { class: 'kit-style' },
    h('div', { class: 'fld' }, h('span', {}, 'Prompt style'),
      h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'Prompt style' },
        ...(['tags', 'text'] as const).map(m => button(m === 'tags' ? 'Tags (Anima / SD)' : 'Sentences', () => maker.setKitMode(m), { role: 'radio', 'aria-checked': String(k.mode === m), 'data-mode': m, 'data-k': `mode-${m}` })))),
    k.mode === 'tags' ? lineField('Quality tags', 'quality', k.quality) : null,
    lineField('Always add', 'style', k.mode === 'tags' ? k.styleTags : k.styleText));

  /* The words go out to a chatbot and come back as JSON. */
  const reply = h('textarea', { class: 'in', rows: 3, placeholder: '{"chat": ["…"], "hello": ["…"], …}', 'aria-label': 'Paste the reply', 'data-reply': true, spellcheck: 'false' });
  reply.value = v.now.reply;
  const why = h('p', { class: 'cap reply-why', 'data-reply-why': true, role: 'alert', dir: 'auto', hidden: !v.now.replyWhy }, v.now.replyWhy);
  const refused = (text: string) => { v.now.replyWhy = text; why.textContent = text; why.hidden = !text; };
  reply.addEventListener('input', () => { v.now.reply = reply.value; refused(''); });
  const own = p.lines ? Object.keys(p.lines).length : 0;
  const askReset: HTMLButtonElement = button('Use default lines', () => {
    v.popover.show(...confirmOf('Use default lines?', `${p.name || 'This buddy'}'s own lines will go. This can't be undone.`, 'Use defaults', () => maker.resetLines(), v, askReset));
  }, { class: 'btn sm', 'data-reset': true, 'data-k': 'reset-lines', disabled: !own });
  const words = h('section', { class: 'kit-part' },
    h('h3', {}, '1. Words ', h('small', {}, 'Paste into any chatbot')),
    h('div', { class: 'row' },
      button('Copy dialogue prompt', () => { const t = maker.dialoguePromptText(); if (t !== null) v.copy(t, 'dialogue prompt'); }, { class: 'btn sm go', 'data-k': 'copy-dialogue' }),
      button('Edit current lines', () => { const t = maker.currentLines(); if (t !== null) { reply.value = t; v.now.reply = t; refused(''); } }, { class: 'btn sm', 'data-k': 'edit-lines' })),
    h('label', { class: 'fld' }, h('span', {}, 'Paste the reply'), reply),
    why,
    h('div', { class: 'row' },
      button('Apply dialogue', () => {
        /* a good reply redraws this page, so the box has to be empty by then */
        const text = reply.value;
        v.now.reply = '';
        v.now.replyWhy = '';
        if (!maker.applyReply(text)) { v.now.reply = text; refused(maker.replyProblem() ?? ''); }
      }, { class: 'btn sm', 'data-apply': true, 'data-k': 'apply' }),
      askReset),
    h('p', { class: 'cap', 'data-stat': true, dir: 'auto' }, own ? `Using ${p.name || 'this buddy'}'s own lines for ${own} of ${COUNT} situations.${own < COUNT ? ' The rest use defaults.' : ''}` : 'Using the default lines.'));

  /* The pictures go out one prompt per frame, and come back named after their poses. */
  const rows = h('div', { class: 'prompts' }), tools = h('div', { class: 'row kit-tools' });
  const upload = button('Upload generated images', () => v.pickers.open('generated'), { class: 'btn sm go', 'data-upload': true, 'data-k': 'upload-generated' });
  let shownFiles = '', summaries = new Map<string, HTMLElement>();
  const artFor = (x: ImagePrompt): Kid => {
    const key = x.key as PoseKey, frame = x.key === 'main' ? p.base : p.poses[key]?.frames[x.frame - 1];
    if (!frame) return h('span', { class: 'gap', 'aria-hidden': 'true' });
    const a = drawArt({ kind: 'own', from: null, frames: [frame], fps: 1, scale: 1, bb: frame.bb, turn: 0 });
    a.size(40, 44);
    return a.el;
  };
  const rowOf = (x: ImagePrompt) => {
    const sum = h('span', { class: 'sum', dir: 'auto', title: x.summary }, x.summary);
    summaries.set(x.file, sum);
    return h('div', { class: 'pr', 'data-file': x.file },
      button([artFor(x), h('span', { class: 'pr-t' },
        h('b', {}, x.key === 'main' ? 'Main image' : POSE[x.key as PoseKey] ? label(x.key as PoseKey) : x.label), x.frames > 1 ? h('small', {}, ` frame ${x.frame} of ${x.frames}`) : null,
        h('code', {}, `${x.file}.png`), sum)], () => v.pick({ prompt: x.file }), { class: 'pr-pick', 'data-k': `pr-${x.file}` }),
      /* read now, since typing on this page changes it and only the summary is redrawn */
      button('Copy', () => { const q = maker.imagePromptsFor(p)?.find(y => y.file === x.file); if (q) v.copy(q.text, `${x.file} prompt`); }, { class: 'btn sm', 'data-copy': x.file, 'data-k': `copy-${x.file}` }));
  };
  function refresh() {
    const list = maker.imagePromptsFor(p);
    if (!list) {
      shownFiles = '';
      rows.replaceChildren(h('div', { class: 'dropit' }, 'Add an appearance, or apply a dialogue reply that includes one, and the image prompts appear here.'));
      tools.replaceChildren(upload);
    } else {
      const listed = v.now.allPrompts ? list : list.filter(x => x.core), files = listed.map(x => x.file).join();
      if (files === shownFiles) for (const x of listed) { const s = summaries.get(x.file); if (s) { s.textContent = x.summary; s.title = x.summary; } }
      else {
        shownFiles = files; summaries = new Map();
        rows.replaceChildren(...listed.map(rowOf));
        mark();
      }
      const more = list.length - list.filter(x => x.core).length;
      tools.replaceChildren(...[
        upload,
        button(`Copy ${v.now.allPrompts ? 'all' : 'these'} (${listed.length})`, () => v.copy(promptSheet(listed, maker.peekKit(p).mode), `${listed.length} prompts`), { class: 'btn sm', 'data-copy-all': true, 'data-k': 'copy-all' }),
        maker.peekKit(p).mode === 'tags' ? button('Copy negative prompt', () => v.copy(NEGATIVE, 'negative prompt'), { class: 'btn sm', 'data-negative': true, 'data-k': 'negative' }) : null,
        button(v.now.allPrompts ? 'Essentials only' : `Show ${more} more poses`, () => { v.now.allPrompts = !v.now.allPrompts; refresh(); }, { class: 'btn sm', 'data-more': true, 'data-k': 'more-prompts' })
      ].filter(b => b !== null));
    }
    /* a kit field changed under a prompt being read */
    if (isPrompt(v.now.sel)) { const text = document.querySelector<HTMLTextAreaElement>('.tray [data-prompt-text]'), x = list?.find(y => y.file === (v.now.sel as { prompt: string }).prompt); if (text) text.value = x?.text ?? ''; }
  }
  function mark() {
    const sel = v.now.sel;
    for (const r of rows.querySelectorAll<HTMLElement>('.pr')) r.classList.toggle('on', isPrompt(sel) && r.dataset.file === sel.prompt);
  }

  const pictures = h('aside', { class: 'strip kit-pics' },
    h('h3', {}, '2. Pictures ', h('small', {}, 'One prompt per frame')),
    style, tools, rows,
    h('div', { class: 'upload' },
      h('p', {}, 'Name them after the pose: ', h('code', {}, 'main.png'), ', ', h('code', {}, 'walk_1.png'), '. Drop them all at once if you like. Plain backgrounds come off, and each pose is scaled to match the main image.'),
      h('p', {}, 'Make ', h('b', {}, 'main'), ' first, then use it as a reference image, so every pose looks like the same buddy.')));

  const left = h('div', { class: 'page kit-page' }, about, words);
  const spread = h('div', { class: 'spread' }, left);
  spread.append(createDivider(v, left, spread, 'kit', .46, 'Share the width between words and pictures'), pictures);
  board.replaceChildren(head, spread);
  refresh();
  return { refresh, mark };
}
