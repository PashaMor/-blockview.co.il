/* BlockView — shared "what's nearby" import, used by the API endpoint and the
 * nightly sweep so the two can never drift apart. (The batch CLI in
 * scripts/nearby-import.mjs is ESM and predates this; it carries its own copy.)
 *
 * Imports the nearest places around one building from OpenStreetMap (Overpass)
 * and writes them to places + building_places with the service key. Public
 * geodata only — no PII. Not a route (it lives outside /api), so Vercel bundles
 * it into whichever function requires it rather than serving it.
 */

const RADIUS_M = 1500;
const PER_CATEGORY = 5;
const DETOUR = 1.3;
const WALK_M_PER_MIN = 80;
// Multiple mirrors: any one of them can be down or overloaded (504/503) at the
// moment a listing is created. overpass() rotates through them across retries,
// so a single flaky server no longer leaves a building without nearby data.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

// Keep in sync with scripts/nearby-import.mjs and supabase/12_nearby_places.sql
const CATEGORIES = {
  education: [
    ['node["amenity"~"^(kindergarten|school)$"]', "amenity"],
    ['way["amenity"~"^(kindergarten|school)$"]', "amenity"],
  ],
  transit: [
    ['node["highway"="bus_stop"]', "highway"],
    ['node["railway"~"^(tram_stop|station|halt)$"]', "railway"],
  ],
  errands: [
    ['node["shop"~"^(supermarket|convenience)$"]', "shop"],
    ['way["shop"~"^(supermarket|convenience)$"]', "shop"],
    ['node["amenity"~"^(pharmacy|clinic|doctors|bank)$"]', "amenity"],
  ],
  leisure: [
    ['node["leisure"~"^(park|playground|fitness_centre)$"]', "leisure"],
    ['way["leisure"~"^(park|playground|fitness_centre)$"]', "leisure"],
    ['node["amenity"="cafe"]', "amenity"],
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversine(lng1, lat1, lng2, lat2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function buildQuery(lng, lat) {
  const around = "(around:" + RADIUS_M + "," + lat + "," + lng + ")";
  const parts = [];
  for (const selectors of Object.values(CATEGORIES)) {
    for (const sel of selectors) parts.push(sel[0] + around + ";");
  }
  return "[out:json][timeout:50];(" + parts.join("") + ");out center tags;";
}

function classify(tags) {
  for (const [category, selectors] of Object.entries(CATEGORIES)) {
    for (const [sel, key] of selectors) {
      const value = tags[key];
      if (!value) continue;
      const m = sel.match(/\["[a-z:]+"(?:~"\^?\(?([^"]+?)\)?\$?"|="([^"]+)")\]/);
      if (!m) continue;
      const allowed = m[2] ? [m[2]] : m[1].replace(/[()^$]/g, "").split("|");
      if (allowed.includes(value)) return { category, kind: value };
    }
  }
  return null;
}

async function overpass(query, opts) {
  opts = opts || {};
  const attempts = opts.attempts || 6;   // 3 mirrors x 2 passes
  const timeout = opts.timeout || 25000;
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "BlockView/1.0 (nearby)" },
        body: query,
        signal: AbortSignal.timeout(timeout),
      });
      const type = res.headers.get("content-type") || "";
      const text = await res.text();
      if (!res.ok) throw new Error("HTTP " + res.status);
      if (!type.includes("json")) throw new Error("non-JSON");
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < attempts - 1) await sleep(3000 * (attempt + 1));
    }
  }
  throw lastErr;
}

function makeRest(supabaseUrl, serviceKey) {
  return async function rest(path, opts) {
    opts = opts || {};
    const res = await fetch(supabaseUrl + "/rest/v1/" + path, {
      method: opts.method || "GET",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
        Prefer: opts.prefer || "",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new Error(path + " -> " + res.status + " " + (await res.text()));
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}

/* Import nearby places for one building. `building` needs {id, lng, lat}.
 * Returns {skipped} if it already has data or nothing was found, else {saved}. */
async function importOneBuilding(cfg, building, opts) {
  const rest = makeRest(cfg.supabaseUrl, cfg.serviceKey);
  const id = String(building.id);
  const lng = +building.lng, lat = +building.lat;

  const existing = await rest("building_places?select=building_id&limit=1&building_id=eq." + encodeURIComponent(id));
  if (existing && existing.length) return { skipped: "already has data" };

  const data = await overpass(buildQuery(lng, lat), opts);

  const byCat = { education: [], transit: [], errands: [], leisure: [] };
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const elng = el.lon != null ? el.lon : (el.center && el.center.lon);
    const elat = el.lat != null ? el.lat : (el.center && el.center.lat);
    if (elng == null || elat == null) continue;
    const hit = classify(tags);
    if (!hit) continue;
    const name = tags["name:he"] || tags.name || tags["name:en"];
    if (!name) continue;
    const meters = Math.round(haversine(lng, lat, elng, elat));
    if (meters > RADIUS_M) continue;
    byCat[hit.category].push({
      id: el.type + "/" + el.id, category: hit.category, kind: hit.kind,
      names: { he: tags["name:he"] || null, en: tags["name:en"] || null, ar: tags["name:ar"] || null, default: tags.name || name },
      lng: elng, lat: elat, meters,
    });
  }

  const chosen = [];
  for (const list of Object.values(byCat)) {
    list.sort((x, y) => x.meters - y.meters);
    list.slice(0, PER_CATEGORY).forEach((p, i) => chosen.push(Object.assign({}, p, { rank: i + 1 })));
  }
  if (!chosen.length) return { skipped: "nothing nearby" };

  await rest("places?on_conflict=id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: chosen.map((p) => ({ id: p.id, category: p.category, kind: p.kind, names: p.names, lng: p.lng, lat: p.lat, updated_at: new Date().toISOString() })),
  });
  await rest("building_places?building_id=eq." + encodeURIComponent(id), { method: "DELETE" });
  await rest("building_places", {
    method: "POST",
    prefer: "return=minimal",
    body: chosen.map((p) => ({
      building_id: id, place_id: p.id, category: p.category,
      meters: p.meters, walk_minutes: Math.max(1, Math.ceil((p.meters * DETOUR) / WALK_M_PER_MIN)), rank: p.rank,
    })),
  });
  return { saved: chosen.length };
}

module.exports = { importOneBuilding, makeRest, sleep };
