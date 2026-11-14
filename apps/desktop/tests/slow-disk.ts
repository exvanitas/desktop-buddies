/* The exe's data folder as the runner's slow saves showed it, on a clock of its own, so a minute of
   it takes a moment. Every call is a round trip of `trip` ms around the exe's own work, and that
   work is one at a time, as the exe's lock makes it: `disk(n)` ms for the nth write, a few ms for
   anything else. A test's `run` moves the clock from one thing to the next until what it waits on
   is done. */
import type { Shell } from '../src/shell';

export interface SlowDisk { shell: Shell; now(): number; run<T>(p: Promise<T>): Promise<T>; writes(): number }

export function slowDisk(real: Shell, disk: (n: number) => number, trip = 4, other = 1): SlowDisk {
  let t = 0, free = 0, writes = 0;
  const due: { at: number; seq: number; f: () => void }[] = [];
  let seq = 0;
  const after = (ms: number, f: () => void) => { due.push({ at: t + ms, seq: seq++, f }); };
  /* There, waited for the lock, done, and back. */
  const call = <A extends unknown[], R>(f: (...a: A) => Promise<R>, write: boolean) => (...a: A) => new Promise<R>((done, fail) => {
    after(trip / 2, () => {
      const start = Math.max(t, free), took = write ? disk(writes++) : other;
      free = start + took;
      after(free - t, () => { f(...a).then(v => after(trip / 2, () => done(v)), e => after(trip / 2, () => fail(e))); });
    });
  });
  const shell: Shell = {
    ...real,
    dataWrite: call(real.dataWrite, true), dataDelete: call(real.dataDelete, false), dataMove: call(real.dataMove, false),
    dataList: call(real.dataList, false), dataRead: call(real.dataRead, false)
  };
  const turn = () => new Promise(r => setImmediate(r));
  return {
    shell, now: () => t, writes: () => writes,
    async run<T>(p: Promise<T>) {
      let over = false;
      void p.then(() => { over = true; }, () => { over = true; });
      for (let idle = 0; !over;) {
        await turn();
        if (over) break;
        if (!due.length) { if (++idle > 10000) throw new Error('nothing due and nothing done'); continue; }
        idle = 0;
        due.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = due.shift()!;
        t = Math.max(t, next.at);
        next.f();
      }
      return p;
    }
  };
}
