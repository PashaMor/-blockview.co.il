/* BlockView — nightly backstop: import "what's nearby" for any building missing
 * it. Runs on Vercel Cron (see "crons" in vercel.json).
 *
 * Creation-time import (api/nearby.js) is best-effort — if Overpass is down at
 * that moment, or SUPABASE_ANON_KEY isn't set, a building can be left without
 * nearby data. This sweep catches every such building within a day, so the
 * "מה יש בסביבה" section stops silently disappearing on new listings.
 *
 * It uses the service key only (no user token), so it always works regardless
 * of the anon-key config. Serial and capped per run so Overpass is never
 * hammered; whatever it can't finish tonight it finishes tomorrow.
 *
 * SECURITY
 *   - Refuses any request without `Authorization: Bearer $CRON_SECRET`, which
 *     Vercel Cron sends automatically. Without CRON_SECRET set it refuses ALL
 *     requests — it never falls open.
 *   - Writes public geodata only; the service key lives only in Vercel's
 *     environment and is never bundled into www/.
 *
 * Env vars: CRON_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY.
 */

const { importOneBuilding, makeRest, sleep } = require("../lib/nearby");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;

const MAX_PER_RUN = 8;     // keep the run short and gentle on Overpass

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers["authorization"] || "";
  if (!secret || auth !== "Bearer " + secret) { res.status(401).json({ error: "unauthorized" }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: "not configured" }); return; }

  const rest = makeRest(SUPABASE_URL, SERVICE_KEY);
  try {
    // buildings that already have nearby data, and all buildings — the set
    // difference is what still needs importing
    const [have, all] = await Promise.all([
      rest("building_places?select=building_id"),
      rest("buildings?select=id,lng,lat"),
    ]);
    const done = new Set((have || []).map((r) => r.building_id));
    const missing = (all || []).filter((b) => !done.has(b.id) && isFinite(+b.lng) && isFinite(+b.lat));

    const out = { total_missing: missing.length, saved: 0, empty: 0, failed: 0 };
    for (let i = 0; i < missing.length && i < MAX_PER_RUN; i++) {
      try {
        // fewer attempts here than the creation path: the sweep is serial under
        // a 60s cap, and a building it can't get tonight it simply retries tomorrow
        const r = await importOneBuilding({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY }, missing[i], { attempts: 3 });
        if (r.saved) out.saved++;
        else out.empty++;               // genuinely nothing nearby — leave it
      } catch (e) {
        out.failed++;                    // Overpass hiccup — next run retries it
      }
      await sleep(1500);                 // be polite to Overpass
    }
    out.remaining = Math.max(0, missing.length - MAX_PER_RUN);
    res.status(200).json(Object.assign({ ok: true }, out));
  } catch (err) {
    res.status(200).json({ ok: false, error: String((err && err.message) || err) });
  }
};
