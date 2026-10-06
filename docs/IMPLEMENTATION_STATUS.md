# Implementation status

Status recorded on **2026-10-06**. This implementation revision includes the source,
tests and contracts described below. **`30c2511`** is the historical code baseline;
the documentation-only commit `b62d2ea` did not implement these changes.

## Historical baseline versus this revision

| Area | Historical code at `30c2511` | Implemented in this revision |
| --- | --- | --- |
| Participant results | A fully confirmed proposal can create a final participant outcome in any execution mode, once remaining required work/checks complete. | Only until-conclusion mode creates a final participant outcome. Auto/manual retain separately reviewed interim results; auto continues and manual keeps its round boundary. |
| Facilitator opening | Speakers start first; ordinary facilitation coordinates after a speaker-count round or confirmed outcome. | A one-time neutral opening precedes the reserved first speaker, with durable attempt tracking and pause/stop/privacy handling. |
| Optional metadata | Invalid references/work reports can preserve public prose while blocking control or pausing; capacity overflow pauses. | Invalid optional claims are rejected with separate metadata diagnostics while an otherwise valid exchange can continue. They do not establish coverage, agreement or completed research. Core control/storage failures still block. |
| Prompt and invitation policy | Existing delivery/control prompts and ordinary facilitation apply. | Stage-specific delivery examples, neutral exchanges/judge monitoring and facilitator invitations retained through manual boundaries. Prompt expectations do not prove model quality. |
| Delivery nesting | Existing strict control validation applies. | Narrow normalization of observed top-level delivery errors, without accepting conflicting or unauthorized core controls. |
| Core schema fallback and repair episodes | Invalid core controls block application of control and pause; existing correction limits apply. | Malformed core schemas can become neutral none/observe with yield only after verified envelope/JSON/version and owned task/grant identity; original claims are discarded. Technical repair calls are counted per unresolved episode, separately from substantive peer rejection; exhaustion pauses conclusion mode but abandons the unaccepted request in auto/manual. |
| UI, export and replay | No separate reviewed-interim-result record/UI/export support. | Interim-result presentation/export, optional-claim explanations in both interface languages and journal replay support for the new array. |

These differences affect the execution-mode tables and result explanations in
[README](../README.md) and the [user guide](USER_GUIDE.md), and the corresponding sections
of the [room contract](ROOM_CONTRACT.md), [interface contract](UI_UX_SPEC.md) and
[policy acceptance document](DISCUSSION_POLICY_EVAL.md). The conceptual overview's
auto/interim-result caption describes the implemented mode distinction.

Independent seats, Codex/Claude live support, fake Demo seats, directed-input isolation,
explicit judge authority, research opt-in, storage barriers and legacy history support
already exist in the historical baseline. This revision refines those behaviors;
Gemini/Grok live execution remains locked and no new provider is enabled.

## Validation and limits

The pre-commit entry in [VALIDATION.md](../VALIDATION.md) records checks for this
source/test revision. Earlier entries describe their dated working-tree snapshots;
the documentation-only entry validates documents and artwork only.

Deterministic tests cover scheduling, control authority, privacy, durable replay,
mode-specific results and prompt eligibility. The bounded live smoke test covered
an earlier neutral exchange only. The latest review handoff and repeated-policy
changes have not been exercised with real models; model brevity, neutrality and
factual correctness remain unverified for those changes.

A completed substantive review response consumes one priority turn while preserving
the proposal's unresolved review. A peer that already reviewed the same proposal
returns to ordinary discussion prompts; a replacement proposal or targeted repair
restores review instructions. This avoids repeatedly directing the peer to review
an unchanged proposal without treating a rebuttal as consensus.

New optional journal fields remain compatible with current readers. Older strict
readers may reject them; rollback requires a matching build and journal pair.
