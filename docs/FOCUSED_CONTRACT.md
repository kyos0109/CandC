# Focused discussion contract

Discussion behavior, prompt protocol and journal storage have separate versions. Missing discussion behavior means legacy version 1. The browser creates version 3 discussions only (see ROOM_CONTRACT.md); the version 2 creation API remains for compatibility and tests, and focused issues can no longer be enabled from the browser for new discussions. Existing version 2 records stay readable, continuable and upgradable. A version 2 record requires its complete focused state and configuration fields. Invalid version 2 state is rejected instead of being reinterpreted as legacy. Opening, reading or exporting a history does not migrate it. Explicit upgrade creates a new source-linked discussion, preserves completed public content and carried limits/elapsed time, and starts without native sessions or inferred receipts.

## Input and session generations

Each agent has its own generation UUID, backend, native session identity and receipt. A native identity announcement is provisional. Ordinary session reuse needs a valid receipt for that exact identity and no unfinished ordinary call in a nonretired generation. Timeout, cancellation, identity/protocol/cleanup failure or ambiguous storage prevents reuse. Auxiliary role proposals and summaries use their own generations and never advance ordinary discussion receipts.

Before model launch, CandC commits a prepared call with a distinct request ID and answer message ID. Its immutable input snapshot stores message IDs/version 1, evidence source/SHA256 versions and their exact immutable record indices, generation/native identity, purpose, configuration/task/issue versions, explicit response target, mutable configuration/task fields, adapter settings and the SHA256 of the actual serialized prompt. Immutable text is retrieved from its public records. The record index preserves retrieval metadata when multiple eligible records have identical source/content hashes; only one such version is sent. `materializeInput` reconstructs a recorded prompt for local verification; it does not execute or retry a call.

For a valid resumed generation, the message/evidence payload contains only eligible records absent from its receipt. The agent's committed answer joins the receipt without being resent. A fresh generation receives all eligible completed history. Each genuine initial opening excludes the other opening answer. Rebuilding even during round 1 is a fresh history reconstruction rather than another independent opening. Multiple unseen user interventions remain in the fixed snapshot; the controller targets the first unseen eligible user input, then an eligible peer contribution, then the latest eligible user input. Incoming messages during execution affect a later snapshot.

The current task card states the goal, constraints, current issue, target, outstanding user requests, key references, exact proposal/version and completed/skipped results. Key references may deliberately repeat previously delivered public text when needed to check a proposal or user answer. A reply's attribution remains tied to its original snapshot even if configuration or issue selection changes during execution. Stale control cannot update the new issue. Configuration changes are sent with their new version. Native authorization/tool policy and the task card are supplied on every turn.

Eligibility applies to every message, including generated answers. Directed input and answers derived from a session that has seen directed input remain scoped to that agent. Such an answer cannot apply a shared issue/overall action. Evidence carries its generating owner/generation; sharing requires its recorded input scope to be eligible for the receiving agent. This conservative restriction prevents later answers or evidence from forwarding another agent's directed input.

Version 2 does not use the legacy latest-12-evidence window, truncate history or generate an implicit summary. The 1,000,000-character limit measures the serialized prompt, including policies, task card, references and evidence. Over-budget input pauses before adapter launch. This is a transport budget, not a token estimate or provider context guarantee. Native session compaction can affect model retention independently of delivery.

## Delivery, response and completion

Delivery receipts mean that a successfully completed and cleaned-up provider turn received the fixed input. They do not mean that a user request was answered, checked, accepted or resolved.

Optional response annotations refer only to content actually available to that generation. `addressed` records a claimed answer to a user message; `checked` records a peer check of that answer; `unresolved` leaves the request outstanding. Missing/invalid annotations are visibly unmarked. Human disposal requires an explicit action and reason. Overall completion requires outstanding requests to be checked or disposed, and all eligible user input delivered to both ordinary sessions.

A peer check applies to every outstanding request linked to the checked answer. Later model annotations do not reverse a human disposal or an existing peer check, or replace their recorded reasons.

There is at most one active issue. Issues are pending, active, concluded, disagreed, blocked or skipped. A model suggestion adds a pending issue, not a new current issue. User selection/skipping during a turn queues a boundary action. Proposals have IDs and versions, public results, conditions and unresolved items. Only the other agent can confirm the exact proposal version it received. Revisions invalidate prior confirmation. A confirmed disagreement closes an issue with its stated disagreement; blocked retains the issue, and pauses automatically only when the confirmed proposal declares that missing input prevents any valid next step. Skipping is a limitation, not resolution.

Explicit selection returns the previous active or blocked issue to pending while retaining its recorded result and unresolved items. Selecting that issue later creates a new issue version and clears its proposal and confirmation. Identical normalized configuration values are a no-op. Only changes to topic, goal or constraints invalidate the current issue's proposal and confirmation; other configuration changes still advance configuration/task versions and invalidate overall completion.

Manual mode retains its two-contribution boundary even after an issue confirmation. Focused automatic/conclusion mode may select a pending issue after valid confirmation. Issue closure does not mark the whole discussion complete. A distinct overall result and peer confirmation are required with no active/pending issue or queued switch. Adding user input or changing configuration invalidates overall completion.

Ordinary version 2 answers require a final standalone control envelope outside quotations/code fences:

```text
Public answer with substantive reasoning and any disagreement.
<<<CANDC_CONTROL_V2>>>
{"version":2,"issueId":null,"issueVersion":null,"taskVersion":1,"continuation":"yield","action":{"type":"none"}}
<<<END_CANDC_CONTROL_V2>>>
```

The example's issue IDs/versions and task version must be replaced by the fixed task card values. Continuation is `continue`, `yield` or `done`. Action schemas live in `src/v2-contract.ts`. Optional `annotation` is parsed independently of required control. Counterfeit blocks inside quoted/fenced content are public literal text. Stream previews hide the metadata block. Missing or invalid required control preserves the successful public answer and delivery, then pauses; it does not falsely complete an issue. Invalid optional annotation does not invalidate otherwise valid required control. Stale metadata is recorded as stale and cannot apply to current state.

## Commit and recovery boundaries

A call is prepared durably before provider launch. Native identity announcements remain provisional. After full protocol success and confirmed process cleanup, one commit records public answer, valid native identity/receipt, completed call, issue/response updates and budget. Diagnostics add the final-commit observation only after that commit succeeds. No session progress is confirmed by an early identity event, text delta or provider completion event alone. Process preparation/cleanup is distinct from native create/resume and turn protocol; CLI processes are still per-turn.

Every journal commit has a separate UUID, expected next sequence, event kind and content digest. Any append/sync/close exception makes storage unconfirmed, including an exception after bytes were written. The store/controller barrier prevents subsequent journal writes and scheduling, including error handlers, evidence and final cleanup. A sequence-zero SSE warning and queries can describe this runtime state without pretending the warning is saved. Best-effort `.unconfirmed.json` metadata helps identify an attempted commit but is not the authoritative history or a guaranteed durable record.

Schema rejection before append returns `INVALID_STATE` without declaring storage unconfirmed. Queued pause, input-limit and round transitions recheck running state inside the commit lock, so they cannot overwrite a persisted stop. Auxiliary input-limit exits retain an original stopped or indeterminate state.

Recovery is exclusive and requires no active process. It rereads the authoritative journal, validates schema/sequence/content/commit identity where known, syncs and closes it, then verifies replay again. A complete matching attempted commit can be adopted once. An absent attempt is not committed. A conflicting record is preserved and rejected. Without remembered metadata, recovery validates all available records and does not infer model outcomes or automatically resend anything.

Only an invalid unterminated final record after a valid prefix can be removed, with explicit tail-repair authorization and a synced gzip backup. Terminated invalid records, middle corruption, sequence conflicts and no-valid-prefix histories are not automatically repaired. A missing final diagnostic can remain unknown. Successful recovery still marks native receipts uncertain and requires an explicit rebuild/start. Rebuild retires all prior generations, retains issue/task/history/round/limits and measured elapsed budget, and debits saved budget reservations for unobserved prepared calls. This conservative `uncertainBudgetMs` is separately labeled and is not fabricated execution timing. Duplicate rebuild operation IDs do not debit twice; different content with the same operation ID is rejected.

The checks confirm operating-system behavior at validation time. They do not certify controller firmware, power-loss durability, disk health or concurrent multi-process writing. Corrupt files and backups must be preserved for offline inspection rather than guessed from message IDs.

## API and diagnostics

Existing local authentication, Host/Origin, SSE replay and backend/model authorization apply. All discussion paths below are under `/api/discussions/:id`:

| Action | Contract |
| --- | --- |
| `PATCH /` | Version 2 configuration needs `expectedVersion` matching `configurationVersion`. |
| `POST /messages` | `messageId`, `text`, `recipient`, optional eligible `inReplyTo`; duplicate IDs must match content/routing/reference. |
| `POST /start`, `/roles` or `/summary` | `operationId`; the route determines purpose and duplicates must match the saved purpose. |
| `POST /issues` | `operationId`, task `expectedVersion`, action `add`, `select`, `skip` or `dispose`; `issueId` identifies an issue (or user message for disposal), and `title` supplies a new title or disposal reason. |
| `POST /recover` | `repairTail` defaults false. Verification does not start inference. |
| `POST /rebuild` | `operationId`, current task `expectedVersion`; version 2 session reset under the same discussion ID, followed by explicit start. |
| `POST /upgrade` | `newId`; only legacy histories, source remains unchanged. |
| `POST /fork` | Legacy reconstruction only; version 2 must use rebuild. |
| `GET /export?format=json` or `markdown` | Complete public content independent of reading mode; version 2 includes issue results, snapshots and diagnostics. |

`GET /api/storage-issues` reports histories requiring recovery, including ones that cannot be displayed as valid discussions. The production server has no fixture fault-injection route.

Diagnostics record actual serialized prompt characters, delivered message count, serialized history/background/task-card/reference field sizes and a comparable full-eligible-history prompt size. Component field sizes are measurements of their own serialized values, not additive token/cost accounting. Stage values are observed millisecond offsets from execution start: process preparation, session identity ready, first public text, generation completion, cleanup and final commit. Missing stages/usage are `null`, never invented zeros. Token usage is limited to numeric fields actually returned for the matching provider turn; it does not calculate prices or infer usage from characters. Raw stderr, credentials and private reasoning are excluded. Public reasons/configuration/tool evidence remain subject to the application's existing redaction limits.

## Validation and rollback

Independent daily performance measurement is specified in [PERFORMANCE_CONTRACT.md](PERFORMANCE_CONTRACT.md). Its disposable JSONL files do not extend this journal schema or add diagnostic journal commits. Existing call timing offsets and the existing second final diagnostic commit remain unchanged.

Local deterministic tests, scripted adapter protocols and fake-only browser flows establish application contracts. They do not validate live model adherence, factual answer quality, native retention/compaction or actual subscription savings. No live inference is required to run the validation sequence in README. `VALIDATION.md` separates this batch from prior authorized live smoke evidence.

Storage version 3 cannot be assumed readable by an old release. With the server stopped, preserve current journals and restore the pre-upgrade history backup plus its matching build. Do not replace only executables or overwrite newer history without separately preserving it. The isolated rollback verifier compiles the supplied baseline's domain/store, creates disposable legacy/new fixtures, checks source preservation and old-reader rejection, then checks restoring the baseline backup. It never uses application `data/` or live providers.
