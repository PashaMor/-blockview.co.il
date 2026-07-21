/* BlockView — daily Telegram report.
 *
 * Runs once a day on Vercel Cron (see "crons" in vercel.json) and posts one
 * message to a Telegram chat: yesterday's Google Analytics traffic, Search
 * Console performance, and the numbers straight out of the database
 * (new listings, pending approvals, new leads, new signups).
 *
 * SECURITY
 *   - The endpoint refuses every request that does not carry
 *     `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends that header
 *     automatically once CRON_SECRET is set as an environment variable.
 *     Without CRON_SECRET set the handler refuses ALL requests — it never
 *     falls open.
 *   - Every credential comes from an environment variable. Nothing secret is in
 *     this repo. SUPABASE_SECRET_KEY lives only in Vercel's server environment
 *     and is never sent to a browser (this file is a serverless function, it is
 *     not bundled into www/).
 *   - The database is only ever asked for COUNTS (`Prefer: count=exact` with an
 *     empty row range), so no listing, lead or personal row leaves Supabase.
 *   - Errors are reported to Telegram as a short message; the HTTP response
 *     never echoes a credential.
 *
 * Environment variables (Vercel -> Settings -> Environment Variables):
 *   CRON_SECRET               random string; also what Vercel Cron sends
 *   TELEGRAM_BOT_TOKEN        from @BotFather
 *   TELEGRAM_CHAT_ID          chat / group / channel id ("-100…" for a group)
 *   TELEGRAM_TOPIC_ID         optional: forum topic to post into (omit for none)
 *   GA4_PROPERTY_ID           numeric GA4 property id (NOT the G-XXXX id)
 *   GSC_SITE_URL              e.g. "sc-domain:blockview.co.il"
 *   GOOGLE_CLIENT_EMAIL       service-account email
 *   GOOGLE_PRIVATE_KEY        service-account private key (PEM, \n escaped ok)
 *   SUPABASE_URL              https://<project>.supabase.co
 *   SUPABASE_SECRET_KEY       sb_secret_… (server only)
 */

const crypto = require("crypto");

const TZ = "Asia/Jerusalem";

module.exports = async function handler(req, res) {
  // ---------------------------------------------------------------- auth ---
  const secret = process.env.CRON_SECRET;
  const auth = req.headers["authorization"] || "";
  if (!secret || auth !== "Bearer " + secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const day = isoDay(-1);          // yesterday, Israel time
  const prev = isoDay(-2);
  const gscDay = isoDay(-3);       // Search Console data lags ~2 days

  try {
    const [ga, gaPrev, gsc, db] = await Promise.all([
      safe(() => ga4(day, day)),
      safe(() => ga4(prev, prev)),
      safe(() => searchConsole(gscDay)),
      safe(() => dbStats(day)),
    ]);

    const text = buildMessage({ day, gscDay, ga, gaPrev, gsc, db });
    await telegram(text);
    res.status(200).json({ ok: true, day });
  } catch (e) {
    await telegram("⚠️ BlockView daily report failed:\n" + esc(String(e && e.message ? e.message : e)))
      .catch(function () {});
    res.status(500).json({ ok: false });
  }
};

/* ------------------------------------------------------------------ dates -- */

// YYYY-MM-DD for "today + offset days", in Israel time
function isoDay(offset) {
  const now = new Date(Date.now() + offset * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return parts;                                  // en-CA already gives YYYY-MM-DD
}

async function safe(fn) {
  try { return await fn(); } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
}

/* ------------------------------------------------- Google service account -- */

let cachedToken = null;

// Signs a JWT with the service-account key and swaps it for an access token.
// Hand-rolled on purpose: no extra dependency in the tree for ~25 lines of code.
async function googleToken(scopes) {
  if (cachedToken && cachedToken.exp > Date.now() + 60000 && cachedToken.scopes === scopes) {
    return cachedToken.token;
  }
  const email = required("GOOGLE_CLIENT_EMAIL");
  const key = normalizeKey(required("GOOGLE_PRIVATE_KEY"));
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: scopes,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claim);
  const jwt = header + "." + claim + "." + b64url(signer.sign(key));

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("google auth failed: " + (j.error_description || j.error || r.status));
  cachedToken = { token: j.access_token, exp: Date.now() + 3500000, scopes: scopes };
  return j.access_token;
}

/* A PEM key pasted into a dashboard field arrives mangled in a handful of
 * predictable ways, and every one of them fails as the same opaque
 * "DECODER routines::unsupported". Rather than make the reader guess which,
 * accept them all: wrapping quotes, escaped \n, the whole JSON key file, or a
 * key whose line breaks were flattened to spaces or lost outright. */
function normalizeKey(raw) {
  let k = String(raw).trim();

  // the whole service-account JSON file, pasted in
  if (k.charAt(0) === "{") {
    try { k = String(JSON.parse(k).private_key || ""); } catch (e) { /* not JSON after all */ }
  }
  // wrapping quotes copied along with the value
  if (k.length > 1 && (k.charAt(0) === '"' || k.charAt(0) === "'") && k.charAt(k.length - 1) === k.charAt(0)) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\r/g, "").trim();

  // anything around the key — a leading `"private_key": "`, a trailing `",` —
  // is discarded by keeping only what lies between the BEGIN and END markers
  const span = k.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/);
  if (span) k = span[0];

  // line breaks flattened away — rebuild the PEM from the base64 body
  if (k.indexOf("-----BEGIN") === 0 && k.indexOf("\n") === -1) {
    const m = k.match(/^-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----$/);
    if (m) {
      const label = m[1];
      const body = m[2].replace(/[^A-Za-z0-9+/=]/g, "");
      const lines = body.match(/.{1,64}/g) || [];
      k = "-----BEGIN " + label + "-----\n" + lines.join("\n") + "\n-----END " + label + "-----\n";
    }
  }
  if (!/^-----BEGIN [A-Z0-9 ]+-----/.test(k)) {
    throw new Error("GOOGLE_PRIVATE_KEY is not a PEM key — paste the private_key value, starting with -----BEGIN PRIVATE KEY-----");
  }
  return k;
}

function b64url(x) {
  return Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error("missing env " + name);
  return v;
}

/* --------------------------------------------------------------- GA4 API -- */

async function ga4(from, to) {
  const prop = required("GA4_PROPERTY_ID").replace(/^properties\//, "");
  const token = await googleToken("https://www.googleapis.com/auth/analytics.readonly");
  const url = "https://analyticsdata.googleapis.com/v1beta/properties/" + prop + ":runReport";

  async function run(body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ dateRanges: [{ startDate: from, endDate: to }] }, body)),
    });
    const j = await r.json();
    if (!r.ok) throw new Error("GA4: " + (j.error && j.error.message ? j.error.message : r.status));
    return j;
  }

  const totals = await run({
    metrics: [
      { name: "activeUsers" }, { name: "newUsers" }, { name: "sessions" },
      { name: "screenPageViews" }, { name: "averageSessionDuration" },
    ],
  });
  const bySurface = await run({
    dimensions: [{ name: "customUser:surface" }],
    metrics: [{ name: "activeUsers" }],
    limit: 5,
  }).catch(function () { return null; });     // custom dimension may not be registered yet
  const byCountry = await run({
    dimensions: [{ name: "country" }],
    metrics: [{ name: "activeUsers" }],
    orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
    limit: 4,
  });
  const bySource = await run({
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 4,
  });

  const m = row(totals, 0);
  return {
    users: num(m[0]),
    newUsers: num(m[1]),
    sessions: num(m[2]),
    views: num(m[3]),
    avgDuration: num(m[4]),
    surface: pairs(bySurface),
    countries: pairs(byCountry),
    channels: pairs(bySource),
  };
}

function row(resp, i) {
  const rows = resp && resp.rows ? resp.rows : [];
  const r = rows[i];
  return r && r.metricValues ? r.metricValues.map(function (v) { return v.value; }) : [];
}

function pairs(resp) {
  if (!resp || !resp.rows) return [];
  return resp.rows.map(function (r) {
    return { key: r.dimensionValues[0].value, value: num(r.metricValues[0].value) };
  });
}

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

/* ---------------------------------------------------- Search Console API -- */

async function searchConsole(day) {
  const site = required("GSC_SITE_URL");
  const token = await googleToken("https://www.googleapis.com/auth/webmasters.readonly");
  const url = "https://searchconsole.googleapis.com/webmasters/v3/sites/" +
              encodeURIComponent(site) + "/searchAnalytics/query";

  async function run(body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ startDate: day, endDate: day }, body)),
    });
    const j = await r.json();
    if (!r.ok) throw new Error("GSC: " + (j.error && j.error.message ? j.error.message : r.status));
    return j.rows || [];
  }

  const totals = await run({ dimensions: [] });
  const queries = await run({ dimensions: ["query"], rowLimit: 5 });
  const t = totals[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    clicks: t.clicks || 0,
    impressions: t.impressions || 0,
    ctr: t.ctr || 0,
    position: t.position || 0,
    queries: queries.map(function (q) {
      return { key: q.keys[0], clicks: q.clicks, impressions: q.impressions };
    }),
  };
}

/* -------------------------------------------------------- Supabase counts -- */

async function dbStats(day) {
  const base = required("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/";
  const key = required("SUPABASE_SECRET_KEY");
  // "+03:00" must be percent-encoded: a bare "+" in a query string means a space
  const from = encodeURIComponent(day + "T00:00:00+03:00");
  const to = encodeURIComponent(nextDay(day) + "T00:00:00+03:00");

  // HEAD + count=exact: Supabase returns only the number, never a row.
  async function count(table, query) {
    const r = await fetch(base + table + "?select=id" + (query || ""), {
      method: "HEAD",
      headers: {
        apikey: key,
        authorization: "Bearer " + key,
        prefer: "count=exact",
        range: "0-0",
      },
    });
    if (r.status === 401 || r.status === 403) {
      // a HEAD reply has no body, so say what the status actually means here
      throw new Error("db " + table + ": " + r.status + " — SUPABASE_SECRET_KEY rejected. " +
                      "It must be the sb_secret_… key (Supabase → Settings → API Keys), " +
                      "not the publishable key.");
    }
    if (!r.ok) throw new Error("db " + table + ": " + r.status);
    const cr = r.headers.get("content-range") || "";
    const n = Number(cr.split("/")[1]);
    return isFinite(n) ? n : 0;
  }

  const window_ = "&created_at=gte." + from + "&created_at=lt." + to;
  const [listings, approved, leads, signups, pending] = await Promise.all([
    count("listings", window_),
    count("listings", window_ + "&status=eq.approved"),
    count("leads", window_),
    count("profiles", window_),
    count("listings", "&status=eq.pending"),
  ]);
  return { listings, approved, leads, signups, pending };
}

function nextDay(day) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------- message -- */

function buildMessage(x) {
  const L = [];
  L.push("📊 <b>BlockView — " + x.day + "</b>");
  L.push("");

  if (x.ga && !x.ga.error) {
    const p = x.gaPrev && !x.gaPrev.error ? x.gaPrev : null;
    L.push("<b>תנועה (Google Analytics)</b>");
    L.push("👥 משתמשים: <b>" + x.ga.users + "</b>" + delta(x.ga.users, p ? p.users : null));
    L.push("🆕 חדשים: " + x.ga.newUsers + "   ⏱ ממוצע: " + Math.round(x.ga.avgDuration) + "s");
    L.push("🔁 סשנים: " + x.ga.sessions + delta(x.ga.sessions, p ? p.sessions : null) +
           "   📄 צפיות: " + x.ga.views);
    if (x.ga.surface.length) L.push("📱 " + x.ga.surface.map(kv).join("  ·  "));
    if (x.ga.channels.length) L.push("🚪 " + x.ga.channels.map(kv).join("  ·  "));
    if (x.ga.countries.length) L.push("🌍 " + x.ga.countries.map(kv).join("  ·  "));
  } else {
    L.push("<b>תנועה</b>: ⚠️ " + esc(x.ga ? x.ga.error : "no data"));
  }

  L.push("");
  if (x.gsc && !x.gsc.error) {
    L.push("<b>חיפוש בגוגל</b> <i>(" + x.gscDay + ")</i>");
    L.push("🖱 קליקים: <b>" + x.gsc.clicks + "</b>   👁 חשיפות: " + x.gsc.impressions);
    L.push("📈 CTR: " + (x.gsc.ctr * 100).toFixed(1) + "%   📍 מיקום ממוצע: " + x.gsc.position.toFixed(1));
    if (x.gsc.queries.length) {
      L.push("🔎 שאילתות מובילות:");
      x.gsc.queries.forEach(function (q) {
        L.push("   • " + esc(q.key) + " — " + q.clicks + "/" + q.impressions);
      });
    }
  } else {
    L.push("<b>חיפוש בגוגל</b>: ⚠️ " + esc(x.gsc ? x.gsc.error : "no data"));
  }

  L.push("");
  if (x.db && !x.db.error) {
    L.push("<b>הפעילות במערכת</b>");
    L.push("🏠 נכסים חדשים: <b>" + x.db.listings + "</b> (אושרו: " + x.db.approved + ")");
    L.push("📬 פניות חדשות: <b>" + x.db.leads + "</b>");
    L.push("🙋 נרשמים חדשים: " + x.db.signups);
    L.push("⏳ ממתינים לאישור: <b>" + x.db.pending + "</b>" + (x.db.pending > 0 ? " ← admin.blockview.co.il" : ""));
  } else {
    L.push("<b>הפעילות במערכת</b>: ⚠️ " + esc(x.db ? x.db.error : "no data"));
  }

  return L.join("\n");
}

function kv(p) { return esc(p.key) + " " + p.value; }

function delta(now, before) {
  if (before === null || before === undefined) return "";
  const d = now - before;
  if (!d) return " (=)";
  return d > 0 ? " (▲" + d + ")" : " (▼" + Math.abs(d) + ")";
}

// Telegram HTML parse mode: only these three need escaping.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* --------------------------------------------------------------- Telegram -- */

async function telegram(text) {
  const token = required("TELEGRAM_BOT_TOKEN");
  const chat = required("TELEGRAM_CHAT_ID");
  const topic = process.env.TELEGRAM_TOPIC_ID;      // optional: forum topic
  const payload = {
    chat_id: chat,
    text: text.slice(0, 4000),
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
    // never echo the token: the URL is not included in the error
    throw new Error("telegram " + r.status + " " + body.slice(0, 200));
  }
}
