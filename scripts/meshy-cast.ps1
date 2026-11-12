# Make the built-in cast with the Meshy key saved by meshy-save-key.ps1.
# Any arguments go to the cast script, for example:
#
#   powershell -ExecutionPolicy Bypass -File scripts/meshy-cast.ps1 --dry-run
#   powershell -ExecutionPolicy Bypass -File scripts/meshy-cast.ps1 --only dancer
#
# The key is in this process's environment only while the script runs.

$file = Join-Path $env:USERPROFILE ".iko3d\meshy.cred.xml"
$dry = $args -contains "--dry-run"
if (-not (Test-Path $file) -and -not $dry) {
  Write-Error "No saved key. Run scripts/meshy-save-key.ps1 first."
  exit 1
}
if (Test-Path $file) {
  $env:MESHY_API_KEY = (Import-Clixml $file).GetNetworkCredential().Password
}
try {
  node scripts/meshy-cast.mjs @args
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:MESHY_API_KEY -ErrorAction SilentlyContinue
}
