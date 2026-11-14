# The soak test: the real exe and the built app left in one state for a long while, sampled every
# -Interval seconds, to see memory, handles, CPU and wakeups over hours. docs/performance.md says how to
# run it and read it. Runs on the Actions Windows runner: .github/workflows/soak.yml, a job per state.
# Its own copy of the app folder beside the exe, and a fresh data folder. A short first run imports
# the test buddy (first-buddy.ps1), calls her out, saves that and quits, so the soak itself starts as
# any later day does. Then, by -State:
#   walking  three copies of her out, left alone
#   hidden   three out, then Hide all with the Manager's own button (api-probe.js, added to the
#            Manager's page only, does the click), then the Manager closed
#   manager  three out, and the Manager opened as a person opens it, left open
#   api      her alone, the local API on with one app allowed (put in settings.json between the two
#            runs), which asks something every 5 s: a line to say every 20 s, a wave in between
# What's sampled: the exe and every process under it by parent id, which is its WebView2, through
# soak-sampler.ps1. Writes soak.csv (a row per process and a total, per sample), soak.json (the
# summary) and soak.txt (PASS, FAIL and INFO lines) to -Out. Budgets come from soak-budgets.json, and
# while its enforce is false they're reported and never fail the run.
# Desktop Buddies must not be running: a second launch would reach it. Processes end only by their PID.
#
# -SetupOnly runs the checks and stops before the first launch: no window, no process, no mouse. Any
# error ends the run with "FAIL run.error <message> at line <n>" in -Out's soak.txt, written before the
# cleanup, which notes its own errors and never hides that one.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [Parameter(Mandatory)][ValidateSet('walking', 'hidden', 'manager', 'api')][string]$State,
  [string]$Out = 'results',
  [int]$Minutes = 120,
  [int]$Interval = 10,
  [string]$Budgets = '',
  [string]$Temp = [IO.Path]::GetTempPath(),
  [switch]$SetupOnly
)
$ErrorActionPreference = 'Stop'

# PowerShell's names ignore case: a script variable named like a parameter is that parameter, and
# takes its type. So nothing below reuses a parameter's name in any case.
$results = [System.Collections.Generic.List[string]]::new()
$resultsFile = ''
function Expect($what, $ok, $detail = '') {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) $what $detail"
  $results.Add($line); Write-Host $line
}
function Note($line) { $results.Add("INFO $line"); Write-Host "INFO $line" }
# Never throws: results go to the file once -Out is made, and to the console always.
function Save-Results {
  if (-not $script:resultsFile) { Write-Host 'no soak.txt: -Out was never made'; return }
  try { $results | Set-Content -LiteralPath $script:resultsFile -Encoding UTF8 } catch { Write-Host "could not write $($script:resultsFile): $($_.Exception.Message)" }
}
# An error's message and where it was thrown. -File drops the line from the console's own report.
function Error-Line($e) {
  $i = $e.InvocationInfo
  $where = if ($i -and $i.ScriptLineNumber) { " at line $($i.ScriptLineNumber)$(if ($i.ScriptName -and $i.ScriptName -ne $PSCommandPath) { ' of ' + [IO.Path]::GetFileName($i.ScriptName) })" } else { ' at an unknown line' }
  return "$($e.Exception.Message)$where"
}
# One cleanup step: its error is noted, and the next step still runs.
function Tidy($what, [scriptblock]$step) {
  try { . $step } catch { Expect "cleanup.$what" $false (Error-Line $_) }
}
# An error outside the try below stops the run: said with its line, and kept in soak.txt.
trap {
  $msg = "FAIL run.error $(Error-Line $_)"
  Write-Host $msg; Write-Host $_.ScriptStackTrace
  try { if ($null -ne $results) { $results.Add($msg); if ($Out -and (Test-Path -LiteralPath $Out -PathType Container)) { $results | Set-Content -LiteralPath (Join-Path $Out 'soak.txt') } } } catch { Write-Host "could not save: $($_.Exception.Message)" }
  break
}

# A request to the local API, as api-e2e.ps1 sends them: the reply slot for an id (FNV-1a over its
# characters, mod 64, as api-replies.ts computes it), one argument quoted for a Windows command line,
# and a JSON string built by hand.
function Slot-Of([string]$id) {
  [uint64]$h = 2166136261
  foreach ($c in $id.ToCharArray()) { $h = (([uint64]($h -bxor [uint64][int]$c)) * [uint64]16777619) -band [uint64]4294967295 }
  return ('{0:D2}' -f ($h % 64))
}
function Quote-Arg([string]$s) {
  $o = '"'; $slashes = 0
  foreach ($c in $s.ToCharArray()) {
    if ($c -eq '\') { $slashes++; continue }
    if ($c -eq '"') { $o += ('\' * ($slashes * 2 + 1)) + '"' } else { $o += ('\' * $slashes) + $c }
    $slashes = 0
  }
  return $o + ('\' * ($slashes * 2)) + '"'
}
function J([string]$s) { return '"' + $s.Replace('\', '\\').Replace('"', '\"') + '"' }
function New-Id { return 'soak-' + [guid]::NewGuid().ToString('n') }
function Req($id, $who, $what, $extra = '') { return '{"v":1,"id":' + (J $id) + ',"app":' + (J $who) + ',"do":' + (J $what) + $extra + '}' }
function Err($r) { if ($null -eq $r) { return 'no reply' } elseif ($r.ok) { return 'ok' } else { return $r.error } }

function Read-Log($path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return '' }
  $s = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite,Delete')
  try { return [IO.StreamReader]::new($s, [Text.Encoding]::UTF8).ReadToEnd() } finally { $s.Close() }
}
function Wait-For($what, [scriptblock]$test, $seconds = 20) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  do { if (& $test) { return $true }; Start-Sleep -Milliseconds 200 } while ($t.Elapsed.TotalSeconds -lt $seconds)
  Write-Host "gave up waiting for $what"
  return $false
}
function Start-Exe([string]$argLine) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $script:runExe; $psi.Arguments = $argLine; $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  [void]$p.Handle # or ExitCode comes back empty
  return $p
}
# This run's processes: its own copy of the exe, and WebView2 working on its folders.
function Ours {
  if (-not $script:runId) { return @() }
  return @(Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.Contains($script:runId)) -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.Contains($script:runId)) })
}
# One second launch with its arguments, which the running app takes. Any exit code but 0 is counted.
$badExits = 0
function Ask([string]$raw) {
  $q = Start-Exe ('--api ' + (Quote-Arg $raw))
  if (-not $q.WaitForExit(15000)) { $q.Kill(); throw 'a second launch did not exit in 15 s' }
  if ($q.ExitCode -ne 0) { $script:badExits++ }
}
function Reply-For($id, $ms) {
  $f = Join-Path $script:data "api\replies\$(Slot-Of $id).json"
  $t = [Diagnostics.Stopwatch]::StartNew()
  while ($t.ElapsedMilliseconds -lt $ms) {
    if (Test-Path -LiteralPath $f) {
      $r = $null
      try { $r = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { $r = $null }
      if ($r -and $r.id -ceq $id) { return $r }
    }
    Start-Sleep -Milliseconds 100
  }
  return $null
}
# A thing the Manager's probe does with the real view's buttons, as api-e2e.ps1 has it: written as
# e2e/task-<n>.json, whole, and answered in the log as PROBE DID <n> PASS|FAIL <detail>.
$taskN = 0
function Task($label, $what) {
  $script:taskN++
  $n = $script:taskN
  $what.n = $n
  $dir = Join-Path $script:data 'e2e'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $part = Join-Path $dir ".~task-$n"
  [IO.File]::WriteAllText($part, ($what | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $part -Destination (Join-Path $dir "task-$n.json")
  $script:did = $null
  [void](Wait-For "task $n" { $m = [regex]::Match((Read-Log $script:log), "PROBE DID $n (PASS|FAIL) ([^\r\n]*)"); if ($m.Success) { $script:did = $m }; $m.Success } 30)
  if (-not $script:did) { Expect "state.$label" $false "the probe never did task $n"; return $false }
  $ok = $script:did.Groups[1].Value -eq 'PASS'
  $detail = $script:did.Groups[2].Value
  Expect "state.$label" $ok $(if ($detail.Length -gt 300) { $detail.Substring(0, 300) } else { $detail })
  return $ok
}
function Manager-Window { return [W]::FindTitled(@([uint32]$script:appProc.Id), 'Desktop Buddies Manager') }

# Each budget as name, within or not, and what it was measured against. A baseline that isn't set
# yet, or a state it isn't for, makes no line.
function Check-Budgets($sum, $limits, $which) {
  $o = [System.Collections.Generic.List[object]]::new()
  $o.Add([pscustomobject]@{ name = 'leak'; ok = ($null -ne $sum.leak_mb_per_h -and $sum.leak_mb_per_h -lt $limits.leak_mb_per_h); detail = "private bytes $($sum.leak_mb_per_h) MB an hour, budget under $($limits.leak_mb_per_h)" })
  $o.Add([pscustomobject]@{ name = 'handles'; ok = ($null -ne $sum.handles_per_h -and $sum.handles_per_h -lt $limits.handles_per_h); detail = "$($sum.handles_per_h) an hour, budget under $($limits.handles_per_h)" })
  $o.Add([pscustomobject]@{ name = 'gdi'; ok = ($null -ne $sum.gdi_per_h -and $sum.gdi_per_h -lt $limits.gdi_per_h); detail = "$($sum.gdi_per_h) an hour, budget under $($limits.gdi_per_h)" })
  $o.Add([pscustomobject]@{ name = 'user'; ok = ($null -ne $sum.user_per_h -and $sum.user_per_h -lt $limits.user_per_h); detail = "$($sum.user_per_h) an hour, budget under $($limits.user_per_h)" })
  if ($which -eq 'hidden') {
    $o.Add([pscustomobject]@{ name = 'hidden_cpu'; ok = ($null -ne $sum.idle_cpu_pct_core -and $sum.idle_cpu_pct_core -lt $limits.hidden_cpu_pct_core); detail = "$($sum.idle_cpu_pct_core)% of one core, budget under $($limits.hidden_cpu_pct_core)" })
    if ($null -ne $limits.hidden_wakeups_per_s) {
      $o.Add([pscustomobject]@{ name = 'hidden_wakeups'; ok = ($null -ne $sum.wakeups_per_s -and $sum.wakeups_per_s -lt $limits.hidden_wakeups_per_s); detail = "$($sum.wakeups_per_s) a second, budget under $($limits.hidden_wakeups_per_s)" })
    }
  }
  $base = $null
  if ($limits.baseline) { $base = $limits.baseline.$which }
  $grow = 1 + [double]$limits.baseline_margin
  if ($base -and $null -ne $base.private_ws_mb) {
    $o.Add([pscustomobject]@{ name = 'memory'; ok = ($sum.mean.private_ws_mb -le $base.private_ws_mb * $grow); detail = "$($sum.mean.private_ws_mb) MB, baseline $($base.private_ws_mb) plus $([double]$limits.baseline_margin * 100)%" })
  }
  if ($base -and $null -ne $base.cpu_pct_core) {
    $o.Add([pscustomobject]@{ name = 'cpu'; ok = ($sum.mean.cpu_pct_core -le $base.cpu_pct_core * $grow); detail = "$($sum.mean.cpu_pct_core)% of one core, baseline $($base.cpu_pct_core) plus $([double]$limits.baseline_margin * 100)%" })
  }
  return $o
}

# What the cleanup reads. Each stays empty until the step that makes it.
$appProc = $null; $tmp = ''; $runId = ''; $data = ''; $log = ''; $primeLog = ''; $runExe = ''

try {
  # ---------- the parameters, and nothing started yet
  if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "-Exe '$Exe' is not a file" }
  if (-not (Test-Path -LiteralPath $App -PathType Container)) { throw "-App '$App' is not a folder" }
  if ($Minutes -lt 1 -or $Minutes -gt 300) { throw "-Minutes $Minutes is outside 1 to 300: a job has 6 hours in all" }
  if ($Interval -lt 2 -or $Interval -gt 60) { throw "-Interval $Interval is outside 2 to 60 seconds" }
  $Exe = (Resolve-Path -LiteralPath $Exe).Path
  $App = (Resolve-Path -LiteralPath $App).Path
  New-Item -ItemType Directory -Force $Out | Out-Null
  $Out = (Resolve-Path -LiteralPath $Out).Path
  $resultsFile = Join-Path $Out 'soak.txt'
  $csvFile = Join-Path $Out 'soak.csv'
  $jsonFile = Join-Path $Out 'soak.json'
  Note "state $State, $Minutes minutes, a sample every $Interval s, $(if ($SetupOnly) { 'setup only: stops before the first launch' } else { 'full run' })"
  . (Join-Path $PSScriptRoot 'soak-sampler.ps1')
  . (Join-Path $PSScriptRoot 'win32.ps1')
  . (Join-Path $PSScriptRoot 'first-buddy.ps1')
  $budgetFile = Join-Path $PSScriptRoot 'soak-budgets.json'
  if ($Budgets) { $budgetFile = (Resolve-Path -LiteralPath $Budgets).Path }
  $limits = [IO.File]::ReadAllText($budgetFile) | ConvertFrom-Json
  foreach ($need in 'enforce', 'leak_mb_per_h', 'handles_per_h', 'gdi_per_h', 'user_per_h', 'hidden_cpu_pct_core', 'baseline_margin') {
    if ($null -eq $limits.$need) { throw "$budgetFile has no $need" }
  }
  Note "budgets from $(Split-Path -Leaf $budgetFile): $(if ($limits.enforce) { 'enforced' } else { 'reported only, nothing fails on them' })"
  $probe = Join-Path (Split-Path $App) 'api-probe\api-probe.js'
  if ($State -eq 'hidden' -and -not (Test-Path -LiteralPath $probe -PathType Leaf)) { throw "$probe is missing: build the app first" }
  $tag = '<script src="manager.js"></script>'
  if (-not ([IO.File]::ReadAllText((Join-Path $App 'manager.html'))).Contains($tag)) { throw "manager.html has no $tag to add the probe after" }
  $exeName = [IO.Path]::GetFileNameWithoutExtension($Exe)
  $asker = 'Soak Check'
  $sayings = @('Still here.', 'Another lap done.', 'Nice and quiet today.', 'Counting the hours.', 'All good on this side.')
  $self = Self-Check
  Expect 'setup.sampler_reads' $self.ok $self.detail
  $fit = Slope @(0.0, 1.0, 2.0, 3.0) @(5.0, 7.0, 9.0, 11.0)
  Expect 'setup.slope' ($null -ne $fit -and [Math]::Abs($fit - 2) -lt 1e-9) "$fit"
  Expect 'setup.slot_hash' ((Slot-Of 'abcdefgh') -eq '13') (Slot-Of 'abcdefgh')
  Expect 'setup.checks' $true "exe $Exe, app $App, out $Out"

  if ($SetupOnly) {
    Note 'setup_only stopped before the first launch: no window opened, no process started, no mouse moved'
  } else {
    if (Get-Process -Name $exeName -ErrorAction SilentlyContinue) { throw 'Desktop Buddies is running: a second launch would reach it' }
    # Processes are known by this name in their paths: the temp folder can be named in its short form
    # here and in its long one in a process's command line.
    $runId = 'soak-' + [guid]::NewGuid().ToString('n').Substring(0, 8)
    $tmp = Join-Path $Temp $runId
    $bin = Join-Path $tmp 'bin'
    $data = Join-Path $tmp 'data'
    $log = Join-Path $tmp 'app.log'
    $primeLog = Join-Path $tmp 'prime.log'
    New-Item -ItemType Directory -Force $bin, $data | Out-Null
    Copy-Item -LiteralPath $Exe -Destination $bin
    Copy-Item -LiteralPath $App -Destination (Join-Path $bin 'app') -Recurse
    if ($State -eq 'hidden') {
      Copy-Item -LiteralPath $probe -Destination (Join-Path $bin 'app')
      $page = Join-Path $bin 'app\manager.html'
      $html = [IO.File]::ReadAllText($page).Replace($tag, "$tag<script src=`"api-probe.js`" data-role=`"manager`"></script>")
      [IO.File]::WriteAllText($page, $html, (New-Object Text.UTF8Encoding $false))
    }
    $runExe = Join-Path $bin (Split-Path $Exe -Leaf)
    $own = "--data-dir $(Quote-Arg $data) --app-dir $(Quote-Arg (Join-Path $bin 'app'))"

    # ---------- the first run: she's imported and called out, that's saved, and it quits by itself
    $first = @(First-Buddy $App $data $tmp)
    $p = Start-Exe "$own --log $(Quote-Arg $primeLog) --seconds 40 --no-manager $($first -join ' ')"
    $done = $p.WaitForExit(100000)
    if (-not $done) { $p.Kill() }
    Expect 'prime.exit' ($done -and $p.ExitCode -eq 0) "$(if ($done) { "code $($p.ExitCode)" } else { 'still running at the limit, killed' })"
    Expect 'prime.hub_up' ((Read-Log $primeLog) -match 'hub up: \d+ monitors, 1 in the library, 1 out') (([regex]::Match((Read-Log $primeLog), 'hub up: [^\r\n]*')).Value)
    [void](Wait-For 'the first run to be gone' { (Ours).Count -eq 0 } 20)
    Expect 'prime.nothing_left' ((Ours).Count -eq 0) "$((Ours).Count) left"
    $settingsFile = Join-Path $data 'settings.json'
    if (-not (Test-Path -LiteralPath $settingsFile)) { throw 'the first run left no settings.json' }
    if ($State -eq 'api') {
      $s = [IO.File]::ReadAllText($settingsFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
      $s | Add-Member -NotePropertyName api -NotePropertyValue $true -Force
      $s | Add-Member -NotePropertyName apiApps -NotePropertyValue @([pscustomobject]@{ name = $asker; allow = $true }) -Force
      [IO.File]::WriteAllText($settingsFile, ($s | ConvertTo-Json -Depth 5 -Compress), (New-Object Text.UTF8Encoding $false))
      Note "settings.json: the API on, $asker allowed"
    }

    # ---------- the soak run: it quits by its own time limit, a few minutes after the sampling ends
    $want = if ($State -eq 'api') { 1 } else { 3 }
    $copies = if ($State -eq 'api') { '' } else { "--buddies $want" }
    $limitSeconds = $Minutes * 60 + 240
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $script:appProc = Start-Exe "$own --log $(Quote-Arg $log) --seconds $limitSeconds --no-manager $copies"
    $up = Wait-For 'the hub' { (Read-Log $log) -match "hub up: \d+ monitors, 1 in the library, $want out" } 90
    Expect 'app.hub_up' $up (([regex]::Match((Read-Log $log), 'hub up: [^\r\n]*')).Value)
    if (-not $up) { throw "the app never came up with $want out" }
    $api = [int]('0' + [regex]::Match((Read-Log $log), 'exe api (\d+)').Groups[1].Value)
    Note "exe api $api"

    # ---------- into the state
    if ($State -eq 'manager' -or $State -eq 'hidden') {
      $q = Start-Exe ''
      if (-not $q.WaitForExit(15000)) { $q.Kill(); throw 'the plain second launch did not exit' }
      Expect 'state.manager_opens' (Wait-For 'the Manager' { (Manager-Window) -ne 0 } 20)
    }
    if ($State -eq 'hidden') {
      Expect 'state.probe_up' (Wait-For 'the Manager probe' { (Read-Log $log) -match 'PROBE manager up' } 20)
      $hid = Task 'hide_all' @{ 'do' = 'hide'; on = $true }
      $h = Manager-Window
      if ($h) { [W]::Close($h) }
      Expect 'state.manager_closed' (Wait-For 'the Manager to go' { (Manager-Window) -eq 0 } 15) 'closed by its X, as a person closes it'
      if (-not $hid) { throw 'Hide all never took' }
    }
    $bj = ''
    if ($State -eq 'api') {
      $id = New-Id
      Ask (Req $id $asker 'list')
      $r = Reply-For $id 10000
      $her = $null
      if ($r -and $r.ok) { $her = @($r.buddies | Where-Object { $_.out })[0] }
      Expect 'state.api_lists_her' ($null -ne $her) (Err $r)
      if (-not $her) { throw 'the API never listed her out' }
      $bj = ',"buddy":' + (J $her.id)
    }
    Start-Sleep -Seconds 3
    Note "in the state after $([Math]::Round($clock.Elapsed.TotalSeconds)) s, $([SoakNative]::Shown($script:appProc.Id)) of the exe's windows shown"

    # ---------- the soak: a look every -Interval seconds, each written as it's taken
    [IO.File]::WriteAllText($csvFile, (Csv-Header) + "`r`n", (New-Object Text.UTF8Encoding $false))
    $kinds = @{}
    $last = $null
    $looks = [System.Collections.Generic.List[object]]::new()
    $begin = $clock.Elapsed.TotalSeconds
    $end = [Math]::Min($begin + $Minutes * 60, $limitSeconds - 30)
    $nextLook = $begin
    $nextAsk = $begin
    $lastSay = -1000.0
    $asked = 0; $pending = $null
    $answers = @{}
    while ($clock.Elapsed.TotalSeconds -lt $end -and -not $script:appProc.HasExited) {
      $now = $clock.Elapsed.TotalSeconds
      if ($now -ge $nextLook) {
        $look = Take-Look $script:appProc.Id $last ($now - $begin) $kinds
        [IO.File]::AppendAllText($csvFile, ((Csv-Lines $look) -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding $false))
        $looks.Add($look)
        $last = $look
        while ($nextLook -le $now) { $nextLook += $Interval }
        if ($looks.Count % [Math]::Max(1, [int](600 / $Interval)) -eq 0) {
          Write-Host ('{0:N0} min: {1:N1} MB private working set, {2:N1} MB private, {3} handles, {4:N2}% of a core, {5:N0} wakeups/s' -f (($now - $begin) / 60), $look.total.private_ws_mb, $look.total.private_mb, $look.total.handles, $look.total.cpu_pct_core, $look.total.switches_per_s)
        }
      }
      if ($State -eq 'api' -and $now -ge $nextAsk) {
        if ($pending) { $e = Err (Reply-For $pending 3000); $answers[$e] = 1 + [int]$answers[$e] }
        $pending = New-Id
        if ($now - $lastSay -ge 20) {
          Ask (Req $pending $asker 'say' ($bj + ',"text":' + (J $sayings[$asked % $sayings.Count])))
          $lastSay = $now
        } else { Ask (Req $pending $asker 'act' ($bj + ',"action":"wave"')) }
        $asked++
        while ($nextAsk -le $now) { $nextAsk += 5 }
      }
      Start-Sleep -Milliseconds 250
    }
    $ran = ($clock.Elapsed.TotalSeconds - $begin) / 60
    $alive = -not $script:appProc.HasExited
    Expect 'soak.app_alive' $alive "after $([Math]::Round($ran, 1)) of $Minutes minutes$(if (-not $alive) { ", code $($script:appProc.ExitCode)" })"
    Expect 'soak.full_length' ($ran -ge $Minutes - 0.5) "$([Math]::Round($ran, 1)) of $Minutes minutes"
    $expected = [Math]::Floor($Minutes * 60 / $Interval)
    Expect 'soak.samples' ($looks.Count -ge 0.9 * $expected) "$($looks.Count) of about $expected"
    if ($State -eq 'api') {
      if ($pending) { $e = Err (Reply-For $pending 3000); $answers[$e] = 1 + [int]$answers[$e] }
      $said = (@($answers.Keys | Sort-Object | ForEach-Object { "$_ $($answers[$_])" }) -join ', ')
      Expect 'api.all_answered_ok' ($asked -gt 0 -and $answers.Count -eq 1 -and $answers.ContainsKey('ok')) "$asked requests: $said"
      Expect 'api.launches_exited_0' ($script:badExits -eq 0) "$($script:badExits) of $($asked + 1) with another code"
    }

    # ---------- the summary, and the budgets
    $sum = Summarize $looks
    if ($null -eq $sum) { throw "only $($looks.Count) samples: too few to sum up" }
    $report = [ordered]@{ state = $State; minutes_asked = $Minutes; interval_s = $Interval; exe_api = $api; budgets_enforced = [bool]$limits.enforce }
    foreach ($k in $sum.Keys) { $report[$k] = $sum[$k] }
    [IO.File]::WriteAllText($jsonFile, ($report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
    Note "summary: $($sum.mean.private_ws_mb) MB private working set, $($sum.mean.private_mb) MB private, leak $($sum.leak_mb_per_h) MB/h, handles $($sum.handles_per_h)/h, gdi $($sum.gdi_per_h)/h, user $($sum.user_per_h)/h, cpu $($sum.idle_cpu_pct_core)% of a core, $($sum.wakeups_per_s) wakeups/s"
    foreach ($b in (Check-Budgets $sum $limits $State)) {
      if ($limits.enforce) { Expect "budget.$($b.name)" $b.ok $b.detail }
      else { Note "budget.$($b.name) $(if ($b.ok) { 'within' } else { 'OVER' }): $($b.detail)" }
    }

    # ---------- the end: a clean quit by its own limit, after hours, and a log with no errors
    $wait = [Math]::Max(5, $limitSeconds - $clock.Elapsed.TotalSeconds + 30)
    $quit = $script:appProc.WaitForExit([int]($wait * 1000))
    Expect 'end.clean_exit' ($quit -and $script:appProc.ExitCode -eq 0) "$(if ($quit) { "code $($script:appProc.ExitCode)" } else { "still running $([Math]::Round($wait)) s after its limit" })"
    $text = Read-Log $log
    Expect 'end.quit_by_time' ($text -match 'quit: time limit reached') ''
    $bad = @($text -split "`r?`n" | Where-Object { $_ -match '\b(error|rejected|hub error|failed)\b' -and $_ -notmatch 'PROBE ' })
    Expect 'log.no_errors' ($bad.Count -eq 0) (($bad | Select-Object -First 5) -join ' | ')

    if ($env:GITHUB_STEP_SUMMARY) {
      $m = $sum.mean; $pk = $sum.peak; $ph = $sum.per_hour
      $table = @(
        "### Soak: $State, $([Math]::Round($ran)) min, a sample every $Interval s",
        "Steady: the last 75%, from minute $($sum.steady_from_min). CPU is a percentage of one core; the runner has $($sum.cores).",
        '',
        '| | mean | peak | change an hour |',
        '|---|---|---|---|',
        "| Private working set, MB | $($m.private_ws_mb) | $($pk.private_ws_mb) | $($ph.private_ws_mb) |",
        "| Private bytes, MB | $($m.private_mb) | $($pk.private_mb) | $($ph.private_mb) |",
        "| Working set, MB | $($m.ws_mb) | $($pk.ws_mb) | |",
        "| Handles | $($m.handles) | $($pk.handles) | $($ph.handles) |",
        "| GDI objects | $($m.gdi) | $($pk.gdi) | $($ph.gdi) |",
        "| USER objects | $($m.user) | $($pk.user) | $($ph.user) |",
        "| Threads | $($m.threads) | $($pk.threads) | $($ph.threads) |",
        "| CPU, % of one core | $($m.cpu_pct_core) | $($pk.cpu_pct_core) | |",
        "| Wakeups a second | $($m.switches_per_s) | $($pk.switches_per_s) | |",
        "| Processes | $($m.procs) | $($pk.procs) | |",
        '')
      $table -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY
    }
  }
} catch {
  # written before any cleanup, so a cleanup that goes wrong can't lose it
  Expect 'run.error' $false (Error-Line $_)
  Write-Host $_.ScriptStackTrace
  Save-Results
} finally {
  Tidy 'exe' { if ($appProc -and -not $appProc.HasExited) { Stop-Process -Id $appProc.Id -Force; [void]$appProc.WaitForExit(10000); Note 'the app was stopped by its PID' } }
  Tidy 'strays' {
    if ($runId) {
      $t = [Diagnostics.Stopwatch]::StartNew()
      do {
        $left = Ours
        if ($left.Count) { Start-Sleep -Milliseconds 500 }
      } while ($left.Count -and $t.Elapsed.TotalSeconds -lt 15)
      foreach ($one in $left) { Stop-Process -Id $one.ProcessId -Force -ErrorAction SilentlyContinue }
      Expect 'end.no_strays' ($left.Count -eq 0) "$($left.Count) left after $($t.ElapsedMilliseconds) ms$(if ($left.Count) { ', stopped by PID' })"
    }
  }
  Tidy 'logs' {
    foreach ($pair in @(@($log, 'soak.log'), @($primeLog, 'soak-prime.log'))) {
      if ($pair[0] -and $resultsFile -and (Test-Path -LiteralPath $pair[0])) { Copy-Item -LiteralPath $pair[0] -Destination (Join-Path $Out $pair[1]) }
    }
  }
  Save-Results
}
$fails = @($results | Where-Object { $_ -like 'FAIL *' })
$passes = @($results | Where-Object { $_ -like 'PASS *' }).Count
$summary = @("### Soak: $State", "$passes passed, $($fails.Count) failed", '') + ($fails | ForEach-Object { "- $_" }) + @($results | Where-Object { $_ -like 'INFO budget.*' } | ForEach-Object { "- $($_.Substring(5))" })
$summary -join "`n" | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { $summary -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY }
if ($fails.Count -or $passes -eq 0) { exit 1 }
exit 0
