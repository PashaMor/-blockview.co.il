# BlockView — Supabase setup

Do these steps, then paste me the **Project URL** and **anon public key** and I'll wire the app (auth UI, sign-up gating on save/follow, plan limits).

## 1. Create the project
1. Go to https://supabase.com → sign in → **New project**.
2. Pick a name (e.g. `blockview`), a strong DB password, and a region (**Frankfurt** is closest to Israel).
3. Wait for it to finish provisioning (~2 min).

## 2. Create the database tables
1. In the project: **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. It creates `profiles`, `favorites`, `follows`, `notes`, with Row-Level Security and the free-tier limits (5 saves / 3 follows; Pro unlimited).

## 3. Enable the login methods
**Authentication → Providers**:

- **Email** — turn on. (Simplest; works immediately.)
- **Google** — turn on, then paste a Google OAuth **Client ID + Secret**:
  - Create them at https://console.cloud.google.com → *APIs & Services → Credentials → OAuth client ID (Web)*.
  - Add the redirect URL Supabase shows you (looks like `https://<your-ref>.supabase.co/auth/v1/callback`).
- **Apple** — turn on when ready. ⚠️ Heavier: needs an **Apple Developer account ($99/yr)**, a Services ID, and a signing key. You can launch with Email + Google and add Apple later — it won't require code changes.

## 4. Give me the keys
**Project Settings → API**, copy:
- **Project URL**
- **anon public** key

Paste both to me. I'll drop them into [`js/config.js`](js/config.js) and connect everything.

---

### What happens after you paste the keys
- Save (♥) and Follow (🔔) will require sign-up; a login sheet appears if you're logged out.
- Favorites / follows / notes move from your browser to your account (synced across devices).
- Free accounts are capped at **5 saves / 3 follows**; hitting the cap shows a **"Upgrade to Pro"** prompt. Flipping a user's `plan` to `pro` in the `profiles` table lifts the caps.
