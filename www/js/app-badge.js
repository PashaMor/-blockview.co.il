/* BlockView — "Get the app" store badges in the profile sheet.
 * Shown to MOBILE-WEB visitors only: pointless inside the native app (they
 * already have it) and on desktop (they can't install a phone app). A store
 * with no URL yet shows a "coming soon" toast instead of a dead link.
 */
(function () {
  var row = document.getElementById("acc-app-row");
  if (!row) return;

  var cap = window.Capacitor;
  var isNativeApp = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  var isMobileWeb = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  if (isNativeApp || !isMobileWeb) return;   // leave it hidden

  var stores = (window.BLOCKVIEW_CONFIG && window.BLOCKVIEW_CONFIG.APP_STORES) || {};
  var T = function (k, fb) { return (window.t ? window.t(k) : fb) || fb; };

  // both badges always show; one whose URL isn't set yet acts as a "coming soon"
  // teaser (the click handler toasts instead of following a dead link)
  row.hidden = false;

  row.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-store]") : null;
    if (!b) return;
    var url = stores[b.getAttribute("data-store")];
    if (url) { window.open(url, "_blank", "noopener"); return; }
    if (window.bvToast) window.bvToast(T("app_coming_soon", "האפליקציה תהיה זמינה בקרוב 📲"));
  });
})();
