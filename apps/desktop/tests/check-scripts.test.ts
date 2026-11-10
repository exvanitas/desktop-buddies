/* The Windows check scripts, read as text: there's no PowerShell here to run them. Each rule is a way
   one of them failed on a real PC with no line to say where. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';

const SCRIPTS = ['taskbar-check.ps1', 'menu-check.ps1'] as const;
const DIR = new URL('../shell-check/', import.meta.url);
const ALL = fs.readdirSync(DIR).filter(f => f.endsWith('.ps1')).sort();
const read = (name: string) => fs.readFileSync(new URL(name, DIR), 'utf8');

/* The code without comments and here-strings, line for line. */
const code = (ps: string) => ps
  .replace(/@"\r?\n[\s\S]*?\r?\n"@/g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').map(l => l.replace(/^\s*#.*$/, '')).join('\n');

/* Where the script's param block starts and ends, inside its brackets. -1 -1 if it has none. */
const paramSpan = (ps: string) => {
  const at = ps.search(/^param\(/m);
  if (at < 0) return [-1, -1] as const;
  let depth = 0;
  for (let i = at + 5; i < ps.length; i++) {
    depth += ps[i] === '(' ? 1 : ps[i] === ')' ? -1 : 0;
    if (depth === 0) return [at + 6, i] as const;
  }
  throw new Error('param( never closes');
};
/* Its parameters, with their types in lower case, '' when untyped. */
const typed = (ps: string) => {
  const [from, to] = paramSpan(ps);
  if (from < 0) return [];
  return [...ps.slice(from, to).matchAll(/((?:\[[^\]$]*\])*)\$([A-Za-z]\w*)/g)]
    .map(m => ({ name: m[2]!, type: (m[1]!.match(/\[(\w+)\]$/)?.[1] ?? '').toLowerCase() }));
};
const params = (ps: string) => typed(ps).map(p => p.name);
/* The code after the param block. */
const body = (ps: string) => code(ps.slice(Math.max(0, paramSpan(ps)[1])));
/* The script and every helper it dot-sources from this folder, as code. */
const withHelpers = (name: string) => {
  const ps = read(name);
  const helpers = [...ps.matchAll(/^\s*\. \(Join-Path \$(?:PSScriptRoot|here) '([\w-]+\.ps1)'\)/gm)].map(m => m[1]!);
  return [ps, ...helpers.map(read)].map(code).join('\n');
};

/* Every spelling of each variable, by its lower-case name. */
const spellings = (src: string) => {
  const seen = new Map<string, Set<string>>();
  for (const m of src.matchAll(/\$(?:script:)?([A-Za-z_]\w*)/g)) {
    const k = m[1]!.toLowerCase();
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(m[1]!);
  }
  return seen;
};
const lineAt = (ps: string, i: number) => ps.slice(ps.lastIndexOf('\n', i) + 1, ps.indexOf('\n', i));
/* The one line that is the -SetupOnly gate, not a mention of it in a message. */
const setupGate = (ps: string) => {
  const gates = [...ps.matchAll(/^\s*if \(\$SetupOnly\) \{$/gm)];
  assert.strictEqual(gates.length, 1, 'one gate');
  return gates[0]!.index!;
};

/* The local occlusion check is kept out of the public copy, so it's read only where it is. */
const LOCAL = ALL.includes('chromium-occlusion-local.ps1');

test('every check script is read here', () => {
  assert.ok(ALL.length >= 10 && ALL.includes('smoke.ps1') && ALL.includes('first-buddy.ps1'), ALL.join(','));
});

for (const name of ALL) {
  test(`${name}: one spelling per variable, its helpers' too, as PowerShell's names ignore case`, () => {
    /* $exe = $null emptied the [string] -Exe; $warm = @() hit the [int] -Warm; $work = a rect hid -Work */
    const own = new Map(params(read(name)).map(p => [p.toLowerCase(), p]));
    const mixed = [...spellings(withHelpers(name))].filter(([, s]) => s.size > 1)
      .map(([k, s]) => `${[...s].join('/')}${own.has(k) ? ` (the parameter -${own.get(k)})` : ''}`);
    assert.deepStrictEqual(mixed, []);
  });

  test(`${name}: a parameter that isn't a string is never given a new value`, () => {
    const src = body(read(name));
    const fixed = typed(read(name)).filter(p => p.type && p.type !== 'string');
    const bad = fixed.flatMap(p => [...src.matchAll(new RegExp(String.raw`\$${p.name}\s*(=(?!=)|\+=|-=|\+\+|--)|foreach \(\$${p.name} in`, 'gi'))].map(m => `${p.type} ${m[0]}`));
    assert.deepStrictEqual(bad, []);
  });
}

for (const name of ['smoke.ps1', ...LOCAL ? ['chromium-occlusion-local.ps1'] : []]) {
  test(`${name}: an error anywhere says FAIL run.error with its line and keeps the results`, () => {
    const ps = read(name);
    assert.match(ps, /function Error-Line\(\$e\) \{[\s\S]*?" at line \$\(\$i\.ScriptLineNumber\)/);
    const trap = ps.match(/^trap \{\n([\s\S]*?)\n\}/m);
    assert.ok(trap, 'a trap at the top');
    assert.match(trap[1]!, /\$msg = "FAIL run\.error \$\(Error-Line \$_\)"/);
    assert.match(trap[1]!, /Set-Content -LiteralPath \(Join-Path \$Out '(smoke|occlusion)\.txt'\)/);
    assert.match(trap[1]!, /\n  break$/);
    /* defined before anything that can throw */
    assert.ok(ps.indexOf('function Error-Line') < ps.indexOf('. (Join-Path'), 'Error-Line comes first');
  });
}

test.skipIf(!LOCAL)("chromium-occlusion-local.ps1: the run's catch keeps its line before the cleanup, and each cleanup step is on its own", () => {
  const ps = read('chromium-occlusion-local.ps1');
  assert.match(ps, /\} catch \{\n(?:\s*#[^\n]*\n)?\s*Say "FAIL run\.error \$\(Error-Line \$_\)"\n\s*Write-Host \$_\.ScriptStackTrace\n\s*try \{ \$lines \| Set-Content/);
  const f = ps.lastIndexOf('} finally {');
  const fin = ps.slice(f, ps.indexOf('\n}\n', f));
  assert.deepStrictEqual(fin.split('\n').slice(1).filter(l => /^  (?!Tidy |\})\S/.test(l)), [], 'every cleanup step is in a Tidy');
  assert.match(fin, /Tidy 'cursor' \{ if \(\$back\)/);
  /* the stray hunt reads -Work itself */
  assert.ok(fin.includes('$_.CommandLine.Contains($Work)'));
});

for (const name of SCRIPTS) {
  test(`${name}: a parameter is only ever given its resolved path`, () => {
    const src = body(read(name));
    const ps = params(read(name));
    assert.ok(ps.length >= 3, ps.join(','));
    const re = new RegExp(`\\$(${ps.join('|')})\\s*=(?!=)\\s*(.*)$|foreach \\(\\$(${ps.join('|')}) in`, 'gim');
    const bad = [...src.matchAll(re)].filter(m => !/^\(Resolve-Path -LiteralPath \$\w+\)\.Path$/.test((m[2] ?? '').trim())).map(m => m[0]);
    assert.deepStrictEqual(bad, []);
  });

  test(`${name}: an error writes FAIL run.error with its line before any cleanup`, () => {
    const ps = read(name);
    const save = name === 'taskbar-check.ps1' ? 'Done' : 'Save-Results';
    assert.match(ps, /function Error-Line\(\$e\) \{[\s\S]*?" at line \$\(\$i\.ScriptLineNumber\)/);
    /* the catch saves the results, and the finally comes after */
    const catches = [...ps.matchAll(new RegExp(String.raw`catch \{\n(?:\s*#[^\n]*\n)?\s*Expect 'run\.error' \$false \(Error-Line \$_\)\n\s*Write-Host \$_\.ScriptStackTrace\n\s*${save}\n`, 'g'))];
    assert.ok(catches.length >= 1, 'a catch that records run.error and saves');
    const last = catches.at(-1)!.index!;
    assert.ok(ps.indexOf('} finally {', last) > last, 'the cleanup runs after the catch has saved');
    /* each cleanup step on its own, so its error is noted and never hides the run's */
    const fin = ps.slice(ps.indexOf('} finally {', last));
    assert.ok(!/^\s*(Stop-Process|Copy-Item|Remove-Item|\[void\]\[W\]::MoveCursor)/m.test(fin), 'every cleanup step is in a Tidy');
    assert.match(ps, /function Tidy\(\$what, \[scriptblock\]\$step\) \{\n\s*try \{ \. \$step \} catch \{ Expect "cleanup\.\$what" \$false \(Error-Line \$_\) \}/);
  });

  test(`${name}: nothing that can throw runs outside a try`, () => {
    const lines = code(read(name)).split('\n');
    const start = lines.findIndex(l => /^\$ErrorActionPreference = 'Stop'/.test(l));
    let depth = 0;
    const outside: string[] = [];
    lines.forEach((l, i) => {
      if (i > start && depth === 0 && /\b(Join-Path|Resolve-Path|New-Item|Copy-Item|Remove-Item|Test-Path|Start-Process|Add-Type|Get-Process|Set-Content)\b|^\s*\. /.test(l) && !/^\s*function /.test(l)) outside.push(`${i + 1}: ${l.trim()}`);
      for (const ch of l) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
    });
    assert.strictEqual(depth, 0, 'braces balance');
    assert.deepStrictEqual(outside, []);
  });

  test(`${name}: -SetupOnly stops before any window, process or mouse`, () => {
    const ps = read(name);
    assert.match(ps, /\[switch\]\$SetupOnly/);
    const gate = setupGate(ps);
    const fin = ps.lastIndexOf('} finally {');
    for (const act of ['Start-Process', '[W]::Click(', '[W]::MoveCursor(', '[W]::CursorAt()', '[W]::Foreground(', '[K]::Tap(']) {
      for (let i = ps.indexOf(act); i >= 0; i = ps.indexOf(act, i + 1)) {
        const line = lineAt(ps, i);
        if (/^\s*#/.test(line) || /^\s*\[DllImport/.test(line)) continue;
        if (i > fin) {
          /* the cleanup moves the cursor back only when the run took it */
          assert.match(line, act === '[W]::MoveCursor(' ? /if \(\$(p -and \$cursor|cursorWas)\)/ : /if \(\$(p|form|holder) -and -not/, line);
        } else assert.ok(i > gate, `${act} before the -SetupOnly gate: ${line.trim()}`);
      }
    }
    assert.match(ps, /setup_only.*no window opened, no process started, no mouse moved/);
  });
}

test('taskbar-check.ps1: -SetupOnly reads and saves no screen pixels', () => {
  const ps = read('taskbar-check.ps1');
  const gate = setupGate(ps);
  /* the screen is read only in Look, and Look runs before the gate only when it isn't setup only */
  const grabs = [...new Set([...ps.matchAll(/\[Tb\]::Grab\(/g)].map(m => lineAt(ps, m.index!)))];
  assert.strictEqual(grabs.length, 1, grabs.join('\n'));
  assert.match(grabs[0]!, /^\s*\$s = \[Tb\]::Grab\(\$strip[^\n]*\$b = \[Tb\]::Grab\(\$band/);
  assert.ok(ps.lastIndexOf('function Look(', ps.indexOf(grabs[0]!)) > ps.lastIndexOf('\n}', ps.indexOf(grabs[0]!)), 'inside Look');
  const looks = [...ps.matchAll(/Look '/g)].filter(m => m.index! < gate).map(m => lineAt(ps, m.index!));
  assert.ok(looks.length >= 1);
  for (const l of looks) assert.match(l, /-not \$SetupOnly/, l);
  for (const other of ['[Px]::Shot(', '[Px]::Window(', 'CopyFromScreen']) assert.ok(!ps.includes(other), other);
  assert.match(ps, /setup_only.*no screen read/);
});

test("taskbar-check.ps1: always on top is the taskbar's own WS_EX_TOPMOST, logged with its hwnd and exstyle", () => {
  const ps = read('taskbar-check.ps1');
  /* ABM_GETSTATE never sets its always-on-top bit since Windows 7: it read False on a topmost taskbar */
  assert.ok(!/always_on_top \$\(\[bool\]\(\$a\[0\] -band 2\)\)/.test(ps));
  assert.match(ps, /\$ex = if \(\$tb\) \{ \[Tb\]::ExStyle\(\$tb\) \}/);
  assert.match(ps, /public static long ExStyle\(long h\) \{ return GetLong\(new IntPtr\(h\), -20\)\.ToInt64\(\); \}/);
  assert.match(ps, /hwnd 0x\{0:x\}[^\n]*exstyle 0x\{1:x\} always_on_top \$\(\[bool\]\(\$ex -band 8\)\)/);
  for (const when of ['before', 'up', 'after_taskbar_click', 'after_window_click', 'end']) assert.ok(ps.includes(`Facts '${when}'`), when);
  assert.match(ps, /Note "\$when\.full_screen_windows"/);
  assert.match(ps, /Note "\$when\.foreground" "class /);
});

test('taskbar-check.ps1: the stray hunt never matches every WebView2 when there is no folder', () => {
  const ps = read('taskbar-check.ps1');
  assert.match(ps, /\(\$tmp -and \$_\.Name -eq 'msedgewebview2\.exe' -and \$_\.CommandLine -like "\*\$tmp\*"\)/);
  assert.ok(!/-like "\*\$tmp\*"/.test(ps.replace(/\$tmp -and \$_\.Name -eq 'msedgewebview2\.exe' -and \$_\.CommandLine -like "\*\$tmp\*"/g, '')));
});

/* Coverage in taskbar-check.ps1, the same rule in TypeScript, checked against its text. */
const covers = (r: number[], w: number, h: number) => {
  const d = [r[0]!, r[1]!, w - r[2]!, h - r[3]!];
  const short = [0, 1, 2, 3].filter(i => d[i] !== 0);
  if (!short.length) return 'whole';
  if (short.length === 1 && d[short[0]!] === 1) return `1 px short on the ${['left', 'top', 'right', 'bottom'][short[0]!]}`;
  return null;
};

test('taskbar-check.ps1: an overlay covers the monitor whole, or but for a 1 px line on one edge', () => {
  const ps = read('taskbar-check.ps1');
  assert.ok(ps.includes("$d = @($r[0], $r[1], ($primary[0] - $r[2]), ($primary[1] - $r[3]))"));
  assert.ok(ps.includes("if ($short.Count -eq 1 -and $d[$short[0]] -eq 1)"));
  assert.ok(ps.includes("$how = Coverage $r; if ($how)"));
  assert.match(ps, /'overlay 0x\{0:x\} rect ' -f \$overlay\) \+ \(\$overlayRect -join ','\)/);
  assert.strictEqual(covers([0, 0, 3440, 1440], 3440, 1440), 'whole');
  assert.strictEqual(covers([0, 0, 3440, 1439], 3440, 1440), '1 px short on the bottom');
  assert.strictEqual(covers([1, 0, 3440, 1440], 3440, 1440), '1 px short on the left');
  assert.strictEqual(covers([0, 0, 3439, 1439], 3440, 1440), null);
  assert.strictEqual(covers([0, 0, 3440, 1438], 3440, 1440), null);
  assert.strictEqual(covers([0, 0, 3441, 1440], 3440, 1440), null);
});
