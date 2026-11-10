# The Win32 calls the check's driver needs, in physical pixels.
Add-Type -Language CSharp @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] struct APPBARDATA { public int size; public IntPtr hwnd; public uint message, edge; public RECT rc; public IntPtr param; }
  delegate bool E(IntPtr h, IntPtr l);
  [DllImport("user32")] static extern bool EnumWindows(E e, IntPtr l);
  [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32")] static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32")] static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32")] static extern bool SystemParametersInfoW(uint a, uint b, ref RECT r, uint c);
  [DllImport("user32")] static extern int GetSystemMetrics(int i);
  [DllImport("shell32")] static extern IntPtr SHAppBarMessage(uint m, ref APPBARDATA d);
  [DllImport("dwmapi")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  static W() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
  static void Physical() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }

  static string Text(IntPtr h) { var s = new StringBuilder(256); GetWindowTextW(h, s, 256); return s.ToString(); }
  static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassNameW(h, s, 256); return s.ToString(); }
  static List<IntPtr> All() { var o = new List<IntPtr>(); EnumWindows((h, l) => { o.Add(h); return true; }, IntPtr.Zero); return o; }
  static IntPtr Mine(uint pid, string title) {
    foreach (var h in All()) { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && Text(h) == title) return h; }
    return IntPtr.Zero;
  }

  public static Dictionary<string, object> Facts(uint pid, string title) {
    Physical();
    var o = new Dictionary<string, object>();
    var h = Mine(pid, title);
    o["found"] = h != IntPtr.Zero;
    if (h == IntPtr.Zero) return o;
    RECT r, c; GetWindowRect(h, out r); GetClientRect(h, out c);
    long ex = GetLong(h, -20).ToInt64();
    var pt = new POINT { X = (r.L + r.R) / 2, Y = (r.T + r.B) / 2 };
    uint q; GetWindowThreadProcessId(GetAncestor(WindowFromPoint(pt), 2), out q);
    o["hwnd"] = h.ToInt64(); o["x"] = r.L; o["y"] = r.T; o["w"] = r.R - r.L; o["h"] = r.B - r.T;
    o["visible"] = IsWindowVisible(h); 
    /* A title bar with its borders takes 39. An undecorated window that can resize keeps 9 of invisible border. */
    o["frameless"] = (r.B - r.T) - (c.B - c.T) < 20;
    o["frame"] = String.Format("window {0}x{1} client {2}x{3} style {4:x}", r.R - r.L, r.B - r.T, c.R - c.L, c.B - c.T, GetLong(h, -16).ToInt64());
    o["topmost"] = (ex & 0x8) != 0; o["transparent"] = (ex & 0x20) != 0; o["layered"] = (ex & 0x80000) != 0; o["noactivate"] = (ex & 0x8000000) != 0;
    o["tool"] = (ex & 0x80) != 0; o["appwindow"] = (ex & 0x40000) != 0;
    o["hit"] = q == pid;
    o["icon"] = SendMessageW(h, 0x7F, new IntPtr(1), IntPtr.Zero) != IntPtr.Zero || SendMessageW(h, 0x7F, IntPtr.Zero, IntPtr.Zero) != IntPtr.Zero;
    return o;
  }
  public static bool Iconic(long h) { return IsIconic(new IntPtr(h)); }
  public static string TitleOf(long h) { return Text(new IntPtr(h)); }
  /* a shown window of one of these processes whose title starts so */
  public static long FindTitled(uint[] pids, string start) {
    var set = new HashSet<uint>(pids);
    foreach (var h in All()) { uint p; GetWindowThreadProcessId(h, out p); if (set.Contains(p) && IsWindowVisible(h) && Text(h).StartsWith(start)) return h.ToInt64(); }
    return 0;
  }
  public static long FindByTitle(string title) { foreach (var h in All()) if (Text(h) == title && IsWindowVisible(h)) return h.ToInt64(); return 0; }
  public static Dictionary<string, object> Bounds(long hwnd) {
    Physical();
    RECT r; DwmGetWindowAttribute(new IntPtr(hwnd), 9, out r, Marshal.SizeOf(typeof(RECT)));
    var o = new Dictionary<string, object>(); o["x"] = r.L; o["y"] = r.T; o["w"] = r.R - r.L; o["h"] = r.B - r.T; return o;
  }
  public static long[] Order(long[] wanted) {
    var set = new HashSet<long>(wanted); var o = new List<long>();
    foreach (var h in All()) if (set.Contains(h.ToInt64())) o.Add(h.ToInt64());
    return o.ToArray();
  }
  public static bool MoveCursor(int x, int y) { Physical(); return SetCursorPos(x, y); }
  [DllImport("user32")] static extern bool GetCursorPos(out POINT p);
  public static POINT CursorAt() { Physical(); POINT p; GetCursorPos(out p); return p; }
  [DllImport("dwmapi", EntryPoint="DwmGetWindowAttribute")] static extern int DwmInt(IntPtr h, int a, out int v, int size);
  /* To the top of the ordinary windows, under every always-on-top one, without taking the focus: a
     window a background process opens can come up under the one in front. Only for our own windows. */
  public static void Raise(long hwnd) {
    var h = new IntPtr(hwnd);
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x13); /* HWND_TOPMOST, no move, size or activate */
    SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x13); /* HWND_NOTOPMOST: the top of the rest */
  }
  /* A test window to the top of the always-on-top band and to the front, as a taskbar click does to
     the taskbar. Only for the check's own test windows. */
  public static void OnTop(long hwnd) {
    var h = new IntPtr(hwnd);
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x3); /* HWND_TOPMOST, no move or size */
    SetForegroundWindow(h);
  }
  /* Other processes' windows shown above this one that reach into the box, always-on-top ones aside:
     "class pid" each, topmost first. Never a title. */
  public static string[] Above(long hwnd, uint[] ours, int l, int t, int r, int b) {
    Physical();
    var mine = new HashSet<uint>(ours); var o = new List<string>();
    foreach (var h in All()) {
      if (h.ToInt64() == hwnd) break;
      uint p; GetWindowThreadProcessId(h, out p);
      if (mine.Contains(p) || !IsWindowVisible(h) || IsIconic(h) || (GetLong(h, -20).ToInt64() & 0x8) != 0) continue;
      int cloaked; if (DwmInt(h, 14, out cloaked, 4) == 0 && cloaked != 0) continue;
      RECT w; GetWindowRect(h, out w);
      if (w.R <= l || w.L >= r || w.B <= t || w.T >= b || w.R <= w.L || w.B <= w.T) continue;
      o.Add(Class(h) + " " + p);
    }
    return o.ToArray();
  }
  /* left is 2 and 4, right is 8 and 16. True if the input went in. */
  public static bool Click(int x, int y, uint downFlag, uint upFlag) {
    Physical(); SetCursorPos(x, y); System.Threading.Thread.Sleep(300);
    var down = new INPUT { type = 0, mi = new MOUSEINPUT { flags = downFlag } };
    var up = new INPUT { type = 0, mi = new MOUSEINPUT { flags = upFlag } };
    uint a = SendInput(1, new[] { down }, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(120);
    uint b = SendInput(1, new[] { up }, Marshal.SizeOf(typeof(INPUT)));
    return a == 1 && b == 1;
  }
  /* one mouse button event: left is 2 down and 4 up */
  public static void Mouse(uint flags) { SendInput(1, new[] { new INPUT { type = 0, mi = new MOUSEINPUT { flags = flags } } }, Marshal.SizeOf(typeof(INPUT))); }
  /* whether the mouse would land on this process here */
  public static bool Lands(int x, int y, uint pid) {
    Physical(); uint q; GetWindowThreadProcessId(GetAncestor(WindowFromPoint(new POINT { X = x, Y = y }), 2), out q); return q == pid;
  }
  public static long CurrentForeground() { return GetForegroundWindow().ToInt64(); }
  public static bool Foreground(long h) { return SetForegroundWindow(new IntPtr(h)); }
  public static void Move(long h, int x, int y) { Physical(); SetWindowPos(new IntPtr(h), IntPtr.Zero, x, y, 0, 0, 0x15); }
  public static void Show(long h, int cmd) { ShowWindow(new IntPtr(h), cmd); }
  public static void Close(long h) { PostMessageW(new IntPtr(h), 0x10, IntPtr.Zero, IntPtr.Zero); }
  /* a dialog box of this process */
  public static long Dialog(uint pid) {
    foreach (var h in All()) { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && Class(h) == "#32770" && IsWindowVisible(h)) return h.ToInt64(); }
    return 0;
  }
  [DllImport("user32")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  /* the window that owns this one, GW_OWNER, or 0 */
  public static long Owner(long h) { return GetWindow(new IntPtr(h), 4).ToInt64(); }
  /* WM_COMMAND with IDOK (1) or IDCANCEL (2) */
  public static void Press(long h, int id) { PostMessageW(new IntPtr(h), 0x111, new IntPtr(id), IntPtr.Zero); }
  [DllImport("user32")] static extern bool EnumChildWindows(IntPtr h, E e, IntPtr l);
  [DllImport("user32")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32")] static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32")] static extern bool IsWindow(IntPtr h);
  public static bool Alive(long h) { return IsWindow(new IntPtr(h)); }
  /* A save dialog's name box: the Edit with control id 1001, as in every save dialog since Vista.
     The first shown Edit in a ComboBox can be the address bar's own, so that is only the fallback. */
  static IntPtr NameBox(IntPtr dialog) {
    IntPtr byId = IntPtr.Zero, first = IntPtr.Zero;
    EnumChildWindows(dialog, (h, l) => {
      if (Class(h) != "Edit" || !IsWindowVisible(h)) return true;
      if (GetDlgCtrlID(h) == 1001) { byId = h; return false; }
      if (first == IntPtr.Zero && Class(GetParent(h)) == "ComboBox") first = h;
      return true;
    }, IntPtr.Zero);
    return byId != IntPtr.Zero ? byId : first;
  }
  /* Every shown Edit in a dialog, as id:its parent's class, to say which one a typed name missed. */
  public static string Edits(long dialog) {
    var seen = new List<string>();
    EnumChildWindows(new IntPtr(dialog), (h, l) => { if (Class(h) == "Edit" && IsWindowVisible(h)) seen.Add(GetDlgCtrlID(h) + ":" + Class(GetParent(h))); return true; }, IntPtr.Zero);
    return string.Join(" ", seen);
  }
  /* Types a path or a name into a save dialog's name box. False if there isn't one, or it didn't take. */
  public static bool SaveName(long dialog, string path) {
    IntPtr found = NameBox(new IntPtr(dialog));
    if (found == IntPtr.Zero) return false;
    SendMessageW(found, 0x0C, IntPtr.Zero, path); /* WM_SETTEXT */
    var s = new StringBuilder(1024); SendMessageW(found, 0x0D, new IntPtr(1024), s); /* WM_GETTEXT */
    return s.ToString() == path;
  }
  public static RECT WorkArea() { RECT r = new RECT(); SystemParametersInfoW(0x30, 0, ref r, 0); return r; }
  public static void SetWorkArea(RECT r) { SystemParametersInfoW(0x2F, 0, ref r, 2); }
  /* True if the OS took it. With a shell running it may not, which is what an app bar is for. */
  public static bool ShrinkWorkArea(int bottom) {
    Physical(); RECT r = WorkArea();
    var want = new RECT { L = r.L, T = r.T, R = r.R, B = r.B - bottom };
    SystemParametersInfoW(0x2F, 0, ref want, 0);
    return WorkArea().B == want.B;
  }
  /* What a docked toolbar does: reserves a strip along the top of the screen. */
  static APPBARDATA Bar(long h) { var d = new APPBARDATA { hwnd = new IntPtr(h), message = 0x8000 + 77, edge = 1 }; d.size = Marshal.SizeOf(typeof(APPBARDATA)); return d; }
  public static void BarOn(long h, int height) {
    Physical(); var d = Bar(h);
    SHAppBarMessage(0, ref d); /* ABM_NEW */
    d.rc = new RECT { L = 0, T = 0, R = GetSystemMetrics(0), B = height };
    SHAppBarMessage(2, ref d); /* ABM_QUERYPOS */
    SHAppBarMessage(3, ref d); /* ABM_SETPOS */
  }
  public static void BarOff(long h) { var d = Bar(h); SHAppBarMessage(1, ref d); }
}
"@
