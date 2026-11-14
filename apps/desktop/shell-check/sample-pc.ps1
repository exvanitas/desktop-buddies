# A sample of Desktop Buddies on your own PC: 30 minutes of its memory, handles, CPU and wakeups while
# you use the PC as usual. It only reads. It never starts, stops or changes anything: it reads the
# list of running processes, and writes two files to your Downloads folder, a CSV and a short summary,
# numbers only, with no window titles, file names or paths in either.
# Start Desktop Buddies the way you usually do, keep soak-sampler.ps1 beside this file, and run:
#   powershell -ExecutionPolicy Bypass -File sample-pc.ps1
# -ExecutionPolicy Bypass is for this one run and changes no setting. Ctrl+C stops it early, and what
# it has so far is kept. Windows PowerShell 5.1 compiles the reader first, which runs Microsoft's C#
# compiler for a moment; PowerShell 7 (pwsh) compiles it in itself.
param(
  [int]$Minutes = 30,
  [int]$Interval = 10,
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
# An error's message and where it was thrown.
function Error-Line($e) {
  $i = $e.InvocationInfo
  $where = if ($i -and $i.ScriptLineNumber) { " at line $($i.ScriptLineNumber)$(if ($i.ScriptName -and $i.ScriptName -ne $PSCommandPath) { ' of ' + [IO.Path]::GetFileName($i.ScriptName) })" } else { ' at an unknown line' }
  return "$($e.Exception.Message)$where"
}
# The Downloads folder, as Explorer has it, or the usual place.
function Downloads-Folder {
  $known = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction SilentlyContinue).'{374DE290-123F-4565-9164-39C4925E467B}'
  if ($known) { return [Environment]::ExpandEnvironmentVariables($known) }
  return Join-Path $env:USERPROFILE 'Downloads'
}
# The running app: the oldest desktop-buddies.exe that no other one started. A second launch, from a
# double-click or the Start menu, comes and goes in a moment.
function Find-App {
  $all = [SoakNative]::All()
  $roots = @($all.Values | Where-Object { $_.Name -eq 'desktop-buddies.exe' -and -not ($all.ContainsKey($_.Parent) -and $all[$_.Parent].Name -eq 'desktop-buddies.exe') } | Sort-Object Created)
  if (-not $roots.Count) { return 0 }
  return $roots[0].Pid
}
# What's worth knowing beside the numbers: the app's version and how it was installed, Windows'
# version, the cores, and whether it ran on battery. Read from the exe's file, never its path.
function About-App($rootId) {
  $where = ''
  try { $where = (Get-Process -Id $rootId).Path } catch { $where = '' }
  $version = ''
  if ($where) { try { $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($where).ProductVersion } catch { $version = '' } }
  $how = 'unknown'
  if ($where -match '\\WindowsApps\\') { $how = 'store' }
  elseif ($where -and $env:LOCALAPPDATA -and $where.StartsWith((Join-Path $env:LOCALAPPDATA 'Programs') + '\', [StringComparison]::OrdinalIgnoreCase)) { $how = 'installer' }
  elseif ($where) { $how = 'zip or other' }
  $power = 'no battery'
  try {
    $cell = @(Get-CimInstance Win32_Battery -ErrorAction Stop)
    if ($cell.Count) { $power = if ($cell[0].BatteryStatus -eq 1) { 'on battery' } else { 'plugged in' } }
  } catch { $power = 'unknown' }
  return [ordered]@{ app_version = $version; installed_as = $how; windows = [Environment]::OSVersion.Version.ToString(); cores = [Environment]::ProcessorCount; power_at_start = $power }
}

$looks = $null; $jsonPath = ''; $about = $null; $restarts = 0; $missing = 0; $written = $false
# The summary, from what's been sampled so far. Kept even when the run is stopped early.
function Write-Summary {
  if ($script:written -or -not $script:looks -or $script:looks.Count -lt 3) { return }
  $sum = Summarize $script:looks
  $report = [ordered]@{ sampled = (Get-Date -Format 'yyyy-MM-dd HH:mm'); minutes_asked = $Minutes; interval_s = $Interval; app_restarts = $script:restarts; samples_without_the_app = $script:missing }
  foreach ($k in $script:about.Keys) { $report[$k] = $script:about[$k] }
  foreach ($k in $sum.Keys) { $report[$k] = $sum[$k] }
  [IO.File]::WriteAllText($script:jsonPath, ($report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
  $script:written = $true
  Write-Host ''
  Write-Host ('Over the last {0} minutes: {1} MB memory (private working set), {2} MB private bytes, {3}% of one core, {4} wakeups a second.' -f [Math]::Round($sum.minutes - $sum.steady_from_min), $sum.mean.private_ws_mb, $sum.mean.private_mb, $sum.mean.cpu_pct_core, $sum.wakeups_per_s)
  Write-Host ('Private bytes changed {0} MB an hour, handles {1} an hour.' -f $sum.leak_mb_per_h, $sum.handles_per_h)
  Write-Host "Written: $($script:jsonPath)"
}

try {
  if ($Minutes -lt 1 -or $Minutes -gt 240) { throw "-Minutes $Minutes is outside 1 to 240" }
  if ($Interval -lt 2 -or $Interval -gt 60) { throw "-Interval $Interval is outside 2 to 60 seconds" }
  . (Join-Path $PSScriptRoot 'soak-sampler.ps1')
  $folder = if ($Out) { $Out } else { Downloads-Folder }
  if (-not (Test-Path -LiteralPath $folder -PathType Container)) { throw "there's no folder $folder to write to" }
  $self = Self-Check
  if (-not $self.ok) { throw "the reader doesn't read this PC right, so nothing was sampled: $($self.detail)" }
  $rootId = Find-App
  if (-not $rootId) {
    Write-Host "Desktop Buddies isn't running. Start it the way you usually do, then run this again. Nothing was written."
    exit 1
  }
  $about = About-App $rootId
  $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
  $csvPath = Join-Path $folder "desktop-buddies-sample-$stamp.csv"
  $jsonPath = Join-Path $folder "desktop-buddies-sample-$stamp.json"
  Write-Host "Sampling Desktop Buddies $($about.app_version) every $Interval s for $Minutes minutes. Use the PC as you usually do."
  Write-Host "Writing $csvPath"
  [IO.File]::WriteAllText($csvPath, (Csv-Header) + "`r`n", (New-Object Text.UTF8Encoding $false))
  $kinds = @{}
  $last = $null
  $looks = [System.Collections.Generic.List[object]]::new()
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $nextLook = 0.0
  while ($clock.Elapsed.TotalSeconds -lt $Minutes * 60) {
    $now = $clock.Elapsed.TotalSeconds
    if ($now -ge $nextLook) {
      while ($nextLook -le $now) { $nextLook += $Interval }
      $all = [SoakNative]::All()
      if (-not $all.ContainsKey([int]$rootId) -or $all[[int]$rootId].Name -ne 'desktop-buddies.exe') {
        $found = Find-App
        if ($found) { $rootId = $found; $last = $null; $restarts++; Write-Host 'Desktop Buddies started again: following the new one.' }
        else { $missing++; Write-Host "Desktop Buddies isn't running: waiting for it."; continue }
      }
      $look = Take-Look $rootId $last $now $kinds
      [IO.File]::AppendAllText($csvPath, ((Csv-Lines $look) -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding $false))
      $looks.Add($look)
      $last = $look
      if ($looks.Count % [Math]::Max(1, [int](300 / $Interval)) -eq 0) {
        Write-Host ('{0:N0} of {1} min: {2:N0} MB, {3:N2}% of one core' -f ($now / 60), $Minutes, $look.total.private_ws_mb, $look.total.cpu_pct_core)
      }
    }
    Start-Sleep -Milliseconds 500
  }
} catch {
  Write-Host "Stopped: $(Error-Line $_)"
  exit 1
} finally {
  Write-Summary
}
exit 0
