// BlockView — email the listing's agent when a user reports their listing.
//
// Deploy:  supabase functions deploy listing-reported
// Uses the same secrets as agent-approved: RESEND_API_KEY, FROM_EMAIL.
// Set "Verify JWT" ON is fine — the anon key is a valid JWT, and a guest reports
// with it. The function trusts nothing from the caller except the report id, and
// it only ever emails the agent that OWNS that report, exactly once (notified_at).
//
// Security: RESEND key stays in this function's env. The caller cannot choose the
// recipient — it is derived from the report -> listing -> agent, server-side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CRM_URL = "https://crm.blockview.co.il";

const REASON_HE: Record<string, string> = {
  unavailable: "הנכס כבר לא זמין / נמכר",
  wrong_price: "המחיר שגוי או מטעה",
  wrong_details: "פרטים שגויים",
  misleading_photos: "תמונות מטעות",
  scam: "חשד להונאה / ספאם",
  offensive: "תוכן פוגעני",
  other: "אחר",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "BlockView <no-reply@blockview.co.il>";
  if (!RESEND_API_KEY) return json({ error: "email not configured" }, 500);

  const body = await req.json().catch(() => ({}));
  const reportId = String(body.report_id || "");
  if (!reportId) return json({ error: "report_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // the report -> its listing + agent (recipient chosen server-side, not by the caller)
  const { data: rep } = await admin
    .from("listing_reports")
    .select("id, reason, details, agent_id, notified_at, listings(title)")
    .eq("id", reportId).single();
  if (!rep) return json({ error: "report not found" }, 404);
  if (rep.notified_at) return json({ ok: true, already: true });   // one email per report
  if (!rep.agent_id) return json({ error: "no agent" }, 422);

  // agent email
  const { data: prof } = await admin.from("profiles").select("email").eq("id", rep.agent_id).single();
  let email = prof?.email as string | null;
  if (!email) {
    const { data: u } = await admin.auth.admin.getUserById(rep.agent_id);
    email = u?.user?.email ?? null;
  }
  if (!email) return json({ error: "no email" }, 422);

  const title = (rep.listings as { title?: string } | null)?.title || "הנכס שלך";
  const reason = REASON_HE[rep.reason] || rep.reason;
  const details = (rep.details || "").trim();

  const html = `
    <div dir="rtl" style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#263140">
      <div style="text-align:center;padding:8px 0 4px"><b style="font-size:22px;color:#0038B8">BlockView</b></div>
      <div style="background:#F5F7F9;border:1px solid #E4E8ED;border-radius:16px;padding:26px 22px">
        <h1 style="font-size:20px;margin:0 0 12px">📩 התקבל דיווח על נכס שלך</h1>
        <p style="font-size:15px;line-height:1.7;margin:0 0 8px">התקבל דיווח מגולש על הנכס:</p>
        <p style="font-size:15px;font-weight:700;margin:0 0 12px">${esc(title)}</p>
        <p style="font-size:15px;line-height:1.7;margin:0 0 6px"><b>סיבת הדיווח:</b> ${esc(reason)}</p>
        ${details ? `<p style="font-size:14px;line-height:1.7;margin:0 0 12px;color:#5A6879"><b>פירוט:</b> ${esc(details)}</p>` : ""}
        <p style="font-size:14px;line-height:1.7;margin:12px 0 16px">
          כדאי לבדוק את הנכס במערכת. אם הנכס כבר לא רלוונטי או נמכר, אפשר לאשר את הדיווח ולהסירו מהמפה.
        </p>
        <div style="text-align:center;margin:20px 0">
          <a href="${CRM_URL}" style="display:inline-block;background:#0038B8;color:#fff;text-decoration:none;
             font-weight:700;font-size:15px;padding:13px 26px;border-radius:12px">פתח את ה-CRM ←</a>
        </div>
      </div>
      <p style="font-size:11.5px;color:#8592A2;text-align:center;margin:14px 0 0">BlockView · נדל"ן בתלת מימד</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: "📩 התקבל דיווח על נכס שלך ב-BlockView", html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json({ error: "send failed", detail }, 502);
  }
  // mark notified so a repeat call can't email again
  await admin.from("listing_reports").update({ notified_at: new Date().toISOString() }).eq("id", reportId);
  return json({ ok: true });
});
