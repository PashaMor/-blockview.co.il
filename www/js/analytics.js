/* BlockView — Google Analytics 4.
 *
 * Loaded on the website, the CRM and the admin console. The Android app shows
 * the hosted site inside a WebView, so the same file measures the app too; the
 * `surface` user-property (web | app) is what tells them apart in GA4.
 *
 * Rules this file obeys:
 *   - It is the ONLY runtime CDN dependency in the project, and it is loaded
 *     async and fully guarded: if googletagmanager.com stalls or is blocked,
 *     nothing here throws and the app renders exactly as before.
 *   - Nothing personal is sent. No email, no user id, no listing owner, no free
 *     text. IP anonymisation and Google-signals/ads personalisation are off.
 *   - With no GA4_ID in config.js the whole file is a no-op, so a fork or a
 *     local dev server never pollutes the production property.
 */
(function () {
  var cfg = window.BLOCKVIEW_CONFIG || {};
  var ID = cfg.GA4_ID || "";

  var isApp = !!window.Capacitor || /BlockViewApp/i.test(navigator.userAgent || "");
  var isBot = navigator.webdriver === true ||
              /bot|crawler|spider|preview|headless/i.test(navigator.userAgent || "");
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  // Public API is defined even when analytics is off, so callers never branch.
  window.BVGA = {
    on: false,
    event: function () {},
    setUser: function () {}
  };

  if (!ID || isBot || (isLocal && !cfg.GA4_DEBUG)) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  gtag("js", new Date());
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted"
  });
  gtag("config", ID, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    // one property, three apps: use this to split reports
    app_area: appArea(),
    surface: isApp ? "app" : "web"
  });
  gtag("set", "user_properties", {
    surface: isApp ? "app" : "web",
    app_area: appArea(),
    ui_lang: (document.documentElement.lang || "he")
  });

  function appArea() {
    var h = location.hostname;
    if (/^crm\./.test(h)) return "crm";
    if (/^admin\./.test(h)) return "admin";
    return "site";
  }

  // async loader — a stalled CDN must never block first paint
  try {
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ID);
    s.onerror = function () { window.BVGA.on = false; };
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { return; }

  window.BVGA = {
    on: true,
    /* BVGA.event("listing_detail", { deal: "sale", city: "tel-aviv" })
     * Params must stay non-personal: enums, counts, ids — never free text. */
    event: function (name, params) {
      try { gtag("event", name, params || {}); } catch (e) {}
    },
    setUser: function (props) {
      try { gtag("set", "user_properties", props || {}); } catch (e) {}
    }
  };
})();
