/* Where a counter that must never repeat across runs starts: a random 52-bit number, not the
   clock, which can step back. Counting on from it stays a safe integer for 2^52 steps. */
export const randomStart = () => { const [hi, lo] = crypto.getRandomValues(new Uint32Array(2)); return (hi! >>> 12) * 2 ** 32 + lo!; };
