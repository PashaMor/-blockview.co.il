/* BlockView CRM — agent dashboard.
 * Security: browser publishable key only. Every read/write is constrained by
 * Row-Level Security (agents see/modify only their own listings & leads).
 * All user-supplied text is HTML-escaped before rendering (no stored XSS).
 */
(function () {
  const cfg = window.BLOCKVIEW_CONFIG;
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (id) => document.getElementById(id);
  const BUCKET = "listing-photos";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nis = (n) => "₪" + Number(n || 0).toLocaleString("he-IL");
  const STATUS_HE = { pending: "ממתין לאישור", approved: "מאושר", rejected: "נדחה", sold: "נמכר", draft: "טיוטה" };

  const state = { user: null, role: "user", buildings: [], listings: [], leads: [], photos: [], pending: [] };

  let toastTimer;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400);
  }

  /* ------------------------------------------------------------ auth ---- */
  supa.auth.onAuthStateChange(async (_e, session) => {
    state.user = session ? session.user : null;
    if (!state.user) return showGate();
    const { data } = await supa.from("profiles").select("role").eq("id", state.user.id).single();
    state.role = (data && data.role) || "user";
    $("who").textContent = state.user.email + (state.role === "admin" ? " · מנהל" : " · סוכן");
    $("settings-btn").hidden = false;
    $("sm-email").textContent = state.user.email;
    $("sm-role").textContent = state.role === "admin" ? "מנהל מערכת" : "סוכן נדל\"ן";
    $("sm-avatar").textContent = String(state.user.email || "?").charAt(0).toUpperCase();
    if (state.role !== "agent" && state.role !== "admin") return showNoAccess();
    if (!(await mfaLoginGate())) return;   // only blocks if the agent enabled 2FA
    showApp();
    loadAll();
    refreshSecurity();
  });

  function hideAll() { ["gate", "noaccess", "mfa", "app"].forEach((n) => ($(n).hidden = true)); }
  function showGate() { hideAll(); $("gate").hidden = false; $("settings-btn").hidden = true; $("settings-menu").hidden = true; $("who").textContent = ""; }

  /* ------------------------------------------------------ settings menu ---- */
  $("settings-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const m = $("settings-menu");
    m.hidden = !m.hidden;
    if (!m.hidden) refreshSecurity();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".settings-wrap")) $("settings-menu").hidden = true;
  });
  $("sm-security").addEventListener("click", () => { $("settings-menu").hidden = true; switchTab("security"); });
  $("sm-site").addEventListener("click", () => { window.location.href = "https://blockview.co.il"; });
  $("sm-signout").addEventListener("click", () => supa.auth.signOut());
  function showNoAccess() { hideAll(); $("noaccess").hidden = false; }
  function showApp() { hideAll(); $("app").hidden = false; }
  function showMfa() { hideAll(); $("mfa").hidden = false; }

  /* ------------------------------------------------------------- 2FA ---- */
  const mfa = { factorId: null, challengeId: null, mode: null };

  async function listTotp() {
    const { data } = await supa.auth.mfa.listFactors();
    return (data && data.totp) || [];
  }

  // On login: if the agent has 2FA on, require the code. Otherwise let them in.
  async function mfaLoginGate() {
    const totp = await listTotp();
    const verified = totp.filter((x) => x.status === "verified");
    if (!verified.length) return true;                       // 2FA not enabled
    const { data: aal } = await supa.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.currentLevel === "aal2") return true;     // already verified
    await startChallenge(verified[0].id);
    return false;
  }

  async function startChallenge(factorId) {
    mfa.mode = "challenge"; mfa.factorId = factorId;
    const { data, error } = await supa.auth.mfa.challenge({ factorId });
    if (error) { showMfa(); return mfaErr(error.message); }
    mfa.challengeId = data.id;
    $("mfa-title").textContent = "אימות דו-שלבי";
    $("mfa-sub").textContent = "הזן את הקוד בן 6 הספרות מאפליקציית האימות";
    $("mfa-enroll").hidden = true; $("mfa-cancel").hidden = true;
    showMfa(); $("mfa-code").value = ""; $("mfa-code").focus();
  }

  async function startEnroll() {
    const stale = (await listTotp()).filter((x) => x.status !== "verified");
    for (const s of stale) { try { await supa.auth.mfa.unenroll({ factorId: s.id }); } catch (e) {} }
    const { data, error } = await supa.auth.mfa.enroll({ factorType: "totp", friendlyName: "BlockView CRM" });
    if (error) { showMfa(); return mfaErr(error.message); }
    mfa.mode = "enroll"; mfa.factorId = data.id;
    $("mfa-title").textContent = "הפעלת אימות דו-שלבי";
    $("mfa-sub").textContent = "סרוק את הקוד באפליקציית אימות ואשר עם 6 ספרות.";
    $("mfa-enroll").hidden = false; $("mfa-cancel").hidden = false;
    $("mfa-qr").innerHTML = data.totp.qr_code || "";
    $("mfa-secret").textContent = data.totp.secret || "";
    showMfa(); $("mfa-code").value = ""; $("mfa-code").focus();
  }

  function mfaErr(m) { const e = $("mfa-err"); e.textContent = m; e.hidden = false; }

  $("mfa-verify").addEventListener("click", async () => {
    $("mfa-err").hidden = true;
    const code = $("mfa-code").value.trim();
    if (!/^\d{6}$/.test(code)) return mfaErr("הזן קוד בן 6 ספרות");
    try {
      let challengeId = mfa.challengeId;
      if (mfa.mode === "enroll") {
        const ch = await supa.auth.mfa.challenge({ factorId: mfa.factorId });
        if (ch.error) throw ch.error;
        challengeId = ch.data.id;
      }
      const { error } = await supa.auth.mfa.verify({ factorId: mfa.factorId, challengeId, code });
      if (error) throw error;
      toast(mfa.mode === "enroll" ? "אימות דו-שלבי הופעל 🔐" : "אומת בהצלחה");
      showApp(); loadAll(); refreshSecurity();
    } catch (err) { mfaErr(err.message || "קוד שגוי"); }
  });
  $("mfa-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("mfa-verify").click(); });
  $("mfa-signout").addEventListener("click", () => supa.auth.signOut());
  $("mfa-cancel").addEventListener("click", async () => {
    const stale = (await listTotp()).filter((x) => x.status !== "verified");
    for (const s of stale) { try { await supa.auth.mfa.unenroll({ factorId: s.id }); } catch (e) {} }
    showApp(); refreshSecurity();
  });

  /* security panel */
  async function refreshSecurity() {
    const verified = (await listTotp()).filter((x) => x.status === "verified");
    const on = verified.length > 0;
    const el = $("sec-state");
    el.textContent = on ? "✅ מופעל" : "לא מופעל";
    el.className = "sec-state " + (on ? "on" : "off");
    $("sec-enable").hidden = on;
    $("sec-disable").hidden = !on;
    const tag = $("sm-2fa");
    if (tag) { tag.textContent = on ? "מופעל" : "כבוי"; tag.className = "sm-tag" + (on ? " on" : ""); }
  }
  $("sec-enable").addEventListener("click", startEnroll);
  $("sec-disable").addEventListener("click", async () => {
    if (!confirm("לכבות אימות דו-שלבי? החשבון יהיה מוגן פחות.")) return;
    for (const f of (await listTotp())) { try { await supa.auth.mfa.unenroll({ factorId: f.id }); } catch (e) {} }
    toast("אימות דו-שלבי כובה"); refreshSecurity();
  });

  $("g-signin").addEventListener("click", async () => {
    const email = $("g-email").value.trim(), password = $("g-pw").value;
    if (!email || !password) return showErr("g-err", "נא למלא אימייל וסיסמה");
    const { error } = await supa.auth.signInWithPassword({ email, password });
    if (error) showErr("g-err", error.message);
  });
  $("g-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("g-signin").click(); });
  $("signout").addEventListener("click", () => supa.auth.signOut());
  $("na-signout").addEventListener("click", () => supa.auth.signOut());
  function showErr(id, msg) { const e = $(id); e.textContent = msg; e.hidden = false; }

  /* ------------------------------------------------------------ data ---- */
  async function loadAll() { await loadBuildings(); await loadListings(); await loadLeads(); }

  async function loadBuildings() {
    const { data } = await supa.from("buildings").select("id,name,address").order("name");
    state.buildings = data || [];
    $("f-building").innerHTML = state.buildings
      .map((b) => `<option value="${esc(b.id)}">${esc(b.name)} — ${esc(b.address)}</option>`).join("");
  }

  async function loadListings() {
    const { data, error } = await supa
      .from("listings")
      .select("*, buildings(name,address), listing_photos(id,path,sort)")
      .eq("agent_id", state.user.id)
      .order("created_at", { ascending: false });
    if (error) return toast("שגיאה בטעינת נכסים");
    state.listings = data || [];
    renderStats(); renderListings();
  }

  function photoUrl(path) { return supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }

  function renderStats() {
    const L = state.listings;
    const n = (s) => L.filter((x) => x.status === s).length;
    $("stats").innerHTML =
      `<div class="stat"><b>${L.length}</b><span>סה"כ נכסים</span></div>` +
      `<div class="stat"><b>${n("approved")}</b><span>מאושרים</span></div>` +
      `<div class="stat"><b>${n("pending")}</b><span>ממתינים לאישור</span></div>` +
      `<div class="stat"><b>${state.leads.length}</b><span>לידים</span></div>`;
  }

  function renderListings() {
    const f = $("status-filter").value;
    const rows = state.listings.filter((l) => f === "all" || l.status === f);
    $("listings-empty").hidden = rows.length > 0;
    $("listings-list").innerHTML = rows.map((l) => {
      const ph = (l.listing_photos || []).sort((a, b) => a.sort - b.sort)[0];
      const thumb = ph ? `<img class="lthumb" src="${esc(photoUrl(ph.path))}" alt="" />` : `<div class="lthumb">🏠</div>`;
      const b = l.buildings || {};
      return `<div class="lcard">
        ${thumb}
        <div class="lmain">
          <div class="ltitle">${esc(l.title)}</div>
          <div class="lsub">${esc(b.name || "")} · ${esc(b.address || "")}</div>
          <div class="lmeta">
            <span>${l.deal === "sale" ? "מכירה" : "השכרה"}</span>
            <span>${esc(l.rooms)} חד'</span><span>${esc(l.size)} מ"ר</span><span>קומה ${esc(l.floor)}</span>
            <span class="badge ${esc(l.status)}">${esc(STATUS_HE[l.status] || l.status)}</span>
          </div>
        </div>
        <div class="lprice">${nis(l.price)}${l.deal === "rent" ? " / לחודש" : ""}</div>
        <div class="lactions">
          <button class="icon-btn" data-edit="${esc(l.id)}" title="עריכה">✏️</button>
        </div>
      </div>`;
    }).join("");
  }

  $("status-filter").addEventListener("change", renderListings);
  $("listings-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit]");
    if (b) openEditor(state.listings.find((l) => l.id === b.dataset.edit));
  });

  /* ---------------------------------------------------------- editor ---- */
  function openEditor(l) {
    switchTab("editor");
    $("f-err").hidden = true;
    state.pending = [];
    state.photos = l ? (l.listing_photos || []).slice().sort((a, b) => a.sort - b.sort) : [];
    $("editor-title").textContent = l ? "עריכת נכס" : "נכס חדש";
    $("f-id").value = l ? l.id : "";
    $("f-building").value = l ? l.building_id : (state.buildings[0] || {}).id || "";
    $("f-deal").value = l ? l.deal : "sale";
    $("f-title").value = l ? l.title : "";
    $("f-price").value = l ? l.price : "";
    $("f-rooms").value = l ? l.rooms : "";
    $("f-size").value = l ? l.size : "";
    $("f-floor").value = l ? l.floor : 0;
    $("f-type").value = l ? l.type : "flat";
    $("f-age").value = l ? l.age : "old";
    $("f-status").value = l ? (["pending", "draft", "sold"].includes(l.status) ? l.status : "pending") : "pending";
    $("f-tour").value = l && l.tour_url ? l.tour_url : "";
    $("f-desc").value = l ? l.description : "";
    $("f-furnished").checked = !!(l && l.furnished);
    $("f-pets").checked = !!(l && l.pets);
    $("f-parking").checked = !!(l && l.parking);
    $("f-elevator").checked = !!(l && l.elevator);
    $("f-delete").hidden = !l;
    $("f-photos").value = "";
    renderPhotoStrip();
  }

  function renderPhotoStrip() {
    const saved = state.photos.map((p) =>
      `<div class="ph"><img src="${esc(photoUrl(p.path))}" alt="" /><button type="button" data-delph="${esc(p.id)}">✕</button></div>`);
    const pend = state.pending.map((p, i) =>
      `<div class="ph"><img src="${esc(p.preview)}" alt="" /><button type="button" data-delpend="${i}">✕</button></div>`);
    $("photo-strip").innerHTML = saved.concat(pend).join("");
  }

  $("photo-strip").addEventListener("click", async (e) => {
    const d = e.target.closest("[data-delph]");
    if (d) {
      const p = state.photos.find((x) => x.id === d.dataset.delph);
      await supa.storage.from(BUCKET).remove([p.path]);
      await supa.from("listing_photos").delete().eq("id", p.id);
      state.photos = state.photos.filter((x) => x.id !== p.id);
      renderPhotoStrip(); toast("התמונה נמחקה");
      return;
    }
    const q = e.target.closest("[data-delpend]");
    if (q) { state.pending.splice(+q.dataset.delpend, 1); renderPhotoStrip(); }
  });

  // compress in the browser before upload (keeps storage small & uploads fast)
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
          c.toBlob((blob) => resolve({ blob, preview: c.toDataURL("image/jpeg", 0.6) }), "image/jpeg", 0.82);
        };
        im.src = ev.target.result;
      };
      rd.readAsDataURL(file);
    });
  }

  $("f-photos").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => /^image\//.test(f.type));
    e.target.value = "";
    for (const f of files) state.pending.push(await compress(f));
    renderPhotoStrip();
  });

  $("listing-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("f-err").hidden = true;
    $("f-save").disabled = true;
    try {
      const row = {
        building_id: $("f-building").value,
        agent_id: state.user.id,
        deal: $("f-deal").value,
        title: $("f-title").value.trim(),
        price: +$("f-price").value,
        rooms: +$("f-rooms").value,
        size: +$("f-size").value,
        floor: +$("f-floor").value || 0,
        type: $("f-type").value,
        age: $("f-age").value,
        status: $("f-status").value,
        tour_url: $("f-tour").value.trim() || null,
        description: $("f-desc").value.trim(),
        furnished: $("f-furnished").checked,
        pets: $("f-pets").checked,
        parking: $("f-parking").checked,
        elevator: $("f-elevator").checked,
      };
      const id = $("f-id").value;
      let listingId = id;
      if (id) {
        const { error } = await supa.from("listings").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supa.from("listings").insert(row).select("id").single();
        if (error) throw error;
        listingId = data.id;
      }
      // upload any new photos
      for (let i = 0; i < state.pending.length; i++) {
        const p = state.pending[i];
        const path = `${state.user.id}/${listingId}/${Date.now()}_${i}.jpg`;
        const up = await supa.storage.from(BUCKET).upload(path, p.blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        const ins = await supa.from("listing_photos").insert({ listing_id: listingId, path, sort: state.photos.length + i });
        if (ins.error) throw ins.error;
      }
      state.pending = [];
      toast(id ? "הנכס עודכן" : "הנכס נוסף");
      await loadListings();
      switchTab("listings");
    } catch (err) {
      showErr("f-err", err.message || "שגיאה בשמירה");
    } finally {
      $("f-save").disabled = false;
    }
  });

  $("f-cancel").addEventListener("click", () => switchTab("listings"));
  $("f-delete").addEventListener("click", async () => {
    const id = $("f-id").value;
    if (!id || !confirm("למחוק את הנכס לצמיתות?")) return;
    const { error } = await supa.from("listings").delete().eq("id", id);
    if (error) return toast("שגיאה במחיקה");
    toast("הנכס נמחק"); await loadListings(); switchTab("listings");
  });

  /* ----------------------------------------------------------- leads ---- */
  async function loadLeads() {
    const { data } = await supa.from("leads")
      .select("*, listings(title)")
      .order("created_at", { ascending: false });
    state.leads = data || [];
    $("leads-badge").textContent = state.leads.filter((l) => l.status === "new").length;
    renderStats(); renderLeads();
  }

  function renderLeads() {
    $("leads-empty").hidden = state.leads.length > 0;
    $("leads-list").innerHTML = state.leads.map((l) => {
      const when = new Date(l.created_at).toLocaleString("he-IL");
      return `<div class="lead">
        <div class="lead-top">
          <div><span class="lead-name">${esc(l.name)}</span> ${l.phone ? `· <a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : ""}</div>
          <span class="lead-when">${esc(when)}</span>
        </div>
        <div class="lead-for">על הנכס: ${esc((l.listings || {}).title || "—")}</div>
        ${l.message ? `<div class="lead-msg">${esc(l.message)}</div>` : ""}
        <div class="lead-actions">
          <span class="badge ${l.status === "new" ? "pending" : l.status === "contacted" ? "approved" : "draft"}">${
            l.status === "new" ? "חדש" : l.status === "contacted" ? "נוצר קשר" : "סגור"}</span>
          ${l.status !== "contacted" ? `<button class="btn-ghost" data-lead="${esc(l.id)}" data-to="contacted">סמן כנוצר קשר</button>` : ""}
          ${l.status !== "closed" ? `<button class="btn-ghost" data-lead="${esc(l.id)}" data-to="closed">סגור</button>` : ""}
        </div>
      </div>`;
    }).join("");
  }

  $("leads-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-lead]");
    if (!b) return;
    const { error } = await supa.from("leads").update({ status: b.dataset.to }).eq("id", b.dataset.lead);
    if (error) return toast("שגיאה בעדכון");
    await loadLeads();
  });

  /* ------------------------------------------------------------ tabs ---- */
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $("tab-listings").hidden = name !== "listings";
    $("tab-editor").hidden = name !== "editor";
    $("tab-leads").hidden = name !== "leads";
    $("tab-security").hidden = name !== "security";
    if (name === "security") refreshSecurity();
  }
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => { if (t.dataset.tab === "editor") openEditor(null); else switchTab(t.dataset.tab); }));
})();
