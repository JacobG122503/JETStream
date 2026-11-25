# 005 Roles and permissions

## Request
Depends on: 004

Permission levels Administrator (the billing manager), Manager (the project lead) and Member (the regular employee), enforced in both routes and services. Administrators control everything. Managers manage only their own projects and people, with optional toggles such as create projects, edit billable rates, see cost rates, approve time, create invoices and estimates. Members see only their own time, expenses and assigned projects. Admins can create custom roles from a permission catalogue; nobody can grant permissions they lack or change their own.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Note from 001 QA: `api.param` callbacks are not covered by the handler guard; do not put access checks there.

## Spec
### Goal
Everyone at JET Engineering sees and can do exactly what their job needs: the billing manager everything, a project lead only their own projects and people, an employee only their own work. An administrator decides this on clear screens, the server enforces it on every request, and nobody can raise their own access.

### User stories
- As the administrator, I want to give each person a role, switch on single extras for a project lead and choose whom they manage, so that access follows responsibility.
- As the administrator, I want to make custom roles from a list of permissions, so that a bookkeeper can do billing without controlling everything.
- As a project lead, I want to see my projects and people and nothing that is not my business, so that I can run my work and confidential rates stay confidential.
- As an employee, I want to know that colleagues cannot open my time and expenses, and to see what my own access is.
- As a developer of 006 to 026, I want one place that answers "may this person do this to this record", so that no feature invents its own rule.

### Rules
- **Base access** (every active person, cannot be removed): own account, own time and expenses, own time off and schedule, own hours in reports, own notifications, and the projects they are an active member of (name, client name, code, dates, tasks, teammates' names; no rates, amounts or budget, unless 007's "show budget to everyone" is on).
- **Levels.** A permission is held at level `managed` or `all` (`all` includes `managed`), or is company-wide (shown as `all` in the catalogue). No level means not held.
- **Managed project:** the person is an active member with the manager flag; a removed membership (004 AC34) never counts. **Managed person:** assigned to the manager explicitly. Managing does not pass on (managing a manager does not cover their people), and only `managed` permissions make use of it.
- **What `managed` covers:**

| Record | Covered when |
|---|---|
| Project (with tasks, members, budget) | managed project |
| Client | it has a managed project |
| Person | managed person (a member of a managed project is visible there by name and photo only) |
| Time entry, expense, receipt | its project or its person is managed |
| Invoice | it has at least one project and all its projects are managed, or it has no project and the person created it |
| Estimate | linked to a managed project, or not linked to any and created by the person |
| Schedule assignment | its project or person is managed |
| Time-off request | its person is managed |

- **Own approval.** `time.approve` and `timeoff.approve` at `managed` never cover one's own records; at `all` they do (a lone administrator must be able to work).
- **Administrator** is the built-in role only: it holds every present and future permission. Administrator-only operations, which no permission gives: granting or removing the Administrator role, import, full export, backup and restore (021), reset of demo data (022), webhooks and single sign-on settings (025).
- **Built-in roles** are read-only and cannot be renamed or deleted. Member holds no catalogue permission. Manager holds those marked "yes" below at `managed`, plus the **extras** switched on for that one person, from those marked "extra" (at `managed`, or company-wide for `projects.create`). Only people with the built-in Manager role have extras; a custom role carries all its permissions itself.
- **Grant rule.** A person may change someone's access only if all of these hold: they have `roles.manage`; it is not their own access; they hold every permission the target has before the change and would have after it, at the same or a higher level; and for a managed project or person added or removed, they hold each of the target's `managed` permissions over that record. Access means role, extras, managed people and manager flags. The content of a custom role, held by someone or not, follows the same rule: everything in it before and after must be held by the editor, and the editor must not hold that role.
- **Outranking rule.** Acting on a person's account (reset link, invite for an existing person, and later edit of email, archive, delete and two-factor reset) requires `people.manage` and holding every permission that person has. So nobody can take over an account more powerful than their own.
- **Answers.** Not signed in 401; permission not held at any level 403 `forbidden`; record not covered for viewing 404, identical to a record that does not exist; record viewable but the action not allowed 403. Fields the viewer may not see are absent from the response, not null or masked, and cannot be used to sort, filter, total or export. This also holds for reports, exports, the activity log, the Outbox and API tokens of later tasks.

### Permission catalogue (keys fixed)
| Key | Allows | Levels | Needs (same level) | Manager |
|---|---|---|---|---|
| `people.view` | Team list and person pages (no rates) | managed, all | | yes |
| `people.manage` | Add, invite, edit, archive people; requests, invites, reset links, sign-up switch; client and project assignment | all | people.view | no |
| `roles.manage` | Roles, extras, managed people and projects (grant rule) | all | people.view | no |
| `clients.view` | Client pages and contacts (no amounts) | managed, all | | yes |
| `clients.manage` | Create, edit, archive clients and contacts | all | clients.view | no |
| `projects.view` | Project pages (no amounts) | managed, all | | yes |
| `projects.edit` | Edit, archive, delete projects; team, tasks, hour budgets | managed, all | projects.view | yes |
| `projects.create` | Create projects (creator becomes its manager) for any active client, shown by name only, or a new client with name and currency | all | | extra |
| `tasks.manage` | Task library and expense categories | all | | no |
| `time.view` | Others' time and expenses | managed, all | | yes |
| `time.edit` | Enter, edit, delete others' time and expenses | managed, all | time.view | extra |
| `time.approve` | Approve, reject, withdraw approval of time and expenses | managed, all | time.view | extra |
| `time.unlock` | Unlock locked periods and entries | all | time.view | no |
| `expenses.reimburse` | Record reimbursement | all | time.view | no |
| `billable.view` | Billable rates, billable amounts, fee budgets | managed, all | | extra |
| `billable.edit` | Edit billable rates and fee budgets | managed, all | billable.view | extra |
| `cost.view` | Cost rates, costs, margins | managed, all | | extra |
| `cost.edit` | Edit cost rates | all | cost.view | no |
| `invoices.manage` | Create, edit, send, delete invoices | managed, all | billable.view, time.view, clients.view | extra |
| `payments.manage` | Record payments, refunds, write-offs, retainers | managed, all | invoices.manage | extra |
| `estimates.manage` | Create, edit, send, convert estimates | managed, all | billable.view, clients.view | extra |
| `schedule.view` | Others' schedule | managed, all | | yes |
| `schedule.edit` | Plan others' schedule | managed, all | schedule.view | extra |
| `timeoff.approve` | Decide time-off requests | managed, all | people.view | extra |
| `timeoff.manage` | Policies, balances, holidays, work schedules | all | people.view | no |
| `settings.manage` | Company settings and modules | all | | no |
| `activity.view` | Activity log | all | | no |
| `outbox.view` | Outbox and message templates | all | | no |

### Acceptance criteria
**Catalogue and decisions**
1. **AC1** The catalogue is defined once in code and is exactly the table above. `docs/permissions.md` describes the rules, catalogue and administrator-only operations in plain words; a test fails if the keys, levels, needs or Manager column there differ from the code.
2. **AC2** Effective permissions follow the Rules for all three built-in roles, for a Manager with each single extra, and for custom roles. Stored keys or levels unknown to the code grant nothing and do not break sign-in or the Roles screen. A key added to the catalogue (shown in a test) is held by Administrators at once and by nobody else.
3. **AC3** A pure decision function answers for actor, permission and record; a second part produces the database filter for lists. For every record type in the "covers" table and for at least seven actors (Administrator, Manager without extras, Manager with all extras, Manager with no managed project or person, Member, custom role with every scoped key at `managed`, custom role with every scoped key at `all`), a test over the demo seed compares both with sets worked out separately from the rules, and shows that list filter and single-record decision agree on every record.
4. **AC4** Edge rules are tested: removed membership with a kept manager flag does not cover; archived managed project still covers; managed person's time on an unmanaged project is covered but that project's page is not; an invoice with one managed and one unmanaged project is not covered; managing a manager does not cover their people; own time is not approvable at `managed` and is at `all`.
5. **AC5** Archived and pending people have no permissions, whatever their role. All decisions use the database state at the request (004 AC4): after a role, extra, managed person or manager flag changes, the affected person's very next request is judged by it without signing in again.

**Enforcement in routes**
6. **AC6** Each route declares public, signed-in, administrator, or one catalogue permission (optionally with "also owner"). 004 AC1's test is extended: for every permission route, a person lacking the permission gets 403 `forbidden`, and an otherwise empty custom role holding only it and what it needs does not. A route declaring an unknown key fails `npm test`.
7. **AC7** Access is checked before the route validates input (a Member sending an invalid body to a forbidden route gets 403, not 400), and ids in the path, query and body are all checked against coverage. A test fails if any router has `param` callbacks registered (001 note).
8. **AC8** 004's administrator routes now need: People list and person page `people.view` (with `managed`, only managed people are listed; others answer 404); requests, invites, help requests, reset links, sign-up switch and assignments `people.manage`. Choosing a role other than Member in an approval or invite also needs `roles.manage` and the grant rule, and Manager is given there without extras. A person with `people.manage` who is not Administrator can use these, and 004's other criteria for them still hold.

**Enforcement in services**
9. **AC9** Services that read or change business data take the acting person and check permission and coverage themselves; with the route check bypassed in a test, each such service still refuses. Lint fails if a route module imports table definitions or the data-access layer (health excepted). Unattended work uses a named system actor that no request can obtain.
10. **AC10** 003's edit guard for time entries and expenses also judges the actor, in this order: not viewable (not found), not allowed (forbidden), then 003's invoiced, approved, stale. `time.edit` does not bypass locks. A change that moves a record to another project or person must be allowed both for where it is and where it goes; otherwise nothing changes. (Being a member of the target project is 009's check.)
11. **AC11** One shared field rule removes billable and cost fields per record, used by later tasks. Tested with people, projects, project members and time entries from the seed for AC3's actors: the JSON has no rate, amount, cost or margin key that the actor may not see, and asking to sort or filter by such a field is refused with 400 `bad_request`.

**No escalation**
12. **AC12** Every route that changes access refuses with 403 and changes nothing when the grant rule is broken: own role, extras, managed people or manager flag; editing a custom role one holds; granting a permission one lacks, or at a higher level; changing a person or role that holds more than oneself; granting or removing Administrator by anyone but an Administrator (also by someone whose custom role has every key at `all`). Exception: an Administrator may set their own manager flag, since it gives them nothing.
13. **AC13** Assigning someone again to a project (004 AC34) restores the manager flag only if the one assigning could grant it now; otherwise the membership returns without the flag and the page says so. Assigning oneself never restores it, except for Administrators.
14. **AC14** The outranking rule holds for creating reset links and for inviting an existing person without a password: refused with 403, no link or record is created, and the page explains that only someone with at least the same access can do this. Links are judged again when used: an invite or reset link is void if its creator is no longer active or could not create it now (for example the role has gained permissions its creator lacks). This replaces "active administrator" in 004's Links rule. Void through lost access is final: a change of the creator's role, extras or role content (also by deleting a role) that leaves them unable to make an unused link ends that link for good in the same transaction, and it does not work again when the access comes back. Making a link checks its creator inside the same transaction, locked in AC16's order, so that none is left over from the moment of losing access. A link that is void only because its target or role gained permissions is judged at each use.
15. **AC15** There is always at least one active Administrator with a password. A change that would leave none is refused with 409 `last_administrator`. Two Administrators removing each other's role at the same time: exactly one succeeds. The check is a shared guard that 008 uses for archive and delete.
16. **AC16** Access changes check the actor's permissions inside the same transaction, with the affected rows locked in a fixed order, so that someone who loses `roles.manage` while granting cannot have it succeed afterwards. Stale edits answer 409, keep what was typed and offer to reload.

**Custom roles**
17. **AC17** At `/settings/roles`, people with `roles.manage` see all roles with description, built-in or custom, and number of people. Opening one shows its permissions in plain words, grouped by area, each with None, Managed or All (only the levels it has). Built-in roles are shown read-only, with Manager's extras marked as optional; Administrator says it can do everything.
18. **AC18** They can create, duplicate (also built-in ones; from Administrator all keys at `all`; from Manager without extras), edit and delete custom roles. Name: 1 to 60 characters after trimming, unique ignoring case, built-in names reserved; description up to 200. Choosing a permission also chooses what it needs, visibly; removing a needed one removes those that depend on it, visibly; the server refuses a list with unknown keys, wrong levels or missing needs with 400. Choices the editor lacks are disabled with the reason.
19. **AC19** Saving a role that people hold asks for confirmation naming how many people are affected and which permissions they gain and lose. Deleting a role held by anyone (any status) or used by an open invite is refused by the server unless another role, allowed by the grant rule, is chosen for them in the dialog; people and invites move in the same transaction. Two at once: one succeeds, the other is told.

**A person's access**
20. **AC20** The person page has an Access section for people with `roles.manage`: role, extras (only for Manager, each with a one-line explanation, nothing preselected, needs handled as in AC18), managed people (search, active people, not themselves) and, for each active project membership, a "Manages" switch. It is saved in one transaction with a stale check. Where the grant rule forbids it, the section is read-only and says why; on one's own page: "You cannot change your own access".
21. **AC21** Below it a summary lists in words what the person can do, and on which projects and people. Changing the role from Manager removes extras, after a confirmation naming them; managed people and flags are kept, have no effect while the role holds no `managed` permission, and are shown as such.
22. **AC22** Account has a read-only "Your access" with the role, the same summary, and that an administrator can change it. The header shows the role name, custom ones included. On phones it keeps room (027 finding): at 320 and 305 px wide, signed in, the brand name is whole and on one line, at least 8 px lie between its text and the avatar, the content of the account button lies inside the button, and there is no sideways scroll, in both modes. The button keeps its accessible name and its height.
23. **AC23** Created, changed and deleted roles and every change of a person's role, extras, managed people and flags are written to the activity log with who, whom, when, before and after, in the same transaction.

**The web app mirrors the server**
24. **AC24** Navigation shows Time, Expenses, Projects, Schedule, Time off and Reports to everyone; Clients with `clients.view`; Team with `people.view`; Invoices with `invoices.manage`; Estimates with `estimates.manage`; Settings with `settings.manage`, `roles.manage`, `activity.view` or `outbox.view`. Order is as in 002. A hidden section opened by address shows "You do not have access to this page" in the shell, with a link to Time, makes no request for its data and logs no console error. `/settings` lists the settings pages the person may open; those not built yet are not listed.
25. **AC25** The session status route gives the web app the person's own effective permissions and nobody else's. When they change while the app is open, the next request or page change updates navigation and buttons without a reload; a 403 leads to the no-access message, not to an error page or sign-in, and data loaded earlier that is no longer allowed is gone from the screen.
26. **AC26** All new screens meet 004 AC39 (keyboard, 320, 375 and 1440 px, axe in both modes, loading, empty and error states, double submit acts once).

**Data and compatibility**
27. **AC27** A migration adds what is missing (such as extras per person) and sets the built-in roles. On a database filled by 003's seed and 004's actions it keeps every person's role; nobody gains a permission beyond the Rules; a second run changes nothing. New tables are in `docs/data-model.md`.
28. **AC28** Demo seed: the lead is Manager with exactly the extras `time.approve`, `projects.create`, `billable.view`. One custom role "Bookkeeper" (`clients.view`, `time.view`, `billable.view`, `invoices.manage`, `payments.manage`, `expenses.reimburse`, all at `all`) is held by one seeded person other than the demo accounts. 003's seed criteria still hold.
29. **AC29** 001 to 004's criteria still hold except where this spec changes them (003 AC4 empty lists; 004 AC1 levels, AC8 here, Links rule, AC35). Their tests are updated, not removed. `npm run build`, `lint`, `test` and `e2e` pass; e2e shows for each demo account the navigation, one refused address and one refused API call.

### Test scenarios
1. Demo: as employee: six navigation items; `/team`, `/invoices`, `/settings/roles` by address: no-access page; the roles API: 403. As lead: those six plus Clients and Team; the team list shows exactly the lead's managed people; opening another person's id: 404, the same body as an id that does not exist. As administrator: all eleven.
2. Extras: administrator switches on `invoices.manage` for the lead: the form also switches on `billable.view`; the lead's open window shows Invoices at the next page change, without signing in again. Switch it off: gone, and `/invoices` shows no access.
3. Custom role: create "Scheduler" with `schedule.edit` at `all`: `schedule.view` at `all` is added. Give it to a person: summary says so. Delete it: refused; choose Member as replacement: deleted, person is Member.
4. Coverage: lead manages P1 and person A; A has time on P1 and P2; B has time on P1 and P2. With `time.view` at `managed`: A/P1, A/P2, B/P1 yes; B/P2 no (404).
5. Edge: remove the lead from P1 (flag kept in the row): P1 and B/P1 are no longer covered at the next request. A `people.manage` holder without `roles.manage` assigns the lead to P1 again: member, not manager, and the page says so. An administrator assigns: manager.
6. Edge: invoice with lines from P1 (managed) and P3 (not): 404 for a lead with `invoices.manage`. Free-form invoice created by the lead: allowed; created by the administrator: 404.
7. Edge: two administrators; each removes the other's role at the same moment: one 200, one refused, one administrator left. The shared guard called directly for the only active Administrator with a password, while a second Administrator has none: `last_administrator` (409 through a route).
8. Failure: custom role "HR" (`people.view`, `people.manage`, `roles.manage`): assigns itself Administrator: 403; assigns Manager to someone: 403 (lacks Manager's permissions); edits role "HR": 403; creates a role with `cost.view`: 403; creates a reset link for the administrator: 403, no link stored; creates one for a Member: works.
9. Failure: an invite with role "Scheduler" made by someone whose role has its permissions, `people.view`, `people.manage` and `roles.manage`, all at `all`; an administrator then adds `cost.view` to the role; the invite is opened: "no longer works". Also: an administrator makes an invite and a reset link, loses the role and gets it back 5 minutes later: both still "no longer works", and New link makes a working invite.
10. Failure: Member sends `{}` to the role-creation route: 403, not 400. Administrator sends unknown key `time.fly`, `clients.manage` at `managed`, `time.approve` without `time.view`, name `administrator`, 61 characters: 400 each, nothing stored.
11. Failure: lead without `time.edit` calls the edit service directly for B's entry on P1: forbidden, unchanged; for B's entry on P2: not found. With `time.edit`, moving B's entry from P1 to P2: refused, unchanged. Approved entry: refused as approved.
12. Failure: lead with `billable.view` but not `cost.view`: the project member JSON has the billable rate and no cost key; sort by cost: 400. Employee: neither key on own entries.
13. Failure: role row with a stored key `old.key`: holder signs in, nothing extra granted, Roles screen opens.

### Out of scope
- The features behind most permissions (006 to 025). This task supplies decisions, filters, field rules and guards, and applies them to what 004 and this task have. Each later task declares its routes and tests its own records.
- Adding people without an invite, editing email, archive and delete (008, with the guards here). Setting manager flag and rates from the project side (007).
- Labels such as Engineer or Technician (008); they give no access. Module switches (022) and token scopes (025).
- Permissions that expire, per-record sharing, deny rules, several roles per person, approval of access changes by a second person, viewing the app as another person.
- Row-level security inside PostgreSQL. Email or notification about access changes (018).

### Assumptions
- Toggles are per person for the built-in Manager, as in Harvest; a custom role covers any other combination. Nothing is switched on by default, because the request calls them optional.
- "Approve time" includes expenses, since 010 submits both together. Deciding time off and planning the schedule are separate.
- Seeing others' expenses follows `time.view`; there is no separate key.
- A lead who manages a person sees all of that person's time, on every project; a lead who manages a project sees everyone's time on that project.
- Leads may not approve their own time unless given it at `all`.
- Members see Reports (own hours) and Schedule (own) in the navigation, as placeholders until 015 and 020.
- `cost.view` reveals what colleagues cost, so it is never part of a role by default.

### Notes for the engineer
- 003 has storage for roles, permission list and manager-to-person; extras probably need a migration. Administrator's "everything" should come from code, not from a stored list.
- Paths that restore or copy a manager flag are grant paths: 004's re-assignment now, project duplication, project creation and import later. Offer one function for setting the flag.
- Filters must be part of the query (pagination and totals are wrong otherwise).
- 026 (two-factor reset) and 008 must use the outranking rule and last-administrator guard; expose both.
- AC14: in 004 a void link works again when its maker is administrator again (`statusOf` in `people/invites.ts`, `requireReset` in `people/resets.ts`; 004 had no way to take a role away). A test in `people/joining.test.ts` relies on it when it gives the role back, and has to change. An ended invite must still be renewable with New link, so `revokedAt` alone does not fit.
- AC22, phone header: at 320 px the account button (`.account-button`, `min-width: 0`) shrinks to 39 px, less than its content, and the avatar begins about 2 px after the brand name; at 305 px (320 px window with a classic scrollbar) they touch. A smaller gap or no caret at this width may be enough; `e2e/brand.spec.ts` measures the name and can be extended.
- PGlite runs transactions in turn, so concurrency tests prove results only (003 AC23); use 003's optional real-server setup for AC15 and AC16, and say what was not run.

### Size
L. Build order: catalogue and decisions, coverage filters, route and service enforcement, escalation guards, migration and seed, Roles screen, Access section, navigation. Not split: screens without the guards, or guards without a way to set access, are of no use to 006 and later.

## Implementation notes
In progress (2026-11-24). Baseline before starting: `npm test` 1340 passed, 16 skipped.

**Design (so that an interruption loses little)**
- `src/shared/permissions.ts`: catalogue, levels, pure list functions (needs, adding and removing with what depends on it, built-in roles, stored form `key:level` in `roles.permissions`). `docs/permissions.md` is compared with it by a test.
- `src/server/access/`: `actor.ts` (who acts, loaded from the database at each request; system actor), `decisions.ts` (pure `covers`/`can`), `filters.ts` (the same rules as SQL), `fields.ts` (billable and cost fields), `grants.ts` (grant rule, outranking rule, manager flag, last administrator, lock order), `roles.ts`, `personAccess.ts`, `links.ts` (who may make a link; ending links of people who lost access).
- `auth/access.ts` (route levels) uses the actor of the session. Services in `people/` take the actor.
- Lock order of everything that changes access: advisory lock `access`, email lock, invites, people by id, roles by id.
- Database: `person_extras`, `roles.description`, `invites.ended_at`, `invites.role_id` nullable with `role_name`.
- Web: permissions in the session, `X-Access` header tells the app that its access changed, page content is mounted anew then.

**Status**: see below; filled in as parts get done.

## QA report
_QA tester fills this in._

## PM acceptance
_PM fills this in after QA passes._

## History
- 2026-11-23 created
- 2026-11-24 PM: groomed
- 2026-11-24 ORCH: todo -> groomed
- 2026-11-24 PM: AC14, scenario 9 and an engineer note extended (from 004 acceptance: void links stay void)
- 2026-11-24 PM: AC22 and an engineer note extended (from 027 acceptance: room in the phone header)
- 2026-11-24 ORCH: groomed -> in-progress
- 2026-11-25 ORCH: implementation interrupted by usage limit; run paused by the user
