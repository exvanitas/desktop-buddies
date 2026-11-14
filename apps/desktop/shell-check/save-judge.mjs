// What a stalled big save was, from the Maker log: the runner's disk, or something of ours. The
// probe page can't read the log, so it only says which saves stalled, by buddy id and kind; smoke.ps1
// runs this over the log once the Maker runs are over:
//
//   node save-judge.mjs <maker log>
//
// and turns each line it prints, PASS or FAIL with a name and why, into a result. Lines starting
// "  trace: " are the slow-save lines it judged by. Plain JavaScript, so node runs it as it is.
//
// A disk stall passes: she landed, storing was nearly all of the hub's time, and the writes were
// disk-bound (their p90 several times their median, or one of them a second or more). Anything else
// fails: time in the hub's queue or another step, writes that weren't slow, a save that never
// landed. The probe's own writes one by one (legacy) have no hub step in them, so only the disk
// can stall them.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORING_SHARE = 0.9, SPREAD = 3, SLOW_WRITE_MS = 1000;

const steps = text => Object.fromEntries(text.split(', ').map(s => /^(.*\S) (\d+)$/.exec(s)).filter(Boolean).map(m => [m[1], Number(m[2])]));

/** `maker save of <id> took N ms: queued Q, looking L, ...` */
export function hubLine(line) {
  const m = /maker save of (\S+) took (\d+) ms: (.*)$/.exec(line);
  return m ? { id: m[1], ms: Number(m[2]), steps: steps(m[3].trim()), line: line.trim() } : null;
}
/** `library: a save took N ms: hashing H, ...; K images, 4 at a time, each M median, P p90, X most` */
export function libraryLine(line) {
  const m = /library: a save took (\d+) ms: (.*); (\d+) images, \d+ at a time, each (\d+) median, (\d+) p90, (\d+) most/.exec(line);
  return m ? { ms: Number(m[1]), steps: steps(m[2]), images: Number(m[3]), median: Number(m[4]), p90: Number(m[5]), most: Number(m[6]), line: line.trim() } : null;
}

/* Her saves the hub logged, each with the library's line for its store: the one near it in the log
   whose time is her storing time. */
function savesOf(lines, id) {
  const out = [];
  lines.forEach((l, i) => {
    const h = hubLine(l);
    if (!h || h.id !== id) return;
    const near = lines.slice(Math.max(0, i - 4), i + 4).map(libraryLine).filter(Boolean);
    const store = h.steps.storing ?? 0;
    const lib = near.find(x => Math.abs(x.ms - store) <= Math.max(50, 0.02 * store)) ?? null;
    out.push({ ...h, lib });
  });
  return out;
}

/** One stall, `{ id, kind: 'first' | 'upgrade' | 'legacy', ms }`, judged against the log's lines. */
export function classify(lines, stall) {
  if (stall.kind === 'legacy') return { disk: true, why: 'the page\'s own writes one by one, with no hub step in them', trace: [] };
  /* A first save moves her in, and an upgrade deletes her old files: that's how the library's line tells them apart. */
  const mine = savesOf(lines, stall.id).filter(s => s.lib ? (stall.kind === 'first' ? 'the move' in s.lib.steps : 'deleting' in s.lib.steps) : true);
  const s = mine.sort((a, b) => b.ms - a.ms)[0];
  if (!s) return { disk: false, why: 'never landed: no line says the hub saved her', trace: [] };
  const trace = [s.lib?.line, s.line].filter(Boolean);
  const storing = s.steps.storing ?? 0, share = storing / s.ms;
  if (share < STORING_SHARE) {
    const [step, ms] = Object.entries(s.steps).filter(([k]) => k !== 'storing').sort((a, b) => b[1] - a[1])[0] ?? ['?', 0];
    return { disk: false, why: `storing was ${Math.round(share * 100)}% of ${s.ms} ms: ${step} took ${ms}`, trace };
  }
  if (!s.lib) return { disk: false, why: 'no library line to say what its writes did', trace };
  const { median, p90, most } = s.lib;
  if (!(p90 >= SPREAD * median || most >= SLOW_WRITE_MS)) return { disk: false, why: `storing, but its writes weren't slow: ${median} median, ${p90} p90, ${most} most`, trace };
  return { disk: true, why: `storing ${Math.round(share * 100)}% of ${s.ms} ms, writes ${median} median, ${p90} p90, ${most} most`, trace };
}

/* The probe's lines that list stalls: `PROBE PASS shaped_firsts {..."stalls":[...]}` and the same for shaped. */
export function judge(text) {
  const lines = text.split(/\r?\n/), out = [];
  for (const l of lines) {
    const m = /PROBE (?:PASS|FAIL) (shaped|shaped_firsts) (\{.*\})\s*$/.exec(l);
    if (!m) continue;
    let detail;
    try { detail = JSON.parse(m[2]); } catch { out.push({ name: `maker.stall.${m[1]}`, ok: false, why: 'its line could not be read', trace: [] }); continue; }
    for (const stall of detail.stalls ?? []) {
      const v = classify(lines, stall);
      out.push({ name: `maker.stall.${m[1]}.${stall.kind}.${stall.id}`, ok: v.disk, why: `${v.disk ? 'disk stall' : 'not the disk'}: ${stall.ms} ms, ${v.why}`, trace: v.trace });
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const results = judge(readFileSync(process.argv[2], 'utf8'));
  if (!results.length) console.log('PASS maker.stalls none');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} ${r.why}`);
    for (const t of r.trace) console.log(`  trace: ${t}`);
  }
}
