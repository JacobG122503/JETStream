# 012 Invoices

## Request
Depends on: 010, 011

User: "charge cleints" and "the billable time taken from employees gets charged to the respective companies". Create invoices from unbilled time and expenses for a client (choose projects, date range, summary by task, person, project or detailed) or free-form. Line items with categories, two taxes, discount, currency, PO number, subject, notes, number sequence, payment terms (upon receipt, net 15/30/45/60, custom). States draft, open, paid, closed, plus late. Link billed entries and release them if the invoice is deleted. Attach receipts, print/PDF, edit, duplicate, "send" through the Outbox with message history. Printable client-facing invoice page.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Server change: numbering and billing of entries are transactional; client-facing invoice links use unguessable tokens that can be revoked; PDF is generated on the server or by print. Email goes through the adapter in CLAUDE.md.

Note from 002 QA: tables wider than the paper are cut off when printed; wide tables need a print layout.

Note from 003 QA: `changeInvoiceLines` can alter a time line without its entry links; a credit line added after payments can leave a paid invoice with a negative amount due.

Note from 003 PM: decide whether hours billed at rate 0 (fixed-fee or no-rate projects) show on the client's invoice.

Note from 006 PM: take the client lock first, before 003's lock order, and refuse archived clients for new documents.

Note from 006 PM: link invoice numbers on the client page, decide which manual lines count towards a fixed fee, preselect recipients from the client's contacts.

Note from 007 PM: link invoice numbers on the project page; take the project lock for lines that name a project, since it blocks deleting it or changing its client.

Note from 028 (2026-11-25): a simple version of this exists (`src/server/work/`, `src/web/pages/work/`). Build on it, and bring it up to this spec, instead of starting anew.

## Spec
_PM fills this in during grooming._

## Implementation notes
_Software engineer fills this in._

## QA report
_QA tester fills this in._

## PM acceptance
_PM fills this in after QA passes._

## History
- 2026-11-23 created
- 2026-11-23 ORCH: request updated, user moved the target from GitHub Pages to JET's servers
- 2026-11-25 built by the main session without the dev team, and tested with unit and end-to-end tests. Invoices from time and expenses or typed, editing, duplicates, attachments, messages, client links that can be revoked, print/PDF. Decided: hours at rate 0 show on the invoice, a refund on a closed invoice is refused, an invoice of 0 is paid once sent. PDF is made by printing.
