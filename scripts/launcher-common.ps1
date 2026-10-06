function Test-CandCListener {
  param([int]$Port)
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  return [bool]($listeners | Where-Object {
    $_.Port -eq $Port -and $_.Address.ToString() -in @('127.0.0.1', '0.0.0.0', '::')
  })
}
