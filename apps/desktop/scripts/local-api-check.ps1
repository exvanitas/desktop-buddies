# The local API, checked by hand on a real PC with the frozen exe and a person at the desk.
# It sends requests the way any app would, `desktop-buddies.exe --api "<json>"`, reads the replies
# from the data folder, and asks the person to confirm what only eyes can see.
#
#   powershell -ExecutionPolicy Bypass -File local-api-check.ps1 -Exe C:\path\to\desktop-buddies.exe [-Buddy C:\path\to\spare.buddy] [-Mcp C:\path\to\tools\mcp\server.mjs]
#
# Quit Desktop Buddies from its tray before starting. Windows PowerShell 5.1 or later.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Data = (Join-Path $env:APPDATA 'dev.exvanitas.desktop-buddies'),
  [string]$Mcp = '',  # optional: tools\mcp\server.mjs, to check the MCP server too (needs node)
  [string]$Buddy = '',  # optional: a .buddy file that ISN'T in the library, for the cold --api check
  [int]$TimeoutMs = 8000
)
$ErrorActionPreference = 'Stop'
$replies = Join-Path $Data 'api\replies'
$results = New-Object System.Collections.Generic.List[string]
$failed = 0

function Note($ok, $what, $detail = '') {
  $line = ('{0}  {1}{2}' -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $what, $(if ($detail) { "  ($detail)" } else { '' }))
  if (-not $ok) { $script:failed++ }
  $script:results.Add($line); Write-Host $line
}
function Ask($question) { $a = Read-Host "$question [y/n]"; return $a -match '^[yY]' }
function Wait-Key($what) { Read-Host "$what, then press Enter" | Out-Null }

# One argument for a Windows command line, by the rules the exe parses with.
function Quote-Arg([string]$s) {
  $out = '"'; $slashes = 0
  foreach ($c in $s.ToCharArray()) {
    if ($c -eq '\') { $slashes++; continue }
    if ($c -eq '"') { $out += ('\' * ($slashes * 2 + 1)) + '"' } else { $out += ('\' * $slashes) + $c }
    $slashes = 0
  }
  return $out + ('\' * ($slashes * 2)) + '"'
}

# The reply slot for an id, as the app computes it: FNV-1a over its characters, mod 64, two digits.
function Slot-Of([string]$id) {
  [uint64]$h = 2166136261
  foreach ($c in $id.ToCharArray()) { $h = (([uint64]($h -bxor [uint64][int]$c)) * [uint64]16777619) -band [uint64]4294967295 }
  return ('{0:D2}' -f ($h % 64))
}

# Sends one request and returns its reply, or $null if none came in time.
function Send-Request([hashtable]$body) {
  $id = [guid]::NewGuid().ToString()
  $req = [ordered]@{ v = 1; id = $id }
  foreach ($k in $body.Keys) { $req[$k] = $body[$k] }
  $json = $req | ConvertTo-Json -Compress
  return Send-Raw $json $id
}
function Send-Raw([string]$json, [string]$id) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe; $psi.Arguments = '--api ' + (Quote-Arg $json); $psi.UseShellExecute = $false
  [void][System.Diagnostics.Process]::Start($psi)
  if (-not $id) { Start-Sleep -Milliseconds 1500; return $null }
  $file = Join-Path $replies "$(Slot-Of $id).json"
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
    if (Test-Path $file) { try { $r = Get-Content $file -Raw | ConvertFrom-Json; if ($r.id -eq $id) { return $r } } catch {} }
    Start-Sleep -Milliseconds 100
  }
  return $null
}
function ErrorOf($r) { if ($null -eq $r) { 'no reply' } elseif ($r.ok) { 'ok' } else { $r.error } }
function Running { return @(Get-Process -Name 'desktop-buddies' -ErrorAction SilentlyContinue).Count -gt 0 }
# Launches the exe with `--api` and one raw argument, as a hostile caller might, and waits a moment.
function Send-ApiArg([string]$arg) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe; $psi.Arguments = '--api ' + (Quote-Arg $arg); $psi.UseShellExecute = $false
  [void][System.Diagnostics.Process]::Start($psi)
  Start-Sleep -Seconds 3
}
$ghost = Join-Path $env:TEMP 'no-such-folder\ghost.buddy'

Write-Host "Exe:  $Exe"; Write-Host "Data: $Data"; Write-Host ''
if (-not (Test-Path $Exe)) { throw "No exe at $Exe" }
# The slot hash must match the app's, or no reply is ever found. Known values from slotOf.
Note ((Slot-Of 'abcdefgh') -eq '13' -and (Slot-Of '6f1c2e4a-0d1b-4c55-9a1e-3f0b7c2d9e10') -eq '29') 'the slot hash matches the app' "$(Slot-Of 'abcdefgh') $(Slot-Of '6f1c2e4a-0d1b-4c55-9a1e-3f0b7c2d9e10')"
if (Running) { Wait-Key 'Desktop Buddies is running. Quit it from its tray icon' }

# 1. Not running: the launch starts the app, which replies and quits.
$r = Send-Request @{ app = 'Check'; do = 'list' }
Note ((ErrorOf $r) -eq 'not-running') 'a request with the app closed says not-running' (ErrorOf $r)
Start-Sleep -Seconds 3
Note (-not (Running)) 'and the app it started has quit'
Note (-not (Ask 'Did a Manager window or any buddy appear just now? (it should not)')) 'nothing opened for it'

# 1b. Not running, with a buddy file where the request should be: nothing is imported or kept open.
if ($Buddy) {
  Send-ApiArg $Buddy
  Note (-not (Running)) 'a cold --api launch naming a buddy file quits too'
}
Send-ApiArg $ghost
Note (-not (Running)) 'a cold --api launch naming a missing file quits'

# 2. Start it for real.
Start-Process -FilePath $Exe
Start-Sleep -Seconds 6
Note (Running) 'the app starts normally'
Wait-Key 'Close the Manager window if it opened, and make sure at least one buddy is out'

# 3. Off by default (on a data folder that has never turned it on).
$r = Send-Request @{ app = 'Check'; do = 'list' }
$was = ErrorOf $r
Note ($was -eq 'off' -or $was -eq 'ok' -or $was -eq 'waiting') 'a request gets an answer' $was
if ($was -eq 'off') {
  Note (-not (Ask 'Did the Manager open? (it should not)')) 'an API launch with it off opens no Manager'
  Wait-Key 'Open the Manager, Settings, and turn on "Let other apps ask buddies to do things". Then close the Manager'
}

# 4. Consent: Allow.
$r = Send-Request @{ app = 'Check'; do = 'list' }
if ((ErrorOf $r) -eq 'waiting') {
  Note (Ask 'Did the Manager open and ask "Check wants your buddies to wave and talk"?') 'a new app is asked about in the Manager'
  Wait-Key 'Pick Allow, then close the Manager'
  $r = Send-Request @{ app = 'Check'; do = 'list' }
}
Note ((ErrorOf $r) -eq 'ok') 'list works once allowed' (ErrorOf $r)
$out = @($r.buddies | Where-Object { $_.out })
if ($r.ok) {
  $fields = @($r.buddies | ForEach-Object { $_.PSObject.Properties.Name } | Sort-Object -Unique)
  Note (($fields -join ',') -eq 'can,copies,id,name,out') 'a buddy in a reply is id, name, out, copies and can' ($fields -join ',')
  Write-Host ('Buddies: ' + (($r.buddies | ForEach-Object { "$($_.name) ($($_.id), out=$($_.out))" }) -join '; '))
}
if (-not $out.Count) { Wait-Key 'Call a buddy out from the Manager'; $r = Send-Request @{ app = 'Check'; do = 'list' }; $out = @($r.buddies | Where-Object { $_.out }) }
$b = $out[0].id
Note (-not (Ask 'Did the Manager open for that list? (it should not)')) 'an allowed request opens no Manager'

# 5. Wave and say.
$r = Send-Request @{ app = 'Check'; do = 'act'; buddy = $b; action = 'wave' }
Note ((ErrorOf $r) -eq 'ok') 'wave' (ErrorOf $r)
Note (Ask "Did $($out[0].name) wave?") 'she waved on screen'
$r = Send-Request @{ app = 'Check'; do = 'say'; buddy = $b; text = 'Hello from the check! "quotes" and \ backslash' }
Note ((ErrorOf $r) -eq 'ok') 'say' (ErrorOf $r)
Note (Ask 'Did her bubble say: Hello from the check! "quotes" and \ backslash, under a small "From Check" badge?') 'the line showed, with the badge'
$r = Send-Request @{ app = 'Check'; do = 'say'; buddy = $b; text = 'go to https://example.com' }
Note ((ErrorOf $r) -eq 'link') 'a link is refused' (ErrorOf $r)
$r = Send-Request @{ app = 'Check'; do = 'say'; buddy = $b; text = ('x' * 121) }
Note ((ErrorOf $r) -eq 'too-long') 'a long line is refused' (ErrorOf $r)
$r = Send-Request @{ app = 'Check'; do = 'act'; buddy = $b; action = 'delete' }
Note ((ErrorOf $r) -eq 'unknown-action') 'an action not offered is refused' (ErrorOf $r)
$r = Send-Request @{ app = 'Check'; do = 'list'; extra = 1 }
Note ((ErrorOf $r) -eq 'bad-request') 'an unknown key is refused' (ErrorOf $r)
Send-Raw 'not json' $null | Out-Null
$r = Send-Request @{ app = 'Check'; do = 'list' }
Note ((ErrorOf $r) -eq 'ok') 'bad JSON wedges nothing' (ErrorOf $r)

# 6. Not now, and Remove.
$r = Send-Request @{ app = 'Check Two'; do = 'list' }
Note ((ErrorOf $r) -eq 'waiting') 'a second app waits' (ErrorOf $r)
Wait-Key 'In the Manager, pick Not now for "Check Two"'
$r = Send-Request @{ app = 'Check Two'; do = 'list' }
Note ((ErrorOf $r) -eq 'not-allowed') 'Not now is remembered' (ErrorOf $r)
Note (Ask 'Does Settings list Check (Allowed) and Check Two (Not allowed), each with Remove?') 'answered apps are listed'
Wait-Key 'Remove both in Settings, then close the Manager'
$r = Send-Request @{ app = 'Check'; do = 'list' }
Note ((ErrorOf $r) -eq 'waiting') 'a removed app is asked again' (ErrorOf $r)
Wait-Key 'Pick Not now for "Check" too, so nothing is left allowed'

# 7. The MCP server, if asked.
if ($Mcp) {
  Wait-Key 'In Settings, Remove "Check", and close the Manager. The MCP check uses the name "MCP Check"'
  $lines = @(
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_buddies","arguments":{}}}'
  ) -join "`n"
  $got = $lines | & node $Mcp --exe $Exe --data $Data --app 'MCP Check' --timeout $TimeoutMs
  Note (($got -join "`n") -match 'waiting') 'the MCP server reaches the app and waits for consent' (($got | Select-Object -Last 1))
  Wait-Key 'Pick Allow for "MCP Check"'
  $got = $lines | & node $Mcp --exe $Exe --data $Data --app 'MCP Check' --timeout $TimeoutMs
  Note (($got -join "`n") -match '\\"id\\"') 'list_buddies through MCP' (($got | Select-Object -Last 1))
  Wait-Key 'Remove "MCP Check" in Settings'
}

# 8. The replies folder holds at most 64 files, in fixed slots.
$all = @(Get-ChildItem $replies -File -ErrorAction SilentlyContinue)
Note ($all.Count -le 64 -and @($all | Where-Object { $_.Name -notmatch '^\d\d\.json$' }).Count -eq 0) 'replies are in at most 64 slots' "$($all.Count) files"

Write-Host ''
Write-Host "$($results.Count - $failed) passed, $failed failed"
$results | Set-Content -Path (Join-Path $env:TEMP 'desktop-buddies-api-check.txt')
Write-Host "Saved to $(Join-Path $env:TEMP 'desktop-buddies-api-check.txt')"
