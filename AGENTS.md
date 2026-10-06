# CandC development guide

CandC is a cross-platform, Node.js 24, local single-user application. New browser
discussions use version 3; version 1/2 histories remain supported. Codex and Claude
have the live path. Gemini/Grok live execution remains locked.

## Keep each task focused

- State the requested behavior and acceptance criteria before a substantial change.
- Read the relevant entrypoint, callers, tests and owning contract. Do not load every
  Markdown file, inspect old cache reports or treat completed reviews as a backlog.
- Change only what is needed for the current request. Do not add providers, redesign
  discussion policy, rewrite architecture or optimize bundles as incidental cleanup.
- Check `git status` first and preserve unrelated changes. Delete a file only after
  checking imports, scripts, documentation and compatibility responsibilities.
- If source, tests and contract disagree, identify the conflict before choosing a fix.
  Historical validation describes its dated snapshot, not current runtime behavior.
- Stop when the requested behavior and relevant checks pass. Report unrelated
  findings briefly; they do not automatically become another task.

## Find the owner

| Task | Start here | Read when needed |
| --- | --- | --- |
| Version 3 execution, privacy, authority, conclusion | `src/room-controller.ts`, `src/room-contract.ts`, `src/conclusion.ts`, `src/discussion-policy.ts` | `docs/ROOM_CONTRACT.md`, `docs/DISCUSSION_POLICY_EVAL.md` |
| Legacy version 1/2 execution | `src/controller.ts`, `src/focused-execution.ts`, `src/focused.ts`, `src/v2-contract.ts` | `docs/FOCUSED_CONTRACT.md` |
| Admission, ownership and upgrades | `src/discussion-service.ts`, `tests/oss-regressions.test.ts` | Relevant version contract |
| Journals and recovery | `src/store.ts`, `src/journal-codec.ts`, `src/journal-lock.ts`, storage/recovery tests | Relevant version contract |
| Conversation folders and permanent deletion | `src/management.ts`, `src/discussion-service.ts`, `src/store.ts`, `web/History.tsx` | `docs/DISCUSSION_MANAGEMENT.md` |
| HTTP and SSE | `src/server.ts`, `src/event-stream.ts`, `tests/server.test.ts` | `SECURITY.md` |
| CLI protocols and research | `src/adapters/`, `src/environment.ts`, `src/research.ts`, `src/mcp.ts` | `SECURITY.md`; generated types only when the protocol changes |
| Interface and locales | `web/App.tsx`, affected view, `web/i18n.ts`, `web/locales/en.ts` | `docs/UI_UX_SPEC.md` |
| Performance observations | `src/performance.ts` and affected call observer | `docs/PERFORMANCE_CONTRACT.md` |
| Verification and public export | `package.json`, affected test, `scripts/public-source.mjs` | `CONTRIBUTING.md`, `VALIDATION.md` |
| Installation, launchers and releases | `scripts/install.mjs`, `scripts/launcher.mjs`, `scripts/package-release.mjs` | `docs/INSTALLATION.md` |

## Preserve these boundaries

- Delivery, response claims, conclusion review and durable saving are different states.
  Unconfirmed storage blocks further writes/scheduling; recovery never retries an
  unknown-result turn. Pause must not reopen stopped or indeterminate discussions.
- Keep private input/evidence scoped to the addressed seat, including seats sharing
  a provider. Preserve legacy journal formats and explicit upgrade/rebuild behavior.
- Do not use real `data/`, CLI authentication or an active runtime build for tests.
  `.cache/agents/`, `scratchpad/` and unrelated cache/export directories may contain
  other work; do not scan or remove them as part of ordinary source cleanup.
- Live calls, service restart, normal build replacement, commits, pushes and publishing
  require authorization for that action. Default verification uses fake providers.
- Update only the owning documentation when behavior changes. Keep UI English keys
  and interpolation parameters aligned; never translate user/model content.

## Verify and finish

Use the affected tests first and the check selection in `CONTRIBUTING.md`. Use
`npm run build:isolated` for compilation; `npm run build`, `check` and the launcher
replace normal build outputs. Do not weaken coverage or behavior assertions to
accommodate cleanup. Report changes, observed checks and material untested limits.
