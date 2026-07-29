/* BlockView — Pro subscription purchase, via RevenueCat.
 *
 * One entitlement ("pro"), two purchase paths, both reconciled to profiles.plan
 * by the RevenueCat webhook (api/revenuecat-webhook.js):
 *   - Android app (Capacitor WebView): native Google Play Billing through the
 *     @revenuecat/purchases-capacitor plugin (Capacitor.Plugins.Purchases).
 *   - Website: redirect to a RevenueCat Web Billing checkout link.
 *
 * We identify the buyer to RevenueCat by their Supabase user id (app_user_id),
 * so the webhook can flip the right profiles row. Keep this file conservative JS
 * (no optional chaining) — it must run on old device WebViews.
 */
(function () {
  function cfg() { return (window.BLOCKVIEW_CONFIG && window.BLOCKVIEW_CONFIG.REVENUECAT) || {}; }
  // The RevenueCat SDK key differs per store; pick by the native platform.
  function apiKey() {
    var c = cfg();
    var plat = (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || "";
    return (plat === "ios" ? c.IOS_KEY : c.ANDROID_KEY) || "";
  }
  function native() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Purchases; }
  function uid() { return (window.BVAuth && window.BVAuth.userId && window.BVAuth.userId()) || ""; }
  function toast(m) { if (window.bvToast) window.bvToast(m); }

  var configured = false;
  function ensureNative(P) {
    if (configured) return Promise.resolve();
    return P.configure({ apiKey: apiKey() }).then(function () {
      var id = uid();
      configured = true;
      if (id) return P.logIn({ appUserID: id })["catch"](function () {});
    });
  }

  // Pick the RevenueCat package matching the wanted period: prefer the configured
  // product/package id, else fall back to the package type (ANNUAL / MONTHLY).
  function pickPackage(pkgs, period) {
    var wanted = (cfg().PRODUCTS && cfg().PRODUCTS[period]) || "";
    var wantType = period === "year" ? "ANNUAL" : "MONTHLY";
    var byType = null;
    for (var i = 0; i < pkgs.length; i++) {
      var p = pkgs[i];
      var prodId = p.product && p.product.identifier;
      if (wanted && (p.identifier === wanted || prodId === wanted)) return p;
      if (!byType && p.packageType === wantType) byType = p;
    }
    return byType || pkgs[0] || null;
  }

  function nativeBuy(period) {
    var P = native();
    return ensureNative(P).then(function () {
      return P.getOfferings();
    }).then(function (off) {
      var cur = off && off.current;
      var pkgs = (cur && cur.availablePackages) || [];
      var pkg = pickPackage(pkgs, period);
      if (!pkg) throw new Error("no package");
      return P.purchasePackage({ aPackage: pkg });
    });
  }

  function webUrl(period) {
    var w = cfg().WEB_CHECKOUT;
    var link = typeof w === "string" ? w : (w && w[period]) || "";
    if (!link) return "";
    var id = uid();
    var sep = link.indexOf("?") === -1 ? "?" : "&";
    return link + sep + "app_user_id=" + encodeURIComponent(id) + "&period=" + period;
  }

  window.BVBilling = {
    // period: "month" | "year". Returns a promise; resolves when the flow starts.
    upgrade: function (period) {
      period = period === "year" ? "year" : "month";
      if (!(window.BVAuth && window.BVAuth.isLoggedIn && window.BVAuth.isLoggedIn())) {
        toast("יש להתחבר כדי לשדרג");
        if (window.openAuth) window.openAuth();
        return Promise.resolve();
      }
      if (native()) {
        return nativeBuy(period).then(function () {
          toast("הרכישה בוצעה — מסנכרן את החשבון…");
          // The webhook flips profiles.plan a moment later; reload to pick it up.
          setTimeout(function () { location.reload(); }, 4000);
        })["catch"](function (e) {
          var msg = String((e && e.message) || e);
          if (!/cancel|USER_CANCEL|1\b/i.test(msg)) toast("הרכישה נכשלה");
        });
      }
      var url = webUrl(period);
      if (!url) { toast("התשלום ייפתח בקרוב 💳"); return Promise.resolve(); }
      location.href = url;
      return Promise.resolve();
    },

    // Restore a prior purchase (native only) — for "already subscribed" recovery.
    restore: function () {
      var P = native();
      if (!P) { toast("שחזור רכישות זמין באפליקציה"); return Promise.resolve(); }
      return ensureNative(P).then(function () { return P.restorePurchases(); }).then(function () {
        toast("שוחזר — מסנכרן…");
        setTimeout(function () { location.reload(); }, 4000);
      })["catch"](function () { toast("לא נמצאה רכישה לשחזור"); });
    },
  };
})();
