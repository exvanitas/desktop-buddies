# Finding her with the real cursor from where the app says she is: with --trace-hits each overlay
# that shows her logs a point on her in screen pixels four times a second (huntLine in src/hit.ts),
# after its index in brackets. Needs win32.ps1.
$AIM = '\[(\d+)\] hunt (\S+) drawn [-\d]+,[-\d]+ size \d+, aim (-?\d+),(-?\d+)'

# A log the app still has open.
function Read-Shared($path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return '' }
  $s = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite,Delete')
  try { return [IO.StreamReader]::new($s).ReadToEnd() } finally { $s.Close() }
}
function Aim-Of($l) { @{ overlay = $l.Groups[1].Value; id = $l.Groups[2].Value; x = [int]$l.Groups[3].Value; y = [int]$l.Groups[4].Value } }
# The newest aim in a log's text, or $null. `still` when the one before it from the same overlay was
# for her too, a few pixels off. A buddy across two monitors is shown, and aimed at, by both.
function Aim-In($text) {
  $m = @([regex]::Matches($text, $AIM))
  if (-not $m.Count) { return $null }
  $a = Aim-Of $m[-1]
  $a.still = $false
  for ($k = $m.Count - 2; $k -ge 0; $k--) {
    $b = Aim-Of $m[$k]
    if ($b.overlay -ne $a.overlay -or $b.id -ne $a.id) { continue }
    $a.still = [Math]::Abs($b.x - $a.x) -le 4 -and [Math]::Abs($b.y - $a.y) -le 4
    break
  }
  return $a
}
function Last-Aim($log) { Aim-In (Read-Shared $log) }
# Moves the cursor onto her and stops there once her overlay has taken the mouse, twice over, so a
# press lands on her and nowhere else. Waits for her to stand still for most of the time it has, as a
# moving buddy can leave the cursor over whatever is under her. Returns where, or $null after $limit seconds.
# Says each step on the console, so a failed hunt says which step failed.
function Find-Her($log, [uint32]$exePid, $limit = 25) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  $s = { '{0,5:N1}s' -f $t.Elapsed.TotalSeconds }
  Write-Host "hunt: start, $limit s, reading $log"
  $aims = 0; $moved = 0; $why = 'no aim line in the log'
  while ($t.Elapsed.TotalSeconds -lt $limit) {
    $a = Last-Aim $log
    if (-not $a) { Start-Sleep -Milliseconds 250; continue }
    $aims++
    $late = $t.Elapsed.TotalSeconds -gt $limit * .6
    Write-Host "hunt: $(& $s) aim [$($a.overlay)] $($a.id) $($a.x),$($a.y) $(if ($a.still) { 'still' } else { 'moving' })"
    if (-not $a.still -and -not $late) { $why = 'she kept moving'; Write-Host "hunt: $(& $s) waiting: she's moving"; Start-Sleep -Milliseconds 150; continue }
    [void][W]::MoveCursor($a.x, $a.y); $moved++
    Write-Host "hunt: $(& $s) moved the cursor to $($a.x),$($a.y)$(if (-not $a.still) { ', moving, as time is running out' })"
    Start-Sleep -Milliseconds 120
    if (-not [W]::Lands($a.x, $a.y, $exePid)) { $why = 'her overlay never took the mouse there'; Write-Host "hunt: $(& $s) waiting: not captured yet at $($a.x),$($a.y)"; Start-Sleep -Milliseconds 150; continue }
    Start-Sleep -Milliseconds 60
    if (-not [W]::Lands($a.x, $a.y, $exePid)) { $why = 'the overlay let the mouse go again'; Write-Host "hunt: $(& $s) waiting: captured once, then not"; Start-Sleep -Milliseconds 150; continue }
    Write-Host "hunt: $(& $s) captured twice at $($a.x),$($a.y)"
    return $a
  }
  Write-Host "hunt: gave up after $limit s: $why ($aims aims read, $moved cursor moves)"
  return $null
}
