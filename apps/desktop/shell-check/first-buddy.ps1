# The buddy a run on a fresh data folder starts with. A build with seed.json in its app folder seeds
# her itself, and this adds nothing. A build with none ships no buddy, so the run hands the exe the test
# sample as a file at launch, as taskbar-check does with its own: the exe imports her and calls her
# out, and she's the only one in the library, as a seeded buddy would be. A data folder that has run
# before gets nothing, so a later run finds what the first left.
#   Start-Process $exe -ArgumentList ($launchArgs + (First-Buddy $appDir $dataDir $tmpDir))

# The sample buddy that tests use, from the repository this script is in.
$script:SampleBuddy = Join-Path $PSScriptRoot '..\..\..\packages\test-support\fixtures\sample.json'

function Seeds-Itself($appDir) { return Test-Path -LiteralPath (Join-Path $appDir 'seed.json') -PathType Leaf }

function First-Buddy($appDir, $dataDir, $tmpDir) {
  if (Seeds-Itself $appDir) { return @() }
  if (Test-Path -LiteralPath (Join-Path $dataDir 'settings.json') -PathType Leaf) { return @() }
  if (-not (Test-Path -LiteralPath $script:SampleBuddy -PathType Leaf)) { throw "no sample buddy at $script:SampleBuddy" }
  New-Item -ItemType Directory -Force $tmpDir | Out-Null
  $file = Join-Path $tmpDir 'sample.buddy'
  Copy-Item -LiteralPath $script:SampleBuddy -Destination $file -Force
  return @("`"$file`"")
}

# What the first run's log says about her: seeded by the build, or imported from the sample.
function Got-First($logText, $appDir) {
  if (Seeds-Itself $appDir) { return $logText -match 'library seeded with \S+' }
  return ($logText -match 'no buddy to seed in this build') -and ($logText -match 'launch: a file, imported')
}
