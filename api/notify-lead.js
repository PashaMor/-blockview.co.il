/* BlockView — notify when a new enquiry (lead) arrives.
 *
 * Until now a lead just sat in the CRM until the agent happened to log in, so
 * enquiries went cold. A database trigger (supabase/32_lead_notify.sql) calls
 * this the instant a lead is inserted:
 *   - a Telegram message to the team channel — works today, so no lead is ever
 *     missed while agents get set up;
 *   - an email to the agent who owns the listing — sent only if RESEND_API_KEY
 *     is configured (see SMTP_SETUP.md), so it lights up the moment you add it.
 *
 * Idempotent and safe to call without a shared secret: it acts only on a real
 * lead id, and marks notified_at so a lead is never announced twice. A random
 * or replayed id is a no-op.
 *
 * Env (Vercel server only): SUPABASE_URL, SUPABASE_SECRET_KEY,
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, [TELEGRAM_TOPIC_ID], [RESEND_API_KEY],
 *   [LEAD_FROM_EMAIL].
 */
module.exports = async function handler(req, res) {
  try {
    const id = String((req.body && req.body.id) || (req.query && req.query.id) || "").trim();
    if (!id) return res.status(400).json({ error: "id required" });

    const base = env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/";
    const key = env("SUPABASE_SECRET_KEY");
    const h = { apikey: key, Authorization: "Bearer " + key };

    // the lead, with its listing + building
    const sel = "id,name,phone,email,message,agent_id,notified_at,created_at," +
      "listings(title,building_id,buildings(name,address,city))";
    const lr = await fetch(base + "leads?id=eq." + encodeURIComponent(id) + "&select=" + encodeURIComponent(sel), { headers: h });
    const rows = await lr.json();
    const lead = rows && rows[0];
    if (!lead) return res.status(404).json({ error: "lead not found" });
    if (lead.notified_at) return res.status(200).json({ ok: true, already: true });

    const listing = lead.listings || {};
    const b = listing.buildings || {};
    const where = [b.name, b.address || b.city].filter(Boolean).join(" · ");

    // the agent's contact — email from auth, name/phone from the profile
    let agentEmail = "", agentName = "";
    try {
      const ar = await fetch(env("SUPABASE_URL").replace(/\/+$/, "") + "/auth/v1/admin/users/" + lead.agent_id, { headers: h });
      const au = await ar.json();
      agentEmail = (au && au.email) || "";
    } catch (e) {}
    try {
      const pr = await fetch(base + "agent_profiles?user_id=eq." + lead.agent_id + "&select=first_name,last_name", { headers: h });
      const p = (await pr.json())[0] || {};
      agentName = [p.first_name, p.last_name].filter(Boolean).join(" ");
    } catch (e) {}

    const title = listing.title || "נכס";
    const reach = [lead.phone && ("טל׳ " + lead.phone), lead.email].filter(Boolean).join(" · ");
    const link = "https://blockview.co.il/?listing=" + encodeURIComponent(id);

    // 1) Telegram to the team (always, if configured)
    await telegram(
      "🔔 <b>פנייה חדשה</b>\n" +
      "<b>" + esc(title) + "</b>" + (where ? " — " + esc(where) : "") + "\n" +
      "מאת: " + esc(lead.name || "—") + (reach ? " (" + esc(reach) + ")" : "") + "\n" +
      (lead.message ? "הודעה: " + esc(lead.message) + "\n" : "") +
      (agentName || agentEmail ? "סוכן: " + esc(agentName || agentEmail) + "\n" : "") +
      link
    ).catch(function (e) { console.warn("[notify-lead] telegram:", e.message); });

    // 2) Email to the agent (only if a provider key is set)
    if (agentEmail && process.env.RESEND_API_KEY) {
      await emailAgent(agentEmail, agentName, { title, where, lead, reach, link })
        .catch(function (e) { console.warn("[notify-lead] email:", e.message); });
    }

    // mark done so it never fires twice
    await fetch(base + "leads?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ notified_at: new Date().toISOString() }),
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};

async function telegram(text) {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("TELEGRAM_CHAT_ID");
  const payload = { chat_id: chat, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true };
  if (process.env.TELEGRAM_TOPIC_ID) payload.message_thread_id = Number(process.env.TELEGRAM_TOPIC_ID);
  const r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("telegram " + r.status + " " + (await r.text()).slice(0, 150));
}

async function emailAgent(to, name, d) {
  const from = process.env.LEAD_FROM_EMAIL || "BlockView <leads@blockview.co.il>";
  const html =
    "<div dir=\"rtl\" style=\"font-family:Arial,sans-serif;font-size:15px;color:#151C27\">" +
    "<h2 style=\"color:#0038B8\">פנייה חדשה לנכס שלך</h2>" +
    "<p><b>" + esc(d.title) + "</b>" + (d.where ? " — " + esc(d.where) : "") + "</p>" +
    "<p>מאת: <b>" + esc(d.lead.name || "—") + "</b>" + (d.reach ? "<br>" + esc(d.reach) : "") + "</p>" +
    (d.lead.message ? "<p style=\"background:#F5F7F9;padding:10px;border-radius:8px\">" + esc(d.lead.message) + "</p>" : "") +
    "<p><a href=\"" + d.link + "\" style=\"color:#0038B8\">צפייה בנכס</a> · " +
    "<a href=\"https://crm.blockview.co.il\" style=\"color:#0038B8\">מעבר ל-CRM</a></p></div>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: "פנייה חדשה: " + d.title, html }),
  });
  if (!r.ok) throw new Error("resend " + r.status + " " + (await r.text()).slice(0, 150));
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function env(name) {
  const v = process.env[name];
  if (!v) throw new Error("missing env " + name);
  return v;
}
