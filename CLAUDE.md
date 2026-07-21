# BlockView — Project Rules & Conventions

Read this before touching anything. These are the standing rules for this project,
agreed with the project owner. They override default habits.

---

## 1. Working style

- **Answer super short.** Terse Q&A. No preamble, no essays, no restating the plan.
  Do the work, report the result in a few lines.
- Don't re-explain decisions already made (they're in this file).
- Ask only when the answer genuinely changes what you build. Otherwise pick the
  sensible default and say what you picked.

## 2. Security is the top priority

Always default to the secure choice, even when it's more work.

- **Every SQL snippet you hand the owner must come with a security verdict** —
  say plainly whether it's safe to run and why. Flag `SECURITY DEFINER`,
  dynamic SQL, RLS impact, privilege changes, destructive ops. Never hand over
  SQL without that verdict.
- **RLS on every table.** No exceptions. Users read/write only their own rows.
- **Frontend gets the publishable key only** (`sb_publishable_…`).
  The secret key (`sb_secret_…`) must NEVER appear in the repo or the browser.
- **Escape all user-supplied text** before putting it in `innerHTML`
  (listing titles, descriptions, lead names/messages). Stored XSS is a real risk here.
- **Never trust the client for authorization.** UI gates are cosmetic; the DB must
  enforce. Existing server-side guards:
  - `protect_profile_fields` — users can't change their own `role` or `plan`
    (privilege escalation / free Pro).
  - `enforce_listing_status` — nobody can self-approve a listing onto the public map.
  - `set_lead_agent` — a lead's `agent_id` comes from the listing, so it can't be spoofed.
  - `is_admin()` requires **aal2** (2FA), so a stolen password alone grants no admin power.
- Pin `search_path = public` on every `SECURITY DEFINER` function.

## 3. Machine etiquette

- **Never blanket-kill processes.** No `taskkill /IM python.exe`, `killall node`,
  `pkill -f python`. The owner runs **other projects' servers on this machine**
  (e.g. something on port **3000**). Only stop a server you started, by port/PID.
- Our local dev server is **port 5173**, serving `www/`.

## 4. Build & delivery

- **APKs go to the project root only** (`f:\Projects\3D Map\BlockView.apk`).
  **Never** host an APK on the website or commit it (`.gitignore` blocks `*.apk`).
- Web changes need **no APK rebuild** — the Android app loads the hosted site
  (see §6). Only native/config changes need a rebuild.
- Bump the cache-busting `?v=N` in `www/index.html` on **every** web change,
  or browsers/WebViews serve stale files.
- **The legal pages are generated.** `www/legal/*.html` is built from
  `www/legal/lang/*.js` by `node tools/build-legal.js`. Editing a lang file
  changes nothing on the site until you re-run it and commit the HTML — the
  two can drift silently, and the HTML is what users and a court actually see.
  Never hand-edit the generated HTML.

---

## 5. What this is

A 3D real-estate discovery app for Israel. You orbit a 3D city, **tap a building,
and see the units for sale/rent inside it.** The tappable 3D map is the
differentiator vs Yad2/Madlan.

**Listings come from owners and agents posting directly. We do NOT scrape**
(Yad2 / Madlan / Facebook) — decided deliberately: ToS violations, Israeli Privacy
Protection Law, copyright, and it's a fragile foundation. Don't propose scraping.

## 6. Live URLs & deploy

| What | URL |
|---|---|
| Website + 3D map | https://blockview.co.il (and `www.`) |
| Agent CRM | https://crm.blockview.co.il |
| Superadmin console | https://admin.blockview.co.il |

- Hosted on **Vercel**, auto-deploying from GitHub `PashaMor/-blockview.co.il` (branch `main`).
- **Push to `main` = deploy to the website AND the app.**
- DNS on **Cloudflare**. `vercel.json` does host-conditioned `rewrites` (subdomains)
  + `redirects` (`/crm` and `/admin` → their subdomains). Web root is `www/`.
- The **CRM lives only at its subdomain** — `blockview.co.il/crm` 308-redirects there.

## 7. Layout

```
www/                 the website (Vercel serves this)
  index.html         3D map app
  js/app.js          map, filters, sheets, listing detail
  js/auth.js         Supabase auth + per-user data (favorites/follows/notes/prefs)
  js/publish.js      owner "publish a property" flow (WEBSITE ONLY)
  js/i18n.js         6 languages + RTL
  js/data.js         sample buildings/listings (being replaced by the DB)
  js/config.js       Supabase URL + publishable key
  vendor/            MapLibre + Supabase bundled locally (no CDN at runtime)
  crm/               agent CRM
  admin/             superadmin console
supabase/            SQL migrations, run manually in the SQL editor (NN_name.sql)
android/             Capacitor Android project
capacitor.config.json  server.url points at the hosted site
```

## 8. Product decisions (don't undo these)

- **Publish flow is website-only.** The "＋ פרסם נכס" button is `.remove()`d inside
  the native app (detected via `window.Capacitor`).
- Publish button → asks **owner vs realtor** → realtor goes to the CRM,
  owner gets an inline form.
- **Roles:** `user` | `agent` | `admin`. Agents use the CRM; admins use the console.
- **Plans:** free = 3 saves / 0 follows (following is Pro-only). Pro = ₪7.90/mo or ₪54.90/yr.
- **2FA:** mandatory for admins (enforced via `aal2` in the DB), optional for agents.
- **Languages:** HE (default), EN, ES, AR, FR, RU. HE/AR are RTL. Hebrew-first UI.
- New listings land in `pending` and only appear on the map once an admin approves.

## 9. Database

- Migrations are plain SQL in `supabase/`, numbered, **idempotent**, run by the
  owner in the Supabase SQL editor. Never assume one was run — code defensively.
- Query `profiles` with `select("*")`, not a fixed column list. A missing column
  makes the whole query error and silently wipes the user's profile state
  (this bit us once — avatar/notifications/filter all "disappeared").

---

## 10. Gotchas we already paid for

- **`[hidden]` loses to author `display` rules.** `.gate { display: grid }` kept a
  hidden element visible. Always ship `[hidden] { display: none !important; }`.
- **The apex redirects to `www`** — use `curl -L`, or you'll "confirm" a bug that
  isn't there by reading the redirect page.
- **Don't use very modern JS in `www/js/`.** Optional chaining (`?.`) broke an older
  phone WebView and blanked the whole script. Keep it conservative.
- **No CDN dependencies at runtime.** MapLibre/Supabase are vendored into `www/vendor/`
  precisely because a CDN stall blanked the app on a real device.
- **"Black screen" on a device was a stale APK**, not a code bug — it still pointed at
  an old live-reload dev server. **Check the APK timestamp before blaming code.**
- **Capacitor's bundled `https://localhost` mode black-screened** on the owner's phone.
  That's why the app loads the hosted URL instead. Don't "fix" it back to bundled
  without testing on a real device.
- **Cloudflare proxy (orange cloud) vs Vercel** — needs the domain added in Vercel or
  you get a 525. Vercel prefers "DNS only" (grey).
- **Overpass (OSM) API is flaky** — expect timeouts and HTML error pages; handle both.
- Tel Aviv light rail: only the **Red line** is properly mapped in OSM. Purple/Green
  aren't — we deliberately show nothing rather than fake routes.
