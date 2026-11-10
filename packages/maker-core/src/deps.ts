/* Everything the Maker's logic needs from outside, and the shape of what it keeps. A host passes
   these in: nothing here reaches for a page, a clock or a disk. */
import type { Buddy, Frame, ImageRef } from '@buddies/buddy-file';
import type { BuddyData, Chatter } from '@buddies/engine';
import type { SampleKind } from './samples';

export type MakerBuddy = BuddyData;

/* What is saved. A host never gets a copy: changes land on this object, and it goes to the world
   and the store as it stands. */
export interface MakerState { pets: MakerBuddy[]; bubbles: boolean; chatter: Chatter; names: boolean; started?: boolean }
/* What a store may hand back: anything from nothing at all to a state saved by an older Maker. */
export type Saved = Partial<MakerState>;

/* Both may reject. A failed load starts empty, and a failed save warns once. */
export interface MakerStore { load(): Promise<Saved>; save(state: MakerState): Promise<void> }

/* A browser File fits this as it is. */
export interface MakerFile { name: string; type: string; webkitRelativePath?: string; text(): Promise<string> }

/* Canvas work, which is packages/art in a page. */
export interface ArtTools {
  processBase(src: string): Promise<{ frame: Frame; ref: ImageRef; photo: boolean } | null>;
  processFrames(srcs: string[], ref?: ImageRef | null, opts?: { independent?: boolean }): Promise<{ frames: Frame[]; scale: number } | null>;
  matchScale(base: Frame, frames: Frame[]): Promise<number | null>;
  /* where a picture's art ends, as a share of its height, or null if it can't be read */
  bottomOf(src: string): Promise<number | null>;
  fromShimeji(files: { name: string; src: string }[]): Promise<Buddy | null>;
  natSort(a: string, b: string): number;
}

export interface MakerDeps {
  store: MakerStore;
  /* where the buddies live: every save reaches it first, and it tries out actions */
  world: { sync(state: MakerState): void; act(id: string, action: string): void; actAll?(action: string): void };
  art: ArtTools;
  samples: { build(kind: SampleKind): Promise<Buddy>; thumb(kind: SampleKind): string };
  /* an image file as a data URL, or null if it isn't one */
  readImage(file: MakerFile | null | undefined): Promise<string | null>;
  /* builds and hands over the standalone page, which only a host can do */
  exportPage(state: MakerState): unknown;
  toast(message: string): void;
  /* What a failed save says, once. Left out, the browser's wording. null says nothing, for a host
     that shows saving itself. */
  saveWarning?: string | null;
  after(ms: number, f: () => void): number;
  cancel(id: number): void;
  random(): number;
}

/* What just changed, so a view can redraw no more than it has to. `field` is a value the view's
   own input already shows. */
export type Change = { scope: 'all' | 'field' } | { scope: 'poses' | 'kit' | 'prompts'; pet: MakerBuddy };
