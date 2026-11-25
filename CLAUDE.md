# JETStream

## Garcia Dev Team project profile

- **What this is:** A time tracking, expense and client billing web app for the contracting company JET Engineering, with the feature depth of Harvest. Employees log time to client projects; billable time is invoiced to each client company.
- **Stack:** TypeScript throughout, one npm project. Server: Node + Express REST API that also serves the built web app, Drizzle ORM on PostgreSQL. Local development, demo and tests use PGlite (embedded Postgres, nothing to install); production uses a real PostgreSQL through `DATABASE_URL`, with the same schema and migrations. Web: React 18, Vite 6, React Router 6. Tests: Vitest, Testing Library, Supertest, Playwright. Must work on Node 18.20 (the installed version) and newer. Docker and a Postgres server are not installed on this machine.
- **Install:** `npm install`
- **Build:** `npm run build`
- **Lint/format:** `npm run lint`
- **Test:** `npm test` (single run, no watch); end-to-end: `npm run e2e`
- **Run locally:** `npm run dev`; demo on one laptop with seeded data: `npm run demo`
- **Git:** default branch `main`; commit after each accepted task: yes; push after commit: no
- **CI:** none yet
- **Off limits:** anything outside this project folder; never create a remote repo, push or deploy
- **Conventions:** see the rules below

### Product rules

- **Hosting:** will run on JET Engineering's own servers (operating system and setup not known yet), so keep it portable: plain Node process, configuration from environment variables, reverse-proxy friendly, no cloud-only services. GitHub Pages is no longer a target.
- **Security:** the server is the authority. Every API route authenticates, validates input and checks permissions; the UI only mirrors them. Server-side sessions in httpOnly cookies, CSRF protection, rate-limited sign-in, strong password hashing, uploads validated and access-checked, no secrets in the repo.
- **Data:** shared, multi-user, in PostgreSQL. Use transactions for billing operations and guard against concurrent edits (nothing may be invoiced twice).
- **Outside services:** email, online payment and accounting go through adapters chosen by configuration. With nothing configured, email is captured in an in-app Outbox and payments are labelled as simulated and never ask for real card data. Never present a simulated or untested action as real.
- **Demo data:** loaded only by an explicit seed command, and refused in production unless explicitly allowed. Demo passwords must never exist in a production database by default; the first production administrator is created by a setup command.
- **Demo accounts (seeded):** `admin@jet.demo` (administrator, billing manager), `lead@jet.demo` (project lead), `employee@jet.demo` (regular employee). Password for all: `jetdemo123`. All people, client companies and figures in seed data are fictional.
- **Brand:** "JETStream" by JET Engineering. Primary colour mediumseagreen (#3CB371). White text on it fails WCAG AA, so use dark text on it or a darker shade of it. Do not use Harvest's name, logo, artwork, wording or visual identity in the product.
- **Time zone:** JET Engineering is in US Central (America/Chicago); use it as the company default.
- **Correctness:** store time as integer minutes and money as integer minor units; calculate invoices, budgets and reports in pure, unit-tested functions. Store dates as local ISO dates (YYYY-MM-DD).
- **Quality:** usable on phone and desktop, keyboard accessible, with loading, empty and error states, and confirmation before destructive actions.
