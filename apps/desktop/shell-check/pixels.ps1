# Screen pixels for the edge shots: capture, compare, crop and lay out. Physical pixels throughout.
# For Windows PowerShell, where System.Drawing is one assembly.
Add-Type -AssemblyName System.Drawing
$drawing = @([System.Drawing.Bitmap].Assembly.Location, [System.Drawing.Color].Assembly.Location) | Select-Object -Unique
Add-Type -ReferencedAssemblies $drawing -Language CSharp @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class Px {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [DllImport("user32")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32")] static extern int GetSystemMetrics(int i);
  [DllImport("user32")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
  [DllImport("user32")] static extern bool SetSysColors(int n, int[] which, int[] colours);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern bool SystemParametersInfoW(uint a, uint b, string c, uint d);
  delegate bool E(IntPtr h, IntPtr l);
  [DllImport("user32")] static extern bool EnumWindows(E e, IntPtr l);
  [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  static void Physical() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }

  /* A process's visible always-on-top windows: for this app, its overlays. */
  public static long[] Topmost(uint pid) {
    /* no List: with the drawing references named, Add-Type leaves System.Collections out */
    var o = new long[0];
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h) && (GetLong(h, -20).ToInt64() & 0x8) != 0) { Array.Resize(ref o, o.Length + 1); o[o.Length - 1] = h.ToInt64(); } return true; }, IntPtr.Zero);
    return o;
  }

  /* x, y, w, h of the whole virtual screen */
  public static int[] Screen() { Physical(); return new[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) }; }
  /* width and height of the primary monitor, which starts at 0,0 */
  public static int[] Primary() { Physical(); return new[] { GetSystemMetrics(0), GetSystemMetrics(1) }; }
  /* GDI's copy of the screen. CAPTUREBLT asks for layered windows too. */
  public static void Shot(string path) {
    int[] s = Screen();
    using (var b = new Bitmap(s[2], s[3], PixelFormat.Format24bppRgb))
    using (var g = Graphics.FromImage(b)) {
      /* BitBlt by hand: CopyFromScreen on .NET Framework refuses SRCCOPY with CAPTUREBLT. */
      IntPtr screen = GetDC(IntPtr.Zero), dc = g.GetHdc();
      BitBlt(dc, 0, 0, s[2], s[3], screen, s[0], s[1], 0x00CC0020 | 0x40000000);
      g.ReleaseHdc(dc); ReleaseDC(IntPtr.Zero, screen);
      b.Save(path, ImageFormat.Png);
    }
  }
  /* One window's own content, as PrintWindow with PW_RENDERFULLCONTENT draws it. */
  public static bool Window(long hwnd, string path) {
    Physical(); RECT r; GetWindowRect(new IntPtr(hwnd), out r);
    int w = Math.Max(1, r.R - r.L), h = Math.Max(1, r.B - r.T); bool ok;
    using (var b = new Bitmap(w, h, PixelFormat.Format24bppRgb))
    using (var g = Graphics.FromImage(b)) {
      IntPtr dc = g.GetHdc(); ok = PrintWindow(new IntPtr(hwnd), dc, 2); g.ReleaseHdc(dc);
      b.Save(path, ImageFormat.Png);
    }
    return ok;
  }
  /* A plain desktop: no wallpaper, one colour. */
  public static void Desktop(int r, int g, int b) {
    SystemParametersInfoW(0x14, 0, "", 3);
    SetSysColors(1, new[] { 1 }, new[] { r | (g << 8) | (b << 16) });
  }

  static int[] Read(Bitmap b) {
    var d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var px = new int[b.Width * b.Height]; Marshal.Copy(d.Scan0, px, 0, px.Length); b.UnlockBits(d); return px;
  }
  static Bitmap Load(string path) { using (var f = new Bitmap(path)) return new Bitmap(f); }
  static int Far(int a, int b) { int m = 0; for (int s = 0; s < 24; s += 8) m = Math.Max(m, Math.Abs(((a >> s) & 255) - ((b >> s) & 255))); return m; }

  /* Pixels in a box that differ between two shots by more than `tol` in some channel: how many, and the box around them. */
  public static int[] Diff(string a, string b, int x, int y, int w, int h, int tol) {
    using (var A = Load(a)) using (var B = Load(b)) {
      int W = A.Width, H = A.Height; var pa = Read(A); var pb = Read(B);
      int n = 0, x0 = int.MaxValue, y0 = int.MaxValue, x1 = -1, y1 = -1;
      for (int j = Math.Max(0, y); j < Math.Min(H, y + h); j++) for (int i = Math.Max(0, x); i < Math.Min(W, x + w); i++) {
        if (Far(pa[j * W + i], pb[j * W + i]) <= tol) continue;
        n++; x0 = Math.Min(x0, i); y0 = Math.Min(y0, j); x1 = Math.Max(x1, i); y1 = Math.Max(y1, j);
      }
      return n > 0 ? new[] { n, x0, y0, x1, y1 } : new[] { 0, -1, -1, -1, -1 };
    }
  }
  /* Pixels in a box that aren't see-through: how many. */
  public static int Solid(string a, int x, int y, int w, int h) {
    using (var A = Load(a)) {
      int W = A.Width, H = A.Height, n = 0; var p = Read(A);
      for (int j = Math.Max(0, y); j < Math.Min(H, y + h); j++) for (int i = Math.Max(0, x); i < Math.Min(W, x + w); i++) if (((p[j * W + i] >> 24) & 255) > 0 && (p[j * W + i] & 0xffffff) != 0) n++;
      return n;
    }
  }
  /* A box out of a shot, each pixel made `k` by `k`. What falls off the shot is magenta. */
  public static void Crop(string src, int x, int y, int w, int h, int k, string dst) {
    using (var A = Load(src)) using (var C = new Bitmap(w * k, h * k, PixelFormat.Format32bppArgb)) {
      int W = A.Width, H = A.Height; var p = Read(A); var o = new int[w * k * h * k];
      for (int j = 0; j < h * k; j++) for (int i = 0; i < w * k; i++) {
        int sx = x + i / k, sy = y + j / k;
        o[j * w * k + i] = sx >= 0 && sy >= 0 && sx < W && sy < H ? p[sy * W + sx] : unchecked((int)0xffff00ff);
      }
      var d = C.LockBits(new Rectangle(0, 0, C.Width, C.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      Marshal.Copy(o, 0, d.Scan0, o.Length); C.UnlockBits(d);
      C.Save(dst, ImageFormat.Png);
    }
  }
  /* A sheet: one row a shot, one column a file. `marks` says where each crop's surface line is,
     as "h,<y>" or "v,<x>" in the crop's own pixels, drawn as red ticks outside it. */
  public static void Sheet(string dst, string[] heads, string[] rows, string[] cells, string[] marks) {
    int cols = heads.Length, label = 300, pad = 14, top = 34;
    var imgs = new Bitmap[cells.Length]; var colW = new int[cols]; var rowH = new int[rows.Length];
    for (int c = 0; c < cells.Length; c++) {
      if (String.IsNullOrEmpty(cells[c])) continue;
      imgs[c] = Load(cells[c]);
      colW[c % cols] = Math.Max(colW[c % cols], imgs[c].Width); rowH[c / cols] = Math.Max(rowH[c / cols], imgs[c].Height);
    }
    int width = label; foreach (var w in colW) width += Math.Max(w, 120) + 2 * pad;
    int height = top; foreach (var h in rowH) height += Math.Max(h, 20) + 2 * pad;
    using (var S = new Bitmap(width, height, PixelFormat.Format32bppArgb))
    using (var g = Graphics.FromImage(S))
    using (var font = new Font("Segoe UI", 11f, GraphicsUnit.Pixel))
    using (var red = new Pen(Color.Red, 2f)) {
      g.Clear(Color.White);
      g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
      g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
      int x = label; for (int c = 0; c < cols; c++) { g.DrawString(heads[c], font, Brushes.Black, x + pad, 8); x += Math.Max(colW[c], 120) + 2 * pad; }
      int y = top;
      for (int r = 0; r < rows.Length; r++) {
        int h = Math.Max(rowH[r], 20) + 2 * pad;
        g.DrawLine(Pens.Gainsboro, 0, y, width, y);
        g.DrawString(rows[r], font, Brushes.Black, new RectangleF(6, y + pad, label - 12, h - 2 * pad));
        x = label;
        for (int c = 0; c < cols; c++) {
          var im = imgs[r * cols + c];
          if (im != null) {
            int ix = x + pad, iy = y + pad;
            g.DrawImage(im, new Rectangle(ix, iy, im.Width, im.Height));
            var m = marks[r * cols + c].Split(',');
            if (m.Length == 2) {
              int at = int.Parse(m[1]);
              if (m[0] == "h") { g.DrawLine(red, ix - 12, iy + at, ix - 2, iy + at); g.DrawLine(red, ix + im.Width + 2, iy + at, ix + im.Width + 12, iy + at); }
              else { g.DrawLine(red, ix + at, iy - 12, ix + at, iy - 2); g.DrawLine(red, ix + at, iy + im.Height + 2, ix + at, iy + im.Height + 12); }
            }
          }
          x += Math.Max(colW[c], 120) + 2 * pad;
        }
        y += h;
      }
      S.Save(dst, ImageFormat.Png);
    }
    foreach (var im in imgs) if (im != null) im.Dispose();
  }
}
"@
