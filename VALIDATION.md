# Delivery validation

## Ordinary facilitation, explicit judge authority and neutral roles (2026-10-05)

Ordinary facilitation now defaults to speaker-led execution, no draft monitoring, brief coordination after each round, and an outcome only after every speaker confirms the same public proposal. Forced interrupt/mute/topic/pause/finish is rejected outside explicit judge mode. Creation and idle Settings expose an unchecked judge option, with session retirement and preserved confirmed history on authority changes. Prompts specify roles and evidence/coordination boundaries without a mandatory decision framework or next-task template. Underscore work keys are accepted after observing real native controls rejected by the earlier hyphen-only schema. See [the authority contract](docs/ROOM_CONTRACT.md#moderator-authority-and-races) and [the revision acceptance cases](docs/DISCUSSION_POLICY_EVAL.md#moderator-authority-and-neutral-role-revision-2026-10-05).

Observed validation:

- `npm run typecheck` passed; the new browser spec also passed separate strict TypeScript compilation.
- Final `npm test`: 396 tests in 39 files passed. Added cases cover speaker-first execution, independent moderator sessions, all-speaker confirmation, rejected force commands, no result from silence, explicit judge ruling, idle version checks/session retirement, unchanged omitted-mode journal loading followed by explicit start, moderator-budget exhaustion without blocking speakers, neutral prompt/control content and real underscore control keys. Existing stop, privacy, uncertainty, research and legacy behavior checks remain green.
- Full `npm run test:e2e`: 45 cases passed with installed Chrome, fake providers and isolated history on owned port 4511. After the final role-specific control-list change, all 8 affected moderator/room/policy browser cases passed again against a fresh isolated build. The new case checks default ordinary mode, speaker-confirmed outcome, no monitors, idle mode changes across reload without calls, and mobile overflow/browser errors.
- `npm run build:isolated` passed; output stays under `.cache/verification`. `git diff --check` passed with LF/CRLF warnings only. The 390x844 authority-settings screenshot was inspected at `<local-screenshot-path>`.

Pre-commit review found no blocking issue in the scoped diff; `npm run typecheck` and all 396 unit tests passed again. Browser results above apply to the reviewed implementation; no further source changes followed that validation.

The real discussion journals were inspected read-only. No real provider inference, live quality comparison, original-history rewriting/replay, normal build replacement, service restart, CLI installation/login or push was performed. Existing unrelated work was preserved. Tests prove application permissions, scheduling, persistence and prompt content; they do not guarantee model brevity or improved reasoning for every topic. Gemini/Grok retain their existing live verification gates. New mode fields can be rejected by an older strict-schema build; rollback requires matching preserved data and executables.

## Active discussion policy v1 (2026-10-05)

Implemented the generic opt-in policy shared by speakers and the independent moderator, public-source workflow metadata, nonblocking personal questions, bounded dispatch corrections, visible provisional checkpoints, explicit idle research configuration and safe control diagnostics. New browser rooms enable it; old rooms and version 1/2 behavior retain their policy until explicitly enabled. The acceptance specification preceded implementation in [DISCUSSION_POLICY_EVAL.md](docs/DISCUSSION_POLICY_EVAL.md); behavior and rollback boundaries are in [ROOM_CONTRACT.md](docs/ROOM_CONTRACT.md#active-discussion-policy-v1).

Observed validation uses scripted/fake providers and isolated history only:

- `npm run typecheck`: passed for backend, tests and frontend.
- `npm test`: 367 tests in 35 files passed. The new policy suite covers before/after early pause, moderator/no-moderator pending work, four-seat coverage, research disabled/observed/unobserved operations, private sources, public question resolution, strict diagnostics, manual boundaries, user stop, summaries, policy/session configuration, old journal bytes and uncertain checkpoint append/sync/close. A fully confirmed proposal withheld for a missing peer check now becomes a result when that check completes, without requiring another redundant confirmation. A regression reproduced the missing result before this correction.
- The checkpoint fault cases exposed insertion-order-dependent recovery digests for compact event-message references. New failure metadata uses canonical JSON value digests; unmarked old metadata keeps its legacy verifier. Positive append/sync/close recovery, legacy metadata compatibility and existing content-conflict rejection all passed; no real journal was rewritten.
- `npm run test:e2e`: all 44 browser cases passed using installed Chrome and the owned fake fixture at port 4511. After the final proposal/check completion correction, the 8 affected policy/room/manual cases passed against a fresh isolated build. The two new cases cover checkpoints across reload, deduplicated nonblocking questions, task continuation, public resolution, source navigation, mobile overflow, explicit old-room policy enablement and research changes without an AI call.
- `npm run build:isolated` passed during browser validation; output is limited to `.cache/verification/`. The new browser spec also passed separate strict TypeScript compilation. `git diff --check` passed with only repository LF/CRLF warnings.

The 390x844 stage-result screenshot was inspected after its entrance animation, with no horizontal overflow and no relevant browser console/page errors. It is stored outside the repository at `<local-screenshot-path>`. Fixture servers exit via the owned teardown. No normal build replacement, running-service restart, real provider inference, login/installation, user-history mutation, commit or push was performed by this implementation task. Existing work was not reset or discarded.

These tests establish scheduling, persistence, provenance and interface behavior. Live multi-topic A/B reasoning quality, primary-source accuracy and cost are unmeasured; no claim of globally optimal policy or guaranteed removal of model-generated questions is made. Gemini/Grok live research/readiness remain locked under the existing provider boundary. New policy fields and canonical failure metadata can be rejected by an older build; rollback requires preserving new history and restoring matching pre-upgrade data and executables.

## Combined commit review (2026-10-05)

Reviewed the pending multi-seat room, moderator controls, durable storage, native adapter observations, provider readiness, browser workspace and performance reporting together against the room/performance/UI contracts. The review found no remaining blocker in that snapshot. Corrected the historical room-only telemetry limitation below to distinguish it from current behavior.

- Before concurrent policy development changed shared sources, `npm run typecheck` and `npm test` passed: 339 tests in 34 files. The isolated build and all 42 Playwright cases passed with installed Chrome on the owned fake-only fixture at port 4407.
- A separate commit snapshot preserves those reviewed sources while leaving subsequent active-discussion-policy work in the working tree. Snapshot type checks passed. All compiled backend files and frontend asset names match the previously validated isolated build.
- Snapshot Vitest passed 302 tests; the 37 research tests were blocked during setup because the snapshot's `.cache` ancestor is intentionally forbidden as a research root. Running those unchanged research sources/tests in the original workspace passed all 37. No research restriction was weakened.
- Snapshot Playwright passed 41/42 cases; the scroll-freeze case then failed again in isolation because the test resumed inference before waiting for the browser scroll event. The test now holds the resume request until two animation frames have delivered scrolling, preserving both new-content and scroll-position assertions. That corrected case passed three consecutive runs. Application sources and the other 41 cases were unchanged.
- Screenshot artifacts under `undefined/`, caches, user journals, performance samples and subsequent policy work are excluded from the commit. No real provider inference, provider login, normal build replacement, service restart, push or deployment is part of this review.

## Room performance observation corrections (2026-10-05)

Corrected room telemetry to preserve participant seat and actual discussion/moderation/monitor/summary purpose; capture existing readiness checks and CLI versions once per execution; observe selection/prepared saving, first filtered public text, resolved model, native usage/source, deduplicated tool counts and existing result saving. Monitor result saving is diagnostic storage rather than a public-answer commit. Start retries emit no extra execution, and original acceptance/lock timing is retained. Storage failure during error handling overrides the original failure, including legacy selection failures. Missing CLI/model labels prevent directional interpretation. Existing v1 records remain readable without rewriting or inferred timings. See [PERFORMANCE_CONTRACT.md](docs/PERFORMANCE_CONTRACT.md).

Observed final-source validation used fake/scripted adapters only; no real AI or readiness CLI was invoked:

- `npm run typecheck`: passed.
- `npm test`: 339 tests in 34 files passed. New coverage includes concurrent/later idempotent retries, version 1/2 selection-error storage uncertainty, room execution-only preflight/version labels, purpose/seat grouping, streaming/final-only statistics, startup/protocol/cleanup/timeout/cancellation classification, prepared/answer/error commit uncertainty, monitor diagnostic confirmation, tool deduplication/privacy, old-record compatibility and deferred lock timing. Enabled/disabled/failed sidecar comparisons preserve normalized prompts, call order and journal event sequences.
- `npm run build:isolated`: passed; output limited to `.cache/verification/`.
- With `CANDC_BROWSER_PATH` set to the installed `C:/Program Files/Google/Chrome/Application/chrome.exe`, `node node_modules/@playwright/test/cli.js test e2e/performance.spec.ts e2e/room.spec.ts`: 8 cases passed. Covered exports, incomplete state, legacy/room polling stop, room execution count and seat/purpose presentation, plus existing room/session/privacy flows. The owned fixture exited through teardown; port 4399 had no listener afterward.
- `git diff --check`: passed (existing LF/CRLF warnings only).

Changes are local source and isolated verification only. Normal `dist/` and `web-dist/`, existing user journals and retained performance files were not replaced; no live service restart, commit, push or deployment was performed. New labels and timings apply to future calls after the updated application is built and started; the old 42-call snapshot is not backfilled and does not establish live performance of this change.

## UI/UX review corrections (2026-10-05)

Corrected all six confirmed review findings: a boundary pause cannot overwrite a committed user stop; connections-page navigation preserves creation/composer drafts, quoted targets and private recipients; version 1/2 to 3 copying seeds history, elapsed budget and source linkage in the first durable commit; reloaded demonstration rooms retire lost fake session identities only on explicit start; a valid seat named `constructor` cannot resolve an inherited object property as a session; small green status-chip text meets the normal-text contrast requirement. Hidden conversation views also preserve reading position and resume following after background replies, without showing a new-content notice for navigation alone. The connections page now has a Return to discussion action.

Observed final checks on Windows, Node 24.16.0, installed Chrome and isolated fake adapters:

- Backend/frontend type checks passed (`tsc --noEmit`, `tsc -p web/tsconfig.json`); the new E2E spec also passed separate strict compilation with JSX and bundler resolution.
- `vitest run`: 319 tests in 33 files passed. Deterministic regression cases reproduced the stop/pause race, lost fake sessions, inherited `constructor` lookup and non-atomic upgrade before correction. Upgrade fault injection covers uncertain append, sync and close, unavailable startup verification, blocked scheduling and explicit recovery; original source journal bytes remain unchanged.
- `playwright test`: all 41 cases passed on final source (32 existing plus 9 new in `e2e/review-regressions.spec.ts`). The new cases cover complete creation drafts at 1280px/390px, version 2/3 composer text/quote/private recipient, background replies with following or a fixed reading position, both status-chip themes and a sessionless `constructor` diagnostics view. Pure navigation/rechecking leaves saved discussions unchanged.
- Browser identity matched `http://127.0.0.1:4407` and CandC. New flows rendered meaningful content without framework overlays or relevant page/console errors. Existing layout cases passed at 1440x900, 1280x720 and 390x844 in both themes; creation and composer checks also used 1280x900/390x900. Screenshots of desktop/mobile drafts, the mobile private composer and light/dark chips were inspected.
- Actual computed 11px ready/confirmed chip contrast: light 5.48:1, dark 6.34:1 (threshold 4.5:1).
- `npm run build:isolated` passed under `.cache/fix-01a10a35`. SHA-256 comparison confirmed all 55 existing `dist/` and `web-dist/` files were unchanged. Original unrelated working changes were preserved. `git diff --check` passed with existing LF/CRLF conversion warnings.

Browser plugin not available; verification used the existing Playwright workflow with `CANDC_BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe`. Screenshot evidence is outside the repository under `<local-screenshot-path>`: `fix-creation-draft-1280.png`, `fix-creation-draft-390.png`, `fix-composer-v2.png`, `fix-composer-v3.png`, `fix-ready-light.png`, `fix-ready-dark.png`, `fix-confirmed-light.png` and `fix-confirmed-dark.png`.

No real AI inference, provider login/installation, production access, running-service replacement, normal build-output replacement, commit or push was performed. Fake-adapter checks establish application scheduling, persistence and input isolation; they do not establish live provider behavior. The journal schema/format was not changed by these corrections; the existing multi-seat rollback limitations below still apply.

## Multi-seat room, moderator presentation and seat model (2026-10-05)

Seat IDs no longer equal providers, so one provider can hold several independent speaking sessions; the browser now creates version 3 discussions through a three-step flow and shows seat state, moderator events, consensus/ruling and diagnostics. See [the room contract](docs/ROOM_CONTRACT.md) and section 9 of [the UI spec](docs/UI_UX_SPEC.md). The two-agent creation form was removed; version 1/2 histories keep working and the version 2 API remains.

- `npm run typecheck`: backend and frontend passed. `e2e/` is outside that script; its specs were also compiled with strict settings and bundler resolution (how Playwright loads them) with no errors.
- `npm test`: 313 tests in 33 files passed (was 284 in 31). New: `tests/room-seats.test.ts` runs every seat case for all four providers (independent sessions and workspaces, private input isolated from the moderator and from a same-provider twin, moderator mute/speak by seat ID, roster mute state, fail-closed shared native session, directed recipients, ID rules, unknown-seat state rejection) and `tests/seats.test.ts` covers identity numbering and the event timeline. Reverting the roster mute check to the provider (the old behaviour) makes the mute case fail for all four providers.
- `npm run build:isolated`: passed; `dist/` and `web-dist/` were not replaced.
- `npx playwright test` with installed Chrome (`CANDC_BROWSER_PATH`), isolated build, history and fake adapters: 32 cases passed. Version 2 behaviour cases now create their discussion through the API (`createLegacy`) with unchanged assertions; cases that exercised the removed form moved to the new form (manual/free defaults, research opt-in, model catalog and readiness, debate positions, same-provider seats, four seats plus moderator).
- Layout, measured on the fixture with four seats and a moderator, idle, 16px, roster docked: message viewport 71% (1440x900), 64% (1280x720), 66% (390x844) in both themes; no horizontal overflow; composer inside the window. Screenshots of both themes at the three sizes, creation, conclusion, diagnostics and connections pages were inspected.

Smoothness and polish pass (same day): choosing the discussion form moved the settings row down by 179px and choosing the demo reply source shifted the seat area by 127px, because seat rows changed height. Seat rows now render the same three lines in every mode (the position field is always shown, demo mode shows disabled model and effort, the research row stays), and a probe measured 0px of movement for both toggles in both directions. Control heights were also wrong (39/45px instead of 34px) because the global field selectors out-ranked the seat-row ones; fixed. A generating bubble no longer repeats a message that was just saved (the preview is dropped once a saved message has the call's ID; unit-tested as `liveProgress`). Visual polish: one card for seats and moderator with hairline rows, a readiness grid, aligned sticky start bar, SVG icons for stop/pause/reply/copy/add/remove, field focus halo, quiet transitions, a speaking-ring pulse and a docked-panel fade, all disabled under reduced motion. `npm test` now passes 320 tests in 33 files; `npx playwright test` passes 42 cases, which include `e2e/review-regressions.spec.ts` (nine cases added by a separate concurrent review session, together with a fix for seat IDs such as `constructor` that read object prototype members). Screenshots at 1440x900 dark, 820x1100 light and 390x844 dark were inspected.

Observations and limits:

- At this earlier validation stage, rooms recorded turn measurements only and displayed zero executions. The later room performance corrections above add execution records and verify execution/turn counts; this limitation no longer applies to the current source.
- Several real CLI sessions of one provider in one room, and Gemini/Grok live behaviour, were not exercised: no live provider was called. Gemini and Grok seats work in demonstration mode only.
- New discussions cannot enable focused issues because version 3 has none; existing version 2 histories are unaffected.
- Multi-seat records are rejected by an older build's strict schema and surface as storage issues there; reverting the code is the rollback.
- Not run: the canonical `npm run build` (it replaces `dist/`), a project-wide review, any commit.

## Model-card layout and CLI readiness hints (2026-10-05)

Separated model/effort labels, controls and helper text in room creation. Unselected provider cards and the moderator now expose readiness explanations and the existing connection/recheck entry. Missing executables, failed/timed-out launches, unverified versions, subscription login requirements and failed login checks have distinct safe diagnostics. Unavailable live settings/start remain disabled; demonstration mode remains available. No existing uncommitted work was reset or discarded.

- `npm run typecheck`: backend/frontend passed.
- `npm test`: 284 tests in 31 files passed, including nine deterministic provider-status cases with no real CLI invocation.
- `npm run test:e2e -- e2e/cli-hints.spec.ts e2e/room.spec.ts e2e/research.spec.ts`: five cases passed using installed Chrome, isolated build/history and fake adapters. Coverage includes separated labels/helper bounds, statuses before seat selection, model/effort selection, disabled unavailable settings/start, connection/recheck navigation, independent moderator hints, demonstration mode and existing room/research workflows. Desktop 1280x900 and mobile 390x844 were checked; screenshots were inspected and mobile horizontal overflow/first-case browser errors were absent.
- Screenshots: `<local-screenshot-path>` and `cli-hints-mobile.png` in the same directory.
- `git diff --check`: passed with the existing LF/CRLF warnings. Isolated E2E compilation passed; normal `dist/` and `web-dist/` were not replaced.

CLI diagnostics and browser readiness responses were simulated; no installation, login mutation, real provider inference or running-service replacement was performed. The full E2E suite was not rerun for this follow-up.

## Independent moderator and multi-provider rooms (2026-10-05)

Implemented behavior version 3 with 2–4 speakers, an optional independent moderator (default off), native session/generation ownership, incremental eligible input, serialized draft monitoring, immediate owned-turn cancellation, mute/unmute, public topic notification before application, unilateral moderator results with dissent/unresolved/unhandled requests, reconstruction/recovery and mixed-version routing. Added the creation/view controls, provider readiness explanations, local diagnostics/export and explicit version 1/2 to 3 copying. Original source history bytes are covered by a compatibility test. Existing uncommitted work was preserved; no reset, stash, commit, push or runtime deployment was performed.

Observed checks:

- `npm run typecheck`: backend and frontend passed on the final implementation.
- `npm test`: 275 tests in 30 files passed on the final implementation. New coverage includes 2/3/4 participants, same-provider independent moderator sessions, private-message isolation across normal/monitor/summary input, provenance/collision rejection, stop/cancelled partial history, stale monitor decisions and cleanup sequencing, mute/unmute, stale control, response coverage, moderator limits, pending topic recovery, append/sync/close uncertainty, all-participant proposal confirmation, mixed journal loading and explicit upgrade without source mutation. Gemini/Grok fixtures cover native event parsing, model/session errors, unexpected tools, private thought exclusion, authorization lock and owned prompt-file cleanup.
- `npm run test:e2e` with `CANDC_BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe` and `CANDC_FIXTURE_PORT=4508`: all 27 tests passed using isolated build/history and fake adapters, including existing v1/v2, UI, research, session and performance workflows. After the final room-only journal/privacy/layout changes, `npm run test:e2e -- e2e/room.spec.ts` passed both new room cases again. Mobile checks cover moderator/four-provider and unmoderated/three-provider views, no document horizontal overflow, visible composer and modal participant inspector. Screenshots inspected: `.cache/verification/room-mobile.png` and `.cache/verification/room-moderator-mobile.png`.
- `npm run build:isolated`: passed through the E2E web-server setup on the final implementation. Artifacts stay under `.cache/verification`; normal `dist/` and `web-dist/` were not replaced.
- `git diff --check`: passed; Git emitted existing LF/CRLF conversion warnings.

The initially configured bundled Chromium failed to launch with `spawn UNKNOWN`; installed Chrome ran the assertions successfully. An intermediate full browser run exposed legacy-test entry selection before the asynchronous creation form loaded, plus legacy suites that did not choose the legacy entry. The fixtures now wait for and explicitly select **原雙方模式**; behavior assertions were retained. Windows isolated command execution later returned `CreateProcessWithLogonW failed: 1909`; approved local execution completed the remaining tests.

No real provider inference, login mutation, CLI installation or API-key path was exercised. Gemini and Grok were not available on PATH and their live readiness remains false; effective subscription authentication, inherited configuration/hooks/MCP isolation, live cancellation/resumption and billing remain unverified. The code intentionally prevents their live launch until those checks exist. Codex/Claude retain their established adapters and pinned readiness gates, but live moderator behavior was not retested. Semantic relevance of a moderator's related-topic change is prompt constrained and reviewable, not mechanically proven. Fake-provider success demonstrates application control flow, not live model quality, cost or privacy guarantees beyond the application's input selection/tool policy.

See [ROOM_CONTRACT.md](docs/ROOM_CONTRACT.md) for exact authority, privacy, durability and provider limits. Returning to older code requires not opening version 3 journals with that code; existing version 1/2 journals remain in their original format. Explicit copying creates a new linked history and leaves the source untouched.

Date: 2026-10-02. Platform: Windows; Node 24.16.0; Codex CLI 0.160.0; Claude Code 2.1.287.

## Daily AI performance measurement (2026-10-04)

Implemented the independent v1 performance stream, controller/adapter observations, authenticated read/export endpoints, the diagnostics panel and daily baseline grouping. See [PERFORMANCE_CONTRACT.md](docs/PERFORMANCE_CONTRACT.md). Validation used Node 24.16.0, fake adapters and scripted protocols only; no CLI login/catalog command or real AI turn was invoked for this batch. CLI readiness/process counters were simulated in tests rather than asserted against installed providers.

Observed final-source checks:

- `npm run typecheck`: passed for backend and frontend.
- `npm test`: 241 tests in 27 files passed. New coverage includes first-observation timing/null/reversed endpoints, independent scripted Codex inspection/inference processes, new/resumed sessions, execution-only preflight counters/CLI versions, native numeric usage and privacy exclusions, failure-phase preservation and failed post-result exit validation even when final close succeeds, cancellation/timeout/startup/protocol/cleanup failures, answer/diagnostic storage uncertainty, rotation/corrupt files/disabled collection/write failure/queue overflow/shutdown timeout, nearest-rank/group thresholds, fake/live isolation and read/export authentication. The same fake script preserves normalized prompts, call order/count, receipts, public results and journal commit types/sequences with measurement disabled, enabled or diagnostic writes failing. Restart preserves the strict journal bytes without migration or extra diagnostic commits.
- `npm run build:isolated`: passed; outputs remain under `.cache/verification/`. The existing build helper limits each compiler/bundler to 60 seconds. Vitest limits tests/hooks to five seconds; the selected E2E configuration has a 240-second global deadline. No test/helper process was killed speculatively.
- `git diff --check`: passed; Git emitted its existing LF/CRLF conversion warnings.

The standalone command `node node_modules/@playwright/test/cli.js test e2e/performance.spec.ts e2e/focused.spec.ts` was attempted normally and with an approved execution escalation. Both attempts failed at Chromium launch with `spawn UNKNOWN`; all five browser cases stopped before their assertions. These automated E2E cases are **not reported as passed**.

Complementary checks through the supported Codex in-app browser used an owned fake-only fixture on port 4400 and isolated build/history. Observed: execution plus two completed turn samples, expanded duration/unknown/provider-usage presentation, existing raw diagnostics retained, actual performance GET polling while open, no new network requests during a six-second observation after closing the panel, JSON and Markdown downloads, and a manually appended begin-only record in the disposable performance directory displaying incomplete/unknown end, process counts and unconfirmed public storage. The final isolated frontend/backend was reopened over the same paused fake history for the final incomplete-state screenshot: `.cache/verification/performance-panel.jpg`. Both owned manual fixture processes were closed through the existing authenticated shutdown API after verifying `testFixture: true`.

Example final-module report artifacts, generated from the disposable fake fixture with the default live filter, are `.cache/verification/performance-baseline.json` and `.cache/verification/performance-baseline.md`. They contain zero live samples and explicitly state insufficient data. They demonstrate the export contract, not measured live latency, token growth or optimization. No real-provider baseline, upstream attribution, billing coverage, savings, live resumption or live performance is established by this batch.

All changes were local. No commit/push/deployment, production access, history migration, normal `dist/` or `web-dist/` replacement, or user-data cleanup was performed. During work, the pre-existing WIP became part of HEAD `e3ef22f` through another workspace action; this task did not execute a Git commit or reset/stash.

## Conversation workspace visual refinement (2026-10-04)

Applied the user-approved interactive mockup over the 2026-10-03 layout; see section 8 of [the UI spec](docs/UI_UX_SPEC.md). Changes are presentational: teal-biased neutral tokens in both themes, provider identity limited to avatars/names/quotations, 1.72 reading line height, history sorted and grouped by last saved activity with status dots, header avatar stack and status pill, issue position plus round/time progress in the current-issue row, meta above bubbles, a hairline-separated action row holding the details toggle and saved marker, day/round dividers derived only from saved timestamps and round numbers, a card-based creation page, and native radio groups styled as segmented controls for recipient, reply source, discussion form, run mode and speaker flow. API payloads, storage, prompts and accessible names are unchanged.

Browser tests that drove the replaced `<select>` controls now use two fixture helpers, `choose()` and `choice()`; the discussion settings inspector still uses selects and its assertions are unchanged. The IM-history scroll-freeze test now waits for the animated Home-key scroll to reach the top before continuing. Instrumentation showed no programmatic `scrollTop` writes or `scrollIntoView` calls in the failing run; the taller layout lengthened Chrome's keyboard scroll animation past the immediate read. The assertion that the viewport stays at the top while new content arrives is unchanged. A keyboard assertion now verifies that the arrow keys change the 傳給 segmented control. The pending message derives its class, avatar and name from one speaker value, and the unused `.danger` style was removed.

Observed verification on the final tree:

| Check | Result and isolation |
| --- | --- |
| `npm run typecheck` | Passed, backend and browser TypeScript. |
| `npx vitest run` | 216 tests in 25 files passed. |
| `npx playwright test` with `CANDC_FIXTURE_PORT=4507` and `CANDC_BROWSER_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe` | 23 tests passed, exit 0, about 2.2 minutes. The isolated build ran under `.cache/verification`; the fixture logged `.cache/e2e-ezNoyz` and used only fake providers. |
| `git diff --check` on changed tracked paths | Passed; changed untracked files have no trailing whitespace. |
| `dist/` and `web-dist/` | No file newer than the pre-change backup; the normal `build`, `check`, launcher and running instance were not touched. |

Computed message viewport, default 16px, long topic, ordinary paused status, inspector closed, empty composer; both themes produced the same bounds and no horizontal overflow:

| Window | Message height | Height share | Required |
| --- | ---: | ---: | ---: |
| 1440x900 | 618.03px | 68.67% | at least 60% |
| 1280x720 | 438.03px | 60.84% | at least 60% |
| 390x844 | 564.03px | 66.83% | at least 50% |

The first run measured 59.73% at 1280x720; reducing issue-row, composer and bottom spacing by 2-4px each restored the margin.

Contrast, computed with the WCAG relative-luminance formula from the token values. Lowest ratios: light `--faint` 4.63:1 (on hover and current-issue fills), dark `--faint` 4.64:1 (on the current-issue fill), light provider names 4.76:1, light primary action 6.42:1, dark primary action 8.26:1. Body text is at least 10.79:1 (dark human bubble). An initial pass found light `--faint` at 4.40:1 on the page and dark `--faint` at 3.97:1 on the current-issue fill; both tokens were adjusted before the final run.

Screenshots of both themes at 1440x900, 1280x720 and 390x844, the issue inspector, reply drafting, the four-AI fixture and the creation page (including debate roles and expanded limits) were inspected against the mockup. Deliberate deviations from the mockup: the reply-source choice is a settings row instead of a separate demo button, no Ctrl+N hint (browsers reserve it), and no "X hands over to Y" divider text because saved state records only round numbers.

Remaining limits: as above, desktop Chrome with simulated mobile viewports only; no Firefox/WebKit, screen reader, physical device or live provider run. The running instance on port 4317 still serves the previous build until it is rebuilt and restarted.

## Approved conversation UI delivery (2026-10-03)

Implemented the approved group-conversation direction with stable left alignment for all AI, right alignment for humans, 28–30px labeled avatars, restrained neutral themes and subtle bubbles. One header/current-issue row precedes the independently scrolling conversation and composer. History is 200px on desktop and a closed-by-default mobile drawer. One internally scrolling inspector contains issues, participants/roles, reading preferences, settings, sources, connection and diagnostics. It docks at 320px from 1280px and overlays below that with Escape, focus containment and focus return. Pause-after-answer and immediate stop remain accessible during execution. Storage uncertainty keeps explicit verification/repair controls prominent.

Creation retains explicit supported models/efforts, manual/free defaults, research opt-in and editable limits. It has one heading, optional supplemental fields, a concise effective-settings summary, and a focusable reason when start is unavailable. Linked references are rendered only for complete eligible sources. Replies prepare cancellable unsent drafts, including compatible directed routing. Sending no longer forces a reader who scrolled up back to the bottom. Message information keeps unknown annotations distinct from completion. Safe reading segmentation and complete exports remain intact. Four AI identities and host process/speech examples are presentation fixtures only; backend provider enums and orchestration remain unchanged.

Only independent display metadata was added to backend contracts. Optional `displayName` and `displayVersion` use authenticated `PATCH /display-name`, existing exclusive commit/storage barriers and a separate optimistic display version. Renaming is blocked during execution or uncertain storage. It does not alter task/configuration versions, snapshots, receipts, issue proposals/confirmations, overall completion or budgets. Tests include a confirmed overall result remaining unchanged after rename, restart/replay, stale/invalid/unauthorized writes, no-op rename, legacy reconstruction and upgrade. New unnamed creation omits display metadata. Old histories are read without rewriting them.

Observed verification:

- `npm run typecheck`: passed, backend and browser TypeScript.
- `npm test`: 216 tests in 25 files passed. The starting workspace already contained 210 tests and the focused/recovery changes; those are preserved, not claimed as newly implemented UI work. This batch added six tests for independent display metadata, eligible source links and partial/unknown message states.
- `CANDC_VERIFY_DIR=.cache/ui-redesign/final-build npm run build:isolated`: passed with backend output and Vite assets exclusively under that cache directory. The normal `build`, `check`, launcher and production restart were not run.
- `npm run test:e2e -- --max-failures=1`, with `CANDC_FIXTURE_PORT=4507` and `CANDC_BROWSER_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`: 23 tests passed, exit 0, about 1.2 minutes. The final fixture logged `.cache/e2e-hY8Vm0`, the isolated build directory and only fake Codex/Claude adapters. The Browser plugin was not available; bundled Chromium failed before navigation with `spawn UNKNOWN`. Installed Chrome worked. Earlier successful cases were followed by a Windows runner teardown timeout; global teardown now verifies fixture identity before calling the existing authenticated shutdown API. The final run shut down cleanly. All ports created by this task (4497–4507) were subsequently confirmed closed; 4317 was not accessed.
- Browser matrix: both themes at 1440x900, 1280x720 and 390x844, with 14/16/18px preferences, short/long topics, nested headings, tables/code, with/without detail boundaries, issue inspectors, mobile history, four-AI presentation, source/hash display, references/cancel/directed recipients, source focus, scroll freeze/new-content return, role confirmation, pause/stop/rebuild, storage uncertainty after refresh/recovery, legacy histories and complete exports. Theme/font/reading preferences and display names survive refresh. Presentational actions preserve saved data and do not add fake provider calls. Inspector opening retains an existing draft and scrolled-up position, without reducing viewport height. The rendering matrix reported no page errors, console errors, horizontal document overflow or framework overlay. The session-renewal fixture separately exercises an intentional rejected authentication response.
- Compared SHA256 of all 62 starting files under `dist/`, `web-dist/` and `data/`: unchanged. Starting snapshots are under `.cache/ui-redesign-baseline`; the task audit is `.cache/ui-redesign/audit.json`. Existing adapter, scheduling, store and focused implementations outside the narrow display-name additions remain the user's prior work.
- Text/theme token contrast checks passed for text/page, text/surface, text/human bubble, muted/bubble, primary text/action and warning/background. The lowest tested ratio is 4.91:1 for the dark primary action; body text is at least 12.70:1 on reading surfaces.

Computed message viewport, default 16px, long topic, ordinary paused status, inspector closed, empty composer and no software keyboard; both themes produced the same bounds:

| Window | Message height | Height share | Required |
| --- | ---: | ---: | ---: |
| 1440x900 | 616.92px | 68.55% | at least 60% |
| 1280x720 | 436.92px | 60.68% | at least 60% |
| 390x844 | 530.48px | 62.85% | at least 50% |

Concept and actual screenshots were inspected. The implementation intentionally removes the concepts' alternating AI positions, large avatars, gradients, slogans and unsupported attachment controls. The first 1280x720 measurement was only 56.36%; removing duplicate composer copy/empty-space restored the target while retaining 16px reading text. The completed viewport is measured, not inferred from screenshots. Evidence is in `<local-screenshot-path>`: `workspace-{light,dark}-{1440,1280,390}.png`, `full-*`, `issues-*`, `four-ai-fixture.png`, `four-ai-mobile.png`, `sources-fixture.png`, `storage-unconfirmed.png` and `legacy-mobile.png`. Playwright's `accepted-results/.last-run.json` records `passed` with no failed tests.

Compatibility/rollback: a disposable test compiled the complete pre-UI domain/store snapshot and checked it against current journals. It accepts an unchanged unnamed journal, but its strict schema rejects journals containing the new display fields. Rejection does not rewrite bytes; the current reader retains the name and task state. Report: `.cache/ui-redesign/metadata-compatibility.json`. A complete rollback requires preserving new journals separately and restoring the matching prior history backup/build. A UI-only rollback can retain the current backend/schema. No user-history migration, live inference, paid API, deployment, formal runtime replacement, commit or push occurred.

Remaining limits: this is installed desktop Chrome with simulated mobile viewports, not physical iOS/Android or an actual software keyboard/safe-area device. Firefox/WebKit, screen-reader output, real provider behavior and billing were not exercised. Dynamic viewport/safe-area support is implemented, without claiming a fixed reading percentage while the software keyboard is open. Fake/browser evidence establishes application UI and contracts, not live model quality, factual correctness or subscription savings.

## Focused review repairs N1-N7 (2026-10-03)

The seven confirmed review defects are repaired locally. Thirteen new integration regressions failed against the previous implementation and passed after the fixes. They use fake adapters and disposable `.cache/test-*` journals, including real-store schema rejection and storage fault injection.

- N1: switching away from a confirmed blocked issue returns it to pending, preserves its result/unresolved items and commits an in-flight completed answer with its original attribution.
- N2: schema rejection returns `INVALID_STATE` before append without changing journal bytes or raising a storage barrier. Actual append/sync/close failures still block later writes and scheduling. Legacy auxiliary failure tests now inject a real store fault instead of a generic mocked exception.
- N3: queued finishing and round transitions recheck running state under the commit lock. A stop during final commit remains stopped in manual, automatic and summary execution, does not advance the round and rejects ordinary start until rebuilding.
- N4-N5: a peer check updates every outstanding request linked to the checked answer. Later model annotations preserve human disposal and existing peer checks, including their recorded reasons.
- N6: identical normalized configuration is a no-op; including unchanged goal/constraints alongside a real mode change preserves the issue proposal/confirmation. Changing task content still invalidates them. The browser suite verifies the unchanged goal/constraints submission through the actual form.
- N7: oversized auxiliary input preserves both stopped and indeterminate states without preparing a call or receipt.

Final observed checks:

| Check | Result and isolation |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm test` | 210 tests passed in 23 files. |
| `npm run build:isolated` | Passed under `.cache/claude-fixes-20261003/build`; normal runtime outputs preserved. |
| `npm run test:e2e` | All 14 cases passed, exit 0, installed Chrome, fake-only fixture on port 4479. |
| `node scripts/verify-rollback.mjs 63d264e083de134c608830ff26ec0d1edc842380` | Passed against disposable histories; report retained at `.cache/claude-fixes-20261003/rollback-result.json`. |
| `git diff --check` | Passed. |

The first sandboxed browser run reported all 14 cases successful but exited 1 after a 240-second fixture teardown timeout. Inspection confirmed this run's fixture PID 27340, command, creation time and port 4479 ownership before stopping that stale helper; the older fixture was preserved. A retry through approved execution completed normally in 38.3 seconds with exit 0. Browser outputs are under `.cache/claude-fixes-20261003/e2e-approved-results`.

No application history, normal runtime build, running application service, live provider, commit or remote push was changed. Journal encoding/versioning is unchanged. The rollback verifier proves legacy reading by new code, source preservation during upgrade, old-reader rejection of upgraded data and baseline-backup restoration; it does not prove old-reader compatibility after a legacy discussion is continued by new code. Live provider behavior and release acceptance remain unverified. Previously affected histories still require their existing explicit recovery/rebuild flow; this batch performs no data migration or automatic retry.

## Focused discussions and durable input receipts (2026-10-03)

Local engineering validation is complete for this batch. Live model behavior and product-quality acceptance remain unverified. All model turns in this batch used fake adapters or scripted protocol connections; no real AI inference, external research, additional subscription billing, deployment, push or user-history migration was performed. The historical live smoke results below are earlier evidence and do not validate the new protocol.

Final observed checks:

| Check | Result and isolation |
| --- | --- |
| `npm run typecheck` | Backend/browser TypeScript checks passed. |
| `npm test` | 197 tests passed in 22 files. Disposable fixture history under `.cache/`. |
| `npm run build:isolated` | Backend compilation and Vite build passed under `.cache/verification/dist` and `web-dist`. |
| `npm run test:e2e` | All 14 browser cases passed with installed Chrome and a fresh fake-only fixture on port 4469. |
| `node scripts/verify-rollback.mjs 63d264e083de134c608830ff26ec0d1edc842380` | New code read baseline legacy data, upgrade preserved the source journal, baseline code rejected the new format, and restored baseline backup was readable. Disposable fixtures only; result `.cache/rollback-result.json`. |
| `git diff --check` | Passed; no whitespace errors. |

`npm run check` was deliberately not used because it overwrites the normal `dist/` and `web-dist/`. Its static/test/build stages were run with the isolated commands above. The formal output directories, launcher/service and application `data/` were not replaced or used as fixtures. The managed bundled Chromium launcher returned `spawn UNKNOWN`; the final successful suite used the installed Chrome executable through approved execution. No browser case remains skipped.

Browser command:

```powershell
$env:CANDC_FIXTURE_PORT = '4469'
$env:CANDC_BROWSER_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run test:e2e
```

Contract coverage:

| Area | Observed coverage |
| --- | --- |
| Versioning | Legacy defaults/read/export and source-linked explicit upgrade; missing required version 2 fields rejected; no old receipt inference; isolated old-reader/data rollback proof. |
| Input | Independent openings; deltas per native generation; own committed answers not resent; multiple and in-flight user inputs; explicit targets/key references; directed-answer/evidence scoping; mutable configuration versions; changed source/hash evidence and exact repeated-retrieval snapshot; oversized full serialization pauses before calling. |
| Snapshot/storage size | Reconstructed prompt hash and character count match saved call snapshots; public answer text stored once per message; nested storage version 3 replay matches full state. |
| Native sessions | Exact identity checks, provisional identity, timeout/cancellation/cleanup failure and prepared-call restart; explicit rebuild retires generations and carries round/time/limits; stop queued ahead of final commit prevents successful receipt advancement. |
| Control/response | Required control separate from optional annotation; unavailable references rejected; quoted/fenced counterfeit blocks and partial streamed markers; delivery retained when control invalid; versioned proposals and peer confirmation; stale configuration/proposal actions rejected; pending suggestions, distinct skips, disagreement and blocking/nonblocking missing information; queued user switch applied even with invalid control; separate whole-result confirmation and outstanding-user gate. |
| Storage ambiguity | Before/partial/after append, sync/close and repeated recovery failures; no later catch/finally/evidence/model writes; matching complete commit adopted once; same-message-ID content conflict rejected; startup without remembered metadata; truncated-tail backup/repair; middle corruption preserved. |
| UI/API | Create, manual pair boundary, explicit auto/overall confirmation, source jumps, unsent reply/check drafts, reading preference/reload without state mutation, complete export, 390x844 layout, storage warning across refresh, explicit recovery/rebuild and interruption; authentication/SSE bootstrap and legacy discussion/debate/research flows. |
| Diagnostics | Actual serialized component/total character counts and full-history comparator; observed stage offsets and nullable unknowns; provider-returned numeric usage allowlists; no character-to-token/price estimate; private reasoning/raw stderr excluded. |

Desktop 1280x720 and mobile 390x844 screenshots were produced in the task visualization directory as `focused-desktop.png` and `focused-mobile.png`. Screenshots were inspected, and browser assertions observed no horizontal page overflow or fixture page errors. Reading sections preserve complete Markdown tables/code/links; ambiguous or absent boundaries keep the whole answer visible. Reading mode, source jumps and drafts produce no AI call or stored-content mutation.

The recovery proof confirms schema/content/sequence replay plus successful operating-system sync and close at validation time. It does not guarantee power-loss/hardware durability, disk health or concurrent multi-process writers. The program preserves conflicting/middle-corrupt/no-valid-prefix histories rather than guessing a result. Unobserved interrupted call duration is debited conservatively from its saved timeout reservation and separately labeled `uncertainBudgetMs`; it is not reported as measured timing.

Real Codex/Claude adherence to the new task card/control envelope, answer/check quality, long-session retention/compaction, real token savings, subscription savings, provider outages/quota behavior and sustained live discussions were not tested. These require a separately authorized live acceptance run. Rollback requires stopping the service, preserving current journals, and restoring both the pre-upgrade data backup and its matching build; rolling back executables alone may reject newer journals. See `docs/FOCUSED_CONTRACT.md` for the operational/API contract.

## Full-review repairs (2026-10-03)

- `npm run typecheck` passed. `npm test` passed with 146 tests in 16 files.
- Backend and Vite builds passed using `.cache/review-fixes-20261003/dist` and `.cache/review-fixes-20261003/web-dist`. Normal runtime outputs and user discussion data were preserved.
- The complete current browser suite passed: 11 cases, installed Chrome, isolated fake server on port 4449. Command: `node_modules/.bin/playwright test --config .cache/review-fixes-20261003/playwright.config.ts`. This includes session-before-SSE bootstrap, recovery from an initial stream 401, all discussion workflows, research opt-in and per-case cleanup.
- `CODE_REVIEW.md` R1–R8 are resolved. New tests cover protected auxiliary exits, pending directed input, reconstruction above the carried round limit, more than 1 MiB of ordered HTTP replay with concurrent updates, partial key reads and quoted credential values. No additional live provider or external research call was made.
- Existing legacy journals remain readable. Newly completed discussion messages record `inputMessageId` for scheduling; old messages use their historical ordering as a compatibility fallback. Reconstruction requires an explicit limit increase when its next round exceeds the carried budget.
- Remaining limits include generic YAML block-scalar secrets, ambiguous durable append/sync/close outcomes, multi-process writers and unverified live-provider behavior. Passing local checks does not certify these areas.

## Message formatting and opinion composer (2026-10-02)

- Final canonical verification: TypeScript checks, 132 tests in 15 files, backend compilation and Vite build. Five React rendering tests exercise GFM output, Chinese punctuation emphasis (including inline code), escaped delimiters, literal user text, and unsafe HTML/link/image handling. Vitest now includes TSX tests and the root typecheck includes them.
- Local read-only history inspection found 14 AI messages containing table syntax. Browser verification of the existing live discussion rendered 11 tables. The original stored text and provider context were unchanged. Chinese leftover bold delimiters were reproduced in that history and corrected in display only.
- Browser QA used the supported in-app browser on the real server (4317) and an isolated fake fixture (4399). The fixture exercised creation -> manual pause -> multiline opinion -> one-click resume -> both fake agents receiving the complete new opinion. It also verified Shift+Enter newline, Enter submission, cleared submitted input, and a round-limit refusal that retained the saved opinion and displayed the explicit reason. No new real AI inference or external research ran.
- Desktop 1280x720 and mobile 390x844 checks found meaningful content, no framework overlay, no relevant fixture console errors, and no document horizontal overflow. A three-line draft grew to 88px. Mobile composer bounds were y=641.625..804 inside an 844px viewport; the message viewport retained 384px height. Real sidebar history ended at y=404.859 and connection information began at y=420.859, without overlap.
- Screenshot evidence is in the task visualization directory: opinion-desktop.png and opinion-mobile.png. Standalone Playwright regression was added but not executed; rendered interaction proof came from the browser controller. Actual provider responses to newly submitted opinions were not tested.

## Conversation termination and manual default (2026-10-02)

- Before the fix, new regression tests reproduced marker-only `done` entering `indeterminate` and a `yield` response to a waiting peer consuming all ten allowed calls instead of pausing after two. Both failures were observed in automatic and conclusion modes.
- After the fix, `npm run typecheck` and `npm test` passed: 127 tests in 14 files. Ten new tests cover marker-only waiting, empty substantive responses, yield-to-waiting termination, resumption after new input, and legitimate continuation. Waiting does not imply confirmed agreement, and the original `yield` metadata is preserved.
- Backend TypeScript and Vite builds passed with output isolated under `.cache/conversation-fixes/dist` and `.cache/conversation-fixes/web-dist`. Existing runtime builds and discussion data were not replaced.
- `e2e/manual-default.spec.ts` passed using installed Chrome and an isolated fake server on port 4429. It verifies the manual/free defaults, submitted settings, pause after two contributions and mode persistence after reload. No live AI request was made. Model adherence to control markers remains unverified live.
- The existing free-conversation browser case also passed after being updated to select automatic mode explicitly. These two targeted browser cases were run separately; the complete E2E suite was not rerun.

## Compact journals and consistent model controls (2026-10-02)

- `npm run check` passed: TypeScript checks, 117 tests in 13 files, backend compilation and Vite production build. Five storage regressions cover large messages stored once, exact state/event replay, mixed legacy/compact journals, truncated-tail repair, evidence references and replacement arrays, backup recovery, repeated compaction and invalid references.
- Offline migration verified every reconstructed state and event before replacing all four existing journals. Active journal bytes: 1,876,039 before, 117,303 after (93.75% reduction). Four retained gzip backups total 432,970 bytes; active journals plus migration backups total 550,273 bytes (70.67% reduction versus the original journals). Legacy `.json` files were preserved.
- The normal local server restarted on port 4317. The authenticated discussion API recovered all four discussions (sequences 20, 20, 8 and 51); all had null activity. Browser verification opened existing demo history and displayed its user, Codex and Claude messages after migration.
- Browser verification confirmed both model controls are native SELECT elements and enabled; Codex selected `gpt-6-luna`, Claude selected `sonnet`. Claude custom model entry appeared only for the custom option and disappeared when switching back to an alias. Screenshot: `.cache/unified-model-selects.png`.
- No additional live AI message was sent. Existing full-context tests passed; provider-side context compaction behavior remains outside this local proof. Standalone Playwright e2e regressions were updated but were not run for this change; the interactive checks used the supported browser controller.
## Current repair verification (2026-10-02)

- `npm run typecheck` passed; `npm test` passed with 110 tests in 11 files. This includes the subsequent free-conversation and conclusion-mode changes already present in the workspace.
- `tsc -p tsconfig.build.json --outDir .cache/research-hardening/dist` and `vite build --outDir ../.cache/research-hardening/web-dist` passed. The running application's `dist/`, `web-dist/` and discussion data were not replaced. `npm run check` was not rerun because its build writes to those runtime directories.
- HIGH 1–4 repairs remain covered: snapshot-path failure no longer prevents commits, corrupt journals are excluded with a warning while healthy records load, stale activity is cleared during recovery, and role/summary provider failures preserve the prior discussion state. Cancellation and storage failures retain their separate behavior. `public-fetch.test.ts` checks both DNS lookup callback formats with mocked HTTPS; it does not prove a live TLS/HTTP fetch succeeds.
- Research is now off by default in the new-discussion form. Sensitive-path tests cover `.kube`, `.docker`, `.gnupg`, `.azure`, `.npmrc`, `.git-credentials`, `.netrc` and SSH key filenames outside `.ssh`, including nested and case-variant names. Redaction tests use synthetic GitHub, GitLab, Slack, npm, Google-key and JWT patterns plus `_authToken` assignments; they check text, errors and evidence.
- The new `e2e/research.spec.ts` passed using installed Chrome and an isolated fake server on port 4419. It verifies default opt-out, explicit opt-in, and removal of submitted roots after opting out again. Creation requests were intercepted, so no live AI turn or external research request ran. Command: `node_modules/.bin/playwright test --config .cache/research-hardening/playwright.config.ts`. The complete E2E suite was not rerun for this change.
- Remaining limits: pattern-based redaction is incomplete; existing discussions keep their research setting; journal growth and ambiguous append/sync/close outcomes remain unresolved. No live-provider validation or long-duration run was performed in this repair batch.

## Historical delivery checks

The entries below record earlier validation runs and their counts, versions and runtime states; they do not describe the current running service.

- `npm run check`: backend and browser TypeScript checks, 50 tests in six files, and the production backend/Vite build passed.
- Scheduler tests cover independent opening answers, shared later context, alternating first speakers, exact session reuse, user targeting, pause/stop, limits, duplicate requests, single active execution, timeouts, uncertain recovery and redaction across chunks.
- Debate/summary tests cover position confirmation, two fresh summary sessions, preservation of discussion sessions, and reconstruction from completed history.
- HTTP tests cover local authentication, Host/Origin enforcement, API input restrictions, SSE replay/disconnect behavior, and preservation of custom limits when only mode or roles change. The last regression was found during browser validation and fixed before delivery.
- Real MCP stdio integration exposes exactly four read-only tools, reads a disposable fixture, records evidence hashes, redacts a fixture secret and rejects a credential file. Directory tests cover traversal, alternate streams, escaping junctions, binary/oversized files, private IPs and blocked URLs.
- Live tests: one successful harmless identifier request per provider, with research off and no project data. Codex resolved to `gpt-6-luna`; Claude resolved to `claude-sonnet-5-5`. Both returned marker `3bca3435-6a4f-469a-8b84-c4bd1a68c87c`. The report is `.cache/live-smoke-report.json`. Earlier Codex attempts failed during startup/preflight, before sending a model turn; Claude was not retried.
- Actual browser validation through the Codex browser controller covered creation, manual rounds, targeted interventions, debate position editing/confirmation, mode switching, immediate stop, reconstruction, editable limits, a three-round automatic run stopping at its limit, two-provider summary, reload restoration, JSON and Markdown downloads, and a 390px mobile layout without horizontal overflow. Example screenshots are `.cache/candc-ready.jpg`, `.cache/desktop-discussion.jpg`, and `.cache/mobile-discussion.jpg`.
- `scripts/start.ps1 -NoBrowser` and `scripts/stop.ps1` were exercised against the actual local application. Start runs the backend hidden; stop closes it through its authenticated local API and preserves history. Final restart serves the complete application on port 4317.

## Verification limits

Debate side/persona UI update: `npm run check` passed with 112 tests in 12 files; subsequent dirty-role UI changes also passed frontend/backend typechecks and build. Actual fixture-browser validation covered swapping Codex to opposition and Claude to support, optional persona saved into the discussion, creation without an AI role-proposal request, initial confirmation, and disabling start after editing confirmed persona until re-confirmed. Original custom roles remain editable. Screenshot: `.cache/debate-side-persona.jpg`. Prepared browser regression cases were updated; no additional live AI messages were sent.

IM/full-context update: `npm run check` passed with 112 tests in 12 files. Full-context regression tests confirm both subsequent provider requests contain complete opening answers beyond the former 80,000-character window, and over-budget input pauses before any provider call. Actual browser checks on an isolated fake-only long-answer fixture confirmed left/right speaker positioning, complete first/last paragraphs and end markers, zero distance from the latest output while following, scroll position retained at the top during resumed output, return-to-latest behavior, and a completion notice visible outside the scrolling history. At 390x844 there was no page scrolling or horizontal overflow and the notice/input stayed visible. Screenshots: `.cache/im-long-complete.jpg`, `.cache/im-mobile.jpg`. No live provider turn was sent; native provider context retention/compaction remains outside this local proof. The prepared browser regression was exercised through the supported browser controller; the standalone runner was not rerun.

The production model dropdown was also verified against the installed Codex CLI catalog: eight models loaded successfully. A backend launched inside the managed filesystem sandbox could not create Codex home temporary files; a normal-permission catalog read and hidden local backend startup resolved that launch-context issue. The normal backend still binds only to 127.0.0.1. Screenshot: `.cache/model-dropdown-conclusion.jpg`. This catalog check did not start an AI turn.

Model-dropdown and conclusion-mode update: `npm run check` passed with 79 tests in ten files. New checks distinguish confirmed peer agreement from unrelated proposals, invalid references, and missing input, across free and alternating flow. Actual browser validation on the isolated fixture confirmed a native Codex model select, supported-effort selection for a model without medium effort, automatic pause after peer confirmation, hidden control markers, and mode persistence after reload. Screenshot: `.cache/conclusion-confirmed.jpg`. No additional live AI messages were sent; actual provider adherence to conclusion markers remains unverified.

Free-conversation update: `npm run check` passed with 74 tests in nine files. New scheduler tests cover consecutive contributions, fairness, both-provider waiting, new user input, restored scheduling metadata, manual boundaries, total contribution limits, pause/stop, and missing control metadata. Actual browser validation on the isolated fake-only fixture confirmed the order Codex, Claude, Codex, Codex, Claude, Claude, automatic pause when both wait, hidden scheduling markers, and free/automatic settings after reload. Screenshot: `.cache/free-conversation.jpg`. No additional live provider requests were made; model adherence to continuation metadata has not been verified live. The prepared standalone browser test remains subject to the runner limitation below.

Reading-layout update: `npm run check` passed again after adding persistent light/dark mode, 14/16/18px text and sidebar collapse, compact speaker cards, and hidden round-number metadata. Actual browser checks confirmed preference restoration after reload, distinct speaker border colors, and no horizontal overflow at 390px. Browser warning/error logs were empty. Screenshots: `.cache/candc-dark-reading.jpg`, `.cache/candc-light-reading.jpg`, `.cache/candc-dark-mobile.jpg`. No additional live AI requests were sent for this update. The standalone browser runner remains unverified as described below.

- The standalone Playwright runner could not launch Chromium in this managed execution environment (`spawn UNKNOWN`), including an approved retry. Those two automated browser cases are not reported as passed. The actual browser workflows above were instead executed using the supported browser controller.
- The authorized live check was intentionally limited to a harmless, tool-free request per provider. Live research, live native-session resumption, long-running provider debates, quota exhaustion, provider outages and enterprise policy combinations were not exercised. Their local protocol, scheduler and read-only gateway checks are separate evidence.
- Startup policy checks disable inherited Codex MCPs and verify the effective policy. The application does not weaken managed CLI policy or guarantee isolation from a malicious installed executable or local administrator.
- Test history was isolated in `.cache/e2e-*`; the user's existing `data/` discussion history was preserved. The stale test fixture was identified by exact PID and command line before being terminated; no user server was killed.

## Source references

Runtime contracts were checked against installed CLI help and generated Codex request types, with supporting official references: [Codex configuration reference](https://developers.openai.com/codex/config-reference) and [Claude CLI reference](https://code.claude.com/docs/en/cli-reference). Future CLI updates require deliberate revalidation.
