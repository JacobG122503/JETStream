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
_Software engineer fills this in._

## QA report
_QA tester fills this in._

## PM acceptance
_PM fills this in after QA passes._

## History
- 2026-11-23 created
- 2026-11-23 ORCH: request updated, user moved the target from GitHub Pages to JET's servers
- 2026-11-23 PM: groomed (two-factor split off to 026)
- 2026-11-23 ORCH: todo -> groomed
- 2026-11-24 ORCH: groomed -> in-progress
