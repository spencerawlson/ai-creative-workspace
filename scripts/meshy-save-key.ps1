# Save your Meshy API key on this computer, encrypted for your Windows
# account only (DPAPI), for scripts/meshy-cast.ps1 to use. Run it once,
# and again whenever you make a new key:
#
#   powershell -ExecutionPolicy Bypass -File scripts/meshy-save-key.ps1
#
# The key is typed into a hidden prompt: it isn't shown, put in the
# command history, or written anywhere in plain text.

$dir = Join-Path $env:USERPROFILE ".iko3d"
New-Item -ItemType Directory -Force $dir | Out-Null
$key = Read-Host "Meshy API key (starts with msy_)" -AsSecureString
if ($key.Length -eq 0) { Write-Error "No key entered; nothing saved."; exit 1 }
$cred = New-Object System.Management.Automation.PSCredential("meshy", $key)
$cred | Export-Clixml (Join-Path $dir "meshy.cred.xml")
Write-Host "Saved, encrypted for $env:USERNAME on this computer."
