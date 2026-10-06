param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$candcArguments = @((Join-Path $PSScriptRoot 'launcher.mjs'), 'start')
if ($NoBrowser) { $candcArguments += '--no-browser' }
& node @candcArguments
exit $LASTEXITCODE
