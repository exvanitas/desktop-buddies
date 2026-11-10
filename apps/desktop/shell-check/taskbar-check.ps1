# Does the taskbar cover a buddy after someone clicks it? Each overlay is its monitor's whole screen, so
# a buddy with a negative floor lift is drawn down over the taskbar's strip. The taskbar is always on top
# too, and clicking it brings it to the front. This runs the frozen exe once, with a made-up buddy of one
# solid colour (taskbar-check.buddy, made by taskbar-buddy.ts), and reads the strip's pixels before and
# after real clicks. For a real PC, by hand, under two minutes.
#
# What it clicks, with the real mouse, all on the primary monitor:
#   1. an empty spot on the taskbar: never a button (Start, widgets, search, a pinned or running app, the
#      tray), never on her. -EmptyAt x,y picks it; without it, the script tries spots along the strip
#      and takes the first where UI Automation sees the taskbar's own background and Win32 sees the
#      taskbar's window. If it finds none, it clicks nothing.
#   2. the middle of a plain grey window of its own, opened in the middle of the screen;
#   3. the same empty taskbar spot again.
# On an exe of API 2, which keeps overlays on top, she must also be drawn at every reading after each
# taskbar click: the api2.* lines. On API 1 those are left out, as that exe can't.
#
# It refuses to start while Desktop Buddies runs, uses a throwaway data and app folder under -Temp,
# stops what it started by PID, and removes the folder. Pixels are kept only as crops of the strip.
#
# -SetupOnly stops just before the launch: the checks, the before readings of window facts, the
# throwaway folder, its copies and settings. Then it cleans up. No window, no process, no mouse, and
# no screen pixels read or saved: the first crop is skipped.
#
# Any error ends the run with "FAIL run.error <message> at line <n>" in results.txt, written before
# the cleanup, which notes its own errors and never hides that one.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File taskbar-check.ps1 -Exe <frozen exe> -App <app folder> [-Out <dir>] [-EmptyAt x,y] [-Temp <dir>] [-SetupOnly]
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [string]$Out = 'taskbar-results',
  # an empty spot on the taskbar, in physical pixels, to click instead of looking for one
  [string]$EmptyAt = '',
  [string]$Temp = [IO.Path]::GetTempPath(),
  [switch]$SetupOnly
)
$ErrorActionPreference = 'Stop'
$clock = [Diagnostics.Stopwatch]::StartNew()

# PowerShell's names ignore case: a script variable named like a parameter is that parameter, and
# takes its type. $exe = $null once emptied the [string] -Exe, and the copy failed on an empty path.
# So nothing below reuses a parameter's name in any case.
$results = [System.Collections.Generic.List[string]]::new()
$resultsFile = ''
$at = { '(t={0:N1}s)' -f $clock.Elapsed.TotalSeconds }
function Expect($name, $ok, $detail = '') {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) $name $detail $(& $at)"
  $results.Add($line); Write-Host $line
}
function Note($name, $detail) { $line = "INFO $name $detail $(& $at)"; $results.Add($line); Write-Host $line }
# Never throws: results go to the file once -Out is made, and to the console always.
function Done {
  if (-not $script:resultsFile) { Write-Host 'no results.txt: -Out was never made'; return }
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
$tmp = ''; $log = ''; $p = $null; $form = $null; $cursor = $null
$refused = $false

try {
  # ---------- the parameters
  if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "-Exe '$Exe' is not a file" }
  if (-not (Test-Path -LiteralPath $App -PathType Container)) { throw "-App '$App' is not a folder" }
  if (-not $Out) { throw '-Out is empty' }
  if (-not $Temp) { throw '-Temp is empty' }
  if ($EmptyAt -and $EmptyAt -notmatch '^\d+,\d+$') { throw "-EmptyAt '$EmptyAt' is not x,y" }
  $Exe = (Resolve-Path -LiteralPath $Exe).Path
  $App = (Resolve-Path -LiteralPath $App).Path
  New-Item -ItemType Directory -Force $Out | Out-Null
  $Out = (Resolve-Path -LiteralPath $Out).Path
  $resultsFile = Join-Path $Out 'results.txt'
  Note 'mode' "$(if ($SetupOnly) { 'setup only: stops before the launch' } else { 'full run' })"

  . (Join-Path $PSScriptRoot 'win32.ps1')
  . (Join-Path $PSScriptRoot 'pixels.ps1')
  Add-Type -ReferencedAssemblies $drawing -Language CSharp @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices; using System.Text;
public static class Tb {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct APPBARDATA { public int size; public IntPtr hwnd; public uint message, edge; public RECT rc; public IntPtr param; }
  delegate bool E(IntPtr h, IntPtr l);
  [DllImport("user32")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32")] static extern uint GetDpiForSystem();
  [DllImport("shcore")] static extern int GetProcessDpiAwareness(IntPtr p, out int a);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowW(string cls, string title);
  [DllImport("user32")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32")] static extern bool EnumWindows(E e, IntPtr l);
  [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("dwmapi", EntryPoint="DwmGetWindowAttribute")] static extern int DwmInt(IntPtr h, int a, out int v, int size);
  [DllImport("user32")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
  [DllImport("shell32")] static extern IntPtr SHAppBarMessage(uint m, ref APPBARDATA d);
  [DllImport("shell32")] static extern int SHQueryUserNotificationState(out int s);
  static void Physical() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
  static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassNameW(h, s, 256); return s.ToString(); }

  /* Per-monitor aware, so UI Automation's points are physical too. False if the process already had a mode. */
  public static bool PerMonitor() { return SetProcessDpiAwarenessContext(new IntPtr(-4)); }
  /* 0 unaware, 1 system aware, 2 per-monitor aware */
  public static int Awareness() { int a; return GetProcessDpiAwareness(IntPtr.Zero, out a) == 0 ? a : -1; }
  public static uint SystemDpi() { return GetDpiForSystem(); }

  /* the primary monitor's taskbar */
  public static long Taskbar() { return FindWindowW("Shell_TrayWnd", null).ToInt64(); }
  public static int[] Rect(long h) { Physical(); RECT r; GetWindowRect(new IntPtr(h), out r); return new[] { r.L, r.T, r.R, r.B }; }
  public static bool Visible(long h) { return IsWindowVisible(new IntPtr(h)); }
  /* GWL_EXSTYLE. WS_EX_TOPMOST is 0x8: whether the window is always on top. */
  public static long ExStyle(long h) { return GetLong(new IntPtr(h), -20).ToInt64(); }
  /* ABM_GETSTATE: 1 auto-hide. Its always-on-top bit, 2, is never set since Windows 7, so it's no
     answer to that. ABM_GETTASKBARPOS: its edge, 0 left, 1 top, 2 right, 3 bottom. */
  public static int[] AppBar() {
    Physical();
    var d = new APPBARDATA(); d.size = Marshal.SizeOf(typeof(APPBARDATA));
    int state = SHAppBarMessage(4, ref d).ToInt32();
    var p = new APPBARDATA(); p.size = Marshal.SizeOf(typeof(APPBARDATA));
    SHAppBarMessage(5, ref p);
    return new[] { state, (int)p.edge, p.rc.L, p.rc.T, p.rc.R, p.rc.B };
  }
  /* SHQueryUserNotificationState: what Windows makes of the screen, 5 when nothing is full screen */
  public static int Quns() { int s; return SHQueryUserNotificationState(out s) == 0 ? s : -1; }
  /* the class of the top-level window a click here would reach */
  public static string ClassAt(int x, int y) { Physical(); return Class(GetAncestor(WindowFromPoint(new POINT { X = x, Y = y }), 2)); }
  public static string ForegroundClass() { return Class(GetForegroundWindow()); }
  /* The classes of shown, uncloaked top-level windows with exactly this rect, but for one process's.
     The desktop's own windows aside. Never a title. No List: with the drawing references named,
     Add-Type leaves System.Collections out. */
  public static string[] Covering(int l, int t, int r, int b, uint skip) {
    Physical(); var o = new string[0];
    EnumWindows((h, x) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == skip || !IsWindowVisible(h) || IsIconic(h)) return true;
      int cloaked; if (DwmInt(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      RECT w; GetWindowRect(h, out w);
      if (w.L != l || w.T != t || w.R != r || w.B != b) return true;
      string c = Class(h); if (c == "Progman" || c == "WorkerW") return true;
      Array.Resize(ref o, o.Length + 1); o[o.Length - 1] = c; return true;
    }, IntPtr.Zero);
    return o;
  }

  /* The screen's pixels in one box, layered windows included. */
  public static Bitmap Grab(int x, int y, int w, int h) {
    Physical();
    var b = new Bitmap(Math.Max(1, w), Math.Max(1, h), PixelFormat.Format24bppRgb);
    using (var g = Graphics.FromImage(b)) {
      IntPtr screen = GetDC(IntPtr.Zero), dc = g.GetHdc();
      BitBlt(dc, 0, 0, w, h, screen, x, y, 0x00CC0020 | 0x40000000);
      g.ReleaseHdc(dc); ReleaseDC(IntPtr.Zero, screen);
    }
    return b;
  }
  static int[] Read(Bitmap b) {
    var d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var px = new int[b.Width * b.Height]; Marshal.Copy(d.Scan0, px, 0, px.Length); b.UnlockBits(d); return px;
  }
  static bool Near(int p, int r, int g, int bl, int tol) { return Math.Abs(((p >> 16) & 255) - r) <= tol && Math.Abs(((p >> 8) & 255) - g) <= tol && Math.Abs((p & 255) - bl) <= tol; }
  /* pixels of this colour */
  public static int Count(Bitmap b, int r, int g, int bl, int tol) { int n = 0; foreach (var p in Read(b)) if (Near(p, r, g, bl, tol)) n++; return n; }
  /* the left and right columns that have this colour, -1 -1 if none */
  public static int[] Span(Bitmap b, int r, int g, int bl, int tol) {
    var p = Read(b); int l = -1, rr = -1;
    for (int i = 0; i < p.Length; i++) if (Near(p[i], r, g, bl, tol)) { int x = i % b.Width; if (l < 0 || x < l) l = x; if (x > rr) rr = x; }
    return new[] { l, rr };
  }
  public static void Save(Bitmap b, string path) { b.Save(path, ImageFormat.Png); }
}
"@
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase

  # Her colour, and the least of it that counts as her being there: her 160 px wide over a strip
  # tens of pixels high is thousands.
  $COLOUR = @{ r = 255; g = 0; b = 200; tol = 24 }
  $MIN = 200
  $EXE_NAME = [IO.Path]::GetFileNameWithoutExtension($Exe)

  # ---------- never beside a running app
  $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'desktop-buddies' -or $_.ProcessName -eq $EXE_NAME })
  if ($running.Count) {
    Note 'refused' "Desktop Buddies is running (pid $(($running | ForEach-Object Id) -join ', ')): quit it from its tray icon, then run this again"
    $refused = $true
    Done
  }
}
catch {
  Expect 'run.error' $false (Error-Line $_)
  Write-Host $_.ScriptStackTrace
  Done
  $refused = $true   # stops here: exit 1, as it failed
}

if (-not $refused) {
  try {
    # ---------- where things are, before the app starts
    $perMonitor = [Tb]::PerMonitor()
    $aware = [Tb]::Awareness()
    # UI Automation takes points in this process's own pixels: physical when it's per-monitor aware.
    $uiaScale = if ($aware -eq 2) { 1.0 } else { 96.0 / [Tb]::SystemDpi() }
    Note 'dpi' "per-monitor set $perMonitor, awareness $aware, system dpi $([Tb]::SystemDpi()), UI Automation scale $uiaScale"
    $primary = [Px]::Primary()
    $work = [W]::WorkArea()
    $tb = [Tb]::Taskbar()
    $QUNS = @{ 1 = 'not_present'; 2 = 'busy'; 3 = 'd3d_full_screen'; 4 = 'presentation'; 5 = 'accepts_notifications'; 6 = 'quiet_time'; 7 = 'app'; -1 = 'unknown' }
    # The taskbar's facts. Always on top is its own WS_EX_TOPMOST, read off the Shell_TrayWnd found.
    function Facts($when) {
      $r = if ($tb) { [Tb]::Rect($tb) } else { @(0, 0, 0, 0) }
      $ex = if ($tb) { [Tb]::ExStyle($tb) } else { 0 }
      $a = [Tb]::AppBar(); $q = [Tb]::Quns()
      $shown = if ($tb) { [Tb]::Visible($tb) } else { $false }
      Note "$when.taskbar" ("found $([bool]$tb) hwnd 0x{0:x} visible $shown rect $($r -join ',') edge $($a[1]) exstyle 0x{1:x} always_on_top $([bool]($ex -band 8)) auto_hide $([bool]($a[0] -band 1)) appbar_state 0x{2:x} appbar_rect $($a[2..5] -join ',')" -f $tb, $ex, $a[0])
      Note "$when.quns" "$q $($QUNS[$q])"
      Note "$when.foreground" "class $([Tb]::ForegroundClass())"
      # another app full screen on the primary monitor, ours aside: classes only
      $skip = if ($p) { [uint32]$p.Id } else { [uint32]0 }
      $cover = @([Tb]::Covering(0, 0, $primary[0], $primary[1], $skip))
      Note "$when.full_screen_windows" "$(if ($cover.Count) { "$($cover.Count): $($cover -join ', ')" } else { 'none' }) exactly cover the primary monitor$(if ($p) { ', ours aside' })"
      return @{ rect = ($r -join ','); visible = $shown; quns = $q; edge = $a[1]; autohide = [bool]($a[0] -band 1); topmost = [bool]($ex -band 8) }
    }
    Note 'screen' "primary $($primary -join 'x') work $($work.L),$($work.T),$($work.R),$($work.B)"
    $before = Facts 'before'

    # The strip: the taskbar's part of the primary monitor, under the work area. The band: the 40 px just
    # above it, where she shows while she's on the floor.
    $canClick = $true
    if (-not $tb -or $before.edge -ne 3 -or $before.autohide -or $work.B -ge $primary[1]) {
      Note 'skip' 'the pixel and click steps need a taskbar at the bottom of the primary monitor that stays shown; only the full-screen facts are read'
      $canClick = $false
    }
    $strip = @{ x = 0; y = $work.B; w = $primary[0]; h = $primary[1] - $work.B }
    $band = @{ x = 0; y = $work.B - 40; w = $primary[0]; h = 40 }

    # How an overlay's rect covers the primary monitor: 'whole', '1 px short on the <edge>', or $null.
    # The overlays may stop a pixel short of the monitor on one edge.
    function Coverage($r) {
      $d = @($r[0], $r[1], ($primary[0] - $r[2]), ($primary[1] - $r[3]))
      $short = @(0..3 | Where-Object { $d[$_] -ne 0 })
      if (-not $short.Count) { return 'whole' }
      if ($short.Count -eq 1 -and $d[$short[0]] -eq 1) { return "1 px short on the $(@('left', 'top', 'right', 'bottom')[$short[0]])" }
      return $null
    }

    $crop = 0
    function Look($label, [switch]$Save) {
      $s = [Tb]::Grab($strip.x, $strip.y, $strip.w, $strip.h); $b = [Tb]::Grab($band.x, $band.y, $band.w, $band.h)
      try {
        $o = @{ strip = [Tb]::Count($s, $COLOUR.r, $COLOUR.g, $COLOUR.b, $COLOUR.tol); band = [Tb]::Count($b, $COLOUR.r, $COLOUR.g, $COLOUR.b, $COLOUR.tol); span = [Tb]::Span($s, $COLOUR.r, $COLOUR.g, $COLOUR.b, $COLOUR.tol); above = (Taskbar-Above) }
        if ($Save) { $script:crop++; [Tb]::Save($s, (Join-Path $Out ('strip-{0}-{1}.png' -f $script:crop, $label))) }
        return $o
      } finally { $s.Dispose(); $b.Dispose() }
    }
    # Whether the taskbar is above the overlay in the z-order. Null while there's no overlay.
    $overlay = 0
    function Taskbar-Above {
      if (-not $script:overlay) { return $null }
      $order = @([W]::Order([long[]]@($tb, $script:overlay)))
      return $order.Count -eq 2 -and $order[0] -eq $tb
    }
    function Say($o) { "strip $($o.strip) px, band $($o.band) px, her columns $($o.span -join '..'), taskbar above overlay: $($o.above)" }

    # the screen's pixels: never in setup only
    if ($canClick -and -not $SetupOnly) { [void](Look 'before-app' -Save) }

    # ---------- a throwaway copy of the app, her alone in its library
    $tmp = Join-Path $Temp ('taskbar-check-' + [guid]::NewGuid().ToString('n').Substring(0, 8))
    $bin = Join-Path $tmp 'bin'; $data = Join-Path $tmp 'data'
    New-Item -ItemType Directory -Force $bin, $data | Out-Null
    Copy-Item -LiteralPath $Exe -Destination $bin
    $appCopy = Join-Path $bin 'app'
    Copy-Item -LiteralPath $App -Destination $appCopy -Recurse
    $exeCopy = Join-Path $bin ([IO.Path]::GetFileName($Exe))
    # nobody out and nothing seeded: the file opened at launch brings her out
    $SETTINGS = '{"out":[],"noSeed":true}'
    $settingsFile = Join-Path $data 'settings.json'
    $SETTINGS | Set-Content -NoNewline -LiteralPath $settingsFile
    $buddy = Join-Path $tmp 'taskbar-check.buddy'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'taskbar-check.buddy') -Destination $buddy
    $log = Join-Path $tmp 'app.log'

    $files = @(Get-ChildItem -LiteralPath $App -Recurse -File).Count
    $copied = @(Get-ChildItem -LiteralPath $appCopy -Recurse -File).Count
    Expect 'setup.exe_copied' (Test-Path -LiteralPath $exeCopy -PathType Leaf) $exeCopy
    Expect 'setup.app_copied' ($files -gt 0 -and $copied -eq $files) "$copied of $files files in $appCopy"
    Expect 'setup.settings' ((Get-Content -Raw -LiteralPath $settingsFile) -eq $SETTINGS) $settingsFile
    Expect 'setup.buddy' (Test-Path -LiteralPath $buddy -PathType Leaf) $buddy

    if ($SetupOnly) {
      Note 'setup_only' 'stopped before the launch: no window opened, no process started, no mouse moved, no screen read'
    } else {
      $cursor = [W]::CursorAt()
      $p = Start-Process $exeCopy -ArgumentList @('--data-dir', "`"$data`"", '--app-dir', "`"$appCopy`"", '--log', "`"$log`"", '--seconds', 150, '--no-manager', "`"$buddy`"") -PassThru
      [void]$p.Handle

      # the overlay on the primary monitor: the app's always-on-top window that covers it, whole or
      # but for a 1 px line on one edge
      $t = [Diagnostics.Stopwatch]::StartNew(); $overlayRect = $null; $overlayHow = $null
      while (-not $overlay -and $t.Elapsed.TotalSeconds -lt 20) {
        foreach ($h in @([Px]::Topmost([uint32]$p.Id))) { $r = [Tb]::Rect($h); $how = Coverage $r; if ($how) { $overlay = $h; $overlayRect = $r; $overlayHow = $how } }
        if (-not $overlay) { Start-Sleep -Milliseconds 200 }
      }
      if (-not $overlay) {
        $seen = @(@([Px]::Topmost([uint32]$p.Id)) | ForEach-Object { ('0x{0:x} ' -f $_) + ([Tb]::Rect($_) -join ',') })
        Note 'app.topmost_windows' "$(if ($seen.Count) { $seen -join '; ' } else { 'none' })"
      }
      # The exe's contract, as the hub logged it.
      $api = 0; $t = [Diagnostics.Stopwatch]::StartNew()
      while (-not $api -and $t.Elapsed.TotalSeconds -lt 10) {
        $m = Select-String -LiteralPath $log -Pattern '^\s*[\d.]+ exe api (\d+)$' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $api = [int]$m.Matches[0].Groups[1].Value } else { Start-Sleep -Milliseconds 200 }
      }
      Note 'app.exe_api' "$(if ($api) { "api $api" } else { 'not in the log after 10 s' })"
      Expect 'app.overlay_whole_screen' ([bool]$overlay) "$(if ($overlay) { ('overlay 0x{0:x} rect ' -f $overlay) + ($overlayRect -join ',') + ", primary 0,0,$($primary -join ','): $overlayHow" } else { 'none covering the primary monitor, whole or but for 1 px on one edge, after 20 s' })"

      # ---------- step 3: what Windows makes of a full-screen, always-on-top, see-through window
      Start-Sleep -Seconds 2
      $up = Facts 'up'
      $full = @(2, 3, 4, 7)
      Expect 'heuristic.not_full_screen' (-not ($full -contains $up.quns) -or $up.quns -eq $before.quns) "quns $($before.quns) before, $($up.quns) with the overlays up"
      Expect 'heuristic.taskbar_unchanged' ($up.visible -eq $before.visible -and $up.rect -eq $before.rect -and $up.topmost -eq $before.topmost) "visible $($before.visible) to $($up.visible), rect $($before.rect) to $($up.rect), always_on_top $($before.topmost) to $($up.topmost)"

      if ($canClick) {
        # ---------- step 1: she's on the floor and drawn over the strip
        $t = [Diagnostics.Stopwatch]::StartNew(); $o = $null
        do { $o = Look 'wait'; if ($o.band -ge $MIN -and $o.strip -ge $MIN) { break }; Start-Sleep -Milliseconds 250 } while ($t.Elapsed.TotalSeconds -lt 30)
        Expect 'step1.on_the_floor' ($o.band -ge $MIN) "after $([int]$t.Elapsed.TotalSeconds) s: $(Say $o)"
        $o = Look 'drawn' -Save
        Expect 'step1.drawn_over_strip' ($o.strip -ge $MIN) (Say $o)

        # Waits for her to be on the floor, so a strip without her means covered, not gone. Reads at
        # 0.3, 1 and 3 s after a click, and judges by the last.
        function After($label) {
          $seen = @()
          foreach ($ms in 300, 700, 2000) {
            Start-Sleep -Milliseconds $ms
            $seen += , (Look $label)
          }
          $t = [Diagnostics.Stopwatch]::StartNew()
          while ($seen[-1].band -lt $MIN -and $t.Elapsed.TotalSeconds -lt 8) { Start-Sleep -Milliseconds 300; $seen += , (Look $label) }
          $last = Look $label -Save
          return @{ last = $last; seen = $seen; line = (($seen | ForEach-Object { "$($_.strip)/$($_.band)" }) -join ' ') }
        }
        # API 2: at every reading where she was on the floor, she was over the strip, and she ended on it.
        function Kept($label, $r) {
          if ($api -lt 2) { return }
          $lost = @($r.seen | Where-Object { $_.band -ge $MIN -and $_.strip -lt $MIN }).Count
          Expect "api2.$label.drawn_every_read" ($lost -eq 0 -and $r.last.band -ge $MIN -and $r.last.strip -ge $MIN) "$lost of $($r.seen.Count) readings lost her; $(Say $r.last); $($r.line)"
        }

        # ---------- an empty spot on the taskbar
        $y = [int]($strip.y + $strip.h / 2)
        function Uia($x, $y) {
          try {
            $e = [System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($x * $uiaScale, $y * $uiaScale))
            $c = $e.Current
            $acts = @('IsInvokePatternAvailableProperty', 'IsTogglePatternAvailableProperty', 'IsExpandCollapsePatternAvailableProperty', 'IsSelectionItemPatternAvailableProperty', 'IsValuePatternAvailableProperty') |
              Where-Object { $e.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::$_) }
            $kind = $c.ControlType.ProgrammaticName
            # never the name: on a taskbar that's an app's or a window's title
            return @{ ok = (-not $acts) -and ($kind -in 'ControlType.Pane', 'ControlType.Window', 'ControlType.ToolBar', 'ControlType.Group', 'ControlType.Custom'); what = "$kind class '$($c.ClassName)'$(if ($acts) { ' acts: ' + ($acts -join ',') })" }
          } catch { return @{ ok = $false; what = "UI Automation failed: $($_.Exception.Message)" } }
        }
        $spot = $null
        $her = (Look 'spot').span
        if ($EmptyAt) {
          $xy = $EmptyAt -split ','
          $spot = @{ x = [int]$xy[0]; y = [int]$xy[1] }
          Note 'click.spot' "given $($spot.x),$($spot.y): window class $([Tb]::ClassAt($spot.x, $spot.y)), $((Uia $spot.x $spot.y).what)"
        } else {
          foreach ($f in .25, .2, .3, .35, .15, .4, .6, .65, .7, .75) {
            $x = [int]($strip.x + $strip.w * $f)
            $why = ''
            if ($her[0] -ge 0 -and $x -ge $her[0] - 60 -and $x -le $her[1] + 60) { $why = 'on or near her' }
            elseif ([W]::Lands($x, $y, [uint32]$p.Id)) { $why = 'the overlay takes the mouse there' }
            elseif ([Tb]::ClassAt($x, $y) -ne 'Shell_TrayWnd') { $why = "window class $([Tb]::ClassAt($x, $y))" }
            else { $u = Uia $x $y; if (-not $u.ok) { $why = $u.what } }
            if ($why) { Note 'click.spot_skipped' "$x,$y`: $why"; continue }
            $spot = @{ x = $x; y = $y }
            Note 'click.spot' "$x,$y`: window class Shell_TrayWnd, $((Uia $x $y).what)"
            break
          }
        }
        Expect 'click.spot_found' ([bool]$spot) "$(if (-not $spot) { 'no empty taskbar spot: nothing clicked, pass -EmptyAt x,y' })"

        if ($spot) {
          $tray = 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'
          # Never a press on her: if she has walked onto the spot, it waits up to 3 s for her to go, then gives up.
          function Taskbar-Click($label) {
            $t = [Diagnostics.Stopwatch]::StartNew()
            while ([W]::Lands($spot.x, $spot.y, [uint32]$p.Id) -and $t.Elapsed.TotalSeconds -lt 3) { Start-Sleep -Milliseconds 200 }
            $free = -not [W]::Lands($spot.x, $spot.y, [uint32]$p.Id)
            Expect "$label.not_captured" $free "the overlay $(if ($free) { 'leaves' } else { 'takes' }) $($spot.x),$($spot.y)$(if ($free) { ' to the taskbar' } else { ': she is there, so nothing was clicked' })"
            if (-not $free) { return }
            [void][W]::Click($spot.x, $spot.y, 2, 4)
            [void][W]::MoveCursor($spot.x, $strip.y - 200)
            Start-Sleep -Milliseconds 200
            $fg = [Tb]::ForegroundClass()
            Expect "$label.reaches_taskbar" ($tray -contains $fg) "foreground is $fg"
          }

          # ---------- step 2: the taskbar to the front, then a window, then the taskbar again
          Taskbar-Click 'click1'
          $first = After 'after-taskbar-click'
          Expect 'step2.after_taskbar_click.still_drawn' ($first.last.strip -ge $MIN -or $first.last.band -lt $MIN) "$(Say $first.last); strip/band px at 0.3 1 3 s and on: $($first.line)$(if ($first.last.band -lt $MIN) { '; she was off the floor, so this proves nothing' })"
          Kept 'after_taskbar_click' $first
          [void](Facts 'after_taskbar_click')

          $ww = 360; $wh = 240; $wx = [int](($work.L + $work.R - $ww) / 2); $wy = [int](($work.T + $work.B - $wh) / 2)
          $form = Start-Process powershell -ArgumentList '-NoProfile', '-File', "`"$(Join-Path $PSScriptRoot 'edge-window.ps1')`"", 'taskbar-check-window', $wx, $wy, $ww, $wh, '#808080' -PassThru -WindowStyle Hidden
          $win = 0; $t = [Diagnostics.Stopwatch]::StartNew()
          while (-not $win -and $t.Elapsed.TotalSeconds -lt 15) { $win = [W]::FindByTitle('taskbar-check-window'); if (-not $win) { Start-Sleep -Milliseconds 200 } }
          Expect 'window.opened' ([bool]$win) "$wx,$wy ${ww}x$wh"
          if ($win) {
            [void][W]::Click($wx + [int]($ww / 2), $wy + [int]($wh / 2), 2, 4)
            Start-Sleep -Milliseconds 300
            Expect 'click2.window_in_front' ([W]::CurrentForeground() -eq $win) "foreground is $([Tb]::ForegroundClass())"
            $second = After 'after-window-click'
            Expect 'step2.after_window_click.still_drawn' ($second.last.strip -ge $MIN -or $second.last.band -lt $MIN) "$(Say $second.last); $($second.line)$(if ($second.last.band -lt $MIN) { '; she was off the floor, so this proves nothing' })"
            [void](Facts 'after_window_click')
          }

          Taskbar-Click 'click3'
          $third = After 'after-second-taskbar-click'
          Expect 'step2.after_second_taskbar_click.still_drawn' ($third.last.strip -ge $MIN -or $third.last.band -lt $MIN) "$(Say $third.last); $($third.line)$(if ($third.last.band -lt $MIN) { '; she was off the floor, so this proves nothing' })"
          Kept 'after_second_taskbar_click' $third
          [void](Facts 'end')
        }
      }
    }
  } catch {
    # written before any cleanup, so a cleanup that goes wrong can't lose it
    Expect 'run.error' $false (Error-Line $_)
    Write-Host $_.ScriptStackTrace
    Done
  } finally {
    # ---------- everything it started, by PID, and its folder. Each step guards what may be empty.
    Tidy 'cursor' { if ($p -and $cursor) { [void][W]::MoveCursor($cursor.X, $cursor.Y) } }
    Tidy 'window' { if ($form -and -not $form.HasExited) { Stop-Process -Id $form.Id -Force -ErrorAction SilentlyContinue } }
    Tidy 'exe' { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
    Tidy 'strays' {
      # Only processes this run started or that use its folder. With no folder, no WebView2 is ours:
      # a filter on an empty folder would match every WebView2 on the PC.
      $ours = { ($p -and $_.ProcessId -eq $p.Id) -or ($tmp -and $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$tmp*") }
      $left = @()
      if ($p -or $tmp) {
        $t = [Diagnostics.Stopwatch]::StartNew()
        do {
          $left = @(Get-CimInstance Win32_Process | Where-Object -FilterScript $ours)
          if ($left.Count) { Start-Sleep -Milliseconds 500 }
        } while ($left.Count -and $t.Elapsed.TotalSeconds -lt 10)
        foreach ($l in $left) { Stop-Process -Id $l.ProcessId -Force -ErrorAction SilentlyContinue }
        if ($left.Count) { Start-Sleep -Milliseconds 500 }
        $left = @(Get-CimInstance Win32_Process | Where-Object -FilterScript $ours)
      }
      Expect 'cleanup.no_strays' ($left.Count -eq 0) "$($left.Count) left"
    }
    # the log, kept with what the run saw, then the folder goes
    Tidy 'log' { if ($log -and $Out -and (Test-Path -LiteralPath $log)) { Copy-Item -LiteralPath $log -Destination (Join-Path $Out 'app.log') } }
    Tidy 'folder' {
      if ($tmp) {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
        Expect 'cleanup.folder_removed' (-not (Test-Path -LiteralPath $tmp)) $tmp
      }
    }
    Expect 'run.under_two_minutes' ($clock.Elapsed.TotalSeconds -lt 120) ('{0:N1} s' -f $clock.Elapsed.TotalSeconds)
    Done
  }
}
$fail = @($results | Where-Object { $_ -like 'FAIL *' })
Write-Host "$(@($results | Where-Object { $_ -like 'PASS *' }).Count) passed, $($fail.Count) failed; results in $(if ($resultsFile) { $resultsFile } else { 'the console only' })"
if ($fail.Count) { exit 1 }
if ($refused) { exit 2 }
exit 0
