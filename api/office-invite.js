/* BlockView — email an agent that an office invited them to join.
 *
 * A DB trigger (42_office_invite_consent.sql) calls this when an office_members
 * row becomes 'invited'. Sends an email (Resend) with a link to the CRM, where
 * the person accepts or declines. No-op if RESEND_API_KEY isn't set, so the
 * in-CRM invite still works without email configured.
 *
 * Idempotent-ish: acts only on a real invited row. Env: SUPABASE_URL,
 * SUPABASE_SECRET_KEY, [RESEND_API_KEY], [LEAD_FROM_EMAIL].
 */
module.exports = async function handler(req, res) {
  try {
    const id = String((req.body && req.body.member_id) || (req.query && req.query.member_id) || "").trim();
    if (!id) return res.status(400).json({ error: "member_id required" });
    if (!process.env.RESEND_API_KEY) return res.status(200).json({ ok: false, reason: "email not configured" });

    const base = env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/";
    const key = env("SUPABASE_SECRET_KEY");
    const h = { apikey: key, Authorization: "Bearer " + key };

    const mr = await fetch(base + "office_members?id=eq." + encodeURIComponent(id) +
      "&select=status,invited_email,user_id,offices(name)", { headers: h });
    const m = (await mr.json())[0];
    if (!m || m.status !== "invited") return res.status(200).json({ ok: true, skip: true });

    let to = m.invited_email || "";
    if (!to && m.user_id) {
      try { const u = await (await fetch(env("SUPABASE_URL").replace(/\/+$/, "") + "/auth/v1/admin/users/" + m.user_id, { headers: h })).json(); to = (u && u.email) || ""; } catch (e) {}
    }
    if (!to) return res.status(200).json({ ok: false, reason: "no recipient" });

    const office = (m.offices && m.offices.name) || "משרד";
    const from = process.env.LEAD_FROM_EMAIL || "BlockView <invites@blockview.co.il>";
    const html =
      "<div dir=\"rtl\" style=\"font-family:Arial,sans-serif;font-size:15px;color:#151C27\">" +
      "<h2 style=\"color:#0038B8\">הוזמנת להצטרף למשרד</h2>" +
      "<p>המשרד <b>" + esc(office) + "</b> הזמין אותך להצטרף כסוכן ב-BlockView.</p>" +
      "<p>כדי לאשר או לדחות, היכנס ל-CRM:</p>" +
      "<p><a href=\"https://crm.blockview.co.il\" style=\"display:inline-block;background:#0038B8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700\">מעבר ל-CRM</a></p>" +
      "<p style=\"color:#8592A2;font-size:13px\">אם אין לך חשבון, הירשם עם כתובת האימייל הזו וההזמנה תופיע אוטומטית.</p></div>";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from, to: to, subject: "הזמנה להצטרף למשרד " + office + " ב-BlockView", html: html }),
    });
    if (!r.ok) return res.status(500).json({ error: "resend " + r.status + " " + (await r.text()).slice(0, 150) });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function env(name) { const v = process.env[name]; if (!v) throw new Error("missing env " + name); return v; }
