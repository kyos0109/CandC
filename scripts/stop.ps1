$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-common.ps1')
$candcPort = if ($env:CANDC_PORT) { [int]$env:CANDC_PORT } else { 4317 }
if ($candcPort -lt 1 -or $candcPort -gt 65535) { throw 'Invalid CANDC_PORT.' }
$candcUrl = "http://127.0.0.1:$candcPort"
try { $candcHealth = Invoke-RestMethod "$candcUrl/health" -TimeoutSec 2 } catch {
  if (-not (Test-CandCListener $candcPort)) {
    Write-Host "CandC is already stopped: $candcUrl"
    exit 0
  }
  throw 'The port is still occupied, but its health check failed. CandC shutdown was not confirmed. No process was killed.'
}
if ($candcHealth.application -ne 'candc' -or $candcHealth.phase -ne 2) { throw 'This port is not a compatible CandC instance.' }
$null = Invoke-RestMethod "$candcUrl/api/session" -SessionVariable candcSession -TimeoutSec 2
$null = Invoke-RestMethod "$candcUrl/api/shutdown" -Method Post -ContentType 'application/json' -Body '{}' -WebSession $candcSession -TimeoutSec 10
$candcDeadline = (Get-Date).AddSeconds(12)
do {
  $candcRunning = Test-CandCListener $candcPort
  if (-not $candcRunning) { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $candcDeadline)
if ($candcRunning) { throw 'CandC did not stop within the expected timeout. No other process was killed.' }
Write-Host 'CandC stopped. Active AI turns are cancelled; history is preserved.'
