# The per-user installer on the Actions Windows runner: an older build installed silently and run once
# as smoke runs it, upgraded to this one as winget does it, run again, then uninstalled silently.
#   old: -OldSetup, the same build with one app file more (-OldOnly), installs with that file
#   run: the installed exe finds the installed app folder, takes the test buddy (first-buddy.ps1),
#     quits by itself, leaves no process behind, and writes its settings and library
#   upgrade: as winget's UpgradeBehavior install does it, -Setup with /S straight over the old install,
#     with Start with Windows on. The old file is gone, the Run value is as it was, and every data file
#     is kept, by its hash
#   install: the exe is -Exe byte for byte, the app folder is -App file for file, the licence files are
#     there and nothing else, the Start menu entry points at the exe, and Installed apps has it at -Version
#   second: the upgraded install runs, on the data the first run left
#   uninstall: the program folder, the shortcuts and the Installed apps entry are gone, and every data
#     file in %APPDATA% is kept, by its hash
# It installs into this user's real profile, so it refuses to run anywhere but the Actions runner, and
# only on one that has never had the app. Once past those checks, everything this run made is its own,
# and the cleanup takes it all away again, data included, so the runner is as it was.
#
# -SetupOnly runs the checks and stops before the install: no window, no process, no mouse. Any error
# ends the run with "FAIL run.error <message> at line <n>" in -Out's installer-check.txt, written before
# the cleanup, which notes its own errors and never hides that one.
param(
  [Parameter(Mandatory)][string]$Setup,
  [Parameter(Mandatory)][string]$OldSetup,
  [Parameter(Mandatory)][string]$OldOnly,
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [Parameter(Mandatory)][string]$Version,
  [string]$Out = 'results',
  [int]$Seconds = 25,
  [switch]$SetupOnly
)
$ErrorActionPreference = 'Stop'

# PowerShell's names ignore case: a script variable named like a parameter is that parameter, and
# takes its type. So nothing below reuses a parameter's name in any case.
$results = [System.Collections.Generic.List[string]]::new()
$resultsFile = ''
function Expect($what, $ok, $detail = '') {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) $what $detail"
  $results.Add($line); Write-Host $line
}
function Note($line) { $results.Add("INFO $line"); Write-Host "INFO $line" }
# Never throws: results go to the file once -Out is made, and to the console always.
function Save-Results {
  if (-not $script:resultsFile) { Write-Host 'no installer-check.txt: -Out was never made'; return }
  try { $results | Set-Content -LiteralPath $script:resultsFile -Encoding UTF8 } catch { Write-Host "could not write $($script:resultsFile): $($_.Exception.Message)" }
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
# An error outside the try below stops the run: said with its line, and kept in installer-check.txt.
trap {
  $msg = "FAIL run.error $(Error-Line $_)"
  Write-Host $msg; Write-Host $_.ScriptStackTrace
  try { if ($null -ne $results) { $results.Add($msg); if ($Out -and (Test-Path -LiteralPath $Out -PathType Container)) { $results | Set-Content -LiteralPath (Join-Path $Out 'installer-check.txt') } } } catch { Write-Host "could not save: $($_.Exception.Message)" }
  break
}

function Hash-Of($path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
# Paths below a folder, relative to it, sorted.
function Files-In($dir) {
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return @() }
  return @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($dir.Length + 1) } | Sort-Object)
}
# Every file below a folder by its relative path and hash, one per line, sorted: equal only if all are.
function Snapshot($dir) { if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return '' }; return (@(Get-ChildItem -LiteralPath $dir -Recurse -File -Force | ForEach-Object { "$($_.FullName.Substring($dir.Length + 1)) $(Hash-Of $_.FullName)" } | Sort-Object) -join "`n") }
# A path inside a folder, by whole folder names: C:\a\Desktop Buddies2 isn't inside C:\a\Desktop Buddies.
# Start with Windows: the value under Run named for the product, or $null.
function Run-Value { return (Get-ItemProperty -LiteralPath $runKey -Name $product -ErrorAction SilentlyContinue).$product }
function Under($path, $dir) { return [bool]$path -and $path.StartsWith($dir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) }

# What the cleanup reads. Each stays empty until the step that makes it. Nothing is this run's to clean
# up until $owned, set once the profile is known to have had none of it.
$owned = $false; $appProc = $null; $installed = $false; $installDir = ''; $uninstaller = ''; $work = ''; $log = ''; $exeName = ''
$userData = ''; $webData = ''; $productKey = ''; $makerKey = ''; $makerKeyWas = $true; $runKey = ''; $product = ''; $seededRun = $false

try {
  # ---------- the parameters, and nothing started yet
  if ($env:GITHUB_ACTIONS -ne 'true') { throw 'this installs into the real user profile, so it runs on the Actions runner only' }
  if (-not (Test-Path -LiteralPath $Setup -PathType Leaf)) { throw "-Setup '$Setup' is not a file" }
  if (-not (Test-Path -LiteralPath $OldSetup -PathType Leaf)) { throw "-OldSetup '$OldSetup' is not a file" }
  if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "-Exe '$Exe' is not a file" }
  if (-not (Test-Path -LiteralPath $App -PathType Container)) { throw "-App '$App' is not a folder" }
  if ($OldOnly -notmatch '^app\\[\w.-]+$') { throw "-OldOnly '$OldOnly' isn't a file in app, like app\old-only.js" }
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "-Version '$Version' isn't a version like 1.2.3" }
  if ($Seconds -lt 10) { throw "-Seconds $Seconds is below 10" }
  $Setup = (Resolve-Path -LiteralPath $Setup).Path
  $OldSetup = (Resolve-Path -LiteralPath $OldSetup).Path
  $Exe = (Resolve-Path -LiteralPath $Exe).Path
  $App = (Resolve-Path -LiteralPath $App).Path
  New-Item -ItemType Directory -Force $Out | Out-Null
  $Out = (Resolve-Path -LiteralPath $Out).Path
  $resultsFile = Join-Path $Out 'installer-check.txt'
  Note "mode $(if ($SetupOnly) { 'setup only: stops before the install' } else { 'full run' })"
  . (Join-Path $PSScriptRoot 'first-buddy.ps1')

  # Where Tauri's per-user NSIS installer puts things, by the product name.
  $exeName = Split-Path -Leaf $Exe
  $product = 'Desktop Buddies'
  $installDir = Join-Path $env:LOCALAPPDATA $product
  $installedExe = Join-Path $installDir $exeName
  $installedApp = Join-Path $installDir 'app'
  $uninstaller = Join-Path $installDir 'uninstall.exe'
  $arpKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
  # where the installer keeps its install folder, which its uninstaller leaves
  $makerKey = 'HKCU:\Software\exvanitas'
  $productKey = "$makerKey\$product"
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $menuLink = Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk"
  $deskLink = Join-Path ([Environment]::GetFolderPath('Desktop')) "$product.lnk"
  # The app's own folders: the library and settings, and WebView2's.
  $userData = Join-Path $env:APPDATA 'dev.exvanitas.desktop-buddies'
  $webData = Join-Path $env:LOCALAPPDATA 'dev.exvanitas.desktop-buddies'
  $log = Join-Path $userData 'logs\app.log'
  $root = Join-Path $PSScriptRoot '..\..\..'
  $licences = @('LICENSE', 'NOTICE', 'TRADEMARKS.md')
  foreach ($name in $licences) { if (-not (Test-Path -LiteralPath (Join-Path $root $name) -PathType Leaf)) { throw "there's no $name at the root" } }
  foreach ($place in $installDir, $menuLink, $deskLink, $arpKey, $productKey, $userData, $webData) {
    if (Test-Path -LiteralPath $place) { throw "$place is there already: this needs a runner that has never had the app" }
  }
  if ($null -ne (Get-ItemProperty -LiteralPath $runKey -Name $product -ErrorAction SilentlyContinue)) { throw "Start with Windows is on already: this needs a runner that has never had the app" }
  $makerKeyWas = Test-Path -LiteralPath $makerKey
  $wantApp = Files-In $App
  if ($wantApp.Count -eq 0) { throw "-App '$App' is empty" }
  if ($wantApp -contains $OldOnly.Substring(4)) { throw "-OldOnly '$OldOnly' is in this build too" }
  Expect 'setup.checks' $true "setup $Setup, old $OldSetup, app $App ($($wantApp.Count) files), version $Version, out $Out"

  if ($SetupOnly) {
    Note 'setup_only stopped before the install: no window opened, no process started, no mouse moved'
  } else {
    if (Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exeName)) -ErrorAction SilentlyContinue) { throw 'Desktop Buddies is running already' }
    # An installer or uninstaller with one switch, waited for. Its exit code comes back.
    function Run-Silent($path, $flag, $what) {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $path; $psi.Arguments = $flag; $psi.UseShellExecute = $false
      $p = [System.Diagnostics.Process]::Start($psi)
      if (-not $p.WaitForExit(180000)) { $p.Kill(); throw "$what did not finish in 3 minutes" }
      return $p.ExitCode
    }
    function Wait-For($what, [scriptblock]$test, $limit = 60) {
      $t = [Diagnostics.Stopwatch]::StartNew()
      do { if (& $test) { return $true }; Start-Sleep -Milliseconds 250 } while ($t.Elapsed.TotalSeconds -lt $limit)
      Write-Host "gave up waiting for $what"
      return $false
    }
    function Uninstall-Done { return -not (Test-Path -LiteralPath $uninstaller) -and -not (Test-Path -LiteralPath $arpKey) }
    # The exe from the install folder, and WebView2's helpers on the app's own WebView2 folder.
    function Ours {
      return @(Get-CimInstance Win32_Process | Where-Object {
        (Under $_.ExecutablePath $installDir) -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($webData, [StringComparison]::OrdinalIgnoreCase) -ge 0)
      })
    }
    # The installed exe, once, as smoke runs it, on the data folder a user gets. Waited for.
    function Launch([string]$argline) {
      $t = [Diagnostics.Stopwatch]::StartNew()
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $installedExe; $psi.UseShellExecute = $false; $psi.Arguments = $argline
      $script:appProc = [System.Diagnostics.Process]::Start($psi)
      $done = $script:appProc.WaitForExit(($Seconds + 30) * 1000)
      $code = if ($done) { $script:appProc.ExitCode } else { 'none, still running' }
      return @{ ok = ($done -and $script:appProc.ExitCode -eq 0); said = "code $code after $($t.ElapsedMilliseconds) ms" }
    }
    function Read-Log { if (Test-Path -LiteralPath $log) { return [IO.File]::ReadAllText($log) }; return '' }
    function Errors-In($text) { return @($text -split "`r?`n" | Where-Object { $_ -match '\b(error|rejected|hub error|failed)\b' }) }
    $shell = New-Object -ComObject WScript.Shell
    function Link-Target($lnk) { if (Test-Path -LiteralPath $lnk) { return $shell.CreateShortcut($lnk).TargetPath }; return '' }
    function Plain($names) { return @($names | ForEach-Object { if ($_ -eq $exeName) { 'the exe' } else { $_ } }) -join ', ' }
    $appLine = 'app ' + [regex]::Escape($installedApp) + ' data '

    # From here, what's in those places is this run's, and the cleanup takes it away.
    $owned = $true
    $work = Join-Path ([IO.Path]::GetTempPath()) ('installer-check-' + [guid]::NewGuid().ToString('n').Substring(0, 8))
    New-Item -ItemType Directory -Force $work | Out-Null

    # ---------- the older build
    $installed = $true
    $code = Run-Silent $OldSetup '/S' 'the old install'
    Expect 'old.exit' ($code -eq 0) "code $code"
    Expect 'old.has_its_file' (Test-Path -LiteralPath (Join-Path $installDir $OldOnly) -PathType Leaf) "$OldOnly, which this build doesn't have"

    # ---------- run once on it, on a fresh data folder
    $ran = Launch ((@('--seconds', $Seconds, '--no-manager') + (First-Buddy $installedApp $userData $work)) -join ' ')
    Expect 'run.exit' $ran.ok $ran.said
    $t = [Diagnostics.Stopwatch]::StartNew()
    Expect 'run.no_strays' (Wait-For 'its processes to go' { (Ours).Count -eq 0 } 15) "$((Ours).Count) left after $($t.ElapsedMilliseconds) ms"
    $text = Read-Log
    $bad = Errors-In $text
    Expect 'run.log_no_errors' ($text.Length -gt 0 -and $bad.Count -eq 0) "$($text.Length) characters; $(($bad | Select-Object -First 5) -join ' | ')"
    Expect 'run.log_app_folder' ($text -match $appLine) 'the installed exe found the installed app folder'
    Expect 'run.log_hub_up' ($text -match 'hub up: \d+ monitors, 1 in the library, 1 out') ([regex]::Match($text, 'hub up: [^\r\n]*').Value)
    Expect 'run.log_clean_quit' ($text -match 'quit: time limit reached')
    $buddy = Get-ChildItem -LiteralPath (Join-Path $userData 'library') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '.*' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'buddy.json')) } | Select-Object -First 1
    Expect 'run.buddy_saved' ([bool]$buddy) "in the library: $(if ($buddy) { $buddy.Name } else { 'nobody' })"
    $beforeUpgrade = Snapshot $userData
    Expect 'run.data_written' ($beforeUpgrade -match '(?m)^settings\.json ' -and $beforeUpgrade -match '(?m)^library\\[^\r\n]*\\buddy\.json ') "$(@($beforeUpgrade -split "`n").Count) files in %APPDATA%"

    # ---------- upgrade, as winget's UpgradeBehavior install does it: the new setup straight over the
    # old install, with nothing uninstalled first. Start with Windows is on, as a user may have it.
    $runValue = '"' + $installedExe + '"'
    New-ItemProperty -LiteralPath $runKey -Name $product -Value $runValue -PropertyType String | Out-Null
    $seededRun = $true
    $t = [Diagnostics.Stopwatch]::StartNew()
    $code = Run-Silent $Setup '/S' 'the install'
    Expect 'install.exit' ($code -eq 0) "code $code after $($t.ElapsedMilliseconds) ms"
    Expect 'upgrade.old_file_gone' (-not (Test-Path -LiteralPath (Join-Path $installDir $OldOnly))) "$OldOnly"
    Expect 'upgrade.run_value_kept' ((Run-Value) -eq $runValue) "Start with Windows: $(if ($null -eq (Run-Value)) { 'gone' } else { 'as it was' })"
    Expect 'upgrade.data_kept' ((Snapshot $userData) -eq $beforeUpgrade) 'every file in %APPDATA%, by its hash'

    # ---------- this build, installed
    Expect 'install.exe_same' ((Test-Path -LiteralPath $installedExe) -and (Hash-Of $installedExe) -eq (Hash-Of $Exe)) 'the installed exe is the one given, byte for byte'
    $gotApp = Files-In $installedApp
    $differ = @($wantApp | Where-Object { -not (Test-Path -LiteralPath (Join-Path $installedApp $_)) -or (Hash-Of (Join-Path $installedApp $_)) -ne (Hash-Of (Join-Path $App $_)) })
    $extra = @($gotApp | Where-Object { $wantApp -notcontains $_ })
    Expect 'install.app_same' ($differ.Count -eq 0 -and $extra.Count -eq 0) "$($gotApp.Count) of $($wantApp.Count) files; missing or changed: $(($differ | Select-Object -First 5) -join ', '); extra: $(($extra | Select-Object -First 5) -join ', ')"
    $top = @(Get-ChildItem -LiteralPath $installDir -Force -ErrorAction SilentlyContinue | ForEach-Object Name | Sort-Object)
    $wantTop = @(@('app', $exeName, 'THIRD-PARTY-NOTICES.txt', 'uninstall.exe') + $licences | Sort-Object)
    Expect 'install.top_files' (($top -join '|') -eq ($wantTop -join '|')) "holds $(Plain $top)"
    $sameLicences = @($licences | Where-Object { (Test-Path -LiteralPath (Join-Path $installDir $_)) -and (Hash-Of (Join-Path $installDir $_)) -eq (Hash-Of (Join-Path $root $_)) })
    Expect 'install.licences' ($sameLicences.Count -eq $licences.Count) "$($sameLicences -join ', ') as in the repo"
    Expect 'install.start_menu' ((Link-Target $menuLink) -eq $installedExe) "$product in the Start menu, to the installed exe"
    Note "desktop shortcut: $(if ((Link-Target $deskLink) -eq $installedExe) { 'made, to the installed exe' } else { 'none' })"
    $arp = Get-ItemProperty -LiteralPath $arpKey -ErrorAction SilentlyContinue
    $arpOk = $arp -and $arp.DisplayName -eq $product -and $arp.DisplayVersion -eq $Version -and $arp.Publisher -eq 'exvanitas' -and ([string]$arp.UninstallString).Trim('"') -eq $uninstaller
    Expect 'install.arp' $arpOk "Installed apps: '$($arp.DisplayName)' '$($arp.DisplayVersion)' by '$($arp.Publisher)'"

    # ---------- run the upgraded install, on what the first run left
    $before = (Read-Log).Length
    $ran = Launch ((@('--seconds', $Seconds, '--no-manager') + (First-Buddy $installedApp $userData $work)) -join ' ')
    Expect 'second.exit' $ran.ok $ran.said
    $t = [Diagnostics.Stopwatch]::StartNew()
    Expect 'second.no_strays' (Wait-For 'its processes to go' { (Ours).Count -eq 0 } 15) "$((Ours).Count) left after $($t.ElapsedMilliseconds) ms"
    $text = Read-Log
    $text2 = if ($text.Length -gt $before) { $text.Substring($before) } else { '' }
    $bad = Errors-In $text2
    Expect 'second.log_no_errors' ($text2.Length -gt 0 -and $bad.Count -eq 0) "$($text2.Length) characters; $(($bad | Select-Object -First 5) -join ' | ')"
    Expect 'second.log_app_folder' ($text2 -match $appLine) 'the upgraded exe found the installed app folder'
    $beforeUninstall = Snapshot $userData

    # ---------- uninstall
    $t = [Diagnostics.Stopwatch]::StartNew()
    $code = Run-Silent $uninstaller '/S' 'the uninstall'
    Expect 'uninstall.exit' ($code -eq 0) "code $code"
    Expect 'uninstall.done' (Wait-For 'the uninstall' { Uninstall-Done }) "after $($t.ElapsedMilliseconds) ms"
    $gone = Wait-For 'the program folder to go' { -not (Test-Path -LiteralPath $installDir) } 15
    $installed = -not $gone
    Expect 'uninstall.files_gone' $gone "left: $(Plain (Files-In $installDir))"
    Expect 'uninstall.start_menu_gone' (-not (Test-Path -LiteralPath $menuLink))
    Expect 'uninstall.desktop_gone' (-not (Test-Path -LiteralPath $deskLink))
    Expect 'uninstall.arp_gone' (-not (Test-Path -LiteralPath $arpKey))
    Expect 'uninstall.data_kept' ((Snapshot $userData) -eq $beforeUninstall) "every file in %APPDATA%, by its hash: $(@($beforeUninstall -split "`n").Count) files"
    Note "WebView2 folder: $(if (Test-Path -LiteralPath $webData) { 'kept' } else { 'gone' })"
  }
} catch {
  # written before any cleanup, so a cleanup that goes wrong can't lose it
  Expect 'run.error' $false (Error-Line $_)
  Write-Host $_.ScriptStackTrace
  Save-Results
} finally {
  # Only what this run made. A run that stopped at its checks owns nothing, and touches nothing.
  Tidy 'exe' { if ($owned -and $appProc -and -not $appProc.HasExited) { Stop-Process -Id $appProc.Id -Force; [void]$appProc.WaitForExit(10000); Note 'the app was stopped by its PID' } }
  Tidy 'strays' { if ($owned -and $installDir) { foreach ($s in @(Get-CimInstance Win32_Process | Where-Object { Under $_.ExecutablePath $installDir })) { Stop-Process -Id $s.ProcessId -Force; Note 'a process left in the program folder was stopped by its PID' } } }
  Tidy 'uninstall' { if ($owned -and $installed -and (Test-Path -LiteralPath $uninstaller)) { [void](Run-Silent $uninstaller '/S' 'the cleanup uninstall'); [void](Wait-For 'the cleanup uninstall' { Uninstall-Done }); Note 'uninstalled in the cleanup' } }
  Tidy 'log' { if ($owned -and $resultsFile -and (Test-Path -LiteralPath $log)) { Copy-Item -LiteralPath $log -Destination (Join-Path $Out 'installer-check.log') } }
  Tidy 'work' { if ($owned -and $work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force } }
  # what a passing run kept, on purpose, for the checks above: gone now, so the runner is as it was
  Tidy 'webview-wait' { if ($owned -and $webData) { [void](Wait-For 'WebView2 to let go' { @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($webData, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -eq 0 } 15) } }
  Tidy 'data' { if ($owned -and (Test-Path -LiteralPath $userData)) { Remove-Item -LiteralPath $userData -Recurse -Force } }
  Tidy 'webview-data' { if ($owned -and (Test-Path -LiteralPath $webData)) { Remove-Item -LiteralPath $webData -Recurse -Force } }
  Tidy 'registry' { if ($owned -and (Test-Path -LiteralPath $productKey)) { Remove-Item -LiteralPath $productKey -Recurse -Force } }
  Tidy 'run-value' { if ($owned -and $seededRun -and $null -ne (Run-Value)) { Remove-ItemProperty -LiteralPath $runKey -Name $product -Force } }
  Tidy 'registry-maker' { if ($owned -and -not $makerKeyWas -and (Test-Path -LiteralPath $makerKey) -and -not (Get-ChildItem -LiteralPath $makerKey) -and -not (Get-Item -LiteralPath $makerKey).Property) { Remove-Item -LiteralPath $makerKey -Force } }
  Tidy 'links' { if ($owned -and -not $installed) { foreach ($lnk in $menuLink, $deskLink) { if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force; Note "a shortcut the uninstall left was removed" } } } }
  Save-Results
}
$fails = @($results | Where-Object { $_ -like 'FAIL *' })
$passes = @($results | Where-Object { $_ -like 'PASS *' }).Count
$summary = @('### Installer', "$passes passed, $($fails.Count) failed", '') + ($fails | ForEach-Object { "- $_" })
$summary -join "`n" | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { $summary -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY }
if ($fails.Count -or $passes -eq 0) { exit 1 }
exit 0
