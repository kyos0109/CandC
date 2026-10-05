param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$candcRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $candcRoot
$candcPort = if ($env:CANDC_PORT) { [int]$env:CANDC_PORT } else { 4317 }
if ($candcPort -lt 1 -or $candcPort -gt 65535) { throw 'Invalid CANDC_PORT.' }
$candcUrl = "http://127.0.0.1:$candcPort"
try { $candcHealth = Invoke-RestMethod "$candcUrl/health" -TimeoutSec 2 } catch { $candcHealth = $null }
if ($candcHealth) {
  if ($candcHealth.application -ne 'candc' -or $candcHealth.phase -ne 2) { throw 'The port is used by another application or an older CandC. Close the old server first, or set CANDC_PORT.' }
  if (-not $NoBrowser) { Start-Process $candcUrl }
  exit 0
}
if (-not (Test-Path -LiteralPath 'node_modules')) {
  & npm.cmd ci --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$candcCache = Join-Path $candcRoot '.cache'
New-Item -ItemType Directory -Path $candcCache -Force | Out-Null
$candcNode = (Get-Command node.exe).Source
$candcProcess = Start-Process -FilePath $candcNode -ArgumentList 'dist/main.js' -WorkingDirectory $candcRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $candcCache 'server.log') -RedirectStandardError (Join-Path $candcCache 'server-error.log')
$candcDeadline = (Get-Date).AddSeconds(20)
do {
  if ($candcProcess.HasExited) { throw 'CandC could not start. Inspect .cache/server-error.log.' }
  try { $candcHealth = Invoke-RestMethod "$candcUrl/health" -TimeoutSec 1 } catch { $candcHealth = $null }
  if ($candcHealth -and $candcHealth.application -eq 'candc') { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $candcDeadline)
if (-not $candcHealth) { throw 'CandC startup timed out.' }
Write-Host "CandC ready: $candcUrl"
if (-not $NoBrowser) { Start-Process $candcUrl }
