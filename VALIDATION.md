# Validation

This is a dated record of observed checks, not a development backlog. Run only
checks relevant to the current task; see [CONTRIBUTING.md](CONTRIBUTING.md).
Contracts belong to their owning documents listed in [AGENTS.md](AGENTS.md).

## Discussion template review fixes (2026-10-08)

Reviewed the clean `7d3b3bd` tree and fixed the remaining creation-form regressions.
Seat model/effort callbacks now carry only those settings, preserving role edit
ownership and reset undo. Scenario application waits for pending seat removal.
Selected cards retain their background and border on hover. Engineering Review
role labels now follow the selected locale while inserted snapshots retain their
language. Scenario hints name the visible controls and describe prefilling accurately.
Switching to selection continues to preserve editable goal and role text; the
owning documents and browser assertions now make that behavior explicit.

The new effort and pending-removal cases failed before the implementation changes.
Final backend/frontend typechecks and isolated compilation passed. All 37 helper
tests passed. Complete coverage with `--maxWorkers=2` passed all 58 files:
731 tests passed, three existing platform cases skipped and none failed. Unchanged
coverage thresholds were met: lines 78.10%, statements 67.31%, functions 54.95%,
branches 63.64%.

All 37 scenario browser cases passed, including effort before/after application,
reset undo after an effort change, timed removal, manual edit protection and locale
snapshots. Twelve locale/theme/viewport cases check localized role labels and
selected hover colors alongside existing focus, contrast and overflow assertions.
The complete final browser suite passed all 126 cases with no skips, retries or
failures, including the final English-hint and selection-text preservation checks.
Its 600-second overall cap and 660-second watchdog did not fire.

Reports: `.cache/templates-review-tests.json`, `.cache/templates-review-coverage/`,
`.cache/templates-review-e2e-full.json` and `.cache/templates-review-e2e-full/`.
Verification used installed Chrome, fake providers, disposable journals and
`.cache/templates-review-fixes/` for isolated builds. Source/test SHA-256 hashes
remained unchanged throughout the final browser run. Owning document links and
`git diff --check` passed. No live inference, normal build replacement, service
restart, dependency installation or commit was performed.

## Scenario follow-up fixes and activation (2026-10-08)

The creation form now summarizes current scenario settings, customized managed
fields and all seat/moderator readiness or model-setting gaps. Explicit reset
replaces only template-managed fields; undo restores their values and edit
protection by UID, preserving later changes to other settings. Repeated resets
retain the original undo point. Managed edits, seat changes and scenario
application invalidate undo. Traditional Chinese and English labels are aligned;
editable text retains its selected language snapshot.

The idle-review browser fixture now models an explicit rejection, retaining the
original four-contribution assertion. A separate contradictory-review case checks
clarification by the same reviewer against the exact proposal and target, retained
gaps and unchanged state/call count after reload. This resolves the recovery failure
recorded in the earlier scenario snapshot below without changing execution code.

Final typechecks and isolated compilation passed. Complete coverage passed all
58 files: 729 tests passed, three existing platform cases skipped and none failed.
Coverage met unchanged thresholds: lines 78.10%, statements 67.31%, functions
54.95%, branches 63.66%. The helper suite includes 35 cases. The complete final
browser run passed all 124 cases with no skips, retries or failures. A separate
12-case focus run also passed without screenshots. Both locales, both themes and
1440x900, 1280x720 and 390x844 viewports use enlarged text and check keyboard
focus, contrast, overflow and console output. Final desktop/mobile screenshots
were inspected. Tests exposed sticky-bar overlap on English mobile; scoped action
scroll margins now clear it. The unobscured-focus assertion runs before screenshots
can alter scrolling. Individual test deadlines and behavior assertions were retained;
the expanded full browser run used a 600-second overall cap and 660-second watchdog.

Reports: `.cache/templates-fixes-tests.json`, `.cache/templates-fixes-coverage/`,
`.cache/templates-fixes-focus-final.json` and
`.cache/templates-fixes-e2e-final-second.json`. Verification used installed Chrome,
fake providers, disposable journals and isolated builds. No live inference or
dependency installation was performed. Watchdogs did not fire.

After verification, the authorized source launcher rebuilt normal outputs and
started the local server on port 4317. Health, process ownership and instance ID
matched; all 78 isolated build files matched normal outputs, and the served index
and three startup assets matched their SHA-256 hashes. Before activation, 79 old
build files were copied and hash-verified under
`.cache/templates-fixes-activation-backup/`; its manifest identifies the rollback
outputs. Activation evidence is in
`.cache/templates-fixes-activation-verification.json`. Storage schemas and execution
controllers were unchanged. Document links and `git diff --check` passed.

## Optional discussion scenarios (2026-10-08)

The version 3 creation form now offers six optional scenario cards. Applying a
card prefills only existing goal/kind/mode and speaker label/instruction fields;
manual edits, including cleared text and explicitly selected current values,
survive switching and reapplication. Seat origin tracking uses UIDs. Template
identity and origins are not submitted or persisted. Provider/model/effort,
moderator authority, research, attachments and other settings remain editable
and unchanged by template application. UI labels support Traditional Chinese
and English; previously inserted text retains its language when locale changes.

Observed checks: `npm run typecheck`, isolated compilation and all 33 new helper
tests passed. Complete coverage with `--maxWorkers=2` passed all 58 files:
727 tests passed and three existing platform cases skipped. Coverage met unchanged
thresholds: lines 78.17%, statements 67.48%, functions 55.28%, branches 63.87%.
An initial default-concurrency run hit existing five-second test deadlines;
all 164 cases in those six files passed with one worker, and the complete
two-worker run is the final coverage result.

All 25 new Playwright cases passed together in the final run. They exercise
creation/submitted input, manual edits, UID replacement, selection/debate,
attachment and single-sentence coexistence, unchanged runtime settings and locale
snapshots. Twelve visual cases cover both locales, both themes and 1440x900,
1280x720 and 390x844 viewports with enlarged text, keyboard selection, contrast,
overflow and console checks. Desktop screenshots were inspected. Installed Chrome
was selected through `CANDC_BROWSER_PATH` after managed Chromium failed to launch.

The complete 113-case browser run had 111 passes and two failures. One new
Research Council case failed before template interaction because Chrome could
not load a JavaScript asset (`net::ERR_NO_BUFFER_SPACE`); it passed alone and
in the final 25-case run. The existing recovery test at
`e2e/session-recovery.spec.ts:52` expects four contributions but receives five.
That exact failure was reproduced using an unchanged `90be349` archive in
`.cache/templates-baseline-90be349/`, excluding all scenario changes. Its
contradictory-review fixture now triggers the previously committed clarification
behavior. The old recovery assertion/fixture was not changed in this UI task;
the complete browser suite is therefore not reported as passing.

Reports: `.cache/templates-coverage/`, `.cache/templates-tests.json`,
`.cache/templates-e2e-full.json`, `.cache/templates-e2e-final.json`,
`.cache/templates-e2e-final/` and `.cache/templates-baseline-e2e.json`.
Verification used fake providers, disposable journals and isolated builds;
no live inference, normal build replacement, service restart or dependency
installation was performed. Watchdogs did not fire. Owning documentation links
and `git diff --check` passed.

## Repair-episode integration test deadline (2026-10-08)

The multi-episode repair test now has a local 15-second deadline instead of the
default five seconds. Its original assertions remain, with an additional bound
of exactly 16 provider calls. Product code, provider deadlines, the global test
timeout and coverage thresholds are unchanged.

A temporary diagnostic clone measured 16 fake turns and 100 durable commits in
both runs. Without/with coverage, commit preparation (including schema validation
and journal replay) took 0.82/1.48 seconds; writes plus sync/close took 0.23/0.25
seconds. Coverage and whole-suite execution leave insufficient room in the old
five-second whole-case budget; no extra provider calls were observed. Diagnostic
single-case/file coverage reports intentionally did not meet whole-project
thresholds and are not counted as full verification passes.

The candidate was isolated from concurrent UI work at `814d767` plus this test
change in `.cache/repair-timeout-candidate/`. All 61 affected tests and typechecks
passed. Full coverage with `--maxWorkers=2`, with no case filter or exclusion,
passed all 57 files: 694 tests passed and three existing platform cases skipped.
The formerly timing-out case passed in 6.217 seconds; the suite took 101.39 seconds
and its 240-second watchdog did not fire. Coverage passed unchanged thresholds:
lines 78.29%, statements 67.58%, functions 55.29%, branches 63.95%.
The candidate's `.cache/repair-timeout-tests.json` and `.cache/coverage/` retain
the reports. This resolves the test-deadline follow-up recorded under attachments;
no cases need to be filtered out. Browser tests were not repeated for this
test-only change. No live provider, normal build replacement or restart was used.

## Contradictory conclusion reviews (2026-10-08)

A positive review with nonempty delivery gaps now requests clarification from
the same reviewer against the exact proposal, using the existing bounded repair
episode. Genuine rejection still returns to the author; accepted limitations stay
in the proposal. Done or prose-only replies never imply confirmation. No journal
schema changed and existing paused histories were not rewritten.

Observed on the shared working tree: typechecks, isolated compilation, 101 focused
tests and all 57 files in the final full coverage run passed (694 tests passed,
three existing platform skips). Coverage met unchanged thresholds: lines 78.29%,
statements 67.58%, functions 55.29%, branches 63.95%. The first full run had one
existing five-second multi-episode test timeout; that case passed both a focused
coverage recheck and the final full run without changing its timeout/assertions.
The focused coverage-only recheck did not meet whole-project thresholds, as
expected for one case; the final complete report is authoritative.

All four existing conclusion-delivery browser cases passed using installed Chrome
after the default Playwright launch reported a missing managed browser. Tests used
fake-only disposable journals and isolated build output. Reports are in
`.cache/review-clarification-coverage/`, `.cache/review-clarification-tests-final.json`
and `.cache/review-clarification-e2e-results/`. Verification watchdogs did not fire.
Before commit, the exact staged candidate (excluding unrelated attachment work)
was materialized in `.cache/review-commit-candidate/`; typechecks, isolated
compilation and all 101 affected tests passed again on that candidate.

No live model inference, normal build replacement, service restart or automatic
continuation of the affected real discussion was performed.

## User attachments v1 (2026-10-08)

Version 3 discussion/debate creation and subsequent messages accept text/code,
CSV/JSON, text PDFs, DOCX and XLSX attachments. Originals and redacted extracted
text are saved before the referencing message, scoped to its recipient, and
included in recovery, exports and retryable permanent deletion. Selection and
legacy attachment writes remain unavailable. Existing single-sentence work in
the shared checkout was preserved.

Ten new backend cases exercise actual worker extraction into fake-provider
prompts, same-provider seat/moderator privacy, incremental delivery and rebuild,
hash verification, idempotency, uncertain storage, deletion retries, original
downloads, exports, UTF-8/BOM UTF-16, malformed/encrypted archives, parser timeout,
ZIP expansion, per-file/aggregate limits and oversized-history preflight. HTTP
checks also confirm multipart files over 128 KiB are accepted while JSON retains
its original 128 KiB limit, including whitespace-heavy JSON bodies.

Observed final checks: typechecks and isolated compilation passed. The complete
88-case browser suite passed using a fresh Chrome profile against the fake-only
fixture at http://127.0.0.1:4399. After the final multipart/JSON-limit and
attachment-only draft confirmation changes, all nine affected attachment and
management browser cases passed again. The new flows cover file removal/drop,
creation, preview, original download, failed-draft retention, private file-only
messages, lost-response retry, reload, English labels, cancelled archival and
390px width. Desktop 1280x720 and mobile 390x844 screenshots were inspected;
page identity, rendered content, no error overlay, console health and interaction
checks passed. Browser plugin was not available; Playwright's bundled Chromium
was absent, so the repository's CANDC_BROWSER_PATH option selected installed Chrome.

The final 691-case unit inventory was covered in complementary runs: 687 passed
with coverage, one pre-existing repair-episode case passed independently within
its unchanged 5-second timeout, and three existing POSIX-only cases were skipped
on Windows. Full runs intermittently timed out on that repair case; one run also
hit a transient EPERM renaming an installer fixture directory, which passed on
the next complete run. No assertions, timeouts, source coverage exclusions or
thresholds were weakened. Final commands were:

```text
npx vitest run tests/room-discussion-revision.test.ts -t "resets format repairs across independently resolved delivery and review episodes" --maxWorkers=1
npm run test:coverage -- --maxWorkers=2 --testNamePattern="^(?!.*resets format repairs across independently resolved delivery and review episodes)"
```

The coverage run excludes that one test invocation, not its source file, and
passes the unchanged global thresholds: lines 78.29%, statements 67.58%,
functions 55.27%, branches 63.92%. Parser workers are exercised by real format
fixtures, but their separate V8 counters are not aggregated into Vitest's report.
An earlier complete 690-case coverage run also passed before the final additional
history-limit case and hardening changes.

`npm audit` reported zero vulnerabilities after scoped transitive overrides;
source/history secret scans found no leaks. No live CLI calls, normal runtime
build replacement, service restart or publishing were performed. Real
provider reasoning quality, macOS/Linux filesystem behavior and arbitrary complex
document layouts remain unverified; images/charts/OCR are outside this feature.

The commit-readiness recheck includes the independently committed single-sentence
and conclusion-review changes. Typechecks passed. Both full forks and threads
coverage runs passed 693 cases but timed out on the same repair-episode case above;
that case passed independently (1.68 seconds for the entire focused run). The
complementary coverage command above passed all 57 files with 693 cases, one
explicitly filtered case and three platform skips: 694 unique passes overall.
Coverage was lines 78.29%, statements 67.58%, functions 55.29%, branches 63.95%.
The final coverage run had a 240-second watchdog and finished in 88.25 seconds;
no process was terminated. Audit again reported zero vulnerabilities and source
plus 31-commit history secret scans found no leaks. Whole-suite repair-test timing
remains an observed limitation; no test assertions or thresholds were changed.
Isolated compilation and all nine attachment/management browser cases passed
again on this commit candidate using the fake-only Chrome fixture.

## Single-sentence response mode (2026-10-08)

Implemented the creation-only response setting for version 3 discussions and
debates, independent of execution mode. All AI prose, including conclusion and
review metadata, is checked before publication. A completed, identity-valid
rejected answer permits one correction in the same owned session, with a new
provider request ID and a durable preparation record. Failed/unfinished drafts
never enter public messages or peer input; stop, pause and uncertain storage
retain their scheduling barriers. Older rooms retain their existing behavior.

Before commit, the feature-only candidate was reconstructed from HEAD and the
14 intended files in `.cache/sentence-commit-snapshot/`, excluding concurrent
attachment work. Typechecks, all 53 new unit cases, isolated compilation and all
13 affected browser cases passed on that candidate. The cases cover format and
metadata boundaries, persistence, bounded correction, privacy, cancellation,
storage faults, restart, localized failures, conclusions, reload and 390px width.
Desktop/mobile screenshots were inspected during implementation. Whitespace
checks passed; runtime outputs were not replaced.

The default concurrent full coverage run hit test timeouts. A single-worker full
run observed 676 passed, three existing platform skips and two 5-second timeouts
in existing multi-turn repair cases. Both cases passed independently with
coverage in 1.055 and 2.997 seconds, without changing assertions or timeouts.
This verifies all 678 applicable cases across the full run and focused recheck;
it is not a claim of a timeout-free full run. Native report merging met unchanged
thresholds: lines 79.49%, statements 68.57%, functions 55.87%, branches 64.10%.
Reports are under the candidate's `.cache/commit-coverage/`, with full-run results
in `.cache/commit-serial-tests.json` and native blobs in `.cache/commit-blobs/`.
Partial collections alone fail global coverage thresholds; merged task totals
include duplicate/skipped recheck entries and are not unique inventory counts.

No live AI inference, native session correction, production restart or normal
build activation was exercised. Sentence segmentation is a deterministic format
check, not proof of semantic brevity or a single main idea; those remain prompt
requirements. Rollback compatibility follows the matching journal/build rule in
the room contract.

## Option evaluation v1 (2026-10-08)

Added a separate selection room: the first seat generates 2–6 options and three
shared criteria, then every seat rates the frozen matrix in an isolated session.
All valid ratings must be durably saved before a deterministic, equal-weight
ranking is published. Partial failures preserve accepted scores and require
explicit continuation; ties share rank. Existing discussion modes remain available.

Observed checks: typechecks, isolated compilation and diff whitespace checks
passed. The 27 new unit cases cover matrix validation, fresh sessions, malformed
output, ranking, frozen configuration, partial retry, stop/rebuild and storage
failures including the final ranking commit. Both new browser cases passed,
including creation, reload, exports, English labels, mobile width and partial retry.
Desktop and 390px screenshots were inspected.

The final creation-form correction preserves the moderator draft when switching
to evaluation and back. Both affected browser cases passed again, including
restored moderator/judge controls, unchanged seat/host fields and a submitted
evaluation with no moderator. Typechecks and isolated compilation passed again.

Pre-commit verification repeated the full inventory in complementary batches:
625 passed, three platform skips; merged coverage was lines 77.71%, statements
66.61%, functions 54.23%, branches 62.14%, passing unchanged thresholds. Reports
are in `.cache/selection-commit-merged/`. The initial launcher stop case exposed
an existing isolation defect: source launchers read the repository runtime record
before the fixture port and stopped the running local service. Launcher tests now
copy their scripts into a disposable root, so they cannot read that record. All
nine launcher cases passed after this correction. The service was not restarted.
Source/history secret scans found no leaks.

The complete 628-case unit inventory was verified in complementary runs: 625
passed and three existing POSIX-only cases were skipped on Windows. Whole-suite
coverage runs hit the existing 5-second repair-episode test timeout; that case
passed independently without changing its timeout. A complementary run also hit
a transient Windows EPERM during an installation fixture rename; its rerun passed.
A multiline redaction case omitted by the name filter was included in a separate
redaction run. Native Vitest blob reports were merged, with the unchanged global
thresholds enforced: lines 77.69%, statements 66.58%, functions 54.20%, branches
62.12%. Partial focused coverage reports alone fail global thresholds as expected;
the final native merge passed. Reports are in `.cache/selection-coverage-merged/`
and `.cache/selection-coverage-*-tests.json`.

All 85 browser cases passed across two runs with installed Chrome. The initial
run passed 81 cases before the unchanged 360-second suite deadline; the remaining
four passed separately. No assertions or per-test timeouts were relaxed. Browser
verification used fake adapters and isolated build outputs. Real Codex/Claude
generation and scoring quality, native macOS/Linux behavior, and production
runtime activation were not exercised. No normal build, service restart or live
provider authentication was performed.

## Source launcher entrypoints (2026-10-08)

Added thin root-level macOS `.command` and Linux `.sh` start/stop entrypoints.
They preserve arguments and exit codes while delegating to the existing shared
scripts. Git records executable mode 100755 and LF endings for these entrypoints.

Observed checks: all four entrypoints passed a disposable Linux shell fixture from
an unrelated working directory with Unicode/space paths, quoted arguments and a
nonzero child exit code. Eight public-source tests and the scanned public export
passed. The fixture replaced Node with a stub; it did not start the application,
replace normal build outputs or access real providers. Native application checks
remain in the cross-platform CI workflow.

## Scroll following and publication correction (2026-10-08)

Scope: v0.1.4 addresses scroll-following races observed in native macOS CI and
requires successful main-branch verification in addition to the release matrix.
Pre-fix browser regressions reproduced scrollTop 0 changing to 329, scrollTop 100
changing to 9490, a remounted viewport remaining 8960 pixels from the bottom, and
an invisible inactive preview incorrectly showing the new-content action.

Both views check the actual position before following, preserving the 80-pixel
margin and browser clamping. Resize following waits for pending scroll events;
viewport remounts reset the geometry baseline. Only rendered previews count as
new content. Tests await browser completion of the stored response, inject inactive
SSE progress and retain all exact position, following and notification assertions.

Observed locally on the final candidate: typechecks, seven guard unit cases,
isolated compilation and the four scrolling browser cases repeated three times
passed. Redacted source/history scans and the explicit public-source export are
required before push. Workflow actions use pinned official Node.js 24 runtimes.

Publication requires the native Windows/macOS/Ubuntu checks and successful main CI
for the exact checked-out tag commit, including manually selected tags. It rejects
missing/failed verification or malformed commit identity with existing Actions read
permissions. The query selected the known failed candidate correctly. Tagged Actions
runs establish full coverage, all 83 browser cases, installation checks and release
publication; local targeted checks alone do not. No real providers or data were used.

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
