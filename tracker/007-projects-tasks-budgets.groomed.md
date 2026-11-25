# 007 Projects, tasks and budgets

## Request
Depends on: 006

Task library (default billable flag and rate, common tasks added to new projects, archive). Projects: client, name, code, dates, notes, tags, status, time & materials / fixed fee / non-billable; billable rate by project, task, person or none; budget by total hours, total fees, hours per task, fees per task, hours per person or none, with monthly reset, include expenses, show budget to everyone, and an alert percentage. Team and task assignments with rates and project-manager flag. Duplicate, archive, pin, delete. Project page with budget progress, charts and breakdown by task, person and invoices.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Note from 005 PM: project creation and duplication that set or copy a manager flag must go through 005's grant check; treat removed memberships as in 004.

Note from 006 PM: use 006's client lock helper (AC15) when creating, restoring or moving projects, and its client creation and choice services (AC16) for `projects.create`; link project names on the client page; optionally offer archiving a client with its projects.

## Spec
### Goal
In JETStream, JET Engineering sets up its projects once (client, tasks, team, how the work is billed, and the budget) and then sees at a glance how each one stands. The billing manager sees everything, a project lead runs their own projects without touching money unless allowed, and an employee sees the projects they work on.

### User stories
- As the billing manager, I want a task library and projects with clear billing terms, so that time is logged and billed the same way everywhere.
- As a project lead, I want to set up team, tasks and hour budgets of my projects and see what is used and left, so that I act before a budget is gone.
- As a project lead, I want to create a project, or copy a similar one, so that I need not wait for the office.
- As an employee, I want to see my projects with their tasks and teammates, and the budget where my lead shares it.
- As a developer of 008 to 022, I want shared project services, locks and budget functions, so that every screen agrees.

### Rules
**Who.** Everything follows 005. "Covers" means the permission covers this project. Opening a project needs `projects.view` covering it or an active membership; otherwise 404.

| Part or action | Needs |
|---|---|
| Name, code, client name, dates, active tasks' names, active teammates' names and photos, own hours | member, or `projects.view` |
| Notes, tags, type, rate method, task billable flags, managers, hour budgets, budget options, status of tasks and team | `projects.view` |
| Hours, hour-budget use, breakdowns, charts, expense totals | and `time.view` covering |
| Rates, fixed fee, fee budgets | and `billable.view` covering |
| Billable and unbilled amounts, fee-budget use | and both |
| Invoices | and `invoices.manage`; only covered invoices |
| Name, code, dates, notes, tags, team, tasks, task billable flags, hour budgets; archive, restore, delete | `projects.edit` covering |
| Type, rate method, rates, fixed fee; anything about a fee budget (setting, changing, removing, its options) | and `billable.edit` covering |
| Manager flag | 005's grant check, nothing else |
| Task library | `tasks.manage`; default rates need `billable.view` at `all` to see and `billable.edit` at `all` to set |

- **Show budget to everyone:** active members also see the whole budget's value, used and left (also in money), its rows per task, and for hours per person only their own row and the total. Never rates, other amounts or other people's hours.
- **New projects** need `projects.create`. The creator becomes member and manager, as 005 says; someone with `projects.edit` at `all` may leave themselves out. What else they may set is judged as if they already managed it. Without `billable.edit` the type is time & materials by person rates or non-billable, with no amounts.
- **Any active person** may be put on a team by a holder of `projects.edit` covering, who is offered names and photos only.
- **Field limits** (trimmed, as in 006): project name 1 to 100; code up to 20; notes up to 5000, plain text; tags up to 10 of 1 to 30 characters; task name 1 to 100, unique ignoring case, archived ones included. Names and codes of projects need not be unique. End date not before start date. Money 0 or more with the currency's decimals, rates up to 1,000,000 and other amounts up to 1,000,000,000 major units; total budgets above 0; hour budgets in whole minutes; alert 1 to 100, whole percent.
- **Types and rates.** Time & materials: rate by project (rate required), task, person or none. Fixed fee: fee required; a rate method may be set too and is used only to value work against a fee budget. Non-billable: no rates, fee or fee budget. Fee budgets need a rate method other than none. A setting that no longer applies is cleared when saved, after a warning; amounts on tasks and members are kept but have no effect, and the form does not show them.
- **Rate overrides** of a task or member are in the client's currency. An empty one uses the default (003 AC12), which is shown beside it; where the default is in another currency the page says a rate is needed.
- **Budgets.** One of: none, total hours, total fees, hours per task, fees per task, hours per person. Options: monthly reset (not for none), include expenses (total fees only), show to everyone, alert percentage. With monthly reset the budget is for each calendar month by entry date, "today" being in the company time zone; nothing carries over.

**Budget figures** are pure functions in `src/shared/calc`. 006's Figures rules apply (no running entries, rounding per entry, missing rates and other currencies named, never silently left out).
- Hours used: all entries, billable or not.
- Fees used, time & materials: 006's billable amount of time, plus billable expenses if included. Fixed fee: each billable entry at the rate of the project's rate method, invoiced or not. This value is used for budgets only; 006's figures do not change.
- Per task or person: budget and used are the sums over active rows that have a budget. Use on rows without one, or removed, is shown apart.
- Percent = used ÷ budget, shown as a whole percent rounded down. **Alert** when used reaches the alert percentage; **over** when used exceeds the budget (exact comparison). A row is also marked over on its own.

### Acceptance criteria
**Task library**
1. **AC1** `/projects/tasks` lists tasks (name, billable by default, default rate where allowed, common, number of active projects, archived) with search, Active/Archived/All and server paging. Holders of `tasks.manage` add and edit; stale edits answer 409, a name in use 409 `name_taken`.
2. **AC2** New projects start with all active common tasks. "Add to all active projects" (needs `tasks.manage` and `projects.edit` at `all`) confirms the number, adds or brings back the task, and skips projects that have it.
3. **AC3** An archived task is not offered for adding; projects that have it keep using it, and the confirmation gives their number. Restore undoes it. Delete is possible only while no project (removed rows included) and no schedule assignment uses it; otherwise 409 `task_in_use` and archive is suggested.

**Create and edit**
4. **AC4** `/projects/new` and Edit offer exactly the fields the person may set; others are absent or read-only with the reason, and the server refuses them with 403. Server and form apply the same limits with 002's field errors and keep what was typed. Submitting twice creates one project.
5. **AC5** The client is chosen from 006 AC16's list, or created there with name and currency. Creation takes 006's client lock; an archived client gives 409 and creates nothing (new client included). Project, tasks, team and tags are saved in one transaction.
6. **AC6** Every write that stores an amount on a project, its tasks or members takes the client lock, so that it cannot race 006's currency change.
7. **AC7** The client of a project can be changed by holders of `projects.edit` covering it who may also choose clients (AC5), while the project is on no invoice line, estimate, recurring invoice or retainer, and, if the currency differs, has no stored amount and no expense. Otherwise 409 `client_locked` naming why. Both clients are locked in id order; current members are assigned to the new client and keep the old one.
8. **AC8** Saving a change of type, rate method or rate on a project with billable hours not yet invoiced asks first, saying it changes the value of those hours, past ones included (with their number where `time.view` allows). Invoiced amounts never change.
9. **AC9** Edits of settings, tasks and team each have a stale check (409, typed values kept, reload offered). One part changed by someone else does not make another stale.
10. **AC10** Tags are chosen or created while typing, ignoring case; a tag of the same name is reused, also when two people create it at once.

**Tasks and team**
11. **AC11** Tasks are added from the library (new ones inline with `tasks.manage`), with billable flag (from the default; off on non-billable projects), rate and budget where they apply. Removing keeps time, rate and row (003) and adding again brings it back. A changed billable flag applies to new time only, and the page says so.
12. **AC12** Members are added by search, with rate and budget where they apply, through 004's assignment rules (client assigned too, removed rows restored). Removing keeps time and rates; the client assignment stays. Archived and pending people are not offered; archived members are shown as such.
13. **AC13** Setting or clearing a manager flag, removing a current manager, and restoring a kept flag go through 005's grant function; a refusal changes nothing, except that a restored member comes back without the flag and the page says so (005 AC13). Creation gives the flag to the creator only. No request field or other route sets it.
14. **AC14** A project without active tasks or members says that nobody can log time on it.

**Archive, restore, delete, duplicate, pin**
15. **AC15** Archive asks for confirmation. An archived project keeps page, history and figures, is marked archived, is offered nowhere for new work, and can only be viewed, pinned, duplicated, restored or deleted (other changes 409 `project_archived`). Restore takes the client lock; an archived client gives 409 `client_archived`.
16. **AC16** Delete is possible only while there is no time entry (running included), expense, invoice line, estimate, recurring invoice, retainer or schedule assignment; otherwise 409 `project_in_use` naming the kinds, and archive is suggested. The confirmation names what goes with it (tasks, team, milestones, favourites, places in open invites); all in one transaction.
17. **AC17** Where 006 refuses to archive a client because of active projects, holders of `clients.manage` and `projects.edit` at `all` may archive the client with them, after a confirmation naming the number; all or nothing. An active recurring invoice still refuses.
18. **AC18** Duplicate needs `projects.create` and `projects.edit` covering the original. It asks for client, name, code, dates, and whether to copy tasks, team and notes; it copies settings, tags, budget and options, and no time, expenses, documents, pins, alerts, removed rows, archived tasks or inactive people. Amounts are left out if the currency differs or the person lacks `billable.edit` covering the original (then as for a new project), and managers other than the creator unless the grant check passes; the dialog says what is left out.
19. **AC19** Anyone who can open a project can pin it, for themselves only; pinned ones come first in their list.

**List**
20. **AC20** `/projects` lists what the viewer may open, grouped by client: name, code, dates, pinned, archived, and where allowed type, budget, used, left and a progress bar with Alert or Over in words. Budget columns are absent for projects whose budget they may not see.
21. **AC21** Search (name, code, client name; literal as in 006 AC2), filters Active/Archived/All, client, manager, tag, "my projects", sort by client and name (default), name, end date or date added, and paging are done by the server as in 006 AC3. Manager and tag filters need `projects.view` at any level, and match only projects it covers. Sort by a hidden or unknown field: 400. Counts and filter choices reveal nothing outside coverage.

**Project page**
22. **AC22** `/projects/<id>` shows the parts of the Rules table, each only to those who may see it; hidden data is absent from all responses. Bad, unknown and not covered ids answer alike (006 AC18). The client's name links to its page, and 006's client page links to projects, only where they may be opened.
23. **AC23** Budget: value, used, left (or over by), percent, period, and rows per task or person. Progress is never shown by colour alone. Expenses in another currency and hours without a rate are named.
24. **AC24** Figures for All time, This month or Last month (first choice: This month with monthly reset, else All time): hours, billable hours, billable and unbilled amount, expenses, and breakdowns by task and by person (removed ones included while they have time). For a viewer with everything at `all`, each breakdown adds up exactly to the totals, and All time equals the project's row on 006's client page.
25. **AC25** Charts: hours per week, billable and not (company week start, last 26 weeks); and budget use, cumulative per week against the budget line, or per month for the last 12 months with monthly reset. The last cumulative value equals the used figure. Each chart has a table with the same figures, a text summary, and works in both themes and at 320 px.
26. **AC26** Invoices: covered invoices with a line on the project: number, issue date, state as in 006 AC21, the project's lines before discount and tax, invoice total; newest first, paged. Numbers are not links until 012.
27. **AC27** Every seeded project's figures and budget equal values worked out separately from stored rows, for each of 005 AC3's actors; list and page agree.

**Shared services and quality**
28. **AC28** For 009, 011, 014 and 020, one helper in the caller's transaction locks a project for use and refuses a missing or archived project, an archived client, a task not active on it, or a person not an active member, each with a distinct error. Archive, delete, and removing a task or member take the conflicting lock. Lock order is client, project, then 003's; `docs/data-model.md` says so. Creation, duplication and budget figures (for one or many projects) are services with 005 AC9's actor check, usable by 014, 015, 017, 018 and 021.
29. **AC29** Create, change, archive, restore, delete, and every change of tasks, team, rates, budget and library is in the activity log in the same transaction, with before and after; amounts are separate fields, so that 022 can apply the field rule. Refused changes log nothing.
30. **AC30** With 1,000 projects, 200 people and 20,000 entries, the list answers within 1 second and a project page with all entries on one project within 2 seconds (measured as in 006 AC4, reported).
31. **AC31** All screens meet 004 AC39; names of 100 characters without spaces do not break the layout; losing access or the project while a page is open behaves as in 006 AC23. No console errors.
32. **AC32** Migrations follow 003 AC1 and lose nothing. The seed changes only as needed: "Control system integration" gets rate method task and task budgets that its work fits (fee 86,000.00 and all invoices unchanged). 001 to 006 and 027 criteria still hold. `npm run build`, `lint`, `test` and `e2e` pass; e2e covers, for each demo account, list and page, and for the administrator create, edit, team, archive and duplicate.

### Test scenarios
1. Demo lists. Administrator: 11 active, 1 archived. Lead: 6 active (manages Turbine, Substation, Pump station, Cold store; member of Company administration and Training), 1 archived. Employee: 6 active, with budget figures on Turbine and Cold store only; their JSON has no rate key and no one else's hours. Cold store is marked Over, Turbine Alert.
2. Lead (`billable.view`, no `billable.edit`): Turbine shows rates read-only; changing notes, team and tasks works; changing the fee budget by API: 403, unchanged. Creates a project for Kestrel: time & materials by person, lead is manager, and page opens at once; sending `rateMethod: project, rate: 100` : 403, nothing created.
3. Total fees 1,000.00 USD, project rate 100.00, expenses included, alert 80, rounding off: 300 min billable, 60 not billable, 60 invoiced at 90.00, 60 billed outside, one running; expenses 45.00 billable, 30.00 not, EUR 20.00 billable. Used 735.00, left 265.00, 73%, EUR 20.00 named. 66 min more: 845.00, 84%, Alert. 93 min more: 1,000.00, 100%, not over. 1 min more: 1,001.67, over by 1.67. In hours, the first set is 8.00; a budget of 10.00 gives 80% and Alert.
4. Hours per task: A 10.00, used 4.00; B 5.00, used 6.00; C none, used 3.00. Total 10.00 of 15.00, 66%, B over by 1.00, 3.00 hours without a budget.
5. Fixed fee, rate by task 128.00, fees per task: 600 min give 1,280.00 used, also after they are invoiced at 0; unbilled stays 0.
6. Edge: monthly 40.00 hours, 35 in October, 10 in November: 35.00 used on 31 October 23:30 Chicago time, 10.00 at 00:30 on 1 November.
7. Edge: EUR project by person without member rate: the team says a rate is needed, and its hours are named as missing a rate. JPY project rate 5000: stored 5000; `50.5`: 400.
8. Edge: remove a member with rate 150.00 and time, add again: same figures throughout, rate 150.00. Remove a task with time: breakdown still shows it.
9. Edge: duplicate a USD project with a co-manager to a EUR client, as administrator: amounts left out, co-manager kept; as lead: co-manager is plain member, and the dialog says both.
10. Failure: lead sets another's or their own manager flag, sends `isManager` on adding, removes a co-manager: 403, unchanged. Lead on Assembly line retrofit: 404 for view, edit, duplicate, pin, the same body as an unknown id. Employee on create, edit, task routes with valid and invalid bodies: 403.
11. Failure: empty name, 101 characters, end before start, alert 0 and 101, 80.5, budget 0, negative rate, fixed fee missing, rate method project without rate, fees budget with method none or non-billable, monthly with none, expenses with hours, 11 tags, unknown client, task, person: 400 each at the right field, nothing stored.
12. Failure: delete Substation inspections: 409 naming time; restore Conveyor route survey: 409 `client_archived`; change client of Cold store: 409. Delete an unused project: gone; favourites, pins and invite places too. Archived task `Land survey` is not offered; name `engineering DESIGN`: 409.
13. Race: archive a client while creating a project; store a rate while the currency changes; archive a project while 009's helper locks it: in both orders exactly one succeeds.
14. Failure: two windows edit the same budget: the second gets 409 and keeps its text; editing the team in the second works. Notes `<img src=x onerror=alert(1)>`: shown as text. `/projects/abc`, `/projects/0`, `/projects/99999999999`: not found, no 500.

### Out of scope
- Logging time (009), expenses (011), creating invoices (012), estimates to projects (014); milestones and schedule (020).
- Sending budget alerts and assignment notices, and writing `budget_alerts` (018). The page and list show alerts.
- Costs, margins and profit (016); custom ranges, exports, budget report (015); import (021).
- Person default rates (008); rename, merge and delete of tags (022).
- Applying a changed billable flag to existing entries (009). Rates by task and person together, dated project rates, sub-projects, templates, custom fields, files on projects, bulk edit of projects.

### Assumptions
- Unlike Harvest, deleting a project never deletes time; archive instead.
- Status is active or archived; dates inform and block nothing.
- Creating a project for a client makes its creator cover that client (005, 006). Accepted as what `projects.create` means.
- Removing a manager from the project is treated as taking away access, so it needs the grant check; a lead cannot leave their own project. 004's person page keeps its own rule.
- A fee budget counts billable expenses only.
- Rates on projects are not dated: a change also revalues past hours not yet invoiced, hence AC8.
- Someone sharing a fee budget with everyone accepts that rates could be guessed from it; the switch says so.

### Notes for the engineer
- Share 006's rate loading and figure functions; budget use of many projects must be one set of queries, not one per project.
- `people/assignments.ts` restores memberships; after 005 use its flag function rather than a second upsert.
- Schema gaps seen: none certain; unknown combinations (such as fee budget with method none) are checked by services, not the database.
- PGlite runs transactions in turn (003 AC23): add AC5, AC6 and AC28 to the real-server setup and say what was not run.

### Size
L (upper end). Build order: task library; project services, locks and permissions; form, tasks and team; list and lifecycle; budget functions; project page and charts. Not split, because 008 and 009 need the records and 004 to 006 set the order by number; if it must be, cut after "list and lifecycle" (AC23 to AC27, AC30 and the budget columns of AC20 form the second part).


## Implementation notes
_Software engineer fills this in._

## QA report
_QA tester fills this in._

## PM acceptance
_PM fills this in after QA passes._

## History
- 2026-11-23 created
- 2026-11-24 PM: groomed
- 2026-11-24 ORCH: todo -> groomed
