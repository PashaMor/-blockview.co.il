/* BlockView — import "what's nearby" for each building from OpenStreetMap.
 *
 * Runs OUTSIDE the browser with the service key, so it bypasses RLS on purpose.
 * NEVER put the service key in www/ or commit it — keep it in .env (gitignored).
 *
 *   node scripts/nearby-import.mjs --missing        only buildings with no data
 *   node scripts/nearby-import.mjs --building b7    one building
 *   node scripts/nearby-import.mjs --all --force    everything, recompute
 *
 * Overpass is flaky: it times out and answers with HTML error pages. Every call
 * retries with backoff, verifies the content type, and a building's existing rows
 * are replaced ONLY after a successful fetch — a bad run never empties the table.
 */
import { readFileSync } from "node:fs";

/* ----------------------------------------------------------------- config */
const RADIUS_M = 1500;      // how far around the building we look
const PER_CATEGORY = 5;     // how many places to keep per category
const DETOUR = 1.3;         // streets are not straight lines
const WALK_M_PER_MIN = 80;  // ~4.8 km/h
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",   // fallback mirror
];

/* Category -> OSM selectors. Keep in sync with the check constraint in
 * supabase/12_nearby_places.sql and with the icons in www/js/app.js. */
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

/* ------------------------------------------------------------------ env */
function loadEnv() {
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env file — rely on the real environment */ }
}
loadEnv();

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_BASE || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY (put them in .env — never in www/).");
  process.exit(1);
}

/* --------------------------------------------------------------- helpers */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function haversine(lng1, lat1, lng2, lat2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* Overpass, with retries, mirrors and a content-type check (an HTML error page
   parsed as JSON is exactly how this bites you). */
async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "BlockView/1.0 (nearby import)" },
        body: query,
        signal: AbortSignal.timeout(90000),
      });
      const type = res.headers.get("content-type") || "";
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!type.includes("json")) throw new Error(`non-JSON answer (${type.split(";")[0] || "?"})`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      const wait = 5000 * (attempt + 1);
      console.warn(`   overpass attempt ${attempt + 1} failed (${e.message}) — retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function buildQuery(lng, lat) {
  const around = `(around:${RADIUS_M},${lat},${lng})`;
  const parts = [];
  for (const selectors of Object.values(CATEGORIES)) {
    for (const [sel] of selectors) parts.push(`${sel}${around};`);
  }
  return `[out:json][timeout:60];(${parts.join("")});out center tags;`;
}

function classify(tags) {
  for (const [category, selectors] of Object.entries(CATEGORIES)) {
    for (const [sel, key] of selectors) {
      const value = tags[key];
      if (!value) continue;
      const m = sel.match(/\["[a-z:]+"(?:~"\^?\(?([^"]+?)\)?\$?"|="([^"]+)")\]/);
      if (!m) continue;
      const allowed = (m[2] ? [m[2]] : m[1].replace(/[()^$]/g, "").split("|"));
      if (allowed.includes(value)) return { category, kind: value };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ main */
const argv = process.argv.slice(2);
const only = argv.includes("--building") ? argv[argv.indexOf("--building") + 1] : null;
const missingOnly = argv.includes("--missing");
const force = argv.includes("--force");

const buildings = await rest("buildings?select=id,name,lng,lat&order=id");
const existing = await rest("building_places?select=building_id");
const haveData = new Set((existing || []).map((r) => r.building_id));

let targets = buildings;
if (only) targets = buildings.filter((b) => b.id === only);
else if (missingOnly) targets = buildings.filter((b) => !haveData.has(b.id));
if (!targets.length) { console.log("Nothing to do."); process.exit(0); }

console.log(`Importing nearby places for ${targets.length} building(s), radius ${RADIUS_M}m.\n`);

for (const b of targets) {
  const label = `${b.id} (${b.name})`;
  if (haveData.has(b.id) && !force && !only) { console.log(`-  ${label}: already has data, skipping`); continue; }
  console.log(`>  ${label}`);

  let data;
  try {
    data = await overpass(buildQuery(+b.lng, +b.lat));
  } catch (e) {
    console.error(`   FAILED, existing rows left untouched: ${e.message}`);
    continue;                                  // never wipe on a failed fetch
  }

  // nearest PER_CATEGORY in each category
  const byCat = { education: [], transit: [], errands: [], leisure: [] };
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const lng = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
    if (lng == null || lat == null) continue;
    const hit = classify(tags);
    if (!hit) continue;
    const name = tags["name:he"] || tags.name || tags["name:en"];
    if (!name) continue;                       // an unnamed bench helps nobody
    const meters = Math.round(haversine(+b.lng, +b.lat, lng, lat));
    if (meters > RADIUS_M) continue;
    byCat[hit.category].push({
      id: `${el.type}/${el.id}`,
      category: hit.category,
      kind: hit.kind,
      names: {
        he: tags["name:he"] || null,
        en: tags["name:en"] || null,
        ar: tags["name:ar"] || null,
        default: tags.name || name,
      },
      lng, lat, meters,
    });
  }

  const chosen = [];
  for (const [cat, list] of Object.entries(byCat)) {
    list.sort((x, y) => x.meters - y.meters);
    list.slice(0, PER_CATEGORY).forEach((p, i) => chosen.push({ ...p, rank: i + 1 }));
    console.log(`   ${cat}: ${Math.min(list.length, PER_CATEGORY)}/${list.length}`);
  }
  if (!chosen.length) { console.log("   nothing found nearby — leaving as is"); continue; }

  // upsert the places, then replace this building's links
  await rest("places?on_conflict=id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: chosen.map(({ id, category, kind, names, lng, lat }) =>
      ({ id, category, kind, names, lng, lat, updated_at: new Date().toISOString() })),
  });
  await rest(`building_places?building_id=eq.${encodeURIComponent(b.id)}`, { method: "DELETE" });
  await rest("building_places", {
    method: "POST",
    prefer: "return=minimal",
    body: chosen.map((p) => ({
      building_id: b.id,
      place_id: p.id,
      category: p.category,
      meters: p.meters,
      walk_minutes: Math.max(1, Math.ceil((p.meters * DETOUR) / WALK_M_PER_MIN)),
      rank: p.rank,
    })),
  });
  console.log(`   saved ${chosen.length} places\n`);
  await sleep(2000);                           // be polite to Overpass
}

console.log("Done.");
