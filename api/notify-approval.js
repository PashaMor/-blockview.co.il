/* BlockView — real-time "waiting for approval" alert to Telegram.
 *
 * Fired by a Supabase Database Webhook the moment a listing or an agent
 * application lands in `pending` (INSERT, or an UPDATE that moves it into
 * pending — e.g. a draft submitted, or an application resubmitted). It posts a
 * short message into the approvals topic so an admin can act without waiting
 * for the daily digest.
 *
 * SECURITY
 *   - Refuses any request without `Authorization: Bearer $APPROVAL_WEBHOOK_AUTH`,
 *     and refuses ALL requests if that env var is unset — never falls open.
 *   - No secret is ever echoed to the response or the Telegram message.
 *   - Every user-supplied field (title, name, agency…) is HTML-escaped before it
 *     goes into the Telegram message (HTML parse mode), so a crafted listing
 *     title can't inject markup.
 *
 * Env (all already in Vercel except the two marked NEW, set via CLI):
 *   APPROVAL_WEBHOOK_AUTH   NEW — shared secret the Supabase webhook sends
 *   TELEGRAM_APPROVALS_TOPIC NEW — forum topic id for these alerts (611)
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   (reused from the daily report)
 */

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    var want = process.env.APPROVAL_WEBHOOK_AUTH || "";
    var got = String((req.headers && req.headers.authorization) || "");
    if (!want || got !== want) return res.status(401).json({ error: "unauthorized" });

    // Supabase webhook payload: { type, table, schema, record, old_record }
    var body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    var table = String(body.table || "");
    var type = String(body.type || "");          // INSERT | UPDATE | DELETE
    var rec = body.record || {};
    var old = body.old_record || {};

    // Only notify when something ENTERS the pending state — not when it's later
    // approved/rejected, and not on an unrelated edit that was already pending.
    var nowPending = String(rec.status || "") === "pending";
    var wasPending = String(old && old.status || "") === "pending";
    if (!nowPending || (type === "UPDATE" && wasPending)) {
      return res.status(200).json({ ok: true, skipped: "not a new pending row" });
    }

    var msg;
    if (table === "listings") {
      msg = "🏠 <b>נכס חדש ממתין לאישור</b>\n" +
            "“" + esc(rec.title) + "”\n" +
            line("עסקה", rec.deal === "rent" ? "השכרה" : "מכירה") +
            line("מחיר", money(rec.price)) +
            line("חדרים", rec.rooms) +
            line("שטח", rec.size ? rec.size + " מ״ר" : "") +
            line("קומה", rec.floor);
    } else if (table === "agent_applications") {
      msg = "🧑‍💼 <b>בקשת סוכן חדשה ממתינה לאישור</b>\n" +
            "<b>" + esc(rec.full_name) + "</b>\n" +
            line("משרד", rec.agency) +
            line("רישיון", rec.license_no) +
            line("עיר", rec.city) +
            line("טלפון", rec.phone);
    } else {
      return res.status(200).json({ ok: true, skipped: "unhandled table " + table });
    }

    msg += "\n👉 admin.blockview.co.il";
    await telegram(msg);
    return res.status(200).json({ ok: true, table: table });
  } catch (e) {
    // 5xx so Supabase retries a transient Telegram/network hiccup
    return res.status(500).json({ error: "notify failed" });
  }
};

function line(label, value) {
  if (value === undefined || value === null || value === "") return "";
  return "• " + label + ": " + esc(value) + "\n";
}
function money(n) {
  var v = Number(n);
  if (!isFinite(v)) return "";
  return "₪" + v.toLocaleString("en-US");
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function telegram(text) {
  var token = req_env("TELEGRAM_BOT_TOKEN");
  var chat = req_env("TELEGRAM_CHAT_ID");
  var topic = process.env.TELEGRAM_APPROVALS_TOPIC;
  var payload = {
    chat_id: chat,
    text: String(text).slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (topic) payload.message_thread_id = Number(topic);

  var r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    var b = await r.text();
    throw new Error("telegram " + r.status + " " + b.slice(0, 200));
  }
}
function req_env(name) { var v = process.env[name]; if (!v) throw new Error("missing env " + name); return v; }
