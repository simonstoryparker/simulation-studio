param([Parameter(Mandatory=$true)][string]$FilePath)
$ErrorActionPreference = 'Stop'
if (!$env:STUDIO_WINDOWS_PFX_BASE64 -or !$env:STUDIO_WINDOWS_PFX_PASSWORD) { throw 'Windows signing credentials are required.' }
$pfx = Join-Path $env:RUNNER_TEMP 'studio-signing.pfx'
try {
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:STUDIO_WINDOWS_PFX_BASE64))
  $signTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1
  if (!$signTool) { throw 'Windows SDK signtool.exe is required.' }
  & $signTool.FullName sign /fd SHA256 /td SHA256 /tr 'http://timestamp.digicert.com' /f $pfx /p $env:STUDIO_WINDOWS_PFX_PASSWORD $FilePath
  if ($LASTEXITCODE -ne 0) { throw 'Code signing failed.' }
  & $signTool.FullName verify /pa $FilePath
  if ($LASTEXITCODE -ne 0) { throw 'Code signature verification failed.' }
} finally { Remove-Item -ErrorAction SilentlyContinue $pfx }
