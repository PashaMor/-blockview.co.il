/* BlockView — dynamic sitemap of indexable listing pages.
 * Route: /sitemap-listings.xml  (vercel.json rewrites it to /api/sitemap)
 *
 * Lists only APPROVED, non-demo listings as /property/<id>/<slug> URLs, so
 * Google discovers them. Demo/test data (the seeded agent) is excluded. Edge-
 * cached. Referenced from robots.txt; submit it in Google Search Console.
 *
 * Env (Vercel server only): SUPABASE_URL, SUPABASE_SECRET_KEY.
 */
const SITE = "https://blockview.co.il";
const DEMO_AGENT = "542ac519-7db9-42a0-b3ed-45750dc94525";

function slugify(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/[^֐-׿0-9a-z]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "listing";
}
const xesc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) { res.statusCode = 500; res.end("not configured"); return; }

  let all = [];
  try {
    const sel = "id,title,updated_at,buildings(address)";
    for (let from = 0; ; from += 1000) {
      const url = SUPABASE_URL + "/rest/v1/listings?select=" + encodeURIComponent(sel) +
        "&status=eq.approved&agent_id=neq." + DEMO_AGENT + "&order=updated_at.desc";
      const r = await fetch(url, { headers: { apikey: KEY, Authorization: "Bearer " + KEY, Range: from + "-" + (from + 999) } });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) break;
      all = all.concat(rows);
      if (rows.length < 1000) break;
    }
  } catch (e) { /* return whatever we have */ }

  const body = all.map((l) => {
    const b = l.buildings || {};
    const loc = SITE + "/property/" + encodeURIComponent(l.id) + "/" + slugify(b.address || l.title || "");
    const lm = String(l.updated_at || "").slice(0, 10);
    return "  <url><loc>" + xesc(loc) + "</loc>" + (lm ? "<lastmod>" + lm + "</lastmod>" : "") +
      "<changefreq>daily</changefreq></url>";
  }).join("\n");

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "\n</urlset>\n";

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.end(xml);
};
