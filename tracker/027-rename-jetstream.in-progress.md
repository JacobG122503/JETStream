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
_Software engineer fills this in._

## QA report
_QA tester fills this in._

## PM acceptance
_PM fills this in after QA passes._

## History
- 2026-11-24 created
- 2026-11-24 PM: groomed
- 2026-11-24 ORCH: todo -> groomed
- 2026-11-24 ORCH: groomed -> in-progress
