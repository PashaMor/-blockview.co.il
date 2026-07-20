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

  const state = { deal: "sale", amen: {}, pending: [], buildings: [] };

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

  document.querySelectorAll("#p-deal-seg .seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#p-deal-seg .seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active"); state.deal = b.dataset.pdeal;
    }));

  document.querySelectorAll("#p-amen .chip").forEach((c) =>
    c.addEventListener("click", () => {
      c.classList.toggle("on"); state.amen[c.dataset.pamen] = c.classList.contains("on");
    }));

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
        building_id: $("p-building").value,
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
      const { data, error } = await supa().from("listings").insert(row).select("id").single();
      if (error) throw error;

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
