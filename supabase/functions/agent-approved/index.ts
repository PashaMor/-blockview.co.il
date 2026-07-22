// BlockView — send the "you're approved as an agent" email (with a CRM link).
//
// Deploy:  supabase functions deploy agent-approved
// Secrets: supabase secrets set RESEND_API_KEY=... FROM_EMAIL="BlockView <noreply@blockview.co.il>"
//
// Security: the RESEND key lives only in this function's env, never in the
// browser. The caller must be a signed-in ADMIN — verified here with the service
// role — and the target must actually be an agent now, so this can only ever
// send a truthful "approved" message and cannot be used to spam arbitrary users.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CRM_URL = "https://crm.blockview.co.il";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "BlockView <noreply@blockview.co.il>";
  if (!RESEND_API_KEY) return json({ error: "email not configured" }, 500);

  // 1) who is calling — must be a signed-in admin
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) return json({ error: "unauthorized" }, 401);

  const { data: callerProfile } = await admin
    .from("profiles").select("role").eq("id", caller.user.id).single();
  if (!callerProfile || callerProfile.role !== "admin") return json({ error: "forbidden" }, 403);

  // 2) the target — must be an agent now (i.e. the approval already committed)
  const body = await req.json().catch(() => ({}));
  const targetId = String(body.user_id || "");
  if (!targetId) return json({ error: "user_id required" }, 400);

  const { data: target } = await admin
    .from("profiles").select("role, email").eq("id", targetId).single();
  if (!target || target.role !== "agent") return json({ error: "target is not an agent" }, 409);

  // recipient email + a friendly name from the branding row
  let email = target.email as string | null;
  if (!email) {
    const { data: u } = await admin.auth.admin.getUserById(targetId);
    email = u?.user?.email ?? null;
  }
  if (!email) return json({ error: "no email for target" }, 422);

  const { data: prof } = await admin
    .from("agent_profiles").select("first_name, agency").eq("user_id", targetId).single();
  const name = (prof?.first_name || "").trim();
  const agency = (prof?.agency || "").trim();

  // 3) send it
  const hello = name ? `שלום ${escapeHtml(name)},` : "שלום,";
  const html = `
    <div dir="rtl" style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#263140">
      <div style="text-align:center;padding:8px 0 4px"><b style="font-size:22px;color:#0038B8">BlockView</b></div>
      <div style="background:#F5F7F9;border:1px solid #E4E8ED;border-radius:16px;padding:26px 22px">
        <h1 style="font-size:20px;margin:0 0 12px">החשבון שלך אושר כסוכן 🎉</h1>
        <p style="font-size:15px;line-height:1.7;margin:0 0 8px">${hello}</p>
        <p style="font-size:15px;line-height:1.7;margin:0 0 16px">
          בקשתך להצטרף כסוכן ב-BlockView${agency ? ` (משרד ${escapeHtml(agency)})` : ""} אושרה.
          מעכשיו תוכל לפרסם ולנהל נכסים, לקבל לידים ולעדכן את המיתוג שלך במערכת ה-CRM.
        </p>
        <div style="text-align:center;margin:22px 0">
          <a href="${CRM_URL}" style="display:inline-block;background:#0038B8;color:#fff;
             text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:12px">
            כניסה למערכת הסוכנים ←
          </a>
        </div>
        <p style="font-size:12.5px;color:#8592A2;line-height:1.7;margin:12px 0 0">
          או היכנס ישירות אל <a href="${CRM_URL}" style="color:#0038B8">crm.blockview.co.il</a>
          עם אותם פרטי ההתחברות של החשבון שלך.
        </p>
      </div>
      <p style="font-size:11.5px;color:#8592A2;text-align:center;margin:14px 0 0">
        BlockView · נדל"ן בתלת מימד · אם לא ביקשת זאת, אפשר להתעלם מהודעה זו.
      </p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: "אושרת כסוכן ב-BlockView 🎉",
      html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json({ error: "send failed", detail }, 502);
  }
  return json({ ok: true });
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
