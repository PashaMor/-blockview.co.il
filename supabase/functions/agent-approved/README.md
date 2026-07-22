# Agent-approved email — setup

Sends "אושרת כסוכן" with a CRM link when an admin approves an agent. The Resend
API key lives only in the function's env, never in the browser.

## 1. Resend account (free: 3,000 emails/month)

1. https://resend.com → sign up.
2. **Domains → Add domain** → `blockview.co.il`. Resend shows DNS records
   (SPF/DKIM, and a MX for the bounce subdomain). Add them in **Cloudflare**
   as **DNS-only (grey cloud)**. Wait for Resend to mark the domain **Verified**
   (usually minutes).
   - Until the domain verifies you can test from Resend's sandbox
     `onboarding@resend.dev`, but real sends need your own verified domain.
3. **API Keys → Create** → copy the `re_...` key.

## 2. Deploy the function

Needs the Supabase CLI (`npm i -g supabase`), logged in and linked to the project
(`supabase link --project-ref vphmiqhpiyzoolfpquvb`).

```bash
# from the repo root
supabase functions deploy agent-approved

# secrets (SUPABASE_URL + SERVICE_ROLE_KEY are injected automatically)
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set FROM_EMAIL="BlockView <noreply@blockview.co.il>"
```

`FROM_EMAIL` must be on the **verified** domain, or Resend rejects the send.

## 3. Done

Approving an agent in the console now also emails them. It is best-effort: if the
function isn't deployed or the send fails, the approval still stands and the admin
sees a toast — nobody is blocked.

## Security notes

- The key is only in the function env. The browser calls the function with the
  admin's session; the function re-verifies the caller is an **admin** (service
  role) and that the **target is already an agent**, so it can only ever send a
  truthful "approved" message and can't be turned into a spam relay.
- No DB change and no new privileges. `review_agent_application()` is untouched.
