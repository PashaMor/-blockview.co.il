/* BlockView — superadmin console.
 * Security: admin-only. Every query is still under RLS (admin policies use the
 * SECURITY DEFINER is_admin() helper). All user text is HTML-escaped on render.
 */
(function () {
  const cfg = window.BLOCKVIEW_CONFIG;
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (id) => document.getElementById(id);
  const BUCKET = "listing-photos";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nis = (n) => "₪" + Number(n || 0).toLocaleString("he-IL");
  const ST = { pending: "ממתין", approved: "מאושר", rejected: "נדחה", sold: "נמכר", draft: "טיוטה" };
  const when = (d) => new Date(d).toLocaleDateString("he-IL");

  const state = { user: null, listings: [], profiles: [], pmap: {}, buildings: [], leadCount: 0 };

  let tt; function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2400); }
  const photoUrl = (p) => supa.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;

  /* --------------------------------------------------------------- auth */
  supa.auth.onAuthStateChange(async (_e, session) => {
    state.user = session ? session.user : null;
    if (!state.user) return show("gate");
    // own row is readable at aal1 (profiles_self_select), so the role check works pre-2FA
    const { data } = await supa.from("profiles").select("role").eq("id", state.user.id).single();
    $("who").textContent = state.user.email;
    $("settings-btn").hidden = false;
    $("sm-email").textContent = state.user.email;
    $("sm-avatar").textContent = String(state.user.email || "?").charAt(0).toUpperCase();
    if (!data || data.role !== "admin") return show("noaccess");
    if (!(await mfaGate())) return;        // 2FA is mandatory for admins
    show("app"); loadAll();
  });
  function show(which) {
    ["gate", "noaccess", "mfa", "app"].forEach((n) => ($(n).hidden = n !== which));
    if (which === "gate") { $("settings-btn").hidden = true; $("settings-menu").hidden = true; $("who").textContent = ""; }
  }

  /* ---------------------------------------------------- settings menu */
  $("settings-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const m = $("settings-menu"); m.hidden = !m.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".settings-wrap")) $("settings-menu").hidden = true;
  });
  $("sm-crm").addEventListener("click", () => (window.location.href = "https://crm.blockview.co.il"));
  $("sm-site").addEventListener("click", () => (window.location.href = "https://blockview.co.il"));
  $("sm-signout").addEventListener("click", () => supa.auth.signOut());
  // replace the authenticator device: drop existing factors, then re-enroll
  $("sm-reset2fa").addEventListener("click", async () => {
    if (!confirm("להחליף מכשיר 2FA? תתבקש לסרוק קוד חדש כעת.")) return;
    $("settings-menu").hidden = true;
    const { data } = await supa.auth.mfa.listFactors();
    for (const f of ((data && data.totp) || [])) { try { await supa.auth.mfa.unenroll({ factorId: f.id }); } catch (e) {} }
    await startEnroll([]);
  });

  /* ---------------------------------------------------------------- 2FA */
  const mfa = { factorId: null, challengeId: null, mode: null };

  async function mfaGate() {
    const { data: f } = await supa.auth.mfa.listFactors();
    const totp = (f && f.totp) || [];
    const verified = totp.filter((x) => x.status === "verified");
    const { data: aal } = await supa.auth.mfa.getAuthenticatorAssuranceLevel();
    if (verified.length && aal && aal.currentLevel === "aal2") return true;  // already 2FA'd
    if (verified.length) { await startChallenge(verified[0].id); return false; }
    await startEnroll(totp.filter((x) => x.status !== "verified"));
    return false;
  }

  async function startEnroll(stale) {
    // clear half-finished factors so enroll() doesn't collide
    for (const s of stale) { try { await supa.auth.mfa.unenroll({ factorId: s.id }); } catch (e) {} }
    const { data, error } = await supa.auth.mfa.enroll({ factorType: "totp", friendlyName: "BlockView Admin" });
    if (error) { show("mfa"); return mfaErr(error.message); }
    mfa.mode = "enroll"; mfa.factorId = data.id;
    $("mfa-title").textContent = "הגדרת אימות דו-שלבי";
    $("mfa-sub").textContent = "אבטחת מנהל היא חובה. סרוק את הקוד ואשר עם 6 ספרות.";
    $("mfa-enroll").hidden = false;
    $("mfa-qr").innerHTML = data.totp.qr_code || "";
    $("mfa-secret").textContent = data.totp.secret || "";
    show("mfa"); $("mfa-code").value = ""; $("mfa-code").focus();
  }

  async function startChallenge(factorId) {
    mfa.mode = "challenge"; mfa.factorId = factorId;
    const { data, error } = await supa.auth.mfa.challenge({ factorId });
    if (error) { show("mfa"); return mfaErr(error.message); }
    mfa.challengeId = data.id;
    $("mfa-title").textContent = "אימות דו-שלבי";
    $("mfa-sub").textContent = "הזן את הקוד בן 6 הספרות מאפליקציית האימות";
    $("mfa-enroll").hidden = true;
    show("mfa"); $("mfa-code").value = ""; $("mfa-code").focus();
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
      toast("אומת בהצלחה 🔐");
      show("app"); loadAll();
    } catch (err) { mfaErr(err.message || "קוד שגוי"); }
  });
  $("mfa-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("mfa-verify").click(); });
  $("mfa-signout").addEventListener("click", () => supa.auth.signOut());
  $("g-signin").addEventListener("click", async () => {
    const email = $("g-email").value.trim(), password = $("g-pw").value;
    if (!email || !password) { $("g-err").textContent = "נא למלא אימייל וסיסמה"; $("g-err").hidden = false; return; }
    const { error } = await supa.auth.signInWithPassword({ email, password });
    if (error) { $("g-err").textContent = error.message; $("g-err").hidden = false; }
  });
  $("g-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("g-signin").click(); });
  $("signout").addEventListener("click", () => supa.auth.signOut());
  $("na-signout").addEventListener("click", () => supa.auth.signOut());

  /* --------------------------------------------------------------- data */
  async function loadAll() {
    const [L, P, B, Lead] = await Promise.all([
      supa.from("listings").select("*, buildings(name,address), listing_photos(path,sort)").order("created_at", { ascending: false }),
      supa.from("profiles").select("id,email,role,plan,created_at").order("created_at", { ascending: false }),
      supa.from("buildings").select("*").order("name"),
      supa.from("leads").select("id"),
    ]);
    state.listings = L.data || [];
    state.profiles = P.data || [];
    state.buildings = B.data || [];
    state.leadCount = (Lead.data || []).length;
    state.pmap = {}; state.profiles.forEach((p) => (state.pmap[p.id] = p));
    renderStats(); renderQueue(); renderAll(); renderUsers(); renderBuildings(); renderRecent();
  }

  const byStatus = (s) => state.listings.filter((l) => l.status === s).length;

  function renderStats() {
    $("stats").innerHTML =
      `<div class="stat"><b>${state.listings.length}</b><span>נכסים בסך הכל</span></div>` +
      `<div class="stat"><b>${byStatus("pending")}</b><span>ממתינים לאישור</span></div>` +
      `<div class="stat"><b>${byStatus("approved")}</b><span>מאושרים (במפה)</span></div>` +
      `<div class="stat"><b>${state.profiles.length}</b><span>משתמשים</span></div>` +
      `<div class="stat"><b>${state.profiles.filter((p) => p.plan === "pro").length}</b><span>מנויי Pro</span></div>` +
      `<div class="stat"><b>${state.leadCount}</b><span>לידים</span></div>`;
    $("queue-badge").textContent = byStatus("pending");
  }

  function agentLabel(id) { const p = state.pmap[id]; return p ? p.email : "—"; }

  function listingRow(l, withActions) {
    const ph = (l.listing_photos || []).sort((a, b) => a.sort - b.sort)[0];
    const b = l.buildings || {};
    const thumb = ph ? `<img class="rthumb" src="${esc(photoUrl(ph.path))}" alt="" />` : `<div class="rthumb">🏠</div>`;
    const more = (l.listing_photos || []).slice(1, 5)
      .map((p) => `<img src="${esc(photoUrl(p.path))}" alt="" />`).join("");
    return `<div class="row" data-id="${esc(l.id)}">
      ${thumb}
      <div class="rmain">
        <div class="rtitle">${esc(l.title)}</div>
        <div class="rsub">${esc(b.name || "")} · ${esc(b.address || "")}</div>
        <div class="rmeta">
          <span>${l.deal === "sale" ? "מכירה" : "השכרה"}</span>
          <span>${esc(l.rooms)} חד'</span><span>${esc(l.size)} מ"ר</span><span>קומה ${esc(l.floor)}</span>
          <span>${esc(l.poster_type === "agent" ? "סוכן" : "בעל נכס")}: ${esc(agentLabel(l.agent_id))}</span>
          <span>${esc(when(l.created_at))}</span>
          <span class="badge ${esc(l.status)}">${esc(ST[l.status] || l.status)}</span>
        </div>
        ${more ? `<div class="thumbs-mini">${more}</div>` : ""}
        ${l.description ? `<div class="rsub">${esc(String(l.description).slice(0, 160))}</div>` : ""}
      </div>
      <div class="rprice">${nis(l.price)}${l.deal === "rent" ? " / לחודש" : ""}</div>
      <div class="ractions">
        ${withActions ? `<button class="btn-ok" data-approve="${esc(l.id)}">אשר</button>
                         <button class="btn-bad" data-reject="${esc(l.id)}">דחה</button>` : ""}
        ${!withActions ? `<select class="input" data-status="${esc(l.id)}">
            ${Object.keys(ST).map((s) => `<option value="${s}"${s === l.status ? " selected" : ""}>${ST[s]}</option>`).join("")}
          </select>
          <button class="btn-bad" data-del="${esc(l.id)}">מחק</button>` : ""}
      </div>
    </div>`;
  }

  function renderQueue() {
    const rows = state.listings.filter((l) => l.status === "pending");
    $("queue-empty").hidden = rows.length > 0;
    $("queue-list").innerHTML = rows.map((l) => listingRow(l, true)).join("");
  }

  function renderAll() {
    const q = $("l-search").value.trim().toLowerCase();
    const st = $("l-status").value;
    const rows = state.listings.filter((l) => {
      if (st !== "all" && l.status !== st) return false;
      if (!q) return true;
      const b = l.buildings || {};
      return (l.title + " " + (b.name || "") + " " + (b.address || "")).toLowerCase().includes(q);
    });
    $("all-empty").hidden = rows.length > 0;
    $("all-list").innerHTML = rows.map((l) => listingRow(l, false)).join("");
  }
  $("l-search").addEventListener("input", renderAll);
  $("l-status").addEventListener("change", renderAll);

  function renderRecent() {
    $("recent").innerHTML = state.listings.slice(0, 5).map((l) => listingRow(l, false)).join("") ||
      `<div class="empty">אין פעילות עדיין.</div>`;
  }

  /* ---------------------------------------------------- listing actions */
  document.addEventListener("click", async (e) => {
    const ap = e.target.closest("[data-approve]");
    const rj = e.target.closest("[data-reject]");
    const dl = e.target.closest("[data-del]");
    if (ap) return setStatus(ap.dataset.approve, "approved");
    if (rj) return setStatus(rj.dataset.reject, "rejected");
    if (dl) {
      if (!confirm("למחוק את הנכס לצמיתות?")) return;
      const { error } = await supa.from("listings").delete().eq("id", dl.dataset.del);
      if (error) return toast("שגיאה במחיקה");
      toast("הנכס נמחק"); loadAll();
    }
  });
  document.addEventListener("change", async (e) => {
    const s = e.target.closest("[data-status]");
    if (s) setStatus(s.dataset.status, s.value);
    const r = e.target.closest("[data-role]");
    if (r) setRole(r.dataset.role, r.value);
    const pl = e.target.closest("[data-plan]");
    if (pl) setPlan(pl.dataset.plan, pl.value);
  });
  async function setStatus(id, status) {
    const { error } = await supa.from("listings").update({ status }).eq("id", id);
    if (error) return toast("שגיאה: " + error.message);
    toast("סטטוס עודכן ל: " + (ST[status] || status));
    loadAll();
  }

  /* ------------------------------------------------------------- users */
  function renderUsers() {
    const q = $("u-search").value.trim().toLowerCase();
    const rows = state.profiles.filter((p) => !q || String(p.email || "").toLowerCase().includes(q));
    $("users-list").innerHTML = rows.map((p) => `
      <div class="row">
        <div class="uavatar">${esc(String(p.email || "?").charAt(0).toUpperCase())}</div>
        <div class="rmain">
          <div class="rtitle">${esc(p.email || "(ללא אימייל)")}</div>
          <div class="rmeta">
            <span class="badge ${esc(p.role)}">${esc(p.role)}</span>
            <span class="badge ${p.plan === "pro" ? "pro" : "user"}">${esc(p.plan)}</span>
            <span>הצטרף ${esc(when(p.created_at))}</span>
            <span>${state.listings.filter((l) => l.agent_id === p.id).length} נכסים</span>
          </div>
        </div>
        <div class="ractions">
          <select class="input" data-role="${esc(p.id)}">
            <option value="user"${p.role === "user" ? " selected" : ""}>משתמש</option>
            <option value="agent"${p.role === "agent" ? " selected" : ""}>סוכן</option>
            <option value="admin"${p.role === "admin" ? " selected" : ""}>מנהל</option>
          </select>
          <select class="input" data-plan="${esc(p.id)}">
            <option value="free"${p.plan !== "pro" ? " selected" : ""}>מנוי: חינם</option>
            <option value="pro"${p.plan === "pro" ? " selected" : ""}>מנוי: Pro</option>
          </select>
        </div>
      </div>`).join("") || `<div class="empty">לא נמצאו משתמשים.</div>`;
  }
  $("u-search").addEventListener("input", renderUsers);
  async function setRole(id, role) {
    if (id === state.user.id && role !== "admin" && !confirm("להוריד לעצמך הרשאות מנהל?")) return loadAll();
    const { error } = await supa.from("profiles").update({ role }).eq("id", id);
    if (error) return toast("שגיאה: " + error.message);
    toast("ההרשאה עודכנה"); loadAll();
  }
  // subscription plan (server-side: only an admin may change plan — protect_profile_fields)
  async function setPlan(id, plan) {
    const { error } = await supa.from("profiles").update({ plan }).eq("id", id);
    if (error) return toast("שגיאה: " + error.message);
    toast(plan === "pro" ? "המנוי שודרג ל-Pro ⭐" : "המנוי הוחזר לחינם");
    loadAll();
  }

  /* --------------------------------------------------------- buildings */
  function renderBuildings() {
    $("buildings-list").innerHTML = state.buildings.map((b) => `
      <div class="row">
        <div class="rthumb">🏢</div>
        <div class="rmain">
          <div class="rtitle">${esc(b.name)}</div>
          <div class="rsub">${esc(b.address)} · ${esc(b.city)}</div>
          <div class="rmeta"><span>${esc(b.id)}</span><span>${esc(b.lng)}, ${esc(b.lat)}</span>
            <span>${state.listings.filter((l) => l.building_id === b.id).length} נכסים</span></div>
        </div>
        <div class="ractions"><button class="btn-bad" data-delb="${esc(b.id)}">מחק</button></div>
      </div>`).join("") || `<div class="empty">אין בניינים.</div>`;
  }
  document.addEventListener("click", async (e) => {
    const d = e.target.closest("[data-delb]");
    if (!d) return;
    if (!confirm("מחיקת בניין תמחק גם את כל הנכסים שבו. להמשיך?")) return;
    const { error } = await supa.from("buildings").delete().eq("id", d.dataset.delb);
    if (error) return toast("שגיאה: " + error.message);
    toast("הבניין נמחק"); loadAll();
  });
  $("b-form").addEventListener("submit", async (e) => {
    e.preventDefault(); $("b-err").hidden = true;
    const row = {
      id: $("b-id").value.trim(), name: $("b-name").value.trim(), address: $("b-address").value.trim(),
      city: $("b-city").value.trim() || "תל אביב-יפו",
      lng: +$("b-lng").value, lat: +$("b-lat").value, height: +$("b-height").value || 24,
    };
    const { error } = await supa.from("buildings").insert(row);
    if (error) { $("b-err").textContent = error.message; $("b-err").hidden = false; return; }
    toast("הבניין נוסף"); $("b-form").reset(); $("b-city").value = "תל אביב-יפו"; $("b-height").value = 24;
    loadAll();
  });

  /* -------------------------------------------------------------- tabs */
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    ["overview", "queue", "listings", "users", "buildings"].forEach((n) => ($("tab-" + n).hidden = n !== t.dataset.tab));
  }));
})();
