# Does a held buddy stop a Chromium app under her from painting? While she's held her overlay takes the
# mouse, so it loses WS_EX_TRANSPARENT, and Chromium's occlusion tracker counts a window like that as
# covering what's under it unless it's a tool window (docs/native-shell-design.md, "Capture stays as it
# is"). The exe keeps its overlays tool windows for that. This proves it with Microsoft Edge.
#
# Edge runs with a throwaway profile and shows a local page that puts its visibility, its animation
# frames and its longest gap between frames in its title, read here by the window's title: no server,
# no port, no driver. Then, with the real mouse:
#   baseline  nothing over the page, for its normal frame rate
#   control   a plain opaque topmost window over it, which Chromium must see as covering it. If it
#             doesn't, this runner can't show occlusion at all and the held case isn't judged.
#   hold      she's pressed, carried onto the page and held there a few seconds, then let go
# PASS when the page keeps painting at its normal rate while she's held. Runs on the Actions Windows
# runner, or a real PC with no Edge of its own open.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [string]$Out = 'results',
  [string]$Browser = ''
)
$ErrorActionPreference = 'Stop'
# An error's message and where it was thrown. -File drops the line from the console's own report.
function Error-Line($e) {
  $i = $e.InvocationInfo
  $where = if ($i -and $i.ScriptLineNumber) { " at line $($i.ScriptLineNumber)$(if ($i.ScriptName -and $i.ScriptName -ne $PSCommandPath) { ' of ' + [IO.Path]::GetFileName($i.ScriptName) })" } else { ' at an unknown line' }
  return "$($e.Exception.Message)$where"
}
# An error outside the run's try stops it: said with its line, and kept in held-paint.txt once -Out is made.
trap {
  $msg = "FAIL run.error $(Error-Line $_)"
  Write-Host $msg; Write-Host $_.ScriptStackTrace
  try { if ($null -ne $results) { $results.Add($msg); if ($Out -and (Test-Path -LiteralPath $Out -PathType Container)) { $results | Set-Content -LiteralPath (Join-Path $Out 'held-paint.txt') } } } catch { Write-Host "could not save: $($_.Exception.Message)" }
  break
}
. (Join-Path $PSScriptRoot 'win32.ps1')
. (Join-Path $PSScriptRoot 'hunt.ps1')
. (Join-Path $PSScriptRoot 'first-buddy.ps1')
$Exe = (Resolve-Path $Exe).Path
$App = (Resolve-Path $App).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path

$results = [System.Collections.Generic.List[string]]::new()
function Expect($name, $ok, $detail = '') {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) $name $detail"
  $results.Add($line); Write-Host $line
}
function Report($name, $detail) {
  $line = "INFO $name $detail"
  $results.Add($line); Write-Host $line
}
# Each cleanup step on its own, so its error is noted and never hides the run's.
function Tidy($what, [scriptblock]$step) {
  try { . $step } catch { Expect "cleanup.$what" $false (Error-Line $_) }
}

# How long each part runs, in ms. The whole check takes about a minute.
$SETTLE = 2000; $BASELINE = 5000; $CONTROL = 5000; $RECOVER = 4000; $HOLD = 6000; $AFTER = 3000
# The carry onto the page: this many steps 40 ms apart.
$CARRY = 15
$TITLE = '^heldpaint (\w+) hid=(\d+) frames=(\d+) gap=(\d+) since=(\d+) t=(\d+)'

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("held-paint-" + [guid]::NewGuid().ToString('n').Substring(0, 8))
$bin = Join-Path $tmp 'bin'
$data = Join-Path $tmp 'data'
$userData = Join-Path $tmp 'browser'
$page = Join-Path $tmp 'page.html'
$log = Join-Path $Out 'held-paint.log'
# not $exe: names ignore case, so that would be -Exe
$runExe = Join-Path $bin (Split-Path $Exe -Leaf)

# What the cleanup reads. Each stays empty until the step that makes it.
$run = $null; $edge = $null; $cover = $null; $hwnd = 0; $down = $false; $back = $null
$samples = [System.Collections.Generic.List[object]]::new()
$clock = [Diagnostics.Stopwatch]::StartNew()
$cx = 0; $cy = 0; $box = $null; $a = $null

# This run's own processes: the exe, and whatever runs on its own folder, as its WebView2 and the
# browser with its profile there do. Never every copy of the exe or every Edge on the machine.
function Own-Processes {
  return @(Get-CimInstance Win32_Process | Where-Object { ($run -and $_.ProcessId -eq $run.Id) -or ($edge -and $_.ProcessId -eq $edge.Id) -or ($_.CommandLine -and $_.CommandLine.Contains($tmp)) })
}
# The browser's, of those.
function Browser-Pids {
  $name = Split-Path $Browser -Leaf
  return [uint32[]]@(Own-Processes | Where-Object { $_.Name -eq $name } | ForEach-Object { [uint32]$_.ProcessId })
}
# Stops them by their own ids, waiting a bounded while for them to go.
function Stop-Own {
  Own-Processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $w = [Diagnostics.Stopwatch]::StartNew()
  while ((Own-Processes).Count -and $w.Elapsed.TotalSeconds -lt 10) { Start-Sleep -Milliseconds 250 }
}
function Wait-For($what, [scriptblock]$test, $seconds) {
  $w = [Diagnostics.Stopwatch]::StartNew()
  do { if (& $test) { return $true }; Start-Sleep -Milliseconds 250 } while ($w.Elapsed.TotalSeconds -lt $seconds)
  Write-Host "gave up waiting for $what"
  return $false
}

# One look at the page and at her overlay: the page's title, whether the mouse would land on the exe at
# the page's middle, and the extended styles of the exe's windows over the whole page.
function Sample($phase) {
  $said = if ($hwnd) { [W]::TitleOf($hwnd) } else { '' }
  $m = [regex]::Match($said, $TITLE)
  $styles = if ($run -and $box) { @([W]::ExStylesOver([uint32]$run.Id, $box.x, $box.y, $box.x + $box.w, $box.y + $box.h)) } else { @() }
  $samples.Add([pscustomobject]@{
    phase = $phase; ms = $clock.ElapsedMilliseconds; ok = $m.Success
    vis = $m.Groups[1].Value; hid = [int]('0' + $m.Groups[2].Value); frames = [int]('0' + $m.Groups[3].Value)
    gap = [int]('0' + $m.Groups[4].Value); since = [int]('0' + $m.Groups[5].Value); t = [int64]('0' + $m.Groups[6].Value)
    captured = [bool]($run -and $cx -and [W]::Lands($cx, $cy, [uint32]$run.Id))
    styles = @($styles | ForEach-Object { '0x{0:x}' -f $_ })
  })
}
# Samples every 100 ms for $ms, doing $each first each time with the ms gone so far.
function Pump($phase, $ms, [scriptblock]$each = $null) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $ms) { if ($each) { & $each $sw.ElapsedMilliseconds }; Sample $phase; Start-Sleep -Milliseconds 100 }
}
function Park { [void][W]::MoveCursor($cx, $cy) }

try {
  if (-not $Browser) {
    $Browser = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  }
  Expect 'held_paint.browser' ([bool]$Browser) "$(if ($Browser) { Split-Path $Browser -Leaf } else { 'no Edge on this machine' })"
  if (-not $Browser) { throw 'no Edge to run the check in' }

  New-Item -ItemType Directory -Force $bin, $data, $userData | Out-Null
  Copy-Item $Exe $bin
  Copy-Item $App (Join-Path $bin 'app') -Recurse
  # The page: a bar that moves on every animation frame, and its visibility, its frames, the longest gap
  # between frames in the last second and the time since the last one in its title, ten times a second
  # and whenever it's hidden or shown. A hidden page's timers still run, about once a second.
  @'
<!doctype html><html><head><meta charset="utf-8"><title>heldpaint starting</title>
<style>html,body{margin:0;height:100%;background:#2b5d8a;color:#fff;font:20px sans-serif}p{margin:20px}</style></head>
<body><p>Desktop Buddies paint check. It closes by itself.</p><canvas id="c" width="400" height="24"></canvas>
<script>
let frames = 0, last = performance.now(), hid = 0, vis = document.visibilityState;
const times = [], c = document.getElementById('c').getContext('2d');
document.addEventListener('visibilitychange', () => { vis = document.visibilityState; if (vis === 'hidden') hid++; put(); });
function frame(t) {
  frames++; last = t; times.push(t);
  while (times.length && t - times[0] > 1000) times.shift();
  c.clearRect(0, 0, 400, 24); c.fillStyle = '#fff'; c.fillRect(frames % 380, 0, 20, 24);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
function gap() { let g = 0; for (let i = 1; i < times.length; i++) g = Math.max(g, times[i] - times[i - 1]); return Math.round(g); }
function put() { const now = performance.now(); document.title = 'heldpaint ' + vis + ' hid=' + hid + ' frames=' + frames + ' gap=' + gap() + ' since=' + Math.round(now - last) + ' t=' + Math.round(now); }
setInterval(put, 100);
</script></body></html>
'@ | Set-Content -Encoding UTF8 -LiteralPath $page

  # The logger appends, so an earlier run's lines would read as this one's.
  Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
  $back = [W]::CursorAt()
  # The exe on a fresh data folder, so she comes out, with --trace-hits, so the overlay says where she is.
  $run = Start-Process $runExe -ArgumentList (@('--data-dir', "`"$data`"", '--log', "`"$log`"", '--seconds', 150, '--no-manager', '--trace-hits') + (First-Buddy $App $data $tmp)) -PassThru
  [void]$run.Handle # or ExitCode comes back empty
  Expect 'held_paint.buddy_out' (Wait-For 'her first aim' { Last-Aim $log } 40)

  # Edge, ours alone: a throwaway profile under this run's folder, so a process apart from any other
  # Edge, in the middle of the work area. Nothing here turns its occlusion tracking off.
  $work = [W]::WorkArea()
  $bw = [Math]::Min(640, $work.R - $work.L - 200); $bh = [Math]::Min(420, $work.B - $work.T - 200)
  $bx = $work.L + [int](($work.R - $work.L - $bw) / 2); $by = $work.T + [int](($work.B - $work.T - $bh) / 2)
  $url = ([Uri]$page).AbsoluteUri
  $edge = Start-Process $Browser -ArgumentList @("--user-data-dir=`"$userData`"", '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions', '--disable-default-apps', '--disable-component-update', '--disable-background-networking', "--window-position=$bx,$by", "--window-size=$bw,$bh", "--app=$url") -PassThru
  [void](Wait-For 'the page' { $script:hwnd = [W]::FindTitled([uint32[]]@(Browser-Pids), 'heldpaint '); $script:hwnd -ne 0 } 40)
  Expect 'held_paint.page_up' ($hwnd -ne 0)
  if (-not $hwnd) { throw 'the browser never showed the page' }
  # It can come up under the window in front. Over every other ordinary window, under the overlays.
  $ours = [uint32[]](@(Browser-Pids) + @([uint32]$run.Id))
  [W]::Raise($hwnd); Start-Sleep -Milliseconds 500
  $box = [W]::Bounds($hwnd)
  $over = @([W]::Above($hwnd, $ours, $box.x, $box.y, $box.x + $box.w, $box.y + $box.h))
  if ($over.Count) { [W]::Raise($hwnd); Start-Sleep -Milliseconds 500; $over = @([W]::Above($hwnd, $ours, $box.x, $box.y, $box.x + $box.w, $box.y + $box.h)) }
  Expect 'held_paint.page_clear' ($over.Count -eq 0) "page at $($box.x),$($box.y) $($box.w)x$($box.h)$(if ($over.Count) { ', under ' + ($over -join ', ') })"
  if ($over.Count) { throw 'another window is over the page' }
  $cx = $box.x + [int]($box.w / 2); $cy = $box.y + [int]($box.h / 2)

  Park
  Pump 'settle' $SETTLE
  Pump 'baseline' $BASELINE { Park }

  # The control: a plain window, opaque, not a tool window, over the whole page and above every other
  # always-on-top window.
  $cover = Start-Process powershell -ArgumentList '-NoProfile', '-File', "`"$(Join-Path $PSScriptRoot 'edge-window.ps1')`"", 'held-paint-cover', ($box.x - 20), ($box.y - 20), ($box.w + 40), ($box.h + 40), '#808080' -PassThru -NoNewWindow
  $coverHwnd = 0
  [void](Wait-For 'the cover' { $script:coverHwnd = [W]::FindByTitle('held-paint-cover'); $script:coverHwnd -ne 0 } 30)
  Expect 'held_paint.cover_up' ($coverHwnd -ne 0)
  if ($coverHwnd) {
    [W]::OnTop($coverHwnd)
    Pump 'control' $CONTROL { Park }
    [W]::Close($coverHwnd)
    [void](Wait-For 'the cover to go' { $cover.HasExited } 10)
  }
  Pump 'recover' $RECOVER { Park }

  # The hold: found with the real cursor, which hovers over her first, as a hand does.
  Sample 'hunt'
  $a = Find-Her $log ([uint32]$run.Id)
  Sample 'hunt'
  Expect 'held_paint.found_her' ($null -ne $a) "$(if ($a) { "at $($a.x),$($a.y)" })"
  if ($a) {
    $from = $a
    [W]::Mouse(2); $down = $true
    # Carried onto the page, then held there, still but for a small wiggle.
    Pump 'hold' $HOLD {
      param($ms)
      $k = [Math]::Min($CARRY, [int]($ms / 40) + 1)
      if ($k -lt $CARRY) { [void][W]::MoveCursor([int]($from.x + ($cx - $from.x) * $k / $CARRY), [int]($from.y + ($cy - $from.y) * $k / $CARRY)) }
      else { [void][W]::MoveCursor($cx + [int](6 * [Math]::Sin($ms / 300)), $cy) }
    }
    [W]::Mouse(4); $down = $false
    Park
    Pump 'after' $AFTER { Park }
  }
} catch {
  Expect 'held_paint.run' $false (Error-Line $_)
  Write-Host $_.ScriptStackTrace
} finally {
  Tidy 'mouse' { if ($down) { [W]::Mouse(4) } }
  Tidy 'cursor' { if ($back) { [void][W]::MoveCursor($back.X, $back.Y) } }
  Tidy 'cover' { if ($cover -and -not $cover.HasExited) { Stop-Process -Id $cover.Id -Force } }
  Tidy 'browser' { if ($hwnd -and [W]::Alive($hwnd)) { [W]::Close($hwnd); [void](Wait-For 'the browser to close' { -not @(Browser-Pids).Count } 10) } }
  Tidy 'processes' { Stop-Own }
  Tidy 'left' { $left = @(Own-Processes); Expect 'held_paint.no_strays' ($left.Count -eq 0) "$($left.Count) left" }
}

# ---------- the verdicts, from the samples
# Per phase: how many samples showed the page hidden, how many times it went hidden (the page counts
# every visibilitychange, so a hide shorter than a sample counts too), its frame rate by the page's own
# clock, and the longest it went without a frame. The rolling gap reaches back a second, so a phase's
# first second counts only by `since`. Plus, for the hold, how often her overlay had the mouse.
function Stats($name) {
  $all = @($samples | Where-Object { $_.phase -eq $name })
  $s = @($all | Where-Object ok)
  if (-not $s.Count) { return $null }
  $start = $all[0].ms
  $before = @($samples | Where-Object { $_.ok -and $_.ms -lt $start } | Select-Object -Last 1)
  $hid0 = if ($before.Count) { $before[0].hid } else { $s[0].hid }
  $span = ($s[-1].t - $s[0].t) / 1000
  $longest = ($s | ForEach-Object { if ($_.ms - $start -ge 1000) { [Math]::Max($_.gap, $_.since) } else { $_.since } } | Measure-Object -Maximum).Maximum
  $styled = @($all | Where-Object { $_.styles.Count })
  return [pscustomobject]@{
    samples = $s.Count; hidden = @($s | Where-Object { $_.vis -ne 'visible' }).Count; went_hidden = $s[-1].hid - $hid0
    fps = if ($span -gt 0) { [Math]::Round(($s[-1].frames - $s[0].frames) / $span, 1) } else { 0 }
    longest = [int]$longest; last_vis = $s[-1].vis; last_since = $s[-1].since
    captured = @($all | Where-Object captured).Count; all = $all.Count
    styled = $styled.Count
    # samples where an overlay over the page took the mouse, and where one wasn't a tool window
    taking = @($styled | Where-Object { @($_.styles | Where-Object { -not ([Convert]::ToInt64($_.Substring(2), 16) -band 0x20) }).Count }).Count
    not_tool = @($styled | Where-Object { @($_.styles | Where-Object { -not ([Convert]::ToInt64($_.Substring(2), 16) -band 0x80) }).Count }).Count
    styles = (@($styled | ForEach-Object { $_.styles -join '+' }) | Select-Object -Unique) -join ' '
  }
}
function Line($r) { if (-not $r) { return 'no samples' }; return "$($r.fps) fps, hidden in $($r.hidden) of $($r.samples) samples, went hidden $($r.went_hidden) times, longest without a frame $($r.longest) ms" }

$base = Stats 'baseline'; $ctl = Stats 'control'; $rec = Stats 'recover'; $hunt = Stats 'hunt'; $held = Stats 'hold'; $later = Stats 'after'
$baseOk = $base -and $base.hidden -eq 0 -and $base.went_hidden -eq 0 -and $base.fps -ge 20
Expect 'held_paint.baseline' $baseOk "nothing over it: $(Line $base)"
# The control proves the check can see a covered page at all: Chromium hides it, or it stops painting.
$seen = $baseOk -and $ctl -and ($ctl.hidden -gt 0 -or $ctl.went_hidden -gt 0 -or $ctl.fps -lt 0.3 * $base.fps)
Expect 'held_paint.control_seen' $seen "a plain window over it: $(Line $ctl)$(if (-not $seen) { "; this runner shows no occlusion, so the held case can't be judged" })"
Expect 'held_paint.control_cleared' ($rec -and $rec.last_vis -eq 'visible' -and $rec.last_since -lt 500) "after it closed: $(Line $rec)"
# She was really held: her overlay over the page took the mouse, which is what loses WS_EX_TRANSPARENT.
$tookMouse = $held -and $held.captured -gt 0 -and $held.taking -gt 0
Expect 'held_paint.held' $tookMouse "$(if ($held) { "the overlay had the mouse in $($held.captured) of $($held.all) samples, and lost WS_EX_TRANSPARENT in $($held.taking); its exstyles $($held.styles)" } else { 'never held' })"
Expect 'held_paint.tool_window' ($held -and $held.styled -gt 0 -and $held.not_tool -eq 0) "$(if ($held) { "an overlay over the page in $($held.styled) samples, not a tool window in $($held.not_tool)" } else { 'never held' })"
if (-not $seen) { Report 'held_paint.painted_while_held' "not judged, the control saw no occlusion: $(Line $held)" }
elseif (-not $tookMouse) { Report 'held_paint.painted_while_held' "not judged, she was never held over the page: $(Line $held)" }
else { Expect 'held_paint.painted_while_held' ($held.hidden -eq 0 -and $held.went_hidden -eq 0 -and $held.fps -ge 0.7 * $base.fps) "held over it: $(Line $held), against $($base.fps) fps with nothing over it" }
Report 'held_paint.hover' "the hunt hovering over her, which takes the mouse too: went hidden $(if ($hunt) { $hunt.went_hidden } else { 'unknown' }) times"
Report 'held_paint.after' "after she was let go: $(Line $later)"
$text = Read-Shared $log
Report 'held_paint.exe' "$([regex]::Matches($text, 'press \S+ from overlay').Count) presses, $([regex]::Matches($text, 'release \S+ state=').Count) releases, the capture lease ran out $([regex]::Matches($text, 'capture lease ran out').Count) times"

$samples | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $Out 'held-paint-samples.json')
$results | Set-Content -LiteralPath (Join-Path $Out 'held-paint.txt')
$fail = @($results | Where-Object { $_ -like 'FAIL *' })
$summary = @('### Held buddy over a browser', "$($results.Count - $fail.Count) passed or reported, $($fail.Count) failed", '') + ($results | ForEach-Object { "- $_" })
$summary -join "`n" | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { $summary -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY }
if ($fail.Count) { exit 1 }
exit 0
