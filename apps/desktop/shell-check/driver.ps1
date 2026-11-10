# The contract check's other half. It starts the exe on the check app folder, then does what a
# page can't, when the check's hub asks: read window styles, move real windows, change the work
# area, launch a second instance, read the registry. Runs on the Actions Windows runner only.
# Registry writes happen here and nowhere else, and are always cleared again.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [string]$Out = 'results',
  [int]$Soak = 0
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$Exe = (Resolve-Path $Exe).Path
$App = (Resolve-Path $App).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
. (Join-Path $here 'win32.ps1')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("shell-check-" + [guid]::NewGuid().ToString('n').Substring(0, 8))
$data = Join-Path $tmp 'data'
$files = Join-Path $tmp 'files'
$log = Join-Path $Out 'check.log'
New-Item -ItemType Directory -Force $data, $files | Out-Null
Remove-Item $log -ErrorAction SilentlyContinue
'from launch' | Set-Content -NoNewline (Join-Path $files 'launch.buddy')
'relative' | Set-Content -NoNewline (Join-Path $files 'rel.buddy')
'double' | Set-Content -NoNewline (Join-Path $files 'x.buddy.json')
'clicked' | Set-Content -NoNewline (Join-Path $files 'double-click.buddy')
$huge = [IO.File]::Create((Join-Path $files 'huge.buddy')); $huge.SetLength(70MB); $huge.Close()

$results = [System.Collections.Generic.List[string]]::new()
# The handle has to be held from the start, or ExitCode comes back empty.
function Launch([string[]]$argv, $dir = $null) {
  $o = @{ FilePath = $Exe; ArgumentList = $argv; PassThru = $true }
  if ($dir) { $o.WorkingDirectory = $dir }
  $p = Start-Process @o
  [void]$p.Handle
  return $p
}
function Result($state, $name, $detail) { $line = "$state $name $detail"; $results.Add($line); Write-Host $line }

$oldWork = [W]::WorkArea()
$browsers = 'msedge', 'chrome', 'firefox'
$testWindows = [System.Collections.Generic.List[object]]::new()
$script:bar = $null

function Clean-Registry {
  $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  Remove-ItemProperty $run -Name 'Desktop Buddies' -ErrorAction SilentlyContinue
  Remove-Item 'HKCU:\Software\Classes\.buddy' -Recurse -ErrorAction SilentlyContinue
  Remove-Item 'HKCU:\Software\Classes\dev.exvanitas.desktop-buddies.buddy' -Recurse -ErrorAction SilentlyContinue
}

function Do-Step($action, $a) {
  switch ($action) {
    'facts' { return [W]::Facts([uint32]$script:proc.Id, $a.title) }
    'sized' { $f = [IO.File]::Create((Join-Path $data $a.file)); $f.SetLength($a.bytes); $f.Close(); return @{} }
    'grow' {
      $s = [IO.File]::Open((Join-Path $data $a.file), 'Open', 'Write', 'ReadWrite,Delete')
      try {
        [void]$s.Seek(0, 'End')
        $chunk = [byte[]]::new(1MB)
        while ($s.Length -lt $a.to) { $s.Write($chunk, 0, $chunk.Length); $s.Flush(); Start-Sleep -Milliseconds 80 }
      } finally { $s.Close() }
      return @{}
    }
    'browsers' { return @{ count = @(Get-Process $browsers -ErrorAction SilentlyContinue).Count } }
    'close-browsers' { Get-Process $browsers -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; return @{} }
    'second' {
      $t = [Diagnostics.Stopwatch]::StartNew()
      $p = Launch $a.args $files
      if (-not $p.WaitForExit(15000)) { $p.Kill(); throw 'the second launch did not exit' }
      return @{ exit = $p.ExitCode; ms = $t.ElapsedMilliseconds }
    }
    'shell-open' { Start-Process (Join-Path $files $a.file); return @{} }
    'cursor' {
      if (-not [W]::MoveCursor($a.x, $a.y)) { return @{ skipped = 'SetCursorPos failed: no interactive desktop' } }
      return @{}
    }
    'click' {
      $win = Start-TestWindow 'check-focus-holder' 20 20 200 150
      [W]::Foreground($win) | Out-Null
      Start-Sleep -Milliseconds 400
      $before = [W]::CurrentForeground()
      if ($before -ne $win) { [W]::Close($win); return @{ skipped = "could not take the foreground here: $before" } }
      if (-not [W]::Click($a.x, $a.y, 2, 4)) { [W]::Close($win); return @{ skipped = 'SendInput refused: no interactive desktop' } }
      Start-Sleep -Milliseconds 500
      $after = [W]::CurrentForeground()
      [W]::Close($win)
      return @{ same = ($before -eq $after); before = $before; after = $after }
    }
    'right-click' { [void][W]::Click($a.x, $a.y, 8, 16); return @{} }
    'foreground' { return @{ hwnd = [W]::CurrentForeground() } }
    'on-top' { [W]::OnTop($a.hwnd); return @{ hwnd = [W]::CurrentForeground() } }
    'testwin' { return @{ hwnd = (Start-TestWindow $a.title $a.x $a.y $a.w $a.h) } }
    'bounds' { return [W]::Bounds($a.hwnd) }
    'zorder' { return @{ order = [W]::Order([long[]]@($a.hwnds)) } }
    'move' { $at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); [W]::Move($a.hwnd, $a.x, $a.y); return @{ at = $at } }
    'minimize' { $at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); [W]::Show($a.hwnd, 6); return @{ at = $at } }
    'restore' { $at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); [W]::Show($a.hwnd, 9); return @{ at = $at } }
    'close' { $at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); [W]::Close($a.hwnd); return @{ at = $at } }
    'workarea' {
      if ([W]::ShrinkWorkArea($a.bottom)) { return @{ how = 'SPI_SETWORKAREA' } }
      $script:bar = Start-TestWindow 'check-app-bar' 0 0 300 100
      [W]::BarOn($script:bar, $a.bottom)
      return @{ how = 'an app bar' }
    }
    'workarea-restore' { Remove-Bar; [W]::SetWorkArea($oldWork); return @{} }
    'reg-run' {
      $v = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).'Desktop Buddies'
      return @{ value = $v }
    }
    'reg-assoc' {
      $ext = (Get-ItemProperty 'HKCU:\Software\Classes\.buddy' -ErrorAction SilentlyContinue).'(default)'
      $cmd = (Get-ItemProperty 'HKCU:\Software\Classes\dev.exvanitas.desktop-buddies.buddy\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
      return [ordered]@{ ext = $ext; command = $cmd }
    }
    'dialog' {
      $h = 0
      for ($i = 0; $i -lt 60 -and -not $h; $i++) { Start-Sleep -Milliseconds 100; $h = [W]::Dialog([uint32]$script:proc.Id) }
      if (-not $h) { return @{ found = $false } }
      Start-Sleep -Milliseconds 400
      $owner = [W]::Owner($h)
      # With 'where', the dialog is taken to that folder first: the folder in the name box and Save,
      # which a save dialog answers by going there. Then the name alone, so wherever the dialog
      # started, the file can only land in that folder. A full path typed in one go once didn't take.
      # Where it went is read from its address bar: seen there, another folder read there (then it's
      # cancelled), or unverified when nothing could be read, which saves anyway, as the hub's check
      # of the file itself is what decides.
      $typed = $false; $went = ''; $boxes = ''; $navigation = ''
      if ($a.where) {
        $folder = Folder $a.where
        if ([W]::SaveName($h, $folder)) {
          [W]::Press($h, 1)
          [void](Wait-Until { Same-Folder (Dialog-Folder $h) $folder } 5)
          $went = Dialog-Folder $h
          $navigation = if (-not $went) { 'unverified' } elseif (Same-Folder $went $folder) { 'seen' } else { 'other' }
          if ($navigation -ne 'other') { $typed = [W]::Alive($h) -and [W]::SaveName($h, $a.file) }
        }
        if (-not $typed) { $boxes = [W]::Edits($h) }
        if ($navigation -eq 'unverified') { Write-Host "dialog: navigation unverified, nothing could be read from its address bar" }
      }
      # A dialog that never reached the folder, or took no name, is cancelled: a Save there would leave
      # a stray file and a misleading failure.
      $cancelled = $a.action -eq 'cancel' -or ($a.where -and -not $typed)
      if ($cancelled) { [W]::Press($h, 2) } else { [W]::Press($h, 1) }
      # Saving over a file asks first, in a prompt of its own: Yes, pressed through UI Automation. The
      # prompt is a task dialog, which ignores a posted button command.
      $confirmed = $false
      $seen = ''
      if ($a.confirm -and -not $cancelled) {
        for ($i = 0; $i -lt 50 -and -not $confirmed; $i++) {
          Start-Sleep -Milliseconds 100
          $confirmed = Press-Yes ([int]$script:proc.Id)
        }
        if (-not $confirmed) { $seen = Seen-Buttons ([int]$script:proc.Id) }
      }
      return @{ found = $true; owner = $owner; navigation = $navigation; typed = $typed; went = $went; boxes = $boxes; cancelled = [bool]$cancelled; confirmed = $confirmed; seen = $seen }
    }
    # Where a file of this name is, in the folders a save dialog lands in, and what each holds, so a
    # save that missed says where it went. Copies outside this run's folder are its strays, and go.
    'find' {
      $places = @($files, [Environment]::GetFolderPath('MyDocuments'), [Environment]::GetFolderPath('Desktop'), (Join-Path $env:USERPROFILE 'Downloads'), $data)
      $hits = @($places | ForEach-Object { Join-Path $_ $a.file } | Where-Object { Test-Path -LiteralPath $_ })
      if (-not $hits.Count) { $hits = @(Get-ChildItem $env:USERPROFILE -Recurse -Filter $a.file -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object FullName) }
      $found = @($hits | ForEach-Object { [ordered]@{ path = $_; content = (Get-Content -Raw -LiteralPath $_) } })
      $run = (Split-Path $tmp -Leaf).ToLower()
      foreach ($x in $found) { if (-not $x.path.ToLower().Contains($run)) { Remove-Item -LiteralPath $x.path } }
      return @{ found = $found }
    }
    # A file to save over, marked with an attribute a plain rename wouldn't keep.
    'plant' {
      $f = Join-Path (Folder $a.where) $a.name
      $a.content | Set-Content -NoNewline -LiteralPath $f
      (Get-Item -LiteralPath $f).Attributes = 'Archive, NotContentIndexed'
      return @{}
    }
    'list' { return @{ names = @(Get-ChildItem -Force -LiteralPath (Folder $a.where) | ForEach-Object { $_.Name }) } }
    # Whether a file is there, and what it holds. With 'remove', it goes after.
    'peek' {
      $f = Join-Path (Folder $a.where) $a.name
      $left = Test-Path -LiteralPath $f
      $c = if ($left) { Get-Content -Raw -LiteralPath $f } else { $null }
      $attrs = if ($left) { (Get-Item -LiteralPath $f).Attributes.ToString() } else { '' }
      if ($a.remove -and $left) { Remove-Item -LiteralPath $f }
      return @{ left = $left; content = $c; attrs = $attrs }
    }
    'saved-file' {
      $f = Join-Path ([Environment]::GetFolderPath('MyDocuments')) $a.file
      if (-not (Test-Path $f)) { $f = (Get-ChildItem $env:USERPROFILE -Recurse -Filter $a.file -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }
      if (-not $f) { throw 'the saved file was not found' }
      $c = Get-Content -Raw $f
      Remove-Item $f
      return @{ content = $c }
    }
    default { throw "unknown step $action" }
  }
}

# 'files' is the driver's own folder of test files. Anything else is a folder in the data folder.
# The Yes button on a prompt of the app's process, found by UI Automation and invoked. A task dialog's
# Yes is CommandButton_6, a message box's is 6. True once pressed.
function Press-Yes([int]$owner) {
  $uia = [System.Windows.Automation.AutomationElement]
  $ofApp = New-Object System.Windows.Automation.PropertyCondition($uia::ProcessIdProperty, $owner)
  $isButton = New-Object System.Windows.Automation.PropertyCondition($uia::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  foreach ($top in $uia::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $ofApp)) {
    foreach ($button in $top.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isButton)) {
      $aid = $button.Current.AutomationId
      $label = $button.Current.Name -replace '&', ''
      if ($aid -eq 'CommandButton_6' -or $aid -eq '6' -or $label -eq 'Yes') {
        $invoke = $null
        if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { $invoke.Invoke(); return $true }
      }
    }
  }
  return $false
}

# A full path, without its last backslash, or '' for anything else.
function Rooted($s) {
  if ($s -and $s.Trim() -match '^([A-Za-z]:\\|\\\\)') { return $s.Trim().TrimEnd('\') }
  return ''
}
# The folder a save dialog shows, read by structure through UI Automation: the address bar is the
# window class "Address Band Root", which no language renames. Its edit box's value first, then any
# toolbar in it whose name holds a full path after a label. '' when nothing could be read.
function Dialog-Folder($h) {
  $uia = [System.Windows.Automation.AutomationElement]
  try { $top = $uia::FromHandle([IntPtr][long]$h) } catch { return '' }
  $tree = [System.Windows.Automation.TreeScope]::Descendants
  $band = $top.FindFirst($tree, (New-Object System.Windows.Automation.PropertyCondition($uia::ClassNameProperty, 'Address Band Root')))
  if (-not $band) { return '' }
  $isEdit = New-Object System.Windows.Automation.PropertyCondition($uia::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  foreach ($box in $band.FindAll($tree, $isEdit)) {
    $value = $null
    if ($box.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) { $read = Rooted $value.Current.Value; if ($read) { return $read } }
  }
  $isBar = New-Object System.Windows.Automation.PropertyCondition($uia::ControlTypeProperty, [System.Windows.Automation.ControlType]::ToolBar)
  foreach ($bar in $band.FindAll($tree, $isBar)) {
    if ($bar.Current.Name -match '^[^:\\]*: (.+)$') { $read = Rooted $Matches[1]; if ($read) { return $read } }
  }
  return ''
}
# Whether a folder read from a dialog is ours: compared without case or a last backslash, by its
# last parts, as the temp folder may be named in its short form here and in its long one there.
function Same-Folder($shown, $folder) {
  if (-not $shown) { return $false }
  return $shown.TrimEnd('\').ToLower().EndsWith(((Split-Path $tmp -Leaf) + $folder.Substring($tmp.Length)).TrimEnd('\').ToLower())
}
function Wait-Until([scriptblock]$test, $seconds) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  do { if (& $test) { return $true }; Start-Sleep -Milliseconds 100 } while ($t.Elapsed.TotalSeconds -lt $seconds)
  return $false
}

# What a failed Press-Yes saw, for the log: each window of the app's process, its class, and its
# buttons' ids and names. Only the app's own windows, so nothing of anyone else's.
function Seen-Buttons([int]$owner) {
  $uia = [System.Windows.Automation.AutomationElement]
  $ofApp = New-Object System.Windows.Automation.PropertyCondition($uia::ProcessIdProperty, $owner)
  $isButton = New-Object System.Windows.Automation.PropertyCondition($uia::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $parts = @()
  foreach ($top in $uia::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $ofApp)) {
    $ids = @($top.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isButton) | ForEach-Object { "$($_.Current.AutomationId)=$($_.Current.Name)" })
    $parts += "$($top.Current.ClassName)[$($ids -join ',')]"
  }
  $text = if ($parts.Count) { $parts -join ' ' } else { 'no windows of the app' }
  if ($text.Length -gt 600) { $text = $text.Substring(0, 600) }
  return $text
}

function Folder($where) {
  if ($where -eq 'files') { return $files }
  return Join-Path $data $where
}

function Remove-Bar {
  if ($script:bar) { [W]::BarOff($script:bar); [W]::Close($script:bar); $script:bar = $null }
}

function Start-TestWindow($title, $x, $y, $w, $h) {
  # Not -WindowStyle Hidden: that reaches the form's first show, and it never appears.
  $p = Start-Process powershell -ArgumentList '-NoProfile', '-File', "`"$(Join-Path $here 'testwin.ps1')`"", "`"$title`"", $x, $y, $w, $h -PassThru -NoNewWindow
  $testWindows.Add($p)
  for ($i = 0; $i -lt 300; $i++) {
    Start-Sleep -Milliseconds 100
    $hwnd = [W]::FindByTitle($title)
    if ($hwnd) { return $hwnd }
  }
  throw "test window $title did not appear"
}

function Answer($n, $value) {
  $dir = Join-Path $data 'driver'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $json = $value | ConvertTo-Json -Depth 5 -Compress
  $temp = Join-Path $dir ".~$n"
  [IO.File]::WriteAllText($temp, $json)
  Move-Item $temp (Join-Path $dir "$n.json")
}

function Read-Lines {
  if (-not (Test-Path $log)) { return @() }
  $s = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite,Delete')
  try {
    [void]$s.Seek($script:offset, 'Begin')
    $text = [IO.StreamReader]::new($s).ReadToEnd()
  } finally { $s.Close() }
  $end = $text.LastIndexOf("`n")
  if ($end -lt 0) { return @() }
  $script:offset += [Text.Encoding]::UTF8.GetByteCount($text.Substring(0, $end + 1))
  return $text.Substring(0, $end).Split("`n")
}

$failed = $false
try {
  Clean-Registry
  $seconds = 420 + $Soak
  $argv = @('--app-dir', "`"$App`"", '--data-dir', "`"$data`"", '--log', "`"$log`"", '--seconds', $seconds, '--marker', 'passed', '--soak', $Soak, "`"$(Join-Path $files 'launch.buddy')`"")
  $script:proc = Launch $argv
  $script:offset = 0
  $done = $false
  $limit = [DateTime]::Now.AddSeconds($seconds + 30)
  while (-not $proc.HasExited -and [DateTime]::Now -lt $limit) {
    foreach ($raw in Read-Lines) {
      $line = $raw.TrimEnd()
      if ($line -match '^\s*[\d.]+ CHECK (PASS|FAIL|SKIP) (\S+) ?(.*)$') { Result $Matches[1] $Matches[2] $Matches[3] }
      elseif ($line -match '^\s*[\d.]+ STEP (\d+) (\S+) (.*)$') {
        $n = $Matches[1]; $action = $Matches[2]; $argsJson = $Matches[3]
        try { Answer $n (Do-Step $action ($argsJson | ConvertFrom-Json)) }
        catch { Write-Host "step $action failed: $_"; Answer $n @{ error = "$_" } }
      }
      elseif ($line -match '^\s*[\d.]+ DONE$') { $done = $true }
    }
    Start-Sleep -Milliseconds 50
  }
  foreach ($raw in Read-Lines) { if ($raw -match 'CHECK (PASS|FAIL|SKIP) (\S+) ?(.*)$') { Result $Matches[1] $Matches[2] $Matches[3].TrimEnd() } elseif ($raw -match ' DONE') { $done = $true } }

  # Quit, as the hub asked for it.
  if ($proc.WaitForExit(10000)) {
    Result $(if ($proc.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }) 'exit.code' "code $($proc.ExitCode)"
  } else {
    Result 'FAIL' 'exit.code' 'still running'
    $proc.Kill()
  }
  $quit = Select-String -Path $log -Pattern 'quitting seen by the hub' -Quiet
  Result $(if ($quit) { 'PASS' } else { 'FAIL' }) 'exit.quitting' 'the hub saw the event first'
  # API 2: the hub asked the quit to wait, wrote a file 1.5 s later, then said it was ready.
  if (Select-String -Path $log -Pattern 'quit wait asked' -Quiet) {
    $held = Test-Path -LiteralPath (Join-Path $data 'quit-held.txt')
    Result $(if ($held) { 'PASS' } else { 'FAIL' }) 'exit.quit_waited' "the write after the wait $(if ($held) { 'landed' } else { 'never landed' })"
  } else { Result 'SKIP' 'exit.quit_waited' 'API 1: a quit never waits' }
  # API 2 keeps arguments and URLs out of the log: a second launch logs counts and the exe's own
  # flags, and navigation names a scheme.
  $api2 = Select-String -Path $log -Pattern 'CHECK PASS info api 2 ' -Quiet
  $second = @(Select-String -Path $log -Pattern 'second launch' | ForEach-Object { $_.Line })
  $leaked = @($second | Where-Object { $_ -match 'rel\.buddy|--again|huge|missing' })
  $nav = @(Select-String -Path $log -Pattern '^\s*[\d.]+ (navigation|open_external)' | ForEach-Object { $_.Line })
  $urls = @($nav | Where-Object { $_ -match '://|win\.ini' })
  if ($api2) {
    Result $(if ($second.Count -and -not $leaked.Count) { 'PASS' } else { 'FAIL' }) 'log.second_launch' "$($second.Count) lines, $($leaked.Count) with a value"
    Result $(if ($nav.Count -and -not $urls.Count) { 'PASS' } else { 'FAIL' }) 'log.no_urls' "$($nav.Count) navigation lines, $($urls.Count) with a URL"
  } else {
    Result 'SKIP' 'log.second_launch' 'API 1 logs the arguments'
    Result 'SKIP' 'log.no_urls' 'API 1 logs the URL'
  }
  if (-not $done) { Result 'FAIL' 'hub.done' 'the check hub never finished' }

  # WebView2's helpers take a moment to follow the exe out.
  $t = [Diagnostics.Stopwatch]::StartNew()
  do {
    $strays = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'desktop-buddies.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$tmp*") })
    if ($strays.Count) { Start-Sleep -Milliseconds 500 }
  } while ($strays.Count -and $t.Elapsed.TotalSeconds -lt 15)
  Result $(if ($strays.Count -eq 0) { 'PASS' } else { 'FAIL' }) 'exit.no_strays' "$($strays.Count) left after $($t.ElapsedMilliseconds) ms"

  # A hub that never answers: the exe has to get out by itself.
  $t = [Diagnostics.Stopwatch]::StartNew()
  $hungLog = Join-Path $Out 'hung.log'
  $p = Launch @('--app-dir', "`"$(Join-Path $App 'hung')`"", '--data-dir', "`"$tmp\hung-data`"", '--log', "`"$hungLog`"", '--seconds', 6)
  if ($p.WaitForExit(20000)) { Result $(if ($p.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }) 'exit.hung_hub' "code $($p.ExitCode) after $($t.ElapsedMilliseconds) ms" }
  else { Result 'FAIL' 'exit.hung_hub' 'still running'; $p.Kill() }

  # No app folder: a plain error, and out.
  $noneLog = Join-Path $Out 'none.log'
  $p = Launch @('--app-dir', "`"$tmp\no-such-folder`"", '--data-dir', "`"$tmp\none-data`"", '--log', "`"$noneLog`"")
  $h = 0
  for ($i = 0; $i -lt 100 -and -not $h; $i++) { Start-Sleep -Milliseconds 100; $h = [W]::Dialog([uint32]$p.Id) }
  if ($h) { [W]::Press($h, 2) }
  if ($p.WaitForExit(8000)) {
    $said = Select-String -Path $noneLog -Pattern 'app folder is missing' -Quiet
    Result $(if ($h -and $said -and $p.ExitCode -eq 1) { 'PASS' } else { 'FAIL' }) 'start.no_app' "dialog $([bool]$h) log $said code $($p.ExitCode)"
  } else { Result 'FAIL' 'start.no_app' 'still running'; $p.Kill() }
}
catch { Result 'FAIL' 'driver' "$_ at $($_.InvocationInfo.ScriptLineNumber)" }
finally {
  Remove-Bar
  [W]::SetWorkArea($oldWork)
  Clean-Registry
  foreach ($p in $testWindows) { if (-not $p.HasExited) { $p.Kill() } }
  Get-Process desktop-buddies -ErrorAction SilentlyContinue | Stop-Process -Force
}

$results | Set-Content (Join-Path $Out 'contract.txt')
$pass = @($results | Where-Object { $_ -like 'PASS *' }).Count
$skip = @($results | Where-Object { $_ -like 'SKIP *' })
$fail = @($results | Where-Object { $_ -like 'FAIL *' })
$summary = @("### Contract check", "$pass passed, $($fail.Count) failed, $($skip.Count) skipped", '') + ($fail + $skip | ForEach-Object { "- $_" })
$summary -join "`n" | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { $summary -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY }
if ($fail.Count -or $pass -eq 0) { exit 1 }
exit 0
