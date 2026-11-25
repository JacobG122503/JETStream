# 023 Self-hosting package and documentation

## Request
Depends on: 022, 026

User: "eventually the backend will be hosted on JETs servers" and the user wants to demo it to their manager first.
Production package for self-hosting: environment configuration with validation, migrations on upgrade, health checks, structured logs, backup and restore instructions, sample service files for Linux and Windows, optional Dockerfile, HTTPS reverse-proxy examples, hardening checklist. CI workflow file that lints, tests and builds (file only, do not push). README with a one-command laptop demo, the demo accounts, a guide per role and a feature matrix against the request that marks simulated or untested features honestly.

Note from 001 PM: test against a real PostgreSQL with TLS if one is available, otherwise say it is untested; review npm audit findings (React Router 6, Vitest 3 tooling) and the Node version, since Node 18 is past end of life.

Note from 003 QA: migrations, seed, reset, value conversion, lock contention and 16 skipped tests (`TEST_DATABASE_URL`) have never run on a real PostgreSQL server. Do not install or run one without the user's approval.

Note from 004 PM: untried so far: interleaved transactions on a real PostgreSQL (sign-in against password change, reset, archive), Secure cookies over HTTPS, a real reverse proxy (`TRUST_PROXY`), Windows, browsers other than Chromium. Document that a demo opened from other computers needs `PUBLIC_URL`, since with `HOST=0.0.0.0` its links begin with `http://0.0.0.0`; and that `npm run dev` pages have no Content-Security-Policy, so dev must never be exposed. Successful sign-ins, and sessions per person, are not limited.

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
- 2026-11-23 ORCH: replaced the GitHub Pages scope
- 2026-11-24 PM: note added (from 004 acceptance)
