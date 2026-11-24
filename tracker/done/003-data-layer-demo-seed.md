# 003 Data layer and demo seed

## Request
Depends on: 001

Domain model as a PostgreSQL schema with migrations, constraints and indexes, a repository/service layer, shared pure calculations, and a realistic deterministic demo seed relative to today's date: JET Engineering, several fictional client companies with contacts, projects using every billing and budget type, tasks, about ten people, several months of time entries and expenses, and invoices and estimates in various states. Seed and reset are explicit commands, refused in production by default. Concurrency and transaction rules for billing.

Overall goal: cover the data needed by tasks 004 to 022 and 025, within the product rules in CLAUDE.md.

## Spec
### Goal
JET's records have one trustworthy home: a PostgreSQL schema that later tasks fill with features, shared calculations that give the same money figures everywhere, and billing rules that make it impossible to invoice the same work twice. One command gives a believable, current-looking JET Engineering to demo, and it cannot end up in a production database by accident.

### User stories
- As the billing manager, I want every hour and expense billed at most once, at the rate in force when it was billed, so that clients are charged correctly.
- As the person demoing to a manager, I want realistic data dated around today, so that every screen has something meaningful to show.
- As JET's server administrator, I want demo data and reset commands to refuse on real data, so that a wrong command cannot leak a known password or erase records.
- As a developer of 004 to 022 and 025, I want the tables, guards and calculations in place, so that features agree with each other.

### Data rules
- **Units.** Time: integer minutes. Money: integer minor units with an ISO 4217 currency (exponent respected: USD 2, JPY 0). Percentages, quantities: integer thousandths (8.25% = 8250, 1.5 = 1500). Expense unit prices: thousandths of a minor unit (65.5 cents per mile = 65500). Exchange rates: integer millionths. No floating-point column for any of these.
- **Dates.** Business dates are `date`, read and written as `YYYY-MM-DD` strings; instants are `timestamptz`.
- **Versions.** Every record people edit has an integer `version`, used for stale-edit checks.
- **Rates.** Time entries store no rate. Person billable and cost rates are dated. Invoice lines store the billed rate; each link from a line to a time entry also stores the billed minutes, rate and amount; each link to an expense stores the billed amount.
- **Approval.** Each time entry and expense has its own status (unsubmitted, submitted, approved, rejected), because one week can span several leads. A weekly submission record per person holds period start and end, status, comment, who decided and when.
- **Secrets.** Passwords are stored only as salted hashes. Session, invite, reset, client-link and API tokens are stored only as hashes. The TOTP secret and webhook secret columns hold ciphertext only (encryption comes with 004 and 025).
- **Files.** Uploaded content (receipts, photos, logo) lives in the database with name, media type, size and owner, so one database backup is complete.

### Schema coverage
Exact table and column names are the engineer's. Each item needs somewhere to be stored with keys, foreign keys and checks.

| Task | Must be storable |
|---|---|
| 004 | People (unique email ignoring case, status pending/active/archived, employee/contractor, weekly capacity, time zone, photo), credentials, TOTP and recovery codes, sessions, invites, password resets, sign-in attempts, person-to-client assignment |
| 005 | Roles (built-in flag, permission list), one role per person, manager-to-person assignment |
| 006 | Clients (address, currency, tax defaults, terms, notes, archived), contacts |
| 007 | Tasks (default billable and rate, common, archived); projects with every type, rate method and budget option in the 007 request; project tasks and project members (rate, budget, manager flag); tags; pins; budget alerts already sent |
| 008 | Descriptive labels, dated billable and cost rates |
| 009 | Time entries (date, minutes, optional start/end, notes, billable flag, running-timer start, who created it, "billed outside JET Time" flag for imported history), favourites |
| 010 | Weekly submissions, approval history, period lock settings and admin unlocks |
| 011 | Expense categories (optional unit name and price), expenses (amount or units, billable, reimbursable, reimbursement status), receipts |
| 012 | Invoices, lines (category, two tax flags, kind), links to time and expenses, invoice item categories, message history, revocable client links, attachments, number sequence |
| 013 | Payments, refunds, reminders, recurring invoices, retainers and their ledger, write-off |
| 014 | Estimates, lines, messages, client answers, link to the invoice or project made from it |
| 015-017 | Saved, shared and scheduled reports; dated exchange rates. Other report and dashboard figures are derived, not stored |
| 018 | Notifications, preferences, Outbox, templates, scheduled-job runs unique per job and due time |
| 019 | Policies, balance ledger, requests, holiday calendars, work schedules |
| 020 | Placeholders, assignments (person or placeholder, repeat), milestones |
| 021 | Import batches; external reference on time entries, unique per person, so a calendar event imports once |
| 022 | One company-settings record covering the 022 request, activity log |
| 025 | API tokens, webhooks and deliveries, single sign-on identities |

### Acceptance criteria
Schema and migrations
1. **AC1** `npm run db:migrate` takes both an empty database and one holding only 001's migration to the full schema; a second run changes nothing; `npm run db:generate` afterwards creates no migration. Migrations use no PostgreSQL extension.
2. **AC2** `docs/data-model.md` lists every table with its purpose and the tasks it serves, the data rules and the billing rules below. A test fails if a table is missing from the document or the document names one that does not exist. Every item in the coverage table maps to a listed table.
3. **AC3** A test over the database catalogue shows: every table has a primary key; every foreign key has an index that starts with its columns; no money, minutes, percentage, quantity or rate column is a floating-point type.
4. **AC4** Migrations (not the seed) create reference data that production also needs: built-in roles Administrator, Manager and Member, with empty permission lists for 005 to fill; one company-settings record named "JET Engineering" (USD, week starts Monday, `America/Chicago`); invoice and estimate number sequences; item categories "Service" and "Product". They create no people, clients or credentials.
5. **AC5** The database itself, through direct inserts, rejects each of: negative minutes or over 1440 on one time entry; an unknown status, type, rate method or budget type; two people with emails differing only by case; a second running timer for one person; a time entry or expense without a person or project; the same invoice number twice (estimates likewise); one time entry on two invoice lines; one expense on two invoice lines; a payment of 0 or less; an end date before a start date on a project, time-off request or assignment; two weekly submissions for the same person and period; two company-settings records; the same provider payment reference twice.
6. **AC6** Deleting a client with projects, a project or person with time, a project task with time, or a time entry or expense that is on an invoice fails in the database with a foreign-key error.
7. **AC7** A business date such as `2026-03-08` round-trips unchanged with the process `TZ` set to `America/Los_Angeles`, `UTC` and `Pacific/Auckland`. A money value of 9,007,199,254,740,991 round-trips exactly; saving or reading a larger one, including a sum, raises an error instead of losing digits.

Data access
8. **AC8** One data-access entry point gives the same interface for embedded and real PostgreSQL. It offers a transaction helper that rolls everything back on any error and retries only serialization failure (`40001`) and deadlock (`40P01`), at most 3 attempts in total; any other error is not retried.
9. **AC9** A shared versioned-update helper succeeds and increments `version` when the expected version matches; otherwise it changes nothing and raises a distinct "stale" error. Missing records raise a distinct "not found" error.
10. **AC10** A shared edit guard for time entries and expenses, run inside the caller's transaction, locks the row and refuses with a distinct reason: invoiced, approved, or stale. Period locks and permissions are added by 005 and 010.
11. **AC11** Database code never reaches the browser: the built web files contain no Drizzle, PGlite or schema code, and importing server data code from web code fails lint or build. The calculations in AC12-AC16 can be imported by both sides and use no database, clock or environment.

Shared calculations (rounding is half away from zero, once per stated step, with exact integer arithmetic)
12. **AC12** Rate resolution takes the project, task, person and entry date and returns a rate, "not billable", "fixed fee", "no hourly rate", or "missing". Non-billable entry or project: not billable. Fixed-fee project: fixed fee. Rate method none: no hourly rate. Project: the project rate. Task: project-task rate, else the task default. Person: project-member rate, else the person's dated rate on that date. A rate of 0 is a rate, not missing. Task and person defaults are in company currency, so when the client's currency differs they are skipped and the result is "missing" unless the project sets a rate. Cost rate resolves by date in the same way.
13. **AC13** Time amount = minutes × rate ÷ 60, rounded once. Time rounding supports off, up, nearest (ties up) and down, to 5, 6, 10, 15 or 30 minutes; it applies per entry before adding up, never changes stored minutes, and 0 stays 0.
14. **AC14** Expense amount = quantity × unit price, rounded once to a minor unit.
15. **AC15** Document totals (invoices and estimates alike). Line amount = quantity × unit price, rounded; a time line with stored minutes uses AC13 on its total minutes instead, its quantity being display only. Discount = subtotal × percentage, rounded. Each tax = the sum of its taxable lines less the discount percentage, × tax percentage, rounded once. Taxes do not compound. Total = subtotal − discount + both taxes. Negative lines are allowed. Amount due = total − payments + refunds.
16. **AC16** Invalid input (non-integer, negative minutes, percentage outside 0 to 100%, unsafe integer result) raises an error rather than returning a number.

Billing transactions
17. **AC17** Number allocation locks the sequence row and runs in the caller's transaction: 20 simultaneous allocations give 20 different consecutive numbers; a rolled-back one does not use up its number; a number already used by a manually numbered document is skipped; a deleted invoice's number is not handed out again.
18. **AC18** Claiming entries for an invoice is all-or-nothing in one transaction. It locks rows in a fixed order (sequence, retainer, invoice, time entries by id, expenses by id), and verifies each entry is unclaimed, billable, not running, not billed outside, at the version the caller saw, and belongs to the invoice's client. Any failure leaves no invoice, line, link or used number, and the error lists the offending entry ids. The invoice must be draft or open.
19. **AC19** Two simultaneous claims that share at least one entry: exactly one succeeds and the other fails as in AC18. A claim racing an edit of the same entry never bills a value different from the stored one.
20. **AC20** Mixed rates never share a time line: grouped lines split by rate. The per-entry links of a line add up to the line's minutes. Changing a person's or project's rate afterwards changes no stored invoice figure.
21. **AC21** Deleting an invoice without payments releases all its entries and expenses, which become claimable again, in one transaction. Deleting one with payments is refused and changes nothing.
22. **AC22** Recording a payment locks the invoice and sets it to paid when nothing is due; a refund reopens it. A payment above the amount due, or on a draft or closed invoice, is refused. Two simultaneous payments of the full amount: exactly one succeeds. Invoices store totals, recalculated in the same transaction as any line change.
23. **AC23** The concurrency tests (AC17, AC19, AC22) run in `npm test` on the embedded database, and the same tests run against a real server with separate connections when `TEST_DATABASE_URL` is set (refused unless the database name contains `test`; plain `DATABASE_URL` is still ignored). When it is not set they are reported as skipped. The Implementation notes state plainly whether real-server contention was tested; if not, it is listed as untested.

Commands and safety
24. **AC24** Commands: `npm run db:seed` (migrates, then seeds an empty database), `npm run db:reset` (erases and reseeds; dev database), `npm run demo:reset` (same for the demo database). `npm run demo` seeds its database only when it holds no people, never erases, and prints the seed date, the three accounts and the reset command. `npm run dev` never seeds; on an empty database it prints the seed command.
25. **AC25** Seed and reset exit non-zero before writing anything when `NODE_ENV=production` or `DATABASE_URL` is set, with a message naming the override `ALLOW_DEMO_DATA=true`. (The embedded demo command, which runs the production build with no `DATABASE_URL`, is exempt; `npm run demo` keeps refusing `DATABASE_URL`.) Any other override value counts as not set. Passwords in URLs are never printed.
26. **AC26** Even with the override, seed refuses a database that holds any person, and reset refuses any database with people or clients that lacks the demo marker written by the seed. No option bypasses this.
27. **AC27** Reset asks the user to type a confirmation naming the database, or accepts `--yes`; without a terminal and without `--yes` it exits non-zero. Seed and reset each run in one transaction: forcing a failure part-way leaves the previous data intact.
28. **AC28** If the embedded data directory is in use by a running app, seed and reset exit non-zero with a message to stop the app first, and the data is undamaged. A stale lock from a crashed process does not block them.

Demo seed
29. **AC29** Seed takes an optional `--today=YYYY-MM-DD` (default: current date in the company time zone); an invalid date exits non-zero. Two seeds with the same date give identical records apart from password hashes. Seeds for 2026-01-01, 2028-02-29, a Monday, a Sunday and 2026-12-31 all satisfy AC30-AC36. Seeding finishes within 60 seconds on this laptop, and afterwards a normal insert works in every table with a generated key (no key collision).
30. **AC30** People: 11. Nine active, including the three demo accounts (Administrator, Manager, Member respectively) and at least one contractor; one archived; one pending sign-up. Only the three have credentials, and `jetdemo123` verifies against each stored hash; the hash is self-describing, from a memory-hard function available in Node without a native module, and differs between the three. Other emails use reserved `.example` domains and phones use 555-01xx. No real person or company is used, except the JET name.
31. **AC31** Clients: 6, one archived, at least one not in USD (with a dated exchange rate) and one without invoices; at least two with tax defaults; each active one with a contact. At least 10 projects that together use every project type, rate method and budget option, including monthly reset, expenses included, one over budget, one past its alert percentage but not over, and one archived. At least 8 tasks including common, non-billable and archived.
32. **AC32** The lead manages at least 2 active projects and at least 3 people. The employee is on at least 3 active projects, at least 2 of them managed by the lead.
33. **AC33** Time: 26 weeks before the current one. Each active person has entries on at least 80% of their working days (approved time off and holidays excluded) and 4 to 10 hours on each of those days. All entries have an assigned person and task, none is after today, none for the archived person after their archive date, none running. The current week holds unsubmitted entries on working days before today only. Notes are plausible work descriptions.
34. **AC34** Approvals: last week has at least two other people awaiting the lead, one rejected with a comment and one not submitted; the employee's last week is approved. Every invoiced entry and expense is approved. At least two clients have approved, billable, unbilled time, and at least two have unbilled expenses.
35. **AC35** Expenses: at least 60, including mileage, billable and not, every reimbursement status and at least 5 with an openable image or PDF receipt. Invoices: at least 14, covering draft, open not yet due, late by 1-30, 31-60, 61-90 and over 90 days, part-paid, paid, written off, with discount, with two taxes, free-form, and a retainer. At least one recurring invoice and one retainer with a balance. Estimates: draft, sent, accepted, declined, one converted to an invoice and one to a project. Every stored total equals the AC15 result, and each linked amount equals the AC13/AC14 result for its stored rate and minutes.
36. **AC36** Also present, dated around today: dated rate changes for at least 2 people, three time-off policies with balances and requests in each state, one holiday calendar, assignments from 4 weeks back to 8 weeks ahead with a placeholder and a milestone, notifications for each demo account, Outbox items labelled as captured and not sent, one saved report, activity-log entries. Seeded payments never claim a real online charge: any online one is marked simulated.
37. **AC37** `npm run build`, `npm run lint`, `npm test` and `npm run e2e` pass, and 001's criteria still hold.

### Test scenarios
1. Totals: lines 10.000 × 120.00 (tax 1), 2.500 × 95.00 (both taxes), 1.000 × 49.99 (untaxed); discount 10%, tax 1 8.25%, tax 2 5%. Subtotal 148749, discount 14875, taxes 10673 and 1069, total 145616. After a payment of 100000: due 45616.
2. Amounts: 100 min at 125.50 = 20917; 20 min at 100.00 = 3333; one line of three such entries (60 min) = 10000; 30 min at 0.01 = 1. Mileage 123.4 × 65.5 cents = 8083. Line of −0.500 × 0.01 (one minor unit) = −1, not 0.
3. Rounding to 15: 7 gives up 15, nearest 0, down 0; 8 nearest 15. To 6: 3 nearest 6. 0 stays 0 in all modes.
4. Rates: person 100.00 from 2026-01-01 and 120.00 from 2026-07-01: 2026-06-30 gives 10000, 2026-07-01 gives 12000, 2025-12-31 gives missing. Member rate 150.00 gives 15000; member rate 0 gives 0. Euro client with only a person default: missing.
5. Edge: bill three entries (two at 100.00, one at 120.00) grouped by task: two lines. Raise the rate: stored invoice unchanged. Delete the invoice: all three claimable, number not reused.
6. Failure: claim entries A and B when B is already on another invoice: error lists B, A stays unclaimed, no invoice exists, the next number is unchanged. Insert a second link for B by raw SQL: `23505`.
7. Failure: caller loaded entry at version 3, someone edited it (version 4), claim with version 3: refused as stale. Edit an invoiced entry: refused as invoiced.
8. Concurrency: 20 simultaneous number allocations; two overlapping claims; two full payments of one invoice.
9. Failure: `NODE_ENV=production npm run db:seed`, `DATABASE_URL=postgres://u:hunter2@127.0.0.1:1/x npm run db:seed` and `ALLOW_DEMO_DATA=yes NODE_ENV=production npm run db:seed`: each exits non-zero without connecting, `hunter2` never shown.
10. Failure: with the override, reset on a database with one person and no demo marker: refused, person still there. `npm run db:reset < /dev/null` without `--yes`: refused. `npm run db:seed -- --today=2026-02-30`: refused.
11. Edge: `npm run demo`, then `npm run demo:reset -- --yes` in a second terminal: refused with a message; the app keeps working. Stop it, reset again: succeeds; a new person, time entry and invoice can be added.

### Out of scope
- API routes, screens, sign-in, sessions, permission checks and permission content (004, 005). General create/read/update services for each record belong to the task that owns the feature; this task supplies the schema, guards, helpers and billing primitives only.
- Budget, report, utilization, accrual and ageing calculations (007, 015, 016, 019, 013).
- Deciding whether approval is required before billing (010, 012): the claim does not check it. Retainer draw-down logic (013), following the lock order here.
- First production administrator (004), backup and restore (021, 023), a reset button in the app (022).
- Enforcing row-level permissions inside PostgreSQL.

### Assumptions
- One company per installation. Later tasks may add migrations when they find a gap; the tables here are a base, not a freeze.
- `npm run demo` counts as an explicit seed command: it is demo-only, embedded-only and seeds only an empty database. Demo data ages; the printed seed date and `demo:reset` are the remedy.
- The seed has no running timer, because one left for days would show absurd hours.
- Client-facing links store only a token hash, so a lost link is replaced by a new one rather than shown again.
- Company time zone and currency defaults are guesses, editable in 022.
- Stored invoice totals are kept for reports and must always match the shared calculation.

### Notes for the engineer
- PGlite has one connection, so simultaneous transactions there run in turn: passing tests prove results, not lock contention. Correctness must therefore rest on constraints and row locks (hence AC5, AC18, AC23).
- The database drivers return `bigint`, `sum()` and `date` differently; normalize in the data-access layer (AC7).
- The TypeScript schema should be split by area so later tasks can edit it without conflicts.

### Size
L (upper end). Schema, calculations and billing first, seed last; keep them in separate modules. Not split, because 004 onward depend on the seeded accounts and the task order is fixed by number.

## Implementation notes
### Result
Build, lint, unit and e2e tests pass on Node 18.20.8. No dependency added.

**Not proven: contention on a real PostgreSQL server.** The AC17, AC19, AC22 and deadlock tests passed on the embedded database only, which has one connection, so they prove results and not lock contention. The same tests run on a server with `TEST_DATABASE_URL=... npm test` and are reported as skipped without it (16 skipped: 15 plus the deadlock test on the embedded database). The server path of those tests has itself never run. An attempt to start a throwaway PostgreSQL from npm binaries in the session scratchpad was refused by the permission system and not pursued; the downloaded binaries were deleted, nothing of it is in the project. Also untested on a server: migrations, seed and reset.

### Files
- `src/shared/`: `calc/` (AC12-AC16), `currency.ts`, `domain.ts` (fixed values, also used for database checks), `dates.ts` (calendar part moved out of `src/web/ui/dates.ts`, which re-exports it).
- `src/server/db/`: `schema/` by area (86 tables), `index.ts` (entry point), `transaction.ts`, `records.ts` (versioned update), `aggregates.ts` and `numbers.ts` (exact integers). `drizzle/0001_domain.sql`, `0002_reference_data.sql`.
- `src/server/billing/`: numbers, claim, edit guard, totals, payments, delete.
- `src/server/demo/` (seed), `demoData.ts` and `scripts/demo-data.mjs` (commands), `server.ts`/`main.ts` (demo seeds when no people; dev prints the hint).
- `src/server/security/passwords.ts` (scrypt, N 2^15, r 8, p 3, self-describing), `src/server/clock.ts`.
- `docs/data-model.md`; `eslint.config.js` and `vite.config.ts` (AC11, test workers at half the cores because many tests start processes).
- `server.ts`/`main.ts`: start-up now checks for a stop between slow steps, because longer migrations made stopping during start exceed 4.5 s on a loaded machine (`scripts/dev.test.ts` failed once; passes since).

### Acceptance criteria
- AC1 -> `database.test.ts`; `npm run db:generate`: "No schema changes"; no extension.
- AC2, AC3, AC4, AC5, AC6 -> `schema.test.ts`. Foreign keys use NO ACTION, because RESTRICT reports another code on PostgreSQL 18.
- AC7 -> `values.test.ts` (sets `TZ` and checks it took effect). AC8, AC9 -> `access.test.ts`. AC10 -> `billing.test.ts`.
- AC11 -> `e2e/bundle.spec.ts`; by hand: a web file importing server code, also with `import()`, fails lint (4 errors) and build ("belongs on the server").
- AC12-AC16 -> `src/shared/calc/calc.test.ts` (scenarios 1-4).
- AC17-AC22 -> `billing.test.ts` (scenarios 5-7, lock order) and `concurrency.test.ts` (scenario 8). AC23 -> as above; a database name without `test` is refused.
- AC24-AC28 -> `guard.test.ts`, `demoData.test.ts`, `server.test.ts`, `seed.test.ts` (all or nothing). By hand: scenarios 9, 10 and 11, the latter on a copy of `.data/demo` as 001 left it, including kill -9; the typed confirmation in a terminal (wrong answer, Ctrl+C, right answer); the commands from `dist`.
- AC29-AC36 -> `seed.test.ts` for the five dates. Seeding takes about 1.5 s, the whole command 2.5 s.
- AC37 -> below.

### Commands and results (Node 18.20.8, 2026-11-24)
`npm run build` 0, `npm run lint` 0, `npm test` 0 (32 files, 940 passed, 16 skipped; also with `DATABASE_URL=postgres://nobody@127.0.0.1:1/none`), `npm run e2e` 0 (156 passed, 94 skipped by design at the second base, as in 002), `npm run db:generate` "No schema changes". No server left running, `.data/tmp` empty, `.data/demo` untouched.

### Decisions and assumptions
- Claims: hours of a fixed-fee project, or of one with rate method none, are billed at 0; a missing rate is refused. Expenses must be in the invoice's currency. An entry named twice in one claim is refused. "Billed outside" entries stay editable.
- Numbers of deleted invoices are kept in `retired_numbers`, so a manually numbered invoice that was deleted is not reused either.
- `version` counts up with any update through Drizzle, not only through the helper.
- Deleting an invoice also needs the version the caller saw.
- Seed also refuses a database with clients but no people. `demo:reset` always refuses `DATABASE_URL`, also with the override. With `NODE_ENV=production` and the override but no `DATABASE_URL`, `db:seed` and `db:reset` ask for `DATABASE_URL`, as `db:migrate` does.
- Reset empties all tables and runs the migrations named `*_reference_*` again, so later reference data (such as 005's permissions) must go into migrations named so. A test compares the result.
- Seed and reset accept `--data-dir`, as the server does (used by tests).
- "Written off" is a closed invoice with a write-off record; its amount due stays, as AC15 defines it.
- The internal client "JET Engineering (internal)" is one of the six and the one without invoices.

### Known limitations
- `seed.test.ts` and the process tests bring `npm test` from 16 s to 43 s.
- A lock left by a crash blocks if another program now has that process id; the message says which file to delete (as in 001).
- The database does not check that stored invoice totals match the lines, only that they add up; the billing code keeps them.

### Follow-ups
- 004: `sign_in_attempts`, `invites`, `sessions` are a base and may need more columns (kind, help requests). Every e2e worker now seeds its in-memory database, about 2 s.
- 012: decide whether hours at rate 0 should show on the client's invoice.
- 023: run the suite with `TEST_DATABASE_URL` on a real server before production use.

## QA report
Overall: **PASS** (37 of 37), with one path untested: a real PostgreSQL server.

Node 18.20.8, 2026-11-24. Nothing was taken from the engineer's notes. Commands on the project: `npm run build` 0, `npm run lint` 0, `npm test` 0 (32 files, 940 passed, 16 skipped: the server half of the concurrency tests), `npm run e2e` 0 (156 passed, 94 skipped at the second base, as in 002), `npm run db:generate` "No schema changes". Throwaway scripts and all faults and seed/reset runs were in a copy in the session scratchpad, since deleted; project files and `.data/demo` are unchanged (checksums) and no server is left running. One side effect: `npm run dev` in the copy, whose `node_modules` was a link, rewrote the git-ignored cache `node_modules/.vite/deps`.

**Untested: real PostgreSQL.** No server was started, as instructed. Migrations, seed, reset, the pg driver's value conversion and lock contention were not run against a server, and the 15 server concurrency tests plus the deadlock test have never run. Lock order and "read links after locking" were only read in the code. Embedded results prove outcomes, not contention.

| AC | Result | Evidence |
|---|---|---|
| AC1 | PASS | `db:migrate` on empty: 3 applied, again: none; on a copy of 001's `.data/demo`: 2 applied, again: none; same 86 tables. `db:generate`: no change. Only `plpgsql` installed, no `create extension` |
| AC2 | PASS | 86 documented tables = 86 in the catalogue, every coverage table exists. Removing a row and misspelling one each failed `schema.test.ts` |
| AC3 | PASS | Own catalogue query: no table without primary key, no foreign key without a leading index, no float or numeric column |
| AC4 | PASS | After migrations only: 3 roles with `[]`, settings JET Engineering/USD/1/America/Chicago, 2 sequences, Service and Product; 0 people, clients, credentials |
| AC5 | PASS | 34 raw statements rejected with 23514/23505/23502/23503 (1440 and 0 minutes accepted) |
| AC6 | PASS | 10 raw deletes, each 23503 |
| AC7 | PASS | 9 dates round-trip in three `TZ` values (`0001-01-01`, `9999-12-31` too). 9,007,199,254,740,991 exact; saving, reading and summing larger each raise |
| AC8 | PASS | 40001 and 40P01: 3 attempts; 23505 and 57014: 1; third attempt commits once; plain error rolls back. Embedded only |
| AC9 | PASS | version+1; stale leaves row alone; missing gives NotFoundError |
| AC10 | PASS | invoiced (also when approved), approved, stale, not found, each distinct |
| AC11 | PASS | Bundle has no drizzle/pglite/schema text; server import fails lint (also `import()`) and build; `src/shared/calc` from web lints and builds |
| AC12 | PASS | 21 resolutions incl. scenario 4, zero rate, EUR skip, task default, cost rate |
| AC13-15 | PASS | 40,820 cases against expected values computed separately in Python with exact fractions: time and expense amounts, all rounding modes, increments and minutes 0-1440, 4,000 documents: 0 differences. Scenarios 1-3 exact (148749, 14875, 10673, 1069, 145616, 45616; 20917, 3333, 10000, 1, 8083, -1) |
| AC16 | PASS | 34 invalid inputs raise (negative, fraction, NaN, string, percent -1/100.001/1.5/NaN, unsafe product and sum) |
| AC17 | PASS | 20 consecutive; failed claim keeps number; manual number skipped; deleted not reused, even with the sequence set back to 1 |
| AC18 | PASS | All reasons listed at once (running, not billable, billed outside, other client, duplicate, not found, stale, currency); snapshot of invoices, lines, links, payments, sequences unchanged; paid and closed refused, open accepted |
| AC19 | PASS | Overlap: exactly one (own script). The race with an edit was run only through `concurrency.test.ts`. Removing the claim's checks makes 9 tests fail. Embedded only |
| AC20 | PASS | 40 min at 100.00 and 50 min at 120.00: two lines, 6667 + 10000 = 16667; link minutes add up; later rate and rounding changes alter nothing, also after recalculation |
| AC21 | PASS | Time and expense re-billed after deletion; with payments refused, also after refund. On the seed 8 deleted, 19 refused for payments, no other error |
| AC22 | PASS | 0, negative, fraction, above due, draft, closed refused; part, full (paid), refund (open again, due correct), over-refund refused; two full payments: one succeeds |
| AC23 | PASS | Reported skipped without `TEST_DATABASE_URL`; `.../jet` refused before connecting; notes state it is untested |
| AC24 | PASS | All commands run; demo on 001's data seeded once, printed date, accounts and reset; restart kept an added person; dev prints the seed command and seeds nothing |
| AC25 | PASS | 15 refusals (scenario 9, overrides `TRUE`, `1`, `" true "`, empty, dist build, `--data-dir`), exit 1, no folder created, `hunter2` never shown |
| AC26 | PASS | Marker removed: reset refused with and without override, 11 people left; client only: seed and reset refused; second seed refused |
| AC27 | PASS | Real terminal: wrong, empty, other case, Ctrl+C, Ctrl+D refused, exact name accepted; `< /dev/null` refused; forced failure in seed leaves empty, in reset keeps 11 people, 3551 entries and an edited name |
| AC28 | PASS | Demo running: `demo:reset`, `db:reset`, `db:seed` refused, health still 200; after `kill -9` reset succeeds |
| AC29 | PASS | Two seeds and a reset after edits: no table differs (hashes left out). Bad dates refused. 1.5 s; command 3.5 s. Own checks on 13 dates (the five, a DST day, weekends, holidays) all pass. 65 generated keys, 0 collisions |
| AC30-34 | PASS | Own SQL on the same 13 dates: people, hashes, emails, phones, roles, clients, projects, budgets (worked out separately for the five dates and 2026-11-24: Cold store 107-108%, over; Turbine 88% of its fee budget with alert 80), 80% days, 4-10 h, current week, approvals |
| AC35 | PASS | All line, total, tax, due and link figures recalculated separately, and each billed rate resolved separately from the stored rates: no difference. 108 expenses, 27 invoices, 19 receipts decode: all 10 PNGs, and all 9 PDFs rendered to images; one PNG looked at. The script catches planted errors in total, rate, line, date, hours |
| AC36 | PASS | Present and dated up to the seed date; Outbox all `captured`, none sent; online payments `simulated`, "No money was moved" |
| AC37 | PASS | Commands above; also the db tests with `DATABASE_URL` pointing at a closed port. 001 by hand in demo mode at `/jettime`: health, 404, 400, page, clean stop, production refusals without password |

Extra findings, none blocking:
1. Low: an unknown rate method makes `resolveBillableRate` return `undefined` instead of raising (types and the database exclude it).
2. Low, for 012/013: a credit line added after payments leaves the invoice paid with a negative amount due (total 5000, paid 8991, due -3991). A refund on a closed invoice is accepted and changes its amount due.
3. Low, for 013: an open invoice with total 0 can never become paid, since no payment can be recorded. Read in the code, not run.
4. For 012: `changeInvoiceLines` accepts any change, so it can alter a time line without its entry links; they must be kept together.
5. Before production (023): run `TEST_DATABASE_URL=... npm test` and the seed and migration commands on a real server.

## PM acceptance
**ACCEPTED** for this task's scope, on 2026-11-24. This is not a statement that the data layer is proven on a real PostgreSQL server.

How it was judged: read the Spec, the notes, the QA report and the code (claim, totals, payments, delete, numbers, edit guard, transaction helper, rate and document calculations, seed, reset and guard commands, demo content, data-model document). The PM had no way to run commands, so nothing was run for this review; run-time evidence is QA's.

Reasons:
- Goal: each entry can be on one invoice line only, by primary key; the claim locks in the specified order, reads state and links after locking, and records the billed rate, minutes and amount. Demo data cannot get into a production database by default, and reset refuses records without the demo marker, checked again inside the transaction.
- All 37 criteria have QA evidence. AC19's race with an edit rests on the project's own test, not on an independent one.
- Demo: the three accounts, plausible work, clients and dates around today. Online payments are labelled simulated and Outbox messages captured.
- AC23 allows server tests to be skipped if the notes say so plainly; they do.

**Untested, and to stay listed as such:** real PostgreSQL. Migrations, seed, reset, value conversion through the pg driver, retry after a real deadlock and lock contention have never run on a server. The embedded database has one connection, so its concurrency tests prove outcomes only. Double billing is also blocked by the key constraints, but do not describe contention safety as tested, nor use JET Time for real billing, until `TEST_DATABASE_URL=... npm test`, migrations and seed/reset pass on a server. That needs the user's approval or a server they provide; it is recorded in 023.

Not blocking, to be handled by the tasks that own the features:
1. 012: keep entry links and time lines together when lines are edited (`changeInvoiceLines` does not enforce it); decide whether hours at rate 0 show on the client's invoice, and what a credit line after payments does (amount due goes negative).
2. 013: a zero-total open invoice can never become paid; decide whether a refund on a closed invoice is allowed.
3. Any: `resolveBillableRate` returns `undefined` for an unknown rate method instead of raising. The database and types exclude that value.

## History
- 2026-11-23 created
- 2026-11-23 PM: groomed
- 2026-11-23 ORCH: todo -> groomed
- 2026-11-23 ORCH: back to todo; user moved the target from GitHub Pages to JET's own servers
- 2026-11-23 PM: groomed
- 2026-11-23 ORCH: todo -> groomed
- 2026-11-23 ORCH: user confirmed company time zone is US Central (America/Chicago)
- 2026-11-24 ORCH: groomed -> in-progress
- 2026-11-24 SWE: implemented
- 2026-11-24 ORCH: in-progress -> qa
- 2026-11-24 QA: pass
- 2026-11-24 ORCH: QA PASS, qa -> review
- 2026-11-24 PM: accepted
- 2026-11-24 ORCH: PM ACCEPTED, review -> done
