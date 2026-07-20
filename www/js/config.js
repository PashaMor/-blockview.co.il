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
  OAUTH: { google: true, apple: false },
  NATIVE_REDIRECT: "com.blockview.app://auth/callback",

  // Free-tier limits (keep in sync with supabase/schema.sql).
  LIMITS: {
    free: { favorites: 3, follows: 0 },
    pro:  { favorites: Infinity, follows: Infinity },
  },
};
