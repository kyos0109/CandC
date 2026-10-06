param(
  [string]$Repo,
  [string]$Version,
  [string]$InstallDir,
  [int]$Port,
  [switch]$NoStart,
  [switch]$NoBrowser,
  [switch]$Help
)
$candcPreviousErrorActionPreference = $ErrorActionPreference
try {
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 24 is required. Install it from https://nodejs.org/en/download and retry.' }
$candcArguments = @('--input-type=module', '-')
if ($Repo) { $candcArguments += @('--repo', $Repo) }
if ($Version) { $candcArguments += @('--version', $Version) }
if ($InstallDir) { $candcArguments += @('--install-dir', $InstallDir) }
if ($PSBoundParameters.ContainsKey('Port')) { $candcArguments += @('--port', [string]$Port) }
if ($NoStart) { $candcArguments += '--no-start' }
if ($NoBrowser) { $candcArguments += '--no-browser' }
if ($Help) { $candcArguments += '--help' }
$candcBootstrap = @'
__CANDC_BOOTSTRAP__
'@
$candcBootstrap | & node @candcArguments
if ($LASTEXITCODE -ne 0) { throw "CandC installation failed (exit code $LASTEXITCODE)." }
} finally {
  $ErrorActionPreference = $candcPreviousErrorActionPreference
}
