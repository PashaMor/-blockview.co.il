/* BlockView — fill in "what's nearby" for one building, on demand.
 *
 * The publish flow (owner form and agent CRM) calls this right after creating a
 * listing, so a building made from a typed address fills itself in the first
 * time a property is published there.
 *
 * Server-side because the browser can't: Overpass blocks cross-origin requests
 * and building_places is admin-only under RLS, so the write needs the service
 * key, which must never reach a browser.
 *
 * SECURITY
 *   - Requires a valid Supabase user token (Authorization: Bearer <access
 *     token>) so this is not an open Overpass proxy. If SUPABASE_ANON_KEY is
 *     not set the token can't be verified and every call is refused — the
 *     import simply doesn't run (publishing still succeeds); the nightly sweep
 *     (api/nearby-sweep.js) then fills the gap.
 *   - Only-if-missing: returns immediately if the building already has data.
 *   - Writes public geodata only — nothing a leak could expose.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_ANON_KEY.
 */

const { importOneBuilding, makeRest } = require("../lib/nearby");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// verify the caller is a signed-in Supabase user (any user — the write is
// idempotent public geodata, so we gate against anonymous abuse, not per-user)
async function isAuthed(req) {
  const auth = req.headers["authorization"] || "";
  if (!/^Bearer\s+/.test(auth) || !ANON_KEY) return false;
  try {
    const res = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: ANON_KEY, Authorization: auth },
    });
    return res.ok;
  } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: "not configured" }); return; }
  if (!(await isAuthed(req))) { res.status(401).json({ error: "unauthorized" }); return; }

  const body = req.body || {};
  const buildingId = String(body.building_id || "").trim();
  if (!buildingId) { res.status(400).json({ error: "building_id required" }); return; }

  try {
    const rest = makeRest(SUPABASE_URL, SERVICE_KEY);
    const rows = await rest("buildings?select=id,lng,lat&id=eq." + encodeURIComponent(buildingId));
    if (!rows || !rows.length) { res.status(404).json({ error: "building not found" }); return; }

    const result = await importOneBuilding({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY }, rows[0]);
    res.status(200).json(Object.assign({ ok: true }, result));
  } catch (err) {
    // best effort: publishing already succeeded, so a failed import must not
    // read as an error to the caller. The nightly sweep retries it.
    res.status(200).json({ ok: false, error: String((err && err.message) || err) });
  }
};
