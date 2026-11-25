# Data model

The schema is in `src/server/db/schema/`, split by area. Change it there, then run `npm run db:generate` and commit the new migration. A test compares this document with the database, so add new tables here too.

Use `src/server/db` for all access. It gives the same interface for the embedded database and a PostgreSQL server.

## Data rules

- **Time** is integer minutes. **Money** is integer minor units of an ISO 4217 currency; `src/shared/currency.ts` knows the decimals (USD 2, JPY 0). **Percentages** and **quantities** are integer thousandths (8.25% is 8250, 1.5 is 1500). **Expense unit prices** are thousandths of a minor unit (65.5 cents is 65500). **Exchange rates** are integer millionths. No such column is floating point or decimal.
- **Exactness.** A value beyond 9,007,199,254,740,991 raises an error when saved or read. Add up with `sumExact`, not Drizzle's `sum`.
- **Currencies.** Amounts of a project, invoice, estimate or retainer are in the client's currency. An expense has its own. Task and person rates are in company currency.
- **Dates.** Business dates are `date`, read and written as `YYYY-MM-DD`; their columns end in `_on` (or say start and end of a period). Instants are `timestamptz` and end in `_at`.
- **Versions.** Every record people edit has a `version`, which any update through Drizzle counts up. Change records with `updateVersioned`. With `onConflictDoUpdate`, set `version` yourself.
- **Rates.** Time entries store none. `resolveBillableRate` in `src/shared/calc` finds it. Invoice lines store the billed rate, and each link to an entry stores billed minutes, rate and amount.
- **Approval.** Each time entry and expense has its own status. A submission is the person's week.
- **Derived, not stored.** "Late" (an open invoice past its due date), balances, budgets used and reports.
- **Secrets.** Passwords are salted hashes (`src/server/security/passwords.ts`); tokens are hashes; the TOTP and webhook secrets are ciphertext.
- **Files** live in the database, so one backup is complete.
- **Deleting.** What others depend on is not deleted: the foreign key fails with 23503. Parts of a record (an invoice's lines) go with it.
- **Text** with a fixed set of values is checked by the database; the values are in `src/shared/domain.ts`.
- **Reference data** that every installation needs is in migrations named `*_reference_*`. They hold nothing else, because resetting demo data empties all tables and runs them again.

## Billing rules

`src/server/billing` is the only code that links entries to invoices, changes stored totals or status, records payments or takes numbers.

- Who may change an entry is judged by the same guard as whether it can be changed (`editGuard.ts`, [permissions](permissions.md)).
- Run work in `runTransaction`. It undoes everything on an error and tries again, three times at most, after a serialization failure or deadlock only.
- Lock rows in this order: number sequence, retainer, invoice, time entries by id, expenses by id.
- `createInvoiceFromEntries` and `addEntriesToInvoice` bill all chosen entries or none. Each must be unclaimed, billable, not running, not billed outside, of the invoice's client and currency, with a rate, and at the version the caller saw. The invoice is a draft or open. Approval is not checked here.
- An entry is on one line only: the key of `invoice_time_entries` and `invoice_expenses` sees to it.
- Time rounding from the settings applies to each entry before adding up. Lines never mix rates. Hours of a fixed-fee project, or of one deliberately without a rate, are billed at 0; a missing rate is refused.
- Before changing or deleting a time entry or expense, call `lockTimeEntryForEdit` or `lockExpenseForEdit` in the same transaction. It refuses invoiced, approved and stale ones. Period locks and permissions come on top.
- Change lines with `changeInvoiceLines`, which keeps the stored totals equal to `documentTotals`.
- Numbers come from `allocateNumber` in the transaction that uses them. Numbers given by hand and those of deleted documents are skipped. Delete an invoice with `deleteInvoice`; one with payments is refused.
- `recordPayment` refuses more than is due, and drafts and closed invoices. The invoice becomes paid when nothing is due; `recordRefund` opens it again.

## Tables

### Company and installation

| Table | Purpose | Tasks |
|---|---|---|
| `app_meta` | Facts about this installation, one row each; the demo marker is one of them | 003 |
| `company_settings` | The one company: name, address, logo, currency, time zone, formats, time rules, lock settings, weekday and time of the reminder to submit, modules, document defaults | 010, 018, 022 |
| `number_sequences` | Prefix and next number of invoices and of estimates; locked while a number is taken | 012, 014 |
| `retired_numbers` | Numbers of deleted documents, never handed out again | 012, 014 |
| `activity_log` | Who changed what and when | 022 |
| `files` | Uploaded content (receipts, photos, logo) with name, media type, size and owner | 004, 011, 012, 021, 022 |
| `import_batches` | Imported files and their result | 021 |

### People and access

| Table | Purpose | Tasks |
|---|---|---|
| `people` | Everyone who uses JETStream: unique email ignoring case, status, employee or contractor, capacity, time zone, photo, department, role, and a permission list of their own in place of the role's (null without one) | 004, 008 |
| `roles` | Built-in roles, whose permissions are in the code, and custom ones with their description and permission list (`key:level`) | 005 |
| `person_extras` | Permissions switched on for one person with the built-in Manager role | 005 |
| `labels` | Descriptive labels, such as Engineer | 008 |
| `person_labels` | Labels of a person | 008 |
| `person_rates` | Dated billable and cost rates of a person | 008 |
| `person_managers` | Who manages whom | 005 |
| `person_clients` | Client companies a person is assigned to | 004 |
| `person_credentials` | Salted password hash of a person, with a version that each new password (not a renewed hash) counts up | 004 |
| `person_totp` | Two-factor secret, as ciphertext, and the last accepted step | 004, 026 |
| `person_recovery_codes` | Hashes of one-time recovery codes | 004, 026 |
| `sessions` | Signed-in browsers, by hash of their token | 004 |
| `invites` | Invitations by link, by hash of their token, which is erased once the link can no longer work; ended ones, whose maker lost the access to make them; the role's name once the role is deleted | 004, 005 |
| `invite_clients` | Client companies an invited person will be assigned to | 004 |
| `invite_projects` | Projects an invited person will be assigned to | 004 |
| `password_resets` | Password-reset links, by hash of their token; removed when used or expired | 004 |
| `help_requests` | People who forgot their password and wait for a link from an administrator | 004 |
| `sign_in_attempts` | Attempts at sign-in, sign-up, links and the like, for limiting guesses; kept for an hour | 004 |
| `api_tokens` | Personal API tokens, by hash | 025 |
| `sso_identities` | Accounts at the sign-on provider and the people they belong to | 025 |

### Clients and projects

| Table | Purpose | Tasks |
|---|---|---|
| `clients` | Client companies: address, currency, tax defaults, terms, notes, archived | 006 |
| `contacts` | People at a client | 006 |
| `tasks` | Task library: default billable flag and rate, common, archived | 007 |
| `projects` | Projects with type, rate method and budget options | 007 |
| `project_tasks` | Tasks of a project with their rate and budget; kept when removed | 007 |
| `project_members` | People on a project with manager flag, rate and budget; kept when removed | 004, 007 |
| `tags` | Project tags | 007, 022 |
| `project_tags` | Tags of a project | 007 |
| `project_pins` | Projects a person pinned | 007 |
| `budget_alerts` | Budget alerts already sent, each once per period | 007, 018 |

### Time and approval

| Table | Purpose | Tasks |
|---|---|---|
| `time_entries` | Time: date, minutes, optional start and end, running timer, notes, billable, status, creator, billed outside, external reference | 009, 010, 021 |
| `time_favorites` | Rows a person adds often | 009 |
| `submissions` | Weekly submission per person: period, status, comment, who decided and when | 010, 011 |
| `approval_events` | History of each submission | 010 |
| `period_unlocks` | Locked periods an administrator opened for one person | 010 |

### Expenses

| Table | Purpose | Tasks |
|---|---|---|
| `expense_categories` | Categories with optional unit name and price | 011 |
| `expenses` | Expenses: amount or units, currency, billable, reimbursable, reimbursement status, status | 011 |
| `expense_receipts` | Receipt files of an expense | 011 |

### Invoices and payments

| Table | Purpose | Tasks |
|---|---|---|
| `item_categories` | Categories of invoice and estimate lines | 012, 014 |
| `invoices` | Invoices with state, terms and stored totals | 012, 013 |
| `invoice_lines` | Lines: kind, category, quantity or minutes, price, two tax flags, amount | 012 |
| `invoice_time_entries` | Billed time entries with billed minutes, rate and amount; each entry once | 012 |
| `invoice_expenses` | Billed expenses with billed amount; each expense once | 012 |
| `invoice_messages` | Message history of an invoice | 012, 013 |
| `invoice_links` | Revocable client links, by hash of their token | 012 |
| `invoice_attachments` | Files sent with an invoice | 012 |
| `payments` | Payments on invoices | 013 |
| `refunds` | Money given back of a payment | 013 |
| `invoice_write_offs` | Invoices given up on | 013 |
| `invoice_reminders` | Late reminders, one per invoice and day | 013 |
| `recurring_invoices` | Templates invoices are made from when due | 013 |
| `recurring_invoice_lines` | Lines of those templates | 013 |
| `retainers` | Money paid in advance | 013 |
| `retainer_entries` | Retainer ledger; the balance is its sum | 013 |

### Estimates

| Table | Purpose | Tasks |
|---|---|---|
| `estimates` | Estimates with state, totals and what was made from them | 014 |
| `estimate_lines` | Lines of an estimate | 014 |
| `estimate_messages` | Message history of an estimate | 014 |
| `estimate_links` | Revocable client links, by hash of their token | 014 |
| `estimate_answers` | Answers of the client | 014 |

### Reports

| Table | Purpose | Tasks |
|---|---|---|
| `saved_reports` | Saved reports: the page with what is chosen on it. Each is seen by its owner only; sharing and schedules are not built | 016 |
| `report_shares` | People a shared report is limited to | 016 |
| `report_schedules` | When a saved report is delivered and to whom | 016 |
| `exchange_rates` | Dated exchange rates | 015, 016, 017 |

### Messages and jobs

| Table | Purpose | Tasks |
|---|---|---|
| `notifications` | In-app notifications | 018 |
| `notification_preferences` | What a person wants to be told, and how | 018 |
| `outbox_messages` | Every email; captured means nothing was sent | 018 |
| `message_templates` | Wording changed by an administrator | 018 |
| `job_runs` | Scheduled-job runs, unique per job and due time | 013, 016, 018 |
| `webhooks` | Webhook receivers, with the secret as ciphertext | 025 |
| `webhook_deliveries` | Attempts to deliver to them | 025 |

### Time off and schedule

| Table | Purpose | Tasks |
|---|---|---|
| `time_off_policies` | Policies: kind, paid, accrual | 019 |
| `time_off_policy_people` | Who a policy applies to, from when | 019 |
| `time_off_requests` | Requests and decisions | 019 |
| `time_off_entries` | Balance ledger; a balance is its sum | 019 |
| `holiday_calendars` | Holiday calendars | 019 |
| `holidays` | Days of a calendar | 019 |
| `work_schedules` | Working time on each weekday | 019 |
| `person_schedules` | Dated schedule and holiday calendar of a person | 019 |
| `placeholders` | Someone yet to be hired or chosen | 020 |
| `assignments` | Planned time of a person or placeholder, with repeat | 020 |
| `milestones` | Dates of a project | 020 |

## Coverage

Where each item of the 003 specification is stored.

| Task | What | Tables |
|---|---|---|
| 004 | People and credentials | `people`, `files`, `person_credentials`, `person_totp`, `person_recovery_codes` |
| 004 | Sessions, links, attempts | `sessions`, `invites`, `invite_clients`, `invite_projects`, `password_resets`, `help_requests`, `sign_in_attempts` |
| 004 | Person-to-client and project assignment | `person_clients`, `project_members` |
| 005 | Roles, one per person, extras, managers | `roles`, `people.role_id`, `person_extras`, `person_managers`, `project_members.is_manager` |
| 006 | Clients and contacts | `clients`, `contacts` |
| 007 | Tasks, projects, project tasks and members | `tasks`, `projects`, `project_tasks`, `project_members` |
| 007 | Tags, pins, alerts | `tags`, `project_tags`, `project_pins`, `budget_alerts` |
| 008 | Labels, dated rates | `labels`, `person_labels`, `person_rates` |
| 009 | Time entries, timer, favourites | `time_entries`, `time_favorites` |
| 010 | Submissions, history | `submissions`, `approval_events`, `time_entries.status`, `expenses.status` |
| 010 | Lock settings, unlocks | `company_settings`, `period_unlocks` |
| 011 | Categories, expenses, receipts | `expense_categories`, `expenses`, `expense_receipts`, `files` |
| 012 | Invoices, lines, links, categories | `invoices`, `invoice_lines`, `invoice_time_entries`, `invoice_expenses`, `item_categories` |
| 012 | Messages, client links, attachments, numbers | `invoice_messages`, `invoice_links`, `invoice_attachments`, `number_sequences`, `retired_numbers` |
| 013 | Payments, refunds, reminders, write-off | `payments`, `refunds`, `invoice_reminders`, `invoice_write_offs` |
| 013 | Recurring invoices, retainers | `recurring_invoices`, `recurring_invoice_lines`, `retainers`, `retainer_entries` |
| 014 | Estimates and answers, conversion | `estimates`, `estimate_lines`, `estimate_messages`, `estimate_links`, `estimate_answers` |
| 015 | Exchange rates; figures are derived | `exchange_rates` |
| 016 | Saved, shared and scheduled reports | `saved_reports`, `report_shares`, `report_schedules` |
| 017 | Dashboards; figures are derived | `exchange_rates`, `saved_reports` |
| 018 | Notifications, preferences, Outbox, templates, jobs | `notifications`, `notification_preferences`, `outbox_messages`, `message_templates`, `job_runs` |
| 019 | Policies, ledger, requests, holidays, schedules | `time_off_policies`, `time_off_policy_people`, `time_off_requests`, `time_off_entries`, `holiday_calendars`, `holidays`, `work_schedules`, `person_schedules` |
| 020 | Placeholders, assignments, milestones | `placeholders`, `assignments`, `milestones` |
| 021 | Import batches, external reference | `import_batches`, `time_entries.external_reference` |
| 022 | Settings, activity log | `company_settings`, `activity_log`, `tags`, `files` |
| 025 | Tokens, webhooks, sign-on | `api_tokens`, `webhooks`, `webhook_deliveries`, `sso_identities` |
