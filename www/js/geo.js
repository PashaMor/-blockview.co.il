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

  /* ---- address -> candidates ----------------------------------------
   * Israel only, in the app's language.
   *
   * A free-text query hands the house number to a fuzzy matcher, which often
   * answers with the middle of the street instead of the building — that is
   * why "אלנבי 19" could come back with no precise outline. Nominatim's
   * STRUCTURED query treats street and number properly, so we try that first
   * and keep free text as the fallback for anything that is not a street
   * address (a landmark, a neighbourhood, a place name).
   *
   * Results carry hasNumber/exact so the form can say plainly when a match is
   * only street-level rather than a specific building.
   */

  // "אלנבי 19, תל אביב" -> { num: "19", street: "אלנבי", city: "תל אביב" }
  function parseQuery(q) {
    var parts = q.split(",");
    var head = (parts.shift() || "").trim();
    var city = parts.join(",").trim();
    var m = head.match(/^(.*?)[\s,]+(\d+[א-ת]?)\s*$/) || head.match(/^(\d+[א-ת]?)[\s,]+(.*)$/);
    var street = head, num = "";
    if (m) {
      if (/^\d/.test(m[1])) { num = m[1]; street = m[2]; }
      else { street = m[1]; num = m[2]; }
    }
    return { street: street.trim(), num: num.trim(), city: city };
  }

  function shape(r) {
    var a = r.address || {};
    var city = a.city || a.town || a.village || a.municipality || a.suburb || "";
    var street = a.road || a.pedestrian || "";
    var num = a.house_number || "";
    return {
      label: r.display_name,
      short: (street ? street + (num ? " " + num : "") : (r.name || String(r.display_name || "").split(",")[0])),
      city: city,
      houseNumber: num,
      hasNumber: !!num,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      osmId: r.osm_type && r.osm_id ? r.osm_type + "/" + r.osm_id : null,
      isBuilding: r.category === "building" || (r.type === "house" || r.type === "residential" || r.type === "apartments"),
    };
  }

  async function nominatim(params) {
    var lang = window.currentLang ? window.currentLang() : "he";
    var url = NOMINATIM + "?format=jsonv2&addressdetails=1&limit=8&countrycodes=il" +
      "&accept-language=" + encodeURIComponent(lang) + "&" + params;
    var res = await withTimeout(url, { headers: { Accept: "application/json" } }, TIMEOUT_MS);
    if (!res.ok) return [];
    var rows = await res.json();
    return (rows || []).map(shape).filter(function (x) { return isFinite(x.lat) && isFinite(x.lng); });
  }

  async function searchAddress(q) {
    q = String(q || "").trim();
    if (q.length < 3) return [];
    var p = parseQuery(q);
    var out = [];
    try {
      // structured first, but only when it looks like a street address
      if (p.num && p.street) {
        var sp = "street=" + encodeURIComponent(p.num + " " + p.street);
        if (p.city) sp += "&city=" + encodeURIComponent(p.city);
        out = await nominatim(sp);
      }
      // free text: the only option without a number, and a top-up otherwise
      if (out.length < 3) {
        var free = await nominatim("q=" + encodeURIComponent(q));
        var seen = {};
        out.concat(free).forEach(function (r) {
          var k = r.short + "|" + r.city;
          if (!seen[k]) { seen[k] = r; }
        });
        out = Object.keys(seen).map(function (k) { return seen[k]; });
      }
      // an exact house-number hit is what we actually want; float it to the top
      out.forEach(function (r) { r.exact = !!(p.num && r.houseNumber === p.num); });
      out.sort(function (a, b) {
        return (b.exact - a.exact) || (b.hasNumber - a.hasNumber) || (b.isBuilding - a.isBuilding);
      });
      return out.slice(0, 6);
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
