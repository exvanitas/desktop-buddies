# The right-click menu on a real PC, with the real app: what the first right-click costs, and what the
# menu's window adds. The built app folder, a fresh data folder, so the first buddy is out (seeded, or
# the sample imported at launch when the build ships none: see first-buddy.ps1), and the
# real mouse and keyboard. Another app's window holds the foreground before each right-click, as when
# someone is working in another app.
#   cold: right-click to the menu taking the foreground, with its window not open yet, by this
#         script's clock, and the app's own figure from the log, right-click to the page's focus
#   warm: the same, five times, with the window open and hidden
#   memory: the app's processes' private working set, before the first right-click and after
# Desktop Buddies must not be running: a second copy would hand its arguments to it and leave, and
# the memory is read by the exe's name.
#
# Every window it opens is its own, and it closes each. Processes are ended only by their own PID.
# The cursor goes back where it was. Nothing is written outside -Work, which whoever runs this deletes.
#
# -SetupOnly runs the checks and stops before the holder window opens: no window, no process, no
# mouse. Any error ends the run with "FAIL run.error <message> at line <n>" in -Work's results.txt,
# written before the cleanup, which notes its own errors and never hides that one.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [Parameter(Mandatory)][string]$Work,
  [int]$Warm = 5,
  [switch]$SetupOnly
)
$ErrorActionPreference = 'Stop'

# PowerShell's names ignore case: a script variable named like a parameter is that parameter, and
# takes its type. $warm = @() once hit the [int] -Warm and stopped the run at its warm part. So
# nothing below reuses a parameter's name in any case.
$results = [System.Collections.Generic.List[string]]::new()
$resultsFile = ''
function Expect($what, $ok, $detail = '') {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) $what $detail"
  $results.Add($line); Write-Host $line
}
function Note($line) { $results.Add("INFO $line"); Write-Host "INFO $line" }
# Never throws: results go to the file once -Work is made, and to the console always.
function Save-Results {
  if (-not $script:resultsFile) { Write-Host 'no results.txt: -Work was never made'; return }
  try { $results | Set-Content -LiteralPath $script:resultsFile } catch { Write-Host "could not write $($script:resultsFile): $($_.Exception.Message)" }
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

# What the cleanup reads. Each stays empty until the step that makes it.
$p = $null; $holder = $null; $cursorWas = $null; $log = ''

try {
  # ---------- the parameters, and nothing started yet
  if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "-Exe '$Exe' is not a file" }
  if (-not (Test-Path -LiteralPath $App -PathType Container)) { throw "-App '$App' is not a folder" }
  if ($Warm -lt 0) { throw "-Warm $Warm is below 0" }
  $Exe = (Resolve-Path -LiteralPath $Exe).Path
  $App = (Resolve-Path -LiteralPath $App).Path
  New-Item -ItemType Directory -Force $Work | Out-Null
  $Work = (Resolve-Path -LiteralPath $Work).Path
  $resultsFile = Join-Path $Work 'results.txt'
  Note "mode $(if ($SetupOnly) { 'setup only: stops before the holder window' } else { 'full run' })"
  $name = [IO.Path]::GetFileNameWithoutExtension($Exe)
  if (Get-Process -Name $name -ErrorAction SilentlyContinue) { throw "Desktop Buddies is running: quit it from the tray first" }
  if (-not (Test-Path -LiteralPath (Join-Path $App 'buddy-menu.html'))) { throw "$App has no right-click menu: build the app first" }
  $data = Join-Path $Work 'data'
  if (Test-Path -LiteralPath $data) { throw "$data is there already: use a fresh -Work" }
  $measure = Join-Path $PSScriptRoot '..\scripts\measure.ps1'
  $testwin = Join-Path $PSScriptRoot 'testwin.ps1'
  foreach ($need in $measure, $testwin) { if (-not (Test-Path -LiteralPath $need -PathType Leaf)) { throw "$need is missing" } }

  . (Join-Path $PSScriptRoot 'win32.ps1')
  . (Join-Path $PSScriptRoot 'hunt.ps1')
  . (Join-Path $PSScriptRoot 'first-buddy.ps1')
  Add-Type -Language CSharp @"
using System; using System.Runtime.InteropServices;
public static class K {
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32")] static extern uint SendInput(uint n, INPUT[] i, int size);
  /* one key, down and up. True if both went in. */
  public static bool Tap(ushort vk) {
    var d = new INPUT { type = 1, ki = new KEYBDINPUT { vk = vk } };
    var u = new INPUT { type = 1, ki = new KEYBDINPUT { vk = vk, flags = 2 } };
    return SendInput(2, new[] { d, u }, Marshal.SizeOf(typeof(INPUT))) == 2;
  }
}
"@
  $log = Join-Path $Work 'app.log'
  $TITLE = 'Desktop Buddies menu'
  Expect 'setup.checks' $true "exe $Exe, app $App, work $Work, $Warm warm right-clicks"

  if ($SetupOnly) {
    Note 'setup_only stopped before the holder window: no window opened, no process started, no mouse moved'
  } else {
    function Wait-For($what, [scriptblock]$test, $seconds = 20) {
      $t = [Diagnostics.Stopwatch]::StartNew()
      do { if (& $test) { return $true }; Start-Sleep -Milliseconds 10 } while ($t.Elapsed.TotalSeconds -lt $seconds)
      Write-Host "gave up waiting for $what"
      return $false
    }
    # The app's processes' private working set, which is what Task Manager shows as Memory, averaged.
    # measure.ps1 prints one line; joined in case it ever prints more.
    function Memory($label) {
      $line = (@(& $measure -Label $label -Seconds 6 -Exe $name) -join ' ')
      Note "memory $line"
      if ($line -match 'memory ([\d,]+) MB') { return [int]($Matches[1] -replace ',', '') }
      return $null
    }
    $cursorWas = [W]::CursorAt()
    $holder = Start-Process powershell -ArgumentList '-NoProfile', '-File', "`"$testwin`"", 'menu-check-holder', 40, 40, 360, 220 -PassThru -NoNewWindow
    $held = 0
    [void](Wait-For 'the holder' { $script:held = [W]::FindByTitle('menu-check-holder'); $script:held -ne 0 } 30)
    Expect 'scene.holder' ($held -ne 0)
    if (-not $held) { throw 'the holder window never showed' }
    $hb = [W]::Bounds($held)
    function Hold {
      [void][W]::Foreground($held)
      [void][W]::Click($hb.x + [int]($hb.w / 2), $hb.y + [int]($hb.h / 2), 2, 4)
    }

    Hold
    $p = Start-Process $Exe -ArgumentList (@('--app-dir', "`"$App`"", '--data-dir', "`"$data`"", '--log', "`"$log`"", '--seconds', 300, '--no-manager', '--trace-hits') + (First-Buddy $App $data (Split-Path $data))) -PassThru
    [void]$p.Handle
    $ours = [uint32]$p.Id
    # One right-click on her and how long until the menu has the foreground, or $null. Esc after.
    function Right-Click($what) {
      Hold
      Start-Sleep -Milliseconds 300
      $a = Find-Her $log $ours
      if (-not $a) { Expect "$what.found_her" $false; return $null }
      $before = ([regex]::Matches((Read-Shared $log), 'menu \d+ focused')).Count
      [void][W]::Click($a.x, $a.y, 8, 16)
      $t = [Diagnostics.Stopwatch]::StartNew()
      $front = Wait-For 'the menu' { $w = [W]::Facts($ours, $TITLE); $w.found -and [W]::CurrentForeground() -eq $w.hwnd } 5
      $ms = $t.ElapsedMilliseconds
      Expect "$what.foreground" $front "after $ms ms"
      $f = [W]::Facts($ours, $TITLE)
      $over = $f.found -and $a.x -ge $f.x -and $a.x -lt $f.x + $f.w -and $a.y -ge $f.y -and $a.y -lt $f.y + $f.h
      Expect "$what.beside_her" ($f.found -and $f.visible -and -not $over) "menu $($f.x),$($f.y) $($f.w)x$($f.h), clicked $($a.x),$($a.y)"
      [void](Wait-For 'the app''s figure' { ([regex]::Matches((Read-Shared $log), 'menu \d+ focused')).Count -gt $before } 3)
      $said = [regex]::Matches((Read-Shared $log), 'menu \d+ focused (\d+) ms after the right-click(, first open)?')
      if ($said.Count -gt $before) { Note "$what.app_says $($said[$said.Count - 1].Value)" }
      [void][K]::Tap(0x1B)
      Expect "$what.esc_hides" (Wait-For 'it to hide' { -not ([W]::Facts($ours, $TITLE)).visible } 3)
      if ($front) { return $ms } else { return $null }
    }

    Expect 'hub.up' (Wait-For 'the hub' { (Read-Shared $log) -match 'hub up: \d+ monitors, 1 in the library, 1 out' } 30)
    Start-Sleep -Seconds 8
    Expect 'menu.not_at_start' (-not ([W]::Facts($ours, $TITLE)).found) 'no menu window before the first right-click'
    Expect 'menu.start_took_no_focus' ([W]::CurrentForeground() -eq $held) "foreground $([W]::CurrentForeground()), holder $held"
    $m0 = Memory 'before-menu'
    $cold = Right-Click 'cold'
    Start-Sleep -Seconds 8
    $m1 = Memory 'after-menu'
    if ($null -ne $m0 -and $null -ne $m1) { Note "memory the menu window adds: $($m1 - $m0) MB ($m0 MB before, $m1 MB after)" }
    $warmMs = @()
    for ($i = 1; $i -le $Warm; $i++) { $ms = Right-Click "warm$i"; if ($null -ne $ms) { $warmMs += $ms } }
    if ($warmMs.Count) { $s = @($warmMs | Sort-Object); Note "warm: median $($s[[int](($s.Count - 1) / 2)]) ms, max $($s[-1]) ms, of $($s.Count); cold $cold ms" }
    $wrong = @(((Read-Shared $log) -split "`r?`n") | Where-Object { $_ -match '\b(error|rejected)\b|menu: ' })
    Expect 'log.clean' (-not $wrong.Count) (($wrong | Select-Object -First 4) -join ' | ')
  }
} catch {
  # written before any cleanup, so a cleanup that goes wrong can't lose it
  Expect 'run.error' $false (Error-Line $_)
  Write-Host $_.ScriptStackTrace
  Save-Results
} finally {
  Tidy 'exe' { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force; Note 'the exe was stopped by its PID' } }
  Tidy 'holder' { if ($holder -and -not $holder.HasExited) { Stop-Process -Id $holder.Id -Force } }
  Tidy 'cursor' { if ($cursorWas) { [void][W]::MoveCursor($cursorWas.X, $cursorWas.Y) } }
  Save-Results
}
$fails = @($results | Where-Object { $_ -match '^FAIL' }).Count
Write-Host "$fails failing. Results in $(if ($resultsFile) { $resultsFile } else { 'the console only' })$(if ($log) { ", the exe's log in $log" })"
if ($fails) { exit 1 }
exit 0
