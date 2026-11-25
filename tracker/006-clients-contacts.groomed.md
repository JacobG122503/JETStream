# 006 Clients and contacts

## Request
Depends on: 005

User: "they work with a lot of clients". Client companies with address, currency, tax defaults, payment terms, notes, contacts (name, title, email, phones), archive/restore, search, and a client page showing projects, billable totals, unbilled amount and invoices.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

## Spec
### Goal
JET Engineering keeps all its client companies in one place: whom to call, how each is billed, and what the work for it is worth, billed and still unbilled. The billing manager runs it; a project lead sees the clients of the projects they manage, with money only if allowed.

### User stories
- As the billing manager, I want to add, find, correct and archive client companies and their contacts, so that the list stays usable with hundreds of clients.
- As the billing manager, I want currency, taxes, discount and payment terms kept per client, so that invoices and estimates start out right.
- As the billing manager, I want one page per client with projects, billable totals, unbilled amount and invoices, so that I see what to bill and what is owed.
- As a project lead, I want my clients' contacts and projects at hand, without seeing other clients or amounts that are not my business.
- As a developer of 007 and 009 to 022, I want shared client services and money formatting, so that every screen agrees.

### Rules
- **Who.** Everything here follows 005. List and page need `clients.view` (at `managed`: clients with a managed project; others answer 404). Every change needs `clients.manage`. Parts of the page:

| Part | Needs |
|---|---|
| Name, address, currency, notes, contacts | `clients.view` |
| Billing defaults (taxes, discount, payment terms) | `clients.manage`, or `billable.view` covering the client |
| Projects | `projects.view`; only covered projects |
| Hours | `time.view`; only covered entries |
| Billable, unbilled, per-project amounts | `time.view` and `billable.view`; only entries and expenses covered by both |
| Fixed fees not yet invoiced | `billable.view` covering the project |
| Invoices and their totals | `invoices.manage`; only covered invoices |
| Assigned people | `people.view`; only covered people |

- **Field limits** (after trimming; control characters refused, line breaks only in address and notes):

| Field | Rule |
|---|---|
| Client name | 1 to 100, inner spaces collapsed, unique ignoring case, archived clients included |
| Address / notes | up to 500 / 5000 characters, plain text. Notes are internal and never on a document |
| Currency | one of a bundled ISO 4217 list, searchable by code and name |
| Tax 1, tax 2 | name (1 to 30) and percentage together, or neither; tax 2 only with tax 1. 0% is a tax |
| Percentages | 0 to 100, up to three decimals |
| Payment terms | 003's list; custom needs 0 to 730 whole days |
| Contact | name 1 to 100; title up to 100; email up to 254 and valid; office and mobile phone up to 40 each. Only the name is required |

- **Billing defaults** belong to the client. A new client starts with the company's currency, taxes and terms, then they are its own: empty means none. Changing them changes no existing document.
- **Figures** are for all time, in the client's currency, from pure functions in `src/shared/calc`:
  - Running entries are left out everywhere. Minutes follow the company's time rounding, per entry. Hours: all entries. Billable hours: billable entries on projects that are not non-billable.
  - **Billable amount:** invoiced entries and expenses at the amount stored on their link; other billable entries at 003 AC12's rate (fixed fee and no-rate: 0), each rounded, then added; other billable expenses in the client's currency, not on non-billable projects.
  - **Unbilled amount:** that part of it neither on an invoice (drafts count as invoiced) nor billed outside. Approval does not matter. Archived projects count.
  - Never silently left out: hours with a missing rate, and billable expenses in another currency, are named next to the amounts, with the hours, and the amount per currency.
  - **Fixed fees not yet invoiced**, shown apart and not in unbilled: per fixed-fee project, the fee less its invoice lines of kind manual (any invoice state, before discount and tax), not below 0.
  - **Invoices:** invoiced, paid, due, overdue and written off. Drafts are not in these but shown as their own sum. Due is the due amount of open invoices; overdue those whose due date is before today in the company time zone. Amounts of different currencies are never added.

### Acceptance criteria
**List and search**
1. **AC1** `/clients` lists the clients the viewer may see: name, currency, contacts (number), active projects (number, only covered ones; absent without `projects.view`), and "Archived" where so. Active ones first by default; a filter offers Active, Archived, All. Sort by name (ignoring case, default), active projects, and date added. No amounts.
2. **AC2** Search finds part of a client name, address, contact name or contact email, ignoring case and outer spaces, and says when a hit came from a contact, naming it. `%`, `_`, `\` and `'` are literal. Nothing found: an empty state with "Clear search". Typing quickly never shows the result of an older search. It never matches a client, or counts one, outside the viewer's coverage.
3. **AC3** Search, filter, sort and paging are done by the server (25 per page; an API page size above 100, or an unknown sort, is 400) and are kept in the address, so reload and Back from a client return to the same list. The total is shown.
4. **AC4** With 500 clients, 2,000 contacts and 2,000 projects, list and search answer within 1 second; a client page with 20,000 time entries within 2 seconds (production build, embedded database, this laptop, after a first request). Measured and reported in the Implementation notes.

**Create and edit**
5. **AC5** People with `clients.manage` can add and edit clients with all fields above; others see no such controls and the API answers as in 005. Server and form apply the same rules; the form shows errors at the fields with 002's error summary and keeps what was typed.
6. **AC6** A name in use answers 409 `name_taken` and the form says so with a link to that client, and whether it is archived. Two simultaneous creations with one name: exactly one succeeds. Submitting twice quickly creates one client.
7. **AC7** The form is prefilled per the Billing defaults rule, shows percentages with the company's decimal separator, and shows the days field only for custom terms (leaving custom clears it). Stored percentages are exact thousandths.
8. **AC8** The currency can be changed only while the client has no invoice, estimate, recurring invoice or retainer, no expense on its projects, and no stored amount on its projects (project rate, fixed fee, fee budget, project-task rate or fee budget, member rate; removed tasks and members included). Otherwise the field is read-only, says which of these exist, and the API answers 409 `currency_locked`.
9. **AC9** Editing a client or contact is checked for staleness: 409, typed values kept, reload offered. A changed contact does not make an open edit of the client stale.

**Contacts**
10. **AC10** The client page lists contacts by name; people with `clients.manage` can add, edit and delete them (delete after confirmation). Email and phone are `mailto:` and `tel:` links whose targets are encoded or reduced to digits and a leading `+`, so typed text cannot add recipients, headers or another scheme. A contact id is accepted only under its own client, else 404. Contacts of an archived client can still be changed.
11. **AC11** Deleting a contact changes no stored message or document. Contact details are in no response to people without `clients.view` on that client.

**Archive, restore, delete**
12. **AC12** Archive asks for confirmation and is refused with 409 `client_in_use` while the client has an active project or an active recurring invoice; the message gives the number, and the names of those the viewer may see. Archived clients keep their page, contacts, history and figures, are marked as archived, and are not offered for new work (004 AC33, AC15 here). Assignments stay stored. Restore makes the client active again and nothing else.
13. **AC13** Delete is offered only when the client has no project, invoice, estimate, recurring invoice or retainer; otherwise the page says to archive instead and the API answers 409 `client_in_use`. The confirmation names the number of contacts and, to those with `people.view` at `all`, of assigned people; contacts, assignments and places in open invites go with it in one transaction. Nothing else is deleted.
14. **AC14** Creating, changing, archiving, restoring and deleting clients and contacts is written to the activity log in the same transaction with who, when, before and after. A refused change writes nothing.

**Shared services**
15. **AC15** One helper, run in the caller's transaction, locks a client for use and returns its current currency and defaults, refusing archived and missing ones with distinct errors. Archive, delete and currency change take the conflicting lock and check for dependents only after it. Tested both ways round with a project inserted through the helper: no archived client ends up with a new active project, and no amount under a currency read before a change. It comes before 003's lock order, and `docs/data-model.md` says so.
16. **AC16** Services for 007, usable in the caller's transaction: create a client from name and currency only (needs `projects.create` or `clients.manage`; company defaults for the rest; other fields refused), and a list of active clients by id and name for the holder of either permission. Both check the actor as in 005 AC9.
17. **AC17** One shared module formats money, hours and dates by the company settings (number format, currency placement, hour format, date format) and works in server and browser. Money respects the currency's decimals; negative amounts have the minus sign in front of everything; where placement is by symbol, a currency other than the company's whose symbol is shared by another shows its code instead. Exact up to 9,007,199,254,740,991. Signed-in people get these settings from the server; nothing else of the settings is exposed by this.

**Client page**
18. **AC18** `/clients/<id>` shows the parts of the Rules table, each only to those who may see it; a hidden part's data is absent from all responses. Address and notes keep line breaks and never render HTML. An id that is not a positive integer or does not exist: 404 from the API (never 500) and the not-found message on the page, identical to a client not covered.
19. **AC19** Figures follow the Rules and equal, for every seeded client and each of 005 AC3's actors, values worked out separately from stored rows. If the viewer's coverage is less than all, the page says that figures include only the projects and people they manage.
20. **AC20** The projects part lists name, code, type, dates, active or archived (active first) and, where allowed, hours, billable and unbilled amount per project. For a viewer with everything at `all`, the rows add up exactly to the client's totals.
21. **AC21** The invoices part lists number, subject, issue date, due date, state (draft, open, late, part-paid, paid, written off or closed), total and due, newest first, with paging. "Late" agrees with the overdue sum. Simulated payments are not named as real ones. Until 007 and 012 exist, project names and invoice numbers are not links.
22. **AC22** Assigned people (004 AC33, active people only) are listed with name and photo, linked to their person page; how to change assignments is said to those with `people.manage`.
23. **AC23** When an open page loses its access or the client is deleted by someone else, the next request shows no-access or not-found as in 005 AC25, and no stale details stay on the screen.

**Quality**
24. **AC24** All screens meet 004 AC39 (keyboard, 320, 375 and 1440 px, axe in both modes, loading, empty and error states per part, double submit acts once); names of 100 characters without spaces, 500-character addresses and large amounts do not break the layout. No console errors.
25. **AC25** Any migration follows 003 AC1 and loses nothing. 001 to 005's criteria still hold; 003's seed is extended only if a criterion here needs it. `npm run build`, `lint`, `test` and `e2e` pass; e2e covers, for each demo account, what it sees of clients, and for the administrator add, search, edit, contact, archive and restore.

### Test scenarios
1. Administrator adds " Acme   Pumps " with EUR, taxes "VAT" 19 and "Levy" 0.125, custom terms 10 days, and a contact: stored "Acme Pumps", 19000, 125, 10. Search `acme`, `ACME P` and the contact's email: found; the last names the contact.
2. Demo: administrator sees five active clients and one archived; employee: no-access page, API 403. Lead (`billable.view`, no `invoices.manage`): sees only clients with a managed project, amounts, no invoices part and no invoice key in the JSON; the id of another client: 404, the same body as an unknown id.
3. Figures, USD, rounding off. P1 at project rate 100.00: 90 min; three of 20 min; 60 min not billable; 60 min invoiced at 90.00 (rate raised since); 60 min billed outside; one running entry with 30 min stored. P2 by person without rate: 120 min billable. P3 non-billable project: 60 min flagged billable. P1 expenses: billable 45.00 USD, billable 20.00 EUR, not billable 30.00 USD. Hours 8.50, billable hours 6.50, billable 484.99, unbilled 294.99; 2.00 hours without a rate and EUR 20.00 named as not included.
4. Demo, Fernhollow: fixed fee not yet invoiced for Control system integration 48,409.00 (86,000.00 less 34,400.00, 3,691.00 and -500.00). Lumen Ridge: Boiler replacement 40,375.00. Kestrel: all amounts in EUR. Internal client: empty invoices part, no error.
5. Format: 123456789 USD as `$1,234,567.89`, with `1.234,56` and code after `1.234.567,89 USD`; 5000 JPY without decimals; -500 USD `-$5.00`; CAD with company USD by symbol: code shown; 20 min `0.33` or `0:20`.
6. Edge: search `%` and `_` on the seed: no hits; a client named "50% Off_site" is found by both. Page 3, open a client, Back: page 3 with the same search.
7. Edge: an invoice open and due today: not late; due yesterday (company time zone, checked at 23:30 and 00:30 Chicago time): late. A written-off invoice: not in due or overdue.
8. Edge: new client in USD: currency changed to EUR, works. Add a project with rate 0: locked. New client with a project without amounts and time only: still changeable.
9. Edge: custom role with Bookkeeper's permissions: no projects part, but client totals and invoices.
10. Failure: name `acme pumps` again, and name of an archived client: 409 `name_taken`. Two simultaneous: one 201, one 409. Empty name, 101 characters, currency `ZZZ` and `usd`, tax name without percentage, tax 2 alone, 100.001%, 8.1234%, -1, custom without days, 731 days, contact email `a@b.example\nBcc: x@y.example`: 400 each at the right field, nothing stored.
11. Failure: archive Tallgrass: 409 naming its active projects. Archive a client without active projects: gone from the active list and from 004's assignment choices; restore: back. Delete Old Quarry: 409. Delete a new client with one contact and one open invite naming it: gone; the invite still works.
12. Failure: two windows edit the same client: the second gets 409 and keeps its text. Contact 1 of client A through client B's path: 404, unchanged. Lead calls create, edit, archive, delete, contact routes with valid and invalid bodies: 403 each, nothing changed, nothing logged.
13. Failure: `/clients/abc`, `/clients/0`, `/clients/99999999999`: not found, no 500 in the log. Notes `<img src=x onerror=alert(1)>`: shown as text.
14. Race: archive a client while a project is added through AC15's helper, in both orders: exactly one succeeds.

### Out of scope
- Creating or editing projects, project pages (007); invoice pages, choosing recipients, unbilled workflow (012); payments, statements, ageing, retainer balances (013); estimates on the client page (014); date ranges, charts, exports and profit (015, 016).
- CSV import and export of clients and contacts (021), accounting links (021), clients through the public API (025).
- Assigning people from the client page (stays on the person page, 004). Sign-in or a portal for contacts.
- Merging clients, several addresses, parent companies, custom fields, client logos, fax numbers (put them in notes), address lookup.
- Archiving projects together with their client (007 may offer it).
- Converting currencies.

### Assumptions
- As in Harvest, a client with active projects cannot be archived, and one with any history cannot be deleted.
- Company defaults are starting values rather than live ones, so that "no tax" for an exempt client is unambiguous. 022 must word its settings accordingly.
- Taxes, discount and terms are commercial terms, so a lead without `billable.view` does not see them. Notes are visible to everyone who sees the client.
- 005's `clients.manage` ("create, edit, archive") includes restore and the narrow delete.
- The "name in use" answer reveals that a client exists, also an archived one, to holders of `projects.create`; accepted, since they choose clients by name anyway. The link is only for those who may open it.
- Unbilled is the sum of per-entry amounts, so an invoice that adds minutes first (003 AC15) can differ by a few cents.
- Every manual line of a fixed-fee project counts towards its fee, products included; 012 may refine this.
- "Phones" are office and mobile, as stored by 003.

### Notes for the engineer
- 004 and 005 are not finished while this is written: build on what they end up with (session, permission filters, field rule, activity log).
- Coverage filters must be inside the queries for search, counts and totals, not applied afterwards.
- 002's `Table` sorts and pages in the browser; server paging needs an extension that later lists reuse. 003's `isCurrencyCode` checks only the shape.
- `claim.ts` already resolves rates for many entries; share that loading instead of writing a second one, so that unbilled here and billed there agree.
- PGlite runs transactions in turn (003 AC23): add AC6 and AC15 to the real-server setup and say what was not run.

### Size
L. Build order: formatting and figures, client services and locks, routes, list, form and contacts, client page. Not split: the page has no use without the records, and 007 needs the services.

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
