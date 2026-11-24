# 002 Design system and app shell

## Request
Depends on: 001

User: "The theme color for the website if needed should be mediumseagreen."
Build the theme tokens, shared components (buttons, forms, tables, dialogs, toasts, tabs, date picker, empty/loading/error states) and the responsive app shell with navigation: Time, Expenses, Projects, Clients, Team, Schedule, Time off, Reports, Invoices, Estimates, Settings. Polished and professional, with light and dark modes.

GitHub Pages is dropped (see CLAUDE.md): the server hosts the web app with normal history routing at any base path. Revise the existing spec where it relies on hash routing, sub-path static hosting or the shared Pages origin; the rest stands.

## Spec
### Goal
Anyone opening JET Time sees a consistent, professional, mediumseagreen-themed app that they can navigate on a phone or a desktop, with mouse or keyboard, in light or dark mode. Every later task (003 to 024) builds its screens from the shared components made here rather than inventing its own.

### User stories
- As an employee on a job site, I want to reach every section from my phone so that I can use the app away from a desk.
- As an administrator at a desk, I want navigation that is always visible and shows where I am so that I can move between billing, projects and people without hunting.
- As a keyboard or screen-reader user, I want every control to be reachable, labelled and visibly focused so that I can do my job unaided.
- As any user, I want light, dark or system appearance, remembered on this device, so that the app is comfortable to read.
- As any user, I want clear loading, empty and error states and a confirmation before anything destructive so that I always know what is happening and do not lose work by accident.
- As a developer on a later task, I want one documented component set with a live gallery so that every screen looks and behaves the same.

### Acceptance criteria

"The gallery" is the page at `#/design` (AC21). "Both modes" means light and dark. Unless stated otherwise, criteria are checked on the production build served under a sub-path.

**Theme**

1. AC1 Brand colour: `#3CB371` is defined once as the brand token and is visible in the shell (brand mark) and as the primary button background or the base of its shades. White or near-white text never appears on `#3CB371` (measured 2.67:1, fails AA).
2. AC2 Contrast: in both modes, text is at least 4.5:1 against its background (3:1 for large text), and input borders, focus indicators, meaningful icons, and progress and selected-state indicators are at least 3:1 against adjacent colours. This includes hover, active, selected and error states; disabled controls are exempt. Note: `#3CB371` on white is also below 3:1, so light mode needs a darker shade for focus rings, thin indicators and links. An automated unit test computes the ratios for the token pairs in use and fails if one drops below its threshold.
3. AC3 Tokens: colours, spacing, font sizes, radii, shadows and z-index layers are CSS custom properties defined in one place. No hex, rgb(), hsl() or named colour literal (`transparent`, `currentColor` and `inherit` are allowed) appears in component or page styles or inline styles outside the token definitions, plus the print rules of AC20 and the brand SVG/favicon if needed.
4. AC4 Mode choice: a labelled control in the shell offers System, Light and Dark. System is the default and follows the operating system setting live, without a reload. An explicit choice overrides the OS setting.
5. AC5 Mode persistence: an explicit choice survives a reload and a new tab, and is applied before first paint (the document's first painted frame already has the chosen mode; no flash). Native controls (scrollbars, form controls) match the mode through `color-scheme`. If browser storage is unavailable or holds an unrecognised value, the app loads in System mode without an uncaught error and the control still works for that page visit. Storage keys are prefixed `jettime.`, because all of a user's GitHub Pages sites share one origin.

**App shell**

6. AC6 Navigation: the main navigation lists exactly, in this order: Time, Expenses, Projects, Clients, Team, Schedule, Time off, Reports, Invoices, Estimates, Settings. Routes: `#/time`, `#/expenses`, `#/projects`, `#/clients`, `#/team`, `#/schedule`, `#/time-off`, `#/reports`, `#/invoices`, `#/estimates`, `#/settings`. `#/` goes to `#/time` without leaving an extra history entry (Back does not bounce the user).
7. AC7 Current location: the current item is marked visually by more than colour alone and with `aria-current="page"`, including on sub-routes (an item stays current on e.g. `#/projects/123`). The document title is `<Page> | JET Time`.
8. AC8 Deep links: opening or reloading any route in AC6 directly under a sub-path shows that page. An unknown route (e.g. `#/nope`, `#/time/nope`) shows a "Page not found" page inside the shell with a link to Time. Sub-routes of sections do not exist until later tasks add them; AC7's sub-route behaviour is verified in a component test.
9. AC9 Placeholder pages: each section shows its name as the only `h1` and an empty state saying plainly that the section is not available yet. No fake data and no controls that do nothing.
10. AC10 Desktop layout: at viewport widths of 1024px and up, navigation is a persistent sidebar that stays visible while page content scrolls, with all eleven items reachable at 1280x720 (the sidebar scrolls itself if needed).
11. AC11 Phone and tablet layout: below 1024px, navigation is hidden behind a labelled menu button exposing `aria-expanded`. Opening it shows a drawer with all eleven items; focus moves into the drawer, is kept there, and page content behind cannot be scrolled or focused. The drawer closes on item choice, Escape, its close button or tapping outside. Focus returns to the menu button, except on item choice, where AC13 applies. Growing the window past 1024px with the drawer open leaves the page usable (no stuck overlay or scroll lock).
12. AC12 Reflow and touch: at widths 320, 375, 768, 1024 and 1440, no shell page and no gallery section causes horizontal scrolling of the page (the table scroll option in AC16 may scroll inside its own container). Below 1024px, navigation items, the menu button, buttons and form fields have a touch target at least 44px high; icon-only buttons are at least 44x44px.
13. AC13 Route changes: after navigating, focus moves to the new page's `h1` and scroll returns to the top. A "Skip to main content" link is the first focusable element and becomes visible on focus. Activating it moves focus to the main content **without changing the route** (a plain `#main` anchor would break hash routing).
14. AC14 Extension points: the navigation is driven by one list, and the shell accepts a way to hide items (005 permissions, 022 modules) and to place content in the header (009 running timer, 018 notifications, 004 account menu). Nothing non-functional is shown in those places now. A component test shows that hiding Invoices removes it while the order of the rest is unchanged, and that header content renders. A second layout without navigation exists for later sign-in and client-facing pages, and is viewable at `#/design/plain`.

**Components** (each shown in the gallery in all its variants and states)

15. AC15 Buttons and forms:
    - Button: primary, secondary, quiet and destructive variants; small and medium sizes; icon-only (requires an accessible name at type level); disabled; and loading (shows a busy indicator, keeps its width, announces busy, and ignores further clicks).
    - Fields: text, email, password, number, multi-line text, select, checkbox, radio group, switch, search with a clear button.
    - Every field supports label, hint, required marker, disabled, read-only where applicable, and error. The label is programmatically tied to the control; errors use `aria-invalid` and `aria-describedby`; "required" is conveyed by more than colour.
    - Form error summary: on a failed submit, a summary lists each error, receives focus, and each entry moves focus to its field (without changing the route).
    - Combobox: filter by typing, grouped options (project grouped by client), single and multi-select, clear, disabled options, a "No matches" message, and the keyboard model: Down/Up move, Enter selects, Escape closes without selecting. It stays usable with 500 options: the list shows the right matches after each keystroke.
16. AC16 Table: real table semantics with a caption (may be visually hidden); sortable columns through header buttons with `aria-sort` (cycle ascending/descending, stable, numeric columns sort numerically, empty values last both ways); right-aligned numeric columns; footer totals row; optional row selection with a header checkbox showing a mixed state and selecting only the visible page; a row actions slot; pagination (default 25 rows, sort applies to the whole set, shows "1-25 of 60"); loading, empty and error states inside the table. Below 640px, rows become stacked label/value blocks by default, with labels still exposed to assistive technology and sorting still possible; an opt-in alternative scrolls horizontally inside a focusable, labelled container.
17. AC17 Dialogs: modal dialog has a title as its accessible name; traps focus; makes the background inert; locks background scroll; closes on Escape and its close button; returns focus to the opener (or to a sensible fallback, not `body`, if the opener is gone). Content taller than the screen scrolls inside the dialog with its action buttons reachable at 320x568. Clicking outside closes it unless the dialog opts out (forms do). Confirmation dialog: names the action on its button (not "OK" or "Yes"), focuses Cancel first when destructive, shows loading and cannot be closed or re-submitted while its async action runs, stays open with an error message if the action fails, closes on success.
18. AC18 Toasts: success, info, warning and error, distinguished by icon and text as well as colour. Success and info are announced politely and disappear after 5 seconds, with the countdown paused on hover or focus. Warnings and errors are announced assertively and stay until dismissed. Each has a labelled dismiss button and optional action button. At most 3 are visible; more queue in order. Toasts never take focus and remain visible above an open dialog, where they can still be dismissed.
19. AC19 Tabs, menu, date pickers, status and states:
    - Tabs: `tablist`/`tab`/`tabpanel` roles; Left/Right/Home/End keys; more tabs than fit scroll within the tab list at 320px.
    - Action menu (for row actions and the account menu): opens with click, Enter, Space or Down; arrow keys move; Escape closes and returns focus; disabled and destructive items; stays within the viewport near screen edges.
    - Date picker: value in and out is a local ISO date string `YYYY-MM-DD` or empty, never shifted by time zone. Typing accepts `YYYY-MM-DD` and `M/D/YYYY`; display is `Nov 23, 2026` regardless of browser locale. Calendar popup supports arrow keys, Home/End (week start/end), PageUp/PageDown (month), Shift+PageUp/PageDown (year), Enter to choose, Escape to close; marks today and the selection; supports min/max, clear, and a configurable week start (default Monday).
    - Date range picker: start and end, with presets This week, Last week, This month, Last month, This quarter, This year, Custom. An end before the start shows an error and does not emit a value.
    - Also: status badge (neutral, success, warning, danger, info; text always present), avatar with initials fallback, card, statistic tile, progress bar (accessible value; shows over 100% as a distinct, worded state for budgets), tooltip (on hover and focus, dismissed with Escape), page header (title, description, actions), filter bar that wraps on phones.
    - Loading (skeleton and spinner, announced to assistive technology), empty (title, explanation, optional action) and error (message, Retry button) states, each usable for a whole page or a section. An error in a page's rendering is caught inside the shell: navigation still works, a Reload/try again option is shown, and moving to another page clears the error.
20. AC20 Print and motion: in print media, navigation, header, toasts and buttons are hidden and content prints in light colours even when dark mode is on. With `prefers-reduced-motion: reduce`, no transition or animation longer than 10ms runs (a spinner may be replaced by a static or text indicator).

**Quality**

21. AC21 Gallery: `#/design` shows every component above in all variants and states, with working examples (open a dialog, raise each toast, sort a 60-row table, trigger a page render error, and so on). It is included in the production build, is not in the navigation, and its data is clearly sample data and fictional.
22. AC22 Accessibility: an automated axe scan (WCAG 2.0/2.1/2.2 A and AA rules) run in Playwright reports zero violations on all eleven sections, not-found, the gallery and `#/design/plain`, in both modes at 375px and 1440px, and with the drawer, a dialog, a menu, a combobox and the date picker open. Everything in the gallery is operable by keyboard alone with a visible focus indicator.
23. AC23 Clean run: loading and visiting every route logs no console errors or warnings and makes no request to a third-party origin (fonts and icons are bundled or system). Icons are SVG, not emoji. The favicon and brand mark are original and do not resemble Harvest's.
24. AC24 Commands: `npm run lint`, `npm test`, `npm run build` and `npm run e2e` pass on Node 18.20; every new dependency supports Node 18.20. Each component has tests covering its behaviours above; the shell has Playwright tests at 375px and 1440px.
25. AC25 Visual review: QA captures screenshots of Time, Reports and the gallery at 375, 768 and 1440 in both modes and finds no overlapping, clipped or unstyled elements, and consistent spacing and alignment (all spacing from tokens). Paths are listed in the QA report.

### Test scenarios

Happy path
- T1 Open the root URL on a 1440px window: URL ends `#/time`, title `Time | JET Time`, sidebar shows eleven items in order, Time is current. Press Back: leaves the app rather than bouncing to Time.
- T2 At 375px press the menu button, Tab repeatedly: focus cycles inside the drawer. Choose Invoices: drawer closes, URL is `#/invoices`, focus is on the "Invoices" heading.
- T3 Set OS to dark, mode System: app is dark; switch OS to light: app turns light without reload. Choose Dark, reload: dark from the first frame.
- T4 Table of 60 rows with an Hours column containing 2, 10, 9 and empty: ascending gives 2, 9, 10, empty; descending gives 10, 9, 2, empty; page 1 reads "1-25 of 60" and page 3 "51-60 of 60".
- T5 Combobox with projects grouped under "Acme Fabrication" and "Northline Utilities"; filtering matches project or client (group) name, ignoring case. Type `acm`: only the Acme Fabrication group and its projects appear. Press Down then Enter: the first of them is selected. Type `zzz`: "No matches".

Edge cases
- E1 Date picker, time zones `America/Los_Angeles` and `Pacific/Auckland`: choosing 8 Mar 2026 and 1 Nov 2026 (US clock changes) emits `2026-03-08` and `2026-11-01`.
- E2 Date picker: PageDown from 31 Jan 2026 moves to 28 Feb 2026; `2028-02-29` is accepted; `2/29/2027` is rejected with an error and no value emitted.
- E3 Date range "This week" with today 2026-11-23 (a Monday): Monday start gives 2026-11-23 to 2026-11-29; Sunday start gives 2026-11-22 to 2026-11-28. "This quarter" gives 2026-10-01 to 2026-12-31.
- E4 Press the skip link on `#/reports`: the URL is still `#/reports`; focus is in main content.
- E5 A 120-character unbroken project name in a table cell, badge, menu and page header at 320px: no horizontal page scroll, and the full name is available.
- E6 Five toasts raised at once: three visible, the rest appear in order as others leave. Hovering a success toast for 10 seconds keeps it.
- E7 Print preview of `#/design` in dark mode: no navigation, dark text on white.
- E8 Progress bar at 0, 80, 100 and 135 percent: 135 shows an over-budget state in words and does not overflow its track.
- E9 Pick Dark, then emulate an OS change to light: stays dark.

Failure cases
- F1 Storage blocked (accessing `localStorage` throws): app loads, theme control works for this visit, no uncaught error.
- F2 `jettime.` theme key set to `purple`: app loads in System mode.
- F3 Open `#/nope`: not-found page inside the shell; link goes to Time.
- F4 A page throws while rendering: error state with navigation still working; moving to Clients shows Clients.
- F5 Confirm dialog whose action rejects with "Could not delete": dialog stays open, shows the message, buttons enabled again. Double-clicking the confirm button runs the action once.
- F6 Submit the sample form with two invalid fields: error summary gets focus and lists two errors; activating the first moves focus to that field; URL unchanged.
- F7 Date range with end before start: error shown, no value emitted.

### Out of scope
- Real content of any section, sign-in, permissions and module switches (004 onward). AC14 only leaves the hooks.
- A home dashboard (017 decides what `#/` shows once it exists).
- Charts (007, 015), timesheet week/calendar grids (009), schedule grid and drag and drop (020), file upload (004, 011).
- Duration and money inputs and their parsing (009, and 007 or whichever task first needs money).
- User-configurable date/number formats and week start (022); the components only accept them as inputs.
- Settings screens, translations and right-to-left layout, user-chosen accent colours, high-contrast theme.
- Data access: nothing here uses IndexedDB.

### Assumptions
- 001 delivers the React/Vite app with hash routing, lint, unit tests, and Playwright against the production build under a sub-path. If 001 has not set up routing, this task adds it.
- The theme choice is a per-device display preference needed before first paint, so it uses `localStorage` through one small module rather than the data layer. This does not breach the rule that app data lives in IndexedDB behind repositories.
- The gallery stays in the production build so that QA and the axe checks exercise what users get; 023 or 024 may remove it.
- Combobox, menu, badge, avatar, card, progress, pagination and range picker are added to the request's list because tasks 004 to 022 clearly need them on several screens.
- Breakpoints (640px, 1024px), the 5-second toast and Monday week start are PM choices; the engineer may pick headless accessible libraries or build in-house.
- Dates default to US-style display since the request is in US English; 022 makes it configurable.

### Size
L. Not split: every later screen depends on both halves, and the shell cannot be reviewed without the components. Suggested build order: tokens and modes, shell, form components, overlays, table, date pickers, gallery and axe checks.

## Implementation notes
_Software engineer fills this in._

## QA report
_QA tester fills this in._

## PM acceptance
_PM fills this in after QA passes._

## History
- 2026-11-23 created
- 2026-11-23 PM: groomed
- 2026-11-23 ORCH: todo -> groomed
- 2026-11-23 ORCH: back to todo; user moved the target from GitHub Pages to JET's own servers; spec kept for revision
