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

  const state = { user: null, listings: [], profiles: [], pmap: {}, buildings: [], leadCount: 0, leads: [], apps: [], appsMissing: false, agentProfiles: [], apmap: {} };

  let tt; function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2400); }

  /* ---------------------------------------------------- confirm dialog ----
   * Replaces window.confirm / window.prompt. The browser suppresses those after
   * a few in a row ("prevent this page from creating additional dialogs"), and
   * a silently-cancelled destructive action looks exactly like a broken button.
   * Returns a promise: true when confirmed, false otherwise.
   *   opts.mustType — the text the admin has to retype (e.g. an email address)
   */
  function askConfirm(opts) {
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.className = "bv-modal-back";
      const box = document.createElement("div");
      box.className = "bv-modal" + (opts.danger ? " danger" : "");

      const h = document.createElement("h3");
      h.textContent = opts.title || "לאשר?";
      box.appendChild(h);

      (opts.lines || []).forEach((line) => {
        const p = document.createElement("p");
        p.textContent = line;
        box.appendChild(p);
      });

      let input = null;
      if (opts.mustType) {
        const lbl = document.createElement("p");
        lbl.className = "bv-modal-hint";
        lbl.textContent = "להמשך, הקלד: " + opts.mustType;
        box.appendChild(lbl);
        input = document.createElement("input");
        input.className = "input";
        input.setAttribute("autocomplete", "off");
        box.appendChild(input);
      }

      const row = document.createElement("div");
      row.className = "bv-modal-actions";
      const cancel = document.createElement("button");
      cancel.className = "btn-ghost";
      cancel.textContent = "ביטול";
      const ok = document.createElement("button");
      ok.className = opts.danger ? "btn-bad" : "btn-ok";
      ok.textContent = opts.okText || "אישור";
      row.appendChild(cancel); row.appendChild(ok);
      box.appendChild(row);
      back.appendChild(box);
      document.body.appendChild(back);
      (input || ok).focus();

      function close(result) {
        document.removeEventListener("keydown", onKey, true);
        back.remove();
        resolve(result);
      }
      function accept() {
        if (opts.mustType &&
            input.value.trim().toLowerCase() !== String(opts.mustType).toLowerCase()) {
          input.classList.add("bad");
          toast("הטקסט לא תואם");
          return;
        }
        close(true);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); close(false); }
        else if (e.key === "Enter" && document.body.contains(back)) { e.preventDefault(); accept(); }
      }
      cancel.addEventListener("click", () => close(false));
      ok.addEventListener("click", accept);
      back.addEventListener("click", (e) => { if (e.target === back) close(false); });
      document.addEventListener("keydown", onKey, true);
    });
  }
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
    if (!(await askConfirm({ title: "החלפת מכשיר 2FA", lines: ["תתבקש לסרוק קוד חדש כעת."], okText: "החלף מכשיר" }))) return;
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
    const [L, P, B, Lead, A, AP, AU, REV] = await Promise.all([
      supa.from("listings").select("*, buildings(name,address), listing_photos(path,sort), listing_contacts(name,phone,email,sort)").order("created_at", { ascending: false }),
      supa.from("profiles").select("*").order("created_at", { ascending: false }),
      supa.from("buildings").select("*").order("name"),
      supa.from("leads").select("id,agent_id"),
      // 07_agent_applications.sql may not have been run yet — degrade gracefully
      supa.from("agent_applications").select("*").order("created_at", { ascending: false }),
      // 09_agent_profile.sql — approved agents' firm / licence / logo
      supa.from("agent_profiles").select("*"),
      // 21_admin_confirm_email.sql — email confirmation lives in auth.users,
      // which the browser cannot read, so an admin-only function returns it
      supa.rpc("admin_auth_status"),
      // 26_listing_revisions.sql — what changed on each listing, newest first
      supa.from("listing_revisions").select("*").order("changed_at", { ascending: false }).limit(400),
    ]);
    state.authmap = {};
    (AU.data || []).forEach((u) => (state.authmap[u.user_id] = u));
    // keep the most recent edit per listing that a person actually made
    state.revisions = {};
    (REV.data || []).forEach((r) => {
      if (state.revisions[r.listing_id]) return;                 // newer one already kept
      if (!r.changes || !Object.keys(r.changes).length) return;  // status-only change
      state.revisions[r.listing_id] = r;
    });
    state.listings = L.data || [];
    state.profiles = P.data || [];
    state.buildings = B.data || [];
    state.leads = Lead.data || [];
    state.leadCount = state.leads.length;
    state.apps = A.data || [];
    state.agentProfiles = AP.data || [];
    state.apmap = {}; state.agentProfiles.forEach((a) => (state.apmap[a.user_id] = a));
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

  const logoUrl = (p) => supa.storage.from("agent-logos").getPublicUrl(p).data.publicUrl;

  function appRow(a) {
    const p = state.pmap[a.user_id] || {};
    const acted = a.status === "pending";
    const name = ((a.first_name || "") + " " + (a.last_name || "")).trim() || a.full_name || "";
    const badge = a.logo_path
      ? `<img class="alogo" src="${esc(logoUrl(a.logo_path))}" alt="" />`
      : `<div class="uavatar">${esc(String(name || p.email || "?").charAt(0).toUpperCase())}</div>`;
    return `<div class="row">
      ${badge}
      <div class="rmain">
        <div class="rtitle">${esc(name)} <span class="badge ${esc(a.status)}">${esc(APP_ST[a.status] || a.status)}</span></div>
        <div class="rsub">${esc(p.email || "—")} · ${esc(a.phone)}</div>
        <div class="rmeta">
          ${a.agency ? `<span>משרד: ${esc(a.agency)}</span>` : ""}
          ${a.license_no ? `<span>רישיון: ${esc(a.license_no)}</span>` : ""}
          ${a.logo_path ? "" : "<span>⚠️ ללא לוגו</span>"}
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
    } else if (!(await askConfirm({ title: "אישור כסוכן", lines: ["תיפתח לו גישה מלאה ל-CRM."], okText: "אשר כסוכן" }))) return;
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

  /* the accounts a listing may be moved to: agents and admins. The current
     owner is kept selected (and added even if they are not an agent, so the
     dropdown never silently changes who owns the listing). */
  function agentOptions(currentId) {
    const agents = state.profiles.filter((p) => p.role === "agent" || p.role === "admin");
    const ids = {};
    agents.forEach((a) => (ids[a.id] = true));
    let opts = agents.map((p) =>
      `<option value="${esc(p.id)}"${p.id === currentId ? " selected" : ""}>` +
      `${esc(p.email)}${p.role === "admin" ? " (מנהל)" : ""}</option>`).join("");
    if (currentId && !ids[currentId]) {
      const p = state.pmap[currentId];
      opts = `<option value="${esc(currentId)}" selected>${esc(p ? p.email : currentId)}</option>` + opts;
    }
    return opts;
  }
  async function reassignListing(listingId, agentId) {
    const p = state.pmap[agentId] || {};
    const ok = await askConfirm({
      title: "העברת נכס לסוכן",
      lines: ["הנכס יועבר לחשבון:", p.email || agentId, "הסוכן ינהל אותו מה-CRM שלו."],
      okText: "העבר",
    });
    if (!ok) return loadAll();                 // cancelled — reset the dropdown
    const { error } = await supa.rpc("admin_reassign_listing", { p_listing: listingId, p_agent: agentId });
    if (error) return toast("שגיאה: " + (error.message || error));
    toast("הנכס הועבר לסוכן");
    loadAll();
  }

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

  /* contact people — admins always see the full details (RLS lets them) */
  function contactList(l) {
    const cs = (l.listing_contacts || []).slice().sort((a, b) => a.sort - b.sort);
    if (!cs.length) return "";
    return `<div class="contacts">` + cs.map((c) =>
      `<span class="ct"><b>${esc(c.name)}</b>` +
      `<a class="ltr" href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` +
      (c.email ? `<a class="ltr" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "") +
      `</span>`).join("") + `</div>`;
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
        ${contactList(l)}
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
          <label class="reassign-lbl">העבר לסוכן
            <select class="input" data-reassign="${esc(l.id)}" data-current="${esc(l.agent_id)}">${agentOptions(l.agent_id)}</select>
          </label>
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

  /* ---- what changed since the last approval (26_listing_revisions.sql) ----
   * A listing that was already live and got edited comes back here. Showing the
   * diff means re-reading only what moved, not the whole listing. */
  const FIELD_HE = {
    title: "כותרת", description: "תיאור", price: "מחיר", rooms: "חדרים", size: 'שטח (מ"ר)',
    floor: "קומה", floors_total: "סך הקומות", type: "סוג נכס", category: "ייעוד",
    deal: "סוג עסקה", age: "גיל הבניין", furnished: "מרוהט", pets: "חיות מחמד",
    parking: "חניה", elevator: "מעלית", tour_url: "סיור וירטואלי",
    website_url: "קישור לאתר", building_id: "בניין",
  };
  const VALUE_HE = {
    sale: "מכירה", rent: "השכרה", flat: "דירה", house: "בית", penthouse: "פנטהאוז",
    studio: "סטודיו", office: "משרד", shop: "חנות", warehouse: "מחסן", other: "אחר",
    residential: "מגורים", commercial: "מסחרי", new: "חדש", old: "ישן",
    true: "כן", false: "לא", null: "—", "": "—",
  };
  function showValue(field, v) {
    if (v === null || v === undefined || v === "") return "—";
    if (field === "price") return nis(v);
    var key = String(v);
    if (Object.prototype.hasOwnProperty.call(VALUE_HE, key)) return VALUE_HE[key];
    // long text: enough to recognise the change, not the whole essay
    return key.length > 90 ? key.slice(0, 90) + "…" : key;
  }

  function changesBlock(listingId) {
    const rev = (state.revisions || {})[listingId];
    if (!rev) return "";
    const fields = Object.keys(rev.changes || {});
    if (!fields.length) return "";
    const rows = fields.map((f) => `
      <div class="chg-row">
        <span class="chg-field">${esc(FIELD_HE[f] || f)}</span>
        <span class="chg-from">${esc(showValue(f, rev.changes[f].from))}</span>
        <span class="chg-arrow">←</span>
        <span class="chg-to">${esc(showValue(f, rev.changes[f].to))}</span>
      </div>`).join("");
    return `<div class="changes">
      <div class="chg-head">✏️ שונה מאז האישור הקודם · ${esc(dt(rev.changed_at))}</div>
      ${rows}
    </div>`;
  }

  function renderQueue() {
    const rows = state.listings.filter((l) => l.status === "pending");
    $("queue-empty").hidden = rows.length > 0;
    $("queue-list").innerHTML = rows.map((l) => listingRow(l, true) + changesBlock(l.id)).join("");
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
      if (!(await askConfirm({ title: "מחיקת נכס", lines: ["הנכס והתמונות שלו יימחקו לצמיתות."], okText: "מחק נכס", danger: true }))) return;
      const { error } = await supa.from("listings").delete().eq("id", dl.dataset.del);
      if (error) return toast("שגיאה במחיקה");
      toast("הנכס נמחק"); loadAll();
    }
  });
  document.addEventListener("change", async (e) => {
    const s = e.target.closest("[data-status]");
    if (s) setStatus(s.dataset.status, s.value);
    const rs = e.target.closest("[data-reassign]");
    if (rs && rs.value !== rs.dataset.current) return reassignListing(rs.dataset.reassign, rs.value);
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
    const role = $("u-role").value, plan = $("u-plan").value;
    const rows = state.profiles.filter((p) => {
      if (role !== "all" && p.role !== role) return false;
      if (plan !== "all" && (p.plan === "pro" ? "pro" : "free") !== plan) return false;
      if (!q) return true;
      // search the firm and licence too, not just the email
      const a = state.apmap[p.id] || {};
      return (String(p.email || "") + " " + (a.agency || "") + " " + (a.license_no || "") +
              " " + (a.first_name || "") + " " + (a.last_name || "")).toLowerCase().includes(q);
    });
    $("u-count").textContent = rows.length;
    $("users-list").innerHTML = rows.map((p) => `
      <div class="urow" data-urow="${esc(p.id)}">
      <div class="row">
        <div class="uavatar">${esc(String(p.email || "?").charAt(0).toUpperCase())}</div>
        <div class="rmain">
          <div class="rtitle">${esc(p.email || "(ללא אימייל)")}</div>
          <div class="rmeta">
            <span class="badge ${esc(p.role)}">${esc(p.role)}</span>
            <span class="badge ${p.plan === "pro" ? "pro" : "user"}">${esc(p.plan)}</span>
            <span>הצטרף ${esc(when(p.created_at))}</span>
            <span>${state.listings.filter((l) => l.agent_id === p.id).length} נכסים</span>
            ${agentBadges(p.id)}
          </div>
        </div>
        <div class="ractions">
          <span class="approval-cell">${approvalCell(p)}</span>
          <button class="btn-ghost" data-userdet="${esc(p.id)}">פרטים</button>
          <select class="input" data-role="${esc(p.id)}">
            <option value="user"${p.role === "user" ? " selected" : ""}>משתמש</option>
            <option value="agent"${p.role === "agent" ? " selected" : ""}>סוכן</option>
            <option value="admin"${p.role === "admin" ? " selected" : ""}>מנהל</option>
          </select>
          <select class="input" data-plan="${esc(p.id)}">
            <option value="free"${p.plan !== "pro" ? " selected" : ""}>מנוי: חינם</option>
            <option value="pro"${p.plan === "pro" ? " selected" : ""}>מנוי: Pro</option>
          </select>
          ${p.id === state.user.id ? "" : `<button class="btn-bad" data-deluser="${esc(p.id)}">מחק משתמש</button>`}
        </div>
      </div>
      <div class="udetail" id="ud-${esc(p.id)}" hidden></div>
      </div>`).join("") || `<div class="empty">לא נמצאו משתמשים.</div>`;
  }
  $("u-search").addEventListener("input", renderUsers);
  $("u-role").addEventListener("change", renderUsers);
  $("u-plan").addEventListener("change", renderUsers);

  /* ------------------------------------------------- one user's details */
  const yesno = (v) => (v ? "כן" : "לא");
  // firm + licence at a glance on the row (agents only)
  function agentBadges(uid) {
    const a = state.apmap[uid];
    if (!a) return "";
    return (a.agency ? `<span>🏢 ${esc(a.agency)}</span>` : "") +
           (a.license_no ? `<span>רישיון ${esc(a.license_no)}</span>` : "");
  }

  /* ---- agent approval: state at a glance + one-click decision ----
   * The badge answers "is this user approved as an agent?" in the users list.
   * Approving goes through review_agent_application() when an application
   * exists (it also publishes the branding), and falls back to a plain role
   * change for users who never applied. */
  const APPROVAL = {
    approved: { cls: "approved", label: "✅ סוכן מאושר" },
    pending:  { cls: "pending",  label: "⏳ ממתין לאישור" },
    rejected: { cls: "rejected", label: "✖ נדחה" },
  };
  function approvalOf(p) {
    const a = state.apmap[p.id];
    if (p.role === "admin") return { cls: "admin", label: "מנהל מערכת" };
    if (p.role === "agent") return APPROVAL.approved;
    if (a) return APPROVAL[a.status] || APPROVAL.pending;
    return { cls: "user", label: "לא סוכן" };
  }
  /* email confirmation state, and the manual override.
   * The real gate is in the database: admin_confirm_email() re-checks is_admin()
   * (admin + 2FA). Handy when mail is slow or the address bounces. */
  function emailCell(p) {
    const au = (state.authmap || {})[p.id];
    if (!au) return "";                                   // 21_admin_confirm_email.sql not run yet
    if (au.email_confirmed_at)
      return `<span class="badge approved" title="אומת ${esc(dt(au.email_confirmed_at))}">📧 אימייל מאומת</span>`;
    return `<span class="badge pending">📧 אימייל לא מאומת</span>` +
           `<button class="btn-ok sm" data-confirmemail="${esc(p.id)}">אמת ידנית</button>`;
  }
  async function confirmEmail(uid) {
    const p = state.pmap[uid] || {};
    const go = await askConfirm({
      title: "אימות אימייל ידני",
      lines: [p.email || uid, "המשתמש יוכל להתחבר בלי ללחוץ על הקישור שנשלח אליו."],
      okText: "אמת אימייל",
    });
    if (!go) return;
    const { error } = await supa.rpc("admin_confirm_email", { target: uid });
    if (error) {
      if (/FORBIDDEN/.test(error.message)) return toast("נדרשת הרשאת מנהל עם אימות דו-שלבי");
      return toast("שגיאה: " + error.message);
    }
    toast("האימייל אומת ✓"); loadAll();
  }

  function approvalCell(p) {
    const st = approvalOf(p);
    const a = state.apmap[p.id];
    const canApprove = p.role !== "agent" && p.role !== "admin";
    const canRevoke = p.role === "agent";
    return emailCell(p) +
      `<span class="badge ${esc(st.cls)}">${esc(st.label)}</span>` +
      (canApprove ? `<button class="btn-ok sm" data-approveagent="${esc(p.id)}">אשר כסוכן</button>` : "") +
      (a && a.status === "pending" ? `<button class="btn-bad sm" data-rejectagent="${esc(p.id)}">דחה</button>` : "") +
      (canRevoke ? `<button class="btn-bad sm" data-revokeagent="${esc(p.id)}">בטל הרשאת סוכן</button>` : "");
  }

  async function approveAgent(uid) {
    const p = state.pmap[uid] || {};
    const app = state.apmap[uid];
    const go = await askConfirm({
      title: "אישור כסוכן",
      lines: [p.email || uid, "תיפתח לו גישה מלאה ל-CRM ולפרסום נכסים."],
      okText: "אשר כסוכן",
    });
    if (!go) return;
    let error;
    if (app) {
      // the RPC flips the application, the role and the public branding together
      ({ error } = await supa.rpc("review_agent_application", { target: uid, decision: "approved", note: "" }));
    } else {
      // no application on file — approve the role only, and say what is missing
      ({ error } = await supa.from("profiles").update({ role: "agent" }).eq("id", uid));
      if (!error) toast("אושר כסוכן. אין בקשה בתיק — שם המשרד, הרישיון והלוגו חסרים.");
    }
    if (error) return toast("שגיאה: " + error.message);
    if (app) toast("אושר כסוכן ✓");
    loadAll();
  }
  async function revokeAgent(uid) {
    const p = state.pmap[uid] || {};
    const go = await askConfirm({
      title: "ביטול הרשאת סוכן",
      lines: [p.email || uid, "הנכסים שלו יישארו, אך הוא לא יוכל לנהל אותם."],
      okText: "בטל הרשאה", danger: true,
    });
    if (!go) return;
    const { error } = await supa.from("profiles").update({ role: "user" }).eq("id", uid);
    if (error) return toast("שגיאה: " + error.message);
    toast("הרשאת הסוכן בוטלה"); loadAll();
  }
  /* ---- delete a user for good ----
   * admin_delete_user() re-checks is_admin() (admin + 2FA) in the database, so
   * the confirmation below is a guard against slips, not the security boundary.
   * The deletion cascades to the user's listings, photos, leads and enquiries. */
  /* Files must go through the Storage API — Supabase refuses DELETE on
   * storage.objects from SQL. Paths are <uid>/... and <uid>/<listing>/...,
   * so this walks one level down. Best effort: if it fails we still delete the
   * account, and the leftovers are unreachable from any listing. */
  async function purgeUserFiles(uid) {
    for (const bucket of ["listing-photos", "agent-logos"]) {
      try {
        const paths = [];
        const { data: top } = await supa.storage.from(bucket).list(uid, { limit: 1000 });
        for (const entry of top || []) {
          if (entry.id) { paths.push(`${uid}/${entry.name}`); continue; }   // a file
          const { data: inner } = await supa.storage.from(bucket).list(`${uid}/${entry.name}`, { limit: 1000 });
          (inner || []).forEach((f) => paths.push(`${uid}/${entry.name}/${f.name}`));
        }
        if (paths.length) await supa.storage.from(bucket).remove(paths);
      } catch (e) {
        console.warn("[BlockView] file cleanup failed for", bucket, e.message);
      }
    }
  }

  async function deleteUser(uid) {
    const p = state.pmap[uid] || {};
    const listings = state.listings.filter((l) => l.agent_id === uid).length;
    // one gate, but a deliberate one: the email has to be retyped
    const go = await askConfirm({
      title: "מחיקת משתמש לצמיתות",
      lines: [
        p.email || uid,
        `יימחקו גם ${listings} נכסים, התמונות שלהם, הלידים והבקשות שלו.`,
        "הפעולה אינה הפיכה.",
      ],
      mustType: p.email || "",
      okText: "מחק לצמיתות", danger: true,
    });
    if (!go) return;

    await purgeUserFiles(uid);          // before the account goes, while we still know the id
    const { error } = await supa.rpc("admin_delete_user", { target: uid });
    if (error) {
      const m = error.message || "";
      if (/LAST_ADMIN/.test(m)) return toast("זהו המנהל האחרון — אי אפשר למחוק");
      if (/USE_SELF_DELETE/.test(m)) return toast("אי אפשר למחוק את עצמך מכאן");
      if (/FORBIDDEN/.test(m)) return toast("נדרשת הרשאת מנהל עם אימות דו-שלבי");
      return toast("שגיאה: " + m);
    }
    toast("המשתמש נמחק"); loadAll();
  }

  document.addEventListener("click", (e) => {
    const ok = e.target.closest("[data-approveagent]");
    if (ok) return approveAgent(ok.dataset.approveagent);
    const no = e.target.closest("[data-rejectagent]");
    if (no) return reviewApp(no.dataset.rejectagent, "rejected");
    const rv = e.target.closest("[data-revokeagent]");
    if (rv) return revokeAgent(rv.dataset.revokeagent);
    const del = e.target.closest("[data-deluser]");
    if (del) return deleteUser(del.dataset.deluser);
    const ce = e.target.closest("[data-confirmemail]");
    if (ce) return confirmEmail(ce.dataset.confirmemail);
  });
  const dt = (d) => (d ? new Date(d).toLocaleString("he-IL") : "—");

  function userDetailHtml(p) {
    const mine = state.listings.filter((l) => l.agent_id === p.id);
    const leads = state.leads.filter((x) => x.agent_id === p.id).length;
    const app = (state.apps || []).find((a) => a.user_id === p.id);
    const cnt = (st) => mine.filter((l) => l.status === st).length;

    const facts = [
      ["מזהה משתמש", p.id],
      ["אימייל", p.email || "—"],
      ["תפקיד", p.role],
      ["מנוי", p.plan === "pro" ? "Pro" : "חינם"],
      ["נרשם", dt(p.created_at)],
      ["אישר תנאי שימוש", p.terms_accepted_at ? dt(p.terms_accepted_at) + (p.terms_version ? " (גרסה " + p.terms_version + ")" : "") : "לא"],
      ["התראות פוש", yesno(p.notifications)],
      ["סינון שמור", p.saved_filter ? "יש" : "אין"],
      ["ערכת נושא", p.theme || "light"],
    ];

    const listRows = mine.length
      ? mine.slice(0, 12).map((l) => `<div class="ud-listing">
          <span class="badge ${esc(l.status)}">${esc(ST[l.status] || l.status)}</span>
          <b>${esc(l.title)}</b>
          <span>${nis(l.price)}</span>
          <span>${esc(when(l.created_at))}</span>
        </div>`).join("")
      : `<div class="ud-empty">אין נכסים.</div>`;

    const appName = ((app && (app.first_name || app.last_name))
      ? ((app.first_name || "") + " " + (app.last_name || "")).trim()
      : (app && app.full_name) || "—");
    const appBlock = app ? `
      <div class="ud-sec">בקשת סוכן — <span class="badge ${esc(app.status)}">${esc(app.status)}</span></div>
      <div class="ud-grid">
        ${[["שם", appName],
           ["משרד / סוכנות", app.agency || "—"],
           ["מספר רישיון תיווך", app.license_no || "—"],
           ["טלפון", app.phone || "—"],
           ["עיר פעילות", app.city || "—"],
           ["הוגשה", dt(app.created_at)],
           ["הערת המבקש", app.note || "—"],
           ["הערת מנהל", app.admin_note || "—"]]
          .map(([k, v]) => `<div class="ud-f"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
      </div>` : "";

    // The branding printed on this agent's listings. Shown for every agent — an
    // agent promoted by hand (not through the application form) has no row yet,
    // so the admin can type the firm and licence in here.
    const ap = state.apmap[p.id];
    const isAgent = p.role === "agent" || p.role === "admin";
    const f = (k, v) => `<div class="ud-f"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
    const apBlock = !isAgent ? "" : `
      <div class="ud-sec">פרטי סוכן — משרד ורישיון
        <button class="linkish" data-editagent="${esc(p.id)}">${ap ? "עריכה" : "הזנה ידנית"}</button>
      </div>
      ${ap ? `<div class="ud-agent">
        ${ap.logo_path ? `<img class="ud-logo" src="${esc(logoUrl(ap.logo_path))}" alt="" />` : `<div class="ud-logo">🏢</div>`}
        <div class="ud-grid grow">
          ${f("שם", ((ap.first_name || "") + " " + (ap.last_name || "")).trim() || "—")}
          ${f("משרד / סוכנות", ap.agency || "—")}
          ${f("מספר רישיון תיווך", ap.license_no || "—")}
          ${f("טלפון", ap.phone || "—")}
          ${f("עודכן", dt(ap.updated_at))}
        </div>
      </div>` : `<div class="ud-empty">לא הוזנו פרטי סוכן. המשתמש הוגדר כסוכן ידנית ולא מילא טופס בקשה.</div>`}
      <form class="ud-form" data-agentform="${esc(p.id)}" hidden>
        <input class="input a-first" maxlength="40" placeholder="שם פרטי" value="${esc(ap ? ap.first_name : "")}" />
        <input class="input a-last" maxlength="40" placeholder="שם משפחה" value="${esc(ap ? ap.last_name : "")}" />
        <input class="input a-agency" maxlength="80" placeholder="משרד / סוכנות" value="${esc(ap ? ap.agency : "")}" />
        <input class="input a-license" maxlength="30" placeholder="מספר רישיון תיווך" value="${esc(ap ? ap.license_no : "")}" />
        <input class="input a-phone" maxlength="20" placeholder="טלפון" value="${esc(ap && ap.phone ? ap.phone : "")}" />
        <button type="submit" class="btn-ok">שמור</button>
      </form>`;

    return `
      <div class="ud-sec">פרטי חשבון</div>
      <div class="ud-grid">
        ${facts.map(([k, v]) => `<div class="ud-f"><span>${esc(k)}</span><b class="ltr-if-id">${esc(v)}</b></div>`).join("")}
      </div>
      ${apBlock}
      ${appBlock}
      <div class="ud-sec">פעילות</div>
      <div class="ud-grid">
        <div class="ud-f"><span>נכסים</span><b>${mine.length}</b></div>
        <div class="ud-f"><span>מאושרים</span><b>${cnt("approved")}</b></div>
        <div class="ud-f"><span>ממתינים</span><b>${cnt("pending")}</b></div>
        <div class="ud-f"><span>נדחו</span><b>${cnt("rejected")}</b></div>
        <div class="ud-f"><span>לידים שהתקבלו</span><b>${leads}</b></div>
      </div>
      <div class="ud-sec">הנכסים שלו</div>
      ${listRows}`;
  }

  $("users-list").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-editagent]");
    if (ed) {
      const form = document.querySelector(`[data-agentform="${ed.dataset.editagent}"]`);
      if (form) form.hidden = !form.hidden;
      return;
    }
    const b = e.target.closest("[data-userdet]");
    if (!b) return;
    const p = state.pmap[b.dataset.userdet];
    const box = $("ud-" + b.dataset.userdet);
    if (!p || !box) return;
    if (!box.hidden) { box.hidden = true; b.textContent = "פרטים"; return; }
    box.innerHTML = userDetailHtml(p);
    box.hidden = false;
    b.textContent = "סגור";
  });
  async function setRole(id, role) {
    if (id === state.user.id && role !== "admin" &&
        !(await askConfirm({ title: "הורדת הרשאות מנהל", lines: ["אתה עומד להוריד לעצמך את הרשאות הניהול."], okText: "המשך", danger: true }))) return loadAll();
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

  // admin may write any agent_profiles row (09_agent_profile.sql)
  $("users-list").addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-agentform]");
    if (!form) return;
    e.preventDefault();
    const val = (c) => form.querySelector(c).value.trim();
    const row = {
      user_id: form.dataset.agentform,
      first_name: val(".a-first"), last_name: val(".a-last"),
      agency: val(".a-agency"), license_no: val(".a-license"),
      phone: val(".a-phone") || null,
    };
    if (!row.first_name || !row.agency || !row.license_no) return toast("שם, משרד ומספר רישיון הם שדות חובה");
    const res = await supa.from("agent_profiles").upsert(row, { onConflict: "user_id" });
    if (res.error) return toast("שגיאה: " + res.error.message);
    toast("פרטי הסוכן נשמרו"); loadAll();
  });

  /* --------------------------------------------------------- buildings */
  function renderBuildings() {
    $("buildings-list").innerHTML = state.buildings.map((b) => `
      <div class="row">
        <div class="rthumb">🏢</div>
        <div class="rmain">
          <div class="rtitle">${esc(b.name)}</div>
          <div class="rsub">${esc(b.address)} · ${esc(b.city)}</div>
          <div class="rmeta"><span>${esc(b.id)}</span><span>${esc(b.lng)}, ${esc(b.lat)}</span>
            <span>${state.listings.filter((l) => l.building_id === b.id).length} נכסים</span>
            <span class="badge ${b.verified === false ? "pending" : "approved"}">${b.verified === false ? "לא מאומת" : "מאומת"}</span>
            ${b.footprint ? `<span class="badge approved">מתאר אמיתי</span>` : `<span class="badge draft">ללא מתאר</span>`}
            ${b.source && b.source !== "manual" ? `<span>${esc(b.source)}</span>` : ""}</div>
        </div>
        <div class="ractions">
          ${b.verified === false ? `<button class="btn-ok" data-verifyb="${esc(b.id)}">אמת</button>` : ""}
          <button class="btn-bad" data-delb="${esc(b.id)}">מחק</button>
        </div>
      </div>`).join("") || `<div class="empty">אין בניינים.</div>`;
  }
  document.addEventListener("click", async (e) => {
    // buildings created from an address stay off the map until verified
    const v = e.target.closest("[data-verifyb]");
    if (v) {
      const res = await supa.from("buildings").update({ verified: true }).eq("id", v.dataset.verifyb);
      if (res.error) return toast("שגיאה: " + res.error.message);
      toast("הבניין אומת"); loadAll();
      return;
    }
    const d = e.target.closest("[data-delb]");
    if (!d) return;
    if (!(await askConfirm({ title: "מחיקת בניין", lines: ["יימחקו גם כל הנכסים שבבניין."], okText: "מחק בניין", danger: true }))) return;
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
