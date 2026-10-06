# Third-party notices

CandC's handwritten source is licensed under the MIT license in [LICENSE](LICENSE).

## Generated Codex protocol declarations

`src/generated/codex/` contains declarations generated from the OpenAI Codex
CLI app-server protocol, pinned to `codex-cli 0.160.0`. Existing generator and
source attribution comments are retained in each generated file.

Upstream: [openai/codex, rust-v0.160.0](https://github.com/openai/codex/tree/rust-v0.160.0).
These upstream-derived files retain the Apache License 2.0 terms. The complete
upstream [license](licenses/codex-Apache-2.0.txt) and
[NOTICE](licenses/codex-NOTICE.txt) are included. CandC's root MIT license does
not replace those terms.

## Installed dependencies and external CLIs

Node packages retain their own license files in installed packages. Exact
resolved versions and integrity hashes are recorded in `package-lock.json`.
The public source export excludes `node_modules` and compiled dependencies.
If distributing a compiled application or vendored dependencies, include the
licenses and notices for those distributed packages as well.

Codex, Claude, Gemini, and Grok CLIs are external programs, installed separately.
Their provider authentication, subscription terms, and licenses remain separate
from CandC. Their logos or proprietary executable files are not bundled here.
