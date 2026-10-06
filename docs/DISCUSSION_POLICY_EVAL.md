# Active discussion policy acceptance

> **Implementation status:** This revision includes the opening, interim-result,
> optional-claim and associated prompt/invitation/control assertions below. See the
> [implementation comparison](IMPLEMENTATION_STATUS.md). Deterministic tests verify
> orchestration and provenance, not live-model discussion quality.

This is the deterministic acceptance contract for version 3 behavior,
not an instruction to run live comparisons or redesign the policy. Read it when
changing policy, moderation, delivery review or their tests. Runtime authority is
specified in [ROOM_CONTRACT.md](ROOM_CONTRACT.md).

## Delivery and conclusion

- Technical, creative, philosophical and requested planning topics use the same
  delivery rules without mandatory domains, stages, stances or public prose templates.
- Ordinary exchanges receive no full delivery policy or proposal/review samples.
  A peer without a saved review of the current proposal receives symmetric
  acceptance/rejection layouts. After its review is recorded, ordinary exchanges
  retain the proposal and reviews as context without resending delivery policy or
  examples, whether the review accepted or rejected it. Each replacement proposal
  resets reviews, so independent review instructions resume. An explicit targeted
  correction still receives the relevant confirmation or proposal/ruling layout,
  including exact confirmation IDs for previously reviewed peer proposals. Examples
  do not prescribe a verdict. Ordinary facilitators receive no speaker delivery
  policy; judge speakers use none.
- Reviewed participant results stop conclusion mode only. Auto/manual save distinct
  interim results retaining review provenance, dissent, limitations and delivery status;
  auto continues, manual waits after one round, and judge rulings retain explicit authority.
- A proposal needs delivery metadata; peer confirmation requires independent review
  of the exact proposal. Inadequate review or remaining gaps gives the author one
  priority response, allowing revision or a reasoned rebuttal. After a completed,
  saved response, that substantive request clears and ordinary scheduling or the
  deferred invitation resumes. A rebuttal or neutral fallback leaves the proposal
  unaccepted with its reviews intact. Failed/stale calls do not consume the request,
  and a newly created technical repair request remains pending. Legacy untyped
  review requests follow the same rule. Replacement proposals reset peer
  confirmations and retain prior saved answers.
- Technical repairs count actual target-speaker calls per unresolved episode and reset
  when resolved. Substantive peer rejection/revision does not consume the three-attempt
  repair budget. Exhaustion pauses conclusion mode; auto/manual discard the unaccepted
  proposal/request and continue with a diagnostic. Corrections take scheduling priority
  while a different facilitator invitation remains pending at the same task version.
  Existing manual/user/budget/storage gates remain. Complete uncertainty or disagreement is valid;
  partial content stays partial even after agreement. Stop is never completion.
- The conclusion page shows reviewed answer/basis/limitations first, with historical
  stages secondary. Reload/mobile preserve the status. Old journals load without
  rewriting; explicit continuation upgrades unchecked delivery, not old prose.

Owners: `tests/room-conclusion-delivery.test.ts`, `tests/conclusion.test.ts`,
`tests/room-discussion-revision.test.ts`, `e2e/conclusion-delivery.spec.ts`,
`e2e/discussion-revision.spec.ts`.

## Work, questions and provenance

- Pending personal questions do not block independent analysis. Repeated stable keys
  or normalized equivalent questions reuse an entry. Resolution requires a completed
  public user source; metadata is a claim, not proof of understanding.
- Authorized research availability is explicit. Disabled research stays pending;
  completion requires an observed authorized tool/evidence operation in that call.
- Shared work/checkpoint references contain eligible completed public source IDs only.
  Private input and unseen-session content never become shared workflow metadata.
- Answers, diagnostics and workflow updates commit together. Invalid metadata saves
  prose with separate metadata diagnostics and rejects the claims without pausing an
  otherwise valid exchange. Invalid delivery/review never establishes completion or
  agreement. A mismatched confirmation does not confirm a peer proposal or stop the room.
  Malformed core control is replaced with neutral none/observe and yield only when
  envelope/JSON/version and typed task/grant identity match the owned call. All original
  claims are discarded, including work and references; neutralized calls cannot provide
  accepted interim-result provenance. Envelope/JSON/identity, ownership, unauthorized
  commands and storage errors remain blocking.
- Redirects and coverage/peer checks remain bounded. Manual boundaries, stop/pause,
  execution limits and storage uncertainty cannot trigger extra synthesis or replay.
- Idle policy/research changes are version-checked, preserve history, retire affected
  sessions and never start a call. Explicit summary is not discussion completion.

Owners: `tests/discussion-policy.test.ts`, `e2e/discussion-policy.spec.ts`.

## Moderator and compatibility

- Ordinary facilitation is default: a short neutral opening announces the reserved
  first speaker; speakers lead thereafter, with no draft monitoring, brief coordination
  after a round, and no forced intervention or unilateral result. Resume/reload/rebuild
  never repeats the opening. Pause/stop during it does not start a speaker.
- Routine invitations connect public views or unanswered arguments, survive an ordinary
  manual boundary and accompany pending work in the next invited turn without prescribing
  scope or a verdict. Debate examines assigned positions while permitting justified
  revision; continuation markers are defined without forced opposition or minimum rounds.
- Judge monitoring defaults to observe, letting unfinished arguments develop. Neither
  draft checks nor boundary grants prompt the judge to find reasons to stop.
- Full control examples nest delivery/review inside action. The three sanitized observed
  top-level-delivery shapes continue through peer review after narrow normalization;
  other malformed core controls can only become neutral control after independent
  identity checks. Invalid optional claims are dropped with diagnostics and cannot authorize accepted results.
  Task/grant validation, authority and all-speaker review remain enforced.
- English creation supports the facilitator opening. Switching between English and
  Traditional Chinese and reloading preserves original topic/messages and saved calls;
  interface translation neither rewrites model content nor repeats the opening.
- Judge authority is explicit, constrained to its commands and labeled separately
  from participants' consensus. Mode changes preserve history without inference.
- Old omitted-mode journals load unchanged; explicit start selects ordinary authority.
  Strict control decoding accepts valid keys and retains safe invalid-control diagnostics.
- Preserve legacy v1/v2, policy-less v3, independent/repeated-provider sessions, private
  input, stale-control rejection, recovery, topic notifications and execution limits.

Owners: `tests/room-opening.test.ts`, `tests/room.test.ts`, `tests/discussion-policy.test.ts`,
`e2e/moderator-mode.spec.ts`, `e2e/room.spec.ts`.

Fixtures establish scheduling, permissions, persistence, prompt content and rendered
behavior. They cannot prove improved live reasoning, factual correctness, neutrality,
model brevity, subscription savings or an optimal policy. Live evaluation is outside
ordinary verification and requires explicit authorization.
