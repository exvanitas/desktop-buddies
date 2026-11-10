/* What every part of the view shares: where we are, what's picked, and how to ask for a redraw. A click
   picks, the tray edits, and only Play, Say it and Try perform. */
import type { PoseKey, Situation } from '@buddies/buddy-file';
import type { Maker, MakerBuddy } from '@buddies/maker-core';
import type { Popover } from '@buddies/peel/popover';
import type { MakerViewHost, MakerViewIO } from './host';
import { MOMENTS, type Moment } from './moments';
import type { Pickers } from './pickers';

/* A sheet is its number in MOMENTS, from 1. */
export type Page = 'all' | 'words' | 'kit' | 'look' | number;
/* One artwork, one line, or one image prompt. A line one past the end of its list is a new one that
   doesn't exist until something is typed. */
export type Sel = { pose: PoseKey } | { sit: Situation; i: number } | { prompt: string };
export type Backing = 'light' | 'dark';

export interface ViewState {
  page: Page;
  sel: Sel;
  /* the Try showing in the tray */
  tried: string | null;
  back: Backing;
  /* the last sheet worked on, and each page's divider */
  last: number;
  splits: Record<string, number>;
  /* the frame picked in each pose's strip, and the pose whose picked frame stays showing */
  frames: Partial<Record<PoseKey, number>>;
  held: PoseKey | null;
  /* what's in Prompt kit's paste box, which outlives a redraw */
  reply: string;
  /* why that was refused, which stays until the box changes */
  replyWhy: string;
  allPrompts: boolean;
}

export const firstState = (): ViewState => ({
  page: 'all', sel: { pose: 'stand' }, tried: null, back: 'light', last: 0, splits: {}, frames: {}, held: null, reply: '', replyWhy: '', allPrompts: false
});

export interface View {
  maker: Maker;
  host: MakerViewHost;
  io: MakerViewIO;
  popover: Popover;
  pickers: Pickers;
  now: ViewState;
  /* only asked for while a buddy is on screen */
  pet(): MakerBuddy;
  pick(sel: Sel): void;
  open(page: Page): void;
  tryIt(action: string): void;
  setBacking(b: Backing): void;
  /* redraw this much */
  drawTray(): void;
  drawBoard(): void;
  /* what's picked changed, or the words on a sticker did */
  mark(): void;
  /* art changed size, or the divider moved */
  resized(): void;
  saveSpots(): void;
  say(message: string): void;
  copy(text: string, what: string): void;
  /* Starts work the page has to wait for, from the moment it's asked for. Nothing if it's refused. */
  busy<T>(work: () => Promise<T>): Promise<T | undefined>;
  /* an image, or images, with no pose in their names: ask what they're for */
  askAbout(files: File[]): void;
}

export const sheetOf = (page: Page): Moment | null => typeof page === 'number' ? MOMENTS[page - 1]! : null;
export const isPose = (s: Sel): s is { pose: PoseKey } => 'pose' in s;
export const isLine = (s: Sel): s is { sit: Situation; i: number } => 'sit' in s;
export const isPrompt = (s: Sel): s is { prompt: string } => 'prompt' in s;

/* Redraws a part and leaves the keyboard where it was, if that button still exists. */
export function keepFocus(box: HTMLElement, draw: () => void, fallback?: string) {
  const had = document.activeElement?.closest?.('[data-k]')?.getAttribute('data-k');
  const inside = !!had && box.contains(document.activeElement);
  draw();
  if (!inside) return;
  const find = (k: string) => box.querySelector<HTMLElement>(`[data-k="${k}"]:not(:disabled)`);
  (find(had!) || (fallback ? find(fallback) : null))?.focus();
}

/* Scroll positions in what's being redrawn. */
export function keepScroll(box: HTMLElement, selectors: string[], draw: () => void) {
  const was = selectors.map(q => { const e = box.querySelector(q); return e ? [e.scrollTop, e.scrollLeft] as const : null; });
  draw();
  selectors.forEach((q, i) => { const e = box.querySelector(q), w = was[i]; if (e && w) { e.scrollTop = w[0]; e.scrollLeft = w[1]; } });
}
