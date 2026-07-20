/* BlockView prototype — map + interaction */

const STYLES = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark:  "https://tiles.openfreemap.org/styles/dark",
};
const TLV = { center: [34.7715, 32.0632], zoom: 15.4, pitch: 58, bearing: -18 };
const BLUE = "#0038B8", BLUE_HI = "#2E5BD6", WHITE = "#FBFBFD";

let mode = "light";
try { mode = localStorage.getItem("blockview_theme") || "light"; } catch (e) {}
let selectedId = null;
const filter = {
  deal: "all", rooms: 0, floor: 0, type: "all", age: "all", city: "all",
  priceMin: 0, priceMax: 0, pets: false, parking: false, elevator: false, furnished: false,
};
const DEFAULT_CITY = "תל אביב-יפו";

/* ---- favorites (require sign-in; stored per-user in Supabase) ---- */
let favs = new Set();
const isFav = (id) => favs.has(id);
async function toggleFav(id) {
  if (!window.BVAuth || !BVAuth.isLoggedIn()) { if (window.BVAuth) BVAuth.openAuth(); return; }
  if (favs.has(id)) { favs.delete(id); syncFavUI(); await BVAuth.removeFav(id); return; }
  if (!BVAuth.canAdd("favorites", favs.size)) { BVAuth.showUpgrade("favorites"); return; }
  favs.add(id); syncFavUI();
  const err = await BVAuth.addFav(id);
  if (err) { favs.delete(id); syncFavUI(); err === "limit" ? BVAuth.showUpgrade("favorites") : toast("שגיאה, נסה שוב"); }
}
function syncFavUI() {
  const c = document.getElementById("favcount");
  if (c) c.textContent = favs.size;
  document.querySelectorAll("[data-fav]").forEach((b) => b.classList.toggle("on", isFav(b.dataset.fav)));
  const fs = document.getElementById("favs-sheet");
  if (fs && fs.classList.contains("open")) renderFavs();
}

/* ---- personal notes per property (require sign-in; stored in Supabase) ---- */
let notes = {};
const getNote = (id) => notes[id] || "";
const hasNote = (id) => !!(notes[id] && notes[id].trim());
function setNote(id, text) {
  if (text && text.trim()) notes[id] = text; else delete notes[id];
  if (window.BVAuth && BVAuth.isLoggedIn()) BVAuth.saveNote(id, text);
}

/* ---- building subscriptions (require sign-in; stored in Supabase) ---- */
let subs = new Set();
const isSub = (bid) => subs.has(bid);
async function toggleSub(bid) {
  if (!window.BVAuth || !BVAuth.isLoggedIn()) { if (window.BVAuth) BVAuth.openAuth(); return; }
  if (subs.has(bid)) { subs.delete(bid); syncSubUI(); await BVAuth.removeFollow(bid); return; }
  if (!BVAuth.canAdd("follows", subs.size)) { BVAuth.showUpgrade("follows"); return; }
  subs.add(bid); syncSubUI();
  const err = await BVAuth.addFollow(bid);
  if (err) { subs.delete(bid); syncSubUI(); err === "limit" ? BVAuth.showUpgrade("follows") : toast("שגיאה, נסה שוב"); }
}

// simulated change-feed for a building (until a backend provides real changes)
const UPDATE_KINDS = [
  { icon: "⬇️", text: "מחיר ירד ב־2.5% באחד הנכסים" },
  { icon: "🆕", text: "נכס חדש פורסם בבניין" },
  { icon: "✅", text: "נכס בבניין סומן כנמכר" },
  { icon: "✏️", text: "עודכנו פרטי נכס בבניין" },
  { icon: "📉", text: "ירידת מחיר נוספת בנכס להשכרה" },
];
const WHENS = ["היום", "אתמול", "לפני יומיים", "לפני 4 ימים", "לפני שבוע"];
function buildingUpdates(bid) {
  const h = hashHue(bid), n = 1 + (h % 3);
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = UPDATE_KINDS[(h + i) % UPDATE_KINDS.length];
    out.push({ icon: k.icon, text: k.text, when: WHENS[(h + i) % WHENS.length] });
  }
  return out;
}
function alertsCount() { return [...subs].reduce((a, bid) => a + buildingUpdates(bid).length, 0); }

function syncSubUI() {
  const c = document.getElementById("alertcount");
  if (c) c.textContent = alertsCount();
  if (selectedId) {
    const sb = document.getElementById("sub-btn");
    sb.classList.toggle("on", isSub(selectedId));
    sb.textContent = isSub(selectedId) ? "🔔 עוקב אחר הבניין" : "🔔 עקוב אחר הבניין";
  }
  const as = document.getElementById("alerts-sheet");
  if (as && as.classList.contains("open")) renderAlerts();
}

const fmtPrice = (n) => "₪" + n.toLocaleString("he-IL");

/* ---- geometry & matching ---- */
function footprint(b) {
  const x = b.lng, y = b.lat, w = b.w / 2, h = b.h / 2;
  return [[[x - w, y - h], [x + w, y - h], [x + w, y + h], [x - w, y + h], [x - w, y - h]]];
}
// derived attributes (single source of truth for filters + detail)
function attrs(l) {
  // real records carry these columns; sample data falls back to derived values
  if (l.type !== undefined) {
    return {
      elevator: !!l.elevator, parking: !!l.parking, pets: !!l.pets,
      furnished: !!l.furnished, type: l.type, age: l.age || "old",
    };
  }
  const h = hashHue(l.id);
  return {
    elevator: l.floor >= 4,
    parking: l.rooms >= 3,
    pets: h % 2 === 0,
    furnished: h % 3 !== 0,
    type: l.size >= 140 ? "house" : "flat",
    age: h % 3 === 0 ? "new" : "old",
  };
}
function cityOf(l) { var e = LISTING_INDEX[l.id]; return (e && e.building.city) || DEFAULT_CITY; }

function passes(l) {
  const a = attrs(l);
  if (filter.deal !== "all" && l.deal !== filter.deal) return false;
  if (filter.type !== "all" && a.type !== filter.type) return false;
  if (filter.age !== "all" && a.age !== filter.age) return false;
  if (filter.city !== "all" && cityOf(l) !== filter.city) return false;
  if (filter.rooms && l.rooms < filter.rooms) return false;
  if (filter.floor && l.floor < filter.floor) return false;
  if (filter.priceMin && l.price < filter.priceMin) return false;
  if (filter.priceMax && l.price > filter.priceMax) return false;
  if (filter.pets && !a.pets) return false;
  if (filter.parking && !a.parking) return false;
  if (filter.elevator && !a.elevator) return false;
  if (filter.furnished && !a.furnished) return false;
  return true;
}
function buildingMatches(id) { return (LISTINGS[id] || []).filter(passes); }

function buildingsGeoJSON() {
  return {
    type: "FeatureCollection",
    features: BUILDINGS.map((b, i) => ({
      type: "Feature", id: i,
      properties: { bid: b.id, name: b.name, height: b.height, match: buildingMatches(b.id).length,
        label: b.name + " · " + buildingMatches(b.id).length },
      geometry: { type: "Polygon", coordinates: footprint(b) },
    })),
  };
}
let idToIndex = {};
let LISTING_INDEX = {};
function indexData() {
  idToIndex = Object.fromEntries(BUILDINGS.map((b, i) => [b.id, i]));
  LISTING_INDEX = {};
  for (const bid in LISTINGS) {
    const b = BUILDINGS.find((x) => x.id === bid);
    if (!b) continue;
    LISTINGS[bid].forEach((l) => (LISTING_INDEX[l.id] = { ...l, building: b }));
  }
}
indexData();

/* ---------------------------------------------- live data (Supabase) ----
 * Buildings + APPROVED listings come from the database. The hardcoded sample
 * data in data.js is only a fallback so the map is never blank.
 * Reading approved listings is public (RLS), so no session is needed here.
 */
const BVDB = window.supabase.createClient(
  window.BLOCKVIEW_CONFIG.SUPABASE_URL,
  window.BLOCKVIEW_CONFIG.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function loadLiveData() {
  try {
    const [B, L] = await Promise.all([
      BVDB.from("buildings").select("*"),
      BVDB.from("listings").select("*, listing_photos(path,sort)").eq("status", "approved"),
    ]);
    if (B.error) throw B.error;
    if (L.error) throw L.error;
    if (!(B.data || []).length) { console.warn("[BlockView] no buildings in DB — keeping sample data"); return; }

    BUILDINGS = B.data.map((b) => ({
      id: b.id, name: b.name, address: b.address, city: b.city,
      lng: +b.lng, lat: +b.lat,
      w: +b.w || 0.00028, h: +b.h || 0.00032, height: +b.height || 24,
    }));

    // which listings have a WhatsApp-reachable contact (flag only — never the number)
    const waSet = new Set();
    try {
      const C = await BVDB.from("listing_contacts_public").select("listing_id,whatsapp");
      (C.data || []).forEach((c) => { if (c.whatsapp) waSet.add(c.listing_id); });
    } catch (e) { /* view may not exist until 12_whatsapp.sql is run */ }

    const grouped = {};
    (L.data || []).forEach((r) => {
      const photos = (r.listing_photos || [])
        .sort((a, b) => a.sort - b.sort)
        .map((p) => BVDB.storage.from("listing-photos").getPublicUrl(p.path).data.publicUrl);
      (grouped[r.building_id] = grouped[r.building_id] || []).push({
        id: r.id, deal: r.deal, price: +r.price, rooms: +r.rooms, size: +r.size, floor: +r.floor,
        title: r.title, description: r.description || "", tour: !!r.tour_url,
        type: r.type, age: r.age,
        furnished: !!r.furnished, pets: !!r.pets, parking: !!r.parking, elevator: !!r.elevator,
        hasWhatsapp: waSet.has(r.id),
        photos,
      });
    });
    LISTINGS = grouped;

    indexData();
    if (map.getSource("blockview")) map.getSource("blockview").setData(buildingsGeoJSON());
    fillCities();
    updateTotal();
    if (selectedId) {
      const b = BUILDINGS.find((x) => x.id === selectedId);
      b ? renderListings(b) : deselect();
    }
    console.log("[BlockView] live data:", BUILDINGS.length, "buildings,", (L.data || []).length, "approved listings");
  } catch (e) {
    console.warn("[BlockView] live data failed, using sample data:", e.message);
  }
}

/* ---- placeholder images ---- */
const ROOM_LABELS = ["סלון", "מטבח", "חדר שינה", "חדר רחצה", "מבט מהחלון"];
function hashHue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
function placeholder(seed, label, i) {
  const hue = (hashHue(seed) + i * 24) % 360;
  const c1 = `hsl(${hue} 32% 82%)`, c2 = `hsl(${hue} 28% 66%)`, ink = `hsl(${hue} 30% 32%)`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='560'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient></defs>
    <rect width='800' height='560' fill='url(#g)'/>
    <text x='400' y='260' font-family='Segoe UI, sans-serif' font-size='120' text-anchor='middle'>🏠</text>
    <text x='400' y='340' font-family='Segoe UI, sans-serif' font-size='38' font-weight='700' fill='${ink}' text-anchor='middle' direction='rtl'>${label}</text>
    <text x='400' y='530' font-family='Segoe UI, sans-serif' font-size='20' fill='${ink}' opacity='.6' text-anchor='middle'>BlockView · תמונה להמחשה</text>
  </svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
// real uploaded photos when the listing has them, otherwise generated placeholders
const imagesFor = (l) => (l.photos && l.photos.length)
  ? l.photos
  : ROOM_LABELS.map((lbl, i) => placeholder(l.id, lbl, i));

/* ---------------------------------------------------------------- map ---- */
maplibregl.setRTLTextPlugin("vendor/mapbox-gl-rtl-text.min.js", null, true);

const map = new maplibregl.Map({
  container: "map", style: STYLES[mode],
  center: TLV.center, zoom: TLV.zoom, pitch: TLV.pitch, bearing: TLV.bearing,
  maxPitch: 72, attributionControl: false,
});

function firstSymbolId() {
  for (const l of map.getStyle().layers) if (l.type === "symbol") return l.id;
  return undefined;
}

function addCustomLayers() {
  const before = firstSymbolId();

  // colored transit lines (below labels & buildings)
  if (!map.getSource("transit")) map.addSource("transit", { type: "geojson", data: TRANSIT_LINES });
  map.addLayer({ id: "transit-glow", type: "line", source: "transit",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 10, "line-opacity": 0.22, "line-blur": 4 } }, before);
  map.addLayer({ id: "transit-line", type: "line", source: "transit",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 3.6 } }, before);

  // all city buildings — white
  map.addLayer({ id: "city-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
    paint: { "fill-extrusion-color": WHITE,
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.92 } });

  // BlockView buildings — blue when they have listings
  if (!map.getSource("blockview")) map.addSource("blockview", { type: "geojson", data: buildingsGeoJSON() });
  map.addLayer({ id: "bv-buildings", type: "fill-extrusion", source: "blockview",
    paint: {
      "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.95,
      "fill-extrusion-color": ["case",
        ["boolean", ["feature-state", "selected"], false], BLUE_HI,
        [">", ["get", "match"], 0], BLUE, WHITE],
    } });
  map.addLayer({ id: "bv-labels", type: "symbol", source: "blockview",
    layout: { "text-field": ["get", "label"], "text-size": 12, "text-offset": [0, -0.6], "text-anchor": "bottom", "text-font": ["Noto Sans Regular"] },
    paint: labelPaint() });

  addEducationLayer();
  localizeMap();
  if (selectedId) setSelectedState(selectedId, true);
}

/* switch base-map street/place labels to the app language (falls back to Latin/local
   since the tiles only carry a few name:<lang> fields) */
function localizeMap() {
  const lang = window.currentLang ? window.currentLang() : "he";
  const nameExpr = (lang === "he" || lang === "ar")
    ? ["coalesce", ["get", "name:" + lang], ["get", "name"], ["get", "name:latin"]]
    : ["coalesce", ["get", "name:" + lang], ["get", "name:latin"], ["get", "name:en"], ["get", "name"]];
  const layers = map.getStyle().layers || [];
  for (const l of layers) {
    if (l.type === "symbol" && l.id.indexOf("bv-") !== 0 && l.layout && l.layout["text-field"]) {
      try { map.setLayoutProperty(l.id, "text-field", nameExpr); } catch (e) {}
    }
  }
}

function labelPaint() {
  return mode === "dark"
    ? { "text-color": "#DCE6FF", "text-halo-color": "#0b1220", "text-halo-width": 1.8 }
    : { "text-color": "#1B2A4A", "text-halo-color": "#ffffff", "text-halo-width": 1.8 };
}

map.on("load", () => {
  addCustomLayers();
  updateTotal();
  applyTheme(mode, false); // sync the toggle icon to the loaded theme
  loadLiveData();          // swap the sample data for real listings from Supabase
  // interactions (query-based so they survive style switches)
  map.on("mousemove", (e) => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ["bv-buildings"] });
    map.getCanvas().style.cursor = hit.length ? "pointer" : "";
  });
  map.on("click", (e) => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ["bv-buildings"] });
    if (hit.length) selectBuilding(hit[0].properties.bid);
    else deselect();
  });
});

/* ---- day / night theme (persisted per-user + on device) ---- */
function applyTheme(m, save) {
  if (!STYLES[m]) return;
  if (m !== mode) {
    mode = m;
    map.setStyle(STYLES[mode]);
    map.once("styledata", () => addCustomLayers());
  }
  const btn = document.getElementById("mode-toggle");
  if (btn) btn.textContent = mode === "light" ? "☾" : "☀";
  try { localStorage.setItem("blockview_theme", mode); } catch (e) {}
  if (save && window.BVAuth && BVAuth.isLoggedIn()) BVAuth.saveTheme(mode);
}
window.applyTheme = applyTheme;
document.getElementById("mode-toggle").addEventListener("click", () => applyTheme(mode === "light" ? "dark" : "light", true));

/* ---- 2D / 3D toggle ---- */
let is3D = true;
const viewBtn = document.getElementById("view-toggle");
function setView(threeD) {
  is3D = threeD;
  viewBtn.textContent = is3D ? "2D" : "3D";
  map.easeTo({ pitch: is3D ? TLV.pitch : 0, duration: 500 });
}
viewBtn.addEventListener("click", () => setView(!is3D));

/* ---------------------------------------------------------- selection ---- */
function setSelectedState(id, on) {
  if (id == null || idToIndex[id] === undefined || !map.getSource("blockview")) return;
  map.setFeatureState({ source: "blockview", id: idToIndex[id] }, { selected: on });
}
function selectBuilding(id) {
  if (selectedId) setSelectedState(selectedId, false);
  selectedId = id;
  setSelectedState(id, true);
  const b = BUILDINGS.find((x) => x.id === id);
  closeSheet();
  map.easeTo({ center: [b.lng, b.lat], zoom: Math.max(map.getZoom(), 16.2), duration: 700, padding: { bottom: 320 } });
  renderListings(b);
  openListings();
}
function deselect() {
  if (selectedId) setSelectedState(selectedId, false);
  selectedId = null;
  closeListings();
}

/* ------------------------------------------------------ listings sheet ---- */
function dealBadge(d) { return d === "sale" ? `<span class="badge sale">${t("for_sale")}</span>` : `<span class="badge rent">${t("for_rent")}</span>`; }
function listingCard(l) {
  const hue = l.deal === "sale" ? "#DCEEE8, #C9E4DB" : "#DEE9F6, #CFE0F1";
  const per = l.deal === "rent" ? ' <span class="per">/ לחודש</span>' : "";
  const tour = l.tour ? '<span class="badge tour">🎥</span>' : "";
  const note = hasNote(l.id) ? '<span class="badge note">📝</span>' : "";
  return `
    <article class="card" data-lid="${l.id}">
      <div class="card-thumb" style="background:linear-gradient(150deg, ${hue});">🏠
        <button class="fav-btn ${isFav(l.id) ? "on" : ""}" data-fav="${l.id}" aria-label="שמור למועדפים">♥</button>
        <div class="card-badges">${note}${tour}${dealBadge(l.deal)}</div>
      </div>
      <div class="card-body">
        <div class="card-price">${fmtPrice(l.price)}${per}</div>
        <div class="card-title">${l.title}</div>
        <div class="card-specs"><span><span class="ic">🚪</span>${l.rooms}</span><span><span class="ic">📐</span>${l.size} מ"ר</span><span><span class="ic">🏢</span>ק' ${l.floor}</span></div>
      </div>
    </article>`;
}
function renderListings(b) {
  document.getElementById("b-name").textContent = b.name;
  document.getElementById("b-address").textContent = b.address;
  const m = buildingMatches(b.id);
  const sale = m.filter((l) => l.deal === "sale").length, rent = m.filter((l) => l.deal === "rent").length;
  document.getElementById("b-stats").innerHTML =
    `<span class="stat-chip"><b>${m.length}</b> ${t("properties")}</span>` +
    (sale ? `<span class="stat-chip sale"><b>${sale}</b> ${t("for_sale")}</span>` : "") +
    (rent ? `<span class="stat-chip rent"><b>${rent}</b> ${t("for_rent")}</span>` : "");
  const list = document.getElementById("listings"), noMatch = document.getElementById("no-match");
  if (m.length) { list.innerHTML = m.map(listingCard).join(""); noMatch.hidden = true; }
  else { list.innerHTML = ""; noMatch.hidden = false; }
  const sb = document.getElementById("sub-btn");
  sb.classList.toggle("on", isSub(b.id));
  sb.textContent = isSub(b.id) ? t("following") : t("follow");
}

const listingsSheet = document.getElementById("listings-sheet");
function closeAuthUI() { if (window.closeAuthSheets) window.closeAuthSheets(); }
function openListings() { closeFavs(); closeAlerts(); closeSearch(); closeAuthUI(); listingsSheet.classList.add("open"); listingsSheet.setAttribute("aria-hidden", "false"); }
function closeListings() { listingsSheet.classList.remove("open"); listingsSheet.setAttribute("aria-hidden", "true"); }
document.getElementById("ls-close").addEventListener("click", deselect);

// shared card-click handler: heart toggles favorite, card opens detail
function onCardClick(e) {
  const favBtn = e.target.closest(".fav-btn");
  if (favBtn) { e.stopPropagation(); toggleFav(favBtn.dataset.fav); return; }
  const card = e.target.closest(".card");
  if (card) openDetail(card.dataset.lid);
}
document.getElementById("listings").addEventListener("click", onCardClick);

/* ---- favorites sheet ---- */
const favsSheet = document.getElementById("favs-sheet");
function renderFavs() {
  const items = [...favs].map((id) => LISTING_INDEX[id]).filter(Boolean);
  const list = document.getElementById("favs-list"), empty = document.getElementById("favs-empty");
  if (items.length) { list.innerHTML = items.map(listingCard).join(""); empty.hidden = true; }
  else { list.innerHTML = ""; empty.hidden = false; }
}
function openFavs() { closeSheet(); closeListings(); closeAlerts(); closeSearch(); closeAuthUI(); renderFavs(); favsSheet.classList.add("open"); favsSheet.setAttribute("aria-hidden", "false"); }
function closeFavs() { favsSheet.classList.remove("open"); favsSheet.setAttribute("aria-hidden", "true"); }
document.getElementById("open-favs").addEventListener("click", openFavs);
document.getElementById("favs-close").addEventListener("click", closeFavs);
document.getElementById("favs-list").addEventListener("click", onCardClick);

/* ---- subscriptions / alerts sheet ---- */
const alertsSheet = document.getElementById("alerts-sheet");
function renderAlerts() {
  const ids = [...subs].filter((bid) => BUILDINGS.some((b) => b.id === bid));
  const list = document.getElementById("alerts-list"), empty = document.getElementById("alerts-empty");
  if (!ids.length) { list.innerHTML = ""; empty.hidden = false; return; }
  empty.hidden = true;
  list.innerHTML = ids.map((bid) => {
    const b = BUILDINGS.find((x) => x.id === bid);
    const rows = buildingUpdates(bid).map((u) =>
      `<div class="alert-row"><span class="ar-ic">${u.icon}</span><span class="ar-tx">${u.text}</span><span class="ar-when">${u.when}</span></div>`).join("");
    return `<div class="alert-group">
      <div class="alert-head"><b>${b.name}</b><button class="alert-unsub" data-unsub="${bid}">ביטול מעקב</button></div>
      ${rows}
      <button class="alert-open" data-open="${bid}">צפייה בבניין ←</button>
    </div>`;
  }).join("");
}
function openAlerts() { closeSheet(); closeListings(); closeFavs(); closeSearch(); closeAuthUI(); renderAlerts(); alertsSheet.classList.add("open"); alertsSheet.setAttribute("aria-hidden", "false"); }
function closeAlerts() { alertsSheet.classList.remove("open"); alertsSheet.setAttribute("aria-hidden", "true"); }
document.getElementById("open-alerts").addEventListener("click", openAlerts);
document.getElementById("alerts-close").addEventListener("click", closeAlerts);
document.getElementById("alerts-list").addEventListener("click", (e) => {
  const un = e.target.closest("[data-unsub]");
  if (un) { toggleSub(un.dataset.unsub); return; }
  const op = e.target.closest("[data-open]");
  if (op) { closeAlerts(); selectBuilding(op.dataset.open); }
});
document.getElementById("sub-btn").addEventListener("click", () => { if (selectedId) toggleSub(selectedId); });

/* ---- search (address / building / transit) ---- */
const searchSheet = document.getElementById("search-sheet");
function firstCoord(g) { return g.type === "MultiLineString" ? g.coordinates[0][0] : g.coordinates[0]; }
function searchItems(q) {
  q = q.trim().toLowerCase();
  const res = [];
  BUILDINGS.forEach((b) => {
    if (!q || (b.name + " " + b.address).toLowerCase().includes(q))
      res.push({ kind: "building", id: b.id, icon: "🏢", title: b.name, sub: b.address });
  });
  if (q) TRANSIT_LINES.features.forEach((f) => {
    if (f.properties.name.toLowerCase().includes(q))
      res.push({ kind: "line", icon: "🚈", title: f.properties.name, sub: "קו תחבורה", coord: firstCoord(f.geometry) });
  });
  return res.slice(0, 40);
}
function renderSearch(q) {
  const items = searchItems(q);
  const box = document.getElementById("search-results");
  box._items = items;
  box.innerHTML = items.length
    ? items.map((it, i) => `<div class="sr-item" data-i="${i}"><div class="sr-ic">${it.icon}</div><div class="sr-tx"><b>${it.title}</b><small>${it.sub}</small></div></div>`).join("")
    : `<div class="sr-empty">לא נמצאו תוצאות</div>`;
}
function openSearch() {
  closeSheet(); closeListings(); closeFavs(); closeAlerts(); closeAuthUI();
  renderSearch(document.getElementById("search-input").value);
  searchSheet.classList.add("open"); searchSheet.setAttribute("aria-hidden", "false");
  setTimeout(() => document.getElementById("search-input").focus(), 250);
}
function closeSearch() { searchSheet.classList.remove("open"); searchSheet.setAttribute("aria-hidden", "true"); }
document.getElementById("open-search").addEventListener("click", openSearch);
document.getElementById("search-close").addEventListener("click", closeSearch);
document.getElementById("search-input").addEventListener("input", (e) => renderSearch(e.target.value));
document.getElementById("search-results").addEventListener("click", (e) => {
  const row = e.target.closest(".sr-item"); if (!row) return;
  const it = document.getElementById("search-results")._items[+row.dataset.i];
  closeSearch();
  if (it.kind === "building") selectBuilding(it.id);
  else map.flyTo({ center: it.coord, zoom: 14.5, duration: 900 });
});

/* --------------------------------------------------------- full detail ---- */
const AGENT = { name: "ענבל לוי", office: "BlockView נדל\"ן", phone: "050-000-0000", email: "demo@blockview.co.il" };

/* Contact details follow the same rule as the database (supabase/10_listing_contacts.sql):
 * a guest sees a masked phone/email, a signed-in user sees them in full. The masks
 * here are only for display — the real values are withheld by RLS, not by this code. */
function maskPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length < 6) return "•".repeat(Math.max(d.length, 4));
  return d.slice(0, 3) + "•".repeat(d.length - 5) + d.slice(-2);
}
function maskEmail(e) {
  const at = String(e || "").indexOf("@");
  if (at < 1) return "";
  return e.slice(0, 2) + "•••@" + e.slice(at + 1);
}
const signedIn = () => !!(window.BVAuth && BVAuth.isLoggedIn());
function contactBlock() {
  if (signedIn())
    return `<a class="btn-primary" href="tel:${AGENT.phone}">📞 <bdi class="ltr">${AGENT.phone}</bdi></a>` +
           `<a class="btn-ghost" href="mailto:${AGENT.email}">✉ <bdi class="ltr">${AGENT.email}</bdi></a>`;
  return `<button class="btn-primary locked" id="reveal-contact">📞 <bdi class="ltr">${maskPhone(AGENT.phone)}</bdi> · ${t("show_contact")}</button>`;
}
function specRows(l) {
  const a = attrs(l);
  return [
    ["סוג עסקה", l.deal === "sale" ? "למכירה" : "להשכרה"],
    ["סוג נכס", a.type === "house" ? "בית" : "דירה"],
    ["חדרים", l.rooms], ['שטח (מ"ר)', l.size], ["קומה", l.floor],
    ["מעלית", a.elevator ? "יש" : "אין"], ["חניה", a.parking ? "יש" : "אין"],
    ["ריהוט", a.furnished ? "מרוהט" : "לא מרוהט"], ["חיות מחמד", a.pets ? "מותר" : "לא"],
    ["גיל בניין", a.age === "new" ? "חדש" : "ישן"], ["מצב", "משופצת"],
  ];
}
function descFor(l) {
  return [`דירת ${l.rooms} חדרים בשטח ${l.size} מ"ר בקומה ${l.floor}.`, "מרווחת, מוארת ומאווררת עם כיווני אוויר טובים.",
    "קרובה לתחבורה ציבורית, בתי קפה ומרכזי קניות.", l.tour ? "כולל סיור וירטואלי תלת-מימדי." : "ניתן לתאם ביקור בתיאום מראש."];
}
function openDetail(lid) {
  const l = LISTING_INDEX[lid]; if (!l) return;
  const imgs = imagesFor(l);
  const per = l.deal === "rent" ? ' <span class="per">/ לחודש</span>' : "";
  const badge = dealBadge(l.deal);
  const el = document.getElementById("detail");
  el.innerHTML = `
    <div class="detail-card" role="dialog" aria-modal="true">
      <button id="detail-close" aria-label="חזרה">→ חזרה</button>
      <div class="gallery">
        <img id="hero" src="${imgs[0]}" alt="${l.title}" />
        <div class="thumbs">${imgs.map((s, i) => `<img class="thumb${i === 0 ? " on" : ""}" data-i="${i}" src="${s}" alt="" />`).join("")}</div>
      </div>
      <div class="detail-body">
        <div class="detail-head">
          <div>
            <div class="badges-row">${badge}${l.tour ? '<span class="badge tour">🎥 סיור תלת-מימד</span>' : ""}</div>
            <h2>${l.title}</h2><div class="d-address">${l.building.address}</div>
          </div>
          <div class="d-price">${fmtPrice(l.price)}${per}</div>
        </div>
        <div class="spec-grid">${specRows(l).map(([k, v]) => `<div class="spec"><span class="sk">${k}</span><span class="sv">${v}</span></div>`).join("")}</div>
        <h3 class="d-sec">${t("descr")}</h3>
        <ul class="d-desc">${descFor(l).map((d) => `<li>${d}</li>`).join("")}</ul>
        <div id="nearby-box"></div>
        <h3 class="d-sec">${t("my_note")}</h3>
        <textarea id="note-input" class="note-input" placeholder="${t("note_ph")}"></textarea>
        <div class="note-saved" id="note-saved" hidden>נשמר ✓</div>
        <div class="contact">
          <div class="agent"><div class="agent-av">${AGENT.name.charAt(0)}</div><div><div class="agent-name">${AGENT.name}</div><div class="agent-office">${AGENT.office}</div></div></div>
          <div class="contact-btns">${contactBlock()}<button class="btn-ghost fav-toggle ${isFav(l.id) ? "on" : ""}" data-fav="${l.id}">${t("save")}</button>${l.hasWhatsapp ? `<button class="btn-wa" data-wa="${l.id}">${t("wa_contact")}</button>` : ""}<button class="btn-ghost" data-share="${l.id}">${t("share")}</button></div>
          ${signedIn() ? "" : `<p class="contact-hint">${t("contact_locked")}</p>`}
        </div>
        <p class="disclaimer">נתונים לדוגמה — אב-טיפוס BlockView. התמונות להמחשה בלבד.</p>
      </div>
    </div>`;
  el.hidden = false;
  renderNearby(l.building.id);
  const reveal = el.querySelector("#reveal-contact");
  if (reveal) reveal.onclick = (ev) => { ev.stopPropagation(); if (window.BVAuth) BVAuth.openAuth(); };
  el.querySelectorAll("[data-fav]").forEach((b) => (b.onclick = (ev) => {
    ev.stopPropagation(); toggleFav(b.dataset.fav); b.classList.toggle("on", isFav(b.dataset.fav));
  }));
  el.querySelectorAll("[data-share]").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); shareListing(b.dataset.share); }));
  const ta = el.querySelector("#note-input");
  if (window.BVAuth && BVAuth.isLoggedIn()) {
    ta.value = getNote(l.id);
    ta.addEventListener("input", () => {
      notes[l.id] = ta.value;
      const s = el.querySelector("#note-saved"); s.hidden = false;
      clearTimeout(ta._t); ta._t = setTimeout(() => { setNote(l.id, ta.value); s.hidden = true; }, 800);
    });
  } else {
    ta.placeholder = "התחבר כדי להוסיף הערה אישית"; ta.readOnly = true; ta.style.cursor = "pointer";
    ta.addEventListener("focus", () => { ta.blur(); if (window.BVAuth) BVAuth.openAuth(); });
  }
  el.querySelector("#detail-close").onclick = closeDetail;
  el.onclick = (e) => { if (e.target === el) closeDetail(); };
  const hero = el.querySelector("#hero");
  el.querySelectorAll(".thumb").forEach((t) => {
    t.onclick = () => { hero.src = imgs[+t.dataset.i]; el.querySelectorAll(".thumb").forEach((x) => x.classList.remove("on")); t.classList.add("on"); };
  });
}
function closeDetail() { const el = document.getElementById("detail"); el.hidden = true; el.innerHTML = ""; }

/* ------------------------------------------------------ what's nearby ----
 * Places around the building with an estimated walking time. Everything is
 * precomputed in the DB (supabase/12_nearby_places.sql + scripts/nearby-import.mjs),
 * so this is one indexed read and no third-party call at runtime — it behaves
 * identically on the website and inside the app.
 */
const NEARBY_CATS = [
  { key: "education", icon: "🎒" },
  { key: "transit",   icon: "🚌" },
  { key: "errands",   icon: "🛒" },
  { key: "leisure",   icon: "🌳" },
];
const KIND_ICONS = {
  kindergarten: "🧸", school: "🎒",
  bus_stop: "🚌", tram_stop: "🚊", station: "🚉", halt: "🚉",
  supermarket: "🛒", convenience: "🏪", pharmacy: "💊", clinic: "🩺", doctors: "🩺", bank: "🏦",
  park: "🌳", playground: "🛝", fitness_centre: "🏋️", cafe: "☕",
};
const nearbyCache = {};

// place names come from OpenStreetMap, i.e. text we did not write — escape it
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function placeName(p) {
  const lang = window.currentLang ? window.currentLang() : "he";
  const n = p.names || {};
  return n[lang] || n.default || n.he || n.en || "";
}
function fmtDistance(m) {
  if (m < 100) return t("under_100m");
  if (m < 1000) return m + " " + t("meters");
  return (m / 1000).toFixed(1) + " " + t("km");
}

async function loadNearby(bid) {
  if (nearbyCache[bid]) return nearbyCache[bid];
  try {
    const { data, error } = await BVDB
      .from("building_places")
      .select("category, meters, walk_minutes, rank, places(kind, names)")
      .eq("building_id", bid)
      .order("rank");
    if (error) throw error;
    nearbyCache[bid] = data || [];
  } catch (e) {
    console.warn("[BlockView] nearby load failed:", e.message);
    nearbyCache[bid] = [];
  }
  return nearbyCache[bid];
}

async function renderNearby(bid) {
  const box = document.getElementById("nearby-box");
  if (!box) return;
  const rows = await loadNearby(bid);
  if (!rows.length) return;                       // no data -> no empty section
  if (!document.getElementById("nearby-box")) return;  // detail closed meanwhile

  const byCat = {};
  rows.forEach((r) => {
    const p = r.places || {};
    (byCat[r.category] = byCat[r.category] || []).push({
      name: placeName(p), kind: p.kind, meters: r.meters, minutes: r.walk_minutes,
    });
  });

  const cats = NEARBY_CATS.filter((c) => (byCat[c.key] || []).length);
  const summary = cats.map((c) => {
    const best = byCat[c.key][0];
    return `<span class="nb-chip">${c.icon} ${best.minutes} ${t("min_short")}</span>`;
  }).join("");

  const groups = cats.map((c) => {
    const list = byCat[c.key];
    const items = list.map((p, i) => `
      <li class="nb-item${i >= 3 ? " extra" : ""}">
        <span class="nb-ic">${KIND_ICONS[p.kind] || c.icon}</span>
        <span class="nb-name">${escapeHtml(p.name)}</span>
        <span class="nb-dist">${fmtDistance(p.meters)} · ≈ ${p.minutes} ${t("walk_min")}</span>
      </li>`).join("");
    const more = list.length > 3
      ? `<button class="nb-more" data-cat="${c.key}">${t("show_more")}</button>` : "";
    return `<div class="nb-group" data-group="${c.key}">
      <div class="nb-head">${c.icon} ${t("cat_" + c.key)}</div>
      <ul class="nb-list">${items}</ul>${more}
    </div>`;
  }).join("");

  document.getElementById("nearby-box").innerHTML =
    `<h3 class="d-sec">${t("nearby")}</h3>
     <div class="nb-summary">${summary}</div>
     <div class="nb-groups">${groups}</div>
     <p class="nb-note">${t("nearby_note")}</p>`;

  document.querySelectorAll(".nb-more").forEach((b) => (b.onclick = (ev) => {
    ev.stopPropagation();
    const g = document.querySelector(`.nb-group[data-group="${b.dataset.cat}"]`);
    g.classList.add("open");
    b.remove();
  }));
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDetail(); closeSheet(); closeSearch(); } });

/* -------------------------------------------------------- filter wiring ---- */
function refreshBuildings() {
  if (map.getSource("blockview")) {
    map.getSource("blockview").setData(buildingsGeoJSON());
    if (selectedId) setSelectedState(selectedId, true);
  }
  updateTotal();
  if (selectedId) renderListings(BUILDINGS.find((x) => x.id === selectedId));
}
function updateTotal() {
  let n = 0; for (const id in LISTINGS) n += buildingMatches(id).length;
  document.getElementById("fcount").textContent = n;
  document.getElementById("apply-count").textContent = n;
}
document.querySelectorAll("#deal-seg .seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#deal-seg .seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active"); filter.deal = btn.dataset.deal; setupPriceSlider(); refreshBuildings();
  });
});
document.querySelectorAll("#rooms-chips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#rooms-chips .chip").forEach((c) => c.classList.remove("on"));
    chip.classList.add("on"); filter.rooms = parseInt(chip.dataset.r, 10); refreshBuildings();
  });
});
document.getElementById("floor-min").addEventListener("input", (e) => {
  filter.floor = parseInt(e.target.value, 10) || 0; refreshBuildings();
});
// property type & building age (segmented)
[["type-seg", "type"], ["age-seg", "age"]].forEach(([id, key]) => {
  document.querySelectorAll(`#${id} .seg-btn`).forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(`#${id} .seg-btn`).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active"); filter[key] = btn.dataset[key]; refreshBuildings();
    });
  });
});
// amenities (multi-toggle)
document.querySelectorAll("#amenities .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    chip.classList.toggle("on"); filter[chip.dataset.amen] = chip.classList.contains("on"); refreshBuildings();
  });
});
// price range (dual-handle slider; scale adapts to deal type)
const psMin = document.getElementById("price-min"), psMax = document.getElementById("price-max"), psFill = document.getElementById("ps-fill");
const priceMaxCfg = () => (filter.deal === "rent" ? 20000 : 8000000);
const priceStepCfg = () => (filter.deal === "rent" ? 500 : 50000);
function updatePriceUI() {
  const mx = +psMax.max, lo = +psMin.value, hi = +psMax.value;
  psFill.style.left = (lo / mx * 100) + "%";
  psFill.style.width = ((hi - lo) / mx * 100) + "%";
  document.getElementById("ps-min-lbl").textContent = lo > 0 ? fmtPrice(lo) : "₪0";
  document.getElementById("ps-max-lbl").textContent = hi >= mx ? t("no_limit") : fmtPrice(hi);
}
function onPriceInput(which) {
  let lo = +psMin.value, hi = +psMax.value;
  if (lo > hi) { if (which === "min") { psMin.value = hi; lo = hi; } else { psMax.value = lo; hi = lo; } }
  filter.priceMin = lo > 0 ? lo : 0;
  filter.priceMax = hi >= (+psMax.max) ? 0 : hi;
  updatePriceUI(); refreshBuildings();
}
function setupPriceSlider() {
  const mx = priceMaxCfg(), st = priceStepCfg();
  [psMin, psMax].forEach((i) => { i.max = mx; i.step = st; });
  psMin.value = 0; psMax.value = mx;
  filter.priceMin = 0; filter.priceMax = 0;
  updatePriceUI();
}
psMin.addEventListener("input", () => onPriceInput("min"));
psMax.addEventListener("input", () => onPriceInput("max"));
setupPriceSlider();
// city
function fillCities() {
  const cities = [...new Set(BUILDINGS.map((b) => b.city || DEFAULT_CITY))];
  const sel = document.getElementById("city-select");
  const keep = sel.value;
  sel.innerHTML = `<option value="all">${t("all_cities")}</option>` + cities.map((c) => `<option value="${c}">${c}</option>`).join("");
  if (keep) sel.value = keep;
}
fillCities();
document.getElementById("city-select")
  .addEventListener("change", (e) => { filter.city = e.target.value; refreshBuildings(); });

/* ---- saved filter preset (per-user default) ---- */
let savedFilter = null;
function setSeg(id, key, val) {
  document.querySelectorAll(`#${id} .seg-btn`).forEach((b) => b.classList.toggle("active", b.dataset[key] === val));
}
function setChip(id, key, val) {
  document.querySelectorAll(`#${id} .chip`).forEach((c) => c.classList.toggle("on", c.dataset[key] === val));
}
function applyFilter(obj) {
  if (!obj) return;
  Object.assign(filter, obj);
  setSeg("deal-seg", "deal", filter.deal);
  setSeg("type-seg", "type", filter.type);
  setSeg("age-seg", "age", filter.age);
  setChip("rooms-chips", "r", String(filter.rooms || 0));
  document.getElementById("floor-min").value = filter.floor || "";
  const psMinEl = document.getElementById("price-min"), psMaxEl = document.getElementById("price-max");
  const mx = filter.deal === "rent" ? 20000 : 8000000, st = filter.deal === "rent" ? 500 : 50000;
  [psMinEl, psMaxEl].forEach((i) => { i.max = mx; i.step = st; });
  psMinEl.value = filter.priceMin > 0 ? filter.priceMin : 0;
  psMaxEl.value = filter.priceMax > 0 ? filter.priceMax : mx;
  updatePriceUI();
  ["furnished", "pets", "parking", "elevator"].forEach((a) => {
    const chip = document.querySelector(`#amenities .chip[data-amen="${a}"]`);
    if (chip) chip.classList.toggle("on", !!filter[a]);
  });
  const cs = document.getElementById("city-select"); if (cs) cs.value = filter.city || "all";
  refreshBuildings();
}
function filterSummary(f) {
  const p = [];
  if (f.deal === "sale") p.push("מכירה"); else if (f.deal === "rent") p.push("השכרה");
  if (f.type === "flat") p.push("דירה"); else if (f.type === "house") p.push("בית");
  if (f.rooms) p.push(f.rooms + "+ חד'");
  if (f.floor) p.push("קומה " + f.floor + "+");
  if (f.priceMin) p.push("מ־" + fmtPrice(f.priceMin));
  if (f.priceMax) p.push("עד " + fmtPrice(f.priceMax));
  if (f.age === "new") p.push("חדש"); else if (f.age === "old") p.push("ישן");
  if (f.city && f.city !== "all") p.push(f.city);
  if (f.furnished) p.push("מרוהט");
  if (f.pets) p.push("חיות מחמד");
  if (f.parking) p.push("חניה");
  if (f.elevator) p.push("מעלית");
  return p.length ? p.join(" · ") : "הכל";
}
function updateSavedFilterRow() {
  const row = document.getElementById("acc-filter-row"), sum = document.getElementById("acc-filter-summary");
  if (savedFilter) { sum.textContent = filterSummary(savedFilter); row.hidden = false; }
  else row.hidden = true;
}
window.onSavedFilter = function (obj) { savedFilter = obj; updateSavedFilterRow(); if (obj) applyFilter(obj); };
document.getElementById("save-filter").addEventListener("click", async () => {
  if (!window.BVAuth || !BVAuth.isLoggedIn()) { if (window.BVAuth) BVAuth.openAuth(); return; }
  savedFilter = { ...filter };
  await BVAuth.saveFilter(savedFilter);
  updateSavedFilterRow();
  toast("הסינון נשמר לפרופיל");
});
document.getElementById("acc-filter-clear").addEventListener("click", async () => {
  savedFilter = null;
  if (window.BVAuth) await BVAuth.clearFilter();
  updateSavedFilterRow();
  toast("הסינון השמור נמחק");
});

document.getElementById("reset-view").addEventListener("click", () => {
  deselect(); is3D = true; viewBtn.textContent = "2D"; map.easeTo({ ...TLV, duration: 900 });
});

/* ---- filter sheet ---- */
const sheet = document.getElementById("filter-sheet"), backdrop = document.getElementById("sheet-backdrop");
function openSheet() { closeListings(); closeFavs(); closeAlerts(); closeSearch(); closeAuthUI(); sheet.classList.add("open"); sheet.setAttribute("aria-hidden", "false"); backdrop.hidden = false; }
function closeSheet() { sheet.classList.remove("open"); sheet.setAttribute("aria-hidden", "true"); backdrop.hidden = true; }
document.getElementById("open-filters").addEventListener("click", openSheet);
document.getElementById("close-filters").addEventListener("click", closeSheet);
document.getElementById("apply-filters").addEventListener("click", closeSheet);
backdrop.addEventListener("click", () => { closeSheet(); if (window.closeAuthSheets) window.closeAuthSheets(); });

syncFavUI(); // initialise favorites count on load
syncSubUI(); // initialise alerts count on load

/* ---- hooks used by auth.js (loaded after this file) ---- */
window.onUserData = function (favIds, subIds, notesObj, plan) {
  favs = new Set(favIds); subs = new Set(subIds); notes = notesObj || {}; window.userPlan = plan;
  syncFavUI(); syncSubUI();
  if (selectedId) renderListings(BUILDINGS.find((b) => b.id === selectedId));
};
window.favCount = () => favs.size;
window.subCount = () => subs.size;
window.bvToast = (m) => toast(m);
// closeDetail too: the detail card sits above the sheets, so an auth sheet opened
// from inside it (contact / note / save) would otherwise appear behind it
window.closeAllSheets = function () { closeDetail(); closeSheet(); closeListings(); closeFavs(); closeAlerts(); closeSearch(); };
window.reRender = function () {
  updateTotal();
  if (typeof updatePriceUI === "function") updatePriceUI();
  const cs = document.getElementById("city-select");
  if (cs && cs.options.length) cs.options[0].textContent = t("all_cities");
  if (selectedId) renderListings(BUILDINGS.find((b) => b.id === selectedId));
  if (favsSheet.classList.contains("open")) renderFavs();
  if (alertsSheet.classList.contains("open")) renderAlerts();
  updateSavedFilterRow();
  try { if (map && map.isStyleLoaded()) localizeMap(); } catch (e) {}
  if (window.reRenderAuth) window.reRenderAuth();
  if (window.renderAccountIfOpen) window.renderAccountIfOpen();
};

/* ---- share + app-download prompt ---- */
let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
async function shareListing(id) {
  const l = LISTING_INDEX[id]; if (!l) return;
  const url = location.origin + location.pathname + "?listing=" + encodeURIComponent(id);
  const data = { title: "BlockView", text: `${l.title} — ${l.building.address}`, url };
  if (navigator.share) { try { await navigator.share(data); } catch (e) {} return; }
  try { await navigator.clipboard.writeText(url); toast("הקישור הועתק ✓"); } catch (e) { toast(url); }
}
let pendingListing = null;
function showDownload(lid) {
  pendingListing = lid;
  const l = LISTING_INDEX[lid];
  if (l) document.getElementById("dl-sub").textContent = `${l.title} — ${l.building.address}`;
  document.getElementById("dl-modal").hidden = false;
}
document.getElementById("dl-continue").addEventListener("click", () => {
  document.getElementById("dl-modal").hidden = true;
  if (pendingListing && LISTING_INDEX[pendingListing]) {
    const l = LISTING_INDEX[pendingListing];
    selectBuilding(l.building.id); openDetail(pendingListing);
  }
  pendingListing = null;
});
document.querySelectorAll(".dl-store").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); toast("האפליקציה תהיה זמינה בקרוב"); }));
(function initDeepLink() {
  const lid = new URLSearchParams(location.search).get("listing");
  if (lid && LISTING_INDEX[lid]) showDownload(lid);
})();

/* ---- legal links (terms / privacy) ----
   In the native app there is no browser plugin, so target="_blank" is a dead tap.
   Inside the app we navigate in the same WebView; the legal page's "back to site"
   link brings the user back to the map. */
(function initLegalLinks() {
  const isNativeApp = !!window.Capacitor || /BlockViewApp/i.test(navigator.userAgent);
  if (!isNativeApp) return;
  document.querySelectorAll('.legal-consent a[target="_blank"]').forEach((a) => {
    a.removeAttribute("target");
  });
})();

/* ---- zoom buttons (left middle) ---- */
(function () {
  const zi = document.getElementById("zoom-in"), zo = document.getElementById("zoom-out");
  if (zi) zi.addEventListener("click", () => map.easeTo({ zoom: map.getZoom() + 1, duration: 300 }));
  if (zo) zo.addEventListener("click", () => map.easeTo({ zoom: map.getZoom() - 1, duration: 300 }));
})();

/* ---------------------------------------- education POIs on the map ----
 * Kindergartens, schools and colleges/universities straight from the map
 * tiles (OpenMapTiles `poi` layer). Icons are drawn on a canvas so we don't
 * depend on the base style's sprite. Re-added on every style switch.
 */
const EDU_KINDS = [
  { key: "kg",      img: "bv-edu-kg",      emoji: "🧸", color: "#E08A2E", match: ["kindergarten"] },
  { key: "school",  img: "bv-edu-school",  emoji: "🎒", color: "#2C8874", match: ["school"] },
  { key: "college", img: "bv-edu-college", emoji: "🎓", color: "#6B4FD8", match: ["college"] },
  { key: "uni",     img: "bv-edu-uni",     emoji: "🏛️", color: "#B3261E", match: ["university"] },
  { key: "bank",    img: "bv-poi-bank",    emoji: "🏦", color: "#1F6FB2", match: ["bank"] },
  { key: "market",  img: "bv-poi-market",  emoji: "🛒", color: "#C2410C", match: ["supermarket", "grocery", "convenience"] },
  { key: "clinic",  img: "bv-poi-clinic",  emoji: "🏥", color: "#0E9AA7", match: ["clinic", "doctors", "health_post"] },
];
let eduVisible = true;
try { eduVisible = localStorage.getItem("blockview_edu") !== "0"; } catch (e) {}
let poiOn = {};
try { poiOn = JSON.parse(localStorage.getItem("blockview_poi") || "{}"); } catch (e) { poiOn = {}; }

function eduIcon(emoji, color) {
  const s = 48, c = document.createElement("canvas");
  c.width = c.height = s;
  const x = c.getContext("2d");
  x.beginPath(); x.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  x.fillStyle = "#fff"; x.fill();
  x.lineWidth = 3.5; x.strokeStyle = color; x.stroke();
  x.font = '22px "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif';
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(emoji, s / 2, s / 2 + 1);
  return x.getImageData(0, 0, s, s);
}

function addEducationLayer() {
  try {
    if (!map.getSource("openmaptiles")) return;      // base style not ready
    EDU_KINDS.forEach((k) => {
      if (!map.hasImage(k.img)) map.addImage(k.img, eduIcon(k.emoji, k.color), { pixelRatio: 2 });
    });
    if (map.getLayer("poi-edu")) map.removeLayer("poi-edu");
    const all = EDU_KINDS.filter((k) => poiOn[k.key] !== false).flatMap((k) => k.match);
    map.addLayer({
      id: "poi-edu",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: 13,
      filter: ["in", ["get", "subclass"], ["literal", all]],
      layout: {
        "visibility": eduVisible ? "visible" : "none",
        "icon-image": ["match", ["get", "subclass"],
          "kindergarten", "bv-edu-kg",
          "school", "bv-edu-school",
          "university", "bv-edu-uni",
          "college", "bv-edu-college",
          "bank", "bv-poi-bank",
          ["supermarket", "grocery", "convenience"], "bv-poi-market",
          ["clinic", "doctors", "health_post"], "bv-poi-clinic",
          "bv-edu-college"],
        "icon-size": 0.85,
        "icon-allow-overlap": false,
        "text-field": ["coalesce", ["get", "name:" + (window.currentLang ? window.currentLang() : "he")], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-optional": true,
        "symbol-sort-key": 1,
      },
      paint: {
        "text-color": mode === "dark" ? "#E7ECF5" : "#2B3A55",
        "text-halo-color": mode === "dark" ? "#0b1220" : "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  } catch (e) { console.warn("[BlockView] education layer:", e.message); }
}

/* toggle button + per-category panel */
(function () {
  const btn = document.getElementById("edu-toggle");
  const panel = document.getElementById("poi-panel");
  if (!btn) return;

  const paintBtn = () => {
    btn.classList.toggle("on", eduVisible);
    btn.title = eduVisible ? "מה יש בסביבה (מוצג)" : "מה יש בסביבה (מוסתר)";
  };
  const savePoi = () => { try { localStorage.setItem("blockview_poi", JSON.stringify(poiOn)); } catch (e) {} };

  // restore checkbox state
  document.querySelectorAll("#poi-panel [data-poi]").forEach((cb) => {
    if (poiOn[cb.dataset.poi] === false) cb.checked = false;
  });
  paintBtn();
  if (panel) panel.hidden = true;

  // gear-style: click shows the panel; long-press/second click hides the whole layer
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel) panel.hidden = !panel.hidden;
  });
  document.addEventListener("click", (e) => {
    if (panel && !panel.hidden && !e.target.closest("#poi-panel") && !e.target.closest("#edu-toggle")) panel.hidden = true;
  });

  document.querySelectorAll("#poi-panel [data-poi]").forEach((cb) => {
    cb.addEventListener("change", () => {
      poiOn[cb.dataset.poi] = cb.checked;
      savePoi();
      const anyOn = Object.keys(poiOn).length === 0 || EDU_KINDS.some((k) => poiOn[k.key] !== false);
      eduVisible = anyOn;
      try { localStorage.setItem("blockview_edu", eduVisible ? "1" : "0"); } catch (e) {}
      paintBtn();
      addEducationLayer();   // rebuild with the new category filter
    });
  });
})();

/* ------------------------------------------------- WhatsApp contact ----
 * Shown when the listing has a contact marked as WhatsApp-reachable.
 * SECURITY: the wa.me link contains the full phone, so we only fetch the
 * number for a signed-in user — guests get the same sign-in prompt as the
 * masked phone. The flag itself is public; the number never is.
 */
function waNumber(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("972")) return d;          // already international
  if (d.startsWith("0")) return "972" + d.slice(1);  // Israeli local -> +972
  return d;
}
function waMessage(l) {
  const url = location.origin + "/?listing=" + encodeURIComponent(l.id);
  const tpl = t("wa_msg");
  return tpl
    .replace("{title}", l.title)
    .replace("{address}", (l.building && l.building.address) || "")
    .replace("{url}", url);
}
async function openWhatsApp(lid) {
  const l = LISTING_INDEX[lid]; if (!l) return;
  if (!signedIn()) {                       // same gate as revealing the phone
    if (window.bvToast) bvToast(t("contact_locked"));
    if (window.BVAuth) BVAuth.openAuth();
    return;
  }
  try {
    const db = window.BVSupa || BVDB;      // authenticated client sees full details
    const { data, error } = await db
      .from("listing_contacts").select("phone,whatsapp").eq("listing_id", lid);
    if (error) throw error;
    const c = (data || []).find((x) => x.whatsapp && x.phone);
    if (!c) { if (window.bvToast) bvToast(t("wa_none")); return; }
    const num = waNumber(c.phone);
    if (!num) { if (window.bvToast) bvToast(t("wa_none")); return; }
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(waMessage(l))}`, "_blank", "noopener");
  } catch (e) {
    if (window.bvToast) bvToast(t("wa_none"));
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-wa]");
  if (b) { e.preventDefault(); openWhatsApp(b.dataset.wa); }
});
