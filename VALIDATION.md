# Validation

This is a dated record of observed checks, not a development backlog. Run only
checks relevant to the current task; see [CONTRIBUTING.md](CONTRIBUTING.md).
Contracts belong to their owning documents listed in [AGENTS.md](AGENTS.md).

## Public release automation (2026-10-08)

Scope: configure the official installation URLs and publish version tags only after
Windows, macOS and Ubuntu verification succeeds. Manual workflow runs default to drafts.
The publication checkout uses the existing public baseline; local histories, credentials
and the original working tree are excluded from the release commit.

Observed before pushing: backend/test typecheck, 28 installer/public-source tests
(one POSIX case skipped on Windows), isolated compilation and all 17 affected bubble
and workspace browser tests passed. The public-source allowlist and redacted Gitleaks
scan passed. Normal builds, real discussions and provider authentication were untouched.

The existing native CI failures compared inspector height before/after changing the
draft, or measured overflow before the dock-to-overlay resize effect completed.
Tests now compare the same draft and wait for responsive layout; original height,
contrast, viewport and no-overflow assertions remain. Native release verification and
publication results belong to the tagged GitHub Actions run; these local checks alone
do not establish a published release or successful native execution.

## Deferred frontend view loading (2026-10-06)

Scope: load `RoomView`, `DiscussionView` and `ConnectionsPage` on first use from
`web/App.tsx`, retain the eagerly loaded creation form and mounted workspace, and
show localized loading statuses. Add two delayed-chunk browser regressions and
update the owning UI contract. Preserve unrelated working-tree changes.

Observed checks on this working-tree snapshot:

- Isolated baseline and changed builds passed. Initial JavaScript, including all
  static entry dependencies, decreased from 571,833 to 331,796 bytes (41.98%).
  The largest changed chunk is 271,444 bytes and no chunk-size warning appeared.
  The warning threshold remains unchanged. All JavaScript chunks together total
  574,766 bytes, a 0.51% increase; this is deferred loading, not a reduction in the
  full application's code. CSS is unchanged. These sizes do not measure startup
  latency; opening a saved discussion also loads its view and shared dependencies.
- Backend/frontend typechecks and all three locale tests passed.
- All 13 affected browser cases passed first, including deliberately held room,
  legacy and connection-setting chunks, visible loading statuses, absence of
  unused view requests, and preservation of the mounted composer/private recipient.
- Full coverage passed 588 tests in 51 files with one worker and the unchanged
  default timeout. Two existing POSIX process-group cases were skipped on Windows.
  Unchanged gates passed: lines 77.95%, statements 66.76%, functions 54.33%,
  branches 61.89%. The runner had a 240-second outer timeout and completed normally.
- The full fake-provider browser suite passed all 82 cases in 4.4 minutes using
  installed Chrome at the isolated fixture URL `http://127.0.0.1:4407`, under its
  existing six-minute global timeout. Desktop/mobile light/dark workspace cases,
  drafts, quotations, recipients, reading, Markdown, history and session recovery
  passed. Representative desktop/mobile screenshots were inspected.
- Diff whitespace checks passed.

Commit-candidate verification excluded all unrelated installation/release changes
by applying only these five files/sections to an isolated copy of `HEAD`.
Backend/frontend typechecks and isolated compilation passed with the same chunk
sizes and no chunk-size warning. All 570 tests in 50 files passed with unchanged
coverage gates: lines 78.14%, statements 66.94%, functions 54.39%, branches 61.96%.
All 82 browser cases passed in 4.2 minutes at the fake-only fixture on port 4408.
The lower unit-test count reflects the excluded installer/process changes.
Staged source/test contents matched the verified candidate after Git line-ending
normalization; no assertions, timeouts or coverage thresholds were weakened.

Verification used disposable journals/fake providers without real data,
authentication, live calls, normal build replacement, service restart, commit or
push. Build outputs are isolated under `.cache/verification/chunk-baseline` and
`.cache/verification/chunk-after`; actual live-provider performance is untested.

## Scoped conversation management commit verification (2026-10-06)

Scope: the 29 staged conversation-management files, including M1/M2/N1 repairs.
An isolated copy of the staged tree excluded concurrent installation/release
changes, including their hunks in the server and validation record.

Observed checks on that candidate:

- Backend/frontend typechecks and isolated builds passed. The existing frontend
  chunk-size warning remains; normal runtime outputs were preserved.
- The complete fake-provider browser suite passed all 80 cases in 4.5 minutes
  using installed Chrome, including both native delayed-SSE regressions for N1.
- All 570 tests in 50 files passed with the original five-second default timeout.
  Coverage ran in two complementary partitions: the previously timed-out revision
  case passed independently in 2.38 seconds, and the other 569 tests passed together.
  Both JSON reports were checked by file and collected case position to confirm
  that every case passed, including parameterized cases with duplicate titles.
  Native Vitest blob merging passed unchanged coverage gates: lines 78.20%,
  statements 67.03%, functions 54.59%, branches 61.96%. No test, assertion, timeout
  or threshold was removed or weakened. Counts differ from the broader working
  tree because unrelated installer/process tests are outside this commit.
- The public-source and Git-history secret scans found no leaks. Staged diff
  whitespace checks passed.

Verification used disposable journals/fake providers without real data,
authentication, live calls, normal build replacement or service restart.

## Reconnect warning during normal subscription changes (2026-10-06)

Scope: repair N1 in `web/App.tsx`. Normal SSE subscription replacement no longer
sets the connection state to failed. Opening only part of a subscription set also
does not introduce a failure state. Transport errors still show the warning, and
the warning clears after all subscribed streams open. Other working-tree changes
were preserved.

Observed checks on this working-tree snapshot:

- Two new browser regressions use native EventSource with delayed HTTP requests
  and animation-frame observation, covering selected-only and background-running
  subscriptions. Both failed before the repair and passed after it: normal
  switches show no warning frames, while real HTTP 503 responses still show the
  reconnect warning.
- All 14 affected history-refresh, management and session browser cases passed.
  The complete fake-provider browser suite passed all 80 cases in 4.7 minutes,
  using installed Chrome and isolated compilation.
- Backend/frontend typechecks and isolated builds passed. The existing frontend
  chunk-size warning remains; normal runtime outputs were preserved.
- Full one-worker coverage was attempted twice. Both runs passed 587 tests and
  skipped two existing POSIX-only cases on Windows, but failed the same existing
  five-second backend case in `tests/room-discussion-revision.test.ts`:
  `resets format repairs across independently resolved delivery and review episodes`.
  That case passed when run alone with the unchanged timeout. The cause of the
  full-coverage timeout is unconfirmed; coverage gates are not confirmed for this
  snapshot. No timeout, assertion or threshold was changed.

The owning management contract records the warning behavior. Verification used
disposable journals/fake providers without real data, authentication, live calls,
normal build replacement, service restart, commit or push.

## Conversation management performance and refresh repair (2026-10-06)

Scope: remove repeated full-directory scans during deletion diagnostics, reuse
unchanged marker validation with bounded filesystem concurrency, and separate
debounced history queries from selected detail/storage refresh. Retain corrupt
marker warnings, explicit deletion validation, background SSE subscriptions and
non-overlapping fallback polling. This repair owns `src/store.ts`, `web/App.tsx`,
the affected management tests, `e2e/history-refresh.spec.ts` and the management
contract. Other concurrent working-tree changes were preserved.

Observed checks on this working-tree snapshot:

- All 18 management tests passed. The new filesystem regression checks reuse of
  unchanged validation, later corruption without residual content, replacement by
  a non-regular marker, new residual backups and restart diagnostics.
- Backend/frontend typechecks and isolated builds passed. The existing frontend
  chunk-size warning remains; normal runtime outputs were preserved.
- Full coverage passed 588 tests in 51 files with one worker. Two POSIX process
  group cases were skipped by their existing Windows platform condition. Unchanged
  gates passed: lines 77.99%, statements 66.86%, functions 54.52%, branches 61.91%.
- All 12 affected browser cases passed using installed Chrome. Three new cases
  control SSE and browser timers while using real fixture HTTP responses: healthy
  idle subscriptions stop polling, debounced searches/folder changes fetch only
  the index, disconnected transports retain polling without overlap, background
  events do not refetch unrelated detail, selected events survive coalescing with
  background events, and background subscriptions/polling survive the new form.
- The complete fake-provider browser suite passed all 78 cases in 3.9 minutes,
  including session recovery, private recipients, drafts, scroll/focus and all
  desktop/mobile light/dark workspace cases.
- Separate local before/after runs used disposable directories and five samples
  per marker count. Before repair, median scans took 0.3/67.2/970.6 ms for
  0/100/1,000 valid markers without residual content. After repair, cached medians
  were 0.3/1.6/10.6 ms; the first scan after growing from 100 to 1,000 markers
  took 100.9 ms.
  These timings do not establish production throughput or server saturation.

Verification used disposable journals/fake providers. No real data, authentication,
live calls, normal build replacement, service restart, commit or push was used.
The remaining low-priority review suggestions are outside this repair scope.

## Cross-platform installation and release deployment (2026-10-06)

Scope: standalone release installation, managed start/stop/status/update/doctor,
source launchers, separated immutable versions/data/workspaces, POSIX provider
process groups, safe release packaging and three-platform CI/draft preparation.
The owning guide is [INSTALLATION.md](docs/INSTALLATION.md).

Observed on Windows with Node.js 24.16.0:

- Backend/frontend typechecks and isolated compilation passed. Normal runtime
  outputs were preserved; the existing frontend chunk-size warning remains.
- The full one-worker coverage run passed 582 tests in 51 files, with two POSIX
  cases skipped on Windows. Gates were unchanged: lines 78.44%, statements
  67.17%, functions 54.90%, branches 62.13%. After additional portable filename
  cases, stale private-build rejection and source-export changes, all 25
  installer/public-source tests passed.
- The release smoke installed actual production dependencies outside the repo
  into a Chinese/space-containing path. It loaded the compiled UI in Chromium,
  created and completed a Demo round, stopped, reinstalled, read the saved history,
  ran compiled doctor with all provider paths inaccessible, and stopped again.
  This prevents accidental dependency resolution from repo development packages.
- Nine browser regressions passed for rooms, session renewal and CLI readiness
  prompts. They used disposable journals/fake providers. No full browser rerun
  was required by this backend/installer change.
- Windows source-launcher tests passed, including incompatible/unresponsive ports,
  repeat operations and shutdown not being reported until the listener closes.
  Installer tests cover fixed-version downloads, failed updates, retry, retained
  history/workspaces, locks, instance identity, outside-cwd entries, and malicious
  archive paths/links/duplicates. No test changed the user's PATH.
- Packaging and the generated PowerShell bootstrap's help entry passed. npm audit
  reported zero known vulnerabilities. Redacted source/Git-history secret scans
  and public-source export passed; nothing was published.
- After adding the one-line install commands, 28 installer/public-source tests
  passed and one POSIX shell-input case was skipped on Windows. Generated release
  PowerShell source piped into `iex` returned to its caller and preserved its error
  preference. Script-block options preserved a Unicode path containing spaces;
  a corrupted downloaded installer failed before execution. Downloads were mocked
  and used no network, credentials or real application data. Backend typecheck passed.
  The shell-input test is included in the macOS/Linux CI matrix.

An initial dependency installation failed; switching to an installation-owned npm
cache passed. Its original log was not retained, so the initial root cause is
unconfirmed. Smoke failures now preserve their artifacts. Verification browsers
and output live in workspace cache; successful temporary installations were removed.

macOS/Linux native execution, their POSIX cleanup cases, the remote bootstrap
download, real provider login/inference, and the GitHub workflow have not run on
this host. They require native CI/manual evidence. The checkout has no public
repository URL; OWNER/REPO remains a placeholder until a release is published.
No real data, provider authentication, existing service restart, normal build
replacement, commit, push or publication was performed.

## Manual conversation management (2026-10-06)

Scope: manual Active/Archived/Trash folders for versions 1/2/3, read-only archived
content, restoration, batch management, summary pagination/search/date filtering,
and explicitly confirmed permanent deletion with durable markers and retry.
The owning contract is [DISCUSSION_MANAGEMENT.md](docs/DISCUSSION_MANAGEMENT.md).

Observed checks on the final working tree:

- All 17 management regressions passed, covering mixed-version persistence,
  unchanged content/authority, running and storage barriers, journal/marker
  write/sync/close failures, partial deletion, restart/retry, ID reuse prevention,
  exact file isolation, HTTP authentication, pagination and SSE cleanup.
- The final full coverage run passed all 569 tests in 50 files with one worker
  and unchanged gates: lines 78.63%, statements 67.35%, functions 54.96%,
  branches 62.19%. Intermediate two-worker runs timed out in an existing
  five-second revision case; its focused coverage recheck and the complete
  one-worker run passed without changing assertions or timeouts.
- All 75 fake-provider browser cases passed in 3.7 minutes. The seven management
  cases cover legacy drafts/read-only controls, Chinese/English, both themes,
  desktop/mobile, undo, exports, fixed empty-trash snapshots and failed batch
  selections. Mobile cases now wait for the completed UI transition rather than
  treating backend persistence as evidence that the history drawer has closed.
- Backend/frontend typechecks and isolated compilation passed; normal runtime
  outputs were preserved. The existing frontend chunk-size warning remains.
  Browser verification used the installed compatible Chromium headless shell.
- Public-source/Git-history secret scans, affected documentation links and diff
  whitespace checks passed. Existing unrelated changes were preserved.

Verification used disposable journals and fake providers without real `data/`,
CLI authentication, live calls, service restart, normal build replacement, commit
or push. Fault injection does not establish real device power-loss durability.
Deletion retains content-free markers and does not remove downloaded exports,
agent workspaces or CLI-native histories. Older strict-schema builds may reject
new management metadata; rollback requires a matching saved data/build pair,
and cannot reverse permanent deletion. No automatic retention policy was added.

## Codex session rejection and reviewed idle scheduling (2026-10-06)

Scope: allowlisted Codex RPC failure diagnostics, the distinction between a
rejected session and an unknown-result turn, explicit session reconstruction,
and stopping idle `done` speakers without accepting unresolved review gaps.

Observed checks:

- All 134 affected tests in five files passed, including failure metadata and
  private-error removal, partial-answer preservation, explicit rebuild without
  replay, free/alternating idle scheduling and queued work despite `done`.
- The final full coverage run passed all 552 tests in 49 files, including
  concurrent speaking-task tests, with two workers and unchanged gates:
  lines 78.93%, statements 67.84%, functions 54.80%, branches 62.45%.
- Backend/frontend typechecks and isolated compilation passed. Normal runtime
  outputs were not replaced; the existing frontend chunk-size warning remains.
- The complete fake-provider browser suite passed all 65 cases in 3.6 minutes,
  including new session-rejection recovery and reviewed-idle cases in both
  interface languages. This browser snapshot precedes separate concurrent
  speaking-task interface changes; those changes are outside this repair scope.
  The default managed browser was absent, so verification selected the already
  installed compatible Chromium headless shell (151.0.7922.34).
  Both new browser cases passed again on the latest isolated build after the
  concurrent interface changes. The continuation test now waits for both a new
  call and the final paused state, removing a premature idle-observation race.
- The public-source and Git-history secret scans passed without leaks. Diff
  whitespace checks passed.

An intermediate full-suite run exposed missing translations in concurrent
speaking-task UI work and timeout failures under parallel verification. Lowering
the worker count to two removed the timeout failures without changing assertions
or coverage thresholds. The concurrent translations were present in the final
passing full-suite snapshot. Unrelated source changes were preserved.

All automated model execution used fake providers and disposable journals. No
real discussion was rebuilt or resumed, no CLI authentication or live call was
performed, and no service restart, normal build replacement, commit or push was
performed. The fix reports an active writer and requires explicit recovery; it
does not isolate the shared Codex home or prevent another process taking a thread.
Older strict-schema binaries require a matching journal/build pair for rollback
after new failure metadata has been written.

Commit-scoped recheck: an isolated checkout exported from the Git index excluded
all unrelated speaking-task source, tests and locale edits. This exact repair
snapshot passed all 546 tests in 48 files with two workers and unchanged coverage
gates: lines 79.10%, statements 68.03%, functions 54.99%, branches 62.82%.
Backend/frontend typechecks, isolated compilation and both new browser cases
passed on that snapshot. The lower test count excludes six unrelated tests that
were present in the earlier working-tree check. Review and staged whitespace
checks found no blocking issue within this repair scope.

> **Commit scope:** This revision includes the source, tests and contracts for the
> facilitator, neutral-exchange and repair/fallback changes. Earlier entries retain
> their dated working-tree scope. See [implementation status](docs/IMPLEMENTATION_STATUS.md)
> for the historical baseline and current validation limits.

## Implementation pre-commit verification (2026-10-06)

Scope: the accumulated facilitator opening, neutral discussion/control fallback,
reviewed interim results, fair review handoff and current-proposal prompt gating,
with their source, regression tests, interface translations and owning contracts.
The implementation-status labels now describe this revision rather than a pending
source/test commit. Review found no new blocking issue within this scope.

Observed checks on the final source/test tree based on `b62d2ea`:

- All 139 affected tests in four files passed; the full coverage suite passed all
  532 tests in 48 files. Unchanged coverage gates passed: lines 78.57%, statements
  67.50%, functions 54.21%, branches 62.06%.
- Backend/frontend typechecks and isolated compilation passed. The existing
  frontend chunk-size warning remains; normal runtime outputs were not replaced.
- The complete fake-provider browser suite passed all 63 cases in 3.7 minutes,
  including language persistence, moderator opening, review rebuttal/fallback
  handoff, stage-result display/export, diagnostics, storage and mobile layout.
- Local links in seven affected owning documents and diff whitespace checks passed.
  Automated checks used disposable fixtures, without real histories or live calls.

The earlier bounded live smoke test does not validate the latest review handoff or
repeated-policy changes. Real-model brevity, neutrality and discussion quality for
those changes remain unverified; passing orchestration tests is not proof of them.

## Current-proposal review prompt gating (2026-10-06)

Scope: the full delivery policy and review examples are added only for a peer
without its own recorded review of the current proposal, or an explicit targeted
correction. Acceptance and rejection both count as a recorded review. The proposal
and reviews remain available as discussion context. Replacement proposals reset
reviews and restore independent review instructions. Peer-proposal existence remains
separate from review eligibility so confirmation repair examples retain the correct
proposal ID even for a peer that already reviewed it. No scheduler, journal schema,
UI or consensus-authority behavior changed in this revision.

Observed checks on the working tree based on `b62d2ea`:

- The initial focused run reproduced three repeated-policy failures. After the
  change, all 139 affected tests in four files passed, covering rejected/rebutted
  proposals, accepted reviews awaiting another seat, replacement proposal IDs,
  targeted confirmation repairs and existing role/authority boundaries. A later
  additional assertion that a different unreviewed seat still receives the policy
  passed in a focused recheck.
- Full coverage passed all 532 tests in 48 files with unchanged gates: lines 78.57%,
  statements 67.50%, functions 54.21%, branches 62.06%.
- Backend/frontend typechecks and isolated compilation passed. Normal runtime
  outputs were not replaced; the existing frontend chunk-size warning remains.
- Diff whitespace checks passed. Hash checks preserved all 182 other source/UI/test
  files and their unrelated uncommitted changes.

Verification used fake providers and disposable journals. Browser cases were not
rerun for this prompt-only change. No live call, real `data/`, CLI authentication,
service restart, normal build replacement, commit or push was performed. These
checks establish prompt construction and preserved application behavior, not the
effect on live model discussion quality or remembered earlier session prompts.

## Substantive review response handoff (2026-10-06)

Scope: a substantive peer review gives the proposal author one priority response.
After a completed same-version response is saved, speaker processing consumes the
old review request before handling the response action. A rebuttal or neutral fallback
retains the unaccepted proposal and negative reviews; it neither confirms the proposal
nor produces a final/interim result. Deferred invitations and ordinary scheduling resume.
New technical repair requests survive, and failed/stale responses or storage uncertainty
do not consume the review request. Legacy requests without kind use the existing peer
review classification. The review prompt permits revision or a reasoned disagreement.

Observed checks on the working tree based on `b62d2ea`:

- New regressions initially reproduced five failures involving repeated-author turns,
  manual continuation and deferred invitations. The affected suite then passed 135
  tests; the expanded 55-case revision file also passed after adding legacy reload coverage.
- Full coverage passed all 529 tests in 48 files with unchanged gates: lines 78.56%,
  statements 67.49%, functions 54.18%, branches 62.05%.
- Backend/frontend typechecks and isolated compilation passed. Normal build outputs
  were not replaced; the existing frontend chunk-size warning remains.
- All 14 affected browser cases passed, covering rebuttal/fallback handoff, invitation
  delivery, retained rejection, English/Traditional-Chinese reload, delivery semantics,
  opening and policy continuation. The first run passed 13 cases; its faulty new
  fixture also corrupted the moderator invitation. Restricting injected corruption
  to the author response fixed the fixture, and the complete affected run passed.
- Diff whitespace checks passed. Hashes of all 180 other source/UI/test files matched
  their captured contents; existing unrelated uncommitted changes were retained.

This verification used fake providers and disposable journals. No live call, real
`data/`, CLI authentication, normal runtime replacement, service restart, commit or
push was performed. The earlier isolated live smoke remains historical evidence and
does not establish this new handoff behavior against real models.

## Documentation and project overview (2026-10-06)

Scope: expanded README, a version 3 user guide, a static SVG conceptual overview and
focused interface/room-contract navigation additions. The documentation reflects the
current manual/auto interim-result behavior, until-conclusion outcomes, facilitator
opening, optional-claim diagnostics and existing privacy/storage boundaries. Pending
source/test dependencies are explicitly labeled in README, the guide and contracts;
the implementation-status table distinguishes them from committed baseline `30c2511`.

Observed checks for this documentation change:

- Local links and heading anchors in README, the user guide and interface contract
  resolved successfully. The overview rendered in headless Chromium with all text
  inside its canvas; a visual inspection checked readability and layout.
- The existing public-source allowlist includes README, the guide and SVG without
  changing export code. This was an allowlist check, not a full export or publication.
- Diff whitespace checks passed. Feature statements were compared with current room
  source, UI, exports, launcher/maintenance scripts and owning contracts.

No application behavior changed in this task. Per CONTRIBUTING.md, application tests,
builds and live-provider checks were not rerun for prose/static artwork changes. Existing
verification entries below describe their own snapshots, not checks performed here.

## Facilitator opening and delivery nesting (2026-10-06)

The later revision below supersedes this snapshot's treatment of optional metadata
and participant outcomes in auto/manual modes; the opening and privacy guarantees remain.

Scope: ordinary facilitation opens once before the scheduler-selected first speaker.
The opening cannot change the grant, expose private input or declare a result.
Delivery examples explicitly nest metadata inside action; the parser corrects only
the observed top-level delivery error before strict validation. Judge scheduling,
review authority and legacy journals remain supported.

Observed checks on the working tree based on `30c2511`:

- The initial 19-case regression run reproduced the missing opening and delivery
  schema failures (10 failed). After the fixes and added failure-mode coverage, all
  134 affected tests in six files passed. Three sanitized observed output shapes
  continue to a peer-reviewed result; conflicting/invalid controls and stale task
  versions or grants remain rejected. Pause/stop, reload, reconstruction, privacy
  and one-time scheduling are covered without reading real history.
- Backend/frontend typechecks passed. Final full coverage passed 474 tests in
  47 files with unchanged gates: lines 78.22%, statements 66.86%, functions 53.64%,
  branches 61.05%.
- The isolated browser fixture compiled backend/frontend under `.cache/verification`.
  The existing 550.68 kB frontend chunk warning remains. Normal build outputs were
  not replaced.
- All 57 browser cases passed with installed Chrome, including English facilitator
  creation, Chinese/English switching, original-content preservation, reload,
  independent sessions and desktop/mobile layouts in both themes. The first full
  run passed 56 cases; the new English case used the wrong moderator CSS selector.
  After correcting the selector, all four affected language/moderator cases passed;
  the final complete run also passed. The content snapshot waits for idle execution
  so a naturally completing moderator presentation cannot race the language check.
- Diff whitespace checks passed. SHA-256/absence checks of all 26 pre-existing
  unrelated paths matched their captured contents.

Checks use fake/scripted providers and disposable journals. They establish scheduling,
control parsing, review and persistence behavior; live model brevity, neutrality and
reasoning quality remain unverified. No live provider calls, CLI authentication,
real-history modification, active-service restart, commit or push ran for this task.
The pre-existing unrelated file contents were preserved.

## Neutral exchanges, optional claims and reviewed interim results (2026-10-06)

Scope: initial exchanges receive no full conclusion policy or delivery examples.
Exact peer review and requested corrections receive one relevant example. Ordinary
facilitation has positive brief coordination and retains invitations through manual
boundaries alongside pending work. Judge monitoring and boundary prompts allow peers
to develop unfinished arguments; judge authority stays explicit. No forced opposition,
fixed topic framework or mandatory minimum rounds were added.

Malformed optional work/references/delivery/review claims are rejected with separate
metadata diagnostics. Semantic work/reference failures and incorrect confirmation IDs
preserve saved prose without granting coverage, research completion or agreement.
Required control, ownership, task/grant, unknown-result and storage barriers still block.
Fully reviewed participant results end conclusion mode; auto/manual store interim
results with review provenance and retained reservations. Auto continues; manual waits
after each round. Chinese/English UI and exports distinguish these records from final
outcomes and provisional analysis. Earlier uncommitted opening/nesting work is retained.

Observed checks on the working tree based on `30c2511`:

- All 502 tests in 48 files passed in the full coverage suite. Gates were unchanged:
  lines 78.39%, statements 67.29%, functions 54.13%, branches 61.68%. The new 28-case
  regression file covers prompt stages, both interim modes, reload without rewriting,
  optional-claim failure paths, capacity overflow, valid-reference retention, review
  provenance forgery, judge authority, invitations and neutral debate instructions.
- Backend/frontend typechecks passed. Isolated compilation wrote only to
  `.cache/verification`; the existing frontend chunk-size warning remains (555.36 kB).
- All six affected browser cases passed after updating the manual-review scenario to
  assert an interim result instead of a final outcome. They cover complete/partial
  delivery, disagreement, honest inability to determine an answer, auto continuation,
  manual continuation, original content, reload, localized diagnostics and mobile layout.
- The final complete browser suite passed all 59 cases with installed Chrome, including
  private-input isolation, independent/repeated-provider sessions, legacy histories,
  storage recovery, both languages, desktop/mobile layout and both themes.
- Diff whitespace checks passed. SHA-256/absence checks matched all 23 unrelated paths
  in the prior snapshot; the three additional paths intentionally changed for this
  scope are the UI contract, result strip and English catalog.

Verification uses fake/scripted providers and disposable journals. No real `data/`,
CLI authentication, live AI, active service restart, normal build replacement, commit
or push was used. Fixtures prove application behavior and prompt construction, not
live reasoning quality, factual reliability, neutrality or the optimal policy.

## Repair episodes and neutral control fallback (2026-10-06)

This later snapshot supersedes the preceding snapshot's required-control and
delivery-correction behavior. Existing unrelated uncommitted work was retained.

Scope: substantive peer rejection/revision does not consume technical repair attempts.
Three actual target-speaker repair calls are allowed per unresolved episode during
an explicit execution; resolution resets the count. Conclusion mode pauses on exhaustion;
auto/manual abandon the unaccepted proposal/request and continue with a diagnostic.
Correction targets take priority while different facilitator invitations remain pending.
Malformed core controls become neutral none/observe with yield only after independently
verified envelope, JSON, version and owned task/grant identity. Original claims are
discarded; ownership, unauthorized commands, unknown-result and storage barriers remain.
Peer review samples show both acceptance and rejection without a preferred verdict.

Observed checks on the working tree based on `30c2511`:

- Full coverage passed all 521 tests in 48 files with unchanged gates: lines 78.54%,
  statements 67.45%, functions 54.09%, branches 62.01%. The expanded regression file
  covers independent repair episodes, repeated substantive rejection, exhausted
  auto/conclusion repairs, invitation deferral, six malformed core shapes, opening
  fallback, identity/authority failures and rejection of neutral-call result provenance.
- A four-result persistence regression exposed a missing `interimResults` compact
  journal append allowlist entry. The decoder now supports that owned array; all four
  results replay unchanged without rewriting the journal. Storage uncertainty still blocks.
- Backend/frontend typechecks and isolated compilation passed. Normal build outputs
  were not replaced. The existing frontend chunk-size warning remains (555.84 kB).
- Full browser execution passed 60 of 61 cases. The remaining existing continuation
  case sampled the old idle state before resume began. Its wait now requires increased
  contributions and non-running idle state, preserving the original behavior assertions.
  All six affected cases passed on recheck, including that case and the new English/
  Traditional-Chinese neutral-control and repair-limit diagnostics. Together these runs
  cover all 61 cases; the full suite was not repeated after the test-only wait correction.
- Diff whitespace checks passed.

The explicitly authorized live smoke used disposable journals under
`.cache/discussion-repair-live-hIJSC5`, existing subscription login, and tool-disabled
Codex `0.160.0` / Claude `2.1.287`. Codex speaker and facilitator used `gpt-6.1-sol`
with low effort; Claude's sonnet alias resolved to `claude-sonnet-5-5` with low effort.
The five-minute watchdog did not fire. All seven calls completed without control or
metadata diagnostics: opening, Codex/Claude exchange, coordination, another exchange,
and coordination. All three native session IDs were distinct. Speakers responded to
peer arguments and developed the topic; each moderator message contained two short
sentences, and no forced interruption or unilateral conclusion occurred. Four speaker
contributions completed, then the configured two-round limit paused the room. No final
outcome or reviewed interim result was fabricated.

This single-topic live run did not exercise malformed controls or technical repair
exhaustion against real models; deterministic fixtures establish those failure paths.
It does not prove optimal prompts, factual reliability or behavior across all topics.
No real `data/`, login changes, active-service restart, normal build replacement, commit
or push was used. Native CLI sessions were created only for the authorized isolated run.

## Windows launcher start/stop (2026-10-06)

Scope: repeated stop succeeds when the loopback listener is absent; repeated start
reports the running instance. Failed health checks on occupied ports remain errors.
Shutdown waits for the listener to close, and newly launched instances must return
both the CandC identity and compatible phase before the launcher reports ready.

Observed pre-commit checks on an independent candidate based on `07ff743`, containing
only the launcher scripts, regression tests and their README/validation updates:

- All nine Windows launcher regression cases passed with disposable HTTP services,
  including authenticated shutdown, start/stop/start, incompatible identity/phase,
  unresponsive listeners and an acknowledged shutdown that leaves the listener open.
  Fixture startup uses a stub build and isolated temporary directories.
- Backend/frontend typechecks passed; the full coverage suite passed 450 tests in
  46 files. Existing coverage gates passed unchanged: lines 78.01%, statements
  66.64%, functions 53.46%, branches 60.59%.
- Isolated backend/frontend build passed under `.cache/verification`; the existing
  550.68 kB frontend chunk warning remains. Diff whitespace checks passed.
- Initial fixture runs failed on module/cookie setup and timed out while inherited
  output pipes stayed open. The test runner now uses process exit and a 30-second
  watchdog; only owned test processes were terminated and fixture directories removed.

No real CandC service was started/stopped, normal build replaced, real history or CLI
authentication accessed, or live provider called. Browser tests were not repeated:
this change affects launcher scripts and console status only. Other working-tree
changes remain outside this task's scope.

## Source and documentation cleanup (2026-10-06)

Scope: remove unused round-table presentation code and its exclusive tests, an
unused generated interruption type, the completed one-off live-smoke harness,
old resolved review notes and retired design images. Update the protocol generator
and public-source allowlist. Replace historical handoff instructions with the
current UI contract and a task-specific AI code/document map. Remove four orphaned
English messages; preserve actual interface behavior and all journal contracts.

Observed pre-commit checks on an independent candidate based on `4f3519a`, retaining
the committed quote-preview and bubble/density changes. Concurrent launcher changes
and their README paragraph were excluded from this candidate:

- Backend/frontend typechecks passed; 441 tests in 45 files passed. Seven tests
  exclusive to the unused round-table feature were removed; two public export guard
  cases and five saved-room-message cases were added. The new cases cover repeated
  seat identity, private-recipient labels, completed-only reference previews, incomplete
  output and literal user content. ESM import extensions were corrected in `RoomParts.tsx`
  so the retained component also compiles through the NodeNext test project.
- Coverage gates stayed unchanged and passed: lines 78.01%, statements 66.64%,
  functions 53.46%, branches 60.59%. No source exclusions were added. Before the new
  tests, the current UI snapshot failed the branch gate at 59.94%.
- Backend/frontend isolated builds passed. The candidate browser fixture built under
  `.cache/verification`; the existing 550.68 kB frontend chunk warning remains.
  Normal runtime builds were not replaced.
- All five bubble browser cases passed using installed Chrome and fake providers:
  long-reply folding/focus, light/dark identity and contrast, moderator appearance,
  mobile overflow and persistent compact density. The managed browser was absent on
  the first attempt. One conclusion test hit its 5-second timeout while checks ran
  concurrently; the complete coverage suite passed when rerun separately without
  changing timeouts or assertions.
- Static local-import traversal found no unreachable `src`/`web` TypeScript/CSS
  files. All 28 Markdown local links/anchors and diff whitespace checks passed.
- The candidate public export passed Gitleaks and SHA-256 verification for all 215
  source files; the AI guide is included and all ten retired files are excluded.
- Only the reviewed cleanup candidate is intended for this commit. Concurrent work
  remains separate. No live calls, active-service restart, real-data mutation or push ran.

The full browser suite was not repeated: removed presentation modules/styles were
not reachable from the running UI, and ESM import spelling did not change the built
frontend artifact. The prior 51-case run below remains evidence for its dated snapshot
only. Protocol generation was not run against the installed CLI; its root selection
was updated and current declarations compiled successfully.

## Open-source and English baseline (2026-10-05)

Commit `af65c9d` independently passed:

- Backend/frontend typechecks, 437 tests in 44 files and all 51 browser tests.
- Coverage gates: lines 77.95%, statements 66.64%, functions 53.61%, branches 60.36%.
- Isolated backend/frontend build, secret scan and staged whitespace checks.
- Dependency audit: zero known vulnerabilities for the locked set.

The full working tree had four additional quote-preview draft tests (441 total);
that draft was intentionally kept outside the commit. The complete tested source
scope was compared against the staged tree. English persistence, original-content
preservation and mobile behavior were covered by fake-provider browser tests.

## Interpretation and operating limits

- All ordinary tests use fake/scripted providers and disposable histories. Browser
  execution is not included in unit coverage. Generated Codex declarations alone
  are excluded from the handwritten backend/frontend coverage set.
- Fixture success establishes application behavior, not live reasoning quality,
  provider compatibility, model brevity, factual correctness or subscription savings.
- GitHub-hosted CI, live Gemini/Grok, multiple real sessions of the same provider,
  long-duration failure recovery and hardware power-loss durability remain unverified.
- Multi-process journal sharing and remote/multi-user hosting are unsupported.
  Rollback needs a matching build/journal pair; preserve newer data first.
- Normal `dist/`, `web-dist/`, real `data/`, CLI authentication and unrelated work
  are not development fixtures. Source changes do not update a running service.
- Older dated checks, source references and historical smoke reports are retained
  in Git history. They do not establish current CLI or runtime state; do not rerun
  their one-off plans automatically.
