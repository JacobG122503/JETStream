# 001 Scaffold the project

## Request
User: "eventually the backend will be hosted on JETs servers", so GitHub Pages is dropped.
Scaffold the project with build, lint and test commands and one passing test, using the stack now in CLAUDE.md: API server plus web app, database migrations set up with one trivial migration, health endpoint, `dev` and `demo` commands, Playwright smoke test against the production build served by the server.
A browser-only scaffold from an earlier, stopped attempt is uncommitted in the project folder (web app, lint, Vitest, Playwright). Reuse what fits and remove what does not (Dexie, fake-indexeddb, static sub-path server, relative base, hash routing).

## Spec
_PM fills this in during grooming._

## Implementation notes
_Software engineer fills this in._

## QA report
_QA tester fills this in._

## PM acceptance
_PM fills this in after QA passes._

## History
- 2026-11-23 created
- 2026-11-23 PM: groomed
- 2026-11-23 ORCH: todo -> groomed
- 2026-11-23 ORCH: groomed -> in-progress
- 2026-11-23 ORCH: back to todo; user moved the target from GitHub Pages to JET's own servers
