/* BlockView — server-rendered, indexable page for ONE listing.
 * Route: /property/<id>[/<slug>]  (vercel.json rewrites it to /api/property?p=…)
 *
 * The 3D map is a single-page app and invisible to search engines. This returns
 * real HTML per listing — unique <title>, meta description, canonical,
 * OpenGraph/Twitter, and schema.org JSON-LD — plus visible content and a button
 * into the map. Behaviour by state:
 *   - not found / rejected      -> 410 Gone (Google drops it; no soft-404)
 *   - approved & not demo       -> indexable
 *   - sold / frozen / pending / demo -> 200 but noindex
 * Edge-cached, so crawls and repeat visits don't hit the database.
 *
 * Env (Vercel server only): SUPABASE_URL, SUPABASE_SECRET_KEY.
 */
const SITE = "https://blockview.co.il";
// demo/test data must never be indexed (usertest6 = the seeded demo agent)
const DEMO_AGENT = "542ac519-7db9-42a0-b3ed-45750dc94525";
const DEMO_MARK = "נכס לדוגמה";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const jsonLd = (o) => JSON.stringify(o).replace(/</g, "\\u003c");   // can't break out of the script tag
function slugify(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/[^֐-׿0-9a-z]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "listing";
}
const money = (n) => "₪" + Number(n || 0).toLocaleString("en-US");
function send(res, code, type, body) { res.statusCode = code; res.setHeader("Content-Type", type); res.end(body); }

module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) return send(res, 500, "text/plain", "not configured");
  const raw = String((req.query && (req.query.p || req.query.id)) || "");
  let id = raw.split("/")[0].trim();                 // id is the first segment; the slug after it is ignored
  try { id = decodeURIComponent(id); } catch (e) {}  // id is ASCII, so this is a safe no-op
  if (!id) return gone(res);

  let l = null;
  try {
    const sel = "id,title,description,deal,price,rooms,size,floor,type,status,agent_id,updated_at," +
      "buildings(name,address,city,lat,lng),listing_photos(path,sort)";
    const r = await fetch(SUPABASE_URL + "/rest/v1/listings?select=" + encodeURIComponent(sel) +
      "&id=eq." + encodeURIComponent(id), { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
    const rows = await r.json();
    l = Array.isArray(rows) ? rows[0] : null;
  } catch (e) { /* fall through to 410 */ }

  if (!l || l.status === "rejected") return gone(res);

  const b = l.buildings || {};
  const photos = (l.listing_photos || []).slice().sort((a, c) => a.sort - c.sort)
    .map((p) => SUPABASE_URL + "/storage/v1/object/public/listing-photos/" + p.path);
  const cover = photos[0] || (SITE + "/logo.png");
  const dealTx = l.deal === "rent" ? "להשכרה" : "למכירה"; // להשכרה / למכירה
  const kind = l.type === "house" ? "בית" : "דירה"; // בית / דירה
  const roomsTx = l.rooms ? l.rooms + " חדרים" : "";
  const addr = b.address || b.name || "";
  const city = b.city || "";
  const title = l.title || (kind + " " + dealTx + (addr ? " ב" + addr : ""));
  const priceTx = money(l.price) + (l.deal === "rent" ? " לחודש" : "");
  const canonical = SITE + "/property/" + encodeURIComponent(l.id) + "/" + slugify(addr || title);

  const isDemo = l.agent_id === DEMO_AGENT ||
    String(l.description || "").includes(DEMO_MARK) || String(title).includes(DEMO_MARK);
  const indexable = l.status === "approved" && !isDemo;
  const robots = indexable ? "index, follow" : "noindex, follow";

  const metaTitle = ([title, addr ? "· " + addr : "", "· " + priceTx].filter(Boolean).join(" ") + " | BlockView");
  const descText = [kind + " " + dealTx, roomsTx, l.size ? l.size + ' מ"ר' : "", addr, priceTx]
    .filter(Boolean).join(", ") + ". צפייה במפת תלת-ממד ב-BlockView.";

  const item = {
    "@type": l.type === "house" ? "House" : "Apartment",
    name: title,
    description: String(l.description || descText).slice(0, 500),
    address: { "@type": "PostalAddress", streetAddress: addr, addressLocality: city, addressCountry: "IL" },
  };
  if (l.rooms) item.numberOfRoomsTotal = l.rooms;
  if (l.size) item.floorSize = { "@type": "QuantitativeValue", value: l.size, unitCode: "MTK" };
  if (isFinite(b.lat) && isFinite(b.lng)) item.geo = { "@type": "GeoCoordinates", latitude: b.lat, longitude: b.lng };
  if (photos.length) item.image = photos;
  const ld = { "@context": "https://schema.org", "@type": "Offer", priceCurrency: "ILS",
    price: Number(l.price) || undefined, availability: "https://schema.org/InStock", url: canonical, itemOffered: item };

  const mapUrl = SITE + "/?listing=" + encodeURIComponent(l.id);
  const specs = [
    roomsTx ? ["חדרים", l.rooms] : null,
    l.size ? ["שטח", l.size + ' מ"ר'] : null,
    (l.floor != null) ? ["קומה", l.floor] : null,
    ["סוג", kind],
  ].filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(metaTitle)}</title>
<meta name="description" content="${esc(descText)}"/>
<meta name="robots" content="${robots}"/>
<link rel="canonical" href="${esc(canonical)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(metaTitle)}"/>
<meta property="og:description" content="${esc(descText)}"/>
<meta property="og:image" content="${esc(cover)}"/>
<meta property="og:url" content="${esc(canonical)}"/>
<meta property="og:site_name" content="BlockView"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(metaTitle)}"/>
<meta name="twitter:description" content="${esc(descText)}"/>
<meta name="twitter:image" content="${esc(cover)}"/>
<script type="application/ld+json">${jsonLd(ld)}</script>
<style>
  :root{--blue:#0038B8;--ink:#151C27;--soft:#5A6879;--line:#E4E8ED}
  *{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",system-ui,"Assistant","Heebo",Arial,sans-serif;color:var(--ink);background:#eef1f4}
  .wrap{max-width:820px;margin:0 auto;padding:16px}
  a.brand{color:var(--blue);text-decoration:none;font-weight:700;display:inline-block;margin-bottom:10px}
  .card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 14px rgba(20,30,45,.08)}
  .hero{width:100%;height:min(52vw,420px);object-fit:cover;display:block;background:#dfe3e8}
  .body{padding:18px 20px 26px}
  .badge{display:inline-block;background:var(--blue);color:#fff;font-weight:700;font-size:13px;border-radius:999px;padding:4px 12px}
  h1{font-size:22px;margin:12px 0 4px;line-height:1.3}
  .addr{color:var(--soft);font-size:14px}
  .price{font-size:24px;font-weight:800;color:var(--blue);margin:12px 0}
  .specs{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}
  .spec{background:#f5f7f9;border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:14px;text-align:center}
  .spec b{display:block;color:var(--ink);font-size:16px}
  .thumbs{display:flex;gap:8px;overflow-x:auto;padding:8px 0}
  .thumbs img{width:120px;height:84px;object-fit:cover;border-radius:8px;flex:none}
  .desc{white-space:pre-wrap;line-height:1.7;font-size:15px;color:#263140;margin:10px 0 18px}
  .cta{display:inline-flex;align-items:center;gap:8px;background:var(--blue);color:#fff;text-decoration:none;font-weight:800;font-size:16px;border-radius:14px;padding:14px 22px}
  .foot{max-width:820px;margin:14px auto;color:var(--soft);font-size:13px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <a class="brand" href="${SITE}">← BlockView</a>
  <div class="card">
    <img class="hero" src="${esc(cover)}" alt="${esc(title)}"${photos.length ? "" : ' style="object-fit:contain;padding:48px"'}/>
    <div class="body">
      <span class="badge">${esc(dealTx)}</span>
      <h1>${esc(title)}</h1>
      <div class="addr">${esc(addr)}${city ? " · " + esc(city) : ""}</div>
      <div class="price">${esc(priceTx)}</div>
      <div class="specs">${specs.map((s) => `<div class="spec"><b>${esc(s[1])}</b>${esc(s[0])}</div>`).join("")}</div>
      ${photos.length > 1 ? `<div class="thumbs">${photos.slice(0, 8).map((u) => `<img src="${esc(u)}" alt="" loading="lazy"/>`).join("")}</div>` : ""}
      ${l.description ? `<p class="desc">${esc(l.description)}</p>` : ""}
      <a class="cta" href="${esc(mapUrl)}">🏙️ צפה במפת התלת-ממד</a>
    </div>
  </div>
  <p class="foot">${esc(descText)}</p>
</div>
</body>
</html>`;

  res.setHeader("Cache-Control", indexable
    ? "public, s-maxage=3600, stale-while-revalidate=86400"
    : "public, s-maxage=300");
  return send(res, 200, "text/html; charset=utf-8", html);
};

function gone(res) {
  const html = '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"/>' +
    '<meta name="robots" content="noindex"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<title>הנכס אינו זמין עוד | BlockView</title>' +
    '<style>body{font-family:system-ui,Arial;background:#eef1f4;color:#151C27;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}' +
    '.b{background:#fff;padding:32px;border-radius:16px;text-align:center;max-width:420px}a{color:#0038B8;font-weight:700;text-decoration:none}</style></head>' +
    '<body><div class="b"><div style="font-size:40px">🏠</div>' +
    '<h1>הנכס אינו זמין עוד</h1>' +
    '<p>ייתכן שהמודעה הוסרה או נמכרה.</p>' +
    '<a href="' + SITE + '">חזרה לחיפוש נכסים ב-BlockView →</a></div></body></html>';
  res.setHeader("Cache-Control", "public, s-maxage=300");
  return send(res, 410, "text/html; charset=utf-8", html);
}
