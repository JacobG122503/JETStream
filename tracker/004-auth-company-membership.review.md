# 004 Sign-up, sign-in and company membership

## Request
Depends on: 002, 003

User: "Users must be able to create accounts and assign them to companies etc etc." and "For demo purposes have an admin account and a user account. Actually have two user accounts. A project lead and a regular employee. Then the admin of course. Admin will be like the billing worker or something of the like."
Sign-in page with one-click demo sign-in for the three accounts, sign-up, sign-out, password hashing (WebCrypto), change password, profile with photo and time zone, optional two-factor (TOTP). A new account either joins JET Engineering as a pending member that an admin approves, or accepts an admin invite link. Admins can assign a person to one or more client companies and their projects.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Server change: sessions, hashing (instead of WebCrypto in the browser), two-factor, invite and password-reset links, rate limiting and sign-out of other sessions are all server-side. Includes the setup command for the first production administrator. One-click demo sign-in exists only when demo mode is on.

Note from 001 PM: pass no untrusted text to `navigate`; unexpected errors are logged with query parameter values, so keep secrets out of URLs and logs.

## Spec
### Goal
People at JET Engineering can get an account, sign in safely and look after it themselves, while an administrator decides who is in, with which role, and on which client companies and projects. Nothing in JET Time can be read or changed without signing in, and a manager watching the demo can enter as any of the three demo people with one click.

### User stories
- As the person demoing, I want one-click sign-in as administrator, project lead or employee, so that I can show each view without typing passwords.
- As a new employee, I want to ask for an account or accept an invite link, so that I can start without someone typing my details.
- As the administrator, I want to approve or decline requests, invite people, help someone who forgot their password and assign people to client companies and their projects, so that only the right people see the right work.
- As any user, I want to change my password, see where I am signed in, sign out other devices and set my photo and time zone, so that my account stays mine.
- As JET's server administrator, I want a command that creates the first production administrator, so that no default password ever exists on the real system.

### Rules
- **Access levels** of an API route: public, signed-in (active person), administrator (active person whose role is the built-in Administrator). 005 replaces the role check with permissions, so it lives in one place.
- **Secrets** (passwords, tokens) never appear in a server-visible URL, a log, the activity log or a stored message. The database holds hashes only (003).
- **Links** (invite, password reset) have 256 random bits or more, carry the token only in the URL fragment, work once, and become void if the administrator who made them is no longer an active administrator.
- **Email.** This task adds one sender interface and one adapter, "capture", which stores the message in the Outbox table marked as captured and not sent, with the link replaced by "[link hidden]". SMTP and the Outbox screen are 018. With capture, the administrator copies a link shown once and hands it over.

### Configuration and commands (names fixed)
| Name | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | required in production; in dev and demo, the printed address | Address people use. Its path must equal `BASE_PATH`. Used for links and the origin check |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front (0 to 5) |
| `ALLOW_INSECURE_HTTP` | off | `true` allows an `http://` `PUBLIC_URL` that is not loopback in production |
| `npm run admin:create` | | First administrator, and password recovery for one (AC36-AC38) |

### Acceptance criteria
"Signed out page" means without the app shell, using 002's second layout. API paths are the engineer's, except where named.

**Sessions and request safety**
1. **AC1** Every API route declares one of the three access levels; a route without one makes `npm test` fail. A test lists all registered routes and shows: without a session, every non-public one answers 401 `unauthenticated`; as a Member, every administrator one answers 403 `forbidden`; as a pending person, every non-public one except session and sign-out answers 403 `pending_approval`. Only health, session status, sign-in, demo sign-in, sign-out, sign-up, forgot-password, and checking and using invite and reset links may be public. Unknown paths still answer 404 as in 001 AC6.
2. **AC2** A new random token (256 bits or more) is issued at each sign-in and password change; only its hash is stored. The cookie is `HttpOnly`, `SameSite=Lax`, `Path` equal to the base path, and `Secure` when `PUBLIC_URL` is https. No token or password is ever in browser storage or in readable cookies.
3. **AC3** Without "Keep me signed in": a browser-session cookie, ending after 12 hours without use or 24 hours in total. With it: 30 days without use, 90 days in total. The server enforces both, tested with a controlled clock. Last use is written at most once a minute per session.
4. **AC4** Status and role are read from the database on every request: once a person is archived, pending or loses the Administrator role, their very next request is judged accordingly. An archived person's request answers 401 and their sessions are removed.
5. **AC5** CSRF: a request that is not GET or HEAD, carries a session cookie, and lacks a valid token bound to that session is refused with 403 `csrf` and changes nothing. Any such request (also before sign-in) whose `Origin` is present and differs from the app's origin is refused; the app's origin is that of `PUBLIC_URL`, or in dev and demo also the `Host` it was sent to (so `localhost` and `127.0.0.1` both work). GET and HEAD never change business data. Routes with a JSON body refuse other content types with 415.
6. **AC6** If another person signs in in a second tab of the same browser, the first tab cannot act as them: its next change is refused, and it reloads as the new person with a message saying so.
7. **AC7** Every page and API response has a Content-Security-Policy with at least `default-src 'self'`, `script-src 'self'` (no `unsafe-inline` or `unsafe-eval`), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`; also `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin` or stricter. No page of the app logs a policy violation at either base path in either theme.
8. **AC8** Configuration: production without `PUBLIC_URL`, with one that is not an absolute http(s) URL, has a path different from `BASE_PATH`, or is http and not loopback without `ALLOW_INSECURE_HTTP=true`, and `TRUST_PROXY` outside 0 to 5, each exit non-zero naming the variable. A missing `DATABASE_URL` is still reported first. With insecure http allowed, every start prints a warning.
9. **AC9** Links never use the request's `Host`. `X-Forwarded-*` headers are ignored with `TRUST_PROXY=0`; with `1`, only the address added by the last proxy counts as the client.
10. **AC10** Logging: with a database error forced in sign-in, sign-up, invite, reset and change-password, and with duplicate-key errors, the server's output names the error and code but contains none of the email, password, token or other parameter values of the request. This applies to unexpected errors of all routes. Request bodies, cookies and fragments are never logged.
11. **AC11** Expired sessions, links and attempt records are removed at start and at least hourly while running, without delaying shutdown (001 AC21).

**Passwords and rate limits**
12. **AC12** Hashes use 003's format; a correct sign-in with older parameters rehashes. Hashing does not block the server: with 20 sign-ins in progress, `GET /api/health` answers within 1 second, and the 20 finish without an out-of-memory error.
13. **AC13** New passwords (everywhere, also the command) have 10 to 128 characters after Unicode NFKC normalisation, spaces allowed, no composition rules. Refused with a reason: fewer or more characters, one repeated character, the person's email or its local part, and any on a bundled common-password list that includes `password123`, `1234567890`, `qwertyuiop` and `jetdemo123`. The server decides; the form shows the rule beforehand.
14. **AC14** Failed sign-ins are limited to 5 per email and address in 15 minutes, 50 per address in 15 minutes, 30 per email in 1 hour. Beyond that, 429 `too_many_attempts` with `Retry-After`, even for the right password, and the page says when to try again. Success clears the first counter only. Existing sessions keep working. Current-password checks of a signed-in person are limited to 5 failures in 15 minutes.
15. **AC15** Limits are kept in the database (they survive a restart), hold for emails without an account alike, ignore email case, and cannot be beaten by parallel requests: of 20 simultaneous wrong attempts at most 5 reach password verification. An IPv6 address counts by its /64.
16. **AC16** Also per address: sign-up 20 per hour; forgot-password 10 per hour (and 3 per email per hour, beyond which the answer is unchanged and nothing is created); failed link checks 20 per 15 minutes.

**Sign-in and sign-out**
17. **AC17** Signed out, every app page except sign-in, sign-up, forgot-password, invite, reset-password, `/design` and `/design/plain` leads to sign-in, and no section content appears first. After sign-in the person lands on the page they asked for, including its query. The return address is accepted only if it is an in-app path; `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:alert(1)` and ones with control characters lead to `/`. A signed-in person opening sign-in is taken to `/`.
18. **AC18** Sign-in with a wrong password, unknown email, archived person, or person without a password all give 401 `invalid_credentials` and the same text, each after one full-cost hash computation (shown by a test counting them). Email ignores case and surrounding spaces. Correct credentials of a pending person show a "Waiting for approval" page with Check again and Sign out only.
19. **AC19** The session status route answers 200 whether or not signed in, so opening sign-in produces no console error or response of 400 or above (002 AC23). When a session ends during use, the next request leads to sign-in saying the session ended, and signing in as the same person returns to that page.
20. **AC20** In demo mode only, sign-in shows three labelled buttons (Administrator, Project lead, Employee, each with the person's name) and one activation of each signs in as that account, even after its password was changed. Outside demo mode (production and dev) no such buttons exist and the demo route answers 404, whatever the database holds or `ALLOW_DEMO_DATA` says. The server signs in only those three accounts, only when active, and only with 003's demo marker present. Starting demo mode on a non-loopback `HOST`, or production on a database with the demo marker, prints a warning.
21. **AC21** The header (002 AC14) has an account menu with photo or initials, name, role, "Account" and "Sign out". Sign-out deletes the session on the server (the old cookie answers 401), clears the cookie and all loaded data, and shows sign-in; Back then shows no data. Other tabs go to sign-in at their next request or when they regain focus.

**Sign-up and approval**
22. **AC22** Sign-up asks for name, email, password and time zone (default: company time zone). It creates a person with status pending, role Member, and a credential. For an address that already belongs to a person, or has an open invite, the answer is the same and nothing is created or changed; a message to that address says someone tried. The final page says an administrator must approve.
23. **AC23** An administrator can turn sign-up requests off and on (default on). Off, or while no active administrator with a password exists: the link is hidden, the page says so, and the API answers 403. Invites still work.
24. **AC24** An administrator sees the pending requests (name, email, date, and that the email address is not verified) with their number. Approve sets a role (Member preselected; Manager, Administrator) and optionally the assignments of AC33; the person is in at Check again. Decline, after confirmation, removes the pending person, credential and sessions, so that the address may be used again. Of two administrators deciding at once, one succeeds and the other is told it was already handled.

**Invites and password reset**
25. **AC25** An administrator invites by name, email, role and optional assignments. The link is shown once with a Copy button and is valid 7 days. The list shows open, expired, accepted and revoked invites with who and when, and offers Revoke and New link (which voids the old one). Invites for an active person with a password, an archived person, a pending request or an address with an open invite are refused with a specific reason. An active person without a password (as in the seed) can be invited; accepting adds a password to that person and creates no second one.
26. **AC26** Opening an invite shows company, email (fixed) and role, with name, password and time zone to fill in. Accepting makes the person active with that role and those assignments, in one transaction, and signs them in. Two simultaneous accepts: one succeeds. Clients or projects archived since are left out. Someone signed in as another person is asked to sign out first.
27. **AC27** Invite and reset pages remove the token from the address bar at once; the token is sent only in a request body. Opening or checking a link does not use it up. Unknown, used, expired, revoked and void links all answer the same 410 and show one page saying the link no longer works and whom to ask.
28. **AC28** Forgot-password answers the same for every address. For an active person it records a help request, which administrators see under People; none is recorded twice while open. The page says truthfully that an administrator will provide a link, and with an adapter that can deliver (tested with a stand-in), it sends the link instead and says an email was sent if the account exists.
29. **AC29** An administrator can create a reset link for an active person with a password, valid 1 hour, shown once with a Copy button and the advice to make sure who is asking. Making a new one voids the old and closes the help request. Using it sets the password, ends all that person's sessions, voids other reset links, and leads to sign-in.
30. **AC30** Messages are produced for invite, reset link, approved, declined, password changed and AC22's notice. With the capture adapter, no stored message contains a working link; with the stand-in adapter, the received invite and reset links work.

**Account**
31. **AC31** Profile: name (1 to 100 characters), time zone (an IANA zone known to the server, searchable), photo. Email and role are shown but not editable. A stale edit answers 409, keeps what was typed and offers to reload. Changing the password requires the current one, ends all other sessions, and renews this one. A sessions list shows browser and system, sign-in and last-use time in the person's time zone, marks "This device", and offers sign out for each and "Sign out everywhere else", with confirmation. No one can see or end another person's sessions here.
32. **AC32** Photo: PNG or JPEG up to 1 MB and 1024x1024 at the server; the page accepts larger PNG, JPEG and WebP up to 10 MB, lets the user see the square result, and shrinks before upload. The server judges content, not name or declared type: SVG, HTML renamed to `.png`, truncated or oversized files are refused with 400 or 413 and the old photo stays. Stored files contain no EXIF or text metadata. Photos need an active session, are served with a fixed image type, and can be removed (initials return).

**Assigning people**
33. **AC33** For any active person, an administrator can choose one or more client companies and, under each, some or all projects. Choosing a client assigns no project by itself; choosing a project assigns its client. Saving is one transaction with a stale check (409). Archived clients and projects are not offered; existing assignments to them are shown read-only.
34. **AC34** Removing a client, after a confirmation naming the projects affected, removes its project assignments. Logged time and expenses stay. A removed assignment keeps its stored rate and manager flag, so AC12 of 003 gives the same rate for existing entries before and after; assigning again restores them. The shared membership check used by later tasks treats removed as not a member.
35. **AC35** `/team` shows administrators tabs People (name, email, role, status, sign-in state: has password, invited, none; search), Requests, Invites and Help requests, and a person page with assignments. Others see "You do not have access to this page". Approve, decline, invite, revoke, reset link, sign-up switch, assignment and password changes are written to the activity log with who, whom and when.

**First administrator command**
36. **AC36** `npm run admin:create` runs from the production build, asks for name, email and password twice (hidden), and creates an active Administrator. `--name`, `--email` and `--password-stdin` work without a terminal; no option takes a password as an argument or environment variable. It uses `DATABASE_URL`, else the dev database (refused with `NODE_ENV=production`); pending migrations, an unreachable database or a data folder in use exit non-zero with a clear message and no password from the URL.
37. **AC37** It refuses if an active Administrator with a password exists, or the email belongs to anyone. Two at once: one succeeds. Neither migrations nor a start create a person. A production start without an administrator prints a hint naming the command.
38. **AC38** `npm run admin:create -- --reset <email>` sets a new password for an existing active Administrator (no other role), and ends their sessions, for a lone administrator locked out.

**Quality**
39. **AC39** All screens work by keyboard and at 320, 375 and 1440 px without page scroll sideways, pass the axe scan of 002 AC22 in both modes, and have loading, empty and error states. Forms use 002's fields and error summary, correct `autocomplete` values, allow paste and password managers, and have a show-password control. Submitting twice quickly acts once.
40. **AC40** 002's and 003's criteria still hold, with 002's specs run signed in where a section needs it. The e2e fixtures offer a signed-in page for each of the three demo accounts at both base paths, and allow two accounts at once in separate browser contexts. `npm run build`, `lint`, `test` and `e2e` pass; new tables are in `docs/data-model.md`.

### Test scenarios
1. Demo: `npm run demo`, press Employee: Time page as the employee. Sign out, press Administrator: header shows the administrator. `POST` the demo route in dev: 404.
2. Sign-up `New.Person@Example.com`, sign in as `new.person@example.com`: waiting page; any data route 403. Administrator approves as Member with one client and one of its projects: Check again opens the app; that project's membership exists.
3. Sign-up with `LEAD@jet.demo`: same answer and status as scenario 2; the lead's record and password are unchanged.
4. Invite `x@client.example` as Manager, copy link, open in a private window: address bar shows no token. Accept: signed in as Manager. Open again: "no longer works". A second invite revoked, a third opened 7 days and 1 minute later, a fourth whose creator lost the role: same page.
5. Return address: `/reports?x=1` signed out, then sign in: `/reports?x=1`. The five bad addresses of AC17: `/`.
6. Edge: sessions in browsers A and B; change password in A: B's next request 401, A continues. With the clock moved 12 hours and 1 minute without use: 401; at 24 hours and 1 minute with use each hour: 401.
7. Edge: 5 wrong passwords, then the right one: 429 with `Retry-After`; restart the server: still 429; after 15 minutes: signed in. 20 at once: at most 5 verified. With `TRUST_PROXY=0`, varying `X-Forwarded-For`: still limited.
8. Edge: project member with rate 150.00 and existing time: remove the client: rate result for that entry still 15000; not a member. Assign again: member, 15000.
9. Failure: `POST` change-password with the cookie and no CSRF token, with another session's token, with `Origin: https://evil.example`: 403, password unchanged. `Content-Type: text/plain`: 415.
10. Failure: Member calls approve, invite, reset-link, assignment and another person's session routes: 403 or 404, nothing changed.
11. Failure: passwords `short`, `aaaaaaaaaaaa`, `jetdemo123`, own email, 129 characters: refused. 10 characters, 128 characters, `correct horse battery`: accepted.
12. Failure: photo uploads: SVG, HTML named `a.png`, 2 MB JPEG, truncated PNG, 5000x10 PNG: refused. JPEG with GPS EXIF of allowed size: stored without it.
13. Failure: `admin:create` with an administrator present; `--reset` for a Manager; `--email` without a terminal and without `--password-stdin`; `DATABASE_URL=postgres://u:hunter2@127.0.0.1:1/x`: non-zero, no `hunter2`.
14. Failure: `Host: evil.example` on forgot-password and invite with the stand-in adapter: links start with `PUBLIC_URL`.

### Out of scope
- Two-factor sign-in: split off to 026. Single sign-on and API tokens: 025.
- Permission catalogue, custom roles, changing the role of an active person, hiding navigation by role (005).
- Creating people without an invite, editing email, archive and restore, capacity, rates, full team list (008). Assignment with rates and manager flag, and the same from the project side (007).
- SMTP delivery, Outbox screen, templates, notifications (018); activity log screen (022).
- Proxy examples, HSTS, hardening guide (023). Encryption inside the database. CAPTCHA.

### Assumptions
- Sign-up makes a request to join JET Engineering; there is one company per installation. "Assign them to companies" means client companies.
- Without email delivery an address cannot be verified, so approval by an administrator is the check. Someone who signs up and then tries that password can tell whether the address was free; accepted, since it is limited and later visible to the administrator.
- People cannot change their own email (an unverified change could take over an identity once 025 matches by email); 008 lets administrators do it.
- An administrator, not the Outbox, hands over links while nothing is configured: storing working links in a readable Outbox would let any reader take over accounts.
- A limit per email can be used to hold someone up for an hour; accepted over unlimited guessing.
- Limits, durations and the 10-character minimum are PM choices. `PUBLIC_URL` becoming required changes 001's production start on purpose; its tests are updated, not weakened.
- WebCrypto in the first paragraph of the Request is superseded by the server change; "password hashing" means 003's memory-hard hash.

### Notes for the engineer
- Upload and other body readers must go through 001's `bodyReader` (not exported yet), or refusals answer 500. No access checks in `api.param` callbacks.
- Vite's dev proxy puts the API on another port: `npm run dev` must hand the API its public address.
- The e2e server runs on `memory://`, which 003's commands cannot seed from outside; seeding must not make each worker slow.
- Sign-in should allow a second step between password and session, so that 026 does not rewrite it.
- HTTPS cookies, proxies and a real PostgreSQL cannot be run fully here: test through the app with settings, and report what was not tried.

### Size
L (upper end), after splitting off 026 (two-factor). Build order: configuration and headers, sessions and access levels, sign-in and demo, command, account, sign-up and links, People screens.

## Implementation notes
Done (2026-11-24, finished in a third session after two interruptions).

**Files changed and why**
- Configuration and headers: `src/server/config.ts` (`PUBLIC_URL`, `TRUST_PROXY`, `ALLOW_INSECURE_HTTP`, warnings), `headers.ts`, `context.ts`, `app.ts`, `server.ts`, `main.ts` (warnings, cleaning up, no raw errors printed), `errors.ts` (`describeError`: names, codes, places only).
- Sessions and access: `src/server/auth/` (`access.ts` access levels, CSRF and origin; `sessions.ts`; `tokens.ts`; `limits.ts`; `clientAddress.ts`; `signIn.ts`, in two steps for 026; `cleanUp.ts`). `isAdministrator` in `sessions.ts` is the one place 005 replaces.
- API: `src/server/api/router.ts`, `body.ts` (`bodyReader`, JSON only), `input.ts`, `routes/`.
- People: `src/server/people/` (sign-up and approval, invites, resets, account, photo, assignments, `membership.ts` as the shared check for later tasks, first administrator), `src/server/email/` (sender interface, capture adapter, wording), `security/passwordPolicy.ts`, `commonPasswords.ts`.
- Command: `src/server/adminCreate.ts`, `scripts/admin-create.mjs`, `package.json`. Demo: `demo/marker.ts`, `demo/accounts.ts` (split so that production loads no demo data).
- Database: `drizzle/0003_sign_in.sql` (table `help_requests`; `invites.token_hash` may be null once a link is dead), `docs/data-model.md`.
- Web: `src/web/api.ts`, `auth/` (provider, guards, return path, forms), `pages/auth/`, `pages/account/`, `pages/team/`, `shell/AccountMenu.tsx`, `routes.tsx`, `ui/CopyField`, `ui/Notice`, show-password field.
- `scripts/dev.ts`: the API is told the address of Vite and receives the browser's own Host, so `localhost` and `127.0.0.1` both work.
- No new dependencies.

**Acceptance criteria**
- AC1, AC4, AC5: `auth/access.ts`; a route without a level stops the server and the tests (`auth/access.test.ts` lists all routes). Judged from the database on each request (`sessions.test.ts`).
- AC2, AC3, AC11: `auth/sessions.ts`, `cleanUp.ts` (at start and every 30 minutes) (`sessions.test.ts`, controlled clock).
- AC6, AC17, AC19, AC21: `web/auth/`, `AccountMenu` (`auth.test.tsx`, `returnPath.test.ts`, `e2e/auth.spec.ts`).
- AC7: `headers.ts`; e2e fails on any console message, at both base paths (`auth.spec.ts`, `smoke`, `theme`).
- AC8, AC9: `config.ts`, `clientAddress.ts`, `people/links.ts` (`config.test.ts`, `main.test.ts`, `signIn.test.ts`, `joining.test.ts`).
- AC10: `describeError`, `api/logging.test.ts`.
- AC12, AC13: `security/` (at most 2 hashes at once) (`passwords.test.ts`, `passwordPolicy.test.ts`, `signIn.test.ts`).
- AC14, AC15, AC16: `auth/limits.ts`, attempts counted before they are made, under a lock (`signIn.test.ts`, `joining.test.ts`, `account.test.ts`).
- AC18, AC20: `auth/signIn.ts`, `routes/session.ts` (`signIn.test.ts`, `dev.test.ts`, e2e).
- AC22-AC24: `people/requests.ts`, `RequestsPanel`. AC25-AC27: `people/invites.ts`, `InvitesPanel`, `InvitePage`. AC28, AC29: `people/resets.ts`, `HelpPanel`, `ResetLink`. AC30: `email/` (all in `joining.test.ts`, `team.test.tsx`, e2e).
- AC31, AC32: `people/account.ts`, `image.ts` (own PNG and JPEG reader that rewrites the file), `pages/account/` (`account.test.ts`, `image.test.ts`, `account.test.tsx`, e2e).
- AC33-AC35: `people/assignments.ts`, `membership.ts`, `pages/team/` (`assignments.test.ts`, `team.test.tsx`, e2e).
- AC36-AC38: `adminCreate.ts`, `people/firstAdministrator.ts` (`firstAdministrator.test.ts`).
- AC39, AC40: `e2e/accessibility.spec.ts` (axe in both modes at 375 and 1440, no sideways scroll at 320, 375, 1440), `e2e/fixtures.ts` (`account` option; `adminPage`, `leadPage`, `employeePage`).

**Commands run in the last session (Node 18.20.8), all exit 0**
- `npm run lint`; `npm run build`
- `npm test`: 46 files, 1304 passed, 16 skipped (003's concurrency tests that need `TEST_DATABASE_URL`)
- `npm run e2e`: 189 passed, 105 skipped (specs that run at one base path only)
- By hand: `npm run dev` (changes from `localhost` and `127.0.0.1`, foreign origin 403, demo route 404); `node dist/server/adminCreate.js` in a pseudo-terminal (hidden input, differing passwords, create, refuse second, `--reset`); screenshots of sign-in, account menu, account, team and person at 375 and 1280.

Fixed in the last session: changes refused in development when opened as `http://localhost` (Vite rewrote Host; test added in `scripts/dev.test.ts`); the sign-up switch lost keyboard focus while saving; three e2e specs that had wrong expectations (Back into an empty tab, a switch that moves only after the server agrees, a gallery spec needing to be signed in).

**Rework after QA fail 1 (2026-11-24)**
- An earlier version of these notes called the gap between checking a password and making the session "milliseconds". That was wrong: it was the whole verification, and anyone with the old password could use it at will.
- Bug 1 (AC29, AC31, AC38): `checkSignIn` now gives a proof (person and version of the password checked). `beginSession` makes the session in one transaction that locks the person and refuses (the same 401 as a wrong password) if they are archived or gone or the password version differs; for a demo account, if it is not active. All that ends sessions locks the person first (own change, reset link, `--reset`; archiving is an update of that row), so it comes wholly before or after; as locks and version are in the database, this also covers the separate process.
- `person_credentials.version` (migration `0004_password_version.sql`) counts up with each new password, and by default with any other write; renewing the hash of the same password keeps it, so the server's own rehash ends neither a sign-in nor a change. A rehash writes only over the very hash that was checked (already so).
- Changing the password: refused with 401 if the session ended or the person is no longer active meanwhile, with 409 if the password version is no longer the one that was checked. Before, a session that had been ended could still finish its change.
- Accepting an invite for an existing person locks that person and checks again (archived, or given a password, meanwhile: 410).
- Finding 2: a PNG with anything after its compressed stream is refused; a palette in a picture that does not need one and transparency of a wrong size are dropped, since they could carry text too.
- Findings 1, 3, 4 and 5 are left to the PM.
- Tests: `auth/signInRaces.test.ts` (21) holds a hash computation open across a password change, a reset link, `--reset` (its function, in the same process), archiving and declining, for sign-in, rehash, password change and invite; with the check taken out 10 of them fail. `image.test.ts` extended.
- Run: `npm run lint` 0, `npm run build` 0, `npm test` 0 (47 files, 1325 passed, 16 skipped), `npm run e2e` 0 (189 passed, 105 skipped). QA's `race-http.mjs` against the built server: 0 of 5 survive; `race.mts 12`: 0 of 12. A copy of `.data/demo` migrates, and signing in works.

**Not tried**: a real PostgreSQL (advisory locks and row locks ran on PGlite only, which runs one transaction at a time, so true parallelism across connections is not shown), HTTPS cookies in a browser, a real reverse proxy, Windows, browsers other than Chromium. `npm run admin:create` uses the build only where development tools are not installed (as `db:migrate` does); the built file was run directly. `npm run demo` itself was not started; the same build and mode runs in e2e and by hand with an in-memory database.

**Assumptions and limitations**
- In development Vite serves the pages, without the Content-Security-Policy (it needs inline scripts); API answers have it.
- Reloading an invite or reset page loses the token, which is only in memory: the page says to open the link again.
- An invite is also void while its maker is not an active administrator and works again if they become one before it expires or is replaced.
- JPEG is checked by its structure, not by decoding every pixel.

**Follow-ups**
- 026: keep the `SignInProof` (person and password version) between the steps and pass it to `beginSession`, which checks it again.
- 008: archiving must lock the person (an update of the row does) and call `endSessions` in the same transaction; until then an archived person's sessions are removed at their next request, so one that is not used in between would work again after a restore.
- 027: the cookie name `jettime_session` and message texts carry the old name.

## QA report
Second pass, for the version after "Rework after QA fail 1". The first pass failed on AC29 and AC31 (Bug 1: a sign-in with the old password under way survived a password change or reset).

**Overall: PASS**

Environment: macOS, Node 18.20.8, Chromium (Playwright), 2026-11-24. No real PostgreSQL server, HTTPS or proxy.

**Suites (run by QA):** `npm run lint` exit 0; `npm run build` exit 0; `npm test` exit 0: 47 files, 1325 passed, 16 skipped (need `TEST_DATABASE_URL`); `npm run e2e` exit 0: 189 passed, 105 skipped (one base path only). All throwaway API and browser scripts of the first pass run again: 179 API checks, 68 browser checks, ten logging cases, no difference but the fixes (axe `region` on the brand as before).

**Rig for separate processes:** the folder lock keeps `admin:create` out while a server has an embedded database open (seen: exit 1 "in use by process"), so there the race cannot happen. With `DATABASE_URL` it can, so QA put PGlite behind a small server for the PostgreSQL protocol, outside the repository, and ran the built production server (`PUBLIC_URL=https://...`, `TRUST_PROXY=1`), `db:migrate` and the built command against it as real processes through `pg`. It runs one transaction at a time, so transactions interleaving inside PostgreSQL are still not shown; the locks were reviewed for that (person locked first everywhere that ends sessions; the version is read in a later statement; no lock order cycle found).

#### Bug 1: fixed
| Case | Result |
|---|---|
| First pass reproductions (`race-http.mjs`, `race.mts`) | 0 of 5, 0 of 20 survive (were 5 of 5, 12 of 12) |
| `admin:create --reset` as a second process, three sign-in loops | 0 of 9 survive; each time sign-ins under way get 401, the new password works |
| Own password change, production mode, three loops | 0 of 3 survive |
| Same rig, copy of the source with the new check taken out | 3 of 3 survive, all three loops: the rig finds the bug |
| Old hash format, 8 sign-ins arriving during the change, 14 runs | change 200, all 112 sign-ins 401, new password works, old one does not, new hash stays |
| Old hash format, sign-ins first, 14 runs | all 200, then ended by the change; the rehash does not make the change fail |
| Intruder's change in flight against a reset link, 14 runs | reset first: late change 401, victim's password valid (10); change first: link 410 (4) |
| Archiving against 3 sign-ins, 14 runs; restored afterwards | no session left or alive |
| Archiving against a password change, 14 runs | change 401, old password stays |
| Invite for an existing person: two accepts, or archived meanwhile, 14 runs | 200 and 410; 410 and 410 without credential; never a second person |
| Demo sign-in against archiving, 120 sign-ins | 200 or 403 `demo_unavailable`, none alive afterwards, no 5xx |
| Three sign-ins at once with one cookie | all 200, no 5xx |

The 21 new tests in `signInRaces.test.ts` were tried on a copy with parts taken out: check in `beginSession` (10 fail), hash condition of the rehash (3), version kept by the rehash (2), version check of the change (1), session check of the change (2). Not covered: the second look at an invite after locking the person, which the embedded database cannot show.

**Migration 0004:** a database at 0003 (the demo of the first pass) has 1 pending, then 0; hashes unchanged, version 1, not null; a second run changes nothing. A copy of `.data/demo` at 0000 goes to 0004 and signing in works. `admin:create` on a pending database is refused with the message. `npm run demo` on it migrates, serves, stops.

**PNG change:** all 12,738 real PNG files found on this machine within the limits (colour types 0, 2, 3, 4, 6, depths 1 to 16, interlaced or not; 96 Apple CgBI files are not standard PNG) are accepted. 86 made ones (every type and depth, interlaced, transparency, suggested palette, IDAT in single bytes, empty IDAT, level 0 and 9, small window, sizes at zlib buffer boundaries): all accepted but two that are over 1 MB; all 84 decode in Chromium to the same pixels before and after. Same result on Node 23.7. The bytes after the compressed stream are now refused with 400.

| AC | Result | Evidence |
|---|---|---|
| AC1 | PASS | `access.test.ts` lists all routes; own sweep: pending 403 `pending_approval` on 5 routes, Member 403/404 on 12, signed out 401; HEAD, trailing slash, double slash, upper case, method override give no way around |
| AC2 | PASS | Cookie `HttpOnly; SameSite=Lax; Path` = base path, `Secure` with https; new at sign-in and password change (old cookie 401); no raw token in `sessions`, `invites`, `password_resets`; browser storage and `document.cookie` empty |
| AC3 | PASS | 12 h 1 min idle 401; hourly use, 24 h 1 min 401; keep: 30 days less 1 min 200, then 30 days 1 min 401, cookie 90 days; last use unchanged after 30 s, written after 66 s |
| AC4 | PASS | Demoted administrator 403 on the next request, archived 401 and sessions removed |
| AC5 | PASS | No token, empty, another session's: 403 `csrf`, password unchanged; six foreign or odd origins incl. `null`, other port and scheme: 403; `Host: evil.example` with the same Origin in production 403; demo and dev accept `localhost` and `127.0.0.1`, refuse `evil.example`; five other content types 415 |
| AC6 | PASS | Browser: other person signs in in tab 2, saving in tab 1 is refused, administrator not renamed, tab 1 shows the new person and the message. Same person after a password change in another tab: the save goes through |
| AC7 | PASS | All three headers on pages, assets, 302, 401, 404, `/%ff`; policy as required; no console message in browser runs in light and dark (not in dev pages, see below) |
| AC8 | PASS | All cases exit 1 naming the variable; `DATABASE_URL` first; `http://127.0.0.1.evil.test` not taken for loopback; warning covered by `config.test.ts` |
| AC9 | PASS | Links begin with `PUBLIC_URL` under hostile `Host` and `X-Forwarded-Host`; `TRUST_PROXY=0` ignores `X-Forwarded-For`; `1` counts only the last address |
| AC10 | PASS | Ten tables renamed away in turn, nine requests each: 500s logged with names and places, 0 leaks of name, email, password, token or cookie |
| AC11 | PASS | `cleanUp` leaves 0 sessions, attempts and resets; runs at start and each 30 minutes (`cleanUp.ts`); e2e and demo stop in time |
| AC12 | PASS | 20 sign-ins under way on the built server: slowest health answer 17 ms, all 20 finished in 1.9 s; rehash covered by `signIn.test.ts` |
| AC13 | PASS | 18 passwords incl. full-width `jetdemo123`, upper case, 10 spaces, 10 emoji, 129 refused, 10, 128 and `correct horse battery` accepted; command refuses `jetdemo123` |
| AC14 | PASS | 5, 50 and 30 limits exact; right password 429 with `Retry-After`; 15 minutes later in; success clears the first only; sessions go on; current password 5 then 429; page: "Try again in 15 minutes, at 7:59 PM" |
| AC15 | PASS | 20 at once: 5 times 401, 15 times 429, in the app and over HTTP; still 429 after a restart; email case and spaces ignored; unknown email alike; IPv6 by /64 |
| AC16 | PASS | 20, 10 and 20 exact; third forgot per email is the last to create anything |
| AC17 | PASS | Five deep links came back with query; 12 bad addresses stayed in the app (the spec's at `/`, which leads to `/time`); signed in, sign-in leads to `/` |
| AC18 | PASS | Five kinds of failure byte-identical; hash count by `signIn.test.ts`; waiting page has Check again and Sign out only (besides the appearance menu) |
| AC19 | PASS | No console problems on sign-in; cookie removed: "Your session has ended", same person back to the page |
| AC20 | PASS | Three buttons work, also after a password change; dev and production 404, also on a seeded production database; 403 without the marker; both warnings seen |
| AC21 | PASS | Menu, old cookie 401, Back shows sign-in without data, other tab goes to sign-in on focus |
| AC22 | PASS | Scenarios 2 and 3: same answer for taken and invited addresses, credential unchanged, notice without the stranger's text |
| AC23 | PASS | Switch off 403 and `signUpOpen` false; no administrator: 403, page says so, no link |
| AC24 | PASS | Browser and API; approve against decline at once: 200 and 409 `already_handled`; address free after decline; approve and decline of an active person 409 |
| AC25 | PASS | Four specific refusals; new link voids the old; person without a password gets one, no second person |
| AC26 | PASS | Two at once: 200 and 410; project archived since left out; sent `roleId`, `email`, `status` ignored; signed-in person asked to sign out |
| AC27 | PASS | Address bar clean, token in no URL, referrer, storage or history state; three checks do not use it up; used, unknown, null, revoked, expired (7 d 1 min), void, replaced: identical 410 |
| AC28 | PASS | Same answer, help request once, truthful text; stand-in sends the link |
| AC29 | PASS | Bug 1 gone: 0 of 10 survive a reset under a sign-in loop; a late password change by an intruder is refused (401) when the reset came first, 14 runs. 1 hour, one use at once, old void, advice shown |
| AC30 | PASS | Outbox rows hold "[link hidden]" only; stand-in links work |
| AC31 | PASS | Bug 1 gone: 0 of 10 in the app, 0 of 5 over HTTP in demo mode, 0 of 3 in production mode. Two changes at once: one 200, one 401, one password valid. Stale 409 keeps the text and offers reload, renewed cookie, device list, confirmation, others' sessions 404, email and role in the body ignored |
| AC32 | PASS | 10 bad files, 2 MB, gzip bomb, IDAT bomb refused, old photo stays; real JPEG with EXIF, XMP, comment and trailer stored without; 401 signed out; a file that is not a photo 404; 3000x2000 JPEG, WebP, PNG saved as 512x512; PNG rework below |
| AC33 | PASS | Client alone assigns no project, project assigns client, two saves at once 200 and 409, archived refused and not offered, unknown id 400 |
| AC34 | PASS | Rows keep manager flag through removal and back; rate 15000 by `assignments.test.ts`; confirmation names the project |
| AC35 | PASS | Tabs, search, person page; Member sees "You do not have access to this page" on `/team` and `/team/1`; log entries found, without secrets |
| AC36 | PASS | Scenario 13, `--password=...` not repeated, hidden input in a pseudo-terminal, missing migrations, folder in use, no `hunter2` |
| AC37 | PASS | Refuses with an administrator present; two processes at once: one created, one refused, on a data folder and over `DATABASE_URL` with `NODE_ENV=production`; start creates nobody; hint shown |
| AC38 | PASS | Works for the administrator, refuses the Manager, an unknown email and a weak password; racing as a second process: 0 of 9 runs leave a session (see below) |
| AC39 | PASS | axe at 320 and 1440 in both modes on 11 pages with all rules: only the best-practice `region` on the brand, already there in 002; no sideways scroll, also with a 95-character name; triple Enter and double click send once; keyboard order right |
| AC40 | PASS | Suites above; `docs/data-model.md` has `help_requests` |

#### Other findings (not blocking)
1. Low, unchanged, for the PM: a link that was void because its maker lost the role works again when they get it back within its life.
2. Low, unchanged: the invite list shows when an invite was revoked, but not by whom (the activity log does).
3. Low, unchanged: successful sign-ins, and so sessions per person, are not limited.
4. Low, new: two password changes at once from one browser: the second is told "Sign in first" though the person is signed in. Nothing is lost.
5. For 008, as noted by the engineer: archiving must end the sessions itself; now they end at the next request only.
6. Info: in development Vite serves pages without the policy; demo links begin with `http://0.0.0.0` with that `HOST` unless `PUBLIC_URL` is set.
7. Not tried, as for the engineer: interleaved transactions on a real PostgreSQL, HTTPS, a real proxy, other browsers.

## PM acceptance
**ACCEPTED** (2026-11-24)

The Goal is delivered and every criterion has passing evidence from QA. Bug 1 is closed where it matters: what a sign-in proved is checked again in the transaction that makes the session, and QA showed that its rig finds the bug when the check is taken out. I read the code of sign-in, sessions, access levels, invites, resets and the invite screens against the spec; I could not run the app and rely on QA for behaviour.

QA's findings:
1. Void link works again after its maker is re-promoted: accepted here. The Links rule and scenario 4 are met at all times while the maker is not an active administrator, 004 has no way to demote, archive or restore anyone, and the list shows such an invite with Revoke. It must not stay so once there is one (demoted over misuse, old link alive again later). So 005 AC14 now makes void through lost access final, with a scenario, and 008 AC18 the same for archive and restore.
2. Who revoked an invite: accepted. AC25 is met by who invited and when, plus the time it was revoked; the activity log has the rest. Added to 008 AC9.
3. Successful sign-ins and sessions not limited: accepted, since each needs the right password, hashing is bounded and sessions expire. Named in 023's note.
4. "Sign in first" for the second of two simultaneous password changes: accepted. One wins, nothing is lost, and the form itself sends once.
5. Archiving ends sessions at the next request: meets AC4. 008 AC18 already ends them in its transaction; how, and a test for a session not used in between, were added there.
6. No policy on Vite's development pages, `0.0.0.0` links: accepted; AC7 is met by what the server serves. Handed to 023.
7. Not tried (real PostgreSQL, HTTPS, proxy, other browsers): expected by this spec, reported honestly. Handed to 023.

Engineer's follow-up for 026 was added to that task; the cookie name and message texts are in 027.

## History
- 2026-11-23 created
- 2026-11-23 ORCH: request updated, user moved the target from GitHub Pages to JET's servers
- 2026-11-23 PM: groomed (two-factor split off to 026)
- 2026-11-23 ORCH: todo -> groomed
- 2026-11-24 ORCH: groomed -> in-progress
- 2026-11-24 ORCH: implementation interrupted by usage limit, resumed
- 2026-11-24 ORCH: resumed in a new session; product rename to JETStream queued as 027, not part of this task
- 2026-11-24 SWE: implemented
- 2026-11-24 ORCH: in-progress -> qa
- 2026-11-24 QA: fail (AC29, AC31)
- 2026-11-24 ORCH: qa -> in-progress (QA fail 1: AC29, AC31)
- 2026-11-24 SWE: reworked (QA fail 1)
- 2026-11-24 ORCH: in-progress -> qa
- 2026-11-24 QA: pass (second pass, after rework)
- 2026-11-24 ORCH: qa -> review
- 2026-11-24 PM: accepted
