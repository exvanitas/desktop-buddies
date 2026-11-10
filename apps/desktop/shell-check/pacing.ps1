# Frame pacing in the real exe: does a buddy who falls and runs move on every display frame, by an even
# step? The built app folder is copied, and the pacing probe added after overlay.js in its overlay
# page. The probe drops her from the top, makes her jump and run, reads where the overlay draws her on
# every animation frame, and logs what pacing-measure makes of it, numbers only. This judges from the
# log. Runs on the Actions Windows runner, or a real PC.
# A runner may have no steady display to judge by. Then the probe says so, and this reports the
# numbers without failing on them. An overlay that doesn't move each time she's told to fails either way.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [string]$Out = 'results',
  [int]$Seconds = 45
)
$ErrorActionPreference = 'Stop'
# An error's message and where it was thrown. -File drops the line from the console's own report.
function Error-Line($e) {
  $i = $e.InvocationInfo
  $where = if ($i -and $i.ScriptLineNumber) { " at line $($i.ScriptLineNumber)$(if ($i.ScriptName -and $i.ScriptName -ne $PSCommandPath) { ' of ' + [IO.Path]::GetFileName($i.ScriptName) })" } else { ' at an unknown line' }
  return "$($e.Exception.Message)$where"
}
trap {
  $msg = "FAIL run.error $(Error-Line $_)"
  Write-Host $msg; Write-Host $_.ScriptStackTrace
  try { if ($Out -and (Test-Path -LiteralPath $Out -PathType Container)) { $msg | Add-Content -LiteralPath (Join-Path $Out 'pacing.txt') } } catch { Write-Host "could not save: $($_.Exception.Message)" }
  break
}
. (Join-Path $PSScriptRoot 'first-buddy.ps1')
$Exe = (Resolve-Path $Exe).Path
$App = (Resolve-Path $App).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("pacing-" + [guid]::NewGuid().ToString('n').Substring(0, 8))
$bin = Join-Path $tmp 'bin'
$data = Join-Path $tmp 'data'
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item $Exe $bin
Copy-Item $App (Join-Path $bin 'app') -Recurse
Copy-Item (Join-Path (Split-Path $App) 'probe\pacing-probe.js') (Join-Path $bin 'app')
$page = Join-Path $bin 'app\overlay.html'
$tag = '<script src="overlay.js"></script>'
$html = Get-Content -Raw $page
if (-not $html.Contains($tag)) { throw 'the overlay page has no overlay.js tag to add the probe after' }
$html.Replace($tag, "$tag<script src=`"pacing-probe.js`"></script>") | Set-Content -NoNewline $page
# not $exe: names ignore case, so that would be -Exe
$runExe = Join-Path $bin (Split-Path $Exe -Leaf)
$log = Join-Path $Out 'pacing.log'

$results = [System.Collections.Generic.List[string]]::new()
function Expect($name, $ok, $detail = '') {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) $name $detail"
  $results.Add($line); Write-Host $line
}
function Report($name, $detail) {
  $line = "INFO $name $detail"
  $results.Add($line); Write-Host $line
}

# This run's own processes: the exe it started, and whatever runs on its own folder, as its WebView2 does.
$run = $null
function Own-Processes {
  return @(Get-CimInstance Win32_Process | Where-Object { ($run -and $_.ProcessId -eq $run.Id -or ($_.CommandLine -and $_.CommandLine.Contains($tmp))) })
}
# Stops them by their own ids, waiting a bounded while for them to go.
function Stop-Own {
  Own-Processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $w = [Diagnostics.Stopwatch]::StartNew()
  while ((Own-Processes).Count -and $w.Elapsed.TotalSeconds -lt 10) { Start-Sleep -Milliseconds 250 }
}

# The logger appends, so an earlier run's lines would read as this one's.
Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
try {
  $run = Start-Process $runExe -ArgumentList (@('--data-dir', "`"$data`"", '--log', "`"$log`"", '--seconds', $Seconds, '--no-manager') + (First-Buddy $App $data $tmp)) -PassThru
  [void]$run.Handle # or ExitCode comes back empty
  $done = $run.WaitForExit(($Seconds + 20) * 1000)
  Expect 'pacing.exit' ($done -and $run.ExitCode -eq 0) "$(if ($done) { "code $($run.ExitCode)" } else { 'still running at the limit' })"
  # WebView2's helpers take a moment to follow the exe out.
  $t = [Diagnostics.Stopwatch]::StartNew()
  do {
    $left = Own-Processes
    if ($left.Count) { Start-Sleep -Milliseconds 500 }
  } while ($left.Count -and $t.Elapsed.TotalSeconds -lt 15)
  Expect 'pacing.no_strays' ($left.Count -eq 0) "$($left.Count) left"
} finally {
  Stop-Own
}

$text = if (Test-Path $log) { Get-Content -Raw $log } else { '' }
Expect 'pacing.probe_up' ($text -match 'PACING probe up')
Expect 'pacing.no_errors' ($text -notmatch '(?m)\b(error|rejected|hub error|failed)\b') (($text -split "`n" | Select-String '\b(error|rejected|hub error|failed)\b' | Select-Object -First 3) -join ' | ')
# This run's own: the log was emptied before it, and its last result is the one it ends with.
$found = [regex]::Matches($text, 'PACING result (\{[^\r\n]*\})') | Select-Object -Last 1
Expect 'pacing.result' ($null -ne $found)
if ($found) {
  $r = $found.Groups[1].Value | ConvertFrom-Json
  $numbers = "display $($r.hz) Hz, $([Math]::Round($r.steady * 100, 1))% of frames on time, $($r.issued) moves issued, $($r.judged) judged, $($r.failed) failed, the least travelled $($r.travel) px, $($r.counted) frames of steady motion: $($r.still) still, $($r.doubled) doubled, $([Math]::Round($r.uneven * 100, 2))% uneven, largest step $($r.worst) px"
  if ($r.verdict -eq 'no verdict') { Report 'pacing.even' "no verdict, no steady display to judge by: $numbers" }
  else { Expect 'pacing.even' ($r.verdict -eq 'pass') $numbers }
}

$results | Set-Content (Join-Path $Out 'pacing.txt')
$fail = @($results | Where-Object { $_ -like 'FAIL *' })
$summary = @('### Frame pacing', "$($results.Count - $fail.Count) passed or reported, $($fail.Count) failed", '') + ($results | ForEach-Object { "- $_" })
$summary -join "`n" | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { $summary -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY }
if ($fail.Count) { exit 1 }
exit 0
