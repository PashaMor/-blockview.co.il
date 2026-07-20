/* BlockView — address lookup + real building footprints, from OpenStreetMap.
 *
 * Nominatim  : address text  -> coordinates
 * Overpass   : coordinates   -> the actual building outline (GeoJSON polygon)
 *
 * Both are free and need no key, and both are shared community services: we keep one
 * request in flight, debounce typing, cap the timeout and ALWAYS degrade
 * gracefully — Overpass in particular is known to time out or answer with an
 * HTML error page (see CLAUDE.md). A failure here must never block publishing;
 * the worst case is a building without a real outline, which an admin can fix.
 */
(function () {
  var NOMINATIM = "https://nominatim.openstreetmap.org/search";
  var OVERPASS = "https://overpass-api.de/api/interpreter";
  var TIMEOUT_MS = 8000;

  function withTimeout(url, opts, ms) {
    opts = opts || {};
    if (typeof AbortController === "function") {
      var ctl = new AbortController();
      opts.signal = ctl.signal;
      var t = setTimeout(function () { ctl.abort(); }, ms);
      return fetch(url, opts).then(
        function (r) { clearTimeout(t); return r; },
        function (e) { clearTimeout(t); throw e; }
      );
    }
    return fetch(url, opts);
  }

  /* ---- address -> candidates ---------------------------------------- */
  // Israel only, in the app's language, a handful of results.
  async function searchAddress(q) {
    q = String(q || "").trim();
    if (q.length < 3) return [];
    var lang = window.currentLang ? window.currentLang() : "he";
    var url = NOMINATIM +
      "?format=jsonv2&addressdetails=1&limit=6&countrycodes=il" +
      "&accept-language=" + encodeURIComponent(lang) +
      "&q=" + encodeURIComponent(q);
    try {
      var res = await withTimeout(url, { headers: { Accept: "application/json" } }, TIMEOUT_MS);
      if (!res.ok) return [];
      var rows = await res.json();
      if (!rows || !rows.length) return [];
      return rows.map(function (r) {
        var a = r.address || {};
        var city = a.city || a.town || a.village || a.municipality || a.suburb || "";
        var street = a.road || a.pedestrian || "";
        var num = a.house_number || "";
        return {
          label: r.display_name,
          short: (street ? street + (num ? " " + num : "") : (r.name || r.display_name.split(",")[0])),
          city: city,
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          osmId: r.osm_type && r.osm_id ? r.osm_type + "/" + r.osm_id : null,
          isBuilding: r.category === "building" || (r.type === "house" || r.type === "residential" || r.type === "apartments"),
        };
      }).filter(function (x) { return isFinite(x.lat) && isFinite(x.lng); });
    } catch (e) {
      console.warn("[BlockView] address lookup failed:", e && e.message);
      return [];
    }
  }

  /* ---- coordinates -> building outline -------------------------------- */
  // Asks Overpass for a building way/relation containing (or nearest to) the point.
  async function fetchFootprint(lat, lng) {
    var q =
      "[out:json][timeout:10];" +
      "is_in(" + lat + "," + lng + ")->.a;" +
      "way(pivot.a)[building];" +
      "out geom;" +
      "way(around:25," + lat + "," + lng + ")[building];" +
      "out geom;";
    try {
      var res = await withTimeout(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: q,
      }, TIMEOUT_MS);
      if (!res.ok) return null;
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("json") === -1) return null;      // Overpass error page
      var data = await res.json();
      var ways = (data.elements || []).filter(function (e) {
        return e.type === "way" && e.geometry && e.geometry.length > 3;
      });
      if (!ways.length) return null;

      // prefer the way that actually contains the point, else the first
      var chosen = null;
      for (var i = 0; i < ways.length && !chosen; i++) {
        if (pointInRing(lng, lat, ways[i].geometry)) chosen = ways[i];
      }
      if (!chosen) chosen = ways[0];

      var ring = chosen.geometry.map(function (p) { return [p.lon, p.lat]; });
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
      var tags = chosen.tags || {};
      return {
        osmId: "way/" + chosen.id,
        polygon: { type: "Polygon", coordinates: [ring] },
        height: heightFromTags(tags),
        center: ringCenter(ring),
      };
    } catch (e) {
      console.warn("[BlockView] footprint lookup failed:", e && e.message);
      return null;
    }
  }

  function heightFromTags(t) {
    var h = parseFloat(t.height || t["building:height"]);
    if (isFinite(h) && h > 2) return h;
    var lv = parseFloat(t["building:levels"]);
    if (isFinite(lv) && lv > 0) return Math.round(lv * 3 + 1);
    return null;                                   // let the DB default decide
  }
  function ringCenter(ring) {
    var x = 0, y = 0, n = ring.length - 1;
    for (var i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
    return n ? [x / n, y / n] : null;
  }
  function pointInRing(x, y, geom) {
    var inside = false;
    for (var i = 0, j = geom.length - 1; i < geom.length; j = i++) {
      var xi = geom[i].lon, yi = geom[i].lat, xj = geom[j].lon, yj = geom[j].lat;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  window.BVGeo = { searchAddress: searchAddress, fetchFootprint: fetchFootprint };
})();
