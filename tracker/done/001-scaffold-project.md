# 001 Scaffold the project

## Request
User: "eventually the backend will be hosted on JETs servers", so GitHub Pages is dropped.
Scaffold the project with build, lint and test commands and one passing test, using the stack now in CLAUDE.md: API server plus web app, database migrations set up with one trivial migration, health endpoint, `dev` and `demo` commands, Playwright smoke test against the production build served by the server.
A browser-only scaffold from an earlier, stopped attempt is uncommitted in the project folder (web app, lint, Vitest, Playwright). Reuse what fits and remove what does not (Dexie, fake-indexeddb, static sub-path server, relative base, hash routing).

## Spec
### Goal
One npm project in which a single Node server serves the JET Time web app and a JSON API backed by PostgreSQL semantics, runs on this laptop with nothing but Node installed, and can later run on JET's servers by setting environment variables. It is the smallest working base for 002 and 003, with no product features.

### User stories
- As a developer, I want install, dev, build, lint, test and e2e commands that work on Node 18.20 so that later tasks start from a green base.
- As the person demoing to a manager, I want one command that starts the app on my laptop so that nothing else has to be installed.
- As JET's server administrator, I want a plain Node process configured by environment variables, with a health endpoint and explicit migrations, so that I can host it on our own servers.

### Commands and configuration
| Command | Behaviour |
|---|---|
| `npm run dev` | API and web app with reload on change; embedded database, migrated automatically |
| `npm run build` | Type-checks everything; builds web app and server |
| `npm start` | Runs the built server in production mode (`NODE_ENV=production`) |
| `npm run demo` | Builds, migrates an embedded database kept separate from dev's, starts the production build in explicit demo mode |
| `npm run db:generate` / `npm run db:migrate` | Create a migration from the schema / apply pending migrations |
| `npm run lint`, `npm test`, `npm run e2e`, `npm run e2e:install` | As in CLAUDE.md; browsers stay inside the project |

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | none | Real PostgreSQL. Required in production except in demo mode |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Listen address |
| `BASE_PATH` | `/` | URL prefix, read at server start, not at build |

Variable and command names above are fixed because later tasks use them. File layout, the demo-mode switch and library choices within the CLAUDE.md stack are the engineer's.

### Acceptance criteria
Commands and quality
1. **AC1** On Node 18.20, after deleting `node_modules`, `npm install` exits 0 with no unsupported-engine warning for any direct dependency. `npm ci` also exits 0 (lockfile in sync).
2. **AC2** `npm run build`, `npm run lint` and `npm test` each exit 0 on a clean checkout. `npm test` runs once without watching, leaves no process running, and includes at least one web component test (Testing Library) and one API test (Supertest) against a migrated database.
3. **AC3** Each of these, introduced temporarily, makes the named command exit non-zero: a type error in server code and one in web code (`npm run build`), a lint error (an unused variable) in either (`npm run lint`), a failing assertion in either (`npm test`).
4. **AC4** Leftovers are gone: no `dexie`, `fake-indexeddb` or hash router in source or dependencies, no `e2e/static-server.ts`, no build-time relative base used on its own (see Assumptions), no GitHub Pages wording in code or config. Existing pages, unit tests and the `pageProblems` e2e check are kept or adapted.

Server and API
5. **AC5** `GET /api/health` returns 200, JSON content type, body `{"status":"ok","database":"ok"}`, after actually querying the database. When the query fails it returns 503 with `{"status":"error","database":"unavailable"}` within 5 seconds and no connection details or error text in the response.
6. **AC6** An unknown path under `/api`, with any method, returns 404 JSON `{"error":{"code":"not_found","message":"Not found"}}`, never HTML. An unexpected exception in an API route returns 500 JSON `{"error":{"code":"internal_error","message":"Something went wrong"}}` with no stack trace or exception text, in development and production. Malformed JSON in a request body returns 400 JSON in the same shape with code `bad_request`.
7. **AC7** No response carries `X-Powered-By`. The server never returns the content of files outside the web build: `/../package.json`, `/..%2fpackage.json`, `/.env` and the built server's own files are not served.
8. **AC8** The server serves the web app with normal (history) routing. A GET for a page path that is not a file returns 200 with the web app (`index.html`), at any depth. This fallback never applies to paths under `/api` (AC6) or, with a base path, under `<base>/api`; a missing file under the built assets directory returns 404, not HTML.
9. **AC9** The same build, without rebuilding, works with `BASE_PATH=/` and `BASE_PATH=/jettime`: home page, assets, favicon, API call, a deep link with two path segments and its reload. With `/jettime`, the API is at `/jettime/api/health`, `/jettime` leads to `/jettime/`, and a path outside the prefix returns 404. `/jettime` and `/jettime/` as settings are equivalent.

Web app
10. **AC10** The home page has one level-1 heading "JET Time" and shows the server status from `/api/health`: "Checking server..." while loading, "Server connected" on 200, "Cannot reach the server" with a "Try again" button otherwise. The status text is in an element announced to screen readers (`role="status"` or `role="alert"`). "Try again" repeats the request.
11. **AC11** An unknown page shows level-1 heading "Page not found" and a link "Go to the home page" that works, at any depth and after a reload.

Database
12. **AC12** Migrations are SQL files in the repository, and the same files are used for the embedded database and real PostgreSQL. The first creates one trivial table (suggested: `app_meta`, `key text primary key`, `value text not null`). Applying migrations twice succeeds and changes nothing the second time. `npm run db:generate` with no schema change creates no new migration.
13. **AC13** The embedded database passes automated tests on Node 18.20 for: commit; rollback leaving no row; a duplicate key failing with SQLSTATE `23505`; a null in a required column failing with `23502`; 20 simultaneous increments, each a transaction that reads and then writes one row with a row lock (`SELECT ... FOR UPDATE`), ending at exactly 20; data still present after closing and reopening the data directory.
14. **AC14** Fallback: if PGlite fails any AC13 check or cannot be installed, built or run on Node 18.20, the engineer may replace it with another option that runs a real PostgreSQL engine, installs through npm without administrator rights, works on macOS, and keeps its data in the project folder. Emulations and other databases (such as pg-mem or SQLite) are not allowed. The failing check and its output must be in the Implementation notes; all other criteria still apply. If no such option works, report blocked instead of weakening the criteria.
15. **AC15** Tests and e2e use fresh temporary or in-memory databases and ignore `DATABASE_URL`: running them with `DATABASE_URL=postgres://nobody@127.0.0.1:1/none` passes. They do not touch the dev or demo data. Embedded data directories are inside the project folder and git-ignored, as is `.env`.

Running
16. **AC16** `npm run dev` prints a URL where the home page reaches "Server connected". Editing a web file updates the browser, and editing a server file restarts the API, without restarting the command; the embedded database survives the restart.
17. **AC17** `npm run demo` starts from a checkout with `npm install` done and no existing data, prints one URL that shows "Server connected", and prints that this is demo mode. Running it again keeps existing data. With `DATABASE_URL` set it exits non-zero without connecting. (Seeding comes with 003.)
18. **AC18** In production mode without `DATABASE_URL` (and not demo mode) the server exits non-zero within 5 seconds with a message naming `DATABASE_URL`; it never falls back to the embedded database. With an unreachable database it exits non-zero within 15 seconds, and no output contains the password from the URL.
19. **AC19** Production start does not migrate. With pending migrations it exits non-zero with a message naming `npm run db:migrate`.
20. **AC20** A `PORT` that is not an integer from 1 to 65535, or a `BASE_PATH` not starting with `/`, exits non-zero with a message naming the variable. A port already in use exits non-zero with a message giving the port.
21. **AC21** On SIGINT or SIGTERM the built server closes the database and exits within 5 seconds, and data written before is present on the next start.
22. **AC22** `npm run e2e` builds, runs Playwright against the built server (not Vite, not a static server) on a free port, and passes at both `/` and `/jettime/` with the same build: home page with "Server connected", unknown deep link with reload and link home, and an unknown API route returning 404 JSON. The e2e fixtures let later specs (002 onwards) run against either base path without starting their own server code. It fails on any unexpected console error, failed request or HTTP status of 400 or above, and leaves no server running.

### Test scenarios
1. `GET /api/health` on a migrated database: 200 and the AC5 body. With a database stub that throws `password=secret`: 503, and the body does not contain `secret`.
2. `POST /api/nope` and `GET /api/nope/deeper`: 404 JSON. `GET /nope/deeper`: 200 HTML showing "Page not found". `GET /assets/missing.js` (or the real assets directory): 404.
3. Body `{"a":` with `Content-Type: application/json` to a test route: 400 JSON `bad_request`. Test route that throws `Error('boom')`: 500 JSON without `boom`.
4. `BASE_PATH=/jettime`: open `/jettime/no/such/page`, reload: "Page not found", no failed requests. `GET /api/health` (outside the prefix): 404. `GET /jettime/api/nope`: 404 JSON, not HTML.
5. Edge: apply migrations twice: same tables and one migration record. Start against an unmigrated database in production mode: AC19 failure.
6. Edge: 20 simultaneous increments (AC13): final value 20.
7. Failure: `NODE_ENV=production` with no `DATABASE_URL`; `DATABASE_URL=postgres://u:hunter2@127.0.0.1:1/x`; `PORT=abc`; `PORT=70000`; `BASE_PATH=jet`; port already in use. Each exits non-zero with the stated message, and `hunter2` never appears.
8. Failure: in a component test the health request fails, then succeeds: "Cannot reach the server", press "Try again", then "Server connected".
9. `DATABASE_URL=postgres://u@127.0.0.1:1/x npm run demo` exits non-zero. Plain `npm run demo`, stop with Ctrl+C, run again: starts, data kept.

### Out of scope
- Theme, shared components, app shell (002). Domain schema, seed and reset commands (003).
- Sign-in, sessions, CSRF, rate limiting, security headers, proxy trust settings (004). `GET /api/health` is the one API route that never needs sign-in.
- Service files, Dockerfile, structured logs, backups, CI and README (023). Serving over HTTPS directly; a proxy does that.
- Proof against a real PostgreSQL server: none is available on this machine. The path must exist and share code and migrations, and must be reported as untested against a real server, not as working.

### Assumptions
- 002's "any base path" is met by `BASE_PATH` at run time. The proxy passes the prefix on unchanged. Removing the "relative base" means a bare `./` base, which breaks nested deep links; using relative URLs with a server-inserted `<base>` (or any other mechanism meeting AC9) is fine.
- Production migrations are explicit so an administrator controls upgrades; dev and demo migrate automatically.
- Server listens on 127.0.0.1 by default, so a demo is not exposed to the network unless `HOST` is set.

### Notes for the engineer
- `eslint.config.js` uses `import.meta.dirname`, which does not exist on Node 18.20; use a form that works there.
- `vite.config.ts` only includes `src/**` tests and uses jsdom for all; server tests need the Node environment. The current `tsconfig` files do not cover server code.
- PGlite has one connection, so overlapping transactions run one after another. AC13 proves correct results but not lock contention between connections; say so in the notes so 003 can plan its concurrency tests. One data directory must be opened by one process at a time, which matters for dev restarts.

### Size
M

## Implementation notes
### Result
All build, lint, test and e2e commands pass on Node 18.20.8. AC14's fallback was not needed: PGlite passes every AC13 check.

**Not proven:** the real PostgreSQL path has not been run against a real PostgreSQL server (none on this machine). It was run by hand over the PostgreSQL network protocol against PGlite behind `@electric-sql/pglite-socket` (in a scratch folder, not a project dependency): production start refused with pending migrations, `db:migrate` applied then found nothing to do, server started, health 200, health 503 after that server was killed. That exercises the `pg` driver and shared migrations, not TLS, authentication, several connections or lock contention.

### Files
- `src/web/`: web app, moved from `src/` (also `index.html`, `public/`). `basePath.ts` reads the prefix; `ServerStatus.tsx` is the AC10 status; `main.tsx` uses history routing. Pages and tests kept and extended.
- `src/server/`: `main.ts` (process, signals), `server.ts` (port check, database, migrate or refuse, listen, close), `config.ts`, `app.ts`, `api/` (router, errors, health), `web.ts` (static files and page fallback), `db/` (schema, PGlite, `pg`, migrations, folder lock), `migrate.ts`, `errors.ts`, `paths.ts`, `testing/`.
- `drizzle/`: SQL migrations (`0000_app_meta.sql`). `.gitattributes` keeps line endings fixed, because Drizzle hashes the files.
- `scripts/`: `dev.ts`, `demo.mjs`, `db-migrate.mjs`, `clean-dist.mjs`, `playwright.mjs` (unchanged).
- `e2e/`: `fixtures.ts` starts the built server per worker; `playwright.config.ts` has projects `root` and `base path`. Specs use addresses relative to the base path without a leading slash: `page.goto('')`, `page.goto('a/b')`, `request.get('api/health')`. `test.use({ basePath })` changes it for one file.
- Config: `tsconfig.*` (web, server, node), `vite.config.ts` (Vitest projects `web` in jsdom and `server` in Node), `eslint.config.js` (no `import.meta.dirname`), `.gitignore` (`.env`, `.data/`, browsers).
- Removed: Dexie, fake-indexeddb, `e2e/static-server.ts`, hash router, GitHub Pages wording.

Dependencies added: `express`, `pg`, `drizzle-orm`, `@electric-sql/pglite` (the stack); dev: `drizzle-kit`, `supertest`, `esbuild` (bundles the server; same version Vite uses), `tsx` (runs TypeScript for dev and process tests), types. PGlite is pinned exactly to 0.4.6 (PostgreSQL 17.5) on purpose: 0.5 and 0.6 also work on Node 18 but are PostgreSQL 18 and 19, probably newer than JET's server, and data folders do not carry over between PostgreSQL major versions.

### Design choices
- Mode: production unless `--dev` or `--demo` is passed to the server. Flags, so a stray environment variable cannot turn production into a demo. `--dev` is refused with `NODE_ENV=production`. The mode sets `NODE_ENV`, so `npm start` works on Windows too. `--data-dir <folder|memory://>` exists for dev and demo (used by tests).
- Base path: Vite builds relative addresses (`./`); the server turns those in `index.html` (and a `base-path` meta tag) into absolute ones at start. No `<base>` element, so plain `#main` links (002) are safe, and no inline script.
- `npm run dev` serves Vite on `HOST`/`PORT`/`BASE_PATH` and runs the API on a free port under `tsx watch`; prints the URL once the API answers. `DATABASE_URL` is ignored in dev, with a message. `db:migrate` uses `DATABASE_URL`, or the dev database without it (refused with `NODE_ENV=production`).
- Embedded folders are `.data/dev` and `.data/demo`, each with a `.lock` file holding the process id. A second process is refused; a lock of a dead process is taken over.
- Unexpected errors are logged on the server only. Connection failures are reported by code only, because messages can echo part of a mistyped URL.
- `checkPortIsFree` connects first, because macOS lets a program on 127.0.0.1 and one on all addresses share a port.
- Dot-file paths and anything under `assets` that is missing answer 404; a disguised API path (`/%61pi/x`, `//api/x`) also gets the API's 404.

### Acceptance criteria
- AC1 -> `rm -rf node_modules`, `npm install`, `npm ci`: both exit 0, no EBADENGINE lines.
- AC2 -> also run in a fresh copy holding only non-ignored files, after `npm ci`: test, lint, build exit 0. Web: `App.test.tsx`; API with Supertest: `app.test.ts`.
- AC3 -> six temporary faults: build exit 2 (server and web), lint exit 1 (both), test exit 1 (both); reverted.
- AC4 -> removed as above; searched for leftovers: none.
- AC5, AC6, AC7, AC8, AC9 -> `app.test.ts` (raw requests for traversal; both base paths; development and production), `main.test.ts`, `e2e/smoke.spec.ts` (one build, both paths).
- AC10, AC11 -> `App.test.tsx`, e2e. The button stays, inactive, while retrying so focus is not lost.
- AC12 -> `database.test.ts`; `npm run db:generate` says "No schema changes" and adds no file.
- AC13 -> `database.test.ts`, one test per check. AC14 -> not needed.
- AC15 -> `npm test` and `npm run e2e` passed with `DATABASE_URL=postgres://nobody@127.0.0.1:1/none`; afterwards no `.data/dev` or `.data/demo` existed and `.data/tmp` was empty.
- AC16 -> scripted with a browser at `/` and `/jettime`: connected; edit to a page applied without reloading the document; edit to `health.ts` restarted the API on the same database folder; SIGTERM left no process. Not an automated test.
- AC17 -> by hand: first run, Ctrl+C (SIGINT) exit 0, row added, second run, row still there; one URL printed; with `DATABASE_URL` exit 1.
- AC18, AC20 -> `config.test.ts`, `main.test.ts`, and by hand through `npm start`: immediate for a missing URL, about 5 s for an address that never answers; `hunter2` never printed.
- AC19 -> `server.test.ts` (stand-in database), and the network run above.
- AC21 -> `main.test.ts` for SIGINT and SIGTERM; the e2e fixture checks the built server exits 0 within 5 s. Also by hand: `kill -9` then restart works.
- AC22 -> `npm run e2e`; temporary specs with a 404, a console error and a failed request all failed as they should; no server left.

### Commands run
- `npm run build`: exit 0. `npm run lint`: exit 0.
- `npm test`: 7 files, 121 tests passed, about 15 s.
- `npm run e2e`: 8 passed (4 specs at 2 base paths).

### Assumptions and limitations
- PGlite has one connection: transactions run one after another. The 20-increments test proves the result, not lock contention or deadlock handling. 003 should plan for that.
- Malformed JSON sent to an unknown API path answers 400 rather than 404, because the body is read before routing.
- An empty `PORT` or `BASE_PATH` is refused; an empty `HOST` or `DATABASE_URL` counts as not set. `BASE_PATH` is limited to letters, digits and `. _ ~ -`, since it is written into HTML.
- While the API restarts in dev, the Vite proxy logs connection errors; they stop when it is back.

### Follow-ups
- `npm audit`: production has 2 moderate findings, both React Router 6 (open redirect through backslashes in links; an SSR issue that does not apply). npm reports every version up to 7.17.0 as affected, so there is no fix in version 6; 004 should not pass untrusted text to `navigate`. Development has 2 critical findings (Tinypool, through Vitest 3) and moderate ones in lint and Drizzle tools; npm offers only breaking changes for them and none were tried. Current Vitest needs Node 22.
- Node 18 is past its end of life and holds back several versions; consider moving to a newer one.
- 004: Drizzle's query errors include parameter values, and unexpected errors are logged in full, so keep secrets out of query parameters or trim the log.
- 023: test against JET's real PostgreSQL version, including TLS.

### Rework after QA (2026-11-23)
This section supersedes the notes above where they differ.

**Bug 1 (AC6).** `toApiError` no longer trusts `status`. Errors count as the client's only where they come from request reading: body parsing (`bodyReader` around `express.json()`, `api/router.ts`), undecodable route parameters (`URIError`), and `express.static` (`web.ts`, for example 416). `clientError` in `errors.ts` does the mapping; answers to these are unchanged. Anything else, including `res.sendFile` errors and adapter errors passed to `next`, is logged and answered with 500. `ApiError` is unchanged.

**`throw null`.** New `api/guardHandlers.ts`: at the end of `createApiRouter` every handler, also in nested routers, is wrapped so that a thrown non-error becomes an error. Express also drops a thrown or rejected `'route'`/`'router'` and a thrown `undefined`; covered too. A route calling `next()` or `next('route')` still passes on. It walks Express's `stack`, so a change there is caught by the tests. Not covered: `api.param` callbacks, and an explicit `next(null)`, which Express defines as "carry on".

**Bug 2 (AC22).** `ServerStatus.tsx` reads the body, and no longer cancels an unfinished request when the page is left inside the app (it ends by itself, at most 10 s later). A spec that reloads or navigates the document before the request has ended still sees `ERR_ABORTED`: the browser does that, so specs should wait for the page first.

**Ctrl+C in `npm run dev`.** The API was sent two signals (terminal and `stop()`), which tsx answers with SIGKILL. `tsx watch` now has its own process group (not on Windows, where it would open a window, so Windows is unchanged and untested) and gets one SIGTERM. Also: signals are handled while starting, SIGHUP (terminal closed) stops everything, and Vite's own SIGTERM handler, which ended the command before the API, is removed. Consequence: pressing Enter in the terminal no longer restarts the API (tsx feature; edits still do). `npm run dev -- --data-dir <folder>` now works, so that the test does not touch dev data. Not covered: `kill -9` of the command, and Ctrl+C during the moment of an API restart, where tsx may still force the old process.

Files: `src/server/api/router.ts`, `api/guardHandlers.ts` (new), `errors.ts`, `web.ts`, `src/web/ServerStatus.tsx`, `scripts/dev.ts`, `src/server/testing/serverProcess.ts` (`ownGroup`), `vite.config.ts` (server tests also in `scripts/`). Tests: `app.test.ts`, `App.test.tsx`, `scripts/dev.test.ts` (new), `e2e/smoke.spec.ts`. No dependency added.

Regression tests fail without the fix (each fix undone in a scratch copy):
- Trusting `status` again: 12 tests fail. No guard: 16. No `bodyReader`: 5. No static error handling: 2.
- Old `ServerStatus.tsx` behaviour: 3 unit tests fail, and the new e2e spec at both base paths with `ERR_ABORTED`.
- tsx in the terminal's group: the Ctrl+C test fails. Vite's SIGTERM handler kept: the SIGTERM test fails.

Also by hand, in the scratch copy: `npm run dev` in a pseudo-terminal, an edit that restarts the API, Ctrl+C: exit 0, no forced kill, `.data/dev.lock` gone (2 of 2); hangup: lock gone; Ctrl+C at nine moments during start: nothing left running, no lock.

Commands, with `DATABASE_URL=postgres://nobody@127.0.0.1:1/none` on Node 18.20.8: `npm run build` 0, `npm run lint` 0, `npm test` 0 (8 files, 165 tests), `npm run e2e` 0 (10 passed), `npm run db:generate` "No schema changes". New e2e spec repeated 5 times at each base path and `scripts/dev.test.ts` 5 times: all passed. `npm install` was not repeated (no dependency change).

## QA report
**Overall: PASS** (round 2, after rework). Node 18.20.8, npm 10.8.2, 2026-11-23. Round 1 failed AC6 (bug 1: 4xx `status` of any error trusted) and AC22 (bug 2: home page cancelled its health request); neither reproduces now.

Install, faults, dev, demo and probes were run in a scratch copy of the non-ignored files; test, lint, build and e2e also in the project with `DATABASE_URL=postgres://nobody@127.0.0.1:1/none`. Project source unchanged (checksums compared); nothing left running.

Commands: `npm install` 0, `npm ci` 0, `npm run build` 0, `npm run lint` 0, `npm test` 0 (8 files, 165 tests, 14 s), `npm run e2e` 0 (10 passed), `npm run db:generate` "No schema changes".

| AC | Result | Evidence |
|---|---|---|
| 1 | PASS | Copy without `node_modules`: `npm install` and `npm ci` exit 0, 0 `EBADENGINE` lines, lockfile unchanged |
| 2 | PASS | In the fresh copy, test before any build, then lint, build: exit 0; process list same before and after; `App.test.tsx` (Testing Library), `app.test.ts` (Supertest, migrated database) |
| 3 | PASS | Server and web: type error -> build 2, unused variable -> lint 1, failing assertion -> test 1. Also type and lint faults in `scripts/`. Reverted: exit 0 |
| 4 | PASS | Search finds only CLAUDE.md's own rule. "Kept" tests were never committed, so checked by presence only |
| 5 | PASS | 200 exact body; `pg` over the network protocol, database killed: 503 exact body in 5 ms, log has the code only; tests for throwing and hanging database pass |
| 6 | PASS | Own probe (109 tests, development and production, `/` and `/jettime/`): errors with status 400 to 503, 99, 1000 thrown, rejected, after an await, via `next`, from middleware, nested router, sub-app, plain object: always 500, no text, logged. `throw` of null, undefined, 0, '', 'route', 'router', symbol and others: 500, next handler never runs. Round 1 reproduction: 500. Malformed JSON, bad charset, bad gzip, oversized, `%ff`: 400/415/413 as before. 10 methods x 11 unknown paths x 4 base paths on the built server: 404 JSON. `next()`, `next('route')`, shared and nested routers, custom error handlers still work |
| 7 | PASS | Raw sockets, 20 traversal and file paths x 4 base paths: no outside content, no `X-Powered-By` |
| 8 | PASS | Deep pages 200 HTML; `/assets/missing.js` 404 text; `/api/*` JSON; `POST /foo` 404 |
| 9 | PASS | One build at `/`, `/jettime`, `/jettime/`, `/a/b.c`: page, every asset, favicon, API, deep link; `/jettime` redirects; outside the prefix 404; reload in e2e |
| 10 | PASS | Browser: 503, then aborted, then slow success: texts right, focus stays on the button, Enter repeats (3 requests); no overflow at 320 px |
| 11 | PASS | e2e and dev at both paths, reload and link home |
| 12 | PASS | One SQL migration; `db:migrate` over `pg`: "Applied 1", then "No pending"; `db:generate` adds no file |
| 13 | PASS | Project tests; own test: 20 locked increments give 20, 23505, 23502, rollback; data survives reopening (PostgreSQL 17.5) |
| 14 | PASS | Not needed |
| 15 | PASS | Test and e2e pass with the bad URL; checksums of dev and demo data same before and after; `.env`, `.data/*` git-ignored |
| 16 | PASS | Browser in a pseudo-terminal at `/` and `/jettime`: connected, page edit without document reload, server edit restarts the API (twice), inserted row still there after restart |
| 17 | PASS | From no data: one URL, "DEMO MODE", Ctrl+C exit 0; row kept on second run; with `DATABASE_URL` exit 1 |
| 18 | PASS | 11 missing or bad URLs through `npm start`: all exit 1, longest 6 s, `hunter2` in no output |
| 19 | PASS | Over the network protocol: exit 1 naming `npm run db:migrate`; starts after migrating. Not tested on a real PostgreSQL server (allowed) |
| 20 | PASS | 8 `PORT` and 6 `BASE_PATH` values, port in use (production, demo, dev): exit 1, named |
| 21 | PASS | Built server, SIGINT and SIGTERM with a stuck upload: exit 0 in 2.1 s; row present afterwards |
| 22 | PASS | 10 passed at both paths; round 1 reproduction (reload, deep link, back), 10 reloads, 20 in-app bounces and others: 100 of 100. 404, 500, console error, page error, failed request: all 10 fail as they should. Ctrl+C in mid-run and failed runs leave no server |

Regressions: Ctrl+C, double Ctrl+C, hangup and SIGTERM to npm in `npm run dev`: lock removed, nothing left running, no forced kill. `scripts/dev.test.ts` 4 of 4 runs. Undoing the guard fails 16 tests; undoing `ServerStatus.tsx` fails 3 unit tests and e2e with `ERR_ABORTED`.

**Other findings (not failures)**
- `bodyReader` covers only the shared JSON parser and is not exported. A body parser added to a single route (`express.text({ limit })`, upload parsers) answers 500 and logs instead of 413/400. Matters for uploads (011, 021).
- `kill -9` of the `npm run dev` command, even of its whole process group, now leaves the API running and holding the lock (disclosed for `kill -9` of the command). The next start reports the process id but does not exit; see the next point.
- `npm run dev` while the data folder is in use (second copy on another `PORT`): clear message, but the command waits instead of exiting.
- `api.param` callback that throws null: the route runs (disclosed). Do not use `param` callbacks for access checks (005).
- A route that throws a `URIError` carrying a 4xx `status` answers that status; contrived. An ordinary `URIError` gives 500.
- Still open from round 1, accepted: malformed JSON to an unknown API path answers 400; `/API/health` answers 200 HTML.

## PM acceptance
**ACCEPTED** (2026-11-23)

How this was judged: by reading the Spec, both rounds of notes, the QA report and the main source, tests, e2e and scripts. The PM had no way to run commands or a browser in this review, so evidence that something ran is QA's and the engineer's.

- **Goal met.** One npm project; one Node server serves the web app and the API; nothing but Node is needed for the demo; production is configured by environment variables, refuses to start without `DATABASE_URL` and never migrates by itself.
- **Criteria.** All 22 have passing evidence from QA round 2 (AC14 not needed). The code read agrees with it: health and status texts, error bodies, the 404 rules, base path, startup messages, migrations and the AC13 tests. Both round 1 bugs are fixed at the cause and have regression tests. No skipped tests, no leftovers from the old scaffold.
- **For 002 and 003.** The e2e fixtures start the server themselves and run every spec at both base paths; variable and command names are as specified.
- **Not proven, as the spec allows:** the app has never run against a real PostgreSQL server. Do not describe it as tested there. Lock contention between connections is also unproven (003).

Known limits accepted, none breaking a criterion; they should be carried into the named tasks when those are groomed or built:
1. 002 and later: specs that reload or navigate the document must wait for the page first, or the browser reports `ERR_ABORTED`.
2. 003: plan concurrency tests with PGlite's single connection in mind.
3. 004: do not pass untrusted text to `navigate` (React Router 6 finding); unexpected errors are logged in full, including query parameter values, so trim the log or keep secrets out of it.
4. 005: no access checks in `api.param` callbacks.
5. 011, 021: upload and other per-route body parsers must go through `bodyReader` (not exported yet), or refusals answer 500 instead of 413/400.
6. 023: test against JET's real PostgreSQL version with TLS; review the `npm audit` findings and moving off Node 18, which is past its end of life. The user should be told about both.
7. Development only: `npm run dev` waits instead of exiting when its data folder is in use, and `kill -9` of it leaves the API running. A clear message names the process. Worth a small fix if it gets in the way.
8. Malformed JSON to an unknown API path answers 400 rather than 404, and `/API/health` (capitals) answers with the web app. Both acceptable: the criteria do not say which wins in the first, and API paths are lower case.

## History
- 2026-11-23 created
- 2026-11-23 PM: groomed
- 2026-11-23 ORCH: todo -> groomed
- 2026-11-23 ORCH: groomed -> in-progress
- 2026-11-23 ORCH: back to todo; user moved the target from GitHub Pages to JET's own servers
- 2026-11-23 PM: groomed
- 2026-11-23 PM: groomed (aligned base path, page fallback and e2e with what 002 relies on)
- 2026-11-23 ORCH: todo -> groomed -> in-progress
- 2026-11-23 SWE: implemented
- 2026-11-23 ORCH: in-progress -> qa
- 2026-11-23 QA: fail (AC6, AC22)
- 2026-11-23 ORCH: QA FAIL (rejection 1 of 3), qa -> in-progress
- 2026-11-23 SWE: reworked
- 2026-11-23 ORCH: in-progress -> qa (rework 1)
- 2026-11-23 QA: pass
- 2026-11-23 ORCH: QA PASS, qa -> review
- 2026-11-23 PM: accepted
- 2026-11-23 ORCH: PM ACCEPTED, review -> done
