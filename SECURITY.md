# Security

## Scope and trust boundary

CandC is a Windows-first, local single-user application. It listens on
`127.0.0.1` and requires matching Host/Origin and an HttpOnly SameSite=Strict
session cookie or bearer token on protected routes. It is not a multi-user
service. Local processes can obtain a session from `/api/session`; OS account
and filesystem isolation remain the machine owner's responsibility. Do not
expose the port through a proxy, public interface, or port forwarding.

The supported source is the current release; older releases receive no separate
maintenance commitment. Live support depends on verified official CLI versions
and tool isolation. Gemini and Grok remain demonstration-only until that live
validation is complete.

## Reporting

Before making a repository public, enable GitHub private vulnerability reporting.
Use the repository's Security page to submit a private report once that channel
is enabled. If it is unavailable, request a private contact route without posting
exploit details, credentials, or private conversation data in a public issue.
There is no public security inbox or response-time commitment configured yet.

Include affected versions, minimal reproduction, impact, and sanitized evidence.
Keep original evidence locally. Never include subscription credentials, session
cookies, bearer tokens, private prompts, or CLI stderr.

## Enforced boundaries

- Owned subprocesses run without a shell and with bounded output: 2 MiB per JSON
  line, 1,000 queued records and 8 MiB queued JSON bytes. RPC notification queues
  use the same record and byte limits. Failures retire affected execution.
- Research is opt-in and read-only. Public fetches reject private/local addresses,
  credentials and cookies. Local text reads stay inside explicitly authorized
  roots. Evidence is limited to 100 records and 16 MiB per turn, on both write
  and read; corruption and I/O errors are not treated as absent evidence.
- Private messages and evidence are filtered by seat/session scope. Moderators
  receive only eligible public content; incomplete answers are not evidence.
- Journal appends are serialized across store instances in one CandC process.
  A shared discussion ID cannot switch behavior versions. Multiple independent
  CandC processes writing the same history directory are unsupported.
- Storage uncertainty blocks writes and inference. Recovery verifies durable
  records and requires explicit session reconstruction; it never resends an
  unknown-result turn automatically.
- Browser responses, including SSE, carry framing restrictions, a same-origin
  Content Security Policy, MIME protection and a no-referrer policy. Inline
  styles are allowed for existing UI geometry; inline scripts are not allowed.

## Before release

Run the canonical checks in CONTRIBUTING.md and inspect the clean source export.
Secret scans are detection aids and cannot prove the absence of every secret.
Keep local history, caches, authentication directories, research inputs and
existing private Git history outside the public baseline. Dependency audits
identify known published advisories, not all possible vulnerabilities.
