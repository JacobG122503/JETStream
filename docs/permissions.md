# Roles and permissions

The catalogue and the pure rules are in `src/shared/permissions.ts`; the server decides in `src/server/access/`. The web app only mirrors what the server decided. A test compares the table below with the code.

## Who may do what

Everyone has **base access**, which cannot be taken away: their own account, their own time and expenses, their own time off and schedule, their own hours in reports, their own notifications, and the projects they are on (name, client name, code, dates, tasks and the names of their teammates; no rates, amounts or budget, unless a project shows its budget to everyone).

Everything else needs a **permission**. Each person has one role, and a role is a list of permissions, each at a **level**:

- **Managed**: for the projects and people the person manages.
- **All**: for everything. It includes managed.

Some permissions have no managed level. They are for the whole company and shown as All. Archived people and people who wait for approval have no permissions at all.

### Built-in roles

They cannot be changed, renamed or deleted.

- **Administrator** holds every permission there is or will be, and can do what no permission gives (below).
- **Manager** holds the permissions marked "yes" in the table, at managed. Those marked "extra" can be switched on for one person, at managed, or company-wide where there is no managed level. Nothing is switched on by default, and only people with this role have extras.
- **Member** has base access only.

Custom roles are made from the table by people with `roles.manage`. They carry all their permissions themselves.

### What managing means

- A **managed project** is one where the person is a member now, with the manager flag. A flag on a membership that was removed does not count. An archived project still counts.
- A **managed person** is one who was assigned to the manager. Managing does not pass on: whoever manages a manager does not manage that manager's people.
- Only permissions at the managed level make use of either.

| Record | Covered at managed when |
|---|---|
| Project (with tasks, members, budget) | it is a managed project |
| Client | it has a managed project |
| Person | it is a managed person (members of a managed project are visible there, by name and photo only) |
| Time entry, expense, receipt | its project or its person is managed |
| Invoice | it has at least one project and all its projects are managed, or it has no project and the person created it |
| Estimate | it is linked to a managed project (and to no other), or it is linked to no project and the person created it |
| Schedule assignment | its project or its person is managed |
| Time-off request | its person is managed |

`time.approve` and `timeoff.approve` at managed never cover one's own records. At all they do, so that a lone administrator can work.

## Administrator only

No permission gives these; they need the built-in Administrator role:

- granting or removing the Administrator role
- import, full export, backup and restore
- reset of demo data
- webhooks and single sign-on settings

## The catalogue

Keys are stored and never change. "Needs" are held at the same level or a higher one.

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

## Nobody raises their own access

- **Grant rule.** Someone's access is their role, extras, managed people and manager flags. Changing it needs `roles.manage`; it is never one's own; and whoever changes it must hold every permission the other person has before and would have after, at the same or a higher level. To add or take away a managed project or person, they must also hold each of the other person's managed permissions for it. The content of a custom role follows the same rule, whether anyone holds the role or not, and nobody edits a role they hold. One exception: an Administrator may set their own manager flag, which gives them nothing.
- **Outranking rule.** Acting on a person's account (reset link, invite for someone who is already there, and later email, archive, delete and two-factor reset) needs `people.manage` and every permission that person has. Only an Administrator outranks an Administrator.
- **Links** (invites and reset links) are judged when made and again when used, by what their maker may do at that time. A link whose maker lost the access to make it ends for good. A new link can always be made by someone who may.
- **Coming back to a project** restores the manager flag only if whoever assigns the person could set it now. Assigning oneself never restores it, except for Administrators.
- **Last administrator.** There is always one active Administrator with a password.

## Answers of the API

| Situation | Answer |
|---|---|
| Not signed in | 401 `unauthenticated` |
| The permission is not held at any level | 403 `forbidden` |
| The record is not covered for viewing | 404 `not_found`, the same as for one that does not exist |
| The record can be seen, but the action is not allowed | 403 |
| The grant rule forbids it | 403 `cannot_grant`, `own_access` |
| The outranking rule forbids it | 403 `outranked` |
| It would leave no administrator | 409 `last_administrator` |
| Sorting, filtering or adding up a field one may not see | 400 `bad_request` |

Fields someone may not see are left out of the answer. They are not null or masked.

## For developers

- **Routes** begin with `access.public`, `access.signedIn`, `access.administrator` or `access.permission(key)`; `access.permission(key, { orOwner: true })` also lets people through to their own records. The check comes before anything is read from the request. Do not put access checks in `param` callbacks; a test refuses them. Route modules may not import tables or the data layer.
- **Services** take the acting person (`Actor`) and check permission and coverage themselves. Unattended work uses `systemActor(name)`, which no request can get.
- **Lists** put `filterFor(actor, permission, type)` into the query, so that pages and totals are right. **Single records** use `can`, or `requireRecord`, which gives 404 or 403. Both follow the same rules, and a test compares them on every record of the demo.
- **Money fields** are removed by `visibleFields`. To sort, filter or total by one, use `moneyValue`.
- **Time entries and expenses** are changed only after `lockTimeEntryForEdit` or `lockExpenseForEdit`.
- **Manager flags** are set only by the functions in `src/server/access/managerFlags.ts`. Copying a project, creating one and importing use them too.
- **Account actions** use `requireOutranks`; whatever could take the last administrator away (archive, delete) calls `keepAnAdministrator`.
- **Lock order** for everything that changes access: `lockAccess` (one at a time), the email, invites, people by id, roles by id. `lockForAccessChange` does the last two and gives the actor as of now.
