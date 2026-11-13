# The Microsoft Store's package for a published release, built on the Actions Windows runner from
# that release's own zip, so the Store gets the exe and app folder people already downloaded, byte for
# byte, under the Partner Center identity in identity.json. Then:
#   release: the tag is published (not a draft), and the zip matches its line in SHA256SUMS.txt
#   identity: the package's AppxManifest.xml says identity.json's Name, Publisher and
#     PublisherDisplayName, version X.Y.Z.0 for vX.Y.Z, x64
#   files: the exe and every file of the app folder in the package are the zip's, by SHA-256
#   install: a signed copy, signed with a throwaway certificate whose subject is the Publisher,
#     installs, and Windows gives it the family name msix.py works out; then it's removed
# The package left in -Out is unsigned, as Partner Center wants it, and is never the copy that was
# signed. Nothing is skipped: what can't be checked FAILs. Any error ends the run with
# "FAIL run.error <message> at line <n>" in -Out's store-release.txt.
param(
  [Parameter(Mandatory)][string]$Tag,
  [string]$Out = 'store',
  [string]$Python = 'python',
  [string]$Temp = [IO.Path]::GetTempPath()
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$results = [System.Collections.Generic.List[string]]::new()
$failed = $false
function Expect($what, $ok, $detail = '') {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) $what $detail"
  if (-not $ok) { $script:failed = $true }
  $results.Add($line); Write-Host $line
}
function Save-Results {
  try { $results | Set-Content -LiteralPath (Join-Path $Out 'store-release.txt') -Encoding UTF8 } catch { Write-Host "could not save: $($_.Exception.Message)" }
}
function Hash($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Entry-Hash($entry) {
  $s = $entry.Open()
  try { return ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($s)) -replace '-', '').ToLowerInvariant() } finally { $s.Close() }
}
# The newest Windows 10 SDK tool of this name, x64 first, as store-package.ps1 finds it.
function Sdk-Tool($name) {
  $kits = 'C:\Program Files (x86)\Windows Kits\10'
  $found = @(Get-ChildItem "$kits\bin\10.*\x64" -Filter $name -ErrorAction SilentlyContinue | Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1)
  if (-not $found.Count) { $found = @(Get-ChildItem $kits -Recurse -Filter $name -ErrorAction SilentlyContinue | Sort-Object { if ($_.FullName -match '\\x64\\') { 0 } else { 1 } } | Select-Object -First 1) }
  if (-not $found.Count) { throw "no Windows SDK has $name" }
  return $found[0].FullName
}

$tmp = ''; $thumb = ''; $keyName = ''; $name = ''; $installed = $false
try {
  New-Item -ItemType Directory -Force $Out | Out-Null
  $Out = (Resolve-Path -LiteralPath $Out).Path
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
  $builder = Join-Path $root 'apps\desktop\packaging\msix\msix.py'
  $identity = Get-Content -Raw (Join-Path $root 'apps\desktop\packaging\msix\identity.json') | ConvertFrom-Json
  $name = $identity.name

  # ---------- the release
  if ($Tag -notmatch '^v(\d+\.\d+\.\d+)$') { throw "-Tag '$Tag' isn't like v1.2.3" }
  $v = $Matches[1]
  $branchVersion = (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version
  if ($branchVersion -ne $v) { throw "package.json here says $branchVersion, not $v: package a release from a commit at its version" }
  $draft = gh release view $Tag -R $env:GITHUB_REPOSITORY --json isDraft --jq '.isDraft'
  Expect 'release.published' ($LASTEXITCODE -eq 0 -and $draft -eq 'false') "$Tag draft=$draft"
  if ($draft -ne 'false') { throw "$Tag isn't a published release" }
  $tmp = Join-Path $Temp ('store-release-' + [guid]::NewGuid().ToString('n').Substring(0, 8))
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $zipName = "desktop-buddies-$v-windows-x64.zip"
  gh release download $Tag -R $env:GITHUB_REPOSITORY --pattern $zipName --pattern 'SHA256SUMS.txt' --dir $tmp
  if ($LASTEXITCODE -ne 0) { throw 'downloading the release failed' }
  $zip = Join-Path $tmp $zipName
  $want = @(Get-Content (Join-Path $tmp 'SHA256SUMS.txt') | Where-Object { $_ -match "^([0-9a-f]{64})  $([regex]::Escape($zipName))$" } | ForEach-Object { $Matches[1] })
  Expect 'release.zip' ($want.Count -eq 1 -and $want[0] -eq (Hash $zip)) "sha256 $(Hash $zip)"
  if ($want.Count -ne 1 -or $want[0] -ne (Hash $zip)) { throw "$zipName doesn't match SHA256SUMS.txt" }
  Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $tmp 'zip')
  $unzipped = Join-Path $tmp "zip\Desktop Buddies $v"
  $exe = Join-Path $unzipped 'desktop-buddies.exe'
  $app = Join-Path $unzipped 'app'
  foreach ($need in $exe, $app, (Join-Path $unzipped 'THIRD-PARTY-NOTICES.txt')) { if (-not (Test-Path -LiteralPath $need)) { throw "the zip has no $need" } }

  # ---------- build, unsigned
  $msix = Join-Path $Out "desktop-buddies-$v-x64.msix"
  & $Python -I $builder --exe $exe --app $app --notices (Join-Path $unzipped 'THIRD-PARTY-NOTICES.txt') --out $msix | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $msix)) { throw 'msix.py failed' }
  $family = (& $Python -I $builder --family | Select-Object -Last 1).Trim()
  $built = Hash $msix
  Expect 'build.msix' $true "$([IO.Path]::GetFileName($msix)) sha256 $built, family $family"

  # ---------- what the package says, and what it holds
  $pkgZip = [IO.Compression.ZipFile]::OpenRead($msix)
  try {
    $s = $pkgZip.GetEntry('AppxManifest.xml').Open()
    try { $m = [xml]([IO.StreamReader]::new($s).ReadToEnd()) } finally { $s.Close() }
    $id = $m.Package.Identity
    $display = $m.Package.Properties.PublisherDisplayName
    Expect 'identity.name' ($id.Name -ceq $identity.name) $id.Name
    Expect 'identity.publisher' ($id.Publisher -ceq $identity.publisher) $id.Publisher
    Expect 'identity.display' ($display -ceq $identity.publisherDisplayName) $display
    Expect 'identity.version' ($id.Version -eq "$v.0" -and $id.ProcessorArchitecture -eq 'x64') "$($id.Version) $($id.ProcessorArchitecture)"
    $entries = @{}
    foreach ($e in $pkgZip.Entries) { $entries[[Uri]::UnescapeDataString($e.FullName)] = $e }
    $mismatch = [System.Collections.Generic.List[string]]::new()
    if (-not $entries['desktop-buddies.exe'] -or (Entry-Hash $entries['desktop-buddies.exe']) -ne (Hash $exe)) { $mismatch.Add('desktop-buddies.exe') }
    $appFiles = @(Get-ChildItem -LiteralPath $app -Recurse -File)
    foreach ($f in $appFiles) {
      $rel = 'app/' + $f.FullName.Substring($app.Length + 1).Replace('\', '/')
      if (-not $entries[$rel] -or (Entry-Hash $entries[$rel]) -ne (Hash $f.FullName)) { $mismatch.Add($rel) }
    }
    $extraApp = @($entries.Keys | Where-Object { $_ -like 'app/*' -and -not $_.EndsWith('/') }).Count - $appFiles.Count
    Expect 'files.same' ($mismatch.Count -eq 0 -and $extraApp -eq 0) "exe and $($appFiles.Count) app files$(if ($mismatch.Count) { '; differ: ' + ($mismatch -join ', ') })$(if ($extraApp) { "; $extraApp more in the package" })"
  } finally { $pkgZip.Dispose() }

  # ---------- a signed copy, installed
  if (Get-AppxPackage -Name $name) { throw "$name is installed already" }
  $copy = Join-Path $tmp 'signed-copy.msix'
  Copy-Item -LiteralPath $msix -Destination $copy
  $cert = New-SelfSignedCertificate -Type Custom -Subject $identity.publisher -KeyUsage DigitalSignature -FriendlyName 'Desktop Buddies store-release check' `
    -Provider 'Microsoft Software Key Storage Provider' -CertStoreLocation 'Cert:\CurrentUser\My' `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') -NotAfter (Get-Date).AddDays(1)
  $thumb = $cert.Thumbprint
  $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
  $keyName = $rsa.Key.KeyName; $rsa.Dispose()
  $secret = [guid]::NewGuid().ToString('n')
  $pfx = Join-Path $tmp 'check.pfx'; $cer = Join-Path $tmp 'check.cer'
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString $secret -AsPlainText -Force) | Out-Null
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
  & (Sdk-Tool 'signtool.exe') sign /fd SHA256 /f $pfx /p $secret $copy | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw 'SignTool failed' }
  Add-AppxPackage -Path $copy
  $pkg = Get-AppxPackage -Name $name
  $installed = [bool]$pkg
  Expect 'install.ok' $installed "$(if ($pkg) { "$($pkg.Version) $($pkg.Publisher)" })"
  if (-not $pkg) { throw 'Add-AppxPackage left nothing installed' }
  Expect 'install.family' ($pkg.PackageFamilyName -ceq $family) "windows $($pkg.PackageFamilyName), msix.py $family"
  Expect 'build.unsigned' ((Hash $msix) -eq $built) 'the package for Partner Center is the unsigned build'
  "$built  $([IO.Path]::GetFileName($msix))" | Set-Content -LiteralPath (Join-Path $Out 'SHA256SUMS.txt') -Encoding ascii
} catch {
  $i = $_.InvocationInfo
  Expect 'run.error' $false "$($_.Exception.Message) at line $(if ($i) { $i.ScriptLineNumber })"
} finally {
  if ($installed) { try { Get-AppxPackage -Name $name | Remove-AppxPackage } catch { Expect 'cleanup.uninstall' $false $_.Exception.Message } }
  if ($thumb) {
    foreach ($store in 'Cert:\CurrentUser\My', 'Cert:\LocalMachine\TrustedPeople') {
      try { Get-ChildItem $store | Where-Object Thumbprint -eq $thumb | Remove-Item -DeleteKey:($store -like '*CurrentUser*') } catch { Expect "cleanup.cert" $false $_.Exception.Message }
    }
  }
  if ($tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  if ($name -and (Get-AppxPackage -Name $name)) { Expect 'cleanup.gone' $false "$name is still installed" }
  Save-Results
}
if ($failed) { exit 1 }
