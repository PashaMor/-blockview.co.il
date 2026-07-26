/* BlockView — translate a listing's title & description into every app language.
 *
 * The interface is in 6 languages but listings are written in one (usually
 * Hebrew), so an English viewer saw Hebrew text. This translates each listing
 * ONCE and stores the result (supabase/35_listing_translations.sql); the app
 * then just picks the row for the current language. A DB trigger calls this on
 * insert / edit, so translations stay in step without any per-view cost.
 *
 * Reuses the Google service account already configured for the daily report
 * (GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY) via the Cloud Translation API — so
 * the only new setup is enabling that API on the same Google Cloud project.
 * Idempotent: a language already stored is skipped. Safe without a secret — it
 * only ever reads a real listing id and writes derived public text.
 *
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY.
 */
const crypto = require("crypto");
const LANGS = ["he", "en", "es", "ar", "fr", "ru"];

module.exports = async function handler(req, res) {
  try {
    const id = String((req.body && req.body.id) || (req.query && req.query.id) || "").trim();
    if (!id) return res.status(400).json({ error: "id required" });

    const base = env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/";
    const key = env("SUPABASE_SECRET_KEY");
    const h = { apikey: key, Authorization: "Bearer " + key };

    const lr = await fetch(base + "listings?id=eq." + encodeURIComponent(id) + "&select=id,title,description", { headers: h });
    const listing = (await lr.json())[0];
    if (!listing) return res.status(404).json({ error: "listing not found" });

    const title = String(listing.title || "").trim();
    const description = String(listing.description || "").trim();
    if (!title && !description) return res.status(200).json({ ok: true, empty: true });

    // which languages are already stored for this listing (empty if the table
    // isn't there yet — run 35_listing_translations.sql)
    const er = await fetch(base + "listing_translations?listing_id=eq." + encodeURIComponent(id) + "&select=lang", { headers: h });
    const existing = await er.json();
    const have = {};
    if (Array.isArray(existing)) existing.forEach((r) => (have[r.lang] = true));

    const token = await googleToken("https://www.googleapis.com/auth/cloud-translation");

    // translate to each language we don't have yet. The source language (which
    // Google detects) needs no row — the app falls back to the original there.
    let source = null;
    const rows = [];
    for (const lang of LANGS) {
      if (have[lang]) continue;
      const out = await translate(token, [title, description], lang);
      if (!out) continue;
      if (!source) source = out.source;
      if (out.source === lang) continue;            // this IS the original language
      rows.push({ listing_id: id, lang: lang, title: out.texts[0] || null, description: out.texts[1] || null });
    }
    if (rows.length) {
      const up = await fetch(base + "listing_translations?on_conflict=listing_id,lang", {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!up.ok) return res.status(500).json({ error: "store failed", status: up.status, body: (await up.text()).slice(0, 200) });
    }
    return res.status(200).json({ ok: true, added: rows.map((r) => r.lang), source: source });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};

// Google Cloud Translation v2. Returns { texts:[...], source } or null.
async function translate(token, qArr, target) {
  const q = qArr.map((s) => String(s || ""));
  const r = await fetch("https://translation.googleapis.com/language/translate/v2", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ q: q, target: target, format: "text" }),
  });
  if (!r.ok) throw new Error("translate " + r.status + " " + (await r.text()).slice(0, 160));
  const j = await r.json();
  const tr = j && j.data && j.data.translations;
  if (!tr) return null;
  return { texts: tr.map((t) => t.translatedText), source: (tr[0] && tr[0].detectedSourceLanguage) || null };
}

/* ---- Google service-account auth (same approach as api/daily-report.js) ---- */
let cachedToken = null;
async function googleToken(scopes) {
  if (cachedToken && cachedToken.exp > Date.now() + 60000 && cachedToken.scopes === scopes) return cachedToken.token;
  const email = env("GOOGLE_CLIENT_EMAIL");
  const key = normalizeKey(env("GOOGLE_PRIVATE_KEY"));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: email, scope: scopes, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claim);
  const jwt = header + "." + claim + "." + b64url(signer.sign(key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("google auth failed: " + (j.error_description || j.error || r.status));
  cachedToken = { token: j.access_token, exp: Date.now() + 3500000, scopes: scopes };
  return j.access_token;
}
function normalizeKey(raw_) {
  let k = String(raw_).trim();
  if (k.charAt(0) === "{") { try { k = String(JSON.parse(k).private_key || ""); } catch (e) {} }
  if (k.length > 1 && (k.charAt(0) === '"' || k.charAt(0) === "'") && k.charAt(k.length - 1) === k.charAt(0)) k = k.slice(1, -1);
  k = k.replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\r/g, "").trim();
  const span = k.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/);
  if (span) k = span[0];
  if (k.indexOf("-----BEGIN") === 0 && k.indexOf("\n") === -1) {
    const m = k.match(/^-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----$/);
    if (m) { const body = m[2].replace(/[^A-Za-z0-9+/=]/g, ""); const lines = body.match(/.{1,64}/g) || [];
      k = "-----BEGIN " + m[1] + "-----\n" + lines.join("\n") + "\n-----END " + m[1] + "-----\n"; }
  }
  if (!/^-----BEGIN [A-Z0-9 ]+-----/.test(k)) throw new Error("GOOGLE_PRIVATE_KEY holds no PEM block");
  return k;
}
function b64url(x) { return Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function env(name) { const v = process.env[name]; if (!v) throw new Error("missing env " + name); return v; }
