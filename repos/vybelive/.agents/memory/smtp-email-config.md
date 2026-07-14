---
name: SMTP / outbound email config
description: How beta waitlist + invitation email is wired, and the Gmail From-rewrite gotcha
---

# Outbound email (beta waitlist + invitations)

Transport lives in `artifacts/api-server/src/services/email.ts`. Provider-agnostic
SMTP via nodemailer, driven by env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`
(optional), and the `SMTP_PASS` secret. Real-delivery only — `sendMail` throws when
unconfigured instead of faking success, so callers log a real failure.

## Gmail From-rewrite gotcha
**Gmail rejects/rewrites a `From` that doesn't match the authenticated mailbox (or a
verified "Send mail as" alias).** So when `SMTP_FROM` is unset, `BETA_FROM_EMAIL`
falls back to the authenticated `SMTP_USER`, not a hardcoded brand address.

**Why:** the provider direction flipped Resend → GoDaddy → Gmail. Pinning From to
`beta@getvybe.live` while authenticating as a gmail.com account causes silent
rewrite or rejection. Priority is delivery over branding.

**How to apply:** if switching providers again, set `SMTP_HOST/PORT` and the
`SMTP_USER`/`SMTP_PASS` for that provider; only override `SMTP_FROM` if you have a
verified alias on that mailbox. Gmail needs an App Password (2FA on), not the login
password.

## Signup-never-lost invariant
In `routes/waitlist.ts` the DB insert is awaited BEFORE the welcome email, which is
fire-and-forget (`.then` logs "Waitlist welcome email sent", `.catch` logs
"Waitlist welcome email failed"). Keep this ordering — email failure must never
block or roll back the signup.

## Testing SMTP from the shell
nodemailer only resolves inside the `artifacts/api-server` package — a script in
`/tmp` or the workspace root fails with ERR_MODULE_NOT_FOUND. Write the test script
into the api-server dir (or use the `POST /admin/email/test` admin endpoint).
