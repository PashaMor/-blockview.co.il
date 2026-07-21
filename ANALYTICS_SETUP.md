# Analytics, Search Console & the daily Telegram report

Everything is already in the code. What's left is creating the accounts and
pasting the IDs. Do the steps in order — the daily report needs the first two.

---

## 1. Google Analytics 4

1. https://analytics.google.com → **Admin → Create → Property**
   - Name `BlockView`, time zone **Israel**, currency **ILS**.
2. **Data streams → Add stream → Web**
   - URL `https://blockview.co.il`, stream name `BlockView web+app`.
   - One stream is enough: the Android app loads the hosted site, so it reports
     into the same stream. `surface` (web/app) is what separates them.
3. Copy the **Measurement ID** (`G-XXXXXXXXXX`) into
   [www/js/config.js](www/js/config.js) → `GA4_ID`.
4. **Admin → Custom definitions → Create custom dimension** (do this 2×,
   scope **User**), otherwise the app-vs-web breakdown stays empty:

   | Dimension name | Scope | User property |
   |---|---|---|
   | Surface | User | `surface` |
   | App area | User | `app_area` |

5. Copy the **numeric property ID** — the report needs it. Get it from
   **Admin → Property details**. Careful: this is *not* the `G-B69ZV5EFZQ`
   measurement id, and *not* the Stream ID shown on the data-stream page. Three
   different numbers live one click apart:

   | Where you see it | Looks like | Used for |
   |---|---|---|
   | Data stream → Measurement ID | `G-B69ZV5EFZQ` | `GA4_ID` in config.js (already set) |
   | Data stream → Stream ID | `15294320588` | nothing we use |
   | Admin → Property details | `546419338` | `GA4_PROPERTY_ID` env var |

The "Data collection isn't active" warning on the stream page clears by itself
once the first real page view arrives; it is not a sign of a broken tag.

What is measured: page views on the site, CRM and admin console (separated by
`app_area`), plus the listing events already tracked internally —
`listing_impression`, `listing_detail`, `listing_contact`, `listing_lead`,
`listing_share`, `listing_favorite`. **No listing id, email or user id is ever
sent to Google**, and ad personalisation / Google signals are switched off.

---

## 2. Google Search Console

Use a **Domain property**, not a URL prefix — it covers `blockview.co.il`,
`www.`, `crm.` and `admin.` in one go, and needs no file in the repo.

1. https://search.google.com/search-console → **Add property → Domain** →
   `blockview.co.il`.
2. It gives you a `TXT` record. In **Cloudflare → DNS → Add record**:
   - Type `TXT`, Name `@`, Content `google-site-verification=…`
3. Back in Search Console → **Verify**.
4. **Sitemaps → Add sitemap** → `sitemap.xml`
   ([www/sitemap.xml](www/sitemap.xml) is already deployed).

   You have to do this by hand, because **Cloudflare serves its own managed
   `robots.txt`** (AI-crawler blocks + content signals) and ours never reaches
   Google — so the `Sitemap:` line in [www/robots.txt](www/robots.txt) is
   ignored. That is fine otherwise: Cloudflare's version says `search=yes` and
   `Allow: /`, and the CRM and admin console are kept out of the index by their
   `<meta name="robots" content="noindex, nofollow">` tags rather than by
   robots.txt. If you ever want our file to win, turn the managed robots.txt
   off under Cloudflare → **AI Crawl Control**.

`crm.` and `admin.` carry `<meta name="robots" content="noindex, nofollow">`
and are disallowed in [www/robots.txt](www/robots.txt), so they stay out of the
index while still being covered by the property.

Note: Search Console data lags ~2 days, which is why the daily report shows
search numbers for *three* days ago while traffic is for yesterday.

---

## 3. Google service account (lets the report read GA4 + GSC)

1. https://console.cloud.google.com → create/pick a project.
2. **APIs & Services → Enable APIs** → enable **Google Analytics Data API** and
   **Google Search Console API**.
3. **IAM & Admin → Service Accounts → Create** — name `blockview-reporter`.
   No project role is needed; access is granted per-product below.
4. On the service account → **Keys → Add key → JSON**. Download it.
   **Do not commit this file.** You only need two fields out of it:
   `client_email` and `private_key`.
5. Grant it read access in each product:
   - GA4: **Admin → Property access management → +** → paste the
     `client_email`, role **Viewer**.
   - Search Console: **Settings → Users and permissions → Add user** → same
     email, permission **Full** (Restricted cannot call the API).

---

## 4. Telegram bot

1. Talk to **@BotFather** → `/newbot` → copy the token
   (`123456:AA…`).
2. Get the chat id: send any message to your bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read
   `result[0].message.chat.id`.
   For a channel: add the bot as an admin and use the `-100…` id.

---

## 5. Vercel environment variables

Project → **Settings → Environment Variables** → add each for
**Production** (and Preview if you want to test there):

| Name | Value |
|---|---|
| `CRON_SECRET` | any long random string — generate with `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `TELEGRAM_CHAT_ID` | your chat / channel id |
| `GA4_PROPERTY_ID` | `546419338` |
| `GSC_SITE_URL` | `sc-domain:blockview.co.il` |
| `GOOGLE_CLIENT_EMAIL` | `client_email` from the JSON key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON key, pasted whole including `-----BEGIN PRIVATE KEY-----` |
| `SUPABASE_URL` | `https://vphmiqhpiyzoolfpquvb.supabase.co` |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` from Supabase → API keys |

`SUPABASE_SECRET_KEY` is used **only** inside
[api/daily-report.js](api/daily-report.js), which runs on the server. It is
never bundled into `www/` and never reaches a browser. The report asks the
database for counts only (`HEAD` + `count=exact`), so no listing, lead or
personal row leaves Supabase.

---

## 6. Schedule & testing

The cron is declared in [vercel.json](vercel.json):

```json
"crons": [{ "path": "/api/daily-report", "schedule": "0 5 * * *" }]
```

`0 5 * * *` is **UTC** → 08:00 Israel in summer, 07:00 in winter.
Vercel Hobby allows one run per day; this is exactly one.

Fire it by hand to test (PowerShell):

```powershell
curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://blockview.co.il/api/daily-report
```

Without that header the endpoint answers `401` — and if `CRON_SECRET` is not
set at all it refuses **every** request rather than falling open.
