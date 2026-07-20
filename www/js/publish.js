/* BlockView — "publish a property" flow. WEBSITE ONLY (removed inside the app).
 * Owner  -> posts their own listing here (goes to 'pending' for approval).
 * Realtor -> redirected to the agent CRM.
 * Security: RLS lets a user insert only listings where agent_id = their own uid,
 * and a DB trigger forces status='pending' so nobody can self-publish to the map.
 */
(function () {
  const btn = document.getElementById("publish-btn");
  if (!btn) return;

  // Hide the whole feature inside the native app (website-only per product decision)
  const isNativeApp = !!window.Capacitor || /BlockViewApp/i.test(navigator.userAgent);
  if (isNativeApp) { btn.remove(); return; }

  const CRM_URL = "https://crm.blockview.co.il";
  const $ = (id) => document.getElementById(id);
  const supa = () => window.BVSupa;
  const T = (k, fb) => (window.t ? window.t(k) : fb) || fb;

  const state = { deal: "sale", amen: {}, pending: [], buildings: [], address: null, footprint: null };

  /* ---------------------------------------------------- chooser modal ---- */
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

  /* ------------------------------------------------------- publish UI ---- */
  const sheet = () => $("publish-sheet");

  async function openPublish() {
    if (window.closeAllSheets) window.closeAllSheets();
    if (window.closeAuthSheets) window.closeAuthSheets();
    $("p-err").hidden = true;
    state.pending = []; state.amen = {}; state.deal = "sale";
    document.querySelectorAll("#p-amen .chip").forEach((c) => c.classList.remove("on"));
    document.querySelectorAll("#p-deal-seg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.pdeal === "sale"));
    $("pub-form").reset();
    $("p-floor").value = 0;
    // first contact row starts prefilled with the account's own address
    let myEmail = "";
    try {
      const u = await supa().auth.getUser();
      myEmail = u && u.data && u.data.user ? u.data.user.email || "" : "";
    } catch (e) {}
    clearAddress();
    $("p-address").value = "";
    $("p-building").hidden = true;
    resetContacts(myEmail);
    renderStrip();
    await loadBuildings();
    sheet().classList.add("open");
    sheet().setAttribute("aria-hidden", "false");
  }
  function closePublish() { sheet().classList.remove("open"); sheet().setAttribute("aria-hidden", "true"); }
  $("pub-close").addEventListener("click", closePublish);

  async function loadBuildings() {
    if (state.buildings.length) return fillBuildings();
    const { data } = await supa().from("buildings").select("id,name,address").order("name");
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
    state.address = null; state.footprint = null;
    $("p-addr-picked").hidden = true;
    $("p-addr-picked").textContent = "";
    $("p-addr-results").hidden = true;
    $("p-addr-results").innerHTML = "";
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
    picked.textContent = "📍 " + it.short + " — " +
      (fp ? T("address_ok", "נמצא מתאר בניין אמיתי") : T("address_nofp", "ללא מתאר מדויק, ימוקם לפי הכתובת"));
  });
  // escape hatch: attach to one of the buildings already on the map
  $("p-pick-existing").addEventListener("click", () => {
    const sel = $("p-building");
    sel.hidden = !sel.hidden;
    if (!sel.hidden) { clearAddress(); $("p-address").value = ""; }
  });

  // the building id this listing will attach to (created on demand)
  async function resolveBuilding() {
    const sel = $("p-building");
    if (!sel.hidden && sel.value) return sel.value;
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
  function renderStrip() {
    $("p-strip").innerHTML = state.pending.map((p, i) =>
      `<div class="ph"><img src="${p.preview}" alt="" /><button type="button" data-rm="${i}">✕</button></div>`).join("");
  }
  $("p-photos").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => /^image\//.test(f.type));
    e.target.value = "";
    for (const f of files) state.pending.push(await compress(f));
    renderStrip();
  });
  $("p-strip").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) { state.pending.splice(+b.dataset.rm, 1); renderStrip(); }
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

      const row = {
        building_id: await resolveBuilding(),
        agent_id: user.id,
        poster_type: "owner",
        deal: state.deal,
        title: $("p-title").value.trim(),
        price: +$("p-price").value,
        rooms: +$("p-rooms").value,
        size: +$("p-size").value,
        floor: +$("p-floor").value || 0,
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

      const { data, error } = await supa().from("listings").insert(row).select("id").single();
      if (error) throw error;

      // full details go to listing_contacts (RLS: signed-in users only); guests get
      // the masked view listing_contacts_public
      const cres = await supa().from("listing_contacts")
        .insert(contacts.map((c, i) => ({ listing_id: data.id, name: c.name, phone: c.phone, email: c.email, whatsapp: !!c.whatsapp, sort: i })));
      if (cres.error) throw cres.error;

      for (let i = 0; i < state.pending.length; i++) {
        const path = `${user.id}/${data.id}/${Date.now()}_${i}.jpg`;
        const up = await supa().storage.from("listing-photos").upload(path, state.pending[i].blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        await supa().from("listing_photos").insert({ listing_id: data.id, path, sort: i });
      }

      closePublish();
      if (window.bvToast) window.bvToast(T("pub_ok", "הנכס נשלח לאישור ✓"));
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
