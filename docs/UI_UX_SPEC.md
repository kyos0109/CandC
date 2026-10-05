# CandC conversation workspace redesign

Date: 2026-10-03 (Asia/Taipei).
Status: User-approved direction and implementation handoff. Screens are concepts, not evidence of implemented capabilities.

## 1. Authority and outcome

The user approved variant B's group-conversation feel with variant A's stable alignment and restrained palette. Implement the existing application's UI, tests and necessary documentation. Inspect current repository guidance and contracts first; preserve all existing uncommitted work. The latest source includes focused-discussion and recovery work that may not be in the formal runtime build.

References, preserved without replacing the original generated files:

- [B: conversational dark concept](design/conversation-dark-concept.png): primary reference for lightweight bubbles, reply relationships and compact controls.
- [A: reading dark concept](design/reading-dark-concept.png): secondary reference for stable alignment and restraint.
- [A: reading light concept](design/reading-light-concept.png): light-theme reference.

The decisions below explicitly override discrepancies in the generated pictures. Do not copy invented branding, slogans, attachment controls, metrics, histories, participant counts or placeholder capabilities. No further design approval is required to implement these approved refinements. Validate the result visually against these references and this specification.

Primary outcome: reading and joining the discussion should dominate the interface. Preserve a recognizable conversation, without reducing useful content or exposing operational detail everywhere.

## 2. Scope and preserved behavior

In scope: desktop/mobile layout, light/dark design system, message presentation, panels, creation form, concise copy, accessible controls, and discussion display names.

Preserve manual/free defaults, explicit model choices, research opt-in, recipient routing, quoted drafts, safe Markdown, highlights/full reading, complete exports, source jumps, scroll-follow rules, version checks, operation idempotency, pause/stop, budgets, issue/overall confirmation, storage barriers and explicit recovery/rebuild. Read FOCUSED_CONTRACT.md and current tests. Do not alter AI prompt/control/receipt semantics as a styling shortcut.

Out of scope: live AI calls, paid APIs, SDK migration, host/third-provider orchestration, additional summarization calls, attachments, deployment, production rebuild/restart, user-history migration, commits or pushes unless separately authorized.

Future compatibility is a presentation requirement: render actual participants through a reusable list and message identity treatment; do not broaden backend agent enums or fabricate working providers. A four-agent fixture may demonstrate layout, clearly as a fixture. The live UI lists only actual available agents. Human recipients and agent counts must be labeled consistently.

## 3. Application layout

### Desktop

- Use a 200px collapsible history sidebar with CandC wordmark, New discussion, history and a compact connection/settings entry. Put CLI/version/login instructions in connection details.
- Merge the breadcrumb, discussion heading and toolbar into one approximately 56px header. Show a short display name, execution status, participants entry, reading settings, overflow, and the primary execution action.
- During execution, expose both pause-after-current-answer and immediate stop with unambiguous accessible names. Stop must not be buried in an unrelated settings menu. Do not equate pause with successful completion.
- Add one approximately 40px current-issue row. Long issue text can wrap to two lines; complete text is available in the issue panel. Avoid repeating the entire initial prompt in the title and issue row.
- Give the remaining central region to the independently scrolling conversation and a bottom composer. Ordinary paused status is one quiet line. Keep storage uncertainty and actionable blockers prominent with explanatory text and recovery controls.
- Issues, participants, settings, sources and diagnostics open a single inspector at a time. At widths >=1280px it occupies approximately 320px on the right; below that it overlays. It must never take vertical space away from the message viewport.
- The inspector scrolls internally; opening it preserves conversation scroll and drafts. Do not also keep the old top/bottom accordions in the main conversation.

### Mobile and narrow windows

- Below 768px, history and inspectors are overlay drawers, closed by default. No persistent history/connection block above the conversation.
- Use a compact header/current-issue row and an always reachable composer. Participant identities and long titles must not force a row of controls outside the viewport.
- Overlay drawers have a visible close action, Escape handling, appropriate dialog semantics, focus containment and focus return. Docked desktop inspectors are not modal.
- Support dynamic viewport height and safe-area insets. When the software keyboard is visible, keep composing usable without making promises about a fixed reading-height percentage.

## 4. Conversation anatomy

- All AI messages share the same left alignment, including pending messages. Human messages align right. Do not map every provider to a different column or randomly alternate positions.
- Use 28-32px initial/symbol avatars with author names and muted timestamps. Identity must not depend only on color. A future role may be shown as a quiet label.
- Use subtle filled bubbles with roughly 10-12px corners, minimal border, no glow/heavy shadow or thick colored side stripes. Short messages size naturally; longer messages use a readable column up to about 820px. Allow a table/code block to scroll within its container.
- Show reply relationships as a short linked quotation/reference within the message. Use only valid, eligible references; never infer semantic response from adjacent position.
- Keep a compact reply action and a more menu. The existing ask-the-other-agent-to-check action must remain available where eligible. Touch and keyboard users must not depend on hover.
- Reply creates an unsent draft with a visible target preview and cancel-reference action. Opening UI controls never sends a message or starts inference.
- Show details disclosure only when the existing safe reading segmentation recognizes real details. Use short copy such as 展開細節 / 收合細節. Missing/ambiguous segmentation falls back to full text. Preserve the full public message and export.
- Normal saved state is quiet but discernible; optional annotation diagnostics belong in message information. Missing annotations must not look resolved. Failed/uncertain saving remains obvious.
- Streaming text belongs in the current author's bubble. Distinguish waiting/queued from actual generation. Do not show private reasoning. Do not use a green completion check for an ordinary manual pause.
- Auto-follow only near the bottom; scrolling up freezes following and shows a new-message affordance. Source navigation expands the destination and gives it focus without sending input. Avoid scroll jumps when details change.
- Future host process notices use a compact neutral event row; substantive host speech uses the same AI bubble. This is a rendering convention, not new orchestration.

## 5. Naming and creation flow

- Add optional persistent displayName, independent of topic and prompt. Blank/absent means use the first nonempty topic line, visually ellipsized, with full original topic available through details. Do not generate a title through AI.
- Support rename with the repository's normal validation/locking. Treat display metadata separately from task/configuration versions: rename must not invalidate model context, delivery receipts, issue proposals or confirmations. Preserve old journals without batch rewriting. Explicit name should be carried through reconstruction where appropriate.
- Create page has one title, 新討論, a topic field, two compact explicit model selectors, and a readily discoverable start action. Remove duplicate marketing headings and paragraphs.
- Optional goal/constraints are under 補充條件. Group discussion kind, run mode and speaker flow under short distinct labels 討論形式 / 執行模式 / 發言順序. Keep effective settings visible as a concise summary when controls are collapsed.
- Keep models explicitly selected and supported effort rules intact. Show a clear reason when start is unavailable and link to the relevant field/settings. Do not silently select or downgrade models.
- Research remains visibly opt-in, off by default; reveal roots and disclosure when enabled. Execution limits remain editable under advanced settings with their current summary visible.
- Demo is clearly labeled. Do not claim a specific subscription billing arrangement merely because a CLI is signed in.

## 6. Design system and copy

- Light: neutral near-white page and white reading surfaces, charcoal text, muted secondary text, restrained dark teal primary action.
- Dark: neutral charcoal page/sidebar, slightly lighter bubbles/composer, soft off-white text, restrained teal accents. Avoid large green washes and gradients.
- Suggested starting tokens: dark page #151719, sidebar #101214, surface #202428, text #E5E8EB; light page #F7F8FA, surface #FFFFFF, text #20252B. Verify actual contrast and adjust consistently rather than treating these as immutable colors.
- Preserve 14/16/18px reading preferences, default 16px; use approximately 1.65 line-height. Headings have distinct but restrained levels, below the app title's prominence. Use system UI/Traditional Chinese sans-serif fallback; do not add remote fonts unnecessarily.
- Use an 8px spacing rhythm with 4px subdivisions, consistent icon strokes, field/button heights and corners. Primary touch controls have adequate hit areas even when visible icons are small.
- Integrate existing competing styles instead of appending another cascade of overrides. Fix undefined tokens, including existing --border usages. Respect reduced-motion preferences.
- Preserve the CandC wordmark; no new logo, slogan or unsupported plus/attachment button from generated images.
- Reading/theme/font controls move into one Aa/settings popover; keep preferences persistent. Full settings, evidence hashes, task versions, session IDs and raw diagnostics belong in appropriate panels.
- Simplifying copy must not blur generated vs saved, round ended vs issue completed, disagreement vs blocked, skipped vs resolved, or storage recovery vs session reconstruction.

## 7. Validation and implementation order

1. Inspect current source, local guidance, git status, scripts and focused contracts. Record what is already modified; preserve it.
2. Implement layout regions, responsive inspectors and execution controls.
3. Implement message anatomy, reply draft, title metadata and creation flow.
4. Consolidate design tokens/themes and refine visual fidelity using real browser screenshots.
5. Run relevant tests, isolated build and fake-provider browser suite; update only affected README/validation documentation.

Use the existing isolated build mechanism with a unique cache output and isolated fixture port/history. Verify scripts before executing; do not run a canonical command that overwrites dist/ or web-dist/. Temporary screenshots/reports belong in the task visualization directory. The committed concept references above are intentional project documentation.

Required desktop/mobile scenarios: 1440x900, 1280x720, 390x844; both themes; 14/16/18px; short and long Chinese topic; long replies with nested headings, tables/code, with and without detail boundaries; issue inspector open; four participant presentation fixture; quoting and canceling; direct-recipient visibility; source jump; scroll-up/new-message; pause/stop/rebuild; storage uncertainty after refresh; old histories; complete export; display-name edit without task changes.

At default 16px, inspectors closed, normal status, keyboard closed and empty composer, target message viewport >=60% height on desktop and >=50% on mobile. Expanded inspectors must not recreate vertical collapse. Actionable warnings may use more space when necessary. Verify computed bounds, not screenshots alone.

Check no document horizontal overflow, no clipped focus/actions, keyboard navigation and focus return, mobile touch controls, no relevant runtime errors, and no extra provider calls from purely presentational actions. Verify source jump and theme/reading changes preserve data. Do not weaken existing behavior assertions simply to make redesigned selectors pass.

Inspect the approved concept references AND actual screenshots before handoff. Acceptance is faithful application of the approved refinements, not literal reproduction of image-generation artifacts. No claims of improved live model quality or subscription cost savings from fake tests.

Final report: implemented UI behavior, actual commands/results/isolation, screenshot evidence, remaining limitations, compatibility/rollback notes for display metadata, and explicit confirmation whether live calls or formal runtime replacement occurred (neither is authorized here).

## 8. Visual refinement addendum (2026-10-04)

The user approved an interactive mockup that keeps the layout above and refines its visual treatment. Where this section differs from sections 3-6, this section wins. Behavior, contracts and accessible names are unchanged.

- Tokens: neutrals carry a slight teal bias in both themes. Codex uses teal and Claude uses clay only for avatars, names and quotations, never as bubble fills. Secondary and caption text (`--muted`, `--faint`) must reach at least 4.5:1 on every surface they are used on.
- Type: system fonts only (Segoe UI Variable, Microsoft JhengHei UI, then platform fallbacks; Cascadia Mono for code). Sizes by role: captions and meta 11-12.5px, controls and panel text 13-14px, reading text 16px by default (14/16/18 selectable), discussion name 17px (15.5px on narrow screens), page heading 26px. Reading text uses 1.72 line height (replacing 1.65) and tabular numerals for times and counters.
- Sidebar: 232px (replacing 200px), sorted and grouped by last saved activity with a status dot per item and the CLI connection state at its foot.
- Header: history toggle before the name, a status pill, a participant avatar stack, Aa, overflow, then quiet stop and primary pause during execution.
- Current-issue row: issue position, round progress against the round limit and elapsed against total time. Values come only from saved state.
- Messages: author, role label and time above the bubble; actions separated from content by a hairline inside the bubble; the details toggle sits in the action row on desktop and above it on narrow screens. Day and round dividers come from saved timestamps and round numbers and must not imply hand-offs.
- Composer and creation: recipient, reply source, discussion form, run mode and speaker flow use native radio groups styled as segmented controls; focus and research use switches. The creation settings list is always visible, so a collapsed summary is no longer needed.

## 9. Multi-seat room and moderator addendum (2026-10-05)

The user approved a multi-seat interface built on the section 8 tokens (a conversation preview and an interactive 1280x800 mock with light/dark and phone frames). Where this section differs from sections 2-8 it wins. Existing accessible names are kept unless listed. Section 2's rule not to broaden backend agent enums is superseded for seat IDs only: a seat is no longer a provider (see ROOM_CONTRACT.md); no new provider is enabled.

### Identity

- A seat is one speaking session and the provider is an attribute of it. Glyphs: Codex `C`, Claude `A`, Gemini `G`, Grok `X`; the moderator is a rounded square `主`; you are filled. Later seats of one provider are numbered and drawn outlined (`C1`, `C2`), named `Codex 1`, `Codex 2` unless the seat has a label. Never derive an avatar from the first letter of a name: Codex/Claude and Gemini/Grok previously collided on `C` and `G`.
- Tokens `--gemini`, `--grok` and `--moderator` (each with `-soft`) exist in both themes; no hard-coded colours and no coloured side stripes. State is shown by a ring (speaking), a badge (muted, confirmed) and dimming, never by colour alone.

### Creation (replaces the two-agent form, which is removed)

- One page, three steps: topic; seats and moderator; rules. Presets cover two seats, three-way review, one AI with several viewpoints (asks which provider and assumes none) and four seats plus moderator. One row per seat holds a name, provider, explicit model and effort, and a position or angle (required when debating, optional otherwise, and sent as the seat's instructions either way). Controls above the one being changed never move: every seat renders the same three lines in every mode (the demo reply source shows disabled model and effort fields, the research row stays visible and disabled), so switching the discussion form or the reply source changes no height; the provider picker replaces the preset row in place. A connection-check row shows readiness for all four providers, and a sticky summary bar shows the seats, the single reason start is unavailable and a link to the connections page.
- The moderator is a card with a switch, its own provider and the privacy statement. Enabling it defaults to ordinary facilitation; a separate unchecked "主持人裁判模式" checkbox explicitly enables forced intervention. The disclosure distinguishes brief coordination/speaker consensus from stop, mute, notified topic changes and judge rulings. Ordinary mode retains the selected speaker flow. Idle Settings exposes the same version-checked mode choice; changing it rebuilds native sessions without starting a call. Same-provider seats show that each seat has its own session and that a private message is invisible to the others, including a twin of the same provider.

### Room

- One 44px sub-bar carries the Conversation, Conclusion and Diagnostics tabs, the current topic and the round, time and moderator-call meter. A moderator grant line appears only while a grant exists.
- The participants roster is docked at widths of at least 1280px without taking focus, becomes a drawer below that, and remembers when the user closes it. Cards show state, mute reason, contribution and interruption counts, model and position; session IDs live in diagnostics.
- A generating bubble shows only a call that has no saved message yet: a saved message has the ID of the call that produced it, so a preview for that call is dropped the moment the message is saved and the same text never appears twice.
- The stream interleaves messages with one-line events: grants, mutes, interruptions, topic notices and configuration changes. Routine monitoring (`observe`) never appears there; the roster counts it and diagnostics lists it. Substantive moderator speech is an ordinary bubble labelled as moderation.
- The composer is a textarea above one row holding the recipient chips and the send button. Public is announced to screen readers only; a private recipient shows a visible reminder of who cannot read the message.
- Conclusion shows either the participants' consensus or a judge ruling with the fixed statement that it does not represent every speaker, plus dissent, unresolved items and unanswered user requests. Rooms without a judge, including ordinary facilitation, show proposal confirmation progress. Diagnostics shows calls, sessions, every moderator command (including rejected commands), evidence and the performance panel. Role prompts preserve the original topic and let speakers choose methods; the UI does not require a topic-specific decision template or manufacture agreement.
- Active-policy rooms retain a provisional checkpoint on Conclusion even when no formal result exists, with reasons, dissent, unknowns, public source jumps and a stale-version notice. Pending personal questions and remaining tasks share that view; the conversation has a compact checkpoint entry. Older rooms show saved public analysis/summary without inventing agreement. Settings can explicitly enable the policy for an old version 3 room and change idle research permissions/read-only roots; permission changes retire sessions and never begin inference. Diagnostics explains failed control/report validation using safe codes. See the active-policy section of ROOM_CONTRACT.md.
- Provider readiness, versions and login commands have their own connections page instead of a drawer. Returning from that page preserves the complete unsaved creation form, composer text, quoted target and private recipient. The hidden workspace stays mounted, its inspectors do not trap focus, and returning resumes scroll-follow or preserves the user's reading position even when replies arrive in the background. A Return to discussion action is available on the connections page.

### Measured at default reading size, roster docked, idle

Message viewport 71% (1440x900), 64% (1280x720) and 66% (390x844) of the window height in both themes, with no horizontal overflow. Known limits: rooms record turn measurements only (no execution-level record); new discussions cannot enable focused issues; several live CLI sessions of one provider are unverified.
