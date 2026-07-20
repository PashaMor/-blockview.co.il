/* BlockView — superadmin console.
 * Security: admin-only. Every query is still under RLS (admin policies use the
 * SECURITY DEFINER is_admin() helper). All user text is HTML-escaped on render.
 */
(function () {
  const cfg = window.BLOCKVIEW_CONFIG;
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY,
    window.BVOAuth ? BVOAuth.clientOptions() : undefined);
  const $ = (id) => document.getElementById(id);
  const BUCKET = "listing-photos";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nis = (n) => "₪" + Number(n || 0).toLocaleString("he-IL");
  const ST = { pending: "ממתין", approved: "מאושר", rejected: "נדחה", sold: "נמכר", draft: "טיוטה" };
  const when = (d) => new Date(d).toLocaleDateString("he-IL");

  const state = { user: null, listings: [], profiles: [], pmap: {}, buildings: [], leadCount: 0, apps: [], appsMissing: false };

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
  // Google / Apple. The role check and mandatory 2FA below still apply — a social
  // login grants no admin power on its own.
  if (window.BVOAuth) BVOAuth.wire(supa, $("gate"), (m) => { $("g-err").textContent = m; $("g-err").hidden = false; });
  $("signout").addEventListener("click", () => supa.auth.signOut());
  $("na-signout").addEventListener("click", () => supa.auth.signOut());

  /* --------------------------------------------------------------- data */
  async function loadAll() {
    const [L, P, B, Lead, A] = await Promise.all([
      supa.from("listings").select("*, buildings(name,address), listing_photos(path,sort)").order("created_at", { ascending: false }),
      supa.from("profiles").select("id,email,role,plan,created_at").order("created_at", { ascending: false }),
      supa.from("buildings").select("*").order("name"),
      supa.from("leads").select("id"),
      // 07_agent_applications.sql may not have been run yet — degrade gracefully
      supa.from("agent_applications").select("*").order("created_at", { ascending: false }),
    ]);
    state.listings = L.data || [];
    state.profiles = P.data || [];
    state.buildings = B.data || [];
    state.leadCount = (Lead.data || []).length;
    state.apps = A.data || [];
    state.appsMissing = !!A.error;
    state.pmap = {}; state.profiles.forEach((p) => (state.pmap[p.id] = p));
    renderStats(); renderQueue(); renderAll(); renderUsers(); renderBuildings(); renderRecent(); renderApps();
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
    $("agents-badge").textContent = state.apps.filter((a) => a.status === "pending").length;
  }

  /* ------------------------------------------------- agent applications */
  const APP_ST = { pending: "ממתין", approved: "אושר", rejected: "נדחה" };

  function appRow(a) {
    const p = state.pmap[a.user_id] || {};
    const acted = a.status === "pending";
    return `<div class="row">
      <div class="uavatar">${esc(String(a.full_name || p.email || "?").charAt(0).toUpperCase())}</div>
      <div class="rmain">
        <div class="rtitle">${esc(a.full_name)} <span class="badge ${esc(a.status)}">${esc(APP_ST[a.status] || a.status)}</span></div>
        <div class="rsub">${esc(p.email || "—")} · ${esc(a.phone)}</div>
        <div class="rmeta">
          ${a.agency ? `<span>משרד: ${esc(a.agency)}</span>` : ""}
          ${a.license_no ? `<span>רישיון: ${esc(a.license_no)}</span>` : ""}
          ${a.city ? `<span>${esc(a.city)}</span>` : ""}
          <span>הוגש ${esc(when(a.created_at))}</span>
          <span class="badge ${esc(p.role || "user")}">${esc(p.role || "user")}</span>
        </div>
        ${a.note ? `<div class="rsub">${esc(String(a.note).slice(0, 300))}</div>` : ""}
        ${a.admin_note ? `<div class="rsub">הערת מנהל: ${esc(a.admin_note)}</div>` : ""}
      </div>
      <div class="ractions">
        ${acted ? `<button class="btn-ok" data-appok="${esc(a.user_id)}">אשר כסוכן</button>
                   <button class="btn-bad" data-appno="${esc(a.user_id)}">דחה</button>`
                : `<button class="btn-ghost" data-appok="${esc(a.user_id)}">אשר כסוכן</button>`}
      </div>
    </div>`;
  }

  function renderApps() {
    const st = $("a-status").value;
    if (state.appsMissing) {
      $("agents-list").innerHTML = `<div class="empty">טבלת הבקשות לא קיימת עדיין — הרץ את supabase/07_agent_applications.sql.</div>`;
      $("agents-empty").hidden = true;
      return;
    }
    const rows = state.apps.filter((a) => st === "all" || a.status === st);
    $("agents-empty").hidden = rows.length > 0;
    $("agents-list").innerHTML = rows.map(appRow).join("");
  }
  $("a-status").addEventListener("change", renderApps);

  // approval happens in one DB call: review_agent_application() checks is_admin()
  // (role admin + aal2) and flips the application status and profiles.role together.
  async function reviewApp(userId, decision) {
    let note = "";
    if (decision === "rejected") {
      const r = prompt("סיבת הדחייה (תוצג למבקש):", "");
      if (r === null) return;
      note = r.trim();
    } else if (!confirm("לאשר את המשתמש כסוכן? תיפתח לו גישה מלאה ל-CRM.")) return;
    const { error } = await supa.rpc("review_agent_application", { target: userId, decision, note });
    if (error) return toast("שגיאה: " + error.message);
    toast(decision === "approved" ? "אושר כסוכן ✓" : "הבקשה נדחתה");
    loadAll();
  }
  document.addEventListener("click", (e) => {
    const ok = e.target.closest("[data-appok]");
    if (ok) return reviewApp(ok.dataset.appok, "approved");
    const no = e.target.closest("[data-appno]");
    if (no) return reviewApp(no.dataset.appno, "rejected");
  });

  function agentLabel(id) { const p = state.pmap[id]; return p ? p.email : "—"; }

  const sortedPhotos = (l) => (l.listing_photos || []).slice().sort((a, b) => a.sort - b.sort);

  /* Moderation needs to SEE the property: every photo, big enough to judge, and
     clickable for the full-size version. "no photos" is stated explicitly so it
     can't be mistaken for images that failed to load. */
  function photoGallery(l) {
    const ps = sortedPhotos(l);
    if (!ps.length) return `<div class="nophotos">אין תמונות לנכס הזה</div>`;
    return `<div class="gallery">` + ps.map((p) =>
      `<img class="gph" src="${esc(photoUrl(p.path))}" data-full="${esc(photoUrl(p.path))}" alt="" loading="lazy" />`
    ).join("") + `<span class="gcount">${ps.length} תמונות</span></div>`;
  }

  function listingRow(l, withActions) {
    const ph = sortedPhotos(l)[0];
    const b = l.buildings || {};
    const thumb = ph ? `<img class="rthumb gph" src="${esc(photoUrl(ph.path))}" data-full="${esc(photoUrl(ph.path))}" alt="" />` : `<div class="rthumb">🏠</div>`;
    // pending listings get the full gallery; elsewhere a compact strip is enough
    const more = withActions
      ? photoGallery(l)
      : (() => {
          const rest = sortedPhotos(l).slice(1, 5)
            .map((p) => `<img class="gph" src="${esc(photoUrl(p.path))}" data-full="${esc(photoUrl(p.path))}" alt="" />`).join("");
          return rest ? `<div class="thumbs-mini">${rest}</div>` : "";
        })();
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
        ${more}
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

  /* full-size viewer — src comes from our own storage bucket, never user HTML */
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".gph");
    if (!img) return;
    const box = $("lightbox");
    $("lightbox-img").src = img.dataset.full;
    box.hidden = false;
  });
  $("lightbox").addEventListener("click", () => {
    $("lightbox").hidden = true; $("lightbox-img").src = "";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("lightbox").hidden) { $("lightbox").hidden = true; $("lightbox-img").src = ""; }
  });

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
    ["overview", "queue", "agents", "listings", "users", "buildings"].forEach((n) => ($("tab-" + n).hidden = n !== t.dataset.tab));
  }));
})();

/* ---- password reset (shared /reset page) ---- */
(function () {
  const go = (email) => (window.location.href = "https://blockview.co.il/reset" + (email ? "?email=" + encodeURIComponent(email) : ""));
  const f = document.getElementById("g-forgot");
  if (f) f.addEventListener("click", () => go(document.getElementById("g-email").value.trim()));
  const p = document.getElementById("sm-password");
  if (p) p.addEventListener("click", () => go(document.getElementById("sm-email").textContent.trim()));
})();
