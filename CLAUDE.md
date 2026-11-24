# JET Time

## Garcia Dev Team project profile

- **What this is:** A time tracking, expense and client billing web app for the contracting company JET Engineering, with the feature depth of Harvest. Employees log time to client projects; billable time is invoiced to each client company.
- **Stack:** TypeScript, React 18, Vite 6, React Router 6 (hash routing), Dexie (IndexedDB), Vitest + Testing Library + fake-indexeddb, Playwright for end-to-end tests. npm. Must work on Node 18.20 (the installed version), so do not use packages that need Node 20+.
- **Install:** `npm install`
- **Build:** `npm run build`
- **Lint/format:** `npm run lint`
- **Test:** `npm test` (single run, no watch); end-to-end: `npm run e2e`
- **Run locally:** `npm run dev`
- **Git:** default branch `main`; commit after each accepted task: yes; push after commit: no
- **CI:** none yet
- **Off limits:** anything outside this project folder; never create a GitHub repo, push or deploy
- **Conventions:** see the rules below

### Product rules

- **Hosting:** GitHub Pages, so static files only: no server, no secrets. The app must work under a repository sub-path (relative Vite `base`) and on deep links (hash routing).
- **Data:** persisted in the browser (IndexedDB) behind async repository interfaces in one data layer. UI code never touches Dexie directly, so a real backend can replace it later. Permission checks live in the service layer as well as the UI.
- **Honest limits:** this is a demo without a backend. Emails go to an in-app Outbox (with a mailto option), online payments are clearly labelled as simulated and never ask for real card data, and third-party sync is done through file import/export. Never present a simulated action as real.
- **Demo accounts (seeded):** `admin@jet.demo` (administrator, billing manager), `lead@jet.demo` (project lead), `employee@jet.demo` (regular employee). Password for all: `jetdemo123`. All people, client companies and figures in seed data are fictional.
- **Brand:** "JET Time" by JET Engineering. Primary colour mediumseagreen (#3CB371). White text on it fails WCAG AA, so use dark text on it or a darker shade of it. Do not use Harvest's name, logo, artwork, wording or visual identity in the product.
- **Correctness:** store time as integer minutes and money as integer minor units; calculate invoices, budgets and reports in pure, unit-tested functions. Store dates as local ISO dates (YYYY-MM-DD).
- **Quality:** usable on phone and desktop, keyboard accessible, with loading, empty and error states, and confirmation before destructive actions.
