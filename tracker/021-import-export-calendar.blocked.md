# 021 Import, export and calendar

## Request
Depends on: 016

CSV import with preview and validation for people, clients, projects, tasks, time and expenses; full CSV/Excel export; JSON backup and restore; .ics calendar import into timesheets; accounting exports for invoices and payments in formats QuickBooks Online and Xero accept.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Note from 001 QA: see the upload error note in 011.

Note from 005 PM: imports that set a manager flag must go through 005's grant check.

Note from 008 PM: import people through 008's services (email refusals, outranking, rates by permission).

Note from 007 PM: import projects and tasks through 007's services (locks, limits, amounts by permission); names and codes are not unique.

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
- 2026-11-25 Waits for the user's meeting. Built: CSV export of everything (Settings, Export) and backup instructions. Not built: import, restore in the app, calendar import, accounting exports.
