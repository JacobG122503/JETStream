# 024 End-to-end demo verification

## Request
Depends on: 023, 025

Playwright tests that walk the whole story with the three demo accounts on the production build, each in a separate browser session to prove data is shared: employee logs time and an expense and submits; lead approves; admin invoices the client, takes payment and sees it in reports. Also check that each role is refused what it may not do, phone layout, accessibility and console errors. Fix every defect found.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

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
- 2026-11-23 ORCH: updated for server hosting
