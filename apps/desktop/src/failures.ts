/* What went wrong, in words for someone who isn't a coder: what it was, why, and what to do next.
   Nothing here checks a file. `read` and `unpack` in buddy-file decide, and this only says their
   reasons in plain words. tests/failures.test.ts walks real bad files through them, so a reason
   that changes there shows up. */
import { LIMIT } from '@buddies/buddy-file';

/* The field names match the design prototypes' failed import. */
export interface Problem {
  kind: 'import' | 'export' | 'delete' | 'other';
  file: string; /* the file, folder or buddy */
  title: string;
  why: string;
  fix: string;
  again?: string; /* what a button that tries again would say */
}
export interface Failure extends Problem { id: string }

/* mochi.buddy.json is Mochi's file: this is the name a person would call it. */
export const stem = (name: string) => name.replace(/\.buddy\.json$/i, '').replace(/\.[^.]+$/, '') || name;

export const ANOTHER_FILE = 'Pick another file';
export const ANOTHER_FOLDER = 'Pick another folder';
const NOT_A_BUDDY = 'Pick a .buddy file. If this is one, export it again.';
const SAVE_AGAIN = 'Open it in the Maker and save it again.';
const UPDATE = 'Update Desktop Buddies, then try again.';
const MB = Math.round(LIMIT.file / 1e6);

/* A reason from `read`, `unpack` or the exe, and what to tell the person. First match wins. */
const REASONS: [RegExp, string, string][] = [
  [/^too big$/, `It's over the ${MB} MB limit.`, 'Remove some frames in the Maker and save it again.'],
  [/^not a file$/, "That's a folder, not a file.", 'Pick the .buddy file inside it.'],
  [/^not text$|JSON|^Unexpected|^Expected|^Bad control|^Unterminated/, "It's damaged, or it isn't a buddy file.", NOT_A_BUDDY],
  [/^not a buddy file$|^file must be an object$|^unknown field in file\b/, "That isn't a buddy file.", NOT_A_BUDDY],
  [/^unknown version$/, 'It was made by a newer version of the app.', UPDATE],
  [/^unknown (pose|field)\b/, 'It has parts this version of the app doesn\'t know.', UPDATE],
  [/^no character$|^character is not an id$/, "It's missing the id that makes it this buddy.", SAVE_AGAIN],
  [/^(.+) is not an image$|^(.+) is not a png, webp, jpeg or gif$/, "Its $ isn't a PNG, WebP, JPEG or GIF.", 'Replace that image in the Maker, then save it again.'],
  [/^(.+) has too many frames$/, `Its $ has more than ${LIMIT.frames} frames.`, SAVE_AGAIN],
  [/^(.+) has too many lines$/, `Its $ lines go past the limit of ${LIMIT.lines}.`, SAVE_AGAIN],
  [/^(.+) is not a short string$/, 'Its $ is too long.', SAVE_AGAIN]
];
const WORN = ["Part of it doesn't make sense, so it may be damaged.", NOT_A_BUDDY] as const;

/* `walk-0` from unpack and `walk frame 1` from read both mean the same thing here. */
const part = (s: string) => s.replace(/-(\d+)$/, (_, n: string) => ` frame ${Number(n) + 1}`);

/* The reason text of anything thrown. */
export const reason = (e: unknown) => e instanceof Error ? e.message : String(e);

/* A reason in plain words, and what to do about it. */
function plainly(why: string): readonly [string, string] {
  const hit = REASONS.find(([re]) => re.test(why));
  const m = hit && hit[0].exec(why), named = m?.slice(1).find(Boolean);
  return hit ? [hit[1].replace('$', named ? part(named) : ''), hit[2]] : WORN;
}

export function badFile(name: string, why: string): Problem {
  const [said, fix] = plainly(why);
  return { kind: 'import', file: name, title: `${stem(name)} didn't come in`, why: said, fix, again: ANOTHER_FILE };
}

/* The file was fine and the disk wasn't. */
export const notStored = (name: string): Problem => ({
  kind: 'import', file: name, title: `${stem(name)} didn't come in`,
  why: "It couldn't be saved into your library.", fix: 'Check your disk has room, then try again.', again: 'Try again'
});

/* Saved, and it keeps being tried, so this usually goes away by itself. */
export const notReadBack = (name: string): Problem => ({
  kind: 'import', file: name, title: `${stem(name)} isn't showing yet`,
  why: "It was saved, but it couldn't be read back from your library.", fix: "It'll appear by itself once it can be read. If it doesn't, import it again."
});

export const wrongKind = (name: string, image: boolean): Problem => ({
  kind: 'import', file: name, title: `${stem(name)} didn't come in`,
  why: image ? "That's an image, not a buddy." : "That isn't a buddy file or a Shimeji folder.",
  fix: image ? 'Use New buddy to make a buddy from an image.' : 'Pick a .buddy file, or a folder of numbered Shimeji images.',
  again: ANOTHER_FILE
});

const shimeji = (folder: string, why: string, fix: string): Problem => ({
  kind: 'import', file: `${folder} (folder)`, title: `${folder} didn't come in`, why, fix, again: ANOTHER_FOLDER
});
export const noShime1 = (folder: string) => shimeji(folder, 'No shime1.png in that folder.', 'Pick the folder with the numbered images in it. It is often called img.');
export const badShime = (folder: string) => shimeji(folder, "Its images wouldn't open.", 'Check that the numbered images are real PNG files, then try again.');

export const notExported = (name: string, why: 'read' | 'save'): Problem => ({
  kind: 'export', file: name, title: `${name} wasn't exported`,
  why: why === 'read' ? "Its files in your library couldn't be read." : "The file couldn't be written there.",
  fix: why === 'read' ? 'Try again. If it keeps happening, import the buddy again.' : 'Pick another place to save it.',
  again: 'Try again'
});
export const saveOpen = (name: string): Problem => ({
  kind: 'export', file: name, title: `${name} wasn't exported`,
  why: 'A save window is already open.', fix: 'Finish or cancel that one first. It may be behind this window.'
});
export const notDeleted = (name: string, what: 'files' | 'settings'): Problem => ({
  kind: 'delete', file: name, title: `${name} wasn't deleted`,
  why: what === 'files' ? "Its files couldn't be removed." : "Your settings couldn't be saved, so nothing was changed.",
  fix: what === 'files' ? 'Try again. If it keeps happening, restart the app.' : 'Check your disk has room, then try again.', again: 'Try again'
});
/* Asked about, or tried, before a save or an import changed her. */
export const changedSinceDelete = (name: string): Problem => ({
  kind: 'delete', file: name, title: `${name} wasn't deleted`,
  why: 'She changed since you asked, so nothing was deleted.', fix: 'Delete her again if you still want to.'
});
export const changedSinceImport = (name: string): Problem => ({
  kind: 'import', file: name, title: `${stem(name)} didn't come in`,
  why: 'That buddy changed since you tried, so nothing was replaced.', fix: 'Import the file again if you still want it to replace her.'
});
/* Files wait to come in, or to be asked about, and only so many can. */
export const tooManyWaiting = (name: string): Problem => ({
  kind: 'import', file: name, title: `${stem(name)} didn't come in`,
  why: 'Too many files are already waiting to come in.', fix: 'Answer the questions waiting first, then open this one again.'
});
/* An answer to a question the app asked before it restarted. */
export const askGone = (): Problem => ({
  kind: 'import', file: 'Desktop Buddies', title: "That file didn't come in",
  why: 'The app restarted after it asked, so nothing was replaced.', fix: 'Open the file again if you still want it.'
});
export const gone = (id: string): Problem => ({
  kind: 'other', file: id, title: "That buddy isn't here", why: "It's no longer in your library.", fix: 'Pick one from the list.'
});
export const tooMany = (name: string, most: number): Problem => ({
  kind: 'other', file: name, title: `No more copies of ${name}`, why: `${most} is the most at once.`, fix: 'Dismiss a copy first.'
});
export const notReady = (): Problem => ({
  kind: 'other', file: 'Desktop Buddies', title: 'Still getting ready', why: 'Try again in a moment.', fix: ''
});

/* The Maker. The window that shows these still has the edit, so the fix says so. */
const STAYS = 'Your edit stays in this window, and it tries again when you change something.';
export const notSaved = (name: string, why: string): Problem => ({
  kind: 'other', file: name, title: `${name} wasn't saved`, why: plainly(why)[0], fix: STAYS, again: 'Try again'
});
export const notWritten = (name: string): Problem => ({
  kind: 'other', file: name, title: `${name} wasn't saved`,
  why: "It couldn't be written to your library. The copy there hasn't changed.", fix: `Check your disk has room. ${STAYS}`, again: 'Try again'
});
/* Someone else changed her while she was open here. Nothing has been written over either copy. */
export const changedElsewhere = (name: string, how: 'deleted' | 'replaced'): Problem => ({
  kind: 'other', file: name,
  title: how === 'deleted' ? `${name} was deleted` : `${name} changed somewhere else`,
  why: how === 'deleted' ? 'She was deleted from your library while open here, so this edit has nowhere to go.' : 'She was replaced in your library while open here, so this edit was not saved over her.',
  fix: 'You can keep this edit as a new buddy.'
});
/* The window closed before anyone could be asked. */
export const keptAsNew = (name: string): Problem => ({
  kind: 'other', file: name, title: `${name}'s last edit is a new buddy`,
  why: 'She changed in your library while the Maker was closing, so the edit was kept beside her.', fix: "Delete whichever one you don't want."
});
export const lastEditLost = (name: string): Problem => ({
  kind: 'other', file: name, title: `${name}'s last edit wasn't saved`,
  why: "The Maker closed, and the edit couldn't be written to your library. The copy there hasn't changed.", fix: 'Check your disk has room, then make the edit again.'
});
export const stillSaving = (): Problem => ({
  kind: 'other', file: 'Maker', title: 'Still saving', why: 'This is taking longer than it should.', fix: 'You can wait, or close now. It may still finish after the window has gone.'
});
export const notOpened = (name: string): Problem => ({
  kind: 'other', file: name, title: `${name} didn't open`, why: "Her files in your library couldn't be read.", fix: 'Try again. If it keeps happening, import the buddy again.', again: 'Try again'
});
export const makerNotClosed = (): Problem => ({
  kind: 'other', file: 'Maker', title: "The Maker didn't close", why: "Windows didn't close it.", fix: 'Your edits are still here. Try closing it again.'
});
export const makerNotOpened = (): Problem => ({
  kind: 'other', file: 'Maker', title: "The Maker didn't open", why: "Windows didn't open it.", fix: 'Try again. If it keeps happening, restart the app.', again: 'Try again'
});
export const makerBusy = (): Problem => ({
  kind: 'other', file: 'Maker', title: 'The Maker is still closing', why: "It's saving what was in it before a fresh one opens.", fix: 'Try again in a moment.'
});
export const makerHolding = (): Problem => ({
  kind: 'other', file: 'Maker', title: "The Maker has an edit it couldn't save",
  why: "It's minimized, and opening it again would lose that edit.", fix: 'Open it from the taskbar and sort that out first.'
});
export const notSet = (what: string): Problem => ({
  kind: 'other', file: what, title: `${what} didn't change`, why: "Windows didn't accept the change.", fix: 'Try again.', again: 'Try again'
});
export const broke = (what: string): Problem => ({
  kind: 'other', file: what, title: `${what} didn't work`, why: 'Something went wrong inside the app.', fix: 'Try again. If it keeps happening, restart the app.', again: 'Try again'
});
export const silent = (what: string): Problem => ({
  kind: 'other', file: what, title: `${what}: no answer`, why: "The app didn't answer in time. It may still finish.", fix: "If nothing changes, quit from the tray and start it again."
});
