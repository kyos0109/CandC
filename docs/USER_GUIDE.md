# CandC user guide

> **Implementation status:** This revision includes auto/manual interim results,
> the first facilitator opening, optional-claim handling and related prompt/UI/export
> changes. Check the [implementation comparison](IMPLEMENTATION_STATUS.md) for
> historical behavior and validation limits.

CandC brings 2–4 independent AI speaker seats into a local browser discussion, with an
optional moderator. Start with the [README](../README.md) for installation and a visual
overview. This guide describes current version 3 operation; the [room contract](ROOM_CONTRACT.md)
owns exact scheduling, privacy and storage rules. Version 1/2 histories retain their
[legacy behavior](FOCUSED_CONTRACT.md).

## Set up a useful discussion

1. Choose **Demo / 示範** for scripted replies without live AI or research, or
   **Live AI / 真實 AI** for selected providers with verified CLI/login readiness.
2. Supply a topic and, when useful, a goal and constraints. State the requested deliverable
   explicitly: an explanation, comparison, plan or answer. A promise to do that work later
   is not delivery of the requested answer.
3. Configure 2–4 speakers. Each seat has an independent session and workspace. Two seats
   may use the same provider without sharing private input or native sessions. Live seats
   require available, explicitly selected model/effort settings.
4. Choose joint analysis or debate. Joint analysis allows empty stance fields. Debate
   requires an explicit position for each seat and confirmation before execution; justified
   revisions remain possible. Optional persona belongs to that seat.
5. Choose manual, automatic or until-conclusion execution. Set speaking order and inspect
   the round, total-time, per-call and moderator-call limits.
6. Enable an independent moderator only if useful. Ordinary facilitation is the default;
   judge authority requires its explicit option. Research is separately opt-in.

Only one discussion can be active at a time. CLI processes launch on demand; you do not
need to leave their terminals running. Gemini/Grok live paths remain locked, even though
their fake seats can appear in Demo. See the [provider table](../README.md#provider-support-and-practical-limits).

## Choose execution and moderator authority

| Choice | Effect |
| --- | --- |
| Manual | Pauses after one round of N contributions for N speakers. All-seat reviewed answers are interim results; choose Continue discussion for another round. |
| Automatic | Continues useful contributions within limits and available work. Reviewed interim results alone do not end discussion. |
| Until conclusion | A proposal reviewed and confirmed by all configured speakers becomes the final outcome and stops discussion. Partial delivery keeps its partial label. |
| Ordinary facilitator | Brief neutral opening before the first speaker, then public coordination after a speaker-count round or confirmed outcome, within budgets. Cannot force intervention or impose a result. |
| Explicit judge | May arrange speaking, interrupt, mute, propose topic changes, pause or issue a unilateral ruling within the contract. A ruling is labeled moderator authority, not unanimous agreement. |

One speaker generates at a time. An ordinary facilitator does not monitor drafts.
Its saved opening attempt is not repeated by resume, reload or session reconstruction.
Judge mode can monitor a speaker's draft under bounded rules. Model brevity and semantic
neutrality are prompt expectations, not guarantees mechanically proved by the app.

## Join the conversation safely

Use the recipient control before sending:

- **Public input** can reach speakers and the moderator.
- **Directed input** reaches only the addressed seat. Other seats, including another
  seat with the same provider, and the moderator do not receive that private input.
- **Public answers stay public**, even when responding to directed input. The local
  browser may show your private messages; that does not mean they entered other seats' prompts.

Add missing constraints or evidence as the discussion proceeds. New input changes the
task version and clears the current proposal/outcome; already saved interim records remain
historical and are marked when they belong to an earlier version. A delivery receipt says
input was committed for a seat; a response reference is an AI claim about addressing it.
Neither proves understanding or factual accuracy.

Research is off by default and unavailable in Demo. When enabled for supported live
speakers, permitted public HTTPS pages and authorized local text can be sent to those
providers. Review the selected roots and disclosure first. The read-only gateway bounds
access and filters sensitive paths, but does not provide complete data-loss prevention.
The moderator currently has no research tools. See [Security](../SECURITY.md).

## Read the result correctly

The **Conversation** tab holds original messages. The **Conclusion** tab separates
proposals, reviewed interim results and final outcomes, retaining dissent, unresolved
points, delivery basis and source navigation. The **Diagnostics** tab explains calls,
delivery, optional metadata rejection and blocking failures.

| Record or state | What it means |
| --- | --- |
| Individual analysis or provisional checkpoint | Saved analysis from a seat; not all-seat agreement or final delivery. |
| Proposal awaiting review | Exact answer under peer review; silence is not confirmation. |
| Reviewed interim result | All speakers reviewed the same answer in auto/manual mode. Retains confirmations, peer review, dissent and delivery status; discussion can continue. |
| Final participant outcome | All configured speakers confirmed the same reviewed proposal in until-conclusion mode. |
| Judge ruling | Outcome under explicitly selected moderator authority, separate from participant consensus. |
| Partial delivery | Some requested content is missing; confirmation does not make it complete. |
| Disagreement or undetermined answer | May fully answer the question when differing views or missing evidence are explained at the requested depth. Does not invent certainty. |
| Summary | Explicit organization of saved content; does not itself establish completion. |

Peer review checks delivery of the requested answer, not independent factual truth.
If review identifies missing content, a corrected proposal needs fresh confirmation.
Pause, stop and exhausted limits do not create a completed outcome.

Malformed optional work reports, references or delivery/review claims are rejected with
metadata diagnostics. Saved public prose can remain usable without granting the rejected
claims coverage, agreement or research completion. A malformed
core schema can also be neutralized only after verified envelope/JSON/version and owned
task/grant identity; its original claims are discarded. Envelope/JSON/identity, ownership,
unauthorized-command, unknown-result and storage failures still block execution. Do not treat every diagnostics
entry as a failed answer, or every saved answer as an accepted control action.

Technical repair handling counts actual target-seat calls per unresolved episode,
separately from substantive peer rejection. Exhaustion pauses until-conclusion mode;
auto/manual discard the unaccepted proposal/request and continue within existing gates.
See the [implementation-status table](IMPLEMENTATION_STATUS.md) before relying on this behavior.

## Pause, stop and recover

- **Pause after this response / 本次回覆後暫停** finishes the current answer, then pauses.
  Pausing during the facilitator opening prevents the reserved speaker from starting.
- **Stop / 停止** cancels the owned runtime immediately. A stopped or indeterminate
  room requires explicit session reconstruction rather than ordinary continuation.
- Closing the last browser connection starts a 15-second grace period; on expiry,
  the application requests a pause after the current answer.
- **Unconfirmed storage / 未確認保存** blocks further writes and AI scheduling. Streamed
  text without confirmed saving is not a committed answer or completion evidence.
  Use the offered recovery controls; do not assume a failed/unknown call can be retried.
- **Rebuild sessions / 重建工作階段** reconstructs from confirmed eligible history.
  Recovery and rebuilding never automatically replay an unknown-result turn.

The installed Stop-CandC entry (`.cmd`, `.command` or `.sh`) stops the backend and
cancels its owned turns while preserving history. See [installation](INSTALLATION.md)
for cross-platform commands and stopped-only updates.
It is separate from stopping one room in the interface. Preserve a matching journal/build
pair for rollback; older strict-schema binaries may reject newer optional fields.

## Reading and exporting

Use **Aa** for persistent light/dark themes, 14/16/18px text, comfortable/compact density,
full/highlight reading and Traditional Chinese/English interface language. Switching
language preserves drafts and recipients without translating user/model/evidence text
or invoking a provider. Expanding folded replies reveals complete text; folding never
truncates saved content, copy or exports. Raw Markdown HTML is not executed, and remote
images in messages remain links.

From **Conclusion**, export Markdown or JSON for the saved discussion, including reviewed
interim results separately from the final outcome. Exports are local user artifacts and
can contain private input and diagnostics; review them before sharing. Renaming a room is
an idle, version-checked display change and does not launch inference or change the task.

## Storage and maintenance

History is stored in `data/` or `CANDC_DATA_DIR`. Provider authentication remains in
provider-owned locations. `npm run doctor` reports sanitized readiness without a model
turn. Performance collection observes user-started calls without extra inference, stores
bounded disposable files in `.cache/performance/`, and can be disabled with
`CANDC_PERFORMANCE_ENABLED=0`. Missing measurements remain unknown; see the
[performance contract](PERFORMANCE_CONTRACT.md).

Offline compaction requires the server to be stopped. Preserve the matching current
build and data before maintenance; then, from the project directory, build and compact:

```powershell
npm run build
node scripts/compact-journals.mjs
```

The tool verifies replay and preserves gzip journal backups. Do not compact while a
server is running. Preserve newer journals before restoring a backup; rollback requires
matching data/build versions. Development verification must use disposable journals,
never real history. See [Contributing](../CONTRIBUTING.md) for isolated builds and checks,
and [Validation](../VALIDATION.md) for dated evidence and untested live-provider limits.
