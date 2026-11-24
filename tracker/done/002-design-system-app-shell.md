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

"The gallery" is the page at `/design` (AC21). "Both modes" means light and dark. Paths in this spec are relative to the base path the app is served at: `/time` means `/time` when served at the root and `/jettime/time` when served at `/jettime/`. Unless stated otherwise, criteria are checked on the production build served by the project's own server at the root; criteria marked "both bases" are checked at the root and at `/jettime/`.

**Theme**

1. AC1 Brand colour: `#3CB371` is defined once as the brand token and is visible in the shell (brand mark) and as the primary button background or the base of its shades. White or near-white text never appears on `#3CB371` (measured 2.67:1, fails AA).
2. AC2 Contrast: in both modes, text is at least 4.5:1 against its background (3:1 for large text), and input borders, focus indicators, meaningful icons, and progress and selected-state indicators are at least 3:1 against adjacent colours. This includes hover, active, selected and error states; disabled controls are exempt. Note: `#3CB371` on white is also below 3:1, so light mode needs a darker shade for focus rings, thin indicators and links. An automated unit test computes the ratios for the token pairs in use and fails if one drops below its threshold.
3. AC3 Tokens: colours, spacing, font sizes, radii, shadows and z-index layers are CSS custom properties defined in one place. No hex, rgb(), hsl() or named colour literal (`transparent`, `currentColor` and `inherit` are allowed) appears in component or page styles or inline styles outside the token definitions, plus the print rules of AC20 and the brand SVG/favicon if needed.
4. AC4 Mode choice: a labelled control in the shell offers System, Light and Dark. System is the default and follows the operating system setting live, without a reload. An explicit choice overrides the OS setting.
5. AC5 Mode persistence: an explicit choice survives a reload and a new tab, and is applied before first paint (the document's first painted frame already has the chosen mode; no flash). Native controls (scrollbars, form controls) match the mode through `color-scheme`. If browser storage is unavailable or holds an unrecognised value, the app loads in System mode without an uncaught error and the control still works for that page visit. Storage keys are prefixed `jettime.`, because under a base path other applications on JET's server may share the origin. The pre-paint step also works with the response header `Content-Security-Policy: script-src 'self'` (so no inline script that such a policy would block) and on two-segment paths at both bases.

**App shell**

6. AC6 Navigation: the main navigation lists exactly, in this order: Time, Expenses, Projects, Clients, Team, Schedule, Time off, Reports, Invoices, Estimates, Settings. Routes: `/time`, `/expenses`, `/projects`, `/clients`, `/team`, `/schedule`, `/time-off`, `/reports`, `/invoices`, `/estimates`, `/settings`. `/` goes to `/time` without leaving an extra history entry (Back does not bounce the user). Both bases: navigation items are real links whose `href` includes the base path; a plain click changes page without reloading the document, a Ctrl/Cmd-click opens the same page in a new tab, and Back/Forward move between visited pages.
7. AC7 Current location: the current item is marked visually by more than colour alone and with `aria-current="page"`, including on sub-routes (an item stays current on e.g. `/projects/123`). The document title is `<Page> | JET Time`.
8. AC8 Deep links (both bases): opening or reloading any route in AC6, `/design` or `/design/plain` directly shows that page fully styled, with every script, style, font, icon and favicon request succeeding. A trailing slash (`/time/`) shows the same page, marked current. An unknown route (e.g. `/nope`, `/time/nope`) shows a "Page not found" page inside the shell with a link to Time, also when opened directly. Sub-routes of sections do not exist until later tasks add them; AC7's sub-route behaviour is verified in a component test.
9. AC9 Placeholder pages: each section shows its name as the only `h1` and an empty state saying plainly that the section is not available yet. No fake data and no controls that do nothing.
10. AC10 Desktop layout: at viewport widths of 1024px and up, navigation is a persistent sidebar that stays visible while page content scrolls, with all eleven items reachable at 1280x720 (the sidebar scrolls itself if needed).
11. AC11 Phone and tablet layout: below 1024px, navigation is hidden behind a labelled menu button exposing `aria-expanded`. Opening it shows a drawer with all eleven items; focus moves into the drawer, is kept there, and page content behind cannot be scrolled or focused. The drawer closes on item choice, Escape, its close button or tapping outside. Focus returns to the menu button, except on item choice, where AC13 applies. Growing the window past 1024px with the drawer open leaves the page usable (no stuck overlay or scroll lock).
12. AC12 Reflow and touch: at widths 320, 375, 768, 1024 and 1440, no shell page and no gallery section causes horizontal scrolling of the page (the table scroll option in AC16 may scroll inside its own container). Below 1024px, navigation items, the menu button, buttons and form fields have a touch target at least 44px high; icon-only buttons are at least 44x44px.
13. AC13 Route changes: after navigating to a different path, focus moves to the new page's `h1` and scroll returns to the top; a change of query string or fragment alone does neither. A "Skip to main content" link is the first focusable element and becomes visible on focus. Activating it moves focus to the main content **without changing the path or query and without reloading the page**, at both bases (a plain `#main` anchor would leave the page if the document uses `<base href>`).
14. AC14 Extension points: the navigation is driven by one list, and the shell accepts a way to hide items (005 permissions, 022 modules) and to place content in the header (009 running timer, 018 notifications, 004 account menu). Nothing non-functional is shown in those places now. A component test shows that hiding Invoices removes it while the order of the rest is unchanged, and that header content renders. A second layout without navigation exists for later sign-in and client-facing pages, and is viewable at `/design/plain`.

**Components** (each shown in the gallery in all its variants and states)

15. AC15 Buttons and forms:
    - Button: primary, secondary, quiet and destructive variants; small and medium sizes; icon-only (requires an accessible name at type level); disabled; and loading (shows a busy indicator, keeps its width, announces busy, and ignores further clicks).
    - Fields: text, email, password, number, multi-line text, select, checkbox, radio group, switch, search with a clear button.
    - Every field supports label, hint, required marker, disabled, read-only where applicable, and error. The label is programmatically tied to the control; errors use `aria-invalid` and `aria-describedby`; "required" is conveyed by more than colour.
    - Form error summary: on a failed submit, a summary lists each error, receives focus, and each entry moves focus to its field (without changing the path or query or reloading the page).
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

21. AC21 Gallery: `/design` shows every component above in all variants and states, with working examples (open a dialog, raise each toast, sort a 60-row table, trigger a page render error, and so on). It is included in the production build, is not in the navigation, and its data is clearly sample data and fictional.
22. AC22 Accessibility: an automated axe scan (WCAG 2.0/2.1/2.2 A and AA rules) run in Playwright reports zero violations on all eleven sections, not-found, the gallery and `/design/plain`, in both modes at 375px and 1440px, and with the drawer, a dialog, a menu, a combobox and the date picker open. Everything in the gallery is operable by keyboard alone with a visible focus indicator.
23. AC23 Clean run: loading and visiting every route logs no console errors or warnings at both bases and makes no request to a third-party origin (fonts and icons are bundled or system). One exception: if 001 specifies that the server answers an unknown page with status 404, the browser's own message about that document request is allowed. The deliberate gallery render error (AC21) is also exempt. Icons are SVG, not emoji. The favicon and brand mark are original and do not resemble Harvest's.
24. AC24 Commands: `npm run lint`, `npm test`, `npm run build` and `npm run e2e` pass on Node 18.20; every new dependency supports Node 18.20. Each component has tests covering its behaviours above; the shell has Playwright tests at 375px and 1440px, run against the production build served by the project's server, and the "both bases" criteria are part of `npm run e2e`.
25. AC25 Visual review: QA captures screenshots of Time, Reports and the gallery at 375, 768 and 1440 in both modes and finds no overlapping, clipped or unstyled elements, and consistent spacing and alignment (all spacing from tokens). Paths are listed in the QA report.

### Test scenarios

Happy path
- T1 Open the root URL on a 1440px window: path is `/time` (no `#`), title `Time | JET Time`, sidebar shows eleven items in order, Time is current. Press Back: leaves the app rather than bouncing to Time.
- T2 At 375px press the menu button, Tab repeatedly: focus cycles inside the drawer. Choose Invoices: drawer closes, path is `/invoices`, focus is on the "Invoices" heading.
- T3 Set OS to dark, mode System: app is dark; switch OS to light: app turns light without reload. Choose Dark, reload: dark from the first frame.
- T4 Table of 60 rows with an Hours column containing 2, 10, 9 and empty: ascending gives 2, 9, 10, empty; descending gives 10, 9, 2, empty; page 1 reads "1-25 of 60" and page 3 "51-60 of 60".
- T5 Combobox with projects grouped under "Acme Fabrication" and "Northline Utilities"; filtering matches project or client (group) name, ignoring case. Type `acm`: only the Acme Fabrication group and its projects appear. Press Down then Enter: the first of them is selected. Type `zzz`: "No matches".
- T6 Served at `/jettime/`, open `/jettime/`: path becomes `/jettime/time`. Click Reports: path is `/jettime/reports` with no document reload. Reload: Reports still shows, styled. Back: Time. Open `/jettime/design/plain` directly: styled, no failed requests.

Edge cases
- E1 Date picker, time zones `America/Los_Angeles` and `Pacific/Auckland`: choosing 8 Mar 2026 and 1 Nov 2026 (US clock changes) emits `2026-03-08` and `2026-11-01`.
- E2 Date picker: PageDown from 31 Jan 2026 moves to 28 Feb 2026; `2028-02-29` is accepted; `2/29/2027` is rejected with an error and no value emitted.
- E3 Date range "This week" with today 2026-11-23 (a Monday): Monday start gives 2026-11-23 to 2026-11-29; Sunday start gives 2026-11-22 to 2026-11-28. "This quarter" gives 2026-10-01 to 2026-12-31.
- E4 Press the skip link on `/reports?x=1`, at the root and at `/jettime/`: path and query are unchanged, the document did not reload, focus is in main content.
- E5 A 120-character unbroken project name in a table cell, badge, menu and page header at 320px: no horizontal page scroll, and the full name is available.
- E6 Five toasts raised at once: three visible, the rest appear in order as others leave. Hovering a success toast for 10 seconds keeps it.
- E7 Print preview of `/design` in dark mode: no navigation, dark text on white.
- E8 Progress bar at 0, 80, 100 and 135 percent: 135 shows an over-budget state in words and does not overflow its track.
- E9 Pick Dark, then emulate an OS change to light: stays dark.
- E10 With `Content-Security-Policy: script-src 'self'` added to the page response, choose Dark and reload `/design/plain`: dark from the first frame, no policy violation logged.
- E11 Open `/projects/` directly: the Projects page, with Projects marked current.

Failure cases
- F1 Storage blocked (accessing `localStorage` throws): app loads, theme control works for this visit, no uncaught error.
- F2 `jettime.` theme key set to `purple`: app loads in System mode.
- F3 Open `/nope` and `/time/nope` directly, and `/jettime/time/nope` when served at `/jettime/`: styled not-found page inside the shell; link goes to Time under the same base.
- F4 A page throws while rendering: error state with navigation still working; moving to Clients shows Clients.
- F5 Confirm dialog whose action rejects with "Could not delete": dialog stays open, shows the message, buttons enabled again. Double-clicking the confirm button runs the action once.
- F6 Submit the sample form with two invalid fields: error summary gets focus and lists two errors; activating the first moves focus to that field; path and query unchanged, no reload.
- F7 Date range with end before start: error shown, no value emitted.

### Out of scope
- Real content of any section, sign-in, permissions and module switches (004 onward). AC14 only leaves the hooks.
- A home dashboard (017 decides what `/` shows once it exists).
- Charts (007, 015), timesheet week/calendar grids (009), schedule grid and drag and drop (020), file upload (004, 011).
- Duration and money inputs and their parsing (009, and 007 or whichever task first needs money).
- User-configurable date/number formats and week start (022); the components only accept them as inputs.
- Settings screens, translations and right-to-left layout, user-chosen accent colours, high-contrast theme.
- Data access: nothing here calls the API or touches the database; the shell has no signed-in user yet.
- Server work: page fallback, the base path setting, security headers and the API's own errors belong to 001, 004 and 023. This task only fixes the web side so it works with them.
- Redirects from old `#/...` addresses: none were ever released.

### Assumptions
- 001 delivers the React/Vite app with history routing, lint, unit tests, a server that returns the web app for page addresses it does not otherwise handle, a way to choose the base path, and Playwright against that server. This task uses 001's base path mechanism as it finds it (including whether changing the base needs a rebuild) and "both bases" testing follows it. If 001 left web routing incomplete, this task completes it; if the server side is missing, report it rather than working around it.
- Page addresses in AC6 and `/design` belong to the web app; server endpoints live elsewhere (for example under `/api`).
- The theme choice is a per-device display preference needed before first paint, so it uses `localStorage` through one small module rather than the server. This does not breach the rule that shared app data lives in PostgreSQL behind the API; no business or personal data goes into browser storage.
- The strict script policy in AC5 is included now because 004 and 023 will harden the server and retrofitting the pre-paint step later is easy to miss.
- The gallery stays in the production build so that QA and the axe checks exercise what users get; 023 or 024 may remove it.
- Combobox, menu, badge, avatar, card, progress, pagination and range picker are added to the request's list because tasks 004 to 022 clearly need them on several screens.
- Breakpoints (640px, 1024px), the 5-second toast and Monday week start are PM choices; the engineer may pick headless accessible libraries or build in-house.
- Dates default to US-style display since the request is in US English; 022 makes it configurable.

### Size
L. Not split: every later screen depends on both halves, and the shell cannot be reviewed without the components. Suggested build order: tokens and modes, shell, form components, overlays, table, date pickers, gallery and axe checks.

## Implementation notes
### Files
- `src/web/styles/`: `tokens.css` (the only place for values; `light-dark()` with `color-scheme`, so each colour has both modes side by side), `base.css`, `print.css`.
- `src/web/theme/theme.ts`, `public/theme-init.js` (blocking external script, sets `data-theme` before first paint), `index.html` (loads it).
- `src/web/ui/`: the components, exported from `ui/index.ts`. `ui/overlay/` holds what dialogs, drawer and popups share (modal layers, focus, popup placement). Pure functions: `dates.ts`, `tableData.ts`, `comboboxFilter.ts`.
- `src/web/shell/`: `AppShell`, `PlainLayout`, `Page` (title and h1), `navigation.ts` (the one list), drawer, theme menu, skip link, `RouteEffects` (focus and scroll), `PageBoundary` (render errors).
- `src/web/pages/`: `SectionPage` (placeholder), `NotFoundPage`, `design/` (gallery at `/design`, `/design/plain`). `HomePage` removed: `/` now leads to `/time`.
- `ServerStatus.tsx` (001 AC10) moved from the removed home page to the "Server" section of `/design`; same behaviour, tests kept. It is the only API call of the web app.
- `e2e/`: `pages.ts` (helpers), `shell.spec.ts` and `theme.spec.ts` (both bases), `components.spec.ts` and `accessibility.spec.ts` (root), `smoke.spec.ts` adapted. `fixtures.ts` now also fails a test on console warnings and third-party requests. `src/web/test/setup.ts`: stubs for jsdom. `eslint.config.js`: browser globals for `public/*.js`.

Dependencies: `@fontsource-variable/archivo` (bundled typeface, OFL; CSS and font files only, no code), dev `axe-core` (AC22; used directly because the current `@axe-core/playwright` needs Node 22). Components are in-house, no UI library. Both work on Node 18.20.

### Acceptance criteria
- AC1 -> `--c-brand`, defined once; brand mark, primary button, current navigation item, all with dark ink. AC2 -> `tokens.test.ts` (every pair in use, in both modes), axe also hovered, selected and with errors. AC3 -> `tokens.test.ts` scans every style and component file for colour literals, and style files for spacing, font size, radius, shadow and z-index outside tokens.
- AC4, AC5 -> `theme.test.tsx`, `theme.spec.ts` (T3, E9, E10, F1, F2; records the mode when `<body>` begins and in the first frames; another tab follows too).
- AC6 to AC13 -> `App.test.tsx`, `AppShell.test.tsx`, `shell.spec.ts` (T1, T2, T6, E4, E11, F3). Also: Back while the drawer is open closes it.
- AC14 -> `AppShell` props `isNavItemVisible` and `headerContent`; `AppShell.test.tsx`.
- AC15 -> `Button.test.tsx`, `fields.test.tsx`, `Combobox.test.tsx` (T5, 500 options), `components.spec.ts` (F6). AC16 -> `tableData.test.ts`, `Table.test.tsx` (T4), `components.spec.ts`. AC17 -> `Dialog.test.tsx`, `components.spec.ts` (F5). AC18 -> `Toasts.test.tsx`, `components.spec.ts` (E6). AC19 -> `dates.test.ts`, `DatePicker.test.tsx` (E1, E2, E3, F7), `widgets.test.tsx` (E8), `components.spec.ts` (E1 in both time zones, F4).
- AC20 -> `shell.spec.ts` (print, E7; reduced motion). AC21 -> `/design`. AC22 -> `accessibility.spec.ts`: 14 pages, 2 modes, 2 widths, plus open drawer, menus, comboboxes, date picker, dialogs, tooltip, toasts; Tab through the whole gallery with a visible indicator. AC23 -> fixture on every spec, "visiting every page is quiet". E5 -> "Long text" section with the width test and popup tests.
- AC25 -> looked at Time, Reports and the gallery at 375, 768, 1440 in both modes, and at open overlays; QA to repeat.

### Commands run (Node 18.20.8, `DATABASE_URL=postgres://nobody@127.0.0.1:1/none`)
- `npm run build` 0, `npm run lint` 0, `npm test` 0 (21 files, 637 tests), `npm run e2e` 0 (146 passed, components and accessibility specs skipped at the second base), `npm run db:generate` "No schema changes".
- All e2e specs repeated 3 times: 438 passed, no flakes. `npm run dev` with `BASE_PATH=/jettime`: gallery loads, no console messages or failed requests.

### Rework after QA (rejection 1)
- **Bug 1 (AC25)**, `ui/Table.tsx`, `ui/Table.css`: cells now use `overflow-wrap: break-word`, and what is inside a value (badges too) inherits it, so a column is at least as wide as its longest word. Only cells with a word of 25 characters or more, which would push the table out of its box (E5), are marked `data-long-word` after rendering and may break it; they keep at least 12rem. New column option `nowrap` for short values, used for dates. Below 1024px the space between columns is smaller, so the gallery table fits at 640 without scrolling; the outer cells stay in line with the caption.
- Because words now set a minimum, a table with too many columns scrolls in its own container. That container then becomes a labelled region that takes focus, as with `narrow="scroll"`; a table that fits is not a Tab stop.
- Note c: the total is that of the rows given to the table (28.50). Note d: the visible caption is above what scrolls, `<caption>` itself is for screen readers. Note e: disabled select and search icons use the disabled colour, a disabled combobox keeps its arrow as a disabled button. Notes a and b, `tokens.test.ts`: `text-muted` on `accent-soft` added; all CSS colour names are found in style sheets (also in the last declaration of a block) and in TSX strings (`style={{ color: 'tomato' }}`, `fill="red"`, borders, gradients), with tests of the check itself.
- Tests: `components.spec.ts`: whole words, badges and dates and a fitting table at 640, 768 and 1024 (one test each); long words at 640 to 1440; overflowing table; caption at 320; totals; disabled icons. Against the old sources the first three fail ("Submitted", "Approved", "Rejected" and the dates broken), as do those for overflow, caption, totals and icons; the long-word test fails with the marking turned off. `Table.test.tsx` (3), `Combobox.test.tsx` (1), `tokens.test.ts` (25).
- Commands on the final state, Node 18.20.8, 2026-11-24, `DATABASE_URL` as above: `npm run build` 0, `npm run lint` 0, `npm test` 0 (21 files, 666 tests), `npm run e2e` 0 (154 passed, 94 skipped by design at the second base). `components.spec.ts` five times over: 145 passed. `npm run db:generate` "No schema changes". Looked at tables, long text, select, search and combobox at 320 to 1440.
- Limit: a cell whose own content changes to a very long word without the table rendering again is not marked until the next render; the table then scrolls in its box.

### Design choices and assumptions
- Dialogs use `inert` on everything else instead of `aria-modal`, because `aria-modal` would hide the toasts that must stay usable above a dialog (AC18). In a dialog, Tab also goes through visible toasts.
- Hovering or focusing any toast holds all of them, so that others leaving cannot move one away from under the pointer. Pressing a toast button with the pointer does not move focus.
- Popups use the browser's `popover` top layer, so dialogs and scrolling containers do not cut them off.
- A date is taken over on Enter or on leaving the field, not while typing. While the text is not a date, `value` stays the last good one; forms can use `onProblemChange`. The range picker gives a value only for two ordered dates, or both empty.
- `/time/nope` shows "Page not found" with Time marked current (AC7 sub-route rule).
- Unused sections show "Not available yet"; the search, menus and buttons of the gallery say that they are samples.

### Known limitations
- Needs browsers from about mid 2024 (`light-dark()`, popover). Tested in Chromium only; Firefox, Safari and screen readers were not available here.
- Section fragment links across pages scroll to the top (AC13 wording); a direct `/design#tables` goes to the section.
- `history.scrollRestoration` is manual, so a reload starts at the top.

### Follow-ups
- 004: theme choice is per device; nothing to do unless wanted per user. Use `PlainLayout` for sign-in.
- 023: with a strict `style-src`, note that components set a few inline styles through the DOM (allowed) and none in HTML.
- Dialogs with unsaved input have no "discard changes?" question yet; decide with the first real form.

## QA report
**Overall: PASS** (second pass, after rework 1; the first pass failed on AC25). Node 18.20.8, 2026-11-24. Rerun by QA with `DATABASE_URL=postgres://nobody@127.0.0.1:1/none`:
`npm run build` 0, `npm run lint` 0, `npm test` 0 (21 files, 666 tests), `npm run e2e` 0 (154 passed, 94 skipped by design at the second base), `npm run db:generate` "No schema changes". No `.only` or retries; the only skips are the two file-level ones for the second base. Own Playwright scripts against the built server: 114 shell and theme checks (both bases), 134 component checks, 67 reflow, touch, axe and print checks, 16 server checks, 31 checks of tables and toasts, plus a fixture page with eight hard tables in a copy of the project.

**Bug 1 (AC25): fixed.** At 28 widths from 320 to 1920 (including 640, 700, 768, 1023, 1024 and pages 2 and 3 of the table), no word under 25 characters is broken anywhere in the gallery, no date wraps, and the page never scrolls sideways. The tables fit from 640 up, so they are not Tab stops there.

| AC | Result | Evidence |
| --- | --- | --- |
| 1 | PASS | `#3cb371` only in tokens.css and the favicon; brand mark and primary button computed `rgb(60,179,113)` with dark text, both modes |
| 2 | PASS | `tokens.test.ts` (dulling `accent-soft` in a copy fails it), axe 0 |
| 3 | PASS | Scan passes; adding `tomato` in CSS and in TSX (in a copy) now fails it |
| 4 | PASS | System follows the OS live, Dark overrides, back to System; both bases (T3, E9) |
| 5 | PASS | App script delayed, CSP `script-src 'self'`, `/design/plain`, both bases: dark before the app ran, no violations (E10). Storage throwing, null, `setItem` throwing, `purple` (F1, F2) |
| 6 | PASS | Order, hrefs with base, no reload, Meta-click, Back (T1, T6); both bases |
| 7 | PASS | `aria-current`, titles, `/time/nope` keeps Time; component test |
| 8 | PASS | 21 addresses opened directly at both bases: styled, one h1, nothing of 400 or more (F3, E11) |
| 9 | PASS | One h1, "Not available yet", no controls |
| 10 | PASS | 1280x720 all items in view; sidebar at 1024, drawer at 1023 |
| 11 | PASS | Focus trap, inert page, Escape, tap outside, item choice (T2), growing to 1200, 667x320 |
| 12 | PASS | 14 pages at 5 widths, touch targets at 320, 375, 768, also in open overlays |
| 13 | PASS | h1 focus and scroll on path change only; skip link (E4), both bases |
| 14 | PASS | `AppShell.test.tsx`; `/design/plain` works |
| 15 | PASS | Labels, described errors, loading button, F6, T5, 500 options. Disabled combobox keeps a disabled arrow that opens nothing |
| 16 | PASS | T4, stable sort, empties last, page-only selection, mixed state, totals 307.50 and 28.50 (equal to the sum of their rows), stacked and scrolling variants, sort and selection kept when crossing 640. A table that overflows becomes a labelled region with a visible focus ring; arrow keys scroll it; its row menu is not cut off |
| 17 | PASS | Trap, inert, scroll lock, Escape, outside press and opt-out, opener gone, 320x568, F5 |
| 18 | PASS | Real time: 5 s, hover 10 s, focus, 3 visible then the rest (E6), roles, above a dialog; five dismissed by keyboard in a row, 8 of 8 runs. (One check in the rerun failed because it pressed Enter twice with no pause, before focus had moved on to the next toast; with 60 ms between presses it always works. The toast code did not change) |
| 19 | PASS | Tabs, menu and calendar keys; E1 in three time zones; E2, E3, presets, F7, E8, F4, tooltip |
| 20 | PASS | E7 in dark mode; no motion over 10 ms when reduced. See note a |
| 21 | PASS | All components and states present, sample data labelled |
| 22 | PASS | Axe spec rerun and own runs: 0. Also 0 on the eight hard tables, both modes, 375, 768, 1440 |
| 23 | PASS | Nothing in the console, no failed or third-party requests, both bases; `npm run dev` also clean at both |
| 24 | PASS | Commands above; axe-core `node >=4`, the font has no engine limit |
| 25 | PASS | Fresh screenshots of Time, Reports and every gallery section at 375, 768, 1440 in both modes, and open overlays: nothing overlapping, clipped or unstyled, alignment consistent |

**E5:** at 320, the 120-character name is whole and unclipped in the page header, table cell, badge and menu; page does not scroll sideways.

**Small items of the rework:** notes a and b (colour pair, colour names) verified by faults in a copy; c (totals), d (caption whole, outside what scrolls, table still has its own `<caption>`), e (icons of disabled select, search and combobox have the disabled colour). With the long-word marking turned off in a copy, `Table.test.tsx` fails.

**Hard tables (fixture):** two long names in one row, words of 24, twelve columns, email and URL, 40-digit number, text changing after load, toggled long text, long run of inline elements: page never scrolls sideways at 320 to 1440; what cannot fit scrolls in its own region; marking goes on and off correctly; no errors, also without `ResizeObserver`.

**Screenshots:** `/private/tmp/claude-501/-Users-jacobg/c94458db-ae8d-4d76-bf62-4c413bea25ef/scratchpad/qa3/shots/` : `time|reports|design-top|design-full-{375,768,1440}-{light,dark}.png`, `sec-<section>-<width>-<mode>.png`, `ov-*.png`, `table-768.png`, `table-1024.png`, `v-e5-320.png`, `adv-375.png`, `adv-768.png`, `adv-print.png`. Contact sheets `/private/tmp/claude-501/-Users-jacobg/c94458db-ae8d-4d76-bf62-4c413bea25ef/scratchpad/qa3/s-*.png`. (Headers and skip links across tall section images are stitching artefacts; so is the cut last control in two 375px sections, seen whole in `v-combo-375.png` and `v-tooltip-375.png`.)

**Regression of 001:** server status (checking, connected, 503, stopped, retry), API 404, health, missing asset, outside prefix, traversal, no `X-Powered-By`: unchanged. Demo with `DATABASE_URL` and production without it still refuse. All servers stopped; source checksums equal to those before QA; faults only in copies.

**Notes, not failing:**
- a. Print below 1024px of page width: in a table with selection and actions, the first and last printed columns sit 8px outside the caption (9 against 17), because the new rule for outer cells looks at `:first-child`/`:last-child`, which are hidden in print. New with the rework, cosmetic.
- b. A table wider than the paper is cut off in print (it scrolls on screen). Matters for 012 and 015, which print wide tables.
- c. If the scrolling region has focus and the window grows so that the table fits, focus falls to `body`. Very minor.
- d. With the root font at 200% and a 1024px window, the date range picker makes the page scroll sideways by 130px (browser zoom is fine, as the widths of AC12 show). Not part of an AC.
- e. A `nowrap` or numeric value is never broken; a very long one scrolls the table. Sensible, as documented for `nowrap`.
- f. Only Chromium was available.

## PM acceptance
**ACCEPTED** (2026-11-24)

Basis: the spec, the implementation notes, the second QA report, about 25 of QA's screenshots (shell pages, gallery sections, drawer, dialogs, calendar, print; phone, tablet and desktop; both modes) and a short reading of the shell, navigation, theme pre-paint and page sources. I had no shell in this review, so I did not run the app or the commands; behaviour rests on QA's evidence.

- **Goal met.** The shell looks professional and consistent in both modes, mediumseagreen is clearly the brand colour with dark text on it, and all eleven sections are in the requested order on phone and desktop. The components cover what 003 to 024 need.
- **Criteria.** All 25 have passing evidence in the QA report. The earlier AC25 failure is gone: in the 768 and 1440 table screenshots statuses and dates are whole. The only skipped e2e tests are the component and accessibility specs at the second base, which the spec does not ask for there.
- **Honest content.** Unused sections say "Not available yet"; gallery people, companies and figures are marked as sample data.
- **The design choices listed above** (`inert` instead of `aria-modal`, Time staying current on `/time/nope`, dates taken over on Enter or leaving the field) are accepted.

Not blocking, to carry forward:
1. Tables in print: outer columns 8px off the caption on narrow paper (QA note a) and wide tables cut off at the paper edge (note b). To be fixed in the first task with a printed table, 012 or 015 at the latest; the cut-off would lose data on paper.
2. Firefox, Safari and real screen readers are untested, and browsers older than about mid 2024 are not supported. 024 should test them, and JET Engineering should be told the browser requirement.
3. Date range picker at 200% root font (note d) and focus lost when a scrolling table starts to fit (note c): fix when those components are next changed.
4. Managers should be shown the app after the first real sections exist (009 onward): today every section is a placeholder, and only `/design` shows the components.

## History
- 2026-11-23 created
- 2026-11-23 PM: groomed
- 2026-11-23 ORCH: todo -> groomed
- 2026-11-23 ORCH: back to todo; user moved the target from GitHub Pages to JET's own servers; spec kept for revision
- 2026-11-23 PM: groomed (revised for server hosting and history routing)
- 2026-11-23 ORCH: todo -> groomed (revised)
- 2026-11-23 ORCH: groomed -> in-progress
- 2026-11-23 SWE: implemented
- 2026-11-23 ORCH: in-progress -> qa
- 2026-11-23 QA: fail (AC25)
- 2026-11-23 ORCH: QA FAIL (rejection 1 of 3), qa -> in-progress
- 2026-11-24 ORCH: rework interrupted by usage limit, resumed
- 2026-11-24 SWE: reworked
- 2026-11-24 ORCH: in-progress -> qa (rework 1)
- 2026-11-24 QA: pass
- 2026-11-24 ORCH: QA PASS, qa -> review
- 2026-11-24 PM: accepted
- 2026-11-24 ORCH: PM ACCEPTED, review -> done
