# 004 Sign-up, sign-in and company membership

## Request
Depends on: 002, 003

User: "Users must be able to create accounts and assign them to companies etc etc." and "For demo purposes have an admin account and a user account. Actually have two user accounts. A project lead and a regular employee. Then the admin of course. Admin will be like the billing worker or something of the like."
Sign-in page with one-click demo sign-in for the three accounts, sign-up, sign-out, password hashing (WebCrypto), change password, profile with photo and time zone, optional two-factor (TOTP). A new account either joins JET Engineering as a pending member that an admin approves, or accepts an admin invite link. Admins can assign a person to one or more client companies and their projects.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Server change: sessions, hashing (instead of WebCrypto in the browser), two-factor, invite and password-reset links, rate limiting and sign-out of other sessions are all server-side. Includes the setup command for the first production administrator. One-click demo sign-in exists only when demo mode is on.

Note from 001 PM: pass no untrusted text to `navigate`; unexpected errors are logged with query parameter values, so keep secrets out of URLs and logs.

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
