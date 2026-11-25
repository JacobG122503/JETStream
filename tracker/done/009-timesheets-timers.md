# 009 Timesheets and timers

## Request
Depends on: 007

Day, week and calendar views. Live start/stop timers (one running per person, surviving reload), duration or start/end time entry mode, notes, edit, delete, move to another day, copy rows from the most recent timesheet, favourites, keyboard shortcuts, time rounding, week totals, billable and locked indicators. Project picker grouped by client. Admins and permitted managers can track on behalf of a teammate. Optional required notes.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Note from 006 PM: use 006's shared money, hours and date formatting.

Note from 008 PM: use 008's person lock helper (AC20) when adding or moving time, and its one function for stopping a timer (archiving a person stops theirs); the breakdown's entries (AC25) can then link to the timesheet.

Note from 007 PM: use 007's project lock helper (AC28) when adding or moving time; a timer left running on a project archived meanwhile must still be stoppable; a changed billable flag of a project task applies to new time only, so consider an action for existing open entries.

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
- 2026-11-25 built by the main session without the dev team, and tested with unit and end-to-end tests. Timer, day, week and month, start and end times, favorites, copying, required notes, time for others and keyboard shortcuts work.
