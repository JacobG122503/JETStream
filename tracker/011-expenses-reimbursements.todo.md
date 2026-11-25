# 011 Expenses and reimbursements

## Request
Depends on: 010

Expense entries with project, category, amount or units (such as mileage), notes, billable flag, reimbursable flag and receipt image/PDF attachment. Categories admin, weekly submission and approval, reimbursement tracking (pending, approved, paid), and expense list with filters.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Note from 001 QA: body parsers added to a single route (uploads) answer 500 instead of 413/400, because only the shared JSON parser is recognised; handle upload errors properly.

Note from 006 PM: use 006's shared money, hours and date formatting.

Note from 006 PM: take 006's client lock when adding expenses, because expenses lock the client's currency.

Note from 007 PM: use 007's project lock helper (AC28), which includes the client lock's place in the order.

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
