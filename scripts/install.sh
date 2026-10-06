#!/bin/sh
set -eu
command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js 24 is required. Install it from https://nodejs.org/en/download and retry.' >&2; exit 1; }
# package-release.mjs embeds the complete verified-download bootstrap below.
node --input-type=module - "$@" <<'CANDC_BOOTSTRAP'
__CANDC_BOOTSTRAP__
CANDC_BOOTSTRAP
