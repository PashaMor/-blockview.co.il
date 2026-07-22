/* BlockView — shared Google / Apple sign-in.
 * Used by the website (auth.js), the CRM and the admin console, so the flow is
 * identical everywhere and there is one place to fix.
 *
 * Web:    normal redirect to the provider and back to this page.
 * Android: Google refuses OAuth inside a plain WebView ("disallowed_useragent"),
 *          so the app opens the provider in the SYSTEM browser and gets the
 *          result back through the com.blockview.app:// deep link.
 *
 * Security: we use the PKCE flow — the browser never receives tokens in the URL,
 * only a one-time code that is worthless without the verifier held by this app.
 */
(function () {
  var cfg = window.BLOCKVIEW_CONFIG || {};
  var OAUTH = cfg.OAUTH || {};

  function cap() { return window.Capacitor; }
  function isNative() {
    var C = cap();
    return !!(C && C.isNativePlatform && C.isNativePlatform());
  }
  function plugin(name) {
    var C = cap();
    return C && C.Plugins ? C.Plugins[name] : null;
  }
  function enabled(provider) { return !!OAUTH[provider]; }

  /* Options every BlockView Supabase client should be created with. */
  function clientOptions() {
    return {
      auth: {
        flowType: "pkce",          // no access token in the URL
        detectSessionInUrl: true,  // finishes the web redirect automatically
        persistSession: true,
        autoRefreshToken: true,
      },
    };
  }

  /* Start sign-in. Returns an error message, or null when it went fine. */
  async function signIn(supa, provider) {
    if (!enabled(provider)) return "ספק ההתחברות הזה עדיין לא מופעל";
    var native = isNative();
    var redirectTo = native
      ? (cfg.NATIVE_REDIRECT || "com.blockview.app://auth/callback")
      : location.origin + location.pathname;
    var res = await supa.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: redirectTo, skipBrowserRedirect: native },
    });
    if (res.error) return res.error.message;
    if (native && res.data && res.data.url) {
      var Browser = plugin("Browser");
      if (!Browser) return "פתיחת דפדפן נכשלה";
      await Browser.open({ url: res.data.url });
    }
    return null;
  }

  /* Native only: catch the deep link coming back and trade the code for a session. */
  function attach(supa, onError) {
    if (!isNative()) return;
    var App = plugin("App");
    if (!App) return;
    App.addListener("appUrlOpen", async function (ev) {
      var url = (ev && ev.url) || "";
      if (url.indexOf("com.blockview.app://") !== 0) return;
      var Browser = plugin("Browser");
      var qs = url.split("?")[1] || "";
      var params = new URLSearchParams(qs.split("#")[0]);
      var code = params.get("code");
      var err = params.get("error_description") || params.get("error");
      try {
        if (code) {
          var r = await supa.auth.exchangeCodeForSession(code);
          if (r.error) err = r.error.message;
        }
      } catch (e) { err = e.message || "שגיאת התחברות"; }
      if (Browser) { try { await Browser.close(); } catch (e) {} }
      if (err && onError) onError(err);
    });
  }

  /* The buttons ship hidden in the HTML; this reveals only the providers that are
   * switched on in config.js, so a half-configured provider is never clickable.
   * root: element containing the [data-oauth] buttons. */
  function wire(supa, root, onError) {
    var btns = (root || document).querySelectorAll("[data-oauth]");
    var shown = 0;
    Array.prototype.forEach.call(btns, function (b) {
      var provider = b.dataset.oauth;
      if (!enabled(provider)) { b.hidden = true; return; }
      b.hidden = false;
      shown++;
      b.addEventListener("click", async function () {
        b.disabled = true;
        var msg = await signIn(supa, provider);
        b.disabled = false;
        if (msg && onError) onError(msg);
      });
    });
    // the "or with email" divider only makes sense next to a visible button
    var div = (root || document).querySelectorAll(".auth-divider");
    Array.prototype.forEach.call(div, function (d) { d.hidden = shown === 0; });
    attach(supa, onError);
    return shown;
  }

  /* ---- share the session across *.blockview.co.il ----------------------
   * blockview.co.il, crm. and admin. are separate origins, and Supabase keeps
   * the session in localStorage, which is per-origin. So "מעבר ל-CRM" landed
   * the user on a login screen. We mirror just the tokens into a cookie scoped
   * to the parent domain (.blockview.co.il); a subdomain that loads without a
   * session hydrates from that cookie. localStorage stays the per-origin cache;
   * the cookie is only the hand-off between subdomains.
   *
   * The cookie is JS-readable (the client has to read it) and holds only the
   * access + refresh tokens — the same exposure as the localStorage session it
   * mirrors, no worse. It never runs off the real domain (localhost / previews
   * fall back to plain localStorage). */
  var COOKIE = "bv_sess";
  function parentDomain() {
    var h = location.hostname || "";
    return /(^|\.)blockview\.co\.il$/i.test(h) ? ".blockview.co.il" : null;
  }
  function writeSharedSession(session) {
    var domain = parentDomain();
    if (!domain) return;
    try {
      if (!session || !session.access_token) { clearSharedSession(); return; }
      var v = encodeURIComponent(JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }));
      // ~1.5KB, well under the 4KB cookie limit; 30-day life, refreshed on use
      document.cookie = COOKIE + "=" + v + ";domain=" + domain +
        ";path=/;max-age=2592000;secure;samesite=Lax";
    } catch (e) { /* best effort */ }
  }
  function clearSharedSession() {
    var domain = parentDomain();
    if (!domain) return;
    document.cookie = COOKIE + "=;domain=" + domain + ";path=/;max-age=0;secure;samesite=Lax";
  }
  function readSharedSession() {
    var m = ("; " + document.cookie).match(/; bv_sess=([^;]+)/);
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
  }

  /* Call once, right after creating a client. Keeps the shared cookie in step
   * with the session, and hydrates a fresh subdomain from it. */
  function shareSession(supa) {
    if (!parentDomain() || !supa || !supa.auth) return;
    supa.auth.onAuthStateChange(function (evt, session) {
      if (evt === "SIGNED_OUT") clearSharedSession();
      else writeSharedSession(session);
    });
    // hydrate: if this origin has no session yet but a sibling left a cookie
    supa.auth.getSession().then(function (r) {
      if (r && r.data && r.data.session) return;   // already signed in here
      var shared = readSharedSession();
      if (shared && shared.access_token && shared.refresh_token) {
        supa.auth.setSession({
          access_token: shared.access_token,
          refresh_token: shared.refresh_token,
        }).catch(function () { clearSharedSession(); });  // stale/invalid — drop it
      }
    });
  }

  window.BVOAuth = { isNative: isNative, enabled: enabled, clientOptions: clientOptions, signIn: signIn, attach: attach, wire: wire, shareSession: shareSession };
})();
