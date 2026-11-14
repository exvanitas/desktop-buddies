/* The soak test and the PC sample, read as text: there's no PowerShell here to run them. The sample
   runs on the owner's own PC, so what it may do is checked word by word. */
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'vitest';

const DIR = new URL('../shell-check/', import.meta.url);
const read = (name: string) => fs.readFileSync(new URL(name, DIR), 'utf8');
const ROOT = new URL('../../../', import.meta.url);
/* Without whole-line comments; here-strings, which hold the C#, are kept. */
const uncommented = (ps: string) => ps.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
/* One function's text, from its line to the next function or the end. */
const fn = (ps: string, name: string) => {
  const at = ps.indexOf(`function ${name}`);
  assert.ok(at >= 0, name);
  const next = ps.indexOf('\nfunction ', at + 1);
  return ps.slice(at, next < 0 ? ps.length : next);
};

const sampler = read('soak-sampler.ps1');
const pc = read('sample-pc.ps1');
const soak = read('soak.ps1');
const budgets = JSON.parse(read('soak-budgets.json'));
const yml = fs.readFileSync(new URL('.github/workflows/soak.yml', ROOT), 'utf8');
const STATES = ['walking', 'hidden', 'manager', 'api'];

test('sample-pc.ps1 and its sampler start, stop and change nothing', () => {
  const both = uncommented(pc) + '\n' + uncommented(sampler);
  const acts = /Start-Process|Stop-Process|\.Kill\(|Process\]::Start|ProcessStartInfo|Start-Exe|Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|Set-Content|Add-Content|Out-File|Export-Csv|ItemProperty\b(?<!Get-ItemProperty)|Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|-Service\b|Invoke-Expression|Invoke-Item|\biex\b|Start-Job|Register-|schtasks|Invoke-CimMethod|Invoke-WmiMethod|Set-CimInstance|TerminateProcess|PostMessage|SendMessage|SendInput|SetWindow|ShowWindow|Suspend|Resume-|Debug-Process|Wait-Process/gi;
  assert.deepStrictEqual([...both.matchAll(acts)].map(m => m[0]), []);
  /* no call operator running a command or a path */
  const scripts = both.replace(/@"[\s\S]*?"@/g, '');
  assert.deepStrictEqual([...scripts.matchAll(/(?:^|[\s(;{])&\s*[$'"(\w]/gm)].map(m => m[0]), []);
  /* the registry, only read */
  assert.deepStrictEqual([...both.matchAll(/HKCU:|HKLM:|Registry::/g)].length, 1);
  assert.match(pc, /\(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' -ErrorAction SilentlyContinue\)/);
});

test('sample-pc.ps1 writes two files, both in the folder it says, and nothing else', () => {
  const writes = [...uncommented(pc).matchAll(/\[IO\.File\]::(\w+)\(([^,]+),/g)].map(m => `${m[1]} ${m[2]}`);
  assert.deepStrictEqual(writes, ['WriteAllText $script:jsonPath', 'WriteAllText $csvPath', 'AppendAllText $csvPath']);
  assert.ok(!/\[IO\.File\]::/.test(uncommented(sampler).replace(/@"[\s\S]*?"@/, '')), 'the sampler writes no file');
  assert.match(pc, /\$folder = if \(\$Out\) \{ \$Out \} else \{ Downloads-Folder \}/);
  assert.match(pc, /\$csvPath = Join-Path \$folder "desktop-buddies-sample-\$stamp\.csv"/);
  assert.match(pc, /\$jsonPath = Join-Path \$folder "desktop-buddies-sample-\$stamp\.json"/);
  /* nothing is written before the app is found running, and the check of the reader passed */
  const firstWrite = pc.indexOf('[IO.File]::WriteAllText($csvPath');
  assert.ok(pc.indexOf('if (-not $rootId) {') < firstWrite && pc.indexOf('if (-not $self.ok) { throw') < firstWrite);
});

test('what the PC sample keeps is numbers and plain words: no path, title or command line', () => {
  /* a process's command line is read for its WebView2 type alone */
  const kind = fn(sampler, 'Kind-Of');
  const uses = [...kind.matchAll(/\$line\b[^\n]*/g)].map(m => m[0]);
  assert.ok(uses.length >= 3);
  for (const u of uses) assert.match(u, /^\$line (=|-match '--(type|utility-sub-type)=)/, u);
  /* the exe's path gives its version and how it was installed, and isn't returned */
  const about = fn(pc, 'About-App');
  const back = about.match(/return \[ordered\]@\{([^\n]*)\}/);
  assert.ok(back && !/\$where/.test(back[1]!), back?.[0]);
  /* no window titles: windows are only counted */
  assert.ok(!/GetWindowText|TitleOf|MainWindowTitle/.test(sampler + pc));
  assert.match(sampler, /function Csv-Header \{ return 't_s,pid,kind,' \+ \(\$soakFields -join ','\) \+ ',procs,windows' \}/);
});

test('the sampler calls only Windows functions that read, and opens a process only to query it', () => {
  const imports = [...sampler.matchAll(/\[DllImport\("(\w+)\.dll"\)\] static extern \w+ (\w+)\(/g)].map(m => `${m[1]} ${m[2]}`).sort();
  assert.deepStrictEqual(imports, ['kernel32 CloseHandle', 'kernel32 OpenProcess', 'ntdll NtQuerySystemInformation', 'user32 EnumWindows', 'user32 GetGuiResources', 'user32 GetWindowThreadProcessId', 'user32 IsWindowVisible']);
  /* PROCESS_QUERY_INFORMATION, then PROCESS_QUERY_LIMITED_INFORMATION: both only read */
  assert.deepStrictEqual([...sampler.matchAll(/OpenProcess\((0x\w+),/g)].map(m => m[1]), ['0x0400', '0x1000']);
  assert.match(sampler, /NtQuerySystemInformation\(5, buf, len, out need\)/);
  assert.match(sampler, /finally \{ CloseHandle\(h\); \}/);
  /* 64-bit layout, checked against .NET's own view before anything is sampled */
  assert.match(sampler, /if \(IntPtr\.Size != 8\) throw/);
  assert.match(pc, /\$self = Self-Check\n\s*if \(-not \$self\.ok\) \{ throw/);
  assert.match(soak, /\$self = Self-Check\n\s*Expect 'setup\.sampler_reads' \$self\.ok \$self\.detail/);
});

test('soak.ps1: the four states, the summary from the last 75%, and every budget it reads is in the file', () => {
  assert.match(soak, new RegExp(`\\[ValidateSet\\(${STATES.map(s => `'${s}'`).join(', ')}\\)\\]\\[string\\]\\$State`));
  assert.match(sampler, /\$from = \$lastAt - 0\.75 \* \(\$lastAt - \$first\)/);
  for (const k of ['leak_mb_per_h', 'handles_per_h', 'gdi_per_h', 'user_per_h', 'idle_cpu_pct_core', 'wakeups_per_s']) assert.ok(sampler.includes(`    ${k} = `), k);
  const read = [...fn(soak, 'Check-Budgets').matchAll(/\$limits\.(\w+)/g)].map(m => m[1]!);
  for (const k of new Set(read)) assert.ok(k in budgets, `soak-budgets.json has ${k}`);
  /* the plan's budgets, reported only until the lead has a baseline */
  assert.deepStrictEqual([budgets.leak_mb_per_h, budgets.handles_per_h, budgets.gdi_per_h, budgets.user_per_h, budgets.hidden_cpu_pct_core, budgets.baseline_margin], [2, 50, 50, 50, 0.5, 0.2]);
  assert.strictEqual(typeof budgets.enforce, 'boolean');
  assert.deepStrictEqual(Object.keys(budgets.baseline).sort(), [...STATES].sort());
  /* while not enforced a budget is a line to read, never a FAIL */
  assert.match(soak, /if \(\$limits\.enforce\) \{ Expect "budget\.\$\(\$b\.name\)" \$b\.ok \$b\.detail \}\n\s*else \{ Note "budget\./);
  /* the API's own limits: 30 requests and 4 lines a minute from one app */
  assert.match(soak, /if \(\$now - \$lastSay -ge 20\) \{/);
  assert.match(soak, /while \(\$nextAsk -le \$now\) \{ \$nextAsk \+= 5 \}/);
});

test('soak.yml: a job per state within the 6 h limit, a short run on a push of its own files, no schedule yet', () => {
  assert.match(yml, /\n  push:\n    branches: \[next\]\n    paths:\n/);
  const after = yml.slice(yml.indexOf('    paths:\n')).split('\n').slice(1);
  const paths = after.slice(0, after.findIndex(l => !/^      - /.test(l))).map(l => l.replace(/^      - /, ''));
  assert.deepStrictEqual(paths, ['apps/desktop/shell-check/soak.ps1', 'apps/desktop/shell-check/soak-sampler.ps1', 'apps/desktop/shell-check/soak-budgets.json', '.github/workflows/soak.yml']);
  for (const p of paths) assert.ok(fs.existsSync(new URL(p, ROOT)), p);
  assert.ok(!/^\s*schedule:/m.test(yml), 'the weekly run waits for the owner');
  assert.match(yml, /^  # schedule:\n  #   - cron: /m);
  assert.match(yml, /minutes:\n        description: [^\n]*\n        type: string\n        default: '120'/);
  assert.match(yml, /MINUTES: \$\{\{ inputs\.minutes \|\| '10' \}\}/);
  assert.match(yml, /state: \[walking, hidden, manager, api\]/);
  for (const m of yml.matchAll(/timeout-minutes: (\d+)/g)) assert.ok(Number(m[1]) <= 360, m[0]);
  assert.match(yml, /\n  soak:\n    needs: prepare\n    runs-on: windows-latest\n[\s\S]*?timeout-minutes: 345\n/);
  assert.match(soak, /if \(\$Minutes -lt 1 -or \$Minutes -gt 300\) \{ throw/);
  assert.match(yml, /apps\/desktop\/shell-check\/soak\.ps1 -Exe exe\/desktop-buddies\.exe -App apps\/desktop\/dist\/app -State \$\{\{ matrix\.state \}\} -Minutes \$env:MINUTES -Out results/);
  /* the probe the hidden state needs travels with the app folder */
  assert.match(yml, /path: \|\n            apps\/desktop\/dist\/app\n            apps\/desktop\/dist\/api-probe\n/);
  assert.match(yml, /name: soak-app\n          path: apps\/desktop\/dist\n/);
});
