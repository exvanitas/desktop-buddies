# Reads the app's windows from the OS: where they are, their style flags, and whether the mouse
# would reach them. Needs no input, so it can run while someone is working.
param([string]$Exe = 'desktop-buddies')
Add-Type -Language CSharp @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  delegate bool E(IntPtr h, IntPtr l);
  [DllImport("user32")] static extern bool EnumWindows(E e, IntPtr l);
  [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  public static List<string> Report(uint pid, uint[] family) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var fam = new HashSet<uint>(family); var o = new List<string>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      RECT r; GetWindowRect(h, out r);
      if (r.R - r.L < 50) return true;
      long ex = GetLong(h, -20).ToInt64();
      var f = new List<string>();
      if ((ex & 0x8) != 0) f.Add("TOPMOST"); if ((ex & 0x20) != 0) f.Add("TRANSPARENT"); if ((ex & 0x80000) != 0) f.Add("LAYERED");
      if ((ex & 0x8000000) != 0) f.Add("NOACTIVATE"); if ((ex & 0x80) != 0) f.Add("TOOLWINDOW");
      int hit = 0, ours = 0;
      for (int i = 1; i < 8; i++) for (int j = 1; j < 8; j++) {
        var pt = new POINT { X = r.L + (r.R - r.L) * i / 8, Y = r.T + (r.B - r.T) * j / 8 };
        var w = GetAncestor(WindowFromPoint(pt), 2); uint q; GetWindowThreadProcessId(w, out q);
        hit++; if (fam.Contains(q)) ours++;
      }
      o.Add(String.Format("{0},{1} {2}x{3} [{4}] mouse lands on us at {5} of {6} test points", r.L, r.T, r.R-r.L, r.B-r.T, String.Join(" ", f), ours, hit));
      return true; }, IntPtr.Zero);
    return o;
  }
}
"@
$all = Get-CimInstance Win32_Process
$root = $all | Where-Object { $_.Name -eq "$Exe.exe" } | Select-Object -First 1
if (-not $root) { "not running"; exit 1 }
$ids = [System.Collections.Generic.HashSet[uint32]]::new(); [void]$ids.Add($root.ProcessId)
do { $n = $ids.Count; foreach ($p in $all) { if ($ids.Contains($p.ParentProcessId)) { [void]$ids.Add($p.ProcessId) } } } while ($ids.Count -ne $n)
[W]::Report([uint32]$root.ProcessId, [uint32[]]@($ids))
