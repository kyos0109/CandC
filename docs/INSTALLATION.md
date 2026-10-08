# Installation and local deployment

CandC runs locally on Windows, macOS and Linux with **Node.js 24.x and npm**.
Install Node.js from [the official download page](https://nodejs.org/en/download).
The release installer downloads compiled files and installs locked runtime dependencies.
Git, TypeScript, Vite and administrator privileges are not required. Internet access to
GitHub Releases and the npm registry is required. Demo needs no AI CLI/login; install
and sign in to official Codex/Claude CLIs separately when you want live AI.

## Install a published release

Official repository: [kyos0109/CandC](https://github.com/kyos0109/CandC).
Release downloads become available after Windows, macOS and Linux verification passes
in [the release workflow](https://github.com/kyos0109/CandC/actions/workflows/release.yml).
Release assets are `install.sh`, `install.ps1`, `install.mjs`, `SHA256SUMS` and
`candc-vX.Y.Z.tar.gz`. The packaged scripts contain the actual repository name.

macOS/Linux:

```sh
curl -fsSL https://github.com/kyos0109/CandC/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/kyos0109/CandC/releases/latest/download/install.ps1 | iex
```

Both commands download and run the standalone installer immediately, without cloning
or saving a script in the current directory. PowerShell returns to the same terminal
after success and throws an error on failure. To pass options:

```sh
curl -fsSL https://github.com/kyos0109/CandC/releases/latest/download/install.sh | sh -s -- --no-start --install-dir "$HOME/CandC"
```

```powershell
& ([scriptblock]::Create((irm https://github.com/kyos0109/CandC/releases/latest/download/install.ps1))) -NoStart -InstallDir "$env:LOCALAPPDATA\CandC"
```

The script pins one release, verifies the downloaded installer/archive against its
SHA-256 list, extracts regular files, installs production dependencies, then starts
CandC and opens the browser. Checksums detect corruption; the publisher remains the
trust source. Source `scripts/install.sh` and `install.ps1` are packager templates;
do not download those unassembled files from a raw source URL.

| Shell / Node option | PowerShell option | Effect |
| --- | --- | --- |
| `--version vX.Y.Z` | `-Version vX.Y.Z` | Explicit version, including prereleases. |
| `--install-dir PATH` | `-InstallDir PATH` | Another empty, user-owned directory. |
| `--port 4320` | `-Port 4320` | Save a different local port. |
| `--no-start` | `-NoStart` | Install without starting. |
| `--no-browser` | `-NoBrowser` | Start without opening a browser. |
| `--repo OWNER/REPO` | `-Repo OWNER/REPO` | Override the public release repository. |
| `--help` | `-Help` | Show options. |

Defaults: `~/.local/share/candc` on macOS/Linux, `%LOCALAPPDATA%\CandC` on Windows.
No PATH, shell profile, service or startup setting is changed. Without a desktop/browser,
installation still succeeds and prints the URL. Credentials are never requested.

## Everyday operation

The installation root contains `Start-CandC` / `Stop-CandC` entries: `.cmd` on Windows,
`.command` on macOS, `.sh` on Linux. Linux file managers differ; use a terminal.
Installed start does not reinstall or rebuild. Commands work from any current directory.
The installer prints exact commands for your chosen location. For default locations:

```sh
"$HOME/.local/share/candc/bin/candc" start --no-browser
"$HOME/.local/share/candc/bin/candc" status
"$HOME/.local/share/candc/bin/candc" stop
"$HOME/.local/share/candc/bin/candc" update --no-browser
"$HOME/.local/share/candc/bin/candc" doctor
```

```powershell
& "$env:LOCALAPPDATA\CandC\bin\candc.cmd" start
& "$env:LOCALAPPDATA\CandC\bin\candc.cmd" status
& "$env:LOCALAPPDATA\CandC\bin\candc.cmd" stop
& "$env:LOCALAPPDATA\CandC\bin\candc.cmd" update
& "$env:LOCALAPPDATA\CandC\bin\candc.cmd" doctor
```

`update` reuses the saved source, directory and port. **Stop first:** it never silently
interrupts a discussion. A successful update starts unless `--no-start` is supplied.
`start --port PORT` or `CANDC_PORT` can override a launch; stop/status use the recorded
running port even when the next terminal's environment changes. `doctor` runs compiled
code, reports each provider separately and starts no inference. Missing/unverified
providers do not make Demo unavailable.

## Data and recovery

`installation.json` selects a unique immutable directory under `releases/`. History
stays in `data/`, and agent sessions/evidence stay in `.cache/agents/`, at the installation
root. `CANDC_DATA_DIR` retains its override; relative values resolve from that root.
Provider-home/executable settings retain their meaning. The listener stays on
`127.0.0.1`; remote/public access is unsupported.

Download/checksum/extraction/dependency failures preserve the current version and data.
Retry the same command. The install log and npm cache are `.cache/install.log` and
`.cache/npm/`. Startup errors identify `.cache/server-error.log`; run `status` before
retrying. Another application's port is never forcibly reclaimed. Managed start/stop
check the running instance identity. Unknown shutdown state blocks replacement.

The previous release is retained. Startup failure does not automatically roll back a
version that may have opened data. Explicit downgrades require confirming journal
compatibility; older strict-schema builds may reject newer journals. No versions or
histories are automatically deleted. After a crashed operation, verify no installer
or launcher is running before removing the exact `.candc-operation.lock` file.

## Source and release maintenance

Windows source users keep the existing `.cmd` entrypoints. macOS/Linux use
`sh scripts/start.sh [--no-browser]` and `sh scripts/stop.sh`. Source launchers install
dependencies if needed and replace normal build outputs. Verification uses isolated builds.

```sh
npm run package:release -- --repo OWNER/REPO
npm run test:install
```

Packaging builds under `.cache/verification` and writes `.cache/release/vX.Y.Z`.
`--build` reuses an isolated build; `--output` selects another directory inside `.cache/`.
Do not publish a stale build. Archives exclude source, tests, development dependencies,
Git history, credentials, conversations and workspaces. Packaging does not publish.

A local candidate needs no repository; the adjacent `SHA256SUMS` is mandatory:

```sh
node scripts/install.mjs --archive .cache/release/v0.1.1/candc-v0.1.1.tar.gz --install-dir .cache/local-install --no-browser
```

Use the version actually packaged. A local installation needs `update --repo OWNER/REPO`
to acquire a remote source. `test:install` needs a fresh isolated build and tests actual
production-dependency installation, browser UI, Demo round, stop, reinstall, history
reload and compiled diagnostics with disposable data/inaccessible provider paths.
Install a test browser first with `npx playwright install chromium`, or select an
existing Chromium with `CANDC_BROWSER_PATH`. The installed app is tested outside
the repository so it cannot inherit repository development dependencies.
It preserves failure artifacts. Unit tests cover update failures, ownership, locks
and archive attacks.

Pushing a version tag such as `v0.1.0` starts **Verify and release**. It validates the
tag/package version, runs the complete checks on Windows, macOS and Ubuntu, then
verifies asset checksums and publishes the release only if every platform passes.
Failed verification produces no release. Manual runs default to a draft; enable
`publish` explicitly for a formal release. Prerelease tags remain marked as prereleases.
After publication, test actual download commands on clean target machines. CI baselines
are Windows x64, Apple Silicon macOS and Ubuntu x64; other architectures/distributions
need separate verification. CI configuration is not a completed run. Real Codex/Claude
compatibility needs separately authorized live checks.
