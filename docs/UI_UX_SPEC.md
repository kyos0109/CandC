# Current conversation interface contract

## Optional discussion scenarios

The topic section offers six optional cards in a two-column desktop grid and a
single column below 768px: Decision Lab, Engineering Review, Research Council,
Incident War Room, Code Review Board and Simulation Arena. No card is selected
initially. Cards are keyboard-accessible buttons with an explicit selected state;
clicking one applies a template and opens the existing goal fields without starting
inference. Cards retain their selected background and border on hover. All settings
remain editable.

Templates prefill only goal, discussion kind, execution mode and each existing
speaker's label/instructions. All default to Collaborative analysis; Incident War Room and
Simulation Arena default to manual, the others to until-conclusion. Decision Lab
produces a decision record rather than a scored selection. Research Council grants
no research access, and the review/incident cards do not access repositories or
systems. Existing provider/model/effort, moderator authority, research, limits,
response mode, attachments, topic and constraints remain unchanged.

Track untouched, template-filled and user-edited origins separately for each
managed field, with speaker origins keyed by UID. User edits, including clearing
text or explicitly selecting the current kind/mode, survive later template changes.
Reapplying the current card updates only fields not edited by the user. Seat
additions and preset replacement do not automatically apply roles; reapply explicitly
using the current order. Cards are temporarily disabled while a seat removal is
pending, so reapplication uses the remaining seats. Removed UIDs do not transfer
edits to other seats. Model/effort changes do not mark role text as user-edited or
invalidate reset undo.

Selection disables all scenario cards and explains how to change Discussion format
to Collaborative analysis or Debate first. Switching to selection retains the
editable goal and role text. A manually chosen debate retains explicit side
requirements and its existing confirmation flow. UI labels follow the selected
locale; inserted text is an editable snapshot and is never translated on locale
changes or same-card reapplication. Template identity/origins are form-only state;
only existing Room Input fields are submitted and saved.

After application, show a summary derived from the current form: scenario name,
seat count, discussion form, execution mode, manually edited managed fields and
all seat/moderator readiness or model-setting gaps. Use the existing validation
rules; the summary does not choose models or grant authority. Offer navigation to
the seat settings. Labels follow the locale without translating editable content.

An explicit Reset to template defaults action may replace user-edited managed
fields using the selected localized snapshot. Selection, busy state and pending
seat removal disable reset/undo. Provide one undo snapshot of managed fields and
their origins, keyed by seat UID; repeated resets retain the original undo point.
Undo preserves all unmanaged settings, including changes made after reset. Editing
a managed field, adding/removing/replacing seats or applying any scenario clears
undo. Locale changes do not clear it. Restore focus to the reset button after undo.

## Attachments

Version 3 discussion/debate creation and composers provide a multi-file picker
and drop target. Show filenames, sizes and remove buttons before submission;
creation still needs a topic, while later input can consist only of attachments.
The limit is five files, 10 MiB each and 25 MiB total. Failed upload/extraction
retains the draft and identifies the failing file; no partial message is sent.
Retries retain the same operation identity until the submitted content changes.

Saved message cards offer original-file download and a plain-text view of exactly
the extracted/redacted material supplied to AI. Documents show their text-only
limitation, and redaction is distinguished from the unchanged original download.
Saved files are not labelled as understood by AI. Private cards inherit the
message recipient and privacy reminder. The picker is unavailable in selection
and legacy discussions. UI labels switch languages without translating filenames,
document contents or user/model prose.

> **Implementation status:** The opening, auto/manual reviewed interim results and
> optional-claim diagnostics below are included in this revision. See the
> [implementation comparison](IMPLEMENTATION_STATUS.md) and dated validation limits.

This describes the implemented interface, not a redesign plan. Change only the
behavior requested by the current task. Historical concepts and implementation
handoffs are retained in Git history, not active development instructions.

## Layout and identity

Discussion and debate creation offer **Response mode**: Standard mode (default)
or Single-sentence mode. The latter says each AI uses one short sentence per turn,
including conclusions, and can accompany any execution mode. The choice is fixed
after creation and appears in the discussion header in both locales. Option
evaluation hides this control and never submits the flag. Pending turns show only
generation status until the backend validates the complete answer; rejected
drafts are not shown, including after cancellation or failure. A second rejected
answer pauses with an explicit failure notice instead of a truncated answer.

The creation form also offers **Option evaluation** (`kind=selection`): default four options, configurable from two to six. The first seat generates options and three shared criteria; every seat independently scores each option from 0–10. This mode hides moderator, debate scheduling, research and round controls. Its dedicated view shows phase, completed/missing reviewers, model identities, frozen candidates and criteria, score matrix and expandable reasons/limitations. Final ranking appears only after all ratings are valid and saved; ties share a rank. It is labeled AI evaluation, not unanimous agreement. Pause, stop, explicit resume/reconstruction, storage recovery, time-limit extension, diagnostics and JSON/Markdown export retain their existing authority. Inputs remain frozen; repeat or revised evaluations require a new room. Both locales translate application labels only, preserving generated content.

- Reading and joining the discussion dominate. Only the message pane scrolls;
  execution controls, composer and actionable pause/storage notices stay visible.
- Speaker messages align left; user messages align right. Provider/seat labels and
  small avatars identify actual seats, including repeated providers. Do not infer
  participant counts, consent or capabilities from decorative visuals.
- Each speaker seat has its own bubble: a left rail, header band and tint in the seat
  colour. Later seats of one provider use a separate colour with the outlined avatar;
  the moderator has a narrower, fully rounded bubble. Colour only reinforces identity:
  names, glyphs and outlines still identify seats. User messages are solid and on the right.
- A speaker reply taller than about 500px starts folded to 380px, and the expand control
  shows its length. The header band and avatar stay pinned while it is read, and focus
  entering folded text unfolds it. Folding is presentation only: saved text, copy and
  exports stay complete.
- A strip above the stream shows whose turn it is, in that seat's colour, with a speaking
  indicator while it replies. It shows only what the moderator asked, on one line with an
  in-place "full instruction" expansion. The scheduler's own task sentences (default
  prompt, invitation wrapper) are never shown; a default becomes one localized line.
- Version 3 has Conversation, Conclusion and Diagnostics tabs. Participant panels
  dock on wide screens and use a drawer on narrow screens. Legacy views preserve
  their supported issue/history controls. Do not recreate the removed two-agent form.
- Connection navigation preserves the creation form, composer, recipient, quotation,
  selected discussion and scroll-follow state. Opening a panel never starts inference.
- The creation form loads with the application. Version 3 rooms, legacy discussion
  views and connection settings load on first use, with localized loading statuses.
  Connection settings use a separate loading boundary so the current workspace
  remains mounted while their code loads.

## Creation and privacy

- Create version 3 rooms with 2–4 explicitly configured speaker seats and an optional
  independent moderator. Models/effort must be available and selected; never silently
  choose a provider/model or claim an unverified live path works.
- Ordinary facilitation is the default when a moderator is enabled. Judge authority
  requires its explicit option. Required debate sides are confirmed before execution;
  optional persona stays attached to its seat. Other forms do not require a stance.
- Research is off by default; enabling it reveals the access disclosure and selected
  roots. Execution limits remain editable. Unavailable start explains its reason.
- Creation offers manual, automatic and until-conclusion execution. Manual waits after
  one speaker-count round; auto retains reviewed interim results while continuing within
  limits; until-conclusion stops on an all-speaker reviewed proposal. Explicit judge
  rulings retain separate authority in every mode. See the [user guide](USER_GUIDE.md)
  for the user-facing workflow and the [room contract](ROOM_CONTRACT.md) for exact rules.
- An ordinary facilitator's first saved opening precedes the reserved first speaker.
  Resume, reload and session reconstruction do not repeat it. Display the actual saved
  opening as a moderator message, without synthesizing a claim of consensus.
- Recipient controls state who can see the message before sending. Private input never
  becomes visible to the moderator or another seat, including one sharing a provider.

## Content and state

- Preserve complete saved text and exports. GFM supports tables/code/tasks; raw HTML
  is not executed and remote images remain links. Wide code/tables scroll inside the bubble.
- Highlights/full reading changes presentation only. Ambiguous segmentation displays
  full text. Source jumps reveal and focus the eligible original message without sending.
- Follow output only near the bottom. Scrolling up freezes following and exposes a
  return-to-latest action. Quoting and reading-size changes must not lose the user's place.
  Viewport resize following waits for pending scroll events; hiding or unmounting the
  view cancels the pending resize callback.
  Before following after a content/panel update, both views check the actual position
  against their last followed position, allowing browser clamping after geometry shrinks.
  Progress that is no longer rendered does not create a new-content notification.
- Distinguish generating, saved, cancelled, paused, partial and unconfirmed storage.
  A manual pause is not a completed conclusion. Completion uses the reviewed stored
  outcome, retaining dissent, gaps and unknowns; individual prose is not automatic consensus.
- Auto/manual reviewed results appear separately as interim results with peer review,
  dissent, unresolved points and delivery status. Auto continues; manual waits after
  each speaker-count round. Only conclusion mode turns participant agreement into a
  final outcome. Judge rulings retain their explicitly selected authority.
- Diagnostics distinguish rejected optional claims from fatal control errors. Localized
  explanations never display rejected raw JSON or translate model/user content.
- Names are display metadata, separate from topic, configuration, receipts and task
  versions. Renaming is idle/version-checked and never launches a model.
- Aa groups persistent theme, reading size, density (comfortable or compact) and language
  controls. Default text is 16px/1.72; supported sizes are 14/16/18px. Traditional
  Chinese is the default, with persistent English. Switching preserves drafts,
  recipients and settings without translating saved user/model/evidence content or
  invoking a provider.

## Conversation management

- History has Active, Archived and Trash folders, counts, full-topic/name search,
  date filtering in management mode and pages of 50 summaries. Select a conversation
  to fetch its complete content; running subscriptions survive changing folders/pages.
- Row menus and page selection support archive/unarchive/trash/restore and batch
  actions. Archive and trash have undo; failed items remain selected. Managing the
  selected conversation requires confirming discard of an unsent draft.
- Archived/trash details are read-only with reading, diagnostics and full export.
  Restore explicitly before editing or continuing; restore never starts an AI call.
- Permanent delete/empty trash require a dialog listing the exact reviewed items,
  export links and retained external data. Incomplete deletions remain visible for
  explicit retry, with unconfirmed markers preserved for inspection.

Persistence, API and deletion boundaries belong to
[DISCUSSION_MANAGEMENT.md](DISCUSSION_MANAGEMENT.md).

## Verify affected interactions

Use fake-provider browser tests and an isolated build. Check affected desktop/mobile
views at 1440x900, 1280x720 and 390x844, both themes and relevant reading sizes.
At default size with idle state, keyboard closed and an empty composer, the message
viewport target is at least 60% of desktop height and 50% of mobile height. Actionable
warnings may need more space. Check computed bounds, focus, keyboard navigation,
contrast (at least 4.5:1 for small text), horizontal overflow and browser errors.
Do not weaken behavioral assertions to accommodate selector or styling changes.

Scheduling/privacy/storage authority belongs to [ROOM_CONTRACT.md](ROOM_CONTRACT.md)
and, for legacy work only, [FOCUSED_CONTRACT.md](FOCUSED_CONTRACT.md). Current observed
verification is in [../VALIDATION.md](../VALIDATION.md).
