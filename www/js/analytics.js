/* BlockView — Google Analytics 4, behind a consent banner.
 *
 * Loaded on the website, the CRM and the admin console. The Android app shows
 * the hosted site inside a WebView, so the same file measures the app too; the
 * `surface` user-property (web | app) is what tells them apart in GA4.
 *
 * NOTHING is sent to Google until the visitor presses "accept". Before that no
 * gtag script is fetched, no cookie is written and no request leaves the page.
 * The choice is remembered in localStorage under `blockview_consent`.
 *
 * Other rules this file obeys:
 *   - It is the ONLY runtime CDN dependency in the project, and it is loaded
 *     async and fully guarded: if googletagmanager.com stalls or is blocked,
 *     nothing here throws and the app renders exactly as before.
 *   - Nothing personal is sent. No email, no user id, no listing owner, no free
 *     text. IP anonymisation is on, Google signals and ad personalisation off.
 *   - With no GA4_ID in config.js the whole file is a no-op, so a fork or a
 *     local dev server never pollutes the production property.
 *   - The banner carries its own copy of its six translations. i18n.js is only
 *     loaded on the website, and the banner has to work in the CRM and the
 *     admin console too.
 */
(function () {
  var cfg = window.BLOCKVIEW_CONFIG || {};
  var ID = cfg.GA4_ID || "";
  var STORE = "blockview_consent";

  var isApp = !!window.Capacitor || /BlockViewApp/i.test(navigator.userAgent || "");
  var isBot = navigator.webdriver === true ||
              /bot|crawler|spider|preview|headless/i.test(navigator.userAgent || "");
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  // Public API exists even when analytics is off, so callers never branch.
  window.BVGA = { on: false, event: noop, setUser: noop };
  function noop() {}

  // Lets you re-test the banner: BVConsent.reset() in the console.
  window.BVConsent = {
    get: function () { return read(); },
    reset: function () { write(""); location.reload(); }
  };

  if (!ID || isBot || (isLocal && !cfg.GA4_DEBUG)) return;

  /* Declared before the entry point below on purpose: this script is loaded at
   * the end of <body>, so the banner runs the moment it is reached — a `var`
   * assigned further down would still be undefined by then. */
  var T = {
    he: { body: "אנחנו משתמשים ב‑Google Analytics כדי להבין איך משתמשים באתר. לא נשלחים פרטים מזהים, ואין פרסום או מעקב בין אתרים.",
          ok: "אישור", no: "לא, תודה", link: "מדיניות הפרטיות" },
    en: { body: "We use Google Analytics to understand how the site is used. No identifying details are sent, and there is no advertising or cross-site tracking.",
          ok: "Accept", no: "No thanks", link: "Privacy policy" },
    ar: { body: "نستخدم Google Analytics لفهم كيفية استخدام الموقع. لا تُرسل أي بيانات تعريفية، ولا يوجد إعلانات أو تتبع عبر المواقع.",
          ok: "موافق", no: "لا، شكرًا", link: "سياسة الخصوصية" },
    es: { body: "Usamos Google Analytics para entender cómo se usa el sitio. No se envían datos identificativos y no hay publicidad ni seguimiento entre sitios.",
          ok: "Aceptar", no: "No, gracias", link: "Política de privacidad" },
    fr: { body: "Nous utilisons Google Analytics pour comprendre l'usage du site. Aucune donnée identifiante n'est envoyée, sans publicité ni suivi intersites.",
          ok: "Accepter", no: "Non merci", link: "Politique de confidentialité" },
    ru: { body: "Мы используем Google Analytics, чтобы понимать, как используется сайт. Идентифицирующие данные не передаются, рекламы и межсайтового отслеживания нет.",
          ok: "Принять", no: "Нет, спасибо", link: "Политика конфиденциальности" }
  };

  var RTL = { he: 1, ar: 1 };

  var choice = read();
  if (choice === "granted") start();
  else if (choice !== "denied") ready(banner);

  /* ------------------------------------------------------------- storage -- */

  function read() {
    try { return localStorage.getItem(STORE) || ""; } catch (e) { return ""; }
  }
  function write(v) {
    try { if (v) localStorage.setItem(STORE, v); else localStorage.removeItem(STORE); }
    catch (e) { /* private mode — the choice just won't stick */ }
  }
  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  /* ----------------------------------------------------------------- GA4 -- */

  function appArea() {
    var h = location.hostname;
    if (/^crm\./.test(h)) return "crm";
    if (/^admin\./.test(h)) return "admin";
    return "site";
  }

  function start() {
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }

    gtag("js", new Date());
    gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted"        // only ever reached after "accept"
    });
    gtag("config", ID, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      app_area: appArea(),
      surface: isApp ? "app" : "web"
    });
    gtag("set", "user_properties", {
      surface: isApp ? "app" : "web",
      app_area: appArea(),
      ui_lang: lang()
    });

    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ID);
      s.onerror = function () { window.BVGA.on = false; };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { return; }

    window.BVGA = {
      on: true,
      /* BVGA.event("listing_detail", { surface: "web" })
       * Params must stay non-personal: enums, counts — never free text. */
      event: function (name, params) {
        try { gtag("event", name, params || {}); } catch (e) {}
      },
      setUser: function (props) {
        try { gtag("set", "user_properties", props || {}); } catch (e) {}
      }
    };
  }

  /* -------------------------------------------------------------- banner -- */

  function lang() {
    var l = "";
    try { l = localStorage.getItem("blockview_lang") || ""; } catch (e) {}
    if (!l) l = (document.documentElement.lang || "he").slice(0, 2);
    return T[l] ? l : "he";
  }

  function banner() {
    var code = lang();
    var t = T[code];
    var rtl = !!RTL[code];

    var css = document.createElement("style");
    css.textContent =
      "#bv-consent{position:fixed;z-index:9998;inset-inline:12px;bottom:12px;max-width:520px;margin-inline:auto;" +
      "background:#fff;color:#111;border-radius:14px;padding:14px 16px;" +
      "box-shadow:0 8px 30px rgba(0,0,0,.28);font:14px/1.5 system-ui,-apple-system,'Segoe UI',Arial,sans-serif;" +
      "display:flex;flex-direction:column;gap:10px}" +
      "#bv-consent a{color:#0a58ca}" +
      "#bv-consent .bv-c-row{display:flex;gap:8px;justify-content:flex-end}" +
      "#bv-consent button{border:0;border-radius:10px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}" +
      "#bv-consent .bv-ok{background:#111;color:#fff}" +
      "#bv-consent .bv-no{background:#eee;color:#333}" +
      "@media (prefers-color-scheme:dark){#bv-consent{background:#1c1c1e;color:#f2f2f7}" +
      "#bv-consent .bv-ok{background:#f2f2f7;color:#111}#bv-consent .bv-no{background:#3a3a3c;color:#f2f2f7}" +
      "#bv-consent a{color:#6ea8fe}}";
    document.head.appendChild(css);

    var box = document.createElement("div");
    box.id = "bv-consent";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-live", "polite");
    box.dir = rtl ? "rtl" : "ltr";

    // built with DOM calls, not innerHTML — nothing here is user-supplied, but
    // the habit is what keeps it that way
    var p = document.createElement("div");
    p.textContent = t.body + " ";
    var a = document.createElement("a");
    a.href = "https://blockview.co.il/privacy";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = t.link;
    p.appendChild(a);

    var row = document.createElement("div");
    row.className = "bv-c-row";

    var no = document.createElement("button");
    no.className = "bv-no";
    no.textContent = t.no;
    no.onclick = function () { write("denied"); close(); };

    var ok = document.createElement("button");
    ok.className = "bv-ok";
    ok.textContent = t.ok;
    ok.onclick = function () { write("granted"); close(); start(); };

    row.appendChild(no);
    row.appendChild(ok);
    box.appendChild(p);
    box.appendChild(row);
    document.body.appendChild(box);

    function close() {
      if (box.parentNode) box.parentNode.removeChild(box);
    }
  }
})();
