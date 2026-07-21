# Production email (SMTP) — BlockView

Supabase's built-in email sender is **testing only**: it accepts a handful of
messages per hour and it *only delivers to addresses on your project's team*.
That is why signing up with `someone@gmail.com` fails with
`Email address "..." is invalid` — the address is fine, the sender refuses it.

Until this is done, **no real user can register**.

---

## 1. Pick a provider

| Provider | Free tier | Notes |
|---|---|---|
| **Resend** (recommended) | ~3,000/month | Fastest setup, good deliverability, clean DNS instructions |
| Amazon SES | 3,000/month (first year) | Cheapest at scale, starts in sandbox — request production access |
| Brevo | 300/day | Fine, slightly noisier dashboard |

If the `@blockview.co.il` mailboxes come with SMTP credentials, those work too —
but a transactional provider gives far better deliverability for automated mail.

## 2. Verify the domain and add DNS (Cloudflare)

Add the records the provider gives you. All three matter — skip them and Gmail
sends confirmations straight to spam:

- **SPF** — `TXT @` → `v=spf1 include:<provider> ~all`
  (if a record already exists, merge into it; never publish two SPF records)
- **DKIM** — the `CNAME`/`TXT` records from the provider, copied exactly
- **DMARC** — `TXT _dmarc` → `v=DMARC1; p=none; rua=mailto:dmarc@blockview.co.il`
  (start at `p=none`, tighten to `quarantine` once reports look clean)

Set these to **DNS only** (grey cloud) in Cloudflare — mail records must not be proxied.

Wait for the provider to show the domain as verified before continuing.

## 3. Configure Supabase

**Authentication → Emails → SMTP Settings → Enable custom SMTP**

| Field | Value |
|---|---|
| Host | provider's SMTP host (e.g. `smtp.resend.com`) |
| Port | `587` (STARTTLS) |
| Username | provider's SMTP user (Resend: `resend`) |
| Password | the provider's API key / SMTP password |
| Sender email | `no-reply@blockview.co.il` |
| Sender name | `BlockView` |

The SMTP password is a secret: it lives only in the Supabase dashboard. Never in
this repo, never in `www/`.

## 4. Raise the rate limits

**Authentication → Rate Limits**

- *Rate limit for sending emails* — this only takes effect with custom SMTP. 30/hour
  is a sane start; raise it as signups grow.
- *Rate limit for sign ups and sign ins* — per 5 minutes per IP, default 30. Leave
  it unless you see legitimate users blocked; it is real abuse protection.

## 5. Templates

**Authentication → Emails → Templates.** Paste the files from
`supabase/email/` — they are Hebrew-first with an English section below, RTL, and
branded. Set the subjects to:

| Template | Subject |
|---|---|
| Confirm signup | `אישור כתובת האימייל שלך ב-BlockView` |
| Reset password | `איפוס הסיסמה שלך ב-BlockView` |
| Magic link | `קישור כניסה ל-BlockView` |
| Change email address | `אישור כתובת האימייל החדשה שלך ב-BlockView` |

## 6. Re-enable confirmation and test

1. **Authentication → Providers → Email → tick "Confirm email"** (turn it back on
   if it was disabled for testing).
2. Sign up on https://blockview.co.il with an address that is **not** on your team
   — a personal Gmail, a colleague's address.
3. Confirm the mail arrives **in the inbox, not spam**, renders right-to-left, and
   the link signs you in.
4. Test the password reset from `/reset` too — it uses the same sender.
5. Optional: send a test to https://www.mail-tester.com and aim for 9/10 or better.

## Checklist

- [ ] Provider account created, domain verified
- [ ] SPF, DKIM, DMARC in Cloudflare (DNS only, not proxied)
- [ ] Custom SMTP enabled in Supabase
- [ ] Email rate limit raised
- [ ] Hebrew templates pasted, subjects set
- [ ] "Confirm email" back on
- [ ] Signup tested with a non-team address, landed in the inbox
- [ ] Password reset tested
