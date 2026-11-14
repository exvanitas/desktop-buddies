/* How the Maker probe judges a run of first saves. The runner's stalls were a new big buddy's
   first save taking several times what that machine's other saves took: 46 and 76 s against 17.
   A machine that's slow at everything is slow at all of them, so one counts as a stall only past
   both STALL_MS and STALL_X times the run's median first save. */
export const STALL_MS = 25000, STALL_X = 2.5;

export function median(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length ? s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2 : 0;
}

/* Which of them, by place, stalled. */
export function stalls(ms: number[]) {
  const m = median(ms);
  return { median: Math.round(m), stalled: ms.flatMap((t, i) => t > STALL_MS && t > STALL_X * m ? [i] : []) };
}
