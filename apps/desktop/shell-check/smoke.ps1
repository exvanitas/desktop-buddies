# A smoke run of the real app: the built app folder beside the built exe, a fresh data folder, then
# everything judged from the log. Runs on the Actions Windows runner.
# -Local is for a real PC: every run names its data and app folders, the save dialogs save into the
# run's own folder, and the Recent links those saves leave are taken away again.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [string]$Out = 'results',
  [int]$Seconds = 55,
  [switch]$Local,
  [string]$Temp = [IO.Path]::GetTempPath()
)
$ErrorActionPreference = 'Stop'
# An error's message and where it was thrown. -File drops the line from the console's own report.
function Error-Line($e) {
  $i = $e.InvocationInfo
  $where = if ($i -and $i.ScriptLineNumber) { " at line $($i.ScriptLineNumber)$(if ($i.ScriptName -and $i.ScriptName -ne $PSCommandPath) { ' of ' + [IO.Path]::GetFileName($i.ScriptName) })" } else { ' at an unknown line' }
  return "$($e.Exception.Message)$where"
}
# An error outside a try stops the run: said with its line, and kept in smoke.txt once -Out is made.
trap {
  $msg = "FAIL run.error $(Error-Line $_)"
  Write-Host $msg; Write-Host $_.ScriptStackTrace
  try { if ($null -ne $results) { $results.Add($msg); if ($Out -and (Test-Path -LiteralPath $Out -PathType Container)) { $results | Set-Content -LiteralPath (Join-Path $Out 'smoke.txt') } } } catch { Write-Host "could not save: $($_.Exception.Message)" }
  break
}
. (Join-Path $PSScriptRoot 'win32.ps1')
. (Join-Path $PSScriptRoot 'hunt.ps1')
. (Join-Path $PSScriptRoot 'first-buddy.ps1')
$Exe = (Resolve-Path $Exe).Path
$App = (Resolve-Path $App).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path

if ($Local -and -not $PSBoundParameters.ContainsKey('Temp')) { throw '-Local needs -Temp' }
$tmp = Join-Path $Temp ("smoke-" + [guid]::NewGuid().ToString('n').Substring(0, 8))
$bin = Join-Path $tmp 'bin'
$data = Join-Path $tmp 'data'
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item $Exe $bin
Copy-Item $App (Join-Path $bin 'app') -Recurse
# not $exe: names ignore case, so that would be -Exe
$runExe = Join-Path $bin (Split-Path $Exe -Leaf)
$saves = Join-Path $tmp 'saves'
New-Item -ItemType Directory -Force $saves | Out-Null
$recent = [Environment]::GetFolderPath('Recent')
$hadRecent = @(Get-ChildItem $recent -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object Name)

# The folders a run uses. Local runs always name the app folder too.
function Own($dir, $dataDir) {
  $a = @('--data-dir', "`"$dataDir`"")
  if ($Local) { $a += @('--app-dir', "`"$(Join-Path $dir 'app')`"") }
  return $a
}
# Where a save dialog saved. Local runs type the path in, so they never look anywhere else.
function Saved-File($name) {
  if ($Local) { $f = Join-Path $saves $name; if (Test-Path $f) { return $f }; return $null }
  $f = Join-Path ([Environment]::GetFolderPath('MyDocuments')) $name
  if (Test-Path $f) { return $f }
  return (Get-ChildItem $env:USERPROFILE -Recurse -Filter $name -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
# Saves. A local run cancels if it can't type the path in.
function Save-As($h, $name) {
  # On the owner's PC no save is ever made: a save there would enter Explorer's save history and Recent.
  if ($Local) { Write-Host "local: cancelled the $name dialog"; [W]::Press($h, 2); return }
  if ($Local -and -not [W]::SaveName($h, (Join-Path $saves $name))) { Write-Host "no name box in the $name dialog"; [W]::Press($h, 2); return }
  [W]::Press($h, 1)
}

$results = [System.Collections.Generic.List[string]]::new()
function Expect($name, $ok, $detail = '') {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) $name $detail"
  $results.Add($line); Write-Host $line
}

# Every run here starts quiet, as it did before the Manager opened at start: a window of its own would
# be measured, sit over the buddy the mouse hunts for, and run a probe before its step.
function Run($label, [string[]]$more, $limit) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process $runExe -ArgumentList ((Own $bin $data) + @('--seconds', $limit, '--no-manager') + $more + (First-Buddy $App $data $tmp)) -PassThru
  [void]$p.Handle # or ExitCode comes back empty
  # A local hunt goes first, as soon as she's out: measuring takes a real PC long enough to eat the run.
  if ($label -eq 'first') { if ($Local) { Grab $p; Sample $p } else { Sample $p; Grab $p } }
  $done = $p.WaitForExit(($limit + 15) * 1000)
  if (-not $done) { $p.Kill() }
  Expect "$label.exit" ($done -and $p.ExitCode -eq 0) "code $($p.ExitCode) after $($t.ElapsedMilliseconds) ms"
  # WebView2's helpers take a moment to follow the exe out.
  $t = [Diagnostics.Stopwatch]::StartNew()
  do {
    $left = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'desktop-buddies.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$tmp*") })
    if ($left.Count) { Start-Sleep -Milliseconds 500 }
  } while ($left.Count -and $t.Elapsed.TotalSeconds -lt 15)
  Expect "$label.no_strays" ($left.Count -eq 0) "$($left.Count) left after $($t.ElapsedMilliseconds) ms"
}

# What the app costs here, for comparison with the first numbers. Not a pass or fail.
function Sample($p) {
  Start-Sleep -Seconds 15
  & (Join-Path $PSScriptRoot '..\scripts\measure.ps1') -Label 'smoke' -Seconds 6 | Tee-Object (Join-Path $Out 'measure.txt') | Write-Host
  # Each process's share, to see what the hub's page costs.
  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'desktop-buddies.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$tmp*") } | ForEach-Object {
    $id = $_.ProcessId
    $kind = if ($_.CommandLine -match '--type=(\S+)') { $Matches[1] } else { $_.Name }
    '{0,-24} {1,6:N1} MB' -f $kind, ((($perf | Where-Object { $_.IDProcess -eq $id }).WorkingSetPrivate | Measure-Object -Sum).Sum / 1MB)
  } | Tee-Object -Append (Join-Path $Out 'measure.txt') | Write-Host
}

# Hunts for the buddy with the real cursor: the overlay only takes the mouse over her visible
# pixels, read from the library's images. Then picks her up and drops her. The floor first, as
# that's where she usually is, then the whole screen. A local run goes straight to where the app
# says she is: a real desk is too big to sweep, and she may be on a window or another monitor.
function Lift-Her($x, $y) {
  [W]::Mouse(2)
  for ($i = 1; $i -le 10; $i++) { [void][W]::MoveCursor($x, $y - 20 * $i); Start-Sleep -Milliseconds 40 }
  Start-Sleep -Milliseconds 200
  [W]::Mouse(4)
}
function Grab($p) {
  if ($Local) {
    $back = [W]::CursorAt()
    $a = Find-Her $log ([uint32]$p.Id) 60
    if ($a) {
      $script:grabbed = "at $($a.x),$($a.y)"
      Write-Host "hunt: pressed at $($a.x),$($a.y), lifting her 200 px"
      Lift-Her $a.x $a.y
      Write-Host 'hunt: released'
    }
    [void][W]::MoveCursor($back.X, $back.Y)
    return
  }
  $work = [W]::WorkArea()
  $rows = @(($work.B - 40), ($work.B - 90)) * 3
  for ($y = $work.T + 30; $y -lt $work.B; $y += 45) { $rows += $y }
  foreach ($y in $rows) {
    for ($x = $work.L + 15; $x -lt $work.R; $x += 30) {
      [void][W]::MoveCursor($x, $y)
      Start-Sleep -Milliseconds 70
      if ([W]::Lands($x, $y, [uint32]$p.Id)) {
        # The scan meets her left edge first, and she can walk off that before a press lands. So press further in.
        $in = $x + 20
        [void][W]::MoveCursor($in, $y)
        Start-Sleep -Milliseconds 70
        if (-not [W]::Lands($in, $y, [uint32]$p.Id)) { continue }
        $script:grabbed = "at $in,$y"
        Lift-Her $in $y
        [void][W]::MoveCursor(5, 5)
        return
      }
    }
  }
}
$script:grabbed = $null

$log = Join-Path $data 'logs\app.log'
# Locally the first run gets at least 120 s, so the hunt and the measuring both fit.
Run 'first' @('--trace-hits') $(if ($Local) { [Math]::Max($Seconds, 120) } else { $Seconds })
Copy-Item $log (Join-Path $Out 'smoke.log') -ErrorAction SilentlyContinue
$text = if (Test-Path $log) { Get-Content -Raw $log } else { '' }
Expect 'log.default_place' ($text.Length -gt 0)
Expect 'log.no_errors' ($text -notmatch '(?m)\b(error|rejected|hub error|failed)\b') (($text -split "`n" | Select-String '\b(error|rejected|hub error|failed)\b' | Select-Object -First 5) -join ' | ')
Expect 'log.seeded' (Got-First $text $App) $(if (Seeds-Itself $App) { 'seeded by the build' } else { 'no seed: the sample, imported at launch' })
Expect 'log.overlay_page' ($text -match '\[0\] page up')
Expect 'log.overlay_up' ($text -match 'overlay 0 up')
Expect 'log.joined' ($text -match 'joined overlay 0')
Expect 'log.hub_up' ($text -match 'hub up: \d+ monitors, 1 in the library, 1 out')
Expect 'log.world_runs' ($text -match 'rate ticks=[1-9]\d+') ([regex]::Match($text, 'rate ticks=\d+').Value)
Expect 'log.clean_quit' ($text -match 'quit: time limit reached')
# The exe's contract, as the hub logged it. API 2 keeps overlays on top and makes them tool windows.
$script:api = [int]('0' + [regex]::Match($text, 'exe api (\d+)').Groups[1].Value)
Expect 'log.exe_api' ($script:api -in 1, 2) "api $($script:api)"
if ($script:api -ge 2) {
  Expect 'api2.raise' ($text -notmatch 'raise failed')
  Expect 'api2.tool_overlays' ($text -notmatch "isn't a tool window")
}
Expect 'mouse.found_her' ($null -ne $script:grabbed) "$script:grabbed"
Expect 'mouse.press' ($text -match 'press \S+ from overlay 0')
Expect 'mouse.release' ($text -match 'release \S+ state=')
$lib = Join-Path $data 'library'
$char = Get-ChildItem $lib -Directory | Where-Object { $_.Name -notlike '.*' } | Select-Object -First 1
Expect 'library.on_disk' ($char -and (Test-Path (Join-Path $char.FullName 'buddy.json')) -and @(Get-ChildItem $char.FullName -Filter *.webp).Count -gt 20) "$($char.Name)"

# A second run seeds nothing, and takes what the first left. It also finds a swap a crash stopped
# between setting the old copy aside and moving the new one in, and puts her back.
if ($char) {
  $old = Join-Path $lib '.outgoing'
  New-Item -ItemType Directory -Force $old, (Join-Path $lib '.incoming\scraps') | Out-Null
  Move-Item $char.FullName $old
}
Run 'second' @('--buddies', '2') 12
$text2 = (Get-Content -Raw $log).Substring($text.Length)
Copy-Item $log (Join-Path $Out 'smoke.log')
Expect 'second.no_seed' ($text2 -notmatch 'library seeded')
Expect 'second.no_errors' ($text2 -notmatch '(?m)\b(error|rejected|hub error|failed)\b')
Expect 'second.copies' ($text2 -match 'hub up: \d+ monitors, 1 in the library, 2 out')
Expect 'second.recovered' ($char -and (Test-Path (Join-Path $lib "$($char.Name)\buddy.json")) -and -not (Test-Path (Join-Path $lib ".outgoing\$($char.Name)")) -and -not (Test-Path (Join-Path $lib '.incoming')))

# The Manager. Its own copy of the app, with the probe added to manager.html, so the real client
# runs in the real window against the real hub. The log says what it did, and this does what a page
# can't: launch again, answer the save dialog, minimize, close, take the foreground.
$pbin = Join-Path $tmp 'probe-bin'
New-Item -ItemType Directory -Force $pbin | Out-Null
Copy-Item $Exe $pbin
Copy-Item $App (Join-Path $pbin 'app') -Recurse
Copy-Item (Join-Path (Split-Path $App) 'probe\manager-probe.js') (Join-Path $pbin 'app')
$page = Join-Path $pbin 'app\manager.html'
$tag = '<script src="manager.js"></script>'
(Get-Content -Raw $page).Replace($tag, "$tag<script src=`"manager-probe.js`"></script>") | Set-Content -NoNewline $page
$pexe = Join-Path $pbin (Split-Path $Exe -Leaf)
$mdata = Join-Path $tmp 'manager-data'
$mlog = Join-Path $Out 'manager.log'
$again = $mdata
$title = 'Desktop Buddies Manager'

function Log-Text {
  if (-not (Test-Path $mlog)) { return '' }
  $s = [IO.File]::Open($mlog, 'Open', 'Read', 'ReadWrite,Delete')
  try { return [IO.StreamReader]::new($s).ReadToEnd() } finally { $s.Close() }
}
function Wait-For($what, [scriptblock]$test, $limit = 20) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  do { if (& $test) { return $true }; Start-Sleep -Milliseconds 100 } while ($t.Elapsed.TotalSeconds -lt $limit)
  Write-Host "gave up waiting for $what"
  return $false
}
function Page-Ups { return ([regex]::Matches((Log-Text), 'manager page up')).Count }
function Manager-Window { return [W]::FindByTitle($title) }
# What the owner does from Explorer or the Start menu: a second launch with no file.
function Launch-Again {
  $q = if ($Local) { Start-Process $pexe -ArgumentList (Own (Split-Path $pexe) $again) -PassThru } else { Start-Process $pexe -PassThru }
  [void]$q.Handle
  if (-not $q.WaitForExit(15000)) { $q.Kill(); throw 'the second launch did not exit' }
}
function Answer-Dialog($step, $button, $name) {
  $asked = Wait-For "dialog $step" { (Log-Text) -match "PROBE STEP dialog $step" } 40
  $h = 0
  for ($i = 0; $i -lt 60 -and -not $h; $i++) { Start-Sleep -Milliseconds 100; $h = [W]::Dialog([uint32]$m.Id) }
  Expect "manager.dialog_$step" ($asked -and $h -ne 0)
  if ($h) { Start-Sleep -Milliseconds 400; if ($button -eq 1) { Save-As $h $name } else { [W]::Press($h, $button) } }
}
function Measure-Now($label) {
  & (Join-Path $PSScriptRoot '..\scripts\measure.ps1') -Label $label -Seconds 3 | Tee-Object -Append (Join-Path $Out 'measure-manager.txt') | Write-Host
}

$m = Start-Process $pexe -ArgumentList ((Own $pbin $mdata) + @('--log', "`"$mlog`"", '--seconds', 120, '--no-manager') + (First-Buddy $App $mdata $tmp)) -PassThru
[void]$m.Handle
$t = [Diagnostics.Stopwatch]::StartNew()
Expect 'manager.hub_up' (Wait-For 'the hub' { (Log-Text) -match 'hub up: \d+ monitors, 1 in the library, 1 out' } 30)
Expect 'manager.none_at_start' ((Manager-Window) -eq 0) 'nothing opens by itself'
Start-Sleep -Seconds 5
Measure-Now 'no-manager'

Launch-Again
Expect 'manager.opens' (Wait-For 'the window' { (Manager-Window) -ne 0 } 15) "after $($t.ElapsedMilliseconds) ms"
Expect 'manager.page_up' (Wait-For 'the page' { (Page-Ups) -eq 1 } 15)
$f = [W]::Facts([uint32]$m.Id, $title)
Expect 'manager.undecorated' ($f.frameless -and -not $f.transparent -and -not $f.layered) $f.frame

Answer-Dialog 'cancel' 2
Answer-Dialog 'save' 1 'Pip.buddy'
$saved = $null
if (Wait-For 'export_saved' { (Log-Text) -match 'PROBE (PASS|FAIL) export_saved' } 15) { $saved = Saved-File 'Pip.buddy' }
$body = if ($saved) { Get-Content -Raw $saved } else { '' }
Expect 'manager.saved_file' ($body -match '"app":"desktop-buddies"' -and $body -match 'probe-pip') "$saved $($body.Length) characters"
if ($saved) { Remove-Item $saved }

Expect 'manager.closing' (Wait-For 'the mid-command close' { (Log-Text) -match 'PROBE closing mid-command' } 30)
Expect 'manager.closed' (Wait-For 'the window to go' { (Manager-Window) -eq 0 } 10) 'really closed, by the page, with a command in hand'
Start-Sleep -Seconds 3
Measure-Now 'closed-again'
Expect 'manager.finished_without_it' (Wait-For 'the import' { (Log-Text) -match 'imported as probe-late' } 10)

Launch-Again
Expect 'manager.reopens' (Wait-For 'a new page' { (Page-Ups) -eq 2 -and (Manager-Window) -ne 0 } 15)
Expect 'manager.phase_two' (Wait-For 'phase two' { (Log-Text) -match 'PROBE phase two done' } 15)
Measure-Now 'manager-open'

# Open, behind another window: a launch brings it forward, and doesn't open a second page.
$h = Manager-Window
$hold = Start-Process powershell -ArgumentList '-NoProfile', '-File', "`"$(Join-Path $PSScriptRoot 'testwin.ps1')`"", 'smoke-focus-holder', 20, 20, 200, 150 -PassThru -NoNewWindow
$held = 0
[void](Wait-For 'the other window' { $script:held = [W]::FindByTitle('smoke-focus-holder'); $script:held -ne 0 } 30)
if ($held) { [void][W]::Foreground($held); Start-Sleep -Milliseconds 500 }
$before = [W]::CurrentForeground()
Launch-Again
$focused = Wait-For 'the focus' { [W]::CurrentForeground() -eq $h } 5
Expect 'manager.focused' ($focused -and $before -ne $h) "foreground was $before, is $([W]::CurrentForeground()), window $h"
Start-Sleep -Milliseconds 800
Expect 'manager.one_page' ((Page-Ups) -eq 2 -and (Manager-Window) -eq $h) 'the same window, no second page'
if (-not $hold.HasExited) { $hold.Kill() }

# The page's own title bar, with the real mouse. It says how big a CSS pixel is here.
$dpr = if ((Log-Text) -match '"dpr":([\d.]+)') { [double]$Matches[1] } else { 1 }
function Bar-Point($fromRight) {
  $b = [W]::Bounds($h)
  return @([int]($b.x + $b.w - $fromRight * $dpr), [int]($b.y + 15 * $dpr))
}
[void][W]::Foreground($h)
Start-Sleep -Milliseconds 300
$before = [W]::Bounds($h)
$from = Bar-Point 300
[void][W]::MoveCursor($from[0], $from[1])
Start-Sleep -Milliseconds 200
[W]::Mouse(2)
for ($i = 1; $i -le 10; $i++) { [void][W]::MoveCursor($from[0] + 8 * $i, $from[1] + 6 * $i); Start-Sleep -Milliseconds 40 }
Start-Sleep -Milliseconds 200
[W]::Mouse(4)
Start-Sleep -Milliseconds 300
$after = [W]::Bounds($h)
Expect 'manager.drags_by_its_bar' ($after.x -gt $before.x -and $after.y -gt $before.y) "from $($before.x),$($before.y) to $($after.x),$($after.y)"

# Minimized by its own button. API 1's focus does nothing to it, so the hub opens a fresh one. API 2's
# restores it: the same window, and no new page.
[void][W]::Foreground($h)
Start-Sleep -Milliseconds 300
$at = Bar-Point 63
[void][W]::Click($at[0], $at[1], 2, 4)
Expect 'manager.minimize_button' (Wait-For 'it to minimize' { [W]::Iconic($h) } 5)
if (-not [W]::Iconic($h)) { [W]::Show($h, 6) }
Start-Sleep -Milliseconds 800
$iconic = [W]::Iconic($h)
Launch-Again
$pages = if ($script:api -ge 2) { 2 } else { 3 }
$back = Wait-For 'it to come back' { $w = Manager-Window; $w -ne 0 -and -not [W]::Iconic($w) -and (Page-Ups) -eq $pages } 15
Expect 'manager.minimized_returns' ($iconic -and $back) "was minimized: $iconic"
if ($script:api -ge 2) { Expect 'api2.manager_restored' ((Manager-Window) -eq $h) 'the same window' }

# Closed with the X, not by the page. The app stays up, and it can open again.
[W]::Close((Manager-Window))
Expect 'manager.x_closes' (Wait-For 'the window to go' { (Manager-Window) -eq 0 } 10)
Start-Sleep -Milliseconds 500
Expect 'manager.app_stays' (-not $m.HasExited)
Launch-Again
Expect 'manager.opens_after_x' (Wait-For 'a new page' { (Page-Ups) -eq $pages + 1 -and (Manager-Window) -ne 0 } 15)

# Closed by its own button, with the real mouse.
$h = Manager-Window
[void][W]::Foreground($h)
Start-Sleep -Milliseconds 300
$at = Bar-Point 21
[void][W]::Click($at[0], $at[1], 2, 4)
Expect 'manager.close_button' (Wait-For 'the window to go' { (Manager-Window) -eq 0 } 10)

$done = $m.WaitForExit(135000)
if (-not $done) { $m.Kill() }
Expect 'manager.exit' ($done -and $m.ExitCode -eq 0) "code $($m.ExitCode)"
$t = [Diagnostics.Stopwatch]::StartNew()
do {
  $left = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'desktop-buddies.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$tmp*") })
  if ($left.Count) { Start-Sleep -Milliseconds 500 }
} while ($left.Count -and $t.Elapsed.TotalSeconds -lt 15)
Expect 'manager.no_strays' ($left.Count -eq 0) "$($left.Count) left"

$mtext = Log-Text
foreach ($line in $mtext -split "`n") {
  if ($line -match 'PROBE (PASS|FAIL) (\S+) ?(.*)$') { Expect "probe.$($Matches[2])" ($Matches[1] -eq 'PASS') ($Matches[3].Trim().Substring(0, [Math]::Min(160, $Matches[3].Trim().Length))) }
}
foreach ($name in 'state', 'image', 'view', 'drag_region', 'fonts', 'cut_line', 'bake_ms', 'click_dismiss', 'click_call', 'menu', 'menu_offers', 'menu_closes', 'can', 'bring_here', 'treat', 'chase', 'bring_everyone', 'another', 'dismiss_one', 'dismiss_all', 'call', 'pause', 'hide', 'import', 'import_refused', 'failure_published', 'shimeji', 'shimeji_refused', 'export_cancelled', 'export_saved', 'delete', 'maker_hook', 'failures_cleared', 'after_close') {
  Expect "probe_ran.$name" ($mtext -match "PROBE (PASS|FAIL) $name\b")
}
foreach ($cmd in 'another', 'dismiss-one', 'dismiss', 'call', 'bring', 'act', 'pause', 'hide', 'import', 'report', 'export', 'delete', 'clear') {
  Expect "hub_heard.$cmd" ($mtext -match "(?m)\bmanager $cmd\b")
}
# Bring everyone here, from the tray event the probe sent: the overlay closed and came back, and the
# world still had her.
$at = $mtext.IndexOf('PROBE STEP bring everyone')
$after = if ($at -ge 0) { $mtext.Substring($at) } else { '' }
Expect 'bring.tray_heard' ($after -match 'brought 1 here, overlays reopened') (($after -split "`n" | Select-String 'brought|overlay 0' | Select-Object -First 6) -join ' | ')
Expect 'bring.overlay_closed' ($after -match 'overlay 0 closed')
Expect 'bring.overlay_back' ($after -match 'overlay 0 up' -and $after -match '\[0\] page up' -and $after -match 'joined overlay 0')
Expect 'bring.same_buddy' ($after -match '(?m)brought c[a-z0-9]+\s*$' -and $after -notmatch "isn't here")
# The two imports the probe gets refused on purpose are the only failures allowed here.
$bad = @($mtext -split "`n" | Where-Object { $_ -match '\b(error|rejected|hub error|failed)\b' -and $_ -notmatch 'PROBE ' -and $_ -notmatch 'import failed: (not a buddy file|a page couldn''t read a file)' })
Expect 'manager.no_errors' ($bad.Count -eq 0) (($bad | Select-Object -First 5) -join ' | ')
Expect 'manager.no_csp' ($mtext -notmatch 'manager error csp') 'nothing the page needed was refused'

# The probe deleted a buddy, so noSeed is in real settings. With the library emptied behind its back,
# the next run has to find that file through a real listing, read it, and seed nothing.
Get-ChildItem (Join-Path $mdata 'library') -Directory | Remove-Item -Recurse -Force
$elog = Join-Path $Out 'manager-empty.log'
$e = Start-Process $pexe -ArgumentList ((Own $pbin $mdata) + @('--log', "`"$elog`"", '--seconds', 8, '--no-manager')) -PassThru
[void]$e.Handle
$done = $e.WaitForExit(23000)
if (-not $done) { $e.Kill() }
$etext = if (Test-Path $elog) { Get-Content -Raw $elog } else { '' }
Expect 'empty.stays_empty' ($etext -match 'hub up: \d+ monitors, 0 in the library, 0 out' -and $etext -notmatch 'seeded') (($etext -split "`n" | Select-String 'hub up|seeded|not ready|damaged') -join ' | ')
Expect 'empty.settings_read' ($etext -notmatch 'not ready|damaged')
Expect 'empty.exit' ($done -and $e.ExitCode -eq 0) "code $($e.ExitCode)"

# The Maker. Its own copy of the app, with the probe standing in for maker.js and sitting beside
# manager.js to ask for the window through the hub's real command. Three runs of the exe on one data
# folder: what one saved, the next has to read. This does what a page can't: launch, answer the save
# dialogs, close the window with no warning, and look at the files.
$kbin = Join-Path $tmp 'maker-bin'
New-Item -ItemType Directory -Force $kbin | Out-Null
Copy-Item $Exe $kbin
Copy-Item $App (Join-Path $kbin 'app') -Recurse
Copy-Item (Join-Path (Split-Path $App) 'probe\maker-probe.js') (Join-Path $kbin 'app')
$page = Join-Path $kbin 'app\maker.html'
(Get-Content -Raw $page).Replace('<script src="maker.js"></script>', '<script src="maker-probe.js"></script>') | Set-Content -NoNewline $page
$page = Join-Path $kbin 'app\manager.html'
(Get-Content -Raw $page).Replace($tag, "$tag<script src=`"maker-probe.js`"></script>") | Set-Content -NoNewline $page
$pexe = Join-Path $kbin (Split-Path $Exe -Leaf)
$kdata = Join-Path $tmp 'maker-data'
$mlog = Join-Path $Out 'maker.log'
$again = $kdata

function Maker-Window { return [W]::FindByTitle('Desktop Buddies Maker') }
function Probed($what) { return ((Log-Text) -match "PROBE $what") }
function Start-Maker($limit) {
  $p = Start-Process $pexe -ArgumentList ((Own $kbin $kdata) + @('--log', "`"$mlog`"", '--seconds', $limit, '--no-manager') + (First-Buddy $App $kdata $tmp)) -PassThru
  [void]$p.Handle
  return $p
}
function End-Run($p, $label, $limit) {
  $done = $p.WaitForExit($limit * 1000)
  if (-not $done) { $p.Kill() }
  Expect "maker.$label.exit" ($done -and $p.ExitCode -eq 0) "code $($p.ExitCode)"
  $t = [Diagnostics.Stopwatch]::StartNew()
  do {
    $left = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'desktop-buddies.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$tmp*") })
    if ($left.Count) { Start-Sleep -Milliseconds 500 }
  } while ($left.Count -and $t.Elapsed.TotalSeconds -lt 15)
  Expect "maker.$label.no_strays" ($left.Count -eq 0) "$($left.Count) left"
}
function Answer-Save($p, $step, $name, $find) {
  $asked = Wait-For "dialog $step" { Probed "STEP dialog $step" } 180
  $h = 0
  for ($i = 0; $i -lt 100 -and -not $h; $i++) { Start-Sleep -Milliseconds 100; $h = [W]::Dialog([uint32]$p.Id) }
  Expect "maker.dialog_$step" ($asked -and $h -ne 0)
  if (-not $h) { return }
  Start-Sleep -Milliseconds 400
  if ($script:api -ge 2) { Expect "api2.dialog_${step}_owned" ([W]::Owner($h) -eq (Maker-Window)) "owner $([W]::Owner($h))" }
  Save-As $h $name
  $saved = $null
  [void](Wait-For "the file $name" { $script:saved = Saved-File $name; $script:saved -and (Test-Path $script:saved) } 15)
  $body = if ($script:saved) { Get-Content -Raw $script:saved } else { '' }
  Expect "maker.saved_$step" ($body -match $find) "$($script:saved) $($body.Length) characters"
  if ($script:saved) { Remove-Item $script:saved }
}

# The first run: opened, edited, tried on screen, saved over and over, exported, closed by the page.
$k = Start-Maker 420
Expect 'maker.hub_up' (Wait-For 'the hub' { (Log-Text) -match 'hub up: \d+ monitors, 1 in the library, 1 out' } 90)
Expect 'maker.none_at_start' ((Maker-Window) -eq 0) 'nothing opens by itself'
Launch-Again
Expect 'maker.opens' (Wait-For 'the window' { (Maker-Window) -ne 0 } 20)
Expect 'maker.page_up' (Wait-For 'the page' { (Log-Text) -match 'maker page up' } 20)
if (Maker-Window) {
  $f = [W]::Facts([uint32]$k.Id, 'Desktop Buddies Maker')
  Expect 'maker.undecorated' ($f.frameless -and -not $f.transparent -and -not $f.layered) $f.frame
}
Answer-Save $k 'buddy' 'Autosaved.buddy' '"app":"desktop-buddies"'
Answer-Save $k 'page' 'Autosaved.html' 'BuddyPlayer\.start'
Expect 'maker.closing' (Wait-For 'the close' { Probed 'STEP closing' } 60)
Expect 'maker.closed' (Wait-For 'the window to go' { (Maker-Window) -eq 0 } 20) 'by its own button, after the flush'
End-Run $k 'first' 30

# The second run: reads back what the close flushed, then a real minimize and a real Edit, then the
# driver closes the window on an edit that hasn't been saved, as Alt+F4 does. The page holds that
# close until the edit is on disk.
$k = Start-Maker 1500
Expect 'maker.second.hub_up' (Wait-For 'the hub' { ([regex]::Matches((Log-Text), 'hub up: ')).Count -ge 2 } 30)
Launch-Again
Expect 'maker.second.read_back' (Wait-For 'the read back' { Probed '(PASS|FAIL) read_back_after_restart' } 30)
Expect 'maker.second.minimized' (Wait-For 'the window back' { Probed '(PASS|FAIL) minimized_kept' } 30) "$(if ($script:api -ge 2) { 'restored' } else { 'flushed, closed and opened fresh' })"
Expect 'maker.second.hard_step' (Wait-For 'the edit' { Probed 'STEP hard close' } 30)
$h = Maker-Window
if ($h) { [W]::Close($h) }
Expect 'maker.hard_closed' (Wait-For 'the window to go' { (Maker-Window) -eq 0 -or (Probed '(PASS|FAIL) hard_close_kept') } 20)

# A page whose hub never answers, closed from outside. It stays, asks within the limit, and goes when told.
Expect 'maker.conflict.kept' (Wait-For 'the kept edit' { Probed '(PASS|FAIL) keep_as_new' } 60) 'the real view, its real button'
Expect 'maker.silent.step' (Wait-For 'the unheard edit' { Probed 'STEP silent close' } 90)
$h = Maker-Window
if ($h) { [W]::Close($h) }
Expect 'maker.silent.asked' (Wait-For 'the question' { Probed 'STEP silent asked' } 45)
Expect 'maker.silent.stayed' ((Maker-Window) -ne 0) 'it waited to be told'
Expect 'maker.silent.close_anyway' (Wait-For 'the window to go' { (Maker-Window) -eq 0 -or (Probed 'phase shaped') } 20) 'a working page always has a way out'

# A buddy the shape of the largest real one, and what she costs.
Expect 'maker.shaped' (Wait-For 'her saves' { Probed '(PASS|FAIL) shaped ' } 420)
Expect 'maker.shaped_back' (Wait-For 'her read back' { Probed '(PASS|FAIL) shaped_back' } 120)
# Five first saves of new buddies her shape, where the runner's stalls were. A stall fails, here or in
# her own saves above, and the hub's lines about slow saves are printed beside it.
Expect 'maker.shaped_firsts' (Wait-For 'her first saves' { Probed '(PASS|FAIL) shaped_firsts' } 800)
if ((Probed 'FAIL shaped_firsts') -or (Probed 'FAIL shaped ')) {
  (Log-Text) -split "`n" | Where-Object { $_ -match 'maker save of |library: a save took|PROBE (INFO shaped_first|FAIL shaped_firsts)' } | ForEach-Object { Write-Host "  trace: $($_.Trim())" }
}

# Still the second run: the largest allowed buddy, then the exe quits with a save of her in hand.
Expect 'maker.second.reopened' (Wait-For 'the reopen' { Probed '(PASS|FAIL) hard_close_kept' } 30)
Expect 'maker.second.largest' (Wait-For 'the largest' { Probed '(PASS|FAIL) largest' } 180)
Expect 'maker.second.quit_step' (Wait-For 'the quit' { Probed 'STEP quitting' } 60)
End-Run $k 'second' 30

# The third run: whatever the quit cut off, she's whole.
$k = Start-Maker 120
Expect 'maker.third.hub_up' (Wait-For 'the hub' { ([regex]::Matches((Log-Text), 'hub up: ')).Count -ge 3 } 30)
Launch-Again
Expect 'maker.third.checked' (Wait-For 'the check' { Probed '(PASS|FAIL) quit_then_tidied' } 60)
End-Run $k 'third' 30

$ktext = Log-Text
foreach ($line in $ktext -split "`n") {
  if ($line -match 'PROBE (PASS|FAIL) (\S+) ?(.*)$') { Expect "makerprobe.$($Matches[2])" ($Matches[1] -eq 'PASS') ($Matches[3].Trim().Substring(0, [Math]::Min(300, $Matches[3].Trim().Length))) }
}
foreach ($name in 'opens_through_the_hub', 'opened', 'holds_only_her', 'window_size', 'no_edit_no_write', 'autosave', 'rename_keeps_url', 'new_image_url', 'try_on_screen', 'stress', 'stress_who_is_out', 'stress_read_back', 'read_back_after_restart', 'minimized_kept', 'hard_close_kept', 'conflict_offers', 'keep_as_new', 'silent_asks', 'keep_editing', 'close_stops_input', 'shaped', 'shaped_back', 'shaped_firsts', 'largest', 'quit_left_her_whole', 'quit_left_nothing', 'quit_then_tidied') {
  Expect "makerprobe_ran.$name" ($ktext -match "PROBE (PASS|FAIL) $name\b")
}
foreach ($cmd in 'maker', 'maker-open', 'maker-save', 'maker-try', 'export', 'save-page') {
  Expect "maker.hub_heard.$cmd" ($ktext -match "(?m)\bmanager $cmd\b")
}
$bad = @($ktext -split "`n" | Where-Object { $_ -match '\b(error|rejected|hub error|failed)\b' -and $_ -notmatch 'PROBE ' })
Expect 'maker.no_errors' ($bad.Count -eq 0) (($bad | Select-Object -First 5) -join ' | ')
Expect 'maker.no_csp' ($ktext -notmatch 'maker error csp') 'nothing the page needed was refused'
Expect 'maker.no_names_in_log' ($ktext -notmatch 'class=|"exe":') ''

# The Recent links the save dialogs left, on a PC that keeps them.
if ($Local) {
  Get-ChildItem $recent -Filter *.lnk -ErrorAction SilentlyContinue | Where-Object { $hadRecent -notcontains $_.Name -and $_.Name -match '^(Pip\.buddy|Autosaved\.buddy|Autosaved\.html|saves)\.lnk$' } | ForEach-Object { Write-Host "removed Recent\$($_.Name)"; Remove-Item $_.FullName }
}
$results | Set-Content (Join-Path $Out 'smoke.txt')
$fail = @($results | Where-Object { $_ -like 'FAIL *' })
$summary = @("### Smoke run", "$($results.Count - $fail.Count) passed, $($fail.Count) failed", '') + ($fail | ForEach-Object { "- $_" })
$summary -join "`n" | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { $summary -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY }
if ($fail.Count) { exit 1 }
exit 0
