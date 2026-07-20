# Google & Apple sign-in — setup steps

The code is done and shipped. The buttons stay **hidden** until you flip the flags in
[`www/js/config.js`](www/js/config.js), so nothing breaks while you work through this.

```js
OAUTH: { google: false, apple: false },   // flip to true when the provider is live
```

Do **Part A → B → D** for Google (30 min, free). Apple (Part C) needs a paid Apple
Developer account — skip it until you actually need an iOS app.

Your Supabase callback URL (you'll paste it a lot):

```
https://vphmiqhpiyzoolfpquvb.supabase.co/auth/v1/callback
```

---

## Part A — Supabase URL allow-list (do this first, once)

**Supabase → Authentication → URL Configuration**

- **Site URL:** `https://blockview.co.il`
- **Redirect URLs** — add every one of these:

```
https://blockview.co.il/**
https://www.blockview.co.il/**
https://crm.blockview.co.il/**
https://admin.blockview.co.il/**
https://blockview-co-il.vercel.app/**
http://localhost:5173/**
com.blockview.app://auth/callback
```

The last line is the Android app deep link — without it, social sign-in in the app
dead-ends in the browser. `localhost:5173` is for local testing.

---

## Part B — Google (free)

1. https://console.cloud.google.com → create a project (e.g. `BlockView`).
2. **APIs & Services → OAuth consent screen**
   - User type: **External** → Create.
   - App name `BlockView`, support email = yours, developer contact = yours.
   - **Authorized domains:** add `blockview.co.il` **and** `supabase.co`.
   - Scopes: the defaults (`email`, `profile`, `openid`) are enough — add nothing else.
   - Publish the app (**Publishing status → Publish**). While it's in "Testing", only
     accounts you list by hand can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application** (yes, also for the Android app — we use the
     system browser, so you do **not** need an Android client or a SHA-1 fingerprint).
   - **Authorized JavaScript origins:**
     `https://blockview.co.il`, `https://crm.blockview.co.il`, `https://admin.blockview.co.il`
   - **Authorized redirect URIs:** `https://vphmiqhpiyzoolfpquvb.supabase.co/auth/v1/callback`
   - Create → copy the **Client ID** and **Client secret**.
4. **Supabase → Authentication → Providers → Google** → enable, paste Client ID +
   Secret → Save.
5. In [`www/js/config.js`](www/js/config.js) set `google: true`, commit, push.

---

## Part C — Apple (needs a $99/yr Apple Developer account)

Only worth doing when you build the iOS app — Apple's rule is that an iOS app offering
other social logins **must** offer Sign in with Apple. On the website it's optional.

1. https://developer.apple.com/account → **Certificates, IDs & Profiles → Identifiers**
   - **+ → App IDs → App**: description `BlockView`, Bundle ID `com.blockview.app`,
     tick **Sign In with Apple** → Register.
   - **+ → Services IDs**: description `BlockView Web`, identifier e.g.
     `com.blockview.web` → Register. Open it, tick **Sign In with Apple → Configure**:
     - Primary App ID: the App ID above.
     - **Domains:** `vphmiqhpiyzoolfpquvb.supabase.co`
     - **Return URLs:** `https://vphmiqhpiyzoolfpquvb.supabase.co/auth/v1/callback`
2. **Keys → +** → name `BlockView Sign In`, tick **Sign In with Apple**, configure with
   the primary App ID → Register → **download the `.p8` file** (one download only, ever).
   Note the **Key ID**, and your **Team ID** (top-right of the developer portal).
3. **Supabase → Authentication → Providers → Apple** → enable. Paste the **Services ID**
   (`com.blockview.web`) as the client ID, plus the Team ID, Key ID and the contents of
   the `.p8`. If your dashboard only offers a single "Secret Key (for OAuth)" box, it
   wants a client-secret **JWT** generated from those three values — Supabase's
   "Login with Apple" doc has the generator; note it expires after **6 months** and must
   be regenerated.
4. Set `apple: true` in [`www/js/config.js`](www/js/config.js), commit, push.

---

## Part D — test

| Where | How |
|---|---|
| Website | https://blockview.co.il → 👤 → "המשך עם Google" → returns signed in |
| CRM | https://crm.blockview.co.il → same buttons on the sign-in card |
| Admin | https://admin.blockview.co.il → sign in with Google → **still** asks for the 2FA code |
| Android | install the new `BlockView.apk` → 👤 → Google opens in Chrome → returns into the app |

A brand-new Google/Apple account gets `role='user'`, `plan='free'` from the
`handle_new_user` trigger — exactly like an email signup. Nobody gains agent or admin
rights by signing in with Google.

---

## Notes / gotchas

- **The Android app needs the new APK** (the deep link and the two Capacitor plugins are
  native). Web-only changes still don't need a rebuild.
- Google **refuses** OAuth inside a plain WebView (`disallowed_useragent`) — that's why
  the app hands off to Chrome and comes back through `com.blockview.app://auth/callback`.
- If the same person signs up with email *and* later with Google on the same address,
  Supabase links them only if "Confirm email" is on and the provider's email is verified;
  otherwise you get two accounts. Leave email confirmation **on**.
- Error `redirect_uri_mismatch` = the URI in the Google console doesn't match the Supabase
  callback character for character (watch the trailing slash).
- Error "Unsupported provider" = the provider is still disabled in Supabase, or you
  flipped the flag in `config.js` too early.
