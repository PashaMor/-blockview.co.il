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
        "Vercel → Settings → Environment Variables, then redeploy.\n" +
        "\n🔑 key Vercel is using — " + result.fp +
        "\n(good key = sha256 f08c29d478d2, len 41. Same fp here ⇒ it's an IP/network block, not the key. Different fp ⇒ Vercel's value drifted.)"
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
    return { state: "error", status: 0, fp: "none", detail: String(e && e.message ? e.message : e) };
  }
  // Safe fingerprint of the key Vercel actually holds: a truncated SHA-256 plus
  // its length. It reveals none of the key, but lets us compare — same fp as the
  // known-good key means Vercel has the right value (so a 401 is an IP/network
  // block); a different fp means the stored value drifted.
  const fp = "sha256 " + require("crypto").createHash("sha256").update(key).digest("hex").slice(0, 12) +
             ", len " + key.length;
  // Retry before crying wolf: Supabase intermittently 401s Vercel's egress IP
  // even with a valid key. Only alert if it stays rejected across several tries
  // with backoff — otherwise a single transient blip would page a false alarm.
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(400 * attempt + Math.floor(Math.random() * 300));
    try {
      r = await fetch(base + "profiles?select=id&limit=1", {
        method: "HEAD",
        headers: { apikey: key, authorization: "Bearer " + key, prefer: "count=exact", range: "0-0" },
      });
    } catch (e) {
      if (attempt === 3) return { state: "error", status: 0, fp: fp, detail: String(e && e.message ? e.message : e) };
      continue;
    }
    if (r.status === 200 || r.status === 206) return { state: "ok", status: r.status, fp: fp };
    if (![401, 403, 429, 500, 502, 503, 504].includes(r.status)) return { state: "error", status: r.status, fp: fp };
    // retryable — loop again
  }
  if (r && (r.status === 401 || r.status === 403)) return { state: "rejected", status: r.status, fp: fp };
  return { state: "error", status: r ? r.status : 0, fp: fp };
}

function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

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
