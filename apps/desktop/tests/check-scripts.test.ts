/* The Windows check scripts, read as text: there's no PowerShell here to run them. Each rule is a way
   one of them failed on a real PC with no line to say where. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';

const SCRIPTS = ['taskbar-check.ps1', 'menu-check.ps1', 'api-e2e.ps1', 'store-package.ps1', 'installer-check.ps1'] as const;
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

for (const name of ['smoke.ps1', 'api-e2e.ps1', 'store-package.ps1', ...LOCAL ? ['chromium-occlusion-local.ps1'] : []]) {
  test(`${name}: an error anywhere says FAIL run.error with its line and keeps the results`, () => {
    const ps = read(name);
    assert.match(ps, /function Error-Line\(\$e\) \{[\s\S]*?" at line \$\(\$i\.ScriptLineNumber\)/);
    const trap = ps.match(/^trap \{\n([\s\S]*?)\n\}/m);
    assert.ok(trap, 'a trap at the top');
    assert.match(trap[1]!, /\$msg = "FAIL run\.error \$\(Error-Line \$_\)"/);
    assert.match(trap[1]!, /Set-Content -LiteralPath \(Join-Path \$Out '(smoke|occlusion|api-e2e|store-package)\.txt'\)/);
    assert.match(trap[1]!, /\n  break$/);
    /* defined before anything that can throw */
    const helpers = ps.indexOf('. (Join-Path');
    assert.ok(helpers < 0 || ps.indexOf('function Error-Line') < helpers, 'Error-Line comes first');
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

test('driver.ps1: with a folder, the whole path goes in the name box and Save is pressed, both through UI Automation', () => {
  const ps = read('driver.ps1');
  assert.match(ps, /\$typed = Fill-Name \$h \(Join-Path \(Folder \$a\.where\) \$a\.file\)/);
  assert.match(ps, /\$cancelled = \$a\.action -eq 'cancel' -or \(\$a\.where -and -not \$typed\)/);
  assert.match(ps, /elseif \(\$a\.where\) \{ if \(-not \(Press-Save \$h\)\) \{ \[W\]::Press\(\$h, 1\) \} \}/);
  const fill = ps.slice(ps.indexOf('function Fill-Name('), ps.indexOf('function Press-Save('));
  assert.match(fill, /AutomationIdProperty, '1001'/);
  assert.match(fill, /\[System\.Windows\.Automation\.ValuePattern\]::Pattern/);
  assert.match(fill, /\$value\.SetValue\(\$full\)/);
  assert.match(fill, /return \$value\.Current\.Value -eq \$full/);
  const save = ps.slice(ps.indexOf('function Press-Save('), ps.indexOf('function Wait-Until('));
  assert.match(save, /AutomationIdProperty, '1'/);
  assert.ok(save.indexOf('$button.SetFocus()') < save.indexOf('$invoke.Invoke()'), 'focus moves to Save before the click, so the name box commits');
  assert.ok(!/SaveName|Dialog-Folder|navigation/.test(ps.slice(ps.indexOf("'dialog' {"), ps.indexOf("'find' {"))), 'no window-message typing, no folder reading');
  const hub = fs.readFileSync(new URL('hub.ts', DIR), 'utf8');
  assert.ok(!/navigation\?:/.test(hub), 'the hub goes by the file, not a reading of the dialog');
  /* Skipped only where the dialog took no name; wherever a name goes in, every outcome counts. */
  const over = hub.slice(hub.indexOf("check('api2.save_as_owner'"), hub.indexOf("check('open_data_folder'"));
  assert.match(over, /if \(!r\.typed\) \{[\s\S]*?skip\(`the dialog took no typed name here/);
  assert.ok(over.indexOf('if (!r.typed)') < over.indexOf("same(f.content, 'owned'"), 'the outcome checks come after');
});

test('pacing.ps1: its own result line is never read as an error', () => {
  const ps = body(read('pacing.ps1'));
  assert.ok(ps.includes("$scan = ($text -split \"`n\" | Where-Object { $_ -notmatch 'PACING result' }) -join \"`n\""), 'the result line is left out of the scan');
  assert.match(ps, /Expect 'pacing\.no_errors' \(\$scan -notmatch /);
});

test('pacing.ps1: each run reads only its own log, from a file it emptied first, and its own last result', () => {
  const ps = body(read('pacing.ps1'));
  const launch = ps.indexOf('Start-Process $runExe');
  assert.ok(launch > 0);
  assert.match(ps.slice(0, launch), /Remove-Item -LiteralPath \$log -ErrorAction SilentlyContinue/, 'the log goes before the launch');
  assert.ok(ps.includes("$found = [regex]::Matches($text, 'PACING result (\\{[^\\r\\n]*\\})') | Select-Object -Last 1"), 'the last result, not the first');
  assert.ok(!ps.includes("[regex]::Match($text, 'PACING result"));
});

test('pacing.ps1: its own processes, and only those, are stopped in a finally, whatever happened after the launch', () => {
  const c = code(read('pacing.ps1'));
  const at = c.indexOf('$run = Start-Process'), tryAt = c.lastIndexOf('try {', at), fin = c.indexOf('} finally {', at);
  assert.ok(tryAt > 0 && fin > at, 'the launch is inside a try with a finally');
  assert.match(c.slice(fin, c.indexOf('\n}\n', fin) + 2), /Stop-Own/, 'the finally stops them');
  /* what's "its own": the exe it started, and processes run on its own folder */
  assert.ok(c.includes('$_.ProcessId -eq $run.Id -or ($_.CommandLine -and $_.CommandLine.Contains($tmp))'));
  assert.ok(!c.includes("$_.Name -eq 'desktop-buddies.exe'"), 'never every copy of the exe on the machine');
  assert.ok(c.includes('Stop-Process -Id $_.ProcessId'), 'stopped by their own ids');
});

test('store-package.ps1: every claim is a PASS or a FAIL, nothing is skipped, and the cleanup undoes the install and the trust', () => {
  const ps = read('store-package.ps1'), c = code(ps);
  assert.ok(!/skip/i.test(c), 'nothing is skipped');
  const claims = [...c.matchAll(/Expect '([\w.]+)'/g)].map(m => m[1]);
  for (const k of ['packaged.data_root', 'packaged.no_virtual_appdata', 'build.msix', 'build.signed', 'install.ok', 'install.family', 'install.alias', 'assoc.declared', 'startup.declared', 'start.alias', 'packaged.info',
    'packaged.data_in_package', 'packaged.log_in_package', 'packaged.real_appdata_untouched', 'startup.round_trip', 'assoc.exe_says_declared', 'assoc.exe_refuses_a_change',
    'mcp.app_up', 'mcp.driver', 'end.uninstalled', 'end.alias_gone', 'end.data_gone', 'end.certificate_gone']) assert.ok(claims.includes(k), k);
  /* the certificate's subject is the identity's Publisher, one value for both */
  assert.match(c, /"publisher`": `"\$publisher`"/);
  assert.match(c, /New-SelfSignedCertificate -Type Custom -Subject \$publisher /);
  /* the MCP server picks the exe and the data folder itself */
  const drive = c.match(/& \$Node \$drive ([^\n]*)/);
  assert.ok(drive && !/--exe|--data/.test(drive[1]!), drive?.[0]);
  assert.match(c, /Remove-Item Env:BUDDIES_EXE, Env:BUDDIES_DATA/);
  /* the alias, never the exe by its path inside the package */
  assert.deepStrictEqual([...c.matchAll(/Start-Process -FilePath (\$\w+)/g)].map(m => m[1]), ['$alias', '$alias']);
  const fin = c.slice(c.lastIndexOf('} finally {'));
  assert.match(fin, /Tidy 'uninstall' \{[\s\S]*?Remove-AppxPackage/);
  /* both stores, and the one holding the private key loses the key too, which the check looks for */
  const cert = fin.slice(fin.indexOf("Tidy 'certificate'"), fin.indexOf("Tidy 'temp'"));
  for (const bit of ["Join-Path 'Cert:\\LocalMachine\\TrustedPeople' $thumb", "Join-Path 'Cert:\\CurrentUser\\My' $thumb", 'Remove-Item -LiteralPath $mine -DeleteKey',
    '[System.Security.Cryptography.CngKey]::Exists($keyName)', '-not $keyLeft']) assert.ok(cert.includes(bit), bit);
  assert.ok(c.includes('$keyName = $rsa.Key.KeyName'), 'the key is named before anything can go wrong');
  assert.ok(fin.indexOf("Tidy 'processes'") < fin.indexOf("Tidy 'logs'") && fin.indexOf("Tidy 'logs'") < fin.indexOf("Tidy 'uninstall'"), 'stop, keep the log, then uninstall');
});

/* The installer check installs into the real profile, so it runs on the Actions runner only. */
test('installer-check.ps1: it runs only on the Actions runner, before anything else happens', () => {
  const ps = code(read('installer-check.ps1'));
  const guard = ps.indexOf("if ($env:GITHUB_ACTIONS -ne 'true') { throw");
  assert.ok(guard > 0, 'the guard');
  assert.ok(guard < ps.indexOf('New-Item -ItemType Directory'), 'before any folder is made');
  assert.ok(guard < ps.indexOf('if ($SetupOnly) {'), 'before the -SetupOnly gate');
});

test('installer-check.ps1: silent both ways, and the uninstall is waited for, not taken at its word', () => {
  const ps = body(read('installer-check.ps1'));
  assert.match(ps, /Run-Silent \$OldSetup '\/S'/);
  assert.match(ps, /Run-Silent \$Setup '\/S'/);
  assert.match(ps, /Run-Silent \$uninstaller '\/S'/);
  /* the uninstaller copies itself away and returns at once: its files are what say it's done */
  assert.match(ps, /function Uninstall-Done \{ return -not \(Test-Path -LiteralPath \$uninstaller\) -and -not \(Test-Path -LiteralPath \$arpKey\) \}/);
  assert.equal([...ps.matchAll(/Wait-For 'the uninstall' \{ Uninstall-Done \}/g)].length, 1);
});

test("installer-check.ps1: an upgrade is the new setup run over the old install, as winget's UpgradeBehavior install runs it", () => {
  const ps = body(read('installer-check.ps1'));
  const old = ps.indexOf("Run-Silent $OldSetup '/S'");
  const seed = ps.indexOf('New-ItemProperty -LiteralPath $runKey -Name $product -Value $runValue -PropertyType String | Out-Null');
  const fresh = ps.indexOf("Run-Silent $Setup '/S'");
  assert.ok(old > 0 && old < seed && seed < fresh, `${old} ${seed} ${fresh}`);
  /* nothing is uninstalled before it, and nothing reads the old uninstall command */
  assert.ok(!/UninstallString\)|oldUninstall/.test(ps.slice(old, fresh)), 'no uninstall before the upgrade');
  assert.equal([...ps.slice(0, ps.lastIndexOf('} finally {')).matchAll(/Run-Silent \$uninstaller '\/S'/g)].length, 1, 'the one uninstall, at the end');
  assert.match(ps, /\$runValue = '"' \+ \$installedExe \+ '"'/);
  /* from a lower version to this one, so the setup's version compare is the path taken */
  assert.match(ps, /if \(\[version\]\$OldVersion -ge \[version\]\$Version\) \{ throw /);
  assert.match(ps, /Expect 'old\.arp_version' \(\$oldArp -and \$oldArp\.DisplayVersion -eq \$OldVersion\)/);
  assert.ok(!/OldOnly|old_file_gone|has_its_file/.test(ps), 'no stale-file check');
  assert.match(ps, /Expect 'upgrade\.run_value_kept' \(\(Run-Value\) -eq \$runValue\)/);
  assert.match(ps, /function Run-Value \{ return \(Get-ItemProperty -LiteralPath \$runKey -Name \$product -ErrorAction SilentlyContinue\)\.\$product \}/);
});

test('installer-check.ps1: the data is kept whole, every file by its hash, through the upgrade and the uninstall', () => {
  const ps = body(read('installer-check.ps1'));
  assert.match(ps, /function Snapshot\(\$dir\) \{[^\n]*Get-ChildItem -LiteralPath \$dir -Recurse -File -Force[^\n]*Hash-Of \$_\.FullName/);
  assert.match(ps, /Expect 'upgrade\.data_kept' \(\(Snapshot \$userData\) -eq \$beforeUpgrade\)/);
  assert.match(ps, /Expect 'uninstall\.data_kept' \(\(Snapshot \$userData\) -eq \$beforeUninstall\)/);
  /* and the snapshot holds the settings and the library, so an empty one can't pass */
  assert.match(ps, /Expect 'run\.data_written' \(\$beforeUpgrade -match '\(\?m\)\^settings\\\.json ' -and \$beforeUpgrade -match '\(\?m\)\^library\\\\\[\^\\r\\n\]\*\\\\buddy\\\.json '\)/);
});

test('installer-check.ps1: the cleanup touches only what this run made, and only once it got past its checks', () => {
  const ps = body(read('installer-check.ps1'));
  const owned = ps.indexOf('$owned = $true');
  assert.ok(owned > ps.indexOf("is there already: this needs a runner that has never had the app"), 'after the clean-profile checks');
  assert.ok(owned > ps.indexOf('if ($SetupOnly) {'), 'never on a -SetupOnly run');
  const fin = ps.slice(ps.lastIndexOf('} finally {'));
  const tidies = fin.split('\n').filter(l => /^\s*Tidy /.test(l));
  assert.ok(tidies.length >= 6, tidies.join('\n'));
  for (const t of tidies) assert.match(t, /^\s*Tidy '[\w-]+' \{ if \(\$owned -and /, t);
  /* a process is ours by a whole folder, not a name that starts the same */
  assert.match(ps, /function Under\(\$path, \$dir\) \{ return \[bool\]\$path -and \$path\.StartsWith\(\$dir\.TrimEnd\('\\'\) \+ '\\', \[StringComparison\]::OrdinalIgnoreCase\) \}/);
  assert.ok(!/ExecutablePath\.StartsWith\(/.test(ps), 'no bare prefix match');
  /* what a passing run leaves for the next: nothing */
  for (const gone of ["Tidy 'data' { if ($owned -and (Test-Path -LiteralPath $userData)) { Remove-Item -LiteralPath $userData -Recurse -Force } }",
    "Tidy 'webview-data' { if ($owned -and (Test-Path -LiteralPath $webData)) { Remove-Item -LiteralPath $webData -Recurse -Force } }",
    "Tidy 'registry' { if ($owned -and (Test-Path -LiteralPath $productKey)) { Remove-Item -LiteralPath $productKey -Recurse -Force } }",
    "Tidy 'run-value' { if ($owned -and $seededRun -and $null -ne (Run-Value)) { Remove-ItemProperty -LiteralPath $runKey -Name $product -Force } }"]) {
    assert.ok(fin.includes(gone), gone);
  }
  assert.match(ps, /foreach \(\$place in \$installDir, \$menuLink, \$deskLink, \$arpKey, \$productKey, \$userData, \$webData\)/);
  /* a Start with Windows value this run didn't seed is never touched, and stops the run first */
  assert.match(ps, /if \(\$null -ne \(Get-ItemProperty -LiteralPath \$runKey -Name \$product -ErrorAction SilentlyContinue\)\) \{ throw /);
  assert.ok(ps.indexOf('$seededRun = $true') > ps.indexOf('$owned = $true'));
});

test('installer-check.ps1: every check it promises is made, and none passes by being skipped', () => {
  const ps = body(read('installer-check.ps1'));
  for (const name of ['old.exit', 'old.arp_version', 'upgrade.run_value_kept', 'upgrade.data_kept',
    'install.exit', 'install.exe_same', 'install.app_same', 'install.top_files', 'install.start_menu', 'install.arp',
    'run.exit', 'run.no_strays', 'run.log_no_errors', 'run.log_app_folder', 'run.log_hub_up', 'run.log_clean_quit', 'run.buddy_saved', 'run.data_written',
    'second.exit', 'second.no_strays', 'second.log_no_errors', 'second.log_app_folder',
    'uninstall.exit', 'uninstall.done', 'uninstall.files_gone', 'uninstall.start_menu_gone', 'uninstall.desktop_gone', 'uninstall.arp_gone',
    'uninstall.data_kept']) {
    assert.ok(ps.includes(`Expect '${name}'`), name);
  }
  assert.ok(!/skip/i.test(ps), 'nothing is skipped');
  assert.match(ps, /if \(\$fails\.Count -or \$passes -eq 0\) \{ exit 1 \}/);
});

test('installer-check.ps1: the exe is named only by -Exe, so no log line carries its name', () => {
  const ps = read('installer-check.ps1');
  assert.ok(!/desktop-buddies\.exe/i.test(code(ps)), 'no exe name in the code');
  assert.match(body(ps), /\$exeName = Split-Path -Leaf \$Exe/);
});

test("shell.yml: the installer job builds as the release does, on the build job's exe and app folder, then runs the check", () => {
  const yml = fs.readFileSync(new URL('../../../.github/workflows/shell.yml', import.meta.url), 'utf8');
  const release = fs.readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8');
  /* a job of its own, after the build, with its own time */
  const jobAt = yml.indexOf('\n  installer:\n');
  assert.ok(jobAt > yml.indexOf('\n  windows:\n'), 'the installer job, after the build job');
  const job = yml.slice(jobAt);
  assert.match(job, /^\n  installer:\n    needs: windows\n    if: \$\{\{ !cancelled\(\) \}\}\n    runs-on: windows-latest\n    timeout-minutes: \d+\n/);
  const build = yml.slice(yml.indexOf('\n  windows:\n'), jobAt);
  for (const moved of ['- name: Installer', '- name: winget validate']) assert.ok(!build.includes(moved), `${moved} isn't in the build job`);
  /* the build job hands over its exe, reused or not, and its app folder */
  const exeUp = build.slice(build.indexOf('name: desktop-buddies-windows') - 200, build.indexOf('name: desktop-buddies-windows'));
  assert.ok(!/if: env\.REUSE/.test(exeUp.slice(exeUp.lastIndexOf('- uses: actions/upload-artifact'))), 'the exe is uploaded on every run');
  assert.match(build, /- uses: actions\/upload-artifact@v4\n        with:\n          name: app-folder\n          path: apps\/desktop\/dist\/app\n/);
  assert.match(job, /- uses: actions\/download-artifact@v4\n        with:\n          name: desktop-buddies-windows\n          path: exe\n/);
  assert.match(job, /- uses: actions\/download-artifact@v4\n        with:\n          name: app-folder\n          path: apps\/desktop\/dist\/app\n/);
  /* tauri-cli pinned as the release pins it, cached by its version, and checked it's that version */
  const cli = (s: string) => s.match(/TAURI_CLI: ([\d.]+)/)?.[1];
  assert.ok(cli(job) && cli(job) === cli(release), 'the same tauri-cli as the release');
  assert.match(job, /- uses: actions\/cache@v4\n        with:\n          path: ~\/\.cargo\/bin\/cargo-tauri\.exe\n          key: tauri-cli-\$\{\{ runner\.os \}\}-\$\{\{ env\.TAURI_CLI \}\}\n/);
  assert.match(job, /if \(-not \(Test-Path ~\/\.cargo\/bin\/cargo-tauri\.exe\)\) \{ cargo install tauri-cli --version \$env:TAURI_CLI --locked; if \(\$LASTEXITCODE\) \{ throw /);
  assert.match(job, /if \(\$said -ne "tauri-cli \$env:TAURI_CLI"\) \{ throw /);
  const at = job.indexOf('- name: Installer');
  assert.ok(at > 0, 'the step');
  const step = job.slice(at, job.indexOf('\n\n', at));
  assert.match(step, /shell: pwsh/);
  /* the zip first, as the release packs it, then the installer from that zip */
  assert.match(step, /python -I apps\/desktop\/scripts\/preview\.py --release \$v --exe exe\/desktop-buddies\.exe --notices \S+ --out-dir installer\n/);
  assert.match(step, /python -I apps\/desktop\/scripts\/installer\.py --release \$v --zip installer\/desktop-buddies-\$v-windows-x64\.zip --out-dir installer\n/);
  /* the older build: the same files at a lower version */
  assert.match(step, /python -I apps\/desktop\/shell-check\/older-installer\.py --zip installer\/desktop-buddies-\$v-windows-x64\.zip --old-version \$old --out-dir installer-old\n/);
  assert.match(step, /apps\/desktop\/shell-check\/installer-check\.ps1 -Setup installer\/desktop-buddies-\$v-setup-x64\.exe -OldSetup installer-old\/desktop-buddies-\$old-setup-x64\.exe -OldVersion \$old -Exe exe\/desktop-buddies\.exe -App apps\/desktop\/dist\/app -Version \$v -Out results/);
  for (const line of step.split('\n').filter(l => /^\s*python /.test(l))) {
    const next = step.split('\n')[step.split('\n').indexOf(line) + 1] ?? '';
    assert.match(next, /^\s*if \(\$LASTEXITCODE\) \{ throw /, `a failed ${line.trim()} stops the step`);
  }
  /* winget validate: on manifests for the installer just built, failing on any error */
  const at2 = job.indexOf('- name: winget validate');
  assert.ok(at2 > at, 'after the installer step');
  const wv = job.slice(at2, job.indexOf('\n\n', at2) < 0 ? job.length : job.indexOf('\n\n', at2));
  assert.match(wv, /if: success\(\) \|\| failure\(\)/);
  assert.match(wv, /packaging\/winget\/manifest\.py --version \$v --sha256 \(Get-FileHash \$setup -Algorithm SHA256\)\.Hash --out winget-manifests/);
  assert.match(wv, /winget validate --manifest winget-manifests/);
  assert.match(wv, /if \(\$LASTEXITCODE -and \$said -notmatch 'validation succeeded'\) \{ throw/);
  assert.match(wv, /::warning::winget isn't on this runner/);
  assert.match(job, /name: installer-results\n          path: results\n/);
});
