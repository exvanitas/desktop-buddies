# The edge shots' surface: a plain window of one colour, no title bar or border, at a known place in
# physical pixels. A normal window, so the tracker lists it. Stays until it's closed.
param([string]$Title, [int]$X, [int]$Y, [int]$W, [int]$H, [string]$Colour)
Add-Type -Language CSharp @"
using System; using System.Runtime.InteropServices;
public static class Dpi { [DllImport("user32")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c); }
"@
[void][Dpi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.Text = $Title
$f.FormBorderStyle = 'None'
$f.StartPosition = 'Manual'
$f.BackColor = [System.Drawing.ColorTranslator]::FromHtml($Colour)
$f.Location = New-Object System.Drawing.Point($X, $Y)
$f.Size = New-Object System.Drawing.Size($W, $H)
$f.Add_Shown({ $f.Location = New-Object System.Drawing.Point($X, $Y); $f.Size = New-Object System.Drawing.Size($W, $H) })
[System.Windows.Forms.Application]::Run($f)
