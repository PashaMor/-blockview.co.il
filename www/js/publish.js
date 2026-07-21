/* BlockView — "publish a property" flow. WEBSITE ONLY (removed inside the app).
 * Owner  -> posts their own listing here (goes to 'pending' for approval).
 * Realtor -> redirected to the agent CRM.
 * Security: RLS lets a user insert only listings where agent_id = their own uid,
 * and a DB trigger forces status='pending' so nobody can self-publish to the map.
 */
(function () {
  const btn = document.getElementById("publish-btn");
  if (!btn) return;

  // PUBLISHING is website-only (product decision): the app loses the "＋ פרסם נכס"
  // button and the owner/realtor chooser. EDITING an existing listing still works
  // there — an owner who can delete a listing must also be able to fix a typo —
  // so the form itself is wired up either way and reached via BVPublish.openEdit().
  const isNativeApp = !!window.Capacitor || /BlockViewApp/i.test(navigator.userAgent);
  if (isNativeApp) btn.remove();

  const CRM_URL = "https://crm.blockview.co.il";
  const $ = (id) => document.getElementById(id);
  const supa = () => window.BVSupa;
  const T = (k, fb) => (window.t ? window.t(k) : fb) || fb;

  const state = { deal: "sale", amen: {}, pending: [], buildings: [], address: null, footprint: null,
                  editId: null, savedPhotos: [] };

  /* ---------------------------------------------------- chooser modal ---- */
  if (!isNativeApp) {
    btn.addEventListener("click", () => { $("who-modal").hidden = false; });
    $("who-close").addEventListener("click", () => ($("who-modal").hidden = true));
    $("who-modal").addEventListener("click", (e) => { if (e.target === $("who-modal")) $("who-modal").hidden = true; });

    $("who-realtor").addEventListener("click", () => { window.location.href = CRM_URL; });

    $("who-owner").addEventListener("click", async () => {
      $("who-modal").hidden = true;
      if (!window.BVAuth || !window.BVAuth.isLoggedIn()) {
        if (window.bvToast) window.bvToast(T("login_to_publish", "התחבר כדי לפרסם נכס"));
        if (window.BVAuth) window.BVAuth.openAuth();
        return;
      }
      await openPublish();
    });
  }

  /* ------------------------------------------------------- publish UI ---- */
  const sheet = () => $("publish-sheet");

  async function openPublish() {
    if (window.closeAllSheets) window.closeAllSheets();
    if (window.closeAuthSheets) window.closeAuthSheets();
    $("p-err").hidden = true;
    state.pending = []; state.amen = {}; state.deal = "sale";
    state.editId = null; state.savedPhotos = [];
    setSheetMode(false);
    document.querySelectorAll("#p-amen .chip").forEach((c) => c.classList.remove("on"));
    document.querySelectorAll("#p-deal-seg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.pdeal === "sale"));
    $("pub-form").reset();
    $("p-floor").value = 0;
    $("p-floors-total").value = "";
    $("p-category").value = "residential";
    fillTypes();
    // first contact row starts prefilled with the account's own address
    let myEmail = "";
    try {
      const u = await supa().auth.getUser();
      myEmail = u && u.data && u.data.user ? u.data.user.email || "" : "";
    } catch (e) {}
    clearAddress();
    $("p-address").value = "";
    $("p-address").disabled = false;
    $("p-building").hidden = true;
    resetContacts(myEmail);
    renderStrip();
    await loadBuildings();
    sheet().classList.add("open");
    sheet().setAttribute("aria-hidden", "false");
  }
  function closePublish() { sheet().classList.remove("open"); sheet().setAttribute("aria-hidden", "true"); }

  /* ---------------------------------------------------------- edit mode ----
   * The owner manages their listings from the account sheet (js/my-listings.js)
   * and edits them in this same form. Editing an approved listing sends it back
   * for approval — the database decides that (26_listing_revisions.sql); here we
   * only warn about it up front so it is not a surprise. */
  function setSheetMode(editing, listing) {
    const head = sheet().querySelector(".building-head");
    if (head) {
      const h2 = head.querySelector("h2"), sub = head.querySelector(".b-address");
      if (h2) h2.textContent = editing ? T("edit_listing", "עריכת נכס") : T("publish_title", "פרסום נכס");
      if (sub) {
        sub.textContent = editing && listing && listing.status === "approved"
          ? T("edit_bounce", "הנכס מאושר. שמירת שינוי תחזיר אותו לאישור לפני שיופיע שוב במפה.")
          : T("publish_sub", "הנכס יישלח לאישור ויופיע במפה לאחר אישור.");
      }
    }
    $("p-submit").textContent = editing
      ? T("save_changes", "שמור שינויים")
      : T("submit_listing", "שלח לאישור");
  }

  async function openEdit(l) {
    if (window.closeAllSheets) window.closeAllSheets();
    if (window.closeAuthSheets) window.closeAuthSheets();
    $("p-err").hidden = true;
    state.editId = l.id;
    state.editStatus = l.status;
    state.pending = [];
    state.amen = { furnished: !!l.furnished, pets: !!l.pets, parking: !!l.parking, elevator: !!l.elevator };
    state.deal = l.deal;
    state.address = null; state.footprint = null;

    $("pub-form").reset();
    document.querySelectorAll("#p-deal-seg .seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.pdeal === l.deal));
    document.querySelectorAll("#p-amen .chip").forEach((c) =>
      c.classList.toggle("on", !!state.amen[c.dataset.pamen]));

    $("p-title").value = l.title || "";
    $("p-price").value = l.price || "";
    $("p-rooms").value = l.rooms || "";
    $("p-size").value = l.size || "";
    $("p-floor").value = l.floor || 0;
    $("p-floors-total").value = l.floors_total || "";
    $("p-category").value = l.category || "residential";
    fillTypes();
    $("p-type").value = l.type || "flat";
    $("p-age").value = l.age || "old";
    $("p-desc").value = l.description || "";

    // the building is fixed while editing — moving a listing to another address
    // is a new listing, not an edit
    const b = l.buildings || {};
    clearAddress();
    $("p-address").value = [b.address, b.city].filter(Boolean).join(", ");
    $("p-address").disabled = true;
    $("p-building").hidden = true;
    state.buildingId = l.building_id;

    await loadContactsFor(l.id);
    await loadPhotosFor(l.id);
    setSheetMode(true, l);
    sheet().classList.add("open");
    sheet().setAttribute("aria-hidden", "false");
  }

  async function loadContactsFor(listingId) {
    resetContacts("");
    const res = await supa().from("listing_contacts")
      .select("name,phone,email,whatsapp,sort").eq("listing_id", listingId).order("sort");
    const rows = (res.data || []);
    if (!rows.length) return;
    $("p-contacts").innerHTML = "";
    rows.forEach((c, i) => {
      addContactRow("");
      const row = $("p-contacts").children[i];
      row.querySelector(".c-name").value = c.name || "";
      row.querySelector(".c-phone").value = c.phone || "";
      row.querySelector(".c-email").value = c.email || "";
      row.querySelector(".c-wa").checked = !!c.whatsapp;
    });
  }

  async function loadPhotosFor(listingId) {
    const res = await supa().from("listing_photos")
      .select("id,path,sort").eq("listing_id", listingId).order("sort");
    state.savedPhotos = res.data || [];
    renderStrip();
  }

  window.BVPublish = { openEdit: openEdit };
  $("pub-close").addEventListener("click", closePublish);

  /* ---- property types follow the category (25_listing_fields.sql) ---- */
  const P_TYPES = {
    residential: [["flat", "flat"], ["house", "house"], ["penthouse", "penthouse"], ["studio", "studio"]],
    commercial: [["office", "office"], ["shop", "shop"], ["warehouse", "warehouse"], ["other", "other_type"]],
  };
  const TYPE_FALLBACK = {
    flat: "דירה", house: "בית", penthouse: "פנטהאוז", studio: "סטודיו",
    office: "משרד", shop: "חנות", warehouse: "מחסן / לוגיסטיקה", other_type: "אחר",
  };
  function fillTypes() {
    const cat = $("p-category").value;
    const keep = $("p-type").value;
    const list = P_TYPES[cat] || P_TYPES.residential;
    $("p-type").innerHTML = list
      .map(([v, key]) => '<option value="' + v + '">' + T(key, TYPE_FALLBACK[key]) + "</option>").join("");
    if (list.some((x) => x[0] === keep)) $("p-type").value = keep;
  }
  $("p-category").addEventListener("change", fillTypes);
  fillTypes();

  /* ---- write the description from the fields (js/describe-gen.js) ----
   * No service call: it composes the text out of what the owner already typed,
   * plus the measured walking distances for the building, so it cannot claim
   * anything that isn't on the form. */
  const genBtn = $("p-desc-gen");
  if (genBtn) genBtn.addEventListener("click", async () => {
    if (!window.BVDescribe) return;
    const rooms = $("p-rooms").value, size = $("p-size").value;
    if (!rooms || !size) {
      if (window.bvToast) window.bvToast(T("write_need_fields", "מלא חדרים ושטח כדי לנסח תיאור"));
      return;
    }
    const b = (state.buildings || []).find((x) => x.id === $("p-building").value) || {};
    const picked = state.address || {};        // the address they searched, if any
    const lang = window.currentLang && window.currentLang() === "en" ? "en" : "he";
    const text = window.BVDescribe.one({
      deal: state.deal,
      category: $("p-category").value,
      type: $("p-type").value,
      rooms: rooms, size: size, floor: $("p-floor").value,
      floorsTotal: $("p-floors-total").value,
      city: picked.city || b.city || "",
      age: $("p-age").value,
      elevator: !!state.amen.elevator,
      parking: !!state.amen.parking,
      furnished: !!state.amen.furnished,
      pets: !!state.amen.pets,
      address: picked.short || b.address || "", building: b.name || "",
      nearby: await nearbyFor($("p-building").value),
    }, lang);

    const box = $("p-desc");
    if (box.value.trim() && !confirmReplace()) return;
    box.value = text;
    if (window.bvToast) window.bvToast(T("write_done", "נוסח תיאור — אפשר לערוך"));
  });

  function confirmReplace() {
    return window.confirm(T("write_replace", "להחליף את התיאור שכתבת?"));
  }

  // nearest place per category, from the precomputed table (public read)
  const nearbyCache = {};
  async function nearbyFor(buildingId) {
    if (!buildingId || !window.BVDB) return {};
    if (nearbyCache[buildingId]) return nearbyCache[buildingId];
    try {
      const { data } = await window.BVDB.from("building_places")
        .select("category, walk_minutes").eq("building_id", buildingId).eq("rank", 1);
      const out = {};
      (data || []).forEach((r) => (out[r.category] = { minutes: r.walk_minutes }));
      nearbyCache[buildingId] = out;
      return out;
    } catch (e) { return {}; }
  }

  async function loadBuildings() {
    if (state.buildings.length) return fillBuildings();
    const { data } = await supa().from("buildings").select("id,name,address,city").order("name");
    state.buildings = data || [];
    fillBuildings();
  }
  function fillBuildings() {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    $("p-building").innerHTML = state.buildings
      .map((b) => `<option value="${esc(b.id)}">${esc(b.name)} — ${esc(b.address)}</option>`).join("");
  }

  /* --------------------------------------------------------- address ----
   * The publisher searches an address (OSM/Nominatim); we look up the real
   * building outline (Overpass) and hand both to ensure_building(), which
   * dedupes and creates the building server-side. The dropdown of existing
   * buildings stays available as a fallback when the lookup is unavailable. */
  let addrTimer = null;
  function escq(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function clearAddress() {
    state.address = null; state.footprint = null; state.matchedBuilding = null;
    $("p-addr-picked").hidden = true;
    $("p-addr-picked").textContent = "";
    $("p-addr-results").hidden = true;
    $("p-addr-results").innerHTML = "";
    const m = $("p-addr-match");
    if (m) { m.hidden = true; m.textContent = ""; m.className = "addr-match"; }
  }
  function showResults(items) {
    const box = $("p-addr-results");
    box._items = items;
    box.innerHTML = items.length
      ? items.map((it, i) => `<button type="button" class="ar-item" data-i="${i}"><b>${escq(it.short)}</b><small>${escq(it.label)}</small></button>`).join("")
      : `<div class="ar-empty">${T("address_none", "לא נמצאה כתובת. נסה ניסוח אחר.")}</div>`;
    box.hidden = false;
  }
  $("p-address").addEventListener("input", (e) => {
    clearAddress();
    const q = e.target.value;
    clearTimeout(addrTimer);
    if (q.trim().length < 3) { $("p-addr-results").hidden = true; return; }
    // debounce: Nominatim is a shared service, one request per pause is plenty
    addrTimer = setTimeout(async () => {
      if (!window.BVGeo) return;
      showResults(await BVGeo.searchAddress(q));
    }, 600);
  });
  $("p-addr-results").addEventListener("click", async (e) => {
    const b = e.target.closest(".ar-item");
    if (!b) return;
    const it = $("p-addr-results")._items[+b.dataset.i];
    $("p-addr-results").hidden = true;
    $("p-address").value = it.short + (it.city ? ", " + it.city : "");
    state.address = it;
    const picked = $("p-addr-picked");
    picked.textContent = T("address_checking", "מאתר את מתאר הבניין…");
    picked.hidden = false;
    // a real outline is a bonus, not a requirement — Overpass is flaky by nature
    const fp = await BVGeo.fetchFootprint(it.lat, it.lng);
    state.footprint = fp;
    // a match with no house number is the street, not the building — say so
    picked.textContent = "📍 " + it.short + " — " +
      (fp ? T("address_ok", "נמצא מתאר בניין אמיתי")
          : it.hasNumber ? T("address_nofp", "ללא מתאר מדויק, ימוקם לפי הכתובת")
                         : T("address_street_only", "⚠️ התוצאה היא הרחוב בלבד, ללא מספר בית"));
    showBuildingMatch(it, fp);
  });

  /* ---- say WHICH building this will attach to, before submitting ----
   * ensure_building() dedupes silently (same OSM id, same address, or within
   * ~30 m). On a dense street that can attach "אלנבי 21" to "אלנבי 40" next
   * door. The owner has to see that while they can still back out. */
  async function showBuildingMatch(addr, fp) {
    const box = $("p-addr-match");
    if (!box) return;
    box.hidden = true;
    box.className = "addr-match";
    state.matchedBuilding = null;
    try {
      const { data, error } = await supa().rpc("preview_building_match", {
        p_address: addr.label,
        p_lat: fp && fp.center ? fp.center[1] : addr.lat,
        p_lng: fp && fp.center ? fp.center[0] : addr.lng,
        p_osm_id: (fp && fp.osmId) || addr.osmId || null,
      });
      // 25_preview_building_match.sql may not be applied yet — stay quiet then
      if (error || !data || !data.length) return;
      const m = data[0];
      state.matchedBuilding = m;
      if (m.reason === "new") {
        box.textContent = "🏠 " + T("match_new", "ייווצר בניין חדש בכתובת הזו.");
      } else if (m.reason === "existing_hidden") {
        box.textContent = "🏢 " + T("match_hidden", "הנכס יצורף לבניין קיים בכתובת הזו.");
      } else {
        box.className = "addr-match warn";
        box.textContent = "⚠️ " + T("match_existing", "הנכס יצורף לבניין הקיים") +
          ' "' + (m.name || "") + '" — ' + (m.address || "") + ". " +
          (m.reason === "nearby"
            ? T("match_nearby", "הכתובת שבחרת נמצאת במרחק של כמה מטרים ממנו.")
            : T("match_same", "זו אותה כתובת."));
      }
      box.hidden = false;
    } catch (e) { /* preview is a courtesy: never block publishing */ }
  }
  // ₪99M ceiling — the DB enforces it too (26_price_cap.sql)
  const MAX_PRICE = 99000000;
  function checkedPrice(v) {
    const n = +v;
    if (!isFinite(n) || n <= 0) throw new Error(T("price_bad", "נא למלא מחיר תקין"));
    if (n > MAX_PRICE) throw new Error(T("price_max", "המחיר המרבי הוא ₪99,000,000"));
    return n;
  }

  // the building id this listing will attach to (created on demand from the address)
  async function resolveBuilding() {
    // editing keeps the building it already has — the address field is disabled
    // in that mode, so there is no new address to resolve
    if (state.editId && state.buildingId) return state.buildingId;
    const a = state.address;
    if (!a) throw new Error(T("address_required", "נא לבחור את כתובת הנכס"));
    const fp = state.footprint;
    const { data, error } = await supa().rpc("ensure_building", {
      p_name: a.short,
      p_address: a.label,
      p_city: a.city || null,
      p_lat: fp && fp.center ? fp.center[1] : a.lat,
      p_lng: fp && fp.center ? fp.center[0] : a.lng,
      p_osm_id: (fp && fp.osmId) || a.osmId || null,
      p_footprint: fp ? fp.polygon : null,
      p_height: fp ? fp.height : null,
    });
    if (error) {
      if (/TOO_MANY_BUILDINGS/.test(error.message)) throw new Error(T("address_toomany", "נוצרו יותר מדי בניינים. נסה שוב בעוד שעה."));
      throw error;
    }
    return data;
  }

  document.querySelectorAll("#p-deal-seg .seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#p-deal-seg .seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active"); state.deal = b.dataset.pdeal;
    }));

  document.querySelectorAll("#p-amen .chip").forEach((c) =>
    c.addEventListener("click", () => {
      c.classList.toggle("on"); state.amen[c.dataset.pamen] = c.classList.contains("on");
    }));

  /* -------------------------------------------------------- contacts ---- */
  // One or more people a buyer can call. Up to 5 (the DB refuses more).
  const MAX_CONTACTS = 5;
  function contactRow(i, email) {
    const d = document.createElement("div");
    d.className = "contact-row";
    d.innerHTML =
      '<input class="selectbox c-name" maxlength="80" placeholder="' + T("contact_name", "שם איש קשר") + '" autocomplete="name" />' +
      '<div class="grid-2">' +
        '<input class="selectbox c-phone" type="tel" maxlength="20" placeholder="' + T("contact_phone", "טלפון") + '" autocomplete="tel" />' +
        '<input class="selectbox c-email" type="email" maxlength="120" placeholder="' + T("contact_email", "אימייל (לא חובה)") + '" />' +
      "</div>" +
      '<label class="wa-check"><input type="checkbox" class="c-wa" /> ' + T("wa_has", "💬 המספר זמין בוואטסאפ") + '</label>' +
      (i === 0 ? "" : '<button type="button" class="c-remove" aria-label="' + T("remove_contact", "הסר איש קשר") + '">✕</button>');
    if (email) d.querySelector(".c-email").value = email;
    return d;
  }
  function addContactRow(email) {
    const box = $("p-contacts");
    if (box.children.length >= MAX_CONTACTS) return;
    box.appendChild(contactRow(box.children.length, email));
    $("p-add-contact").hidden = box.children.length >= MAX_CONTACTS;
  }
  function resetContacts(email) {
    $("p-contacts").innerHTML = "";
    $("p-add-contact").hidden = false;
    addContactRow(email);
  }
  $("p-add-contact").addEventListener("click", () => addContactRow(""));
  $("p-contacts").addEventListener("click", (e) => {
    const b = e.target.closest(".c-remove");
    if (!b) return;
    b.parentNode.remove();
    $("p-add-contact").hidden = $("p-contacts").children.length >= MAX_CONTACTS;
  });
  // reads + validates the rows; throws on the first bad one
  function readContacts() {
    const out = [];
    const rows = $("p-contacts").querySelectorAll(".contact-row");
    Array.prototype.forEach.call(rows, (r) => {
      const name = r.querySelector(".c-name").value.trim();
      const phone = r.querySelector(".c-phone").value.trim();
      const email = r.querySelector(".c-email").value.trim();
      if (!name && !phone && !email) return;                 // empty extra row: ignore
      if (name.length < 2) throw new Error(T("contact_name_bad", "נא למלא שם איש קשר"));
      if (phone.replace(/\D/g, "").length < 6) throw new Error(T("contact_phone_bad", "נא למלא מספר טלפון תקין"));
      out.push({ name: name, phone: phone, email: email || null, whatsapp: !!r.querySelector(".c-wa").checked });
    });
    return out;
  }

  /* ---------------------------------------------------------- photos ---- */
  function compress(file) {
    return new Promise((resolve) => {
      const rd = new FileReader();
      rd.onload = (ev) => {
        const im = new Image();
        im.onload = () => {
          const max = 1400, sc = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement("canvas");
          c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          c.toBlob((blob) => resolve({ blob, preview: c.toDataURL("image/jpeg", 0.5) }), "image/jpeg", 0.82);
        };
        im.src = ev.target.result;
      };
      rd.readAsDataURL(file);
    });
  }
  function photoUrl(path) {
    try { return supa().storage.from("listing-photos").getPublicUrl(path).data.publicUrl; }
    catch (e) { return ""; }
  }
  // The first photo is the cover — it is what the map card and the search results
  // show. "★" promotes any photo to the front; the order is persisted as `sort`.
  function coverMark(isCover) {
    return isCover
      ? `<span class="ph-cover">${T("cover", "תמונה ראשית")}</span>`
      : "";
  }
  function renderStrip() {
    let idx = 0;
    const saved = (state.savedPhotos || []).map((p) => {
      const first = idx++ === 0;
      return `<div class="ph${first ? " is-cover" : ""}"><img src="${photoUrl(p.path)}" alt="" />` +
        `<button type="button" class="ph-x" data-rmsaved="${p.id}">✕</button>` +
        (first ? "" : `<button type="button" class="ph-star" data-coversaved="${p.id}" title="${T("make_cover", "הפוך לתמונה ראשית")}">★</button>`) +
        coverMark(first) + `</div>`;
    });
    const canStarFresh = !(state.savedPhotos || []).length;   // no saved photos to order against
    const fresh = state.pending.map((p, i) => {
      const first = idx++ === 0;
      return `<div class="ph${first ? " is-cover" : ""}"><img src="${p.preview}" alt="" />` +
        `<button type="button" class="ph-x" data-rm="${i}">✕</button>` +
        (first || !canStarFresh ? "" : `<button type="button" class="ph-star" data-cover="${i}" title="${T("make_cover", "הפוך לתמונה ראשית")}">★</button>`) +
        coverMark(first) + `</div>`;
    });
    $("p-strip").innerHTML = saved.concat(fresh).join("");
  }
  $("p-photos").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => /^image\//.test(f.type));
    e.target.value = "";
    for (const f of files) state.pending.push(await compress(f));
    renderStrip();
  });
  $("p-strip").addEventListener("click", async (e) => {
    // promote an already-uploaded photo: reorder locally, persist the new sort
    const cs = e.target.closest("[data-coversaved]");
    if (cs) {
      const id = cs.getAttribute("data-coversaved");
      const arr = state.savedPhotos || [];
      const at = arr.findIndex((p) => String(p.id) === String(id));
      if (at > 0) {
        arr.unshift(arr.splice(at, 1)[0]);
        renderStrip();
        for (let i = 0; i < arr.length; i++) {
          const r = await supa().from("listing_photos").update({ sort: i }).eq("id", arr[i].id);
          if (r.error) { if (window.bvToast) window.bvToast(T("cover_failed", "עדכון התמונה הראשית נכשל")); break; }
          arr[i].sort = i;
        }
        if (window.BVMyListings) window.BVMyListings.render();
        if (window.reloadLiveData) window.reloadLiveData();
      }
      return;
    }
    // promote one that has not been uploaded yet: it only has to lead the array,
    // and it is uploaded with sort 0 (this branch only runs when nothing is saved)
    const cp = e.target.closest("[data-cover]");
    if (cp) {
      const i = +cp.getAttribute("data-cover");
      state.pending.unshift(state.pending.splice(i, 1)[0]);
      renderStrip();
      return;
    }
    const b = e.target.closest("[data-rm]");
    if (b) { state.pending.splice(+b.dataset.rm, 1); renderStrip(); return; }
    const s2 = e.target.closest("[data-rmsaved]");
    if (!s2) return;
    const id = s2.getAttribute("data-rmsaved");
    const photo = (state.savedPhotos || []).filter((p) => String(p.id) === String(id))[0];
    if (!photo) return;
    // storage first: an orphaned row is worse than an orphaned file, because the
    // row is what the listing renders from
    try { await supa().storage.from("listing-photos").remove([photo.path]); } catch (err) {}
    const res = await supa().from("listing_photos").delete().eq("id", photo.id);
    if (res.error) { if (window.bvToast) window.bvToast(T("photo_del_failed", "מחיקת התמונה נכשלה")); return; }
    state.savedPhotos = state.savedPhotos.filter((p) => String(p.id) !== String(id));
    renderStrip();
  });

  /* ---------------------------------------------------------- submit ---- */
  $("pub-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("p-err").hidden = true;
    const submit = $("p-submit"); submit.disabled = true;
    try {
      const { data: ures } = await supa().auth.getUser();
      const user = ures && ures.user;
      if (!user) throw new Error(T("login_to_publish", "התחבר כדי לפרסם נכס"));

      const editing = !!state.editId;
      const row = {
        building_id: editing ? state.buildingId : await resolveBuilding(),
        agent_id: user.id,
        poster_type: "owner",
        deal: state.deal,
        title: $("p-title").value.trim(),
        price: checkedPrice($("p-price").value),
        rooms: +$("p-rooms").value,
        size: +$("p-size").value,
        floor: +$("p-floor").value || 0,
        floors_total: +$("p-floors-total").value || null,
        category: $("p-category").value,
        type: $("p-type").value,
        age: $("p-age").value,
        description: $("p-desc").value.trim(),
        furnished: !!state.amen.furnished,
        pets: !!state.amen.pets,
        parking: !!state.amen.parking,
        elevator: !!state.amen.elevator,
        status: "pending",
      };
      const contacts = readContacts();
      if (!contacts.length) throw new Error(T("contact_name_bad", "נא למלא שם איש קשר"));

      let data, bouncedBack = false;
      if (editing) {
        // status is left alone: the DB decides whether this goes back for
        // approval (26_listing_revisions.sql)
        delete row.status;
        delete row.poster_type;
        const wasApproved = state.editStatus === "approved";
        const up = await supa().from("listings").update(row).eq("id", state.editId).select("id,status").single();
        if (up.error) throw up.error;
        data = up.data;
        bouncedBack = wasApproved && data.status === "pending";
        // contacts are replaced wholesale — simpler and safer than diffing rows
        const dres = await supa().from("listing_contacts").delete().eq("listing_id", state.editId);
        if (dres.error) throw dres.error;
      } else {
        const ins = await supa().from("listings").insert(row).select("id").single();
        if (ins.error) throw ins.error;
        data = ins.data;
      }

      // full details go to listing_contacts (RLS: signed-in users only); guests get
      // the masked view listing_contacts_public
      const cres = await supa().from("listing_contacts")
        .insert(contacts.map((c, i) => ({ listing_id: data.id, name: c.name, phone: c.phone, email: c.email, whatsapp: !!c.whatsapp, sort: i })));
      if (cres.error) throw cres.error;

      const sortFrom = (state.savedPhotos || []).length;
      for (let i = 0; i < state.pending.length; i++) {
        const path = `${user.id}/${data.id}/${Date.now()}_${i}.jpg`;
        const up = await supa().storage.from("listing-photos").upload(path, state.pending[i].blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        await supa().from("listing_photos").insert({ listing_id: data.id, path, sort: sortFrom + i });
      }

      closePublish();
      if (window.BVMyListings) window.BVMyListings.render();
      if (window.reloadLiveData) window.reloadLiveData();
      if (window.bvToast) {
        window.bvToast(bouncedBack ? T("edit_bounced", "הנכס עודכן ונשלח לאישור מחדש")
          : editing ? T("edit_saved", "הנכס עודכן ✓")
          : T("pub_ok", "הנכס נשלח לאישור ✓"));
      }
    } catch (err) {
      const el = $("p-err"); el.textContent = err.message || "שגיאה"; el.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
})();

/* ---- password reset links (website) ---- */
(function () {
  const go = (email) => (window.location.href = "/reset" + (email ? "?email=" + encodeURIComponent(email) : ""));
  const f = document.getElementById("auth-forgot");
  if (f) f.addEventListener("click", () => go((document.getElementById("auth-email") || {}).value));
  const p = document.getElementById("acc-password");
  if (p) p.addEventListener("click", () => go((document.getElementById("acc-email") || {}).textContent));
})();
