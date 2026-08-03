/* BlockView — Supabase secret-key health check.
 *
 * SUPABASE_SECRET_KEY drives both the daily report (api/daily-report.js) and,
 * more importantly, the RevenueCat webhook (api/revenuecat-webhook.js). Twice
 * that key has silently gone invalid; while it is dead, Pro purchases stop
 * syncing to profiles.plan and nobody notices for weeks.
 *
 * This runs on its own cron an hour BEFORE the daily report and makes a single
 * cheap call to Supabase with the key. It stays SILENT while the key is healthy
 * and only messages Telegram when the key is rejected (or Supabase is
 * unreachable) — so a dead key becomes a same-day alert instead of a weeks-long
 * silent outage.
 *
 * SECURITY
 *   - Refuses every request without `Authorization: Bearer $CRON_SECRET`, and
 *     refuses ALL requests if CRON_SECRET is unset — it never falls open.
 *   - The secret key is server-only. It is never echoed into the HTTP response
 *     and never included in the Telegram message.
 *   - The probe is a HEAD for a single id, so no row ever leaves Supabase.
 *
 * Env (all already set for the daily report — nothing new needed):
 *   CRON_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY,
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_TOPIC_ID (optional)
 */

module.exports = async function handler(req, res) {
  // ---------------------------------------------------------------- auth ---
  const secret = process.env.CRON_SECRET;
  const auth = req.headers["authorization"] || "";
  if (!secret || auth !== "Bearer " + secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const result = await probe();

  try {
    if (result.state === "ok") {
      // healthy -> stay quiet, no Telegram
      res.status(200).json({ ok: true, status: result.status });
      return;
    }
    if (result.state === "rejected") {
      await telegram(
        "⚠️ <b>BlockView: Supabase secret key REJECTED</b> (HTTP " + result.status + ").\n" +
        "The RevenueCat webhook and the daily report are DOWN until " +
        "<code>SUPABASE_SECRET_KEY</code> is re-set in Vercel and redeployed.\n" +
        "Vercel → Settings → Environment Variables, then redeploy."
      );
    } else {
      // unreachable / unexpected — worth knowing, but distinct from a dead key
      await telegram(
        "⚠️ BlockView key-health check couldn't reach Supabase (" +
        esc(result.detail || ("HTTP " + result.status)) + "). " +
        "Might be a transient Supabase issue; will re-check tomorrow."
      );
    }
    res.status(200).json({ ok: false, state: result.state, status: result.status });
  } catch (e) {
    // Telegram itself failed — surface it in the response, never a credential
    res.status(500).json({ ok: false, error: "alert delivery failed" });
  }
};

/* ------------------------------------------------------------------ probe -- */

// One HEAD against profiles. 200/206 -> key good; 401/403 -> key rejected;
// anything else (or a throw) -> Supabase unreachable / unexpected.
async function probe() {
  let base, key;
  try {
    base = required("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/";
    key = required("SUPABASE_SECRET_KEY");
  } catch (e) {
    return { state: "error", status: 0, detail: String(e && e.message ? e.message : e) };
  }
  try {
    const r = await fetch(base + "profiles?select=id&limit=1", {
      method: "HEAD",
      headers: { apikey: key, authorization: "Bearer " + key, prefer: "count=exact", range: "0-0" },
    });
    if (r.status === 200 || r.status === 206) return { state: "ok", status: r.status };
    if (r.status === 401 || r.status === 403) return { state: "rejected", status: r.status };
    return { state: "error", status: r.status };
  } catch (e) {
    return { state: "error", status: 0, detail: String(e && e.message ? e.message : e) };
  }
}

/* --------------------------------------------------------------- helpers -- */

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error("missing env " + name);
  return v;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function telegram(text) {
  const token = required("TELEGRAM_BOT_TOKEN");
  const chat = required("TELEGRAM_CHAT_ID");
  const topic = process.env.TELEGRAM_TOPIC_ID;
  const payload = {
    chat_id: chat,
    text: String(text).slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (topic) payload.message_thread_id = Number(topic);

  const r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error("telegram " + r.status + " " + body.slice(0, 200));
  }
}
