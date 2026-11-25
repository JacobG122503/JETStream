# 028 Demoable

## Request
User (2026-11-25): "Finish off 005. Create a task called demoable and do it yourself. Also clean up the app visual wise. make it look super pretty and not like it really is now. Do not use the devteam for this. Do it yourself, make sure to be committing just in case you ruin it."

Done directly by the main session, without the team's PM, engineer and QA stages, as the user asked.

## Spec
A manager can be shown the whole story in one sitting, with the seeded company: track time, see projects and budgets, log an expense, bill a client, record the payment, look at a report. And it looks good doing it.

1. New look for the whole app (type, colour, shell, cards, tables, forms, sign-in page), light and dark, phone and desktop, within the brand rules in CLAUDE.md.
2. Home: what matters now for whoever is signed in.
3. Time: week and day timesheet, timer, add, edit and delete entries.
4. Projects: list with budget progress; page with hours, tasks and team; create.
5. Clients: list and page; create.
6. Expenses: own list; add, edit and delete.
7. Invoices: list with what is owed; create from unbilled time and expenses; printable page; mark as sent; record payment.
8. Reports: hours, billable share and amounts by client, project, person and task.
9. Sections that are not built (Schedule, Time off, Estimates) are not in the navigation.
10. Everything goes through the permissions of 005 and the billing rules of 003.

Left to the planned tasks: what they add beyond this (006 to 017 stay open and build on it).

## Implementation notes
Done (2026-11-25), on branch `demoable`.

- Server: `src/server/work/` (figures, time, projects, clients, expenses, invoices, reports, home), routes in `api/routes/work.ts`, types in `src/shared/work.ts`. Every service takes the actor; billing goes through `src/server/billing` only.
- Web: `src/web/pages/work/`, `src/web/work/` (timer, formats), `ui/charts.tsx`. New look in `styles/tokens.css`, `shell/`, `ui/*.css`; fonts Geist and Bricolage Grotesque, bundled.
- Tests: `work.test.ts` (server, over the demo company), `work.test.tsx`, `format.test.ts`, `e2e/work.spec.ts`; axe at 375 and 1440 px in both modes on every page.

Simpler than the planned tasks, which stay open: no submitting or approving of weeks, receipts, editing of projects and clients, invoice editing, email, estimates, schedule or time off. Project lists and reports value every entry they cover in memory, which is fine for a demo and for a small company; 007 and 015 should add up in the database.

## QA report
_Not run by the team, as the user asked._

## History
- 2026-11-25 created, started by the main session on branch `demoable`
- 2026-11-25 done
