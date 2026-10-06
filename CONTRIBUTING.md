# Contributing

Read [AGENTS.md](AGENTS.md) for task scope, code ownership and protected boundaries.
Use Windows and Node.js 24. Begin with a reproducible issue and the smallest coherent
change. Read only the affected source, tests and owning contract; completed reviews
and historical validation do not authorize additional implementation.

## Select checks for the change

Install locked dependencies with `npm ci --ignore-scripts`. Run the affected tests first.
For behavior changes, source deletion or shared modules, run typechecks and the full
coverage suite. For UI behavior changes, also run the affected browser cases; broaden
to the complete browser suite when layout, session or shared-view behavior changes.
For prose-only edits, check document links and factual consistency instead of repeating
provider/browser tests. Do not lower thresholds to make cleanup pass.

```powershell
npm run typecheck
npm run test:coverage
npm run build:isolated
npx playwright install chromium
npm run test:e2e
```

`build:isolated` writes only to `.cache/verification`; `CANDC_VERIFY_DIR` can select
another child of `.cache/`. `build`, `check`, `dev` and the launcher replace the normal
runtime outputs and require authorization when preserving a running build.

Browser tests use a new fake-only fixture and disposable journals, refusing server
reuse. `CANDC_FIXTURE_PORT` selects its port (default 4399); `CANDC_BROWSER_PATH` may
select an installed compatible Chromium. The default uses Playwright's managed browser.
Never point fixtures at real `data/` or run live provider calls in automatic verification.

## Add evidence and update the owner

Add regression tests for changed behavior and meaningful failure modes. Remove tests
only when their exclusively used feature is deliberately removed; absence of test
coverage is not evidence that compatibility or a safety mechanism is unnecessary.
Update the affected contract when behavior changes. For locale changes, add the English
catalog entry with matching interpolation parameters and preserve historical protocol
strings and all user/model/evidence content.

Record actual checks and material limits in [VALIDATION.md](VALIDATION.md), dated and
scoped to the tested tree. Older snapshots remain in Git history; do not append every
task transcript or copy contracts into the validation record.

For dependency/security changes, run `npm audit` and `npm run secrets:scan`; public
release preparation also runs `npm run export:public`. Export does not publish.
Live calls, production access, commits, pushes and publishing require explicit
authorization for that action. Never include credentials, private conversations,
personal paths, raw stderr or research inputs in an issue or pull request.
