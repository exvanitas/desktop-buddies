/* The lines api-e2e.ps1 sends, built here the way it builds them from character codes, through the
   app's own cleaning: the one it checks byte for byte must come out unchanged, and the refused ones
   refused for the reason it expects. The script is read as text, so a change there shows here. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';
import { cleanLine, LIMITS } from '../src/local-api';
import { hex, lineGone, lineUp } from '../shell-check/api-probe-core';

const ps = fs.readFileSync(new URL('../shell-check/api-e2e.ps1', import.meta.url), 'utf8');
/* A PowerShell line of '...' parts, [char]0x.. and [char]::ConvertFromUtf32(0x..) joined by +. */
function built(name: string) {
  const m = ps.match(new RegExp(String.raw`^\s*\$${name} = (.+)$`, 'm'));
  assert.ok(m, `$${name} in api-e2e.ps1`);
  return m[1]!.split(/\s\+\s/).map(p => {
    const s = p.trim();
    if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    const c = s.match(/^\[char\]0x([0-9A-Fa-f]+)$/) ?? s.match(/^\[char\]::ConvertFromUtf32\(0x([0-9A-Fa-f]+)\)$/);
    assert.ok(c, `a part this reads: ${s}`);
    return String.fromCodePoint(parseInt(c[1]!, 16));
  }).join('');
}

test('the line checked byte for byte has quotes, a backslash, accents, an emoji and a pipe, and cleaning keeps it whole', () => {
  const line = built('tricky');
  for (const want of ['"', '\\', 'é', '\u{1F44B}', '|']) assert.ok(line.includes(want), want);
  assert.ok(line.endsWith('\\'), 'a backslash last, before the closing quote on the command line');
  assert.deepStrictEqual(cleanLine(line), { ok: true, text: line });
});

/* What the script's Has-Said does, here: whole SAID records from the log, each field compared whole. */
function hasSaid(log: string, who: string, line: string) {
  const m = ps.match(/^\s*\$saidRecord = '\(\?m\)(.+)'$/m);
  assert.ok(m, '$saidRecord in api-e2e.ps1');
  const record = new RegExp(m[1]!, 'gm');
  return [...log.matchAll(record)].some(r => r[1] === hex(who) && r[2] === hex(line));
}

test('her line counts only as a whole record: anything appended, prefixed or cut short is not it', () => {
  const line = built('tricky'), said = (w: string, t: string) => `  12.34 PROBE SAID ${hex(w)} ${hex(t)}`;
  assert.ok(hasSaid(said('E2E Check', line) + '\r\n', 'E2E Check', line), 'the record itself, with a Windows line end');
  for (const [what, log] of [
    ['appended', said('E2E Check', line + ' CORRUPTED')],
    ['prefixed', said('E2E Check', 'x' + line)],
    ['cut short', said('E2E Check', line.slice(0, -1))],
    ['another app', said('E2E Checks', line)],
    ['garbage after the record', said('E2E Check', line) + ' zz']
  ]) assert.ok(!hasSaid(log!, 'E2E Check', line), what);
  const mcp = ps.match(/^\s*\$mcpLine = '([^']*)'$/m)![1]!;
  assert.ok(!hasSaid(said('E2E MCP', mcp + ' CORRUPTED'), 'E2E MCP', mcp));
  /* and the script uses it, comparing whole, for both lines */
  assert.match(ps, /if \(\$m\.Groups\[1\]\.Value -ceq \(Hex \$who\) -and \$m\.Groups\[2\]\.Value -ceq \(Hex \$line\)\)/);
  assert.match(ps, /Wait-For 'her bubble' \{ Has-Said \$asker \$tricky \}/);
  assert.match(ps, /Wait-For 'her bubble' \{ Has-Said \$mcpApp \$mcpLine \}/);
  assert.ok(!/\.Contains\(\$want\)/.test(ps));
});

test('every second launch the script waits for must exit 0, or it says FAIL with the code', () => {
  const ask = ps.match(/function Ask\(\[string\]\$raw\) \{\n([\s\S]*?)\n    \}\n/);
  assert.ok(ask);
  assert.match(ask[1]!, /WaitForExit\(15000\)\) \{[^\n]*\}\n\s*Exited-Clean \$p /);
  assert.match(ps, /function Exited-Clean\(\$p, \$what\) \{[\s\S]*?if \(\$p\.ExitCode -ne 0\) \{[^\n]*Expect 'launch\.exit_code' \$false "\$what exited \$\(\$p\.ExitCode\)"/);
  assert.match(ps, /'the plain second launch did not exit' \}\n\s*Expect 'manager\.plain_launch_exit' \(\$p\.ExitCode -eq 0\) "code \$\(\$p\.ExitCode\)"/);
  assert.match(ps, /Expect 'cold\.exits' \(\$exited -and \$c\.ExitCode -eq 0\)/);
  assert.match(ps, /Expect 'launches\.all_exited_0' \(\$badExits\.Count -eq 0\)/);
});

test('the refused lines are refused for the reason the script expects', () => {
  assert.deepStrictEqual(cleanLine(built('linked')), { ok: false, error: 'link' });
  const long = ps.match(/^\s*\$long = 'x' \* (\d+)$/m);
  assert.ok(long);
  assert.strictEqual(Number(long[1]), LIMITS.text + 1);
  assert.deepStrictEqual(cleanLine('x'.repeat(Number(long[1]))), { ok: false, error: 'too-long' });
  const mcp = ps.match(/^\s*\$mcpLine = '([^']*)'$/m);
  assert.ok(mcp);
  assert.deepStrictEqual(cleanLine(mcp[1]!), { ok: true, text: mcp[1] });
});

/* The probe's LINE UP and GONE records, as the script reads them for a FAIL: each field where its
   Line-Story looks for it, and the line they're about compared whole. */
test('a line\'s story is read from the probe\'s records as it writes them, for that line alone', () => {
  const m = ps.match(/^\s*\$lineRecord = '\(\?m\)(.+)'$/m);
  assert.ok(m, '$lineRecord in api-e2e.ps1');
  const record = new RegExp(m[1]!, 'gm'), mcp = ps.match(/^\s*\$mcpLine = '([^']*)'$/m)![1]!;
  const log = [
    `   20.40 PROBE ${lineUp('E2E MCP', mcp, { pose: 'base', was: { kind: 'hidden' } })}`,
    `   20.41 PROBE ${lineUp('E2E MCP', mcp + ' later', { pose: 'base', was: { kind: 'hidden' } })}`,
    `   20.67 PROBE ${lineGone('E2E MCP', mcp, { ms: 268.4, by: { kind: 'own', text: 'You called?' }, pose: 'wave' })}\r`
  ].join('\n');
  const got = [...log.matchAll(record)].filter(r => r[3] === hex('E2E MCP') && r[4] === hex(mcp)).map(r => r.slice(1, 8));
  assert.deepStrictEqual(got, [
    ['20.40', 'UP', hex('E2E MCP'), hex(mcp), 'pose="base"', 'was=hidden', undefined],
    ['20.67', 'GONE', hex('E2E MCP'), hex(mcp), 'after=268', `by=own:${hex('You called?')}`, 'pose="wave"']
  ]);
  /* and every line it checks says what became of it on a FAIL */
  for (const [who, line] of [['\$mcpApp', '\$mcpLine'], ['\$asker', '\$line'], ['\$asker', '\$tricky']]) assert.ok(ps.includes(`(Line-Story ${who} ${line})`), `${who} ${line}`);
});
