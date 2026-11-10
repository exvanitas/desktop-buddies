/* What the Manager and the hub say to each other. The hub owns everything: a page sends commands,
   and the hub answers each one and publishes its state to anyone listening. */
import type { Failure, Problem } from './failures';
import type { Rect } from './shell';

/* What the Manager can ask a buddy who's out to do, by the engine's names. */
export const PLAYS = ['eat', 'chase'] as const;
export type Play = (typeof PLAYS)[number];
/* One buddy in the library, as a view needs it. `image` works as an <img> src in any app page. `can`
   is what of PLAYS she has the art for. */
/* `rev` changes with every write to her, so a confirm or a retry can say which of her it was about. */
export interface BuddyRow { id: string; name: string; image: string; status: 'out' | 'home'; copies: number; can: Play[]; rev: number }
export interface HubState {
  /* false until the library has been read and anything a crash left has been put back */
  ready: boolean;
  buddies: BuddyRow[];
  hidden: boolean; paused: boolean; autostart: boolean;
  /* Walk on windows, the apps to stay off, and the apps in the latest snapshot, all by exe name in
     lower case */
  walk: boolean; exclude: string[]; apps: string[];
  /* true when the Maker can be offered: a view shows New and Edit */
  maker: boolean;
  /* what went wrong and hasn't been cleared, oldest first */
  failures: Failure[];
  /* Other apps asking buddies to do things: on, the answer for each app that has asked, and the
     apps waiting for one, oldest first. */
  api: { on: boolean; apps: ApiApp[]; asking: string[] };
  /* Files that would replace someone, waiting for the person to say, oldest first. */
  replacing: Replacing[];
}
/* `ask` names the question. `name` is hers now, `called` what the file calls her, and `file` the
   file's own name. All of it comes from files, so it's only ever text. */
export interface Replacing { ask: string; id: string; name: string; called: string; file: string }
/* Replace her, keep both by adding the file as a new buddy, or neither: the question was closed. */
export type ReplaceHow = 'replace' | 'both' | 'none';
/* An app's name as it gave it, and whether the person let it. */
export interface ApiApp { name: string; allow: boolean }

export type Command =
| { k: 'call'; id: string }
| { k: 'another'; id: string }
| { k: 'dismiss-one'; id: string }
| { k: 'dismiss'; id: string } /* every copy, as the tray does */
| { k: 'bring'; id: string } /* every copy of her to the cursor. Everyone is the tray's alone, never a command */
| { k: 'act'; id: string; action: Play } /* every copy of her */
/* `rev`: null on a retry that found nobody there, so anyone there now is refused; otherwise 'ask',
   and anyone it would replace is asked about first. */
| { k: 'import'; name: string; content: string; call?: boolean; rev: null | 'ask' }
| { k: 'replace'; ask: string; how: ReplaceHow } /* the answer to a question in `replacing` */
| { k: 'export'; id: string; owner?: string } /* `owner`: the asking window's label, which the save dialog belongs to */
| { k: 'delete'; id: string; rev: number } /* `rev`: the her that was confirmed */
| { k: 'hide'; on: boolean }
| { k: 'pause'; on: boolean }
| { k: 'autostart'; on: boolean }
| { k: 'walk'; on: boolean }
| { k: 'exclude'; app: string; on: boolean } /* not `name` or `id`: the hub logs those, and an app's name stays out of the log */
| { k: 'api'; on: boolean } /* let other apps ask */
/* `app`, not `name`: the hub logs a name, and an app's stays out of the log */
| { k: 'api-answer'; app: string; allow: boolean }
| { k: 'api-forget'; app: string } /* asks again next time */
| { k: 'maker'; id?: string } /* who to edit, or none for a new buddy */
| { k: 'report'; problem: Problem } /* something a page found before the hub could */
/* The Maker page. Nothing here is logged but `id`, or `name` if there's no id. */
| { k: 'maker-open'; id: string } /* her file and revision */
| { k: 'maker-save'; id: string; name: string; file: string; rev: number | null; session: string }
| { k: 'maker-try'; id: string; action: string; call: boolean } /* `call`: bring her out first if she isn't */
| { k: 'save-page'; name: string; content: string; owner?: string } /* the standalone page, through the save dialog */
| { k: 'clear'; id?: string }; /* one failure, or all of them */

export interface MakerOpened { file: string; rev: number }
/* Refused because she changed elsewhere is an answer, not a failure: nothing went wrong, and the
   window decides what to do about it. */
export type MakerSaved = { rev: number } | { conflict: 'deleted' | 'replaced' };
/* What a Maker window is opened with. `n` orders what the hub has asked of the page, and `label` is
   the window's own, which every message to it carries. */
export interface MakerBoot { n: number; id?: string; label: string }
/* `asked`: it would replace someone, so it waits on this question. `upToDate`: she's this file
   already, so nothing changed. */
export interface Imported { id: string; name: string; replaced: boolean; asked?: string; upToDate?: true }
export interface Exported { saved: boolean }
/* A failure about one buddy can say which of her it was, so trying again can't reach a newer one. */
export type Answer<T = unknown> = { ok: true; value?: T } | { ok: false; failure: Failure; rev?: number | null };

export type ToHub = { k: 'hello' } | { k: 'do'; id: string; cmd: Command }
| { k: 'maker-hello'; label: string } /* a Maker page is listening */
| { k: 'maker-left'; n: number; label: string; clean: boolean }
| { k: 'maker-leaving'; session: string } /* a window going for good: nothing it has sent can be answered */
| MenuToHub;
/* The right-click menu. An overlay asks for it over one copy of her, with where she's drawn and where
   the click was, in physical pixels on the virtual desktop, and `t` as performance.timeOrigin plus
   now. Any press on a buddy closes it. The menu page says it's up, the CSS size it wants for the
   menu it was shown, when it took the focus, the one choice made in it, and when it should close.
   `n` is which showing, and `label` which window the page is in. The hub does every step on the
   window itself. */
export type MenuToHub = { k: 'menu-ask'; copy: string; her: Rect; at: { x: number; y: number }; t: number }
| { k: 'menu-press' }
| { k: 'menu-up'; label: string }
| { k: 'menu-ready'; n: number; label: string; w: number; h: number }
| { k: 'menu-focused'; n: number; label: string; t: number }
| { k: 'menu-choose'; n: number; label: string; cmd: Command }
| { k: 'menu-closed'; n: number; why: string };
export type FromHub = { k: 'state'; state: HubState } | { k: 'done'; id: string; answer: Answer }
| { k: 'maker-edit'; n: number; id?: string; label: string } /* flush, then open this one, or none for a new buddy */
| { k: 'maker-leave'; n: number; label: string } /* flush, and say if it can close */
| { k: 'maker-stay'; n: number; label: string } /* that close isn't happening: the hub stopped waiting, or the window wouldn't go */
/* Draw her menu, then say its size. `max` is the work area in CSS pixels, which a list too long for
   it scrolls inside. */
| { k: 'menu-show'; label: string; n: number; row: BuddyRow; maker: boolean; max: { w: number; h: number } }
| { k: 'menu-hide'; n: number } /* the hub closed it */
| { k: 'menu-ping'; label: string } /* answer with menu-up */
| { k: 'menu-check'; label: string; n: number }; /* say if this window has the keyboard: shown counts only once it does */
export type Said = ToHub | FromHub;
