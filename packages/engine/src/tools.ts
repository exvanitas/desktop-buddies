/* Ways to spend a random number. */
import type { Range } from './pace';

export interface Tools {
  between(a: number, b: number): number;
  pick<V>(a: readonly V[]): V;
  span(v: Range): number;
}
export function toolsFor(random: () => number): Tools {
  const between = (a: number, b: number) => a + random() * (b - a);
  return {
    between,
    pick: <V>(a: readonly V[]) => a[random() * a.length | 0]!,
    span: v => between(v[0], v[1])
  };
}
