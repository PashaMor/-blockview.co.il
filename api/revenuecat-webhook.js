/* BlockView — RevenueCat webhook -> Supabase plan sync.
 *
 * RevenueCat is the source of truth for Pro subscriptions. Configure it
 * (RevenueCat dashboard -> Project -> Integrations -> Webhooks) to POST here:
 *   URL:  https://blockview.co.il/api/revenuecat-webhook
 *   Authorization header: <a long random secret>  == env REVENUECAT_WEBHOOK_AUTH
 *
 * We set RevenueCat's app_user_id to the Supabase user id (a uuid), so each
 * event maps straight to a profiles row. Using SUPABASE_SECRET_KEY (service_role,
 * auth.uid()=null) we set profiles.plan — allowed past protect_profile_fields.
 *
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY, REVENUECAT_WEBHOOK_AUTH,
 *      [REVENUECAT_ENTITLEMENT] (default "pro").
 */

// Event types that mean "has Pro right now".
var GRANT = {
  INITIAL_PURCHASE: 1, RENEWAL: 1, UNCANCELLATION: 1, PRODUCT_CHANGE: 1,
  NON_RENEWING_PURCHASE: 1, SUBSCRIPTION_EXTENDED: 1, TEMPORARY_ENTITLEMENT_GRANT: 1,
};
// Event types that mean "Pro just ended". CANCELLATION is NOT here: a cancel only
// turns off auto-renew; access lasts until EXPIRATION, which is what downgrades.
var REVOKE = { EXPIRATION: 1, SUBSCRIPTION_PAUSED: 1 };

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    // Verify the shared secret RevenueCat sends as the Authorization header.
    var want = process.env.REVENUECAT_WEBHOOK_AUTH || "";
    var got = String((req.headers && req.headers.authorization) || "");
    if (!want || got !== want) return res.status(401).json({ error: "unauthorized" });

    var ev = (req.body && req.body.event) || {};
    var type = String(ev.type || "");
    var uid = String(ev.app_user_id || "");
    if (!UUID.test(uid)) return res.status(200).json({ ok: true, skip: "non-user id" });

    // Append the raw event to our own log (migration 44) so the daily report can
    // count trials and conversions. Best-effort: it must never break plan sync,
    // and it is a no-op until the table exists.
    await logEvent(ev, uid);

    var ent = (process.env.REVENUECAT_ENTITLEMENT || "pro");
    var ids = Array.isArray(ev.entitlement_ids) ? ev.entitlement_ids
            : (ev.entitlement_id ? [ev.entitlement_id] : []);
    var touchesOurs = ids.length === 0 || ids.indexOf(ent) !== -1;

    var patch = null;
    if (GRANT[type] && touchesOurs) {
      patch = { plan: "pro", plan_source: "revenuecat", rc_customer_id: uid,
                plan_expires_at: ev.expiration_at_ms ? new Date(ev.expiration_at_ms).toISOString() : null };
    } else if (REVOKE[type] && touchesOurs) {
      patch = { plan: "free", plan_source: "revenuecat", rc_customer_id: uid, plan_expires_at: null };
    } else {
      // CANCELLATION / BILLING_ISSUE / TEST / TRANSFER / etc. — acknowledged, no change.
      return res.status(200).json({ ok: true, ignored: type });
    }

    var base = env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/";
    var key = env("SUPABASE_SECRET_KEY");
    var r = await fetch(base + "profiles?id=eq." + encodeURIComponent(uid), {
      method: "PATCH",
      headers: { apikey: key, Authorization: "Bearer " + key,
                 "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) return res.status(500).json({ error: "supabase " + r.status + " " + (await r.text()).slice(0, 160) });
    return res.status(200).json({ ok: true, type: type, plan: patch.plan });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};

function env(name) { var v = process.env[name]; if (!v) throw new Error("missing env " + name); return v; }

// Append one event row. Idempotent on event_id (RevenueCat retries), and wrapped
// so a missing table or any error can never fail the webhook's real job.
async function logEvent(ev, uid) {
  try {
    var base = env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/";
    var key = env("SUPABASE_SECRET_KEY");
    var price = (ev.price_in_purchased_currency != null) ? ev.price_in_purchased_currency
              : (ev.price != null ? ev.price : null);
    var row = {
      event_id: ev.id != null ? String(ev.id) : null,
      type: String(ev.type || ""),
      app_user_id: uid,
      store: ev.store || null,
      environment: ev.environment || null,
      period_type: ev.period_type || null,
      is_trial_conversion: ev.is_trial_conversion === true,
      price: price,
      currency: ev.currency || null,
      event_at: ev.event_timestamp_ms ? new Date(ev.event_timestamp_ms).toISOString() : null,
    };
    await fetch(base + "subscription_events?on_conflict=event_id", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key,
                 "Content-Type": "application/json",
                 Prefer: "return=minimal,resolution=ignore-duplicates" },
      body: JSON.stringify(row),
    });
  } catch (e) { /* logging is never allowed to break plan sync */ }
}
