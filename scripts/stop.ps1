$ErrorActionPreference = 'Stop'
$candcPort = if ($env:CANDC_PORT) { [int]$env:CANDC_PORT } else { 4317 }
if ($candcPort -lt 1 -or $candcPort -gt 65535) { throw 'Invalid CANDC_PORT.' }
$candcUrl = "http://127.0.0.1:$candcPort"
$candcHealth = Invoke-RestMethod "$candcUrl/health" -TimeoutSec 2
if ($candcHealth.application -ne 'candc' -or $candcHealth.phase -ne 2) { throw 'This port is not a compatible CandC instance.' }
$null = Invoke-RestMethod "$candcUrl/api/session" -SessionVariable candcSession -TimeoutSec 2
$null = Invoke-RestMethod "$candcUrl/api/shutdown" -Method Post -ContentType 'application/json' -Body '{}' -WebSession $candcSession -TimeoutSec 10
$candcDeadline = (Get-Date).AddSeconds(12)
do {
  try { $null = Invoke-RestMethod "$candcUrl/health" -TimeoutSec 1; $candcRunning = $true } catch { $candcRunning = $false }
  if (-not $candcRunning) { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $candcDeadline)
if ($candcRunning) { throw 'CandC did not stop within the expected timeout. No other process was killed.' }
Write-Host 'CandC is stopping. Active AI turns are cancelled; history is preserved.'
