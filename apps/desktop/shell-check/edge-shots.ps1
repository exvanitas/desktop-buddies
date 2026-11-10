# The edge shots: each pose of a buddy's that meets a surface, on a real window and on the real
# screen floor, in the real exe, screenshotted and cropped for someone to judge by eye. Runs on the
# Actions Windows runner only, by hand, with files that never enter the repo. It judges nothing about
# the poses: it checks the capture can see an overlay at all, and lays out what it saw.
# -Local is for a real PC: the wallpaper, the desktop colour and every other window are left alone.
# A plain window of the desktop colour covers the primary work area instead, and the full shots keep
# only the primary monitor. A window a background process opens can come up under the one in front,
# so the backdrop and the surface are raised over the other ordinary windows, and nothing is shot
# while another app's window is over them: it would hide the surface from the terrain, and show.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [Parameter(Mandatory)][string]$Probe,
  # holds <variant>.buddy for each variant. Each is moved into its run's data folder, not copied.
  [Parameter(Mandatory)][string]$In,
  [string[]]$Variants = @('original', 'fixed'),
  [string]$Out = 'shots',
  [switch]$Local,
  [string]$Temp = [IO.Path]::GetTempPath()
)
if ($Local -and -not $PSBoundParameters.ContainsKey('Temp')) { throw '-Local needs -Temp' }
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'win32.ps1')
. (Join-Path $PSScriptRoot 'pixels.ps1')
$Exe = (Resolve-Path $Exe).Path
$App = (Resolve-Path $App).Path
$Probe = (Resolve-Path $Probe).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path

$results = [System.Collections.Generic.List[string]]::new()
function Expect($name, $ok, $detail = '') {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) $name $detail"
  $results.Add($line); Write-Host $line
}
function Note($line) { $results.Add("INFO $line"); Write-Host "INFO $line" }
function Log-Text($path) {
  if (-not (Test-Path $path)) { return '' }
  $s = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite,Delete')
  try { return [IO.StreamReader]::new($s).ReadToEnd() } finally { $s.Close() }
}
function Wait-For($what, [scriptblock]$test, $seconds = 20) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  do { if (& $test) { return $true }; Start-Sleep -Milliseconds 100 } while ($t.Elapsed.TotalSeconds -lt $seconds)
  Write-Host "gave up waiting for $what"
  return $false
}

# The scene: a plain desktop, and a pale window that contrasts with red hair and dark clothes.
$DESK = 79, 154, 106
$PALE = '#D2F0F5'
$screen = [Px]::Screen()
$work = [W]::WorkArea()
$backdrop = $null
if ($Local) {
  $deskHex = '#{0:X2}{1:X2}{2:X2}' -f $DESK[0], $DESK[1], $DESK[2]
  $backdrop = Start-Process powershell -ArgumentList '-NoProfile', '-File', "`"$(Join-Path $PSScriptRoot 'edge-window.ps1')`"", 'edge-backdrop', $work.L, $work.T, ($work.R - $work.L), ($work.B - $work.T), $deskHex -PassThru -NoNewWindow
  Expect 'scene.backdrop' (Wait-For 'the backdrop' { [W]::FindByTitle('edge-backdrop') -ne 0 } 30)
} else {
  [Px]::Desktop($DESK[0], $DESK[1], $DESK[2])
  # The runner's own console goes down, so it's neither terrain nor background.
  (New-Object -ComObject Shell.Application).MinimizeAll()
}
Start-Sleep -Seconds 2
$ww = [int](($work.R - $work.L) * 0.4); $wh = [int](($work.B - $work.T) * 0.4)
$wx = $work.L + [int](($work.R - $work.L) * 0.3); $wy = $work.T + [int](($work.B - $work.T) * 0.32)
Note "screen $($screen -join ',') work $($work.L),$($work.T),$($work.R),$($work.B)"
$form = Start-Process powershell -ArgumentList '-NoProfile', '-File', "`"$(Join-Path $PSScriptRoot 'edge-window.ps1')`"", 'edge-surface', $wx, $wy, $ww, $wh, $PALE -PassThru -NoNewWindow
$surface = 0
[void](Wait-For 'the window' { $script:surface = [W]::FindByTitle('edge-surface'); $script:surface -ne 0 } 30)
Start-Sleep -Milliseconds 500
$b = if ($surface) { [W]::Bounds($surface) } else { @{ x = 0; y = 0; w = 0; h = 0 } }
$rect = "$($b.x),$($b.y),$($b.w),$($b.h)"
Expect 'scene.window' ($b.x -eq $wx -and $b.y -eq $wy -and $b.w -eq $ww -and $b.h -eq $wh) "asked $wx,$wy,$ww,$wh got $rect"
# Local: nothing of another app's over the backdrop, raising ours once more if there is.
$over = ''
function On-Top([uint32[]]$more = @()) {
  if (-not $Local) { return $true }
  $ours = [uint32[]](@([uint32]$backdrop.Id, [uint32]$form.Id) + $more)
  $back = [W]::FindByTitle('edge-backdrop')
  $o = @([W]::Above($back, $ours, $work.L, $work.T, $work.R, $work.B))
  if ($o.Count) {
    [W]::Raise($back); [W]::Raise($surface); Start-Sleep -Milliseconds 400
    $o = @([W]::Above($back, $ours, $work.L, $work.T, $work.R, $work.B))
  }
  $script:over = $o -join ', '
  return $o.Count -eq 0
}
if ($Local) {
  [W]::Raise([W]::FindByTitle('edge-backdrop')); [W]::Raise($surface); Start-Sleep -Milliseconds 500
  $top = On-Top
  Expect 'scene.on_top' $top "$(if ($top) { 'nothing over the backdrop' } else { "over it: $over" })"
  if (-not $top) {
    if (-not $form.HasExited) { $form.Kill() }
    if (-not $backdrop.HasExited) { $backdrop.Kill() }
    $results | Set-Content (Join-Path $Out 'results.txt')
    Write-Host 'stopped before any shot: another window is over the scene'
    exit 1
  }
}
# Off to a corner, where Watch cursor looks right and nothing is under it.
[void][W]::MoveCursor($work.R - 4, $work.T + 4)
[Px]::Shot((Join-Path $Out 'scene.png'))

$runs = @{}
foreach ($v in $Variants) {
  $src = Join-Path $In "$v.buddy"
  if (-not (Test-Path $src)) { Expect "$v.file" $false 'not there'; continue }
  $vo = Join-Path $Out $v
  New-Item -ItemType Directory -Force (Join-Path $vo 'full'), (Join-Path $vo 'crops') | Out-Null

  # Its own copy of the app: the probe world in place of world.js, and the page probe in the hub.
  $tmp = Join-Path $Temp ("edge-" + [guid]::NewGuid().ToString('n').Substring(0, 8))
  $bin = Join-Path $tmp 'bin'
  New-Item -ItemType Directory -Force $bin | Out-Null
  Copy-Item $Exe $bin
  Copy-Item $App (Join-Path $bin 'app') -Recurse
  Copy-Item (Join-Path $Probe 'world-probe.js') (Join-Path $bin 'app\world.js') -Force
  Copy-Item (Join-Path $Probe 'edge-probe.js') (Join-Path $bin 'app')
  $page = Join-Path $bin 'app\hub.html'
  $tag = '<script src="hub.js"></script>'
  (Get-Content -Raw $page).Replace($tag, "$tag<script src=`"edge-probe.js`"></script>") | Set-Content -NoNewline $page
  $runExe = Join-Path $bin (Split-Path $Exe -Leaf)
  $data = Join-Path $tmp 'data'
  New-Item -ItemType Directory -Force (Join-Path $data 'probe-in') | Out-Null
  Move-Item $src (Join-Path $data 'probe-in\buddy.buddy')
  $log = Join-Path $tmp 'app.log'
  $ack = Join-Path $data 'probe-ack.txt'

  $own = if ($Local) { @('--app-dir', "`"$(Join-Path $bin 'app')`"") } else { @() }
  $p = Start-Process $runExe -ArgumentList (@('--data-dir', "`"$data`"", '--log', "`"$log`"", '--seconds', 900, '--edge-window', $rect, '--no-manager') + $own) -PassThru
  [void]$p.Handle
  $shots = [System.Collections.Generic.List[object]]::new()
  $seen = @{}
  $t = [Diagnostics.Stopwatch]::StartNew()
  # A probe that stopped saying anything has stopped: two minutes, not the exe's fifteen.
  $size = 0; $quiet = [Diagnostics.Stopwatch]::StartNew()
  while (-not $p.HasExited -and $t.Elapsed.TotalSeconds -lt 840 -and $quiet.Elapsed.TotalSeconds -lt 120) {
    $now = Log-Text $log
    $said = ([regex]::Matches($now, 'PROBE ')).Count
    if ($said -ne $size) { $size = $said; $quiet.Restart() }
    foreach ($m in [regex]::Matches($now, 'PROBE STEP shot (\d+) (\S+) (\{.*\})\r?\n')) {
      $n = [int]$m.Groups[1].Value
      if ($seen[$n]) { continue }
      $seen[$n] = $true
      $name = $m.Groups[2].Value
      $file = Join-Path $vo ('full\{0:d3}-{1}.png' -f $n, $name)
      if (-not (On-Top @([uint32]$p.Id))) {
        Expect "$v.shot_$n" $false "not shot, over the scene: $over"
        Set-Content -NoNewline -Path $ack -Value "$n"
        continue
      }
      $at = $t.ElapsedMilliseconds
      [Px]::Shot($file)
      $extra = @{}
      if ($name -like 'control.*' -and $name -ne 'control.hidden') {
        $o = @([Px]::Topmost([uint32]$p.Id))[0]
        if ($o) { $extra.overlay = [W]::Bounds($o); $extra.printed = [Px]::Window($o, (Join-Path $vo 'control-printwindow.png')) }
      }
      $shots.Add([pscustomobject]@{ n = $n; name = $name; file = $file; numbers = ($m.Groups[3].Value | ConvertFrom-Json); ms = $t.ElapsedMilliseconds - $at; extra = $extra })
      Set-Content -NoNewline -Path $ack -Value "$n"
    }
    Start-Sleep -Milliseconds 100
  }
  $done = $p.WaitForExit(60000)
  if (-not $done) { $p.Kill() }
  Expect "$v.exit" ($done -and $p.ExitCode -eq 0) "code $($p.ExitCode) after $([int]$t.Elapsed.TotalSeconds) s"
  $t2 = [Diagnostics.Stopwatch]::StartNew()
  do {
    $left = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'desktop-buddies.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$tmp*") })
    if ($left.Count) { Start-Sleep -Milliseconds 500 }
  } while ($left.Count -and $t2.Elapsed.TotalSeconds -lt 15)
  Expect "$v.no_strays" ($left.Count -eq 0) "$($left.Count) left"

  # Her name and id stay out of what's kept: the hub logs ids, and those come from her file.
  $text = Log-Text $log
  $seed = if ($text -match 'library seeded with (\S+)') { $Matches[1] } else { '' }
  $hide = @()
  foreach ($d in @(Get-ChildItem (Join-Path $data 'library') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '.*' -and $_.Name -ne $seed })) {
    $hide += $d.Name
    $j = Get-Content -Raw (Join-Path $d.FullName 'buddy.json') -ErrorAction SilentlyContinue | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($j) { $hide += "$($j.name)"; $hide += "$($j.character)" }
  }
  foreach ($h in @($hide | Where-Object { $_.Length -ge 2 } | Sort-Object Length -Descending -Unique)) { $text = [regex]::Replace($text, [regex]::Escape($h), '<buddy>', 'IgnoreCase') }
  $text | Set-Content -NoNewline (Join-Path $vo 'app.log')
  Note "$v hid $(@($hide | Where-Object { $_.Length -ge 2 } | Select-Object -Unique).Count) names from the log"
  foreach ($line in $text -split "`n") { if ($line -match 'PROBE (FAIL|monitors|system|scene|art|gave up)') { Note "$v $($line.Trim())" } }
  Expect "$v.probe_done" ($text -match 'PROBE STEP done')
  Expect "$v.probe_no_fails" ($text -notmatch 'PROBE FAIL')
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

  # Crops, and what changed against the shot with buddies hidden.
  $base = ($shots | Where-Object name -eq 'control.hidden' | Select-Object -First 1).file
  Expect "$v.baseline" ($null -ne $base)
  $rows = [System.Collections.Generic.List[object]]::new()
  foreach ($s in $shots) {
    if ($s.name -eq 'control.hidden') { continue }
    $c = $s.numbers.crop; $line = $s.numbers.surface.at
    $crop = Join-Path $vo ('crops\{0:d3}-{1}.png' -f $s.n, $s.name)
    [Px]::Crop($s.file, $c.x - $screen[0], $c.y - $screen[1], $c.w, $c.h, 2, $crop)
    $d = if ($base) { [Px]::Diff($s.file, $base, $c.x - $screen[0], $c.y - $screen[1], $c.w, $c.h, 32) } else { @(0, -1, -1, -1, -1) }
    $wall = $s.numbers.surface.kind -eq 'wall'
    $mark = if ($wall) { 'v,{0}' -f [int](($line - $c.x) * 2) } else { 'h,{0}' -f [int](($line - $c.y) * 2) }
    $rows.Add([pscustomobject]@{
      n = $s.n; name = $s.name; crop = $crop; mark = $mark; capture_ms = $s.ms
      kind = $s.numbers.surface.kind; line = $line; shows = $s.numbers.shows; box = $s.numbers.box; union = $s.numbers.union; anchor = $s.numbers.anchor
      changed = [pscustomobject]@{ pixels = $d[0]; x0 = $d[1] + $screen[0]; y0 = $d[2] + $screen[1]; x1 = $d[3] + $screen[0]; y1 = $d[4] + $screen[1] }
      numbers = $s.numbers
    })
  }
  $rows | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $vo 'shots.json')
  $runs[$v] = $rows

  # The control: the seed buddy on the floor. Her pixels have to differ from the hidden shot, or the capture can't see overlays.
  $ctl = $shots | Where-Object { $_.name -like 'control.*' -and $_.name -ne 'control.hidden' } | Select-Object -First 1
  if ($ctl -and $base) {
    $bx = $ctl.numbers.box
    $d = [Px]::Diff($ctl.file, $base, [int]$bx.x0 - $screen[0], [int]$bx.y0 - $screen[1], [int]($bx.x1 - $bx.x0), [int]($bx.y1 - $bx.y0), 32)
    Expect "$v.capture_sees_overlay" ($d[0] -gt 100) "$($d[0]) pixels in her box differ from the hidden shot"
    if ($ctl.extra.overlay) {
      $o = $ctl.extra.overlay
      $solid = [Px]::Solid((Join-Path $vo 'control-printwindow.png'), [int]$bx.x0 - $o.x, [int]$bx.y0 - $o.y, [int]($bx.x1 - $bx.x0), [int]($bx.y1 - $bx.y0))
      Note "$v PrintWindow on the overlay returned $($ctl.extra.printed), $solid solid pixels in her box"
    }
  } else { Expect "$v.capture_sees_overlay" $false 'no control shot' }
}
if ($form -and -not $form.HasExited) { $form.Kill() }
if ($backdrop -and -not $backdrop.HasExited) { $backdrop.Kill() }

# One sheet: a row a shot, a column a file, the surface line ticked in red outside each crop.
$names = [System.Collections.Generic.List[string]]::new()
foreach ($v in $Variants) { foreach ($r in @($runs[$v])) { if ($r -and -not $names.Contains($r.name)) { $names.Add($r.name) } } }
$cells = @(); $marks = @()
foreach ($name in $names) {
  foreach ($v in $Variants) {
    $r = @($runs[$v]) | Where-Object { $_ -and $_.name -eq $name } | Select-Object -First 1
    $cells += if ($r) { $r.crop } else { '' }
    $marks += if ($r) { $r.mark } else { '' }
  }
}
if ($names.Count) { [Px]::Sheet((Join-Path $Out 'contact-sheet.png'), [string[]]$Variants, [string[]]$names, [string[]]$cells, [string[]]$marks) }
Expect 'sheet' ($names.Count -gt 0) "$($names.Count) rows"

# The numbers beside the pixels: the surface line, the drawn frame's own box, and what changed on screen.
$tsv = @("variant`tn`tshot`tsurface`tline`tshows`tbox_x0`tbox_y0`tbox_x1`tbox_y1`tchanged_px`tchanged_x0`tchanged_y0`tchanged_x1`tchanged_y1`tcrop")
foreach ($v in $Variants) {
  foreach ($r in @($runs[$v])) {
    if (-not $r) { continue }
    $sh = if ($r.shows) { "$($r.shows.pose)[$($r.shows.frame)/$($r.shows.frames)]" } else { '?' }
    $tsv += "$v`t$($r.n)`t$($r.name)`t$($r.kind)`t$($r.line)`t$sh`t{0:F1}`t{1:F1}`t{2:F1}`t{3:F1}`t$($r.changed.pixels)`t$($r.changed.x0)`t$($r.changed.y0)`t$($r.changed.x1)`t$($r.changed.y1)`t$(Split-Path $r.crop -Leaf)" -f $r.box.x0, $r.box.y0, $r.box.x1, $r.box.y1
  }
}
$tsv | Set-Content (Join-Path $Out 'shots.tsv')

# Whatever else is on a real PC's other monitors stays out of what's kept.
if ($Local) {
  $pm = [Px]::Primary()
  foreach ($f in @(Get-ChildItem $Out -Recurse -Filter *.png | Where-Object { $_.Name -eq 'scene.png' -or $_.Directory.Name -eq 'full' })) {
    [Px]::Crop($f.FullName, -$screen[0], -$screen[1], $pm[0], $pm[1], 1, $f.FullName)
  }
}

$results | Set-Content (Join-Path $Out 'results.txt')
$fail = @($results | Where-Object { $_ -like 'FAIL *' })
$summary = @('### Edge shots', "$(@($results | Where-Object { $_ -like 'PASS *' }).Count) passed, $($fail.Count) failed", '') + ($fail | ForEach-Object { "- $_" })
$summary -join "`n" | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { $summary -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY }
if ($fail.Count) { exit 1 }
exit 0
