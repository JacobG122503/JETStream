# 027 Rename the product to JETStream

## Request
Depends on: 004

User (2026-11-24): "also I would like to change this from Jet time to JETStream."

The product is renamed from "JET Time" to "JETStream" (one word, capitals J, E, T and S). It is still made by JET Engineering. Runs right after 004 and before 005, so that every later feature is built under the new name.

Orchestrator notes, for the PM to settle:
- Covers everything a person can see (page titles, brand, sign-in and waiting pages, emails, server messages, commands, docs) and the internal names that carry the old one: package name, session cookie, localStorage key, `/jettime` example base path in tests, theme start-up script. Nothing has been released, so no compatibility with the old names is needed; people with a local session just sign in again.
- Put the product name in one shared place where practical, so that a future rename is small.
- CLAUDE.md (heading and Brand rule) and the Requests and Specs of open tracker tasks switch to the new name. Finished tasks in `tracker/done/` and git history are records and stay as they are.
- Not changed: "JET Engineering", the `@jet.demo` demo accounts and their password, the mediumseagreen brand colour, the "Time" page (its name describes what it is for) and the project folder on disk.

## Spec
**Goal:** Everyone who meets the product, on screen, in an email, in the terminal or in the docs, sees "JETStream", and no trace of the old name is left for later tasks to copy. Nothing else about the product changes.

**User stories**
- As anyone at JET Engineering, I want to see the name JETStream everywhere, so that I know I am in the right app and the demo looks finished.
- As the owner, I want the name kept in one place, so that another rename would be small.

**Names**

"Old name" means "JET Time" in any case or joining (JET Time, jettime, jet-time, jet_time).

| What | From | To |
|---|---|---|
| Name in all text | `JET Time` | `JETStream` (exactly this: no space, capitals J, E, T, S) |
| Page titles | `<Page> \| JET Time` | `<Page> \| JETStream` |
| npm package name (`package.json`, both places in `package-lock.json`) | `jet-time` | `jetstream` |
| Session cookie | `jettime_session` | `jetstream_session` |
| Theme key in localStorage (`theme.ts` and `theme-init.js`) | `jettime.theme` | `jetstream.theme` |
| Example base path (tests, Playwright project, error text, comments) | `/jettime`, `/jettime/` | `/jetstream`, `/jetstream/` |
| Its near misses in tests | `/jettime2`, `/JETTIME/`, `/JetTime` | `/jetstream2`, `/JETSTREAM/`, `/JetStream` |
| Common-password list | `jettime123`, `jettime1234` | `jetstream1`, `jetstream123`, `jetstream1234` |
| Any other identifier with the old name that 004 ends up with | | same pattern, lower-case `jetstream` |

**Acceptance criteria**

1. **AC1** No old name is left. From the project root, this prints no file outside `tracker/done/`, this task file and, if it is not in `tracker/done/` yet, the 004 task file:
   `git ls-files -z -co --exclude-standard | xargs -0 perl -0777 -ne 'print "$ARGV\n" if /jet(\s|&nbsp;|_|-|<[^>]*>)*time/i'`
   It ignores case and also finds the name split over lines or by markup. No other exceptions: comments, tests, `docs/` and `CLAUDE.md` count.
2. **AC2** After `npm run build`, the same pattern finds nothing in any file under `dist/`.
3. **AC3** The name is spelled one way. A search ignoring case for `jet[ _-]?stream` in the files of AC1 finds, apart from `tracker/` files, only `JETStream` in text and the lower-case identifiers of the table, plus the two case-variant test paths. Code identifiers that cannot be written so (such as a constant `jetStreamName`) are avoided.
4. **AC4** In the browser: the tab title of every navigation page, the not-found page, the sign-in page and the error page ends in ` | JETStream`, and is `JETStream` in the HTML as served, before scripts run. The brand in the sidebar, the phone header, the drawer and the signed-out layout reads "JETStream" with "by JET Engineering" wherever that showed before.
5. **AC5** The brand name is on one line, not cut off, not overlapping and without horizontal page scroll at 320, 375 and 1440 px, in light and dark mode, signed in (including the open drawer) and signed out.
6. **AC6** Every message of 004 (invite, reset link, approved, declined, password changed, sign-up notice) says "JETStream" wherever it named the product, in subject and body.
7. **AC7** Terminal output that named the product says "JETStream": start-up line of `npm run demo` and `npm run dev`, demo-mode notice, start-up failures of the server and commands, the hint about the first administrator, and the message about a database folder in use.
8. **AC8** The name is a constant in one module under `src/shared/`, used by web, server and scripts. Outside that module, tests and comments, the literal `JETStream` is in no source file except `src/web/index.html`. An automated test fails if the title there differs from the constant.
9. **AC9** At least one test each for the page title, the brand, an email and the start-up line expects the literal text `JETStream`, not the constant, so a misspelled constant fails.
10. **AC10** Internal names are as in the table. After sign-in the only session cookie is `jetstream_session`, with the same attributes as in 004. Choosing Dark stores only `jetstream.theme`, and a reload shows dark from the first paint. The old cookie and key are neither read nor removed.
11. **AC11** The e2e check that `package.json` is not served (`e2e/smoke.spec.ts`, which searched for `jet-time`) still detects it: it looks for something that is in `package.json` but not in the app's HTML at either base path. The bare word `jetstream` is not enough, since the HTML holds the base path `/jetstream/`.
12. **AC12** `CLAUDE.md` changes only in its heading (`# JETStream`) and the Brand rule, which says "JETStream" by JET Engineering and drops the remark about the rename. Open tracker tasks other than this one and 004 do not contain the old name.
13. **AC13** Nothing else changes: "JET Engineering", `JET-001`-style codes, `@jet.demo` accounts and `jetdemo123`, colours, brand mark and favicon, the Time page (label, heading, `/time`), API routes, environment variables, npm script names and the `.data/` layout. `npm run db:generate` finds no schema change and no file in `drizzle/` changes. `package-lock.json` differs only in the two name lines. Files in `tracker/done/` are unchanged by this task (moving this task there at the end aside).
14. **AC14** `npm run lint`, `npm run build`, `npm test` and `npm run e2e` (both base paths) pass, with no test removed or skipped.

**Test scenarios**

1. `npm run demo`, open the app signed out: title and brand say JETStream, the terminal says "JETStream is running at ...". Sign in as each demo account: sidebar brand and `Time | JETStream`.
2. `BASE_PATH=/jetstream npm run demo`, signed in: `/jetstream` leads to `/jetstream/time`; `/jetstream2/`, `/JETSTREAM/` and `/api/health` give 404.
3. As administrator invite someone, as a visitor sign up and be approved: both captured messages name JETStream; the invite page says "... invites you to JETStream."
4. Edge: a browser that still holds `jettime_session` and `jettime.theme=dark`: sign-in page in the system's appearance, no error; signing in works.
5. Edge: at 320 px, open the drawer: brand as in AC5.
6. Failure: new password `jetstream123` or `JETStream1`: refused as too common. `jetstream river 9`: accepted.
7. Failure: `BASE_PATH=nope npm run demo`: non-zero exit, message starts with "JETStream:" and suggests `/jetstream`.
8. Failure (mutation, then undone): the constant set to `JetStream`, or the title in `index.html` set to something else: `npm test` fails. A copy of `package.json` put in the served web folder: the AC11 check fails.

**Out of scope:** new logo, colours or layout; renaming the project folder, the repository or JET Engineering; redirects or compatibility for old cookie, key or paths; text already stored in someone's local database (captured messages; `npm run demo:reset` gives a fresh one); git history and `tracker/done/`; name in features not built yet (they use the constant).

**Size:** S

**Assumptions**
- The package is `jetstream`, not `jet-stream`, because the name is one word. It is private and never published.
- The two old common passwords are replaced rather than kept, since the old name is unknown to anyone outside this project.
- The cookie and storage key may stay literals in their own modules; only the visible name has to come from the shared constant.
- Open tracker tasks other than 004 and this one do not contain the old name today, so AC12 should need no edits there.

## Implementation notes
**Open: `CLAUDE.md` is not changed (AC12, and its line in AC1).** The engineer's instructions allow changes to `CLAUDE.md` only on the user's own say, not on an agent's message. (An edit was made by script, then undone within the same session; the file equals HEAD.) Whoever may edit it has two edits to make:
- line 1: `# JET Time` becomes `# JETStream`
- line 25, Brand rule: remove ` (renamed from "JET Time" on 2026-11-24; the code is renamed in one go by task 027, until then existing code says "JET Time")`, so that it starts `- **Brand:** "JETStream" by JET Engineering. Primary colour ...`

Everything else is done.

**Files changed**
- New `src/shared/product.ts` (`productName`) and `product.test.ts`. Used by: `scripts/dev.ts`; server `main`, `server`, `migrate`, `demoData`, `adminCreate`, `db/dataDirLock`, `email/messages`, `people/firstAdministrator`; web `Brand`, `PlainLayout`, `useDocumentTitle`, `guards`, and the sign-in, invite, waiting, requests and gallery pages.
- Literals as in the table: `package.json`, `package-lock.json` (two lines), `auth/sessions.ts`, `theme.ts`, `theme-init.js`, `config.ts`, `commonPasswords.ts` (three lines rewrapped), `index.html`, `playwright.config.ts`.
- Comments and docs: `app.ts`, `db/schema/time.ts`, `calc/integers.ts`, `Icon.tsx`, `docs/data-model.md`, `e2e/fixtures.ts`.

**Acceptance criteria**
- AC1: the search prints `CLAUDE.md` (see above), this file and `tracker/done/`, nothing else.
- AC2: nothing in `dist/` after a build.
- AC3: outside `tracker/` only `JETStream`, `jetstream`, and once each `/JETSTREAM/` and `/JetStream` (tests).
- AC4: title tests in `App.test.tsx`, `AppShell.test.tsx`, `shell.spec.ts`, `brand.spec.ts` (signed-out pages, served HTML); brand in `AppShell.test.tsx`, `App.test.tsx`, `brand.spec.ts`.
- AC5: `brand.spec.ts`: 320, 375, 1440 px, light and dark, both base paths; signed out, header, open drawer, sidebar. One line, inside the window, not covered or cut off, no sideways scroll.
- AC6: new `email/messages.test.ts` has the literal subject and text of all six.
- AC7: `main.test.ts` (start-up line, demo notice, failures begin with `JETStream: `), `dev.test.ts`, `firstAdministrator.test.ts`, `database.test.ts` (folder in use).
- AC8: the literal is elsewhere only in `index.html`, tests and comments; `product.test.ts` compares the title.
- AC9: literals in the tests named under AC4, AC6 and AC7.
- AC10: `sessions.test.ts`, `auth.spec.ts` (exactly one cookie, its name), `theme.test.tsx`, `theme.spec.ts`.
- AC11: looks for `"devDependencies"`, and first that `package.json` holds it, so the check cannot go stale.
- AC12: open tracker tasks needed no edit; `CLAUDE.md` open, see above.
- AC13: `npm run db:generate`: no schema changes; `drizzle/` and `tracker/done/` unchanged.
- AC14: below.

**Commands run (2026-11-24)**
- `npm run lint`, `npm run build`: pass
- `npm test`: 49 files, 1340 passed, 16 skipped (before: 47 files, 1325 passed, the same 16 skipped)
- `npm run e2e`: 203 passed, 105 skipped (existing "once is enough" specs at the second base path)
- Mutations, undone: constant `JetStream`: 42 tests fail; other title in `index.html`: `product.test.ts` fails; `package.json` copied to `dist/web`: the smoke check fails at both base paths.
- Built server in demo mode at `/jetstream`: scenarios 2 and 4 as described, 4 at 320 px with a browser holding the old cookie and key, both left alone, no console errors. Scenario 7: exit 1, message as described.

**Assumptions:** cookie and storage key stay literals in their modules, as the Spec allows.

**Follow-ups:** none.

## QA report
**Overall: PASS** (2026-11-24). Everything was rerun by QA; runtime checks and mutations on a scratch copy of the working tree, Chromium, Node 18.20.8.

**Suites**
- `npm run lint`, `npm run build`: pass
- `npm test`: 49 files, 1340 passed, 16 skipped
- `npm run e2e`: 203 passed, 105 skipped, 0 failed, both base paths
- No line of the diff removes or skips a test (one assertion on the theme key became stricter).

| AC | Result | Evidence |
|---|---|---|
| AC1 | PASS | The command prints this file and `tracker/done/001` to `004` only. (perl also warns that the unstaged old `...in-progress.md` is gone; an effect of the rename of the task file.) |
| AC2 | PASS | Same pattern over every file in `dist/` after a build: nothing. |
| AC3 | PASS | Outside `tracker/`: `JETStream` 43, `jetstream` 70, `JETSTREAM` 1 (`app.test.ts`), `JetStream` 1 (`config.test.ts`), no other form. |
| AC4 | PASS | Browser, both base paths: all 11 sections, account, not found, team tabs, a person page, design pages and 5 signed-out pages end in ` \| JETStream`; also Loading and "Cannot reach the server". Served HTML at `/`, `/time`, `/sign-in`, `/no/such` and `/jetstream/time`: `<title>JETStream</title>`. Crash page: unit tests with the literal. Brand and "by JET Engineering" in sidebar, drawer, signed-out header; phone header name only, as before. |
| AC5 | PASS | Own measurement at 320, 375, 1023, 1024, 1440 px, light and dark, both base paths, signed out, header, open drawer, sidebar: one line, not clipped, no overlap with a control, `scrollWidth` = viewport. Screenshots looked at. See finding 1. |
| AC6 | PASS | Captured messages read from the database after the UI flow (invite, sign-up notice, approved): subject and body say JETStream. The other three: `messages.test.ts` literals, and the diff. |
| AC7 | PASS | Demo start-up, demo notice, `BASE_PATH`, missing `DATABASE_URL`, database folder in use (server and seed command), `admin:create` failure all seen in the terminal, beginning `JETStream: `. `npm run dev` and the first-administrator hint: the literal tests, which failed under mutation 8a. |
| AC8 | PASS | `grep JETStream` in `src`, `scripts`, `e2e`: constant, `index.html`, tests and comments only. Title mutation fails `product.test.ts`. |
| AC9 | PASS | With constant `JetStream` the title, brand (`App`, `AppShell`), email and start-up tests fail (42 in all). |
| AC10 | PASS | Cookie list after sign-in: only `jetstream_session` (httpOnly, Lax, path = base path, session). Dark stores only `jetstream.theme`; a reload has `data-theme="dark"` in the HTML at commit. Old cookie and key: left in place, no effect. |
| AC11 | PASS | `package.json` in `dist/web`: the smoke check fails at both base paths ("devDependencies"); passes again once removed. `"devDependencies"` is nowhere in `dist/web`. |
| AC12 | PASS | `git diff CLAUDE.md` is two lines: `# JETStream`, and the Brand rule `"JETStream" by JET Engineering. Primary colour ...` without the remark, otherwise unchanged. No other open task has the old name. |
| AC13 | PASS | `package-lock.json` differs in two name lines, `drizzle/` and `tracker/done/` unchanged, `db:generate`: "No schema changes", brand mark, favicon and CSS untouched, `Time` page and API routes unchanged in the diff. |
| AC14 | PASS | See Suites. |

**Scenarios:** 1 (three accounts, signed out), 2 (`/jetstream` to `/jetstream/`, then `/jetstream/time`; `/jetstream2/`, `/JETSTREAM/`, `/api/health` 404, also `/jettime/`), 3 ("JET Engineering invites you to JETStream.", both messages), 4 (light and dark system, no console errors, sign-in works), 5, 6 (`jetstream1`, `jetstream123`, `jetstream1234`, `JETStream1` refused; `jetstream river 9` accepted), 7 (exit 1, message as specified), 8 (both mutations and the AC11 one, undone): as expected.

**Findings (none blocks)**
1. Low: at 320 px signed in, the phone header is full. The name ends at 212.9 px and the avatar begins about 2 px further (10 px with the shorter old name), because the account button shrinks to 39 px, less than its content. Nothing overlaps at 320, so AC5 holds; at 305 px (320 px window with a classic scrollbar) they touch. Suggest a smaller gap or no caret at this width in a later UI task. The button was already narrower than its content before this task.

## PM acceptance
**ACCEPTED** (2026-11-24)

- The Goal is met: the product is called JETStream on screen, in messages, in the terminal and in the docs, and no old name is left for later tasks to copy.
- Checked by the PM by reading and searching the files: no old name outside `tracker/` or in `dist/`; `JETStream` only in the constant, `index.html`, tests, comments and docs; identifiers as in the table, with the two case variants only in tests; all six messages, the brand, titles and terminal output use the constant; the AC11 check in `smoke.spec.ts`; `CLAUDE.md` heading and Brand rule read as AC12 asks; 007 and 008 use the new name. Not run by the PM (no shell): the suites, the browser and the diffs; for these the QA report is the evidence, and it covers every criterion.
- The `CLAUDE.md` edit: by the orchestrator's account made because the user asked for the rename. Its content is what AC12 asks for. This acceptance is of the content and is not itself a permission for such edits.
- QA finding 1: accepted here, since AC5 holds at the widths it names (nothing overlaps or is cut off at 320 px) and changing the layout is out of scope. Too tight to leave: handed to 005, which works on the same header and is next, as part of AC22 (320 and 305 px, at least 8 px of room) with an engineer note.

## History
- 2026-11-24 created
- 2026-11-24 PM: groomed
- 2026-11-24 ORCH: todo -> groomed
- 2026-11-24 ORCH: groomed -> in-progress
- 2026-11-24 SWE: implemented, except the edits to CLAUDE.md (see Implementation notes)
- 2026-11-24 ORCH: made the two CLAUDE.md edits of AC12 (the user asked for the rename)
- 2026-11-24 ORCH: in-progress -> qa
- 2026-11-24 QA: pass
- 2026-11-24 ORCH: qa -> review
- 2026-11-24 PM: accepted
