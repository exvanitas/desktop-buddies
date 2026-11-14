# What the soak test and the PC sample read: for one process and every process under it, the
# counters below, from one look at the system's process list. It only reads. Nothing here starts,
# stops or changes a process, a window or a setting. Dot-sourced by soak.ps1 and sample-pc.ps1.
# Windows PowerShell 5.1 or PowerShell 7, 64-bit.
#   private_ws_mb    private working set: what Task Manager shows as Memory
#   private_mb       private bytes, committed: what a leak grows
#   ws_mb            working set, with shared pages counted in each process
#   handles, gdi, user, threads
#   cpu_s            CPU time so far, in seconds
#   cpu_pct_core     CPU over the last interval, as a percentage of one core
#   switches_per_s   context switches a second over the last interval: how often its threads wake
#   started_s        when the process started, in seconds after the one at the root: pages open in
#                    order, so it tells which renderer is which
Add-Type -Language CSharp @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public class SoakProc {
  public int Pid, Parent, Handles, Threads, Gdi = -1, User = -1;
  public long Created, WorkingSet, PrivateWs, Private, CpuTicks;
  public string Name = "";
  /* each thread's context switches so far, by thread id */
  public Dictionary<long, long> Switches = new Dictionary<long, long>();
}
public static class SoakNative {
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int cls, IntPtr buf, int len, out int need);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int id);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")] static extern int GetGuiResources(IntPtr h, int which);
  delegate bool EachWindow(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EachWindow e, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);

  /* Every process, as SystemProcessInformation lists them. The offsets are its 64-bit layout. */
  public static Dictionary<int, SoakProc> All() {
    if (IntPtr.Size != 8) throw new PlatformNotSupportedException("this needs 64-bit PowerShell");
    int len = 1 << 21;
    for (int tries = 0; tries < 8; tries++) {
      IntPtr buf = Marshal.AllocHGlobal(len);
      try {
        int need;
        int st = NtQuerySystemInformation(5, buf, len, out need);
        if (st == unchecked((int)0xC0000004)) { len = Math.Max(len * 2, need + (1 << 16)); continue; }
        if (st != 0) throw new InvalidOperationException("NtQuerySystemInformation said 0x" + st.ToString("x8"));
        return Parse(buf);
      } finally { Marshal.FreeHGlobal(buf); }
    }
    throw new InvalidOperationException("the process list kept outgrowing its buffer");
  }
  static Dictionary<int, SoakProc> Parse(IntPtr buf) {
    var all = new Dictionary<int, SoakProc>();
    long at = 0;
    while (true) {
      IntPtr p = new IntPtr(buf.ToInt64() + at);
      var s = new SoakProc();
      int next = Marshal.ReadInt32(p, 0x00);
      s.Threads = Marshal.ReadInt32(p, 0x04);
      s.PrivateWs = Marshal.ReadInt64(p, 0x08);
      s.Created = Marshal.ReadInt64(p, 0x20);
      s.CpuTicks = Marshal.ReadInt64(p, 0x28) + Marshal.ReadInt64(p, 0x30);
      int nameBytes = Marshal.ReadInt16(p, 0x38) & 0xFFFF;
      IntPtr name = Marshal.ReadIntPtr(p, 0x40);
      if (name != IntPtr.Zero && nameBytes > 0) s.Name = Marshal.PtrToStringUni(name, nameBytes / 2);
      s.Pid = (int)Marshal.ReadInt64(p, 0x50);
      s.Parent = (int)Marshal.ReadInt64(p, 0x58);
      s.Handles = Marshal.ReadInt32(p, 0x60);
      s.WorkingSet = Marshal.ReadInt64(p, 0x90);
      s.Private = Marshal.ReadInt64(p, 0xC8);
      for (int i = 0; i < s.Threads; i++) {
        IntPtr t = new IntPtr(p.ToInt64() + 0x100 + i * 0x50);
        s.Switches[Marshal.ReadInt64(t, 0x30)] = Marshal.ReadInt32(t, 0x40) & 0xFFFFFFFFL;
      }
      all[s.Pid] = s;
      if (next == 0) break;
      at += next;
    }
    return all;
  }
  /* The process and everything started under it, by parent id. A child is never older than its
     parent: an id can be reused once the process that had it has ended. */
  public static List<SoakProc> Tree(Dictionary<int, SoakProc> all, int root) {
    var o = new List<SoakProc>();
    SoakProc r;
    if (!all.TryGetValue(root, out r)) return o;
    o.Add(r);
    var seen = new Dictionary<int, bool>(); seen[root] = true; /* not HashSet: it needs System.Core, which Windows PowerShell 5.1 may not reference */
    for (int i = 0; i < o.Count; i++) {
      foreach (var c in all.Values) {
        if (c.Parent == o[i].Pid && c.Pid != 0 && !seen.ContainsKey(c.Pid) && c.Created >= o[i].Created) { seen[c.Pid] = true; o.Add(c); }
      }
    }
    return o;
  }
  /* GDI and USER objects. GetGuiResources asks for query access; where that's refused, the limited
     kind is tried. Both only read. -1 when the process can't be opened at all. */
  public static void Gui(SoakProc s) {
    IntPtr h = OpenProcess(0x0400, false, s.Pid);
    if (h == IntPtr.Zero) h = OpenProcess(0x1000, false, s.Pid);
    if (h == IntPtr.Zero) return;
    try { s.Gdi = GetGuiResources(h, 0); s.User = GetGuiResources(h, 1); } finally { CloseHandle(h); }
  }
  /* Context switches since the earlier look: what each thread seen then has added, and all of a new
     thread's own. */
  public static long SwitchesSince(SoakProc now, SoakProc before) {
    long n = 0;
    foreach (var kv in now.Switches) {
      long was;
      if (before != null && before.Switches.TryGetValue(kv.Key, out was) && kv.Value >= was) n += kv.Value - was;
      else n += kv.Value;
    }
    return n;
  }
  /* How many top-level windows of this process are shown. */
  public static int Shown(int id) {
    int n = 0;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == (uint)id && IsWindowVisible(h)) n++; return true; }, IntPtr.Zero);
    return n;
  }
}
"@

$soakCulture = [Globalization.CultureInfo]::InvariantCulture
$soakFields = @('ws_mb', 'private_ws_mb', 'private_mb', 'handles', 'gdi', 'user', 'threads', 'cpu_s', 'cpu_pct_core', 'switches_per_s')

function Round-To($x, $digits) { if ($null -eq $x) { return $null }; return [Math]::Round([double]$x, $digits) }
# A number as the CSV has it: a dot for the decimal point on any PC, and nothing for none.
function Csv-Num($x) { if ($null -eq $x) { return '' }; return ([double]$x).ToString('0.###', $soakCulture) }

# What a process is, for the CSV: the exe, or which of WebView2's processes. Its command line is read
# once per process for that word alone, and never written anywhere.
function Kind-Of($p, $kinds) {
  $key = "$($p.Pid)/$($p.Created)"
  if (-not $kinds.ContainsKey($key)) {
    $line = $null
    try { $line = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Pid)" -ErrorAction Stop).CommandLine } catch { $line = $null }
    $k = ($p.Name -replace '\.exe$', '').ToLowerInvariant()
    if ($p.Name -eq 'msedgewebview2.exe') {
      $k = 'browser'
      if ($line -match '--type=([\w-]+)') { $k = $Matches[1] }
      if ($line -match '--utility-sub-type=([\w.]+)') { $k += ':' + ($Matches[1] -replace '^.*\.', '') }
    }
    $kinds[$key] = $k
  }
  return $kinds[$key]
}

# One look at the process $rootId and everything under it. $last is the look before, or $null; $at
# is seconds since the first. Gives the processes by id, a row for each, their total and a total by
# kind. Rates need a look before: the first one has none.
function Take-Look($rootId, $last, $at, $kinds) {
  $all = [SoakNative]::All()
  $tree = [SoakNative]::Tree($all, [int]$rootId)
  $span = 0.0
  if ($last) { $span = $at - $last.at }
  $byId = @{}
  $rows = [System.Collections.Generic.List[object]]::new()
  $byKind = @{}
  $rootCreated = 0
  if ($tree.Count) { $rootCreated = $tree[0].Created }
  $total = [ordered]@{ t_s = $at; pid = 0; kind = 'total'; started_s = $null; ws_mb = 0.0; private_ws_mb = 0.0; private_mb = 0.0; handles = 0; gdi = 0; user = 0; threads = 0; cpu_s = 0.0; cpu_pct_core = $null; switches_per_s = $null; procs = $tree.Count; windows = 0 }
  if ($tree.Count) { $total.windows = [SoakNative]::Shown([int]$rootId) }
  foreach ($p in $tree) {
    [SoakNative]::Gui($p)
    $byId[$p.Pid] = $p
    $prev = $null
    if ($last -and $last.byId.ContainsKey($p.Pid)) {
      $prev = $last.byId[$p.Pid]
      if ($prev.Created -ne $p.Created) { $prev = $null }
    }
    $cpu = $null; $woke = $null
    if ($span -gt 0) {
      $ticks = $p.CpuTicks
      if ($prev) { $ticks = $p.CpuTicks - $prev.CpuTicks }
      $cpu = 100.0 * $ticks / 1e7 / $span
      $woke = [SoakNative]::SwitchesSince($p, $prev) / $span
    }
    $kind = Kind-Of $p $kinds
    $row = [ordered]@{ t_s = $at; pid = $p.Pid; kind = $kind; started_s = ($p.Created - $rootCreated) / 1e7; ws_mb = $p.WorkingSet / 1MB; private_ws_mb = $p.PrivateWs / 1MB; private_mb = $p.Private / 1MB; handles = $p.Handles; gdi = $p.Gdi; user = $p.User; threads = $p.Threads; cpu_s = $p.CpuTicks / 1e7; cpu_pct_core = $cpu; switches_per_s = $woke; procs = 1; windows = $null }
    $rows.Add([pscustomobject]$row)
    foreach ($f in 'ws_mb', 'private_ws_mb', 'private_mb', 'handles', 'threads', 'cpu_s') { $total[$f] += $row[$f] }
    if ($p.Gdi -ge 0) { $total.gdi += $p.Gdi; $total.user += $p.User }
    if ($null -ne $cpu) { $total.cpu_pct_core = [double]$total.cpu_pct_core + $cpu; $total.switches_per_s = [double]$total.switches_per_s + $woke }
    if (-not $byKind.ContainsKey($kind)) { $byKind[$kind] = [ordered]@{ private_ws_mb = 0.0; private_mb = 0.0; cpu_pct_core = $null } }
    $byKind[$kind].private_ws_mb += $row.private_ws_mb
    $byKind[$kind].private_mb += $row.private_mb
    if ($null -ne $cpu) { $byKind[$kind].cpu_pct_core = [double]$byKind[$kind].cpu_pct_core + $cpu }
  }
  return [pscustomobject]@{ at = $at; byId = $byId; rows = $rows; total = [pscustomobject]$total; byKind = $byKind }
}

function Csv-Header { return 't_s,pid,kind,started_s,' + ($soakFields -join ',') + ',procs,windows' }
# The look's rows and its total, one line each.
function Csv-Lines($look) {
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($r in @($look.rows) + @($look.total)) {
    $cells = @((Csv-Num $r.t_s), $r.pid, $r.kind, (Csv-Num $r.started_s)) + @($soakFields | ForEach-Object { Csv-Num $r.$_ }) + @((Csv-Num $r.procs), (Csv-Num $r.windows))
    $lines.Add($cells -join ',')
  }
  return $lines
}

# The least-squares slope of y on x, or $null with fewer than three points or no spread in x.
function Slope($xs, $ys) {
  $n = @($xs).Count
  if ($n -lt 3 -or @($ys).Count -ne $n) { return $null }
  $mx = 0.0; $my = 0.0
  for ($i = 0; $i -lt $n; $i++) { $mx += [double]$xs[$i]; $my += [double]$ys[$i] }
  $mx /= $n; $my /= $n
  $sxy = 0.0; $sxx = 0.0
  for ($i = 0; $i -lt $n; $i++) { $dx = [double]$xs[$i] - $mx; $sxy += $dx * ([double]$ys[$i] - $my); $sxx += $dx * $dx }
  if ($sxx -le 0) { return $null }
  return $sxy / $sxx
}
function Mean-Of($values) { $v = @($values | Where-Object { $null -ne $_ }); if (-not $v.Count) { return $null }; return ($v | Measure-Object -Average).Average }
function Peak-Of($values) { $v = @($values | Where-Object { $null -ne $_ }); if (-not $v.Count) { return $null }; return ($v | Measure-Object -Maximum).Maximum }

# The summary of a run's looks. Steady is the last 75% of the run: means, peaks and the growth an
# hour (least squares, so one spike can't make a slope) are taken there, past the start's own climb.
function Summarize($looks) {
  $every = @($looks)
  if ($every.Count -lt 3) { return $null }
  $first = $every[0].at; $lastAt = $every[-1].at
  $from = $lastAt - 0.75 * ($lastAt - $first)
  $steady = @($every | Where-Object { $_.at -ge $from })
  $mean = [ordered]@{}; $peak = [ordered]@{}
  foreach ($f in 'private_ws_mb', 'private_mb', 'ws_mb', 'handles', 'gdi', 'user', 'threads', 'cpu_pct_core', 'switches_per_s', 'procs', 'windows') {
    $mean[$f] = Round-To (Mean-Of @($steady | ForEach-Object { $_.total.$f })) 3
    $peak[$f] = Round-To (Peak-Of @($steady | ForEach-Object { $_.total.$f })) 3
  }
  $hours = @($steady | ForEach-Object { [double]$_.at / 3600.0 })
  $perHour = [ordered]@{}
  foreach ($f in 'private_mb', 'private_ws_mb', 'handles', 'gdi', 'user', 'threads') {
    $perHour[$f] = Round-To (Slope $hours @($steady | ForEach-Object { [double]$_.total.$f })) 3
  }
  $kindsMean = [ordered]@{}
  foreach ($k in @($steady | ForEach-Object { $_.byKind.Keys } | Sort-Object -Unique)) {
    $kindsMean[$k] = [ordered]@{
      private_ws_mb = Round-To (Mean-Of @($steady | ForEach-Object { if ($_.byKind.ContainsKey($k)) { $_.byKind[$k].private_ws_mb } })) 2
      private_mb = Round-To (Mean-Of @($steady | ForEach-Object { if ($_.byKind.ContainsKey($k)) { $_.byKind[$k].private_mb } })) 2
      cpu_pct_core = Round-To (Mean-Of @($steady | ForEach-Object { if ($_.byKind.ContainsKey($k)) { $_.byKind[$k].cpu_pct_core } })) 3
    }
  }
  # Each process on its own, in the order they started, so a page's renderer can be told apart.
  $procs = [ordered]@{}
  foreach ($l in $steady) {
    foreach ($r in $l.rows) {
      $id = "$($r.kind) $($r.pid)"
      if (-not $procs.Contains($id)) { $procs[$id] = [System.Collections.Generic.List[object]]::new() }
      $procs[$id].Add($r)
    }
  }
  $byProcess = @(foreach ($id in $procs.Keys) {
    $rs = $procs[$id]
    [ordered]@{
      kind = $rs[0].kind
      pid = $rs[0].pid
      started_s = Round-To $rs[0].started_s 2
      samples = $rs.Count
      private_ws_mb = Round-To (Mean-Of @($rs | ForEach-Object { $_.private_ws_mb })) 2
      private_mb = Round-To (Mean-Of @($rs | ForEach-Object { $_.private_mb })) 2
      private_mb_per_h = Round-To (Slope @($rs | ForEach-Object { [double]$_.t_s / 3600.0 }) @($rs | ForEach-Object { [double]$_.private_mb })) 3
      cpu_pct_core = Round-To (Mean-Of @($rs | ForEach-Object { $_.cpu_pct_core })) 3
      switches_per_s = Round-To (Mean-Of @($rs | ForEach-Object { $_.switches_per_s })) 1
    }
  }) | Sort-Object { $_.started_s }
  return [ordered]@{
    samples = $every.Count
    minutes = Round-To (($lastAt - $first) / 60) 2
    steady_from_min = Round-To (($from - $first) / 60) 2
    steady_samples = $steady.Count
    cores = [Environment]::ProcessorCount
    leak_mb_per_h = $perHour.private_mb
    handles_per_h = $perHour.handles
    gdi_per_h = $perHour.gdi
    user_per_h = $perHour.user
    idle_cpu_pct_core = $mean.cpu_pct_core
    wakeups_per_s = $mean.switches_per_s
    peak_private_mb_whole_run = Round-To (Peak-Of @($every | ForEach-Object { $_.total.private_mb })) 3
    mean = $mean
    peak = $peak
    per_hour = $perHour
    by_kind_mean = $kindsMean
    by_process = @($byProcess)
  }
}

# The sampler read against .NET's own view of this PowerShell, so a wrong offset can't pass unseen.
function Self-Check {
  $all = [SoakNative]::All()
  if (-not $all.ContainsKey([int]$PID)) { return [pscustomobject]@{ ok = $false; detail = 'this PowerShell is not in the list' } }
  $me = $all[[int]$PID]
  $net = Get-Process -Id $PID
  $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
  $bad = @()
  if ($me.Name -ne "$($net.ProcessName).exe") { $bad += "name $($me.Name)" }
  if ($me.Parent -ne $parent) { $bad += "parent $($me.Parent), not $parent" }
  if ([Math]::Abs($me.Handles - $net.HandleCount) -gt 200) { $bad += "handles $($me.Handles), not about $($net.HandleCount)" }
  if ([Math]::Abs($me.Threads - $net.Threads.Count) -gt 10) { $bad += "threads $($me.Threads), not about $($net.Threads.Count)" }
  if ($me.Switches.Count -ne $me.Threads) { $bad += "$($me.Switches.Count) thread rows for $($me.Threads) threads" }
  if ([Math]::Abs($me.WorkingSet - $net.WorkingSet64) -gt 0.25 * $net.WorkingSet64) { $bad += "working set $($me.WorkingSet), not about $($net.WorkingSet64)" }
  if ([Math]::Abs($me.Private - $net.PrivateMemorySize64) -gt 0.25 * $net.PrivateMemorySize64) { $bad += "private $($me.Private), not about $($net.PrivateMemorySize64)" }
  if ($me.PrivateWs -le 0 -or $me.PrivateWs -gt $me.WorkingSet) { $bad += "private working set $($me.PrivateWs) of $($me.WorkingSet)" }
  if ([Math]::Abs($me.CpuTicks - $net.TotalProcessorTime.Ticks) -gt 2e7) { $bad += "cpu $($me.CpuTicks / 1e7) s, not about $($net.TotalProcessorTime.TotalSeconds) s" }
  [SoakNative]::Gui($me)
  $detail = "pid $PID $($me.Name): handles $($me.Handles), threads $($me.Threads), working set $([Math]::Round($me.WorkingSet / 1MB)) MB, private $([Math]::Round($me.Private / 1MB)) MB, gdi $($me.Gdi), user $($me.User)"
  if ($bad.Count) { $detail = ($bad -join '; ') + ' | ' + $detail }
  return [pscustomobject]@{ ok = ($bad.Count -eq 0); detail = $detail }
}
