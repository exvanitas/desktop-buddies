/* assert for tests that hold DOM elements. A comparing assert that fails on an element makes Node
   diff the whole page: one test worker reached 36 GB that way. So this refuses elements every
   time, even when the test would pass, and gone() and same() compare them with a plain message. */
import nodeAssert from 'node:assert';

const COMPARING: ReadonlySet<PropertyKey> = new Set(['strictEqual', 'notStrictEqual', 'deepStrictEqual', 'notDeepStrictEqual', 'deepEqual', 'notDeepEqual', 'equal', 'notEqual']);

const holdsNode = (v: unknown, depth = 3): boolean => v instanceof Node
  || (depth > 0 && typeof v === 'object' && v !== null && Object.values(v).some(x => holdsNode(x, depth - 1)));

const assert: typeof nodeAssert = new Proxy(nodeAssert, {
  get(target, key, me) {
    const f = Reflect.get(target, key, me);
    if (!COMPARING.has(key)) return f;
    return (a: unknown, b: unknown, ...rest: unknown[]) => {
      if (holdsNode(a) || holdsNode(b)) throw new Error(`assert.${String(key)} was handed a DOM element: use gone() or same()`);
      return f(a, b, ...rest);
    };
  }
});
export default assert;

export const gone = (e: unknown, why = 'should be gone') => nodeAssert.ok(e === null, why);
export const same = (a: unknown, b: unknown, why = 'should be the same element') => nodeAssert.ok(a === b, why);
