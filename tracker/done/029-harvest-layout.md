# 029 Layout after Harvest

## Request
User (2026-11-25), with screenshots of their own Harvest account (not kept here, since they show real people and clients): remove the sign-in graphic; no waves and gradients ("too AI sloppy"); employees' last names are Test; hours as decimals (6.25); the design should follow Harvest; prefer Harvest's dark look.

## Implementation notes
Done by the main session on branch `demoable`.
- Look: flat tokens (warm charcoal and slate in dark mode, white and light grey in light mode), one typeface, underline tabs, sectioned sidebar with quick actions on top, Settings and the profile at the bottom.
- Timesheet: day strip with week total, rows with Start and Edit, date navigator, Copy from previous day, Submit week for approval and Take back, week grid to type into.
- Team: Members by week with hours, bar, utilization and capacity. Tasks: library. Settings: My preferences (start page, theme).
- Weeks run Saturday to Friday in the demo (`week_starts_on` 6); the session tells the web app.
- Approving handed-in weeks is still 010: a submitted week can only be taken back.

## History
- 2026-11-25 done, without the team's QA and PM
