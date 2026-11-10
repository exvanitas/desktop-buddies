/* Records the golden traces from the original engine. Run by hand, once, before any refactor:
     node tests/golden/record.js */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Driver, originalScripts, ORIGINAL, CHUNK } = require('./harness');
const { scenarios } = require('./scenarios');

const scripts = originalScripts();
const traces = {};
let frames = 0;
for (const s of scenarios) {
  const d = new Driver({ scripts, ...s.opt });
  s.fn(d);
  traces[s.name] = d.finish();
  frames += traces[s.name].frames;
}
const body = Object.entries(traces).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
fs.writeFileSync(path.join(__dirname, 'traces.json'), `{\n  "commit": ${JSON.stringify(ORIGINAL)},\n  "chunk": ${CHUNK},\n  "traces": {\n${body}\n  }\n}\n`);
console.log(`${scenarios.length} scenarios, ${frames} frames`);
