# 012 Invoices

## Request
Depends on: 010, 011

User: "charge cleints" and "the billable time taken from employees gets charged to the respective companies". Create invoices from unbilled time and expenses for a client (choose projects, date range, summary by task, person, project or detailed) or free-form. Line items with categories, two taxes, discount, currency, PO number, subject, notes, number sequence, payment terms (upon receipt, net 15/30/45/60, custom). States draft, open, paid, closed, plus late. Link billed entries and release them if the invoice is deleted. Attach receipts, print/PDF, edit, duplicate, "send" through the Outbox with message history. Printable client-facing invoice page.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Server change: numbering and billing of entries are transactional; client-facing invoice links use unguessable tokens that can be revoked; PDF is generated on the server or by print. Email goes through the adapter in CLAUDE.md.

Note from 002 QA: tables wider than the paper are cut off when printed; wide tables need a print layout.

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
