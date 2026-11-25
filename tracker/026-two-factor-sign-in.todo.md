# 026 Two-factor sign-in

## Request
Depends on: 004, 005 (best built soon after them, and before 023 and 024, which document and verify it)

Split off from 004 by the PM because of size. From the 004 request: "optional two-factor (TOTP)", with "two-factor ... all server-side".
A person can turn on two-factor with an authenticator app (QR code and manual key, confirmed with a code), gets one-time recovery codes shown once, can renew them and turn it off with password and code. Sign-in then asks for a code or recovery code before a session exists, with rate limits and no code accepted twice. Invite and password-reset links do not bypass it. An administrator can reset it for someone who lost their device, and `npm run admin:create -- --reset` does so for a lone administrator. Optional: an administrator can require it for chosen roles. The secret is stored only encrypted, with a key from the environment; recovery codes only as hashes (003 has the columns). One-click demo sign-in stays one click.

Overall goal: match every Harvest capability in this area or provide something similar, within the product rules in CLAUDE.md.

Note from 005 PM: administrator reset of two-factor must use 005's outranking rule.

Note from 004 PM: keep the `SignInProof` (person and password version) between the two steps and pass it to `beginSession`, which checks it again, so that a password change or archiving in between ends the sign-in.

## Spec
_PM fills this in during grooming._

## Implementation notes
_Software engineer fills this in._

## QA report
_QA tester fills this in._

## PM acceptance
_PM fills this in after QA passes._

## History
- 2026-11-23 created (split from 004 by PM)
- 2026-11-24 PM: note added (from 004 acceptance)
