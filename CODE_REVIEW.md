# Full project code review

Date: 2026-10-02 (Asia/Taipei).

## Resolution update — 2026-10-03

All eight findings below have been addressed locally. The original findings are retained as baseline evidence, not statements that the defects remain open.

| Finding | Resolution and regression evidence |
| --- | --- |
| R1 | Auxiliary pause, context-limit and duration-limit exits preserve stopped/indeterminate state. Tests verify pause and context-limit paths cannot unlock a discussion. |
| R2 | Completed discussion messages persist the last user input actually consumed by the request. Scheduling and conclusion checks require the intended recipient to process pending input before settling. Tests include in-flight directed input and persisted replay. Legacy records remain readable. |
| R3 | SSE replay waits for stream drain; concurrent updates use a bounded queue and are delivered once in sequence. A real HTTP test replays more than 1 MiB plus an event arriving during replay. |
| R4 | Full bounded file content is redacted before slicing, preserving source line numbers. Tests read the middle of a key and multiline quoted secret. |
| R5 | Assignment redaction consumes complete quoted values, including escaped quotes and whitespace. Tests cover single/double quotes, multiline and unfinished quoted values. General YAML block-scalar parsing remains outside the filter's guarantee. |
| R6 | SSE waits for session initialization; terminal stream failures trigger session renewal and stream recreation. Two Chrome cases verify delayed bootstrap and an initial 401. |
| R7 | Automatic test cleanup stops and waits for remaining fake activities, long-answer waits match the fixture, and SELECT/send-and-resume interactions match the UI. All 11 E2E cases passed in the isolated run. |
| R8 | Start rejects a round already above the copied limit before provider preflight. Reconstruction carries the round budget; users can explicitly raise it. Regression verifies no call occurs until the increase. |

Final local checks: typecheck passed; 146 tests in 16 files passed; isolated backend/Vite builds passed; all 11 E2E cases passed with installed Chrome and fake providers. No live inference, user-data mutation, normal-build replacement or remote push was performed. The security filter is not complete data-loss prevention; live provider behavior and remaining limits recorded below have not been certified.

## Scope and outcome

This review covers the current source tree, not a historical diff: the project had no Git repository when the review began. Hand-maintained backend, adapters, frontend, scripts, configuration, tests and owning documentation were inspected. Generated Codex declarations were treated as checked-in protocol contracts, not independently certified against a live provider. Product code was not changed by this review. Git initialization, ignore rules and this report are the only intended deliverable changes.

At the review baseline, eight actionable findings remained, including one P1 lifecycle defect. Review probes use synthetic data and fake adapters. No user discussion contents or live provider requests were used. See the resolution update above for the subsequent repairs.

## Standards

No additional hard coding-standard violation is reported. Style and duplication observations were excluded because they do not establish a behavioral defect. Existing local-machine trust is documented and is not reported as a newly fixed authentication boundary. The initial Git baseline excludes user history, dependencies, build outputs, cache, scratchpad and common credential files.

## Spec and behavior findings

### R1 — P1: Pausing a summary clears an uncertain discussion's reconstruction requirement

Location: `src/controller.ts:318`.

The transition preserves `runtime.originalStatus` only when `specialFinished` is true. Start a summary on an `indeterminate` discussion and request pause before its first answer completes: `runtime.pause` ends the activity with `status: paused`. A subsequent ordinary start is accepted and reuses the same uncertain native session. The same path changes `stopped` into `paused`. Browser disconnects can request pause too.

Observed fake-adapter probe: `before indeterminate`, `after-summary paused`, then the resumed discussion request contains the exact session ID from the uncertain turn. This bypasses the documented requirement to reconstruct before resuming uncertain execution.

Fix direction: preserve protected original states on every auxiliary-operation exit, including pause and duration termination, not just normal completion. Add both stopped and indeterminate cases and assert that no uncertain session can be reused.

Evidence: `.cache/review-audit-runtime/probe-indeterminate.mts` and `probe-pause.mts`; independently rerun by the primary reviewer.

### R2 — P2: An in-flight answer can consume the scheduling reset for input it never saw

Location: `src/conversation.ts:27-31`; completed-turn persistence in `src/controller.ts`.

The scheduler determines which answers follow new input from message append order. If the user sends a directed intervention while its target is already generating, the old turn's eventual answer is appended after the intervention. Its `done` marker therefore counts as having processed that new input. A peer's subsequent `yield` can settle the discussion even though the intended recipient has never received the intervention in a request.

Observed probe: send `URGENT NEW FACT` to Codex during its second request; all recorded provider contexts have `has: false`, but execution ends with `Both agents are waiting for new input.` The message is stored, but the automatic run never processes it.

Fix direction: associate completion/scheduling markers with the input revision actually consumed by the request. Pending targeted input must remain eligible for its recipient before the scheduler settles.

Evidence: `.cache/review-audit-runtime/probe.mts`; independently rerun.

### R3 — P2: Large SSE replay disconnects even a healthy client before delivering events

Location: `src/server.ts:129-130` and the synchronous replay loop at lines 145-146; `web/App.tsx` opens the event stream without an initial sequence cursor.

Replay writes all events synchronously. Once `writableLength` exceeds 1 MiB, the socket is destroyed before the queued writes can drain. This is triggered by accumulated history, not necessarily a slow client. A new browser subscription starts from zero, so reconnecting can repeat the failure without receiving a usable event ID.

Observed isolated HTTP probe: 40 accepted 32,000-character user messages; `after=0` fails with `UND_ERR_SOCKET` and zero bytes received, while `after=40` returns HTTP 200 and 32,345 bytes. This can remove progress updates and destabilize disconnect/pause behavior for longer discussions.

Fix direction: replay with bounded writes and backpressure/drain handling, and initialize the browser stream from the state snapshot's sequence where appropriate without introducing a snapshot/subscription gap.

Evidence: `.cache/review-audit-storage/probe-sse.mts`; independently rerun.

### R4 — P2: Partial file reads bypass multiline private-key redaction

Location: `src/research.ts:72-75`.

File content is sliced into the requested line range before `evidence()` applies redaction. Reading only lines inside a PEM block removes the BEGIN marker needed by the private-key regex. A permitted notes/config file containing a pasted key can therefore return its body to the provider and evidence journal, even though reading the entire file redacts it.

Observed synthetic probe: whole-file read redacts a PRIVATE KEY block; `startLine=2, lines=1` returns `2: SYNTHETIC_PRIVATE_KEY_BODY` unchanged.

Fix direction: detect/redact sensitive spans in the complete file before selecting a range, preserving source line numbering and bounds. Test middle-of-block reads as well as complete reads.

Evidence: `.cache/review-audit-storage/probe-redaction.mts`; synthetic-only, observed by storage reviewer.

### R5 — P2: Quoted passwords containing spaces are only partially redacted

Location: `src/redaction.ts:7`.

The assignment regex stops at whitespace even inside a quoted value. `password="synthetic first second"` becomes `password=[REDACTED] first second"`. Thus a supported credential field still exposes part of its value. YAML block values likewise require separate handling; generic pattern filtering remains incomplete.

Fix direction: consume complete quoted scalar values before the unquoted fallback. Add whitespace, escaped-quote and multiline cases with an explicit supported-format policy; do not imply general data-loss prevention.

Evidence: the same synthetic redaction probe. This is separate from R4 because it also occurs without line slicing, including ordinary text/error redaction.

### R6 — P2: Restored browser selection can open SSE before session renewal

Location: `web/App.tsx:24` and `web/App.tsx:28-39`.

Session initialization and EventSource creation run in separate effects. A persisted selected discussion can subscribe using the previous server's cookie before `/api/session` returns the new one. Chromium closes EventSource on HTTP 401. Successful session initialization does not change the subscription dependency, so no replacement stream is opened for that selected discussion. Polling masks some state updates but does not restore progress events or establish the server's disconnect subscription.

Observed Chrome probe with mocked HTTP routes and real EventSource: delay session completion, reject the initial event request, then authenticate and start the selected discussion. The event request count remains one and the reconnect warning persists. This verifies browser/effect behavior; it is not a live-provider test.

Fix direction: gate event subscriptions on successful session readiness and recreate them after authentication renewal.

Evidence: `.cache/review-audit-ui/session.spec.ts`, reported passed by UI reviewer.

### R7 — P2: E2E timeout and cleanup gaps cascade into unrelated cases

Location: `e2e/research.spec.ts:20`; completion/button assertions in `e2e/discussion.spec.ts`.

The research test calls `.fill()` on the current Claude model SELECT, causing a deterministic Playwright error before submission assertions. The long-answer case expects completion within the default 5-second assertion window despite a deliberately slow fixture; its failure does not stop the running discussion. The following conclusion, free-conversation and manual cases then encounter BUSY. Separately, the manual intervention test still expects the former send-only flow although the current button sends and resumes.

Full isolated Chrome run: 9 cases, 4 passed and 5 failed. Error snapshots show the first long fixture still generating at 992 characters, and the next three failed cases display the existing-discussion BUSY warning. The fifth failure is research model entry. These failures do not establish five product defects. Use appropriate completion waits, stop and await runtimes in per-case cleanup, and update the SELECT and intervention interactions to current contracts.

Evidence: `.cache/full-review/e2e-results.json` and `.cache/full-review/results/`.

### R8 — P2: Reconstructed discussions can start above their copied round limit

Location: `src/controller.ts:110-112` and `src/controller.ts:150`.

Fork copies the old limits, advances `round`, and clears completed contributions. Start checks `maxRounds` only inside the already-completed-pair branch. A fork at round 2 with maxRounds 1 can therefore start and make two more calls before stopping.

Observed fake probe: finish a one-round discussion, fork it, then start without changing limits; the resulting state is `round: 2, max: 1, messages: 5`. The displayed configured limit does not prevent those calls.

Fix direction: explicitly define whether reconstruction resets or carries the budget. Enforce that choice before any provider invocation and reflect it in the UI; do not implicitly reuse an exhausted limit.

Evidence: `.cache/review-audit-runtime/probe.mts`; independently rerun.

## Validation

- `npm run typecheck`: passed.
- `npm test`: 15 files, 132 tests passed.
- Backend compilation: passed with `tsc -p tsconfig.build.json --outDir .cache/full-review/dist`.
- Frontend build: passed with `vite build --outDir ../.cache/full-review/web-dist`.
- All current E2E files were run with installed Chrome against a disposable fake server on port 4439 using an isolated config: 4 passed, 5 failed. The ordinary `npm run test:e2e` command was not used because it targets the regular dist outputs and fixed fixture port.
- Source hashes were captured to `.cache/full-review/source-manifest.json`; at the verification checkpoint only `.gitignore` differed from that snapshot. Review report and Git metadata were added afterwards.
- No live research, provider inference, production connection, dependency update, user-history migration, external write or Git push was performed. The running application builds were not overwritten.

## Limits and follow-up

This is a complete scoped source review, not proof of absence of defects. Real CLI behavior, model compliance, Windows process-tree cleanup after provider exits, storage fault injection for every sync/close failure, multi-process writers and long-duration capacity remain outside current proof. Existing root-ancestor blocking, research temporary-file retention, fork atomicity/idempotency and ambiguous durable-write failures remain follow-up areas; they were not represented as newly fixed here.

Recommended first fixes: R1, R2, R3, R4/R5, then R6/R7 and budget semantics R8. Findings were intentionally left unfixed because the requested action was review and creation of a Git baseline.

Axis summary: Standards — 0 new hard violations; Spec/behavior — 8 findings, worst P1 (R1).
