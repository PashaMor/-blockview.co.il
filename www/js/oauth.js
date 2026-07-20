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

  /* Hide buttons for providers that aren't configured yet, and bind the rest.
   * root: element containing the [data-oauth] buttons. */
  function wire(supa, root, onError) {
    var btns = (root || document).querySelectorAll("[data-oauth]");
    var shown = 0;
    Array.prototype.forEach.call(btns, function (b) {
      var provider = b.dataset.oauth;
      if (!enabled(provider)) { b.hidden = true; return; }
      shown++;
      b.addEventListener("click", async function () {
        b.disabled = true;
        var msg = await signIn(supa, provider);
        b.disabled = false;
        if (msg && onError) onError(msg);
      });
    });
    // nothing to show -> drop the "or with email" divider too
    if (!shown) {
      var div = (root || document).querySelectorAll(".auth-divider");
      Array.prototype.forEach.call(div, function (d) { d.hidden = true; });
    }
    attach(supa, onError);
    return shown;
  }

  window.BVOAuth = { isNative: isNative, enabled: enabled, clientOptions: clientOptions, signIn: signIn, attach: attach, wire: wire };
})();
