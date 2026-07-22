/* BlockView — fetch a building's real outline from OpenStreetMap, server-side.
 *
 * Why this exists: the browser lookup (js/geo.js) hits Overpass directly, which
 * is flaky and CORS-limited, so a building's outline often fails to load and the
 * map draws a generic box that does not sit on the real building. Doing it here
 * fixes that for good:
 *   - a real User-Agent and form-encoded body, which every Overpass mirror
 *     accepts, and a generous server-side timeout (no browser abort);
 *   - the outline is written with the SERVICE key, so it works for anonymous
 *     map viewers — no one has to be signed in for a building to heal;
 *   - the shape comes from OSM, never from the caller, and only a NULL footprint
 *     is ever filled, so this endpoint cannot be used to move or deface a
 *     building. It is safe to call without auth.
 *
 *   GET /api/footprint?id=<building_id>
 *     -> { ok:true, footprint, center:[lng,lat], height }   (fetched & stored)
 *     -> { ok:true, already:true }                           (already had one)
 *     -> { ok:false, reason:"no outline" }                   (OSM has none yet)
 *
 * Env (Vercel server only): SUPABASE_URL, SUPABASE_SECRET_KEY.
 */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

module.exports = async function handler(req, res) {
  try {
    const id = String((req.query && req.query.id) || "").trim();
    if (!id) return res.status(400).json({ error: "id required" });

    const base = env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/";
    const key = env("SUPABASE_SECRET_KEY");
    const h = { apikey: key, Authorization: "Bearer " + key };

    const bRes = await fetch(
      base + "buildings?select=id,lat,lng,footprint&id=eq." + encodeURIComponent(id),
      { headers: h }
    );
    const rows = await bRes.json();
    const b = rows && rows[0];
    if (!b) return res.status(404).json({ error: "building not found" });
    if (b.footprint) return res.status(200).json({ ok: true, already: true });

    const fp = await fetchFootprint(b.lat, b.lng);
    if (!fp) return res.status(200).json({ ok: false, reason: "no outline" });

    // fill ONLY while still null — never overwrite, and lose a race gracefully
    const up = await fetch(
      base + "buildings?id=eq." + encodeURIComponent(id) + "&footprint=is.null",
      {
        method: "PATCH",
        headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          footprint: fp.polygon, osm_id: fp.osmId, height: fp.height,
          lat: fp.center[1], lng: fp.center[0],
        }),
      }
    );
    if (!up.ok) return res.status(500).json({ error: "write failed", status: up.status });
    return res.status(200).json({ ok: true, footprint: fp.polygon, center: fp.center, height: fp.height });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};

async function fetchFootprint(lat, lng) {
  const q =
    "[out:json][timeout:20];(" +
    "way(around:30," + lat + "," + lng + ")[building];" +
    "relation(around:30," + lat + "," + lng + ")[building];" +
    ");out geom;";
  for (let i = 0; i < OVERPASS.length; i++) {
    try {
      const r = await fetch(OVERPASS[i], {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "BlockView/1.0 (https://blockview.co.il)",
        },
        body: "data=" + encodeURIComponent(q),
      });
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") || "";
      if (ct.indexOf("json") === -1) continue;
      const fp = pick(await r.json(), lat, lng);
      if (fp) return fp;
    } catch (e) { /* try the next mirror */ }
  }
  return null;
}

// choose the building that contains the point, else the nearest, and shape it
function pick(data, lat, lng) {
  const cands = [];
  (data.elements || []).forEach((el) => {
    let g = null;
    if (el.geometry && el.geometry.length > 3) g = el.geometry;
    else if (el.members) {
      for (const m of el.members) {
        if (m.role === "outer" && m.geometry && m.geometry.length > 3) { g = m.geometry; break; }
      }
    }
    if (g) cands.push({ el, g });
  });
  if (!cands.length) return null;

  let chosen = cands.find((c) => inRing(lng, lat, c.g));
  if (!chosen) {
    let best = Infinity;
    cands.forEach((c) => {
      const ctr = center(c.g);
      const d = (ctr[0] - lng) ** 2 + (ctr[1] - lat) ** 2;
      if (d < best) { best = d; chosen = c; }
    });
  }
  const ring = chosen.g.map((p) => [p.lon, p.lat]);
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
  return {
    osmId: chosen.el.type + "/" + chosen.el.id,
    polygon: { type: "Polygon", coordinates: [ring] },
    height: heightOf(chosen.el.tags || {}),
    center: center(ring.map((p) => ({ lon: p[0], lat: p[1] }))),
  };
}

function inRing(x, y, g) {
  let inside = false;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    const xi = g[i].lon, yi = g[i].lat, xj = g[j].lon, yj = g[j].lat;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function center(g) {
  let minx = 180, maxx = -180, miny = 90, maxy = -90;
  g.forEach((p) => {
    if (p.lon < minx) minx = p.lon; if (p.lon > maxx) maxx = p.lon;
    if (p.lat < miny) miny = p.lat; if (p.lat > maxy) maxy = p.lat;
  });
  return [(minx + maxx) / 2, (miny + maxy) / 2];
}
function heightOf(t) {
  const h = parseFloat(t.height || t["building:height"]);
  if (isFinite(h) && h > 2) return h;
  const lv = parseFloat(t["building:levels"]);
  if (isFinite(lv) && lv > 0) return Math.round(lv * 3 + 1);
  return 24;
}

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error("missing env " + name);
  return v;
}
