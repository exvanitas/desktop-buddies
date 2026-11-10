# The local API and the MCP server end to end, against the real exe, on the Actions Windows runner.
# Its own copy of the built app folder beside the exe, with api-probe.js added to the Manager and
# the overlays, a fresh data folder, and the test buddy handed over at launch (first-buddy.ps1).
# Requests are real second launches, desktop-buddies.exe --api "<json>", and replies are read from
# api/replies/NN.json. The Manager's answers are its own buttons, clicked by the probe when this
# writes a task for it; what she shows is read from the overlay's bubble and images by the probe.
#   cold: a request with nothing running starts the app, which says not-running and quits
#   off: the setting is off on a fresh install, so every request is answered off, and no Manager opens
#   consent: a new app waits, the Manager asks, Allow is clicked, and settings.json keeps the answer
#   allowed: list has her, wave shows her waving, say shows the line byte for byte with its badge
#   refused: a link, an over-long line, bad JSON, a key too many; and nothing wedged after
#   paused, hidden, Not now until Remove, the MCP server over stdio, then off again, then a flood of
#   requests to fill every reply slot twice
# Desktop Buddies must not be running: a request would reach it. Processes end only by their own PID.
#
# -SetupOnly runs the checks and stops before the first launch: no window, no process, no mouse. Any
# error ends the run with "FAIL run.error <message> at line <n>" in -Out's api-e2e.txt, written before
# the cleanup, which notes its own errors and never hides that one.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [string]$Out = 'results',
  [string]$Node = 'node',
  [int]$TimeoutMs = 8000,
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
  if (-not $script:resultsFile) { Write-Host 'no api-e2e.txt: -Out was never made'; return }
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
# An error outside the try below stops the run: said with its line, and kept in api-e2e.txt.
trap {
  $msg = "FAIL run.error $(Error-Line $_)"
  Write-Host $msg; Write-Host $_.ScriptStackTrace
  try { if ($null -ne $results) { $results.Add($msg); if ($Out -and (Test-Path -LiteralPath $Out -PathType Container)) { $results | Set-Content -LiteralPath (Join-Path $Out 'api-e2e.txt') } } } catch { Write-Host "could not save: $($_.Exception.Message)" }
  break
}

# The reply slot for an id, as api-replies.ts computes it: FNV-1a over its characters, mod 64.
function Slot-Of([string]$id) {
  [uint64]$h = 2166136261
  foreach ($c in $id.ToCharArray()) { $h = (([uint64]($h -bxor [uint64][int]$c)) * [uint64]16777619) -band [uint64]4294967295 }
  return ('{0:D2}' -f ($h % 64))
}
# One argument for a Windows command line, by the rules the exe parses with.
function Quote-Arg([string]$s) {
  $o = '"'; $slashes = 0
  foreach ($c in $s.ToCharArray()) {
    if ($c -eq '\') { $slashes++; continue }
    if ($c -eq '"') { $o += ('\' * ($slashes * 2 + 1)) + '"' } else { $o += ('\' * $slashes) + $c }
    $slashes = 0
  }
  return $o + ('\' * ($slashes * 2)) + '"'
}
# A JSON string built by hand, so the bytes sent are exactly these. No control characters go in.
function J([string]$s) { return '"' + $s.Replace('\', '\\').Replace('"', '\"') + '"' }
# UTF-8 bytes as hex, as the probe logs what the bubble shows.
function Hex([string]$s) { return (@([Text.Encoding]::UTF8.GetBytes($s) | ForEach-Object { $_.ToString('x2') }) -join '') }
function New-Id { return 'e2e-' + [guid]::NewGuid().ToString('n') }
function Req($id, $who, $what, $extra = '') { return '{"v":1,"id":' + (J $id) + ',"app":' + (J $who) + ',"do":' + (J $what) + $extra + '}' }
function Err($r) { if ($null -eq $r) { return 'no reply' } elseif ($r.ok) { return 'ok' } else { return $r.error } }
function Keys($o) { return (@($o.PSObject.Properties.Name) | Sort-Object) -join ',' }

# What the cleanup reads. Each stays empty until the step that makes it.
$appProc = $null; $tmp = ''; $runId = ''; $log = ''; $coldLog = ''

try {
  # ---------- the parameters, and nothing started yet
  if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "-Exe '$Exe' is not a file" }
  if (-not (Test-Path -LiteralPath $App -PathType Container)) { throw "-App '$App' is not a folder" }
  if ($TimeoutMs -lt 1000) { throw "-TimeoutMs $TimeoutMs is below 1000" }
  $Exe = (Resolve-Path -LiteralPath $Exe).Path
  $App = (Resolve-Path -LiteralPath $App).Path
  New-Item -ItemType Directory -Force $Out | Out-Null
  $Out = (Resolve-Path -LiteralPath $Out).Path
  $resultsFile = Join-Path $Out 'api-e2e.txt'
  Note "mode $(if ($SetupOnly) { 'setup only: stops before the first launch' } else { 'full run' })"
  $probe = Join-Path (Split-Path $App) 'api-probe\api-probe.js'
  $drive = Join-Path $PSScriptRoot '..\..\..\tools\mcp\tests\drive.mjs'
  foreach ($need in $probe, $drive, (Join-Path $PSScriptRoot '..\..\..\tools\mcp\server.mjs')) {
    if (-not (Test-Path -LiteralPath $need -PathType Leaf)) { throw "$need is missing: build the app first" }
  }
  $drive = (Resolve-Path -LiteralPath $drive).Path
  $pages = @{ 'manager.html' = '<script src="manager.js"></script>'; 'overlay.html' = '<script src="overlay.js"></script>' }
  foreach ($page in $pages.Keys) {
    if (-not ([IO.File]::ReadAllText((Join-Path $App $page))).Contains($pages[$page])) { throw "$page has no $($pages[$page]) to add the probe after" }
  }
  $exeName = [IO.Path]::GetFileNameWithoutExtension($Exe)
  . (Join-Path $PSScriptRoot 'win32.ps1')
  . (Join-Path $PSScriptRoot 'first-buddy.ps1')
  $asker = 'E2E Check'
  # Quotes, a backslash, accents, an emoji and a pipe, with a backslash last, before the closing quote
  # on the command line. tests/api-e2e-lines.test.ts runs these through the app's own cleaning.
  $tricky = 'Quote "x" and \ back, caf' + [char]0xE9 + ' ni' + [char]0xF1 + 'o ' + [char]::ConvertFromUtf32(0x1F44B) + ' a | b end\'
  $linked = 'see example.com now'
  $long = 'x' * 121
  $mcpLine = 'Hello from the MCP check'
  Expect 'setup.slot_hash' ((Slot-Of 'abcdefgh') -eq '13' -and (Slot-Of '6f1c2e4a-0d1b-4c55-9a1e-3f0b7c2d9e10') -eq '29') "$(Slot-Of 'abcdefgh') $(Slot-Of '6f1c2e4a-0d1b-4c55-9a1e-3f0b7c2d9e10')"
  Expect 'setup.hex' ((Hex ([string][char]0xE9 + [char]::ConvertFromUtf32(0x1F44B))) -eq 'c3a9f09f918b') ''
  Expect 'setup.quoting' ((Quote-Arg 'a "b" c\') -eq '"a \"b\" c\\"') (Quote-Arg 'a "b" c\')
  Expect 'setup.checks' $true "exe $Exe, app $App, out $Out, node $Node"

  if ($SetupOnly) {
    Note 'setup_only stopped before the first launch: no window opened, no process started, no mouse moved'
  } else {
    if (Get-Process -Name $exeName -ErrorAction SilentlyContinue) { throw 'Desktop Buddies is running: a request would reach it' }
    # Processes are known by this name in their paths: the temp folder can be named in its short form
    # here and in its long one in a process's command line.
    $runId = 'api-e2e-' + [guid]::NewGuid().ToString('n').Substring(0, 8)
    $tmp = Join-Path $Temp $runId
    $bin = Join-Path $tmp 'bin'
    $data = Join-Path $tmp 'data'
    $cold = Join-Path $tmp 'cold-data'
    $log = Join-Path $tmp 'app.log'
    $coldLog = Join-Path $tmp 'cold.log'
    $replies = Join-Path $data 'api\replies'
    New-Item -ItemType Directory -Force $bin, $data, $cold | Out-Null
    Copy-Item -LiteralPath $Exe -Destination $bin
    Copy-Item -LiteralPath $App -Destination (Join-Path $bin 'app') -Recurse
    Copy-Item -LiteralPath $probe -Destination (Join-Path $bin 'app')
    foreach ($page in $pages.Keys) {
      $f = Join-Path $bin "app\$page"
      $role = [IO.Path]::GetFileNameWithoutExtension($page)
      $html = [IO.File]::ReadAllText($f).Replace($pages[$page], "$($pages[$page])<script src=`"api-probe.js`" data-role=`"$role`"></script>")
      [IO.File]::WriteAllText($f, $html, (New-Object Text.UTF8Encoding $false))
    }
    $runExe = Join-Path $bin (Split-Path $Exe -Leaf)
    $own = '--app-dir ' + (Quote-Arg (Join-Path $bin 'app'))

    function Read-Log($path) {
      if (-not $path -or -not (Test-Path -LiteralPath $path)) { return '' }
      $s = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite,Delete')
      try { return [IO.StreamReader]::new($s, [Text.Encoding]::UTF8).ReadToEnd() } finally { $s.Close() }
    }
    function Count-In($path, $pattern) { return ([regex]::Matches((Read-Log $path), $pattern)).Count }
    function Wait-For($what, [scriptblock]$test, $seconds = 20) {
      $t = [Diagnostics.Stopwatch]::StartNew()
      do { if (& $test) { return $true }; Start-Sleep -Milliseconds 100 } while ($t.Elapsed.TotalSeconds -lt $seconds)
      Write-Host "gave up waiting for $what"
      return $false
    }
    function Start-Exe([string]$line) {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $runExe; $psi.Arguments = $line; $psi.UseShellExecute = $false
      $p = [System.Diagnostics.Process]::Start($psi)
      [void]$p.Handle # or ExitCode comes back empty
      return $p
    }
    function Webviews { return @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($runId) }) }
    function Ours { return @(Get-CimInstance Win32_Process -Filter "Name='$exeName.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Contains($runId) }) }

    # The app's limit for everyone is 60 requests a minute. Until the flood, this keeps under it.
    $sentAt = [System.Collections.Generic.List[double]]::new()
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $flooding = $false
    function Pace($n = 1) {
      if ($script:flooding) { return }
      while (@($sentAt | Where-Object { $clock.Elapsed.TotalSeconds - $_ -lt 61 }).Count + $n -gt 45) { Start-Sleep -Milliseconds 500 }
      for ($i = 0; $i -lt $n; $i++) { $sentAt.Add($clock.Elapsed.TotalSeconds) }
    }
    # One real second launch with the request as its one argument. The running app takes it, and
    # this launch exits.
    function Ask([string]$raw) {
      if ($script:appProc.HasExited) { throw "the app quit, code $($script:appProc.ExitCode)" }
      Pace
      $p = Start-Exe ('--api ' + (Quote-Arg $raw))
      if (-not $p.WaitForExit(15000)) { $p.Kill(); throw 'a second launch did not exit in 15 s' }
      Exited-Clean $p "request $($script:sentCount + 1)"
    }
    # A second launch hands its arguments over and exits 0. Any other code is a FAIL, with the code.
    $sentCount = 0
    $badExits = [System.Collections.Generic.List[string]]::new()
    function Exited-Clean($p, $what) {
      $script:sentCount++
      if ($p.ExitCode -ne 0) { $badExits.Add("$what exited $($p.ExitCode)"); Expect 'launch.exit_code' $false "$what exited $($p.ExitCode)" }
    }
    $badFields = [System.Collections.Generic.List[string]]::new()
    # Every reply read is checked against what a reply may hold, docs/local-api.md, Reply.
    function Fields($r) {
      $k = Keys $r
      $fine = ($k -eq 'id,ok,v') -or ($k -eq 'buddies,id,ok,v') -or ($k -eq 'error,id,message,ok,v')
      if ($k -eq 'buddies,id,ok,v') { foreach ($b in @($r.buddies)) { if ((Keys $b) -ne 'can,copies,id,name,out') { $fine = $false } } }
      if (-not $fine) { $badFields.Add("$k in $($r.id)") }
    }
    function Reply-For($id, $ms = $TimeoutMs, $folder = $replies) {
      $f = Join-Path $folder "$(Slot-Of $id).json"
      $t = [Diagnostics.Stopwatch]::StartNew()
      while ($t.ElapsedMilliseconds -lt $ms) {
        if (Test-Path -LiteralPath $f) {
          $r = $null
          try { $r = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { $r = $null }
          if ($r -and $r.id -ceq $id) { Fields $r; return $r }
        }
        Start-Sleep -Milliseconds 100
      }
      return $null
    }
    # A request from `who` with a fresh id, and its reply, or $null.
    function Send($who, $what, $extra = '') { $id = New-Id; Ask (Req $id $who $what $extra); return Reply-For $id }
    function Settings {
      $f = Join-Path $data 'settings.json'
      if (-not (Test-Path -LiteralPath $f)) { return $null }
      try { return [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { return $null }
    }
    function Answer-Of($who) { $s = Settings; if (-not $s) { return 'none' }; $a = @($s.apiApps | Where-Object { $_.name -eq $who }); if (-not $a.Count) { return 'none' }; if ($a[0].allow) { return 'allow' }; return 'deny' }
    function Manager-Up { return [W]::FindTitled(@([uint32]$script:appProc.Id), 'Desktop Buddies Manager') -ne 0 }

    # A thing the Manager's probe does with the real view's buttons: written as e2e/task-<n>.json,
    # whole, and answered in the log as PROBE DID <n> PASS|FAIL <detail>.
    $taskN = 0
    function Task($label, $what) {
      $script:taskN++
      $n = $script:taskN
      $what.n = $n
      $dir = Join-Path $data 'e2e'
      New-Item -ItemType Directory -Force $dir | Out-Null
      $part = Join-Path $dir ".~task-$n"
      [IO.File]::WriteAllText($part, ($what | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
      Move-Item -LiteralPath $part -Destination (Join-Path $dir "task-$n.json")
      $script:did = $null
      [void](Wait-For "task $n" { $m = [regex]::Match((Read-Log $log), "PROBE DID $n (PASS|FAIL) ([^\r\n]*)"); if ($m.Success) { $script:did = $m }; $m.Success } 30)
      if (-not $script:did) { Expect "manager.$label" $false "the probe never did task $n"; return $false }
      $ok = $script:did.Groups[1].Value -eq 'PASS'
      $detail = $script:did.Groups[2].Value
      Expect "manager.$label" $ok $(if ($detail.Length -gt 400) { $detail.Substring(0, 400) } else { $detail })
      return $ok
    }
    # What the probe saw in her bubble, by its hex.
    # Each whole PROBE SAID record: the badge's name and the words, as hex, to the end of its line.
    $saidRecord = '(?m)PROBE SAID ([0-9a-f]+) ([0-9a-f]*)\r?$'
    # Whether her bubble showed exactly this line from this app: each field compared whole.
    function Has-Said($who, $line) {
      foreach ($m in [regex]::Matches((Read-Log $log), $saidRecord)) {
        if ($m.Groups[1].Value -ceq (Hex $who) -and $m.Groups[2].Value -ceq (Hex $line)) { return $true }
      }
      return $false
    }
    function Waves { return Count-In $log 'PROBE WAVED \d+' }
    function Done-Count($what) { return Count-In $log "api ${what}: done" }

    # ---------- cold: nothing running, so the launch starts the app, which answers and quits
    $id = New-Id
    $t = [Diagnostics.Stopwatch]::StartNew()
    $c = Start-Exe ("--data-dir $(Quote-Arg $cold) $own --log $(Quote-Arg $coldLog) --api " + (Quote-Arg (Req $id $asker 'list')))
    $sawManager = $false
    while (-not $c.HasExited -and $t.Elapsed.TotalSeconds -lt 15) {
      if ([W]::FindTitled(@([uint32]$c.Id), 'Desktop Buddies Manager') -ne 0) { $sawManager = $true }
      Start-Sleep -Milliseconds 100
    }
    $exited = $c.HasExited
    if (-not $exited) { $c.Kill(); [void]$c.WaitForExit(5000) }
    Expect 'cold.exits' ($exited -and $c.ExitCode -eq 0) "after $([Math]::Round($t.Elapsed.TotalSeconds, 1)) s, code $(if ($exited) { $c.ExitCode } else { 'none: killed' })"
    $r = Reply-For $id 3000 (Join-Path $cold 'api\replies')
    Expect 'cold.not_running' ((Err $r) -eq 'not-running') (Err $r)
    Expect 'cold.no_manager' (-not $sawManager)
    Expect 'cold.hub_said_so' ((Read-Log $coldLog) -match 'api: started by a request, so not running') ''
    [void](Wait-For 'the cold start to be gone' { (Ours).Count -eq 0 -and (Webviews).Count -eq 0 } 15)
    Expect 'cold.nothing_left' ((Ours).Count -eq 0 -and (Webviews).Count -eq 0) "$((Ours).Count) exe, $((Webviews).Count) webview"

    # ---------- the app, on a fresh data folder: the setting is off
    $first = @(First-Buddy $App $data $tmp)
    $script:appProc = Start-Exe ("--data-dir $(Quote-Arg $data) $own --log $(Quote-Arg $log) --seconds 900 --no-manager " + ($first -join ' '))
    $up = Wait-For 'the hub' { (Read-Log $log) -match 'hub up: \d+ monitors, \d+ in the library, [1-9]\d* out' } 60
    Expect 'app.hub_up' $up (([regex]::Match((Read-Log $log), 'hub up: [^\r\n]*')).Value)
    if (-not $up) { throw 'the app never came up with a buddy out' }
    $api = [int]('0' + [regex]::Match((Read-Log $log), 'exe api (\d+)').Groups[1].Value)
    Note "exe api $api"
    Expect 'app.overlay_probe' (Wait-For 'the overlay probe' { (Read-Log $log) -match 'PROBE overlay up' } 20)
    Start-Sleep -Seconds 2
    $off = @((Send $asker 'list'), (Send $asker 'act' ',"buddy":"anyone","action":"wave"'), (Send $asker 'say' ',"buddy":"anyone","text":"hi"'), (Send 'E2E Other' 'list'))
    Expect 'off.everything_off' (@($off | Where-Object { (Err $_) -ne 'off' }).Count -eq 0) (@($off | ForEach-Object { Err $_ }) -join ' ')
    Start-Sleep -Milliseconds 800
    Expect 'off.no_manager' (-not (Manager-Up)) 'no request opened the Manager'
    Expect 'off.setting_off_on_disk' ($null -eq (Settings) -or -not (Settings).api) ''

    # ---------- the Manager, opened as the person opens it: a launch with nothing in it
    $p = Start-Exe ''
    if (-not $p.WaitForExit(15000)) { $p.Kill(); throw 'the plain second launch did not exit' }
    Expect 'manager.plain_launch_exit' ($p.ExitCode -eq 0) "code $($p.ExitCode)"
    Expect 'manager.opens' (Wait-For 'the Manager' { Manager-Up } 20)
    $probeUp = Wait-For 'the Manager probe' { (Read-Log $log) -match 'PROBE manager up' } 20
    Expect 'manager.probe_up' $probeUp
    if (-not $probeUp) { throw 'the Manager probe never came up, so nothing can be answered' }
    [void](Task 'setting_on' @{ 'do' = 'on'; on = $true })
    Expect 'consent.setting_saved' (Wait-For 'settings.json' { $s = Settings; $s -and $s.api -eq $true } 10)

    # ---------- consent: a new app waits until the person answers
    $w1 = Send $asker 'list'
    $w2 = Send $asker 'act' ',"buddy":"anyone","action":"wave"'
    Expect 'consent.waiting' ((Err $w1) -eq 'waiting' -and (Err $w2) -eq 'waiting') "$(Err $w1) $(Err $w2)"
    [void](Task 'asks' @{ 'do' = 'look'; app = $asker })
    [void](Task 'allow' @{ 'do' = 'answer'; app = $asker; allow = $true })
    Expect 'consent.stored' (Wait-For 'the answer on disk' { (Answer-Of $asker) -eq 'allow' } 10) (Answer-Of $asker)

    # ---------- allowed: list, wave, say
    $r = Send $asker 'list'
    $her = $null
    if ($r -and $r.ok) { $her = @($r.buddies | Where-Object { $_.out -and @($_.can) -contains 'wave' })[0] }
    Expect 'allowed.list' ($null -ne $her) "$(Err $r): $(@($r.buddies | ForEach-Object { "$($_.id) out=$($_.out) copies=$($_.copies) can=$(@($_.can) -join '+')" }) -join '; ')"
    if (-not $her) { throw 'no buddy out who can wave' }
    $bj = ',"buddy":' + (J $her.id)
    $before = Waves
    $acts = Done-Count 'act'
    $r = Send $asker 'act' ($bj + ',"action":"wave"')
    Expect 'allowed.wave' ((Err $r) -eq 'ok') (Err $r)
    Expect 'allowed.wave_logged' (Wait-For 'the hub' { (Done-Count 'act') -gt $acts } 5)
    Expect 'allowed.wave_shown' (Wait-For 'her wave' { (Waves) -gt $before } 6) "waves seen $before before, $(Waves) after"
    $r = Send $asker 'say' ($bj + ',"text":' + (J $tricky))
    Expect 'allowed.say' ((Err $r) -eq 'ok') (Err $r)
    $shown = Wait-For 'her bubble' { Has-Said $asker $tricky } 6
    $seen = @([regex]::Matches((Read-Log $log), $saidRecord) | ForEach-Object { $_.Value.Trim() })
    Expect 'allowed.say_byte_for_byte' $shown "want PROBE SAID $(Hex $asker) $(Hex $tricky); the bubble showed: $(if ($seen.Count) { $seen[-1] } else { 'nothing' })$(if ((Read-Log $log) -match 'PROBE CANNOT ([^\r\n]*)') { '; the probe cannot judge: ' + $Matches[1] })"

    # ---------- refused, and nothing wedged after
    $r = Send $asker 'say' ($bj + ',"text":' + (J $linked))
    Expect 'refused.link' ((Err $r) -eq 'link') (Err $r)
    $r = Send $asker 'say' ($bj + ',"text":' + (J $long))
    Expect 'refused.too_long' ((Err $r) -eq 'too-long') (Err $r)
    $r = Send $asker 'list' ',"extra":1'
    Expect 'refused.key_too_many' ((Err $r) -eq 'bad-request') (Err $r)
    $noReply = Count-In $log 'api: refused bad-request, no reply'
    $id = New-Id
    Ask (([string][char]123) + '"v":1,"id":' + (J $id) + ',"app":')
    Expect 'refused.bad_json' ($null -eq (Reply-For $id 2000)) 'cut short: no usable id, so no reply'
    Ask 'not json'
    $id = 'E2E-' + [guid]::NewGuid().ToString('n').ToUpper()
    Ask (Req $id $asker 'list')
    Expect 'refused.upper_case_id' ($null -eq (Reply-For $id 2000)) 'no reply'
    Expect 'refused.logged' (Wait-For 'the hub' { (Count-In $log 'api: refused bad-request, no reply') -ge $noReply + 3 } 5) "$((Count-In $log 'api: refused bad-request, no reply') - $noReply) of 3"
    $r = Send $asker 'list'
    Expect 'refused.nothing_wedged' ((Err $r) -eq 'ok') (Err $r)

    # ---------- paused: everything refused, a new app too, and nobody asked about
    if (Task 'pause' @{ 'do' = 'pause'; on = $true }) {
      $got = @((Send $asker 'list'), (Send $asker 'act' ($bj + ',"action":"wave"')), (Send $asker 'say' ($bj + ',"text":"paused?"')), (Send 'E2E Paused' 'list'))
      Expect 'paused.everything' (@($got | Where-Object { (Err $_) -ne 'paused' }).Count -eq 0) (@($got | ForEach-Object { Err $_ }) -join ' ')
      [void](Task 'paused_nobody_asked' @{ 'do' = 'state' })
      Expect 'paused.nobody_asked' ($script:did -and $script:did.Groups[2].Value -notmatch 'E2E Paused') ''
      [void](Task 'unpause' @{ 'do' = 'pause'; on = $false })
    }

    # ---------- hidden: list works, wave and say don't
    if (Task 'hide' @{ 'do' = 'hide'; on = $true }) {
      $l = Send $asker 'list'
      $a = Send $asker 'act' ($bj + ',"action":"wave"')
      $s = Send $asker 'say' ($bj + ',"text":"hidden?"')
      Expect 'hidden.list_works' ((Err $l) -eq 'ok') (Err $l)
      Expect 'hidden.wave_and_say_refused' ((Err $a) -eq 'hidden' -and (Err $s) -eq 'hidden') "$(Err $a) $(Err $s)"
      [void](Task 'unhide' @{ 'do' = 'hide'; on = $false })
    }

    # ---------- Not now: refused, and still refused, until Remove asks again
    $denied = 'E2E Denied'
    $r = Send $denied 'list'
    Expect 'denied.waits_first' ((Err $r) -eq 'waiting') (Err $r)
    if (Task 'not_now' @{ 'do' = 'answer'; app = $denied; allow = $false }) {
      Expect 'denied.stored' (Wait-For 'the answer on disk' { (Answer-Of $denied) -eq 'deny' } 10) (Answer-Of $denied)
      $got = @((Send $denied 'list'), (Send $denied 'act' ($bj + ',"action":"wave"')))
      Start-Sleep -Seconds 3
      $got += Send $denied 'say' ($bj + ',"text":"still no?"')
      Expect 'denied.stays_refused' (@($got | Where-Object { (Err $_) -ne 'not-allowed' }).Count -eq 0) (@($got | ForEach-Object { Err $_ }) -join ' ')
      [void](Task 'not_asked_again' @{ 'do' = 'state' })
      Expect 'denied.not_asked_again' ($script:did -and $script:did.Groups[2].Value -notmatch '"asking":\[[^\]]*E2E Denied') ''
      if (Task 'remove' @{ 'do' = 'forget'; app = $denied }) {
        Expect 'denied.removed_on_disk' (Wait-For 'the answer gone' { (Answer-Of $denied) -eq 'none' } 10) (Answer-Of $denied)
        $r = Send $denied 'list'
        Expect 'denied.asked_again' ((Err $r) -eq 'waiting') (Err $r)
      }
    }

    # ---------- MCP: the server on stdio, pointed at the real exe, its replies from the real app
    $mcpApp = 'E2E MCP'
    function Drive($phase) {
      Pace 4
      $lines = @(& $Node $drive --exe $runExe --data $data --app $mcpApp --phase $phase --text $mcpLine --timeout $TimeoutMs | ForEach-Object { "$_" })
      $code = $LASTEXITCODE
      foreach ($l in $lines) {
        if ($l -match '^(PASS|FAIL) (\S+) ?(.*)$') { Expect "$($Matches[2]).$phase" ($Matches[1] -eq 'PASS') $Matches[3] }
        elseif ($l -match '^INFO (.*)$') { Note $Matches[1] }
        elseif ($l.Trim()) { Note "mcp said: $l" }
      }
      Expect "mcp.driver_exit.$phase" ($code -eq 0 -and $lines.Count -gt 0) "code $code, $($lines.Count) lines"
    }
    Drive 'waiting'
    [void](Task 'mcp_asks' @{ 'do' = 'look'; app = $mcpApp })
    if (Task 'mcp_allow' @{ 'do' = 'answer'; app = $mcpApp; allow = $true }) {
      $counts = @((Done-Count 'list'), (Done-Count 'act'), (Done-Count 'say'))
      $before = Waves
      Drive 'run'
      [void](Wait-For 'the hub' { (Done-Count 'say') -gt $counts[2] } 5)
      $now = @((Done-Count 'list'), (Done-Count 'act'), (Done-Count 'say'))
      Expect 'mcp.app_saw_each' ($now[0] -eq $counts[0] + 1 -and $now[1] -eq $counts[1] + 1 -and $now[2] -eq $counts[2] + 1) "list, act, say done: $($counts -join ',') before, $($now -join ',') after"
      Expect 'mcp.wave_shown' (Wait-For 'her wave' { (Waves) -gt $before } 6) "waves seen $before before, $(Waves) after"
      Expect 'mcp.say_shown' (Wait-For 'her bubble' { Has-Said $mcpApp $mcpLine } 6) "PROBE SAID $(Hex $mcpApp) $(Hex $mcpLine)"
    }

    # ---------- off again: every request is off, and nobody waits
    if (Task 'setting_off' @{ 'do' = 'on'; on = $false }) {
      $got = @((Send $asker 'list'), (Send $asker 'act' ($bj + ',"action":"wave"')), (Send $asker 'say' ($bj + ',"text":"off?"')), (Send 'E2E Late' 'list'))
      Expect 'off_again.everything_off' (@($got | Where-Object { (Err $_) -ne 'off' }).Count -eq 0) (@($got | ForEach-Object { Err $_ }) -join ' ')
      [void](Task 'off_forgets_waiting' @{ 'do' = 'state' })
      Expect 'off_again.nobody_waiting' ($script:did -and $script:did.Groups[2].Value -match '"asking":\[\]') ''
      Expect 'off_again.saved' (Wait-For 'settings.json' { $s = Settings; $s -and -not $s.api } 10)
    }

    # ---------- the reply slots: two requests for every slot, as fast as launches go
    $round = @(@{}, @{})
    while ($round[1].Count -lt 64) {
      $id = New-Id; $slot = Slot-Of $id
      if (-not $round[0].ContainsKey($slot)) { $round[0][$slot] = $id } elseif (-not $round[1].ContainsKey($slot)) { $round[1][$slot] = $id }
    }
    $script:flooding = $true
    $t = [Diagnostics.Stopwatch]::StartNew()
    foreach ($k in 0, 1) { foreach ($slot in @($round[$k].Keys | Sort-Object)) { Ask (Req $round[$k][$slot] $asker 'list') } }
    Note "flood: 128 requests in $([Math]::Round($t.Elapsed.TotalSeconds, 1)) s"
    function Last-Wins { return @($round[1].Keys | Where-Object { $r = Reply-For $round[1][$_] 1; $null -eq $r }).Count -eq 0 }
    Expect 'slots.newest_reply_in_each' (Wait-For 'every slot''s newest reply' { Last-Wins } 30) ''
    $all = @(Get-ChildItem -Force -LiteralPath $replies)
    $odd = @($all | Where-Object { $_.Name -notmatch '^\d\d\.json$' })
    Expect 'slots.at_most_64' ($all.Count -le 64 -and $odd.Count -eq 0) "$($all.Count) files, others: $(@($odd | ForEach-Object Name) -join ', ')"
    Expect 'slots.no_temp' (@($all | Where-Object { $_.Name.StartsWith('.~') }).Count -eq 0) ''
    $errs = @($round[1].Values | ForEach-Object { Err (Reply-For $_ 1) } | Group-Object | ForEach-Object { "$($_.Name) $($_.Count)" })
    Note "flood: the newest replies say $($errs -join ', ')"
    $script:flooding = $false

    # ---------- what every reply held, and what the log says
    Expect 'launches.all_exited_0' ($badExits.Count -eq 0) "$($script:sentCount) requests, $($badExits.Count) with another code$(if ($badExits.Count) { ': ' + (($badExits | Select-Object -First 5) -join '; ') })"
    Expect 'replies.only_allowed_fields' ($badFields.Count -eq 0) (($badFields | Select-Object -First 5) -join '; ')
    Expect 'app.still_up' (-not $script:appProc.HasExited) ''
    $text = Read-Log $log
    $plain = @($text -split "`r?`n" | Where-Object { $_ -notmatch 'PROBE ' })
    $named = @($plain | Where-Object { $_ -cmatch 'E2E (Check|Other|Paused|Denied|MCP|Late)|Hello from the MCP|Quote "x"' })
    if ($api -ge 2) { Expect 'log.no_apps_or_words' ($named.Count -eq 0) (($named | Select-Object -First 3) -join ' | ') }
    else { Note 'log.no_apps_or_words skipped: an API 1 exe logs every second launch''s arguments' }
    $bad = @($plain | Where-Object { $_ -match '\b(error|rejected|hub error|failed)\b' })
    Expect 'log.no_errors' ($bad.Count -eq 0) (($bad | Select-Object -First 5) -join ' | ')
    $probeBad = @($text -split "`r?`n" | Where-Object { $_ -match 'PROBE (threw|no role|manager never ready|CANNOT)' })
    Expect 'probe.no_errors' ($probeBad.Count -eq 0) (($probeBad | Select-Object -First 3) -join ' | ')
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
        $left = @(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'msedgewebview2.exe' -or $_.Name -eq "$exeName.exe") -and $_.CommandLine -and $_.CommandLine.Contains($runId) })
        if ($left.Count) { Start-Sleep -Milliseconds 500 }
      } while ($left.Count -and $t.Elapsed.TotalSeconds -lt 15)
      foreach ($s in $left) { Stop-Process -Id $s.ProcessId -Force -ErrorAction SilentlyContinue }
      Expect 'end.no_strays' ($left.Count -eq 0) "$($left.Count) left after $($t.ElapsedMilliseconds) ms$(if ($left.Count) { ', stopped by PID' })"
    }
  }
  Tidy 'logs' {
    foreach ($pair in @(@($log, 'api-e2e.log'), @($coldLog, 'api-e2e-cold.log'))) {
      if ($pair[0] -and $resultsFile -and (Test-Path -LiteralPath $pair[0])) { Copy-Item -LiteralPath $pair[0] -Destination (Join-Path $Out $pair[1]) }
    }
  }
  Save-Results
}
$fails = @($results | Where-Object { $_ -like 'FAIL *' })
$passes = @($results | Where-Object { $_ -like 'PASS *' }).Count
$summary = @('### Local API end to end', "$passes passed, $($fails.Count) failed", '') + ($fails | ForEach-Object { "- $_" })
$summary -join "`n" | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { $summary -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY }
if ($fails.Count -or $passes -eq 0) { exit 1 }
exit 0
