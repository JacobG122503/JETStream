# JETStream

Time tracking, expenses and client billing for JET Engineering. Employees track time on client projects, the billing manager approves it, and billable time becomes invoices.

## Demo on one laptop

Needs [Node.js](https://nodejs.org) 18.20 or newer (20 or 22 is better; 18 no longer gets security fixes). Nothing else: the demo brings its own database.

```sh
npm install
npm run demo
```

Open the address it prints. All people, clients and amounts are made up. Accounts (password `jetdemo123`, or click one on the sign-in page):

| Account | Who |
| --- | --- |
| `admin@jet.demo` | Administrator and billing manager |
| `lead@jet.demo` | Project lead |
| `employee@jet.demo` | Employee |

`npm run demo:reset` starts over with fresh data. A demo never sends email.

## Who does what

- **Employees** use Timesheet (timer, hours by day, week or month) and Expenses (with receipts), then submit the week.
- **Approvers** use Approvals: look at the details, approve, or send back with a comment. They can also remind people who have not submitted.
- **Billing** uses Invoices: make a draft of approved or unapproved hours and expenses, change its lines, send it or make a client link, print it or save it as PDF, record payments. There are also estimates, recurring invoices, retainers and client statements.
- **Administrators** use Team, Clients, Projects, Tasks and Settings, give roles, and export everything as CSV.

## What works, and what does not yet

| Area | State |
| --- | --- |
| Timesheets, timers, favorites, entering time for others | Works |
| Approval, sending back, reopening, locking by date | Works |
| Expenses, receipts, categories, recording paying back | Works |
| Clients, contacts, projects, budgets, tasks, rates | Works |
| Roles and permissions, invites, password resets | Works |
| Invoices, lines, taxes, attachments, client links, print/PDF | Works |
| Payments, refunds, write-offs, retainers, statements | Works; recorded by hand, no money moves |
| Recurring invoices, late reminders, timesheet reminders, budget alerts | Works; run by the server |
| Estimates, accepted or declined by clients | Works |
| Reports (time, detailed, expenses, budgets, uninvoiced, invoices, payments), CSV | Works |
| Email over SMTP | Built and tested with a stand-in; **not yet tried with a real mail server** |
| PostgreSQL | Built for it; **tested only with the embedded PostgreSQL (PGlite)**, not on a real server |
| Online payment | Not built: clients pay as they do today |
| Time off, scheduling, profitability, saved reports | Not built |
| Import from Harvest, accounting exports, calendar feeds | Not built |
| Two-factor sign-in, single sign-on, API tokens, webhooks | Not built |
| Editing the wording of messages, managing tags, dashboards | Not built |
| Firefox, Safari, screen readers, Windows | Not tried |

## Running it for real

See [docs/self-hosting.md](docs/self-hosting.md).

## Developing

```sh
npm run dev      # API and web app, with an embedded database in .data
npm run lint
npm test
npm run e2e      # once before: npm run e2e:install
```

How the data is kept: [docs/data-model.md](docs/data-model.md). Who may do what: [docs/permissions.md](docs/permissions.md).
