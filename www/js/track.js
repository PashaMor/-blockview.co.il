/* BlockView — listing analytics (what an agent sees in the CRM).
 *
 * Records "this listing was seen / opened / contacted", with the surface it
 * happened on (website or app). Deliberately minimal and privacy-safe:
 *   - no IP, no user id, no user agent is sent;
 *   - the only identifier is a random key kept in this browser, used purely to
 *     deduplicate one viewer per event per listing per day (the DB enforces it);
 *   - the DB drops views of a listing by its own agent, and views of listings
 *     that are not approved (supabase/16_analytics.sql).
 *
 * Fire-and-forget: every call is wrapped so tracking can never break the map.
 */
(function () {
  const KEY = "blockview_vk";
  const supa = () => window.BVDB || window.BVSupa;   // public client is enough

  // random per-browser key; not derived from anything about the person
  function viewerKey() {
    try {
      let k = localStorage.getItem(KEY);
      if (!k) {
        k = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID().replace(/-/g, "")
          : String(Date.now()) + Math.random().toString(36).slice(2, 12);
        localStorage.setItem(KEY, k);
      }
      return k;
    } catch (e) {
      return "nostorage" + Math.random().toString(36).slice(2, 12);  // private mode
    }
  }

  const isApp = !!window.Capacitor || /BlockViewApp/i.test(navigator.userAgent);
  function platform() {
    const ua = navigator.userAgent || "";
    if (/android/i.test(ua)) return "android";
    if (/iphone|ipad|ipod/i.test(ua)) return "ios";
    if (isApp) return "other";
    return /mobi/i.test(ua) ? "other" : "desktop";
  }

  // don't record automated traffic
  const isBot = navigator.webdriver === true ||
                /bot|crawler|spider|preview|headless/i.test(navigator.userAgent || "");

  // remember what this page already sent, so scrolling a list doesn't re-post
  const sentThisSession = new Set();

  // Mirror the same event into GA4 (js/analytics.js). Sends the event name, the
  // surface and the platform only — never the listing id, so nothing in Google's
  // copy can be tied back to a specific property or its owner.
  function mirrorToGA(event) {
    var ga = window.BVGA;
    if (!ga || !ga.on) return;
    try { ga.event("listing_" + event, { surface: isApp ? "app" : "web", platform: platform() }); }
    catch (e) {}
  }

  function track(event, listingId) {
    if (isBot || !listingId || !supa()) return;
    // only real (database) listings have uuid ids; sample data uses "b1-2"
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listingId)) return;
    const tag = event + ":" + listingId;
    if (sentThisSession.has(tag)) return;
    sentThisSession.add(tag);
    mirrorToGA(event);
    try {
      supa().from("listing_views").insert({
        listing_id: listingId,
        event,
        surface: isApp ? "app" : "web",
        platform: platform(),
        viewer_key: viewerKey(),
      }).then(
        () => {},
        () => {}            // duplicate for today, offline, whatever — never surface it
      );
    } catch (e) { /* tracking must never throw into the app */ }
  }

  window.BVTrack = {
    impression: (id) => track("impression", id),
    detail:     (id) => track("detail", id),
    contact:    (id) => track("contact", id),
    lead:       (id) => track("lead", id),
    share:      (id) => track("share", id),
    favorite:   (id) => track("favorite", id),
  };
})();
