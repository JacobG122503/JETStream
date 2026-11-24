# 013 Payments, recurring invoices and retainers

## Request
Depends on: 012

Record full and partial payments, refunds/removal, simulated online payment on the client view, thank-you messages, automatic late reminders on a schedule, recurring invoices (generated when due, next time the app is opened), retainers with balance, top-up and draw-down, write-off, and client statement with ageing.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Server change: reminders and recurring invoices run from a server scheduler, not when the app is opened. Online payment is an adapter: simulated by default, with a hosted-checkout provider (such as Stripe) selectable by configuration and documented as needing keys and live testing.

Note from 003 QA: a refund on a closed invoice is accepted; an open invoice with total 0 can never become paid (read in code, not run). Decide and fix.

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
