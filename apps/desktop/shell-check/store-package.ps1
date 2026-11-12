# The Microsoft Store's package, installed and checked on the Actions Windows runner. It builds the
# MSIX from this run's exe and app folder with a test identity (packaging/msix/msix.py), makes a
# self-signed certificate whose subject is that identity's Publisher, signs with SignTool, trusts the
# certificate, installs with Add-AppxPackage, and then:
#   start: through the alias, as other programs must, with the check's own app folder (store/hub.js)
#   packaged: shell_info says so, and the log and the data are in the package's own folder, not the
#     real %APPDATA%
#   startup: the startup task round trip, off, on, read, off, read, through the exe
#   assoc: .buddy is in the installed manifest, and the exe says it's declared and can't be changed
#   mcp: the real app, started through the alias, answers one request from the MCP server, which
#     picks the exe and the data folder itself, as a pair
# then uninstalls, and takes the certificate away. Nothing is skipped: what can't be checked FAILs.
# Desktop Buddies must not be installed from the Store or unzipped to its usual place. Processes end
# only by their own PID.
#
# -SetupOnly runs the checks and stops before anything is built, installed or started. Any error ends
# the run with "FAIL run.error <message> at line <n>" in -Out's store-package.txt, written before the
# cleanup, which notes its own errors and never hides that one.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$App,
  [string]$Out = 'results',
  [string]$Node = 'node',
  [string]$Python = 'python',
  [int]$TimeoutMs = 8000,
  [string]$Temp = [IO.Path]::GetTempPath(),
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
  if (-not $script:resultsFile) { Write-Host 'no store-package.txt: -Out was never made'; return }
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
# An error outside the try below stops the run: said with its line, and kept in store-package.txt.
trap {
  $msg = "FAIL run.error $(Error-Line $_)"
  Write-Host $msg; Write-Host $_.ScriptStackTrace
  try { if ($null -ne $results) { $results.Add($msg); if ($Out -and (Test-Path -LiteralPath $Out -PathType Container)) { $results | Set-Content -LiteralPath (Join-Path $Out 'store-package.txt') } } } catch { Write-Host "could not save: $($_.Exception.Message)" }
  break
}

function Read-Log($path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return '' }
  $s = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite,Delete')
  try { return [IO.StreamReader]::new($s, [Text.Encoding]::UTF8).ReadToEnd() } finally { $s.Close() }
}
function Wait-For($what, [scriptblock]$test, $seconds = 30) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  do { if (& $test) { return $true }; Start-Sleep -Milliseconds 200 } while ($t.Elapsed.TotalSeconds -lt $seconds)
  Write-Host "gave up waiting for $what"
  return $false
}
# The newest Windows 10 SDK tool of this name, for x64.
function Sdk-Tool($name) {
  $found = @(Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\10.*\x64' -Filter $name -ErrorAction SilentlyContinue |
    Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1)
  if (-not $found.Count) { throw "no Windows SDK has $name" }
  return $found[0].FullName
}
# The files under a folder, with their sizes and times, or '' if there's no folder.
function Listing($dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return '' }
  return (@(Get-ChildItem -LiteralPath $dir -Recurse -File -Force | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join "`n")
}

# The package's processes, by PID: the exe in its install folder, and everything under it.
function Ours {
  if (-not $script:installDir) { return @() }
  $all = @(Get-CimInstance Win32_Process)
  $mine = @($all | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($script:installDir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId })
  do {
    $more = @($all | Where-Object { $mine -contains $_.ParentProcessId -and $mine -notcontains $_.ProcessId } | ForEach-Object { $_.ProcessId })
    $mine += $more
  } while ($more.Count)
  return $mine
}

# What the cleanup reads. Each stays empty until the step that makes it.
$tmp = ''; $testName = ''; $thumb = ''; $pkgData = ''; $pkgLog = ''; $installDir = ''; $installed = $false

try {
  # ---------- the parameters, and nothing started yet
  if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "-Exe '$Exe' is not a file" }
  if (-not (Test-Path -LiteralPath $App -PathType Container)) { throw "-App '$App' is not a folder" }
  if ($TimeoutMs -lt 1000) { throw "-TimeoutMs $TimeoutMs is below 1000" }
  $Exe = (Resolve-Path -LiteralPath $Exe).Path
  $App = (Resolve-Path -LiteralPath $App).Path
  New-Item -ItemType Directory -Force $Out | Out-Null
  $Out = (Resolve-Path -LiteralPath $Out).Path
  $resultsFile = Join-Path $Out 'store-package.txt'
  Note "mode $(if ($SetupOnly) { 'setup only: stops before anything is built' } else { 'full run' })"
  $root = Join-Path $PSScriptRoot '..\..\..'
  $builder = Join-Path $root 'apps\desktop\packaging\msix\msix.py'
  $drive = Join-Path $root 'tools\mcp\tests\drive.mjs'
  $probeDir = Join-Path (Split-Path $App) 'shell-check\store'
  foreach ($need in $builder, $drive, (Join-Path $root 'tools\mcp\server.mjs'), (Join-Path $probeDir 'hub.html'), (Join-Path $probeDir 'hub.js')) {
    if (-not (Test-Path -LiteralPath $need -PathType Leaf)) { throw "$need is missing: build the app first" }
  }
  $builder = (Resolve-Path -LiteralPath $builder).Path
  $drive = (Resolve-Path -LiteralPath $drive).Path
  $probeDir = (Resolve-Path -LiteralPath $probeDir).Path
  foreach ($cmd in $Python, $Node) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd isn't on PATH" } }
  # The identity the test package is built and signed with. Never the Store's own.
  $testName = 'DesktopBuddies.ShellCheck'
  $publisher = 'CN=Desktop Buddies Shell Check'
  $dataName = 'dev.exvanitas.desktop-buddies'
  $alias = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\desktop-buddies.exe'
  $zipExe = Join-Path $env:LOCALAPPDATA 'Desktop Buddies\desktop-buddies.exe'
  $realData = Join-Path $env:APPDATA $dataName
  Expect 'setup.checks' $true "out $Out, timeout $TimeoutMs ms"

  if ($SetupOnly) {
    Note 'setup_only stopped before anything was built: no window opened, no process started, no mouse moved'
  } else {
    # ---------- nothing in the way
    if (Get-AppxPackage -Name $testName) { throw 'the test package is installed already' }
    if (Test-Path -LiteralPath $alias) { throw 'something has the alias already: a request would reach it' }
    if (Test-Path -LiteralPath $zipExe) { throw 'the zip is unzipped to its usual place: the MCP server would pick it' }
    $realBefore = Listing $realData
    Note "the real data folder $(if ($realBefore) { 'has files from earlier steps' } else { 'is not there' })"
    $tmp = Join-Path $Temp ('store-package-' + [guid]::NewGuid().ToString('n').Substring(0, 8))
    New-Item -ItemType Directory -Force $tmp | Out-Null

    # ---------- build
    $identity = Join-Path $tmp 'identity.json'
    [IO.File]::WriteAllText($identity, "{ `"name`": `"$testName`", `"publisher`": `"$publisher`", `"publisherDisplayName`": `"exvanitas`" }", (New-Object Text.UTF8Encoding $false))
    $msixFile = Join-Path $tmp 'store-check.msix'
    & $Python -I $builder --exe $Exe --app $App --identity $identity --out $msixFile | ForEach-Object { Write-Host $_ }
    Expect 'build.msix' ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $msixFile)) "exit $LASTEXITCODE"
    if ($LASTEXITCODE -ne 0) { throw 'msix.py failed' }
    $family = (& $Python -I $builder --family --identity $identity | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'msix.py --family failed' }

    # ---------- sign, and trust the certificate
    $cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature -FriendlyName 'Desktop Buddies shell check' `
      -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') -NotAfter (Get-Date).AddDays(1)
    $thumb = $cert.Thumbprint
    $secret = [guid]::NewGuid().ToString('n')
    $pfx = Join-Path $tmp 'check.pfx'
    $cer = Join-Path $tmp 'check.cer'
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString $secret -AsPlainText -Force) | Out-Null
    Export-Certificate -Cert $cert -FilePath $cer | Out-Null
    Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
    & (Sdk-Tool 'signtool.exe') sign /fd SHA256 /f $pfx /p $secret $msixFile | ForEach-Object { Write-Host $_ }
    Expect 'build.signed' ($LASTEXITCODE -eq 0) "exit $LASTEXITCODE"
    if ($LASTEXITCODE -ne 0) { throw 'SignTool failed' }

    # ---------- install
    Add-AppxPackage -Path $msixFile
    $pkg = Get-AppxPackage -Name $testName
    $installed = [bool]$pkg
    Expect 'install.ok' $installed "$(if ($pkg) { $pkg.Version })"
    if (-not $pkg) { throw 'Add-AppxPackage left nothing installed' }
    $installDir = $pkg.InstallLocation
    # The family name msix.py works out is the one Windows gave it, and the one the MCP server needs.
    Expect 'install.family' ($pkg.PackageFamilyName -eq $family) "windows $($pkg.PackageFamilyName), msix.py $family"
    $pkgData = Join-Path $env:LOCALAPPDATA "Packages\$($pkg.PackageFamilyName)\LocalCache\Roaming\$dataName"
    $pkgLog = Join-Path $pkgData 'logs\app.log'
    Expect 'install.alias' (Wait-For 'the alias' { Test-Path -LiteralPath $alias } 20) ''
    $manifest = [xml](Get-AppxPackageManifest -Package $pkg.PackageFullName).OuterXml
    $types = @($manifest.SelectNodes("//*[local-name()='FileType']") | ForEach-Object { $_.InnerText })
    Expect 'assoc.declared' ($types -contains '.buddy') ($types -join ',')
    $tasks = @($manifest.SelectNodes("//*[local-name()='StartupTask']") | ForEach-Object { "$($_.TaskId) enabled=$($_.Enabled)" })
    Expect 'startup.declared' (($tasks -join ',') -eq 'DesktopBuddiesStartup enabled=false') ($tasks -join ',')
    $progs = Get-Item -LiteralPath 'HKCU:\Software\Classes\.buddy\OpenWithProgids' -ErrorAction SilentlyContinue
    Note "assoc.registered $(if ($progs) { ($progs.GetValueNames() | Where-Object { $_ -like 'AppX*' }).Count } else { 0 }) AppX ProgIDs for .buddy"

    # ---------- the check's own page, inside the package
    Start-Process -FilePath $alias -ArgumentList @('--app-dir', "`"$probeDir`"", '--seconds', 120) | Out-Null
    $checkFile = Join-Path $pkgData 'store-check.json'
    $wrote = Wait-For 'the check page' { Test-Path -LiteralPath $checkFile } 60
    Expect 'start.alias' $wrote 'the page inside the package wrote its answers'
    [void](Wait-For 'the check page to quit' { -not @(Ours).Count } 30)
    Expect 'start.quit' (-not @(Ours).Count) "$(@(Ours).Count) still running"
    $said = if ($wrote) { Get-Content -LiteralPath $checkFile -Raw | ConvertFrom-Json } else { $null }
    function Got($step) { if (-not $said -or -not $said.$step) { return 'nothing' } elseif ($null -ne $said.$step.error) { return "error $($said.$step.error)" } else { return ($said.$step.ok | ConvertTo-Json -Compress) } }
    Expect 'packaged.info' ($said -and $said.info.ok.packaged -eq $true) (Got 'info')
    Note "packaged.data_dir_said $(Got 'info')"
    Expect 'packaged.data_in_package' (Test-Path -LiteralPath $checkFile) $pkgData
    Expect 'packaged.log_in_package' ((Read-Log $pkgLog) -match '(?m)^.*start \S+ api \d+ .* packaged\r?$') 'a start line ending in packaged'
    $realAfter = Listing $realData
    Expect 'packaged.real_appdata_untouched' ($realAfter -eq $realBefore) "$(if ($realAfter -eq $realBefore) { 'unchanged' } else { 'changed' })"
    $round = @('startBefore', 'startOn', 'startRead', 'startOff', 'startAfter' | ForEach-Object { Got $_ })
    Expect 'startup.round_trip' (($round -join ' ') -eq 'false true true false false') ($round -join ' ')
    $state = Get-ItemProperty -LiteralPath "HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\$($pkg.PackageFamilyName)\DesktopBuddiesStartup" -ErrorAction SilentlyContinue
    Note "startup.windows_state $(if ($state) { $state.State } else { 'none' }) at the end"
    Expect 'assoc.exe_says_declared' ((Got 'assoc') -eq 'true') (Got 'assoc')
    Expect 'assoc.exe_refuses_a_change' ((Got 'assocSet') -match '^error .*declares \.buddy') (Got 'assocSet')

    # ---------- the real app, and one request through the MCP server
    $starts = ([regex]::Matches((Read-Log $pkgLog), 'start \S+ api')).Count
    Start-Process -FilePath $alias -ArgumentList @('--seconds', 300, '--no-manager') | Out-Null
    Expect 'mcp.app_up' (Wait-For 'the app' { ([regex]::Matches((Read-Log $pkgLog), 'hub up')).Count -ge 1 } 60) ''
    $kept = @{ BUDDIES_EXE = $env:BUDDIES_EXE; BUDDIES_DATA = $env:BUDDIES_DATA; BUDDIES_PACKAGE_FAMILY = $env:BUDDIES_PACKAGE_FAMILY }
    try {
      Remove-Item Env:BUDDIES_EXE, Env:BUDDIES_DATA -ErrorAction SilentlyContinue
      $env:BUDDIES_PACKAGE_FAMILY = $pkg.PackageFamilyName
      $lines = @(& $Node $drive --app 'Store Check' --phase off --timeout $TimeoutMs | ForEach-Object { "$_" })
      $code = $LASTEXITCODE
    } finally {
      foreach ($k in $kept.Keys) { if ($null -eq $kept[$k]) { Remove-Item "Env:$k" -ErrorAction SilentlyContinue } else { Set-Item "Env:$k" $kept[$k] } }
    }
    $seen = 0
    foreach ($l in $lines) {
      if ("$l" -match '^(PASS|FAIL) (\S+) ?(.*)$') { $seen++; Expect $Matches[2] ($Matches[1] -eq 'PASS') $Matches[3] } else { Note "drive $l" }
    }
    Expect 'mcp.driver' ($code -eq 0 -and $seen -ge 4) "exit $code, $seen results"
    $logText = Read-Log $pkgLog
    $startLines = @([regex]::Matches($logText, '(?m)^.*start \S+ api .*$') | ForEach-Object { $_.Value.TrimEnd() })
    Expect 'packaged.every_start' ($startLines.Count -ge $starts + 1 -and -not @($startLines | Where-Object { $_ -notmatch ' packaged$' }).Count) "$($startLines.Count) starts"
    $plain = @($logText -split "`r?`n" | Where-Object { $_ -match '\b(error|rejected|hub error|failed)\b' })
    Expect 'log.no_errors' ($plain.Count -eq 0) (($plain | Select-Object -First 5) -join ' | ')
  }
} catch {
  # written before any cleanup, so a cleanup that goes wrong can't lose it
  Expect 'run.error' $false (Error-Line $_)
  Write-Host $_.ScriptStackTrace
  Save-Results
} finally {
  Tidy 'processes' {
    if ($installDir) {
      $left = @(Ours)
      foreach ($id in $left) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
      if ($left.Count) { Note "$($left.Count) of the package's processes were stopped by PID" }
    }
  }
  Tidy 'logs' {
    if ($pkgLog -and $resultsFile -and (Test-Path -LiteralPath $pkgLog)) { Copy-Item -LiteralPath $pkgLog -Destination (Join-Path $Out 'store-package.log') }
  }
  Tidy 'uninstall' {
    if ($installed) {
      Get-AppxPackage -Name $testName | Remove-AppxPackage
      Expect 'end.uninstalled' (-not (Get-AppxPackage -Name $testName)) ''
      Expect 'end.alias_gone' (Wait-For 'the alias to go' { -not (Test-Path -LiteralPath $alias) } 20) ''
      Expect 'end.data_gone' (Wait-For 'the package data to go' { -not (Test-Path -LiteralPath $pkgData) } 20) 'uninstalling takes the package data'
    }
  }
  Tidy 'certificate' {
    if ($thumb) {
      foreach ($store in 'Cert:\LocalMachine\TrustedPeople', 'Cert:\CurrentUser\My') {
        $c = Join-Path $store $thumb
        if (Test-Path -LiteralPath $c) { Remove-Item -LiteralPath $c }
      }
      Expect 'end.certificate_gone' (-not (Test-Path -LiteralPath (Join-Path 'Cert:\LocalMachine\TrustedPeople' $thumb)) -and -not (Test-Path -LiteralPath (Join-Path 'Cert:\CurrentUser\My' $thumb))) ''
    }
  }
  Tidy 'temp' { if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force } }
  Save-Results
}
$fails = @($results | Where-Object { $_ -like 'FAIL *' })
$passes = @($results | Where-Object { $_ -like 'PASS *' }).Count
$summary = @('### Store package', "$passes passed, $($fails.Count) failed", '') + ($fails | ForEach-Object { "- $_" })
$summary -join "`n" | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { $summary -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY }
if ($fails.Count -or $passes -eq 0) { exit 1 }
exit 0
