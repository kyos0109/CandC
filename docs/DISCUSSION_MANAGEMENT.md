# Conversation management

## Folders and authority

Uploaded originals and extracted text follow their owning discussion through
archive, trash and restore. Permanent deletion removes the discussion's attachment
files only after its deletion marker is durable. Remaining attachment files count
as an incomplete deletion and are removed on an explicit retry. Other discussions'
attachments remain untouched; downloads are unavailable once deletion is marked.

Versions 1, 2 and 3 share manual `active`, `archived` and `trash` folders. Missing
`management` metadata means active; startup does not migrate old journals.
Archive/unarchive/trash/restore append an ordinary durable state event containing
folder, UTC change time, previous folder for trash, operation ID and action.
They preserve execution status, messages, evidence, sessions, task/configuration
versions and conclusion authority. Management is not evidence of completion.

Archived and trashed conversations are read-only. Reading, diagnostics, exports
and explicit storage recovery remain available; restore to active before changing
content, renaming, configuring, reconstructing sessions, creating a derived
discussion or scheduling inference. Restore from trash returns to the saved
previous folder. Restoring never starts inference or bypasses stopped/indeterminate
session reconstruction requirements. No automatic retention or cleanup runs.

Each transition is serialized at the controller's idle boundary and checks the
expected journal sequence, storage barrier, running status, activity and owned
runtime (including cancellation cleanup). The service admission queue also
serializes management with creation, upgrades and starts. Repeating the most recent
management operation ID/action returns its saved state; a different action with
that ID conflicts. A later changed sequence requires a refresh.

## API and browser

- `GET /api/discussion-index`: `folder=active|archived|trash` (active by default),
  `q`, optional `before` UTC timestamp, `page` (1 by default) and `limit` (50 by
  default, maximum 100). Search checks full name/topic. Date filtering is exclusive;
  the browser converts the selected local day's start into UTC. Sort by last saved
  message time descending and ID ascending. Out-of-range pages clamp to the last.
  Returns `items`, filtered `total`, actual `page`, `limit`, unfiltered folder
  `counts`, all `runningIds` and `pendingDeletions`.
- Summaries include name, a topic preview of at most 240 characters, seat/provider
  badges, status/outcome badge, management and storage flags, timestamps, sequence
  and runtime presence. They contain no message, evidence or call arrays. The
  browser loads complete state only for the selected discussion; all running
  discussions remain subscribed across history pages/folders. Existing full-list
  and JSON/Markdown export shapes remain supported.
- History query changes are debounced by 200 ms and refresh only the index, without
  reloading selected content or storage diagnostics. Selected detail refreshes on
  selection, its SSE events, explicit operations and transport recovery. Background
  SSE events refresh the index/diagnostics without reloading unrelated detail.
  Two-second fallback polling remains available while any discussion is running or
  its transport is disconnected; healthy idle subscriptions do not poll. A pending
  polling refresh must finish before another polling refresh starts.
  Normal subscription creation/replacement does not show a reconnect warning.
  Transport errors show the warning; it clears after every subscribed stream opens.
- `POST /api/discussions/:id/management`: strict body with `action` of
  `archive|unarchive|trash|restore`, UUID `operationId` and positive integer
  `expectedSequence`. Returns the saved complete state.
- `DELETE /api/discussions/:id`: strict body with UUID `operationId` and positive
  integer `expectedSequence`. Requires trash unless retrying a matching deletion
  marker. Returns `{id, deleted:true, expectedSequence}`.

All routes retain existing local Host/Origin/session authentication. Archived and
trashed changes return `DISCUSSION_READ_ONLY`; deleted content returns HTTP 410
`DISCUSSION_DELETED`. Sequence mismatches return `VERSION_CONFLICT`.

The browser provides per-row menus, page selection, search/date filtering, batch
actions and undo for successful archive/trash operations. Each batch item commits
independently; failures remain selected. Current unsent drafts require explicit
discard confirmation before archive/trash. Permanent deletion requires a review
dialog with item count and export links. Empty trash snapshots the reviewed IDs
and sequences; items added afterward are not deleted.

## Permanent deletion and recovery

Under the existing per-journal lock, deletion first validates trash and sequence
against durable replay. It creates `<id>.deleted.json`, verifies marker sync and
close, then removes only `<id>.jsonl`, `<id>.unconfirmed.json`,
`<id>.jsonl.compacting` and numeric-timestamp `.jsonl.backup-*.gz`/
`.jsonl.recovery-*.gz` files. Only regular files in the configured history directory
are accepted; paths, IDs and extensions are not supplied by clients. Other files,
agent workspaces, shared performance logs, CLI-native history and downloaded
exports remain outside this operation.

The content-free marker stores format version, ID, operation ID, expected sequence
and deletion time. Startup excludes marked histories before journal recovery, and
stores reject reads, recovery, compaction or commits to marked IDs. Both behavior
versions refuse ID reuse. Controller content caches and SSE subscriptions are
released when the marker exists, including after a failed deletion.

No content is removed before marker durability is verified. Failure leaves files
and the marker in place, reports an incomplete deletion and never reintroduces
the conversation. Startup only reports remaining files, without deleting them.
An explicit retry with the marker's expected sequence verifies its durability
again and removes remaining allowlisted files. A valid marker does not need to
reuse the original request operation ID. Corrupt/empty/non-regular markers require
inspection; they expose no retry sequence and never authorize further deletion.
Minimal markers remain after successful deletion to prevent ID reuse.

Marker diagnostics index remaining allowlisted files in one directory pass, with
at most 32 concurrent marker checks per scan. Parsed valid markers are reused only
while file identity, size and modification/change timestamps remain unchanged;
metadata is checked on every scan and the cache is rebuilt after restart. Invalid
markers still produce inspection warnings even without residual content. Permanent
deletion independently rereads and validates the marker before syncing/removing
files; diagnostic caching never authorizes deletion.

Journal storage uncertainty blocks management/deletion until explicit recovery.
Recovery does not change folders or auto-resend unknown-result turns. New optional
management fields are readable by this build without changing legacy records;
older strict-schema builds may reject them. Rollback requires a matching saved
data/build pair. Permanent deletion cannot be reversed through a program rollback.

Acceptance uses disposable journals, fake providers, fault injection at journal
and marker write/sync/close and file deletion, restart/retry, exact file isolation,
mixed versions, HTTP authentication and desktop/mobile browser interaction.
These checks do not establish real device power-loss durability or provider-native
history removal.
