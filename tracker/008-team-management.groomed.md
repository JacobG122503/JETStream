# 008 Team management

## Request
Depends on: 007

User: "full admin controlls for managers alos to add emplyees see time breakdowns". Team list with hours, capacity, utilization and billable split by week. Add, invite, edit, archive and delete people; employee/contractor; roles (descriptive labels such as Engineer, Technician); weekly capacity; billable and cost rates with effective dates and history; assigned projects and client companies; permissions; pending sign-up approvals; per-person time breakdown page.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Note from 005 PM: email edit, archive and delete must use 005's outranking rule; archive and delete also its last-administrator guard.

## Spec
### Goal
JETStream shows management who works at JET Engineering, how full each person's week is and how much of it is billable, and where each person's hours went. Those in charge of people add, correct, archive and remove them, and keep capacity, labels and dated rates, without rewriting anything already invoiced.

### User stories
- As the administrator, I want to add employees and contractors, with or without an invite, so that they can be planned and given work before they first sign in.
- As the administrator, I want to keep rates with effective dates and see their history, so that a raise applies from the right day.
- As the administrator, I want to archive someone who leaves, at once and without losing their history.
- As a project lead, I want to see my people's hours, capacity, utilization and billable split week by week, and open one person's breakdown, so that I notice who is overloaded or idle.
- As an employee, I want to see a breakdown of my own hours.

### Fit with other tasks
- **004, 005 (existing):** requests, invites, reset links, assignments, Access section, permission decisions, outranking rule and last-administrator guard. The person page here is 004's, extended.
- **006:** figure functions, formatting, server-side list (search, sort, paging). Reused, not rebuilt.
- **Assumed to be 007's:** everything kept on a project: its team from the project side, member rate, member budget and manager flag, task library and task rates, tags, project pages with breakdown by person, creating, archiving and deleting projects. Its member pickers offer active people only. This task changes none of these; it reads memberships, shows the member rate and links to project pages. Memberships are changed here only through 004's section. If 007 defines it otherwise, its spec wins and the engineer says so.
- **Later:** 009 entering time, 010 submission status, 016 team reports and cost figures, 019 time off in capacity, 021 import and export, 022 activity log screen.

### Rules
- **Who.** Everything follows 005. "Covering" is 005's table.

| Part | Needs |
|---|---|
| List, person page, name, email, phone, photo, role, kind, labels, start date, capacity, managed by | `people.view` covering the person |
| Notes; all changes except rates; requests, invites, help requests, labels | `people.manage` |
| Edit email, archive, restore, delete | `people.manage` and the outranking rule |
| Hours, utilization, time breakdown | `time.view` covering the **person** (so figures are always complete); own hours always |
| Billable rates: see / change | `billable.view` / `billable.edit` covering the person |
| Cost rates: see / change | `cost.view` / `cost.edit` covering the person |
| Billable amounts | additionally `billable.view` covering each entry |
| Projects / clients of the person | `projects.view` / `clients.view`; only covered ones. Member rate: `billable.view` covering the project |

- **Outranking** of an archived or pending person is judged by what they would hold if active.
- **Fields** (trimmed, control characters refused): name and email as in 004; phone up to 40; kind employee or contractor; weekly capacity 0 to 168 hours, typed as `37.5` or `37:30`, stored as the nearest whole minute (default 40); start date (default today) and time zone optional; labels up to 10; notes up to 5000, internal.
- **Labels** are descriptive (Engineer, Technician), 1 to 40 characters, unique ignoring case, and give no access.
- **Rates** are in company currency, 0 to 1,000,000 major units with at most the currency's decimals. One per person, kind and start date. Each applies until the next one starts; the first may apply "from the beginning". Before the first one the rate is missing (003 AC12). 0 is a rate.
- **Figures** are pure functions in `src/shared/calc`. Hours and billable hours as in 006 (running entries left out, rounding per entry, time on non-billable projects never billable). Weeks start on the company's day; "today" is in the company time zone.
  - **Capacity** of a period = weekly capacity × weekdays (Monday to Friday) from start date to archive date, both included, within the period ÷ 5, rounded once. No start date means no lower limit. Today's weekly capacity is used for past weeks too.
  - **Utilization** = hours ÷ capacity; **billable share** = billable hours ÷ hours; whole percent, half away from zero, may exceed 100%. No figure (a dash) when dividing by 0. Team totals divide the sums; they are not averages of percentages.

### Acceptance criteria
**Team list**
1. **AC1** `/team` People shows, for one week, per covered person: photo or initials, name, kind, labels, role, hours, capacity, utilization (number and bar), billable and non-billable hours, billable share; and totals of all listed people, not only of the page. People not covered by `time.view` show no hour figures and count in no hour, capacity or utilization total. Without `time.view` at any level the hour columns and their data are absent.
2. **AC2** Previous, next, "This week" and a date picker choose the week, shown as a date range; default is the current one. Week, search, filters, sort and page are in the address, survive reload and Back, and are done by the server (25 per page; unknown sort, page size above 100 or invalid date 400; sort by a figure the viewer may not see 400).
3. **AC3** The default filter lists active people and, marked "Archived", covered archived people with hours in that week. Other filters: Archived, All (pending never), kind, label, role. Search finds parts of name, email and label, literally, ignoring case. Sort by name (default), hours, capacity, utilization and billable share, people without the figure last.
4. **AC4** For every seeded active person, the weeks of each 003 AC29 date and each of 005 AC3's actors, figures and totals equal values worked out separately from stored rows.
5. **AC5** People with `people.manage` see the number of waiting requests and open help requests on their tabs. `/team` links to nothing the viewer may not open.
6. **AC6** With 200 people and 100,000 entries, the list answers within 1 second and a one-year breakdown within 2 (conditions of 006 AC4). Measured and reported.

**Add and invite**
7. **AC7** "Add person" takes name, email, role (Member preselected; others as in 005 AC8), kind, capacity, start date, labels, client and project assignments, and, for those who may change them, first rates; and "Invite to sign in now" (on) or not. It creates an active person, and with the invite also shows 004's link once, all in one transaction. A person without a password cannot sign in.
8. **AC8** Refused with 409 and a specific message: an address of an active person (`email_taken`), an archived one (`archived`), a pending request (`pending_request`), an open invite (`open_invite`); each with a link to it where the viewer may open it. Two at once: one person. Submitting twice creates one.
9. **AC9** This form replaces 004's invite form; the Invites tab keeps its list and actions, also names who revoked an invite (unknown for older ones), and invites already open for someone who is not a person yet still work. An invite of an existing person carries no role or assignments: accepting keeps those the person has at that moment.
10. **AC10** Approving a request (004) and accepting an invite set an empty start date to today. After approval the page offers "Complete details".

**Person page and edit**
11. **AC11** `/team/<id>` shows the parts of the Rules table, each only to those who may see it, with sign-in state, "Managed by", and status. Hidden data is absent from all responses. Unknown, malformed and uncovered ids: the same 404.
12. **AC12** Details can be edited with a stale check (409, typed values kept, reload offered). Server and form apply the same rules, with errors at the fields. Saving details changes no role, rate or assignment. Archived people's details are read-only except by restore.
13. **AC13** Email has its own dialog. A change is refused with AC8's codes, voids the person's open invites and reset links in the same transaction, and produces a message to the old and the new address. Sessions stay. Nobody can change their own except an Administrator, who must give the current password (004's limit).
14. **AC14** Labels can be created while editing a person, and renamed or deleted (confirmation with the number of people; the number only, not names) in a list. A name in use: 409.

**Rates**
15. **AC15** Billable and cost rates are two lists, each by start date, newest first, with the current one marked, future ones named as such, and "from the beginning" instead of a technical date. Add, edit and delete need the permission of that kind; a response never contains the other kind. Same start date again: 409 `rate_exists`. Stale edits: 409.
16. **AC16** Saving or deleting a rate that takes effect today or earlier asks for confirmation naming the first date affected, and says that amounts not yet invoiced change and invoiced ones do not. Deleting the only applicable rate says that hours will have no rate.
17. **AC17** Tested: after adding, changing and deleting a back-dated rate, each entry resolves as in 003 AC12, member and project rates still win, stored invoice figures are unchanged, and a claim in progress bills either the old or the new rate for all its entries of that person, never a mix.

**Archive, restore, delete**
18. **AC18** Archive asks for confirmation naming, within the viewer's coverage: active projects left without an active manager, people left without one, and unsubmitted hours. In one transaction it sets status and archive date (today), ends sessions, voids reset links, the person's open invites and help requests, and stops a running timer, adding the elapsed time to its minutes (at most 1440 in total). Role, rates, memberships, flags and logged records stay. Unused invites and reset links the person made end for good in the same transaction, so that restore does not revive them (005 AC14).
19. **AC19** Refused: one's own account (409 `own_account`), the last administrator (005 AC15), a person holding more than oneself (403), a pending person (409 `not_active`; use Decline). The same for delete.
20. **AC20** One helper, run in the caller's transaction, locks a person for new work and refuses archived, pending and missing ones with distinct errors; archive and delete take the conflicting lock. It has a place in the lock order in `docs/data-model.md`. Tested with a time entry inserted through it, in both orders.
21. **AC21** Restore makes an archived person active again with their role, memberships and flags, clears the archive date, and says that an earlier password works again, offering a reset link.
22. **AC22** Delete is offered only for an active or archived person who has no history: nothing refers to them except what is merely theirs (credential, sessions, links and invites to them, photo, rates, labels, memberships, assignments, manager links, preferences). Otherwise the page names the kinds of record and suggests archiving, and the API answers 409 `person_in_use`. A test lists every foreign key to `people` as "goes with" or "blocks" and fails for an unlisted one; being the actor in the activity log blocks. All in one transaction; nothing else is deleted.

**Time breakdown**
23. **AC23** `/team/<id>/hours` shows a person's time for a week, month, quarter, year or custom range up to 731 days (default this week; previous and next; kept in the address): hours, capacity, utilization, billable and non-billable hours, billable share; a chart by day (up to 31 days), week or month, with a table of the same numbers; and hours and billable hours by client, project and task, whose sums equal the total.
24. **AC24** Where allowed, billable amounts per currency (006's rules; currencies never added, hours without a rate and fixed-fee hours named) per group and in total. No costs.
25. **AC25** Below, the entries of the period, newest first, paged: date, client, project, task, notes (as text), hours, billable, status. Choosing a group limits them to it. Read-only; project names link where the viewer may open them.
26. **AC26** `/account/hours`, "My hours" in the account menu, shows every active person their own, without needing `people.view` or `time.view`. Another person's hours route answers as 005 says, and no id in the address or query changes whose hours it shows.

**Record and quality**
27. **AC27** Adding, editing, email, label, rate, archive, restore and delete are written to the activity log in the same transaction with who, whom, when, before and after (for notes only that they changed). Rate changes are entries of their own, per kind, with amounts only in the stored values, not in the summary. A refused change writes nothing.
28. **AC28** All screens meet 004 AC39; charts are not by colour alone; 100-character names and 10 labels do not break the layout. No console errors.
29. **AC29** Any migration follows 003 AC1 and loses nothing. 001 to 007 and 027's criteria still hold except 004 AC25's form (AC9 here) and AC26's role and assignments for existing people. `npm run build`, `lint`, `test` and `e2e` pass; e2e covers the list for each demo account, and for the administrator add with invite and acceptance, rate, archive and restore, and the lead opening a breakdown.

### Test scenarios
1. Demo: administrator: nine active people, week figures; a week 14 weeks ago also lists Lydia Farrow, "Archived". Lead: exactly Casey, Marcus, Tomas and Owen (Lydia under Archived), with billable rates, no cost key in any JSON; Priya's page and hours: 404. Employee: no Team; My hours works; another id's hours route: 403.
2. Figures, rounding off, capacity 40: Mon 480 min billable; Tue 300 billable and 180 not; Wed 60 flagged billable on a non-billable project; one running entry with 30 stored. Hours 17.00, billable 13.00, utilization 43%, billable share 76%. With a second person of capacity 30 and 30.00 hours, all billable: totals 47.00 of 70.00, 67%, 91%.
3. Capacity 37.5, week Monday to Sunday: started Wednesday: 22.50; archived Tuesday: 15.00; started the following week: 0 and a dash; February 2026: 150.00. Capacity 0 with 5.00 hours: a dash, no error.
4. Week start Sunday: an entry on Sunday belongs to the week it starts. At 23:30 and 00:30 Chicago time around the week change: "This week" differs.
5. Add `New.Hire@Example.com` as contractor, 37:30, label "Technician", one project, invite on: listed at once, state invited. Change role to Manager, then accept the invite: signed in as Manager with the project. Add without invite: cannot sign in; Invite from the page later works.
6. Custom role "Team manager" (Manager's permissions plus `people.view` and `people.manage` at `all`): adds a Member; adding an Administrator, editing the administrator's email, archiving or restoring an administrator: 403, nothing changed. Choosing Manager without `roles.manage`: 403.
7. Rates: 110.00 from the beginning, 118.00 from 2026-07-01. Entries on 2026-06-30 and 2026-07-01 resolve 11000 and 11800. Invoice the second, add 130.00 from 2026-06-15: first 11000 for 06-14, 13000 for 06-30, invoice unchanged. Add again for 2026-06-15: 409. Delete all: missing, hours named.
8. Edge: person invited, email changed, old link opened: "no longer works", no second person. Reset link open, email changed: link void.
9. Edge: archive someone signed in elsewhere with a timer started 90 minutes ago: their next request 401, the entry gained 90 minutes; restore: signs in with the old password, memberships and flags back; a session not used while archived answers 401 after the restore, and an invite and a reset link they had made still "no longer work".
10. Edge: two administrators archive each other at once: one 200, one refused. Last administrator with a password: 409 `last_administrator`. Self: 409 `own_account`.
11. Failure: delete a person with a time entry, with only an activity entry as actor, who made an invite: 409 `person_in_use` naming it. Delete one just added with rates, labels, project and open invite: gone, link dead, project and client unchanged.
12. Failure: capacity `-1`, `168.01`, `abc`; start date `2026-02-30`; rate `-1`, `118.005`, `1000000.01`; 11 labels; label of 41 characters or `engineer` twice; name of 101: 400 (duplicate label 409) at the field, nothing stored or logged.
13. Failure: lead with `billable.view` only calls rate add, edit, delete, person edit, archive, with valid and invalid bodies: 403. Sort by hours by a holder of `people.view` only: 400. `/team/abc`, `/team/99999999999`: not found, no 500. Notes `<img src=x onerror=alert(1)>`: text.
14. Race: archive while a time entry is added through AC20's helper, in both orders: no new entry for an archived person.

### Out of scope
- Everything listed under 007 and Later above. Changing access (005's section), managed people from the managed person's side.
- Dated capacity, work schedules, time off and holidays in capacity (019); planned hours (020); missing timesheets (010); cost, margin and trend (016); export and printing (015, 021).
- Bulk add or edit, CSV (021). Changing someone else's photo or password. Archive on a future date. Merging people, erasing or anonymising people with history. Custom fields, documents, payroll data.
- Rates per client, per task and person, or in other currencies.

### Assumptions
- "Full admin controls for managers" means JET's management: Administrators, or anyone given a custom role with `people.manage` (scenario 6). The demo's project lead sees people and time breakdowns but does not add people, as 005 decided.
- Harvest's "roles" are called labels here, since role means access.
- Utilization is all hours against capacity, as in Harvest; the billable split is shown beside it.
- Monday to Friday counts for part weeks until 019 replaces the capacity function. A changed capacity changes past utilization; accepted, as in Harvest.
- Someone who ever acted in the app is archived, not deleted, so that the activity log stays true.
- Rates can be changed back in time, since fixing a late raise is common; invoices are safe through stored amounts.

### Notes for the engineer
- Today `acceptInvite` writes the invite's role over the person's and finds the person by the invite's email: both matter for AC9 and AC13.
- AC18 (from 004): today an archived person's sessions end only at their next request. Archiving must lock the person's row first and call `endSessions` in the same transaction; `beginSession` relies on that lock, so a sign-in under way comes wholly before or after.
- `project_members`, `files` and `invites` do not cascade from `people`; `activity_log.actor_id` does not either.
- Aggregate hours in SQL only if rounding per entry stays exact; filters belong inside the queries (005).
- Keep stopping a timer in one function, for 009.
- PGlite runs transactions in turn: add the races to the real-server setup and say what was not run.

### Size
L. Build order: figures, person services with helper and guards, rates, list, add and edit, archive and delete, breakdown. Not split: 010 needs the list and the breakdown is the request's point.

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
- 2026-11-24 PM: AC9, AC18, scenario 9 and an engineer note extended (from 004 acceptance)
