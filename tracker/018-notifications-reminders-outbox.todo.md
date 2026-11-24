# 018 Notifications, reminders and Outbox

## Request
Depends on: 013, 014

In-app notification centre with per-user preferences: timesheet reminders, approvals, rejections, budget alerts at the set percentage, assignment changes, invoice late/paid, estimate answers. Outbox listing every simulated email with preview and mailto. Editable message templates.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Server change: real email over SMTP when configured, Outbox capture when not; live in-app notifications; scheduled jobs run once even after restarts.

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
