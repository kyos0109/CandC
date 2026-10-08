# Current conversation interface contract

> **Implementation status:** The opening, auto/manual reviewed interim results and
> optional-claim diagnostics below are included in this revision. See the
> [implementation comparison](IMPLEMENTATION_STATUS.md) and dated validation limits.

This describes the implemented interface, not a redesign plan. Change only the
behavior requested by the current task. Historical concepts and implementation
handoffs are retained in Git history, not active development instructions.

## Layout and identity

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
