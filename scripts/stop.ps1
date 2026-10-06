$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'launcher.mjs') stop
exit $LASTEXITCODE
