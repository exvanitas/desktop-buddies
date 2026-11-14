/* Types for save-judge.mjs, which node runs as it is on the runner. */
export const STORING_SHARE: number, SPREAD: number, SLOW_WRITE_MS: number;
export interface Stall { id: string; kind: 'first' | 'upgrade' | 'legacy'; ms: number }
export interface Verdict { disk: boolean; why: string; trace: string[] }
export function hubLine(line: string): { id: string; ms: number; steps: Record<string, number>; line: string } | null;
export function libraryLine(line: string): { ms: number; steps: Record<string, number>; images: number; median: number; p90: number; most: number; line: string } | null;
export function classify(lines: string[], stall: Stall): Verdict;
export function judge(text: string): { name: string; ok: boolean; why: string; trace: string[] }[];
