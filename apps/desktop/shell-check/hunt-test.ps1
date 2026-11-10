# Tests for hunt.ps1's reading of the log. Prints a line a case and exits 1 on a failure. Touches
# nothing: no cursor, no windows.
. (Join-Path $PSScriptRoot 'hunt.ps1')
$fails = 0
function Check($name, $ok) { if ($ok) { "ok   hunt $name" } else { "FAIL hunt $name"; $script:fails++ } }

# The first local smoke: both overlays logged her, and their aims alternated.
$both = @'
   55.34 [0] hunt colive0seed drawn 551,1296 size 96, aim 602,1348
   55.34 [1] hunt colive0seed drawn -129,-128 size 96, aim 603,1325
   55.59 [0] hunt colive0seed drawn 551,1296 size 96, aim 602,1348
   55.59 [1] hunt colive0seed drawn -129,-128 size 96, aim 603,1325
'@
$a = Aim-In $both
Check 'the newest line is the aim' ($a.overlay -eq '1' -and $a.x -eq 603 -and $a.y -eq 1325)
Check 'still is judged against the same overlay, not the other one' ($a.still)
$a = Aim-In ($both + "`n   55.84 [0] hunt colive0seed drawn 551,1296 size 96, aim 602,1348")
Check 'and from overlay 0 too' ($a.overlay -eq '0' -and $a.still -and $a.x -eq 602)

$walking = @'
   50.02 [0] hunt colive0seed drawn 552,1273 size 119, aim 615,1331
   50.10 [1] hunt colive0seed drawn -100,-120 size 119, aim 616,1330
   50.26 [0] hunt colive0seed drawn 568,1273 size 119, aim 631,1331
'@
Check 'a walking buddy is not still' (-not (Aim-In $walking).still)
Check 'a line with no aim yet is not an aim' ($null -eq (Aim-In '   2.70 [0] hunt colive0seed drawn 1248,1269 size 123, no aim yet'))
Check 'one line alone is not still' (-not (Aim-In '   1.55 [0] hunt colive0seed drawn 1247,80 size 110, aim 1301,136').still)
$two = "   1.0 [0] hunt a drawn 1,1 size 9, aim 10,10`n   1.1 [0] hunt b drawn 1,1 size 9, aim 300,300`n   1.2 [0] hunt a drawn 1,1 size 9, aim 11,10"
Check 'another buddy between two of hers' ((Aim-In $two).still -and (Aim-In $two).id -eq 'a')

if ($fails) { "hunt-test: $fails failed"; exit 1 }
'hunt-test: ok'
exit 0
