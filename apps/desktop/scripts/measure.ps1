# Samples the app and its WebView2 processes: RAM, CPU and GPU. Prints one summary line.
#   powershell -File measure.ps1 -Label demo -Seconds 30
param([string]$Label = 'run', [int]$Seconds = 30, [string]$Exe = 'desktop-buddies')

function Tree {
  $all = Get-CimInstance Win32_Process
  $root = $all | Where-Object { $_.Name -eq "$Exe.exe" }
  if (-not $root) { return @() }
  $ids = [System.Collections.Generic.HashSet[uint32]]::new()
  foreach ($r in $root) { [void]$ids.Add($r.ProcessId) }
  do {
    $n = $ids.Count
    foreach ($p in $all) { if ($ids.Contains($p.ParentProcessId)) { [void]$ids.Add($p.ProcessId) } }
  } while ($ids.Count -ne $n)
  return @($ids)
}

$cores = [Environment]::ProcessorCount
$rows = @()
$prev = @{}
$prevT = $null
for ($i = 0; $i -lt $Seconds; $i++) {
  $ids = Tree
  if ($ids.Count -eq 0) { Start-Sleep 1; continue }
  $ps = Get-Process -Id $ids -ErrorAction SilentlyContinue
  $now = Get-Date
  # Private working set is what Task Manager shows as Memory. Plain working set counts shared pages once per process.
  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess }
  $private = ($perf | Measure-Object -Property WorkingSetPrivate -Sum).Sum
  $ws = ($ps | Measure-Object -Property WorkingSet64 -Sum).Sum
  $cpu = 0.0
  if ($prevT) {
    $dt = ($now - $prevT).TotalSeconds
    foreach ($p in $ps) {
      if ($prev.ContainsKey($p.Id) -and $p.TotalProcessorTime) { $cpu += ($p.TotalProcessorTime.TotalSeconds - $prev[$p.Id]) }
    }
    $cpu = 100.0 * $cpu / $dt / $cores
  }
  $prev = @{}; foreach ($p in $ps) { if ($p.TotalProcessorTime) { $prev[$p.Id] = $p.TotalProcessorTime.TotalSeconds } }
  $prevT = $now
  $gpu = 0.0
  try {
    $inst = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples
    foreach ($s in $inst) { foreach ($id in $ids) { if ($s.InstanceName -like "pid_$($id)_*") { $gpu += $s.CookedValue } } }
  } catch {}
  if ($i -gt 0) { $rows += [pscustomobject]@{ private = $private; ws = $ws; cpu = $cpu; gpu = $gpu; procs = $ids.Count } }
  Start-Sleep -Milliseconds 700
}
if ($rows.Count -eq 0) { "$Label no samples"; exit 1 }
$m = { param($k) ($rows | Measure-Object -Property $k -Average -Maximum) }
'{0,-16} procs {1}  memory {2:N0} MB  working set {3:N0} MB  cpu avg {4:N2}% peak {5:N2}% of all cores  gpu avg {6:N1}%  samples {7}' -f $Label, ($rows[-1].procs), ((& $m private).Average / 1MB), ((& $m ws).Average / 1MB), (& $m cpu).Average, (& $m cpu).Maximum, (& $m gpu).Average, $rows.Count
