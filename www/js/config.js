/* BlockView config.
 * SUPABASE_ANON_KEY holds the browser-safe *publishable* key (sb_publishable_…),
 * which replaces the old anon key. It is safe in the browser because Row-Level
 * Security + the server-side limit triggers (supabase/schema.sql) enforce access.
 * NEVER put the secret key (sb_secret_…) here.
 */
window.BLOCKVIEW_CONFIG = {
  SUPABASE_URL: "https://vphmiqhpiyzoolfpquvb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_aewq0qogsi2rLkJvSXMpCQ_ae9mc1QO",

  /* Social sign-in. Flip a provider to true ONLY after it is enabled in
   * Supabase -> Authentication -> Providers (see OAUTH_SETUP.md); a button for a
   * provider that isn't configured just errors with "Unsupported provider".
   * NATIVE_REDIRECT is the Android deep link that brings the system browser back
   * into the app; it must be listed in Supabase -> URL Configuration. */
  /* Google Analytics 4 measurement ID ("G-XXXXXXXXXX"), used by js/analytics.js
   * on the site, the CRM and the admin console. It is a public identifier — it
   * is safe here. Leave it empty to switch analytics off entirely.
   * GA4_DEBUG: true also measures localhost (normally skipped). */
  GA4_ID: "G-B69ZV5EFZQ",
  GA4_DEBUG: false,

  OAUTH: { google: true, apple: false },
  NATIVE_REDIRECT: "com.blockview.app://auth/callback",

  /* App store links, shown as badges to mobile-web visitors (profile sheet).
   * Empty string = not published yet: the badge shows a "coming soon" toast
   * instead of a dead link. Paste the store URL here when the listing is live. */
  APP_STORES: { ios: "", android: "" },

  /* Version of the Terms / Privacy Policy the user is asked to accept. Keep it
   * equal to the "last updated" date in www/legal/lang/*.js — bumping it here is
   * what marks older acceptances as out of date. */
  LEGAL_VERSION: "2026-07-20",

  // Free-tier limits (keep in sync with supabase/schema.sql).
  LIMITS: {
    free: { favorites: 3, follows: 0 },
    pro:  { favorites: Infinity, follows: Infinity },
  },
};
