/* The prompt kit on a buddy: its fields, the dialogue it brings back, and the sheet of prompts. */
import { LIMIT, SITUATIONS, type Kit, type Situation } from '@buddies/buddy-file';
import { LINES } from '@buddies/engine';
import type { MakerBuddy, MakerDeps } from './deps';
import { DEFAULT_KIT, NEGATIVE, dialoguePrompt, imagePrompts, parseReply, type FullKit, type ImagePrompt } from './prompts';
import type { Session } from './session';

export type KitField = 'personality' | 'appearance' | 'quality' | 'style';

/* Fills in the defaults on the buddy itself, so reading a kit also writes it. */
export const kitOf = (p: MakerBuddy): FullKit => (p.kit = Object.assign({}, DEFAULT_KIT, p.kit || {})) as FullKit;

/* The same kit with nothing written, for anything that only reads it. */
export const peekKit = (p: MakerBuddy): FullKit => Object.assign({}, DEFAULT_KIT, p.kit || {}) as FullKit;

/* What a buddy would say. Its own list replaces the default one whole, as in voice.ts. */
export const hasOwnLines = (p: MakerBuddy, k: Situation) => !!p.lines?.[k]?.length;
export const linesOf = (p: MakerBuddy, k: Situation): string[] => (hasOwnLines(p, k) ? p.lines![k]! : LINES[k]) || [];

/* All the prompts in `list` as one text, ready to copy. */
export function promptSheet(list: ImagePrompt[], mode: Kit['mode']) {
  return list.map(x => `### ${x.file}.png\n${x.text}`).join('\n\n') + (mode === 'tags' ? `\n\n### negative prompt\n${NEGATIVE}` : '');
}

export function createKit(s: Session, deps: MakerDeps) {
  const { world, toast, after } = deps;
  let refused: string | null = null;
  /* An empty list is the same as none, because the engine falls back to the defaults either way. */
  function putLines(p: MakerBuddy, k: Situation, list: string[]) {
    if (list.length) (p.lines = p.lines || {})[k] = list;
    else if (p.lines) { delete p.lines[k]; if (!Object.keys(p.lines).length) delete p.lines; }
  }
  return {
    kitOf, peekKit,
    /* The first change to a default list makes it the buddy's own. `i` one past the end adds a line. */
    setLine(k: Situation, i: number, text: string) {
      const p = s.current(); if (!p) return false;
      const list = [...linesOf(p, k)];
      if (text.length > LIMIT.line || i < 0 || i > list.length || i >= LIMIT.lines) return false;
      list[i] = text; putLines(p, k, list);
      s.save(); s.changed({ scope: 'field' });
      return true;
    },
    /* Taking away the last line goes back to the defaults. */
    removeLine(k: Situation, i: number) {
      const p = s.current(); if (!p) return;
      const list = [...linesOf(p, k)]; if (i < 0 || i >= list.length) return;
      list.splice(i, 1); putLines(p, k, list);
      s.save(true); s.changed({ scope: 'field' });
    },
    useDefaultLines(k: Situation) { const p = s.current(); if (!p) return; putLines(p, k, []); s.save(true); s.changed({ scope: 'field' }); },
    /* Blank lines left behind when the writer moves on. */
    tidyLines(k: Situation) {
      const p = s.current(); if (!p || !hasOwnLines(p, k)) return;
      const list = p.lines![k]!, kept = list.filter(l => l.trim());
      if (kept.length === list.length) return;
      putLines(p, k, kept); s.save(true); s.changed({ scope: 'field' });
    },
    imagePromptsFor(p: MakerBuddy) { return imagePrompts(peekKit(p), p.faces); },
    /* `style` is whichever of the two the kit's mode is using */
    setKitField(field: KitField, value: string) {
      const p = s.current(); if (!p) return; const k = kitOf(p);
      if (field === 'style') k[k.mode === 'tags' ? 'styleTags' : 'styleText'] = value; else k[field] = value;
      s.save(); s.changed({ scope: 'prompts', pet: p });
    },
    setKitMode(mode: string) { const p = s.current(); if (!p || (mode !== 'tags' && mode !== 'text')) return; kitOf(p).mode = mode; s.save(true); s.changed({ scope: 'kit', pet: p }); },
    dialoguePromptText() { const p = s.current(); return p ? dialoguePrompt(p, peekKit(p)) : null; },
    /* every situation's lines as they stand, as JSON to edit and apply back */
    currentLines() {
      const p = s.current(); if (!p) return null; const o: Record<string, string[]> = {};
      (Object.keys(SITUATIONS) as Situation[]).forEach(k => { o[k] = (p.lines && p.lines[k]) || LINES[k]; });
      return JSON.stringify(o, null, 1);
    },
    /* Why the last reply was refused, for a view to keep on show. Nothing if it wasn't. */
    replyProblem: () => refused,
    /* Takes a chatbot's reply. True if it was applied, so the view can clear it. */
    applyReply(text: string) {
      const p = s.current(); if (!p) return false;
      refused = null;
      try {
        const r = parseReply(text);
        if (!r.keys && !r.appearance) throw new Error('No known situations in that JSON');
        if (r.keys) p.lines = Object.assign({}, p.lines || {}, r.lines);
        let msg = `Applied ${r.count} lines across ${r.keys} situations`;
        if (r.appearance && !kitOf(p).appearance.trim()) { p.kit!.appearance = r.appearance; msg += ' + appearance'; }
        s.save(true); s.changed({ scope: 'all' }); toast(msg);
        if (r.keys) after(300, () => world.act(p.id, 'wave'));
        return true;
      } catch (err) { refused = "Couldn't read that: " + (err as Error).message; toast(refused); return false; }
    },
    resetLines() { const p = s.current(); if (!p) return; delete p.lines; s.save(true); s.changed({ scope: 'all' }); toast('Back to default lines'); }
  };
}
