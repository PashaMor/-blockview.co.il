/* BlockView — superadmin console.
 * Security: admin-only. Every query is still under RLS (admin policies use the
 * SECURITY DEFINER is_admin() helper). All user text is HTML-escaped on render.
 */
(function () {
  const cfg = window.BLOCKVIEW_CONFIG;
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY,
    window.BVOAuth ? BVOAuth.clientOptions() : undefined);
  if (window.BVOAuth && BVOAuth.shareSession) BVOAuth.shareSession(supa);   // share session across *.blockview.co.il
  const $ = (id) => document.getElementById(id);
  const BUCKET = "listing-photos";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nis = (n) => "₪" + Number(n || 0).toLocaleString("he-IL");
  // מוקפא = temporarily off the map. draft/sold are retired from the picker but
  // still labelled if an old row carries one (see supabase/30_listing_frozen.sql).
  const ST = { pending: "ממתין", approved: "מאושר", rejected: "נדחה", frozen: "מוקפא" };
  const ST_LABEL = Object.assign({ sold: "נמכר", draft: "טיוטה" }, ST);
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
  // PostgREST caps a response at 1000 rows; the admin must see (and count) every
  // listing/building, so page through until the table is exhausted. Pass a
  // factory because a supabase query builder is single-use.
  async function fetchAllPages(make) {
    const PAGE = 1000; let from = 0, out = [], firstErr = null;
    for (;;) {
      const { data, error } = await make().range(from, from + PAGE - 1);
      if (error) { firstErr = error; break; }
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return { data: out, error: firstErr };
  }

  async function loadAll() {
    const [L, P, B, Lead, A, AP, AU, REV, VW, OF, OM, RP] = await Promise.all([
      fetchAllPages(() => supa.from("listings").select("*, buildings(name,address), listing_photos(id,path,sort), listing_contacts(name,phone,email,sort)").order("created_at", { ascending: false })),
      supa.from("profiles").select("*").order("created_at", { ascending: false }),
      fetchAllPages(() => supa.from("buildings").select("*").order("name")),
      supa.from("leads").select("id,agent_id,name,phone,email,message,status,created_at,listing_id,listings(title)").order("created_at", { ascending: false }),
      // 07_agent_applications.sql may not have been run yet — degrade gracefully
      supa.from("agent_applications").select("*").order("created_at", { ascending: false }),
      // 09_agent_profile.sql — approved agents' firm / licence / logo
      supa.from("agent_profiles").select("*"),
      // 21_admin_confirm_email.sql — email confirmation lives in auth.users,
      // which the browser cannot read, so an admin-only function returns it
      supa.rpc("admin_auth_status"),
      // 26_listing_revisions.sql — what changed on each listing, newest first
      supa.from("listing_revisions").select("*").order("changed_at", { ascending: false }).limit(400),
      // 16_analytics.sql — one row per viewer/event/day; admins may read it
      supa.from("listing_views").select("listing_id,event"),
      // 34_offices.sql — brokerages awaiting/needing review (degrade if not run)
      supa.from("offices").select("*").order("created_at", { ascending: false }),
      // 36_office_members.sql — the roster of each office
      supa.from("office_members").select("office_id,user_id,member_role,status,invited_email"),
      // 44_listing_reports.sql — user reports on listings (degrade if not run)
      supa.from("listing_reports").select("*, listings(title, buildings(name,address))").order("created_at", { ascending: false }),
    ]);
    // clicks/views per listing: 'detail' is a listing opened, 'impression' is
    // shown in a building's sheet. Guarded so an agent viewing their own does
    // not count (16_analytics.sql).
    state.viewsByListing = {};
    (VW && VW.data ? VW.data : []).forEach((v) => {
      const m = state.viewsByListing[v.listing_id] || (state.viewsByListing[v.listing_id] = { detail: 0, impression: 0 });
      if (v.event === "detail") m.detail++;
      else if (v.event === "impression") m.impression++;
    });
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
    state.offices = (OF && OF.data) || [];
    state.officeMembers = (OM && OM.data) || [];
    state.reports = (RP && RP.data) || [];
    renderStats(); renderQueue(); renderAll(); renderUsers(); renderBuildings(); renderRecent(); renderApps(); renderAgentLeads(); renderOffices(); renderReports();
    setTabCounts();
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
    $("queue-badge").textContent = byStatus("pending") || "";
    $("agents-badge").textContent = state.apps.filter((a) => a.status === "pending").length || "";
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
    // fire the approval email (best-effort — the role change already committed;
    // the edge function re-checks admin + that the target is now an agent)
    if (decision === "approved") notifyAgentApproved(userId);
    loadAll();
  }
  async function notifyAgentApproved(userId) {
    try {
      const r = await supa.functions.invoke("agent-approved", { body: { user_id: userId } });
      if (r.error) { console.warn("[BlockView] approval email failed:", r.error.message); toast("אושר — אך שליחת האימייל נכשלה"); }
      else toast("אימייל אישור נשלח 📧");
    } catch (e) {
      // function not deployed yet, or no network — approval still stands
      console.warn("[BlockView] approval email not sent:", e && e.message);
    }
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
          <span class="badge ${esc(l.status)}">${esc(ST_LABEL[l.status] || l.status)}</span>
        </div>
        ${contactList(l)}
        ${more}
        ${l.description ? `<div class="rsub">${esc(String(l.description).slice(0, 160))}</div>` : ""}
      </div>
      <div class="rprice">${nis(l.price)}${l.deal === "rent" ? " / לחודש" : ""}</div>
      <div class="ractions">
        ${withActions ? `<button class="btn-ok" data-approve="${esc(l.id)}">אשר</button>
                         <button class="btn-bad" data-reject="${esc(l.id)}">דחה</button>` : ""}
        <a class="btn-edit" href="https://blockview.co.il/?listing=${esc(l.id)}" target="_blank" rel="noopener">👁 צפה</a>
        <button class="btn-edit" data-editlisting="${esc(l.id)}">✏️ ערוך</button>
        ${!withActions ? `<select class="input" data-status="${esc(l.id)}">
            ${(Object.keys(ST).indexOf(l.status) < 0 ? [l.status] : []).concat(Object.keys(ST))
              .map((s) => `<option value="${esc(s)}"${s === l.status ? " selected" : ""}>${esc(ST_LABEL[s] || s)}</option>`).join("")}
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
    const CAP = 400;   // keep the DOM light; the tab badge shows the real total
    $("all-list").innerHTML = rows.slice(0, CAP).map((l) => listingRow(l, false)).join("") +
      (rows.length > CAP ? `<div class="empty">מציג ${CAP} מתוך ${rows.length}. חדד בחיפוש או בסטטוס כדי לראות עוד.</div>` : "");
  }
  $("l-search").addEventListener("input", renderAll);
  $("l-status").addEventListener("change", renderAll);

  function renderRecent() {
    $("recent").innerHTML = state.listings.slice(0, 5).map((l) => listingRow(l, false)).join("") ||
      `<div class="empty">אין פעילות עדיין.</div>`;
  }

  /* ------------------------------------------------------ edit a listing */
  // residential vs commercial decide the allowed property types (25_listing_fields.sql)
  const TYPE_OPTS = {
    residential: [["flat", "דירה"], ["house", "בית"], ["penthouse", "פנטהאוז"], ["studio", "סטודיו"]],
    commercial: [["office", "משרד"], ["shop", "חנות"], ["warehouse", "מחסן"], ["other", "אחר"]],
  };
  function fillTypeOptions(category, selected) {
    const opts = TYPE_OPTS[category === "commercial" ? "commercial" : "residential"];
    $("e-type").innerHTML = opts.map(([v, t]) => `<option value="${v}"${v === selected ? " selected" : ""}>${t}</option>`).join("");
  }
  $("e-category").addEventListener("change", () => fillTypeOptions($("e-category").value, ""));

  // furniture & pets are a rental concern — hide them on a sale
  function syncEditDeal() {
    const sale = $("e-deal").value === "sale";
    ["e-furnished", "e-pets"].forEach((id) => {
      const cb = $(id), lbl = cb && cb.closest("label");
      if (lbl) lbl.hidden = sale;
      if (cb && sale) cb.checked = false;
    });
  }
  $("e-deal").addEventListener("change", syncEditDeal);
  function syncEditSizes() {
    const bw = $("e-balcony-size-wrap"), yw = $("e-yard-size-wrap");
    if (bw) { bw.hidden = !$("e-balcony").checked; if (!$("e-balcony").checked) $("e-balcony-size").value = ""; }
    if (yw) { yw.hidden = !$("e-yard").checked; if (!$("e-yard").checked) $("e-yard-size").value = ""; }
  }
  $("e-balcony").addEventListener("change", syncEditSizes);
  $("e-yard").addEventListener("change", syncEditSizes);

  /* photos on the edited listing. A separate copy so edits are live but the row
     in state.listings only refreshes on the next loadAll(). */
  let editPhotos = [];
  let editAddr = null;   // set when an admin picks a NEW address to move the listing to

  /* ---- address search in the edit form: verify a new address, then move the
   * listing to a building for it (ensure_building dedupes-or-creates). The old
   * building is left as-is; if it ends up with no listings it just drops off the
   * map. Because the address lives on the building, moving is cleaner than
   * editing it in place (which would change every unit in that building). */
  let addrTimer;
  function wireAddrSearch() {
    const search = $("e-addr-search"), box = $("e-addr-results");
    if (!search || !box) return;
    search.addEventListener("input", () => {
      clearTimeout(addrTimer);
      const q = search.value.trim();
      if (q.length < 3 || !window.BVGeo) { box.hidden = true; return; }
      addrTimer = setTimeout(async () => {
        const items = await BVGeo.searchAddress(q);
        box._items = items || [];
        box.innerHTML = (items && items.length)
          ? items.map((it, i) => `<div class="ar-item" data-i="${i}">${esc(it.short)}${it.city ? " · " + esc(it.city) : ""}${it.hasNumber ? "" : " · (רחוב)"}</div>`).join("")
          : `<div class="ar-item muted">לא נמצאו תוצאות</div>`;
        box.hidden = false;
      }, 500);
    });
    box.addEventListener("click", async (e) => {
      const row = e.target.closest(".ar-item"); if (!row || !box._items) return;
      const it = box._items[+row.dataset.i]; if (!it) return;
      box.hidden = true;
      search.value = it.short + (it.city ? ", " + it.city : "");
      const picked = $("e-addr-picked"); picked.hidden = false; picked.textContent = "מאמת מתאר בניין…";
      const fp = await BVGeo.fetchFootprint(it.lat, it.lng);
      editAddr = {
        short: it.short, label: it.label || (it.short + (it.city ? ", " + it.city : "")),
        city: it.city || null, lat: it.lat, lng: it.lng, osmId: it.osmId || null, fp: fp,
      };
      picked.textContent = "📍 יועבר אל: " + search.value +
        (fp ? " — נמצא מתאר בניין אמיתי" : " — ללא מתאר מדויק, ימוקם לפי הכתובת");
    });
  }
  wireAddrSearch();
  function renderEditPhotos() {
    const box = $("e-photos");
    if (!editPhotos.length) { box.innerHTML = `<div class="e-nophoto">אין תמונות</div>`; return; }
    box.innerHTML = editPhotos.map((p, i) =>
      `<div class="e-ph${i === 0 ? " is-cover" : ""}">` +
        `<img src="${esc(photoUrl(p.path))}" alt="" />` +
        `<button type="button" class="e-ph-x" data-delphoto="${esc(p.id)}" title="מחק">✕</button>` +
        (i === 0 ? `<span class="e-ph-cover">ראשית</span>`
                 : `<button type="button" class="e-ph-star" data-coverphoto="${esc(p.id)}" title="הפוך לראשית">★</button>`) +
      `</div>`).join("");
  }
  // compress in the browser before upload, like the CRM / publish forms
  function compressImg(file) {
    return new Promise((resolve) => {
      const rd = new FileReader();
      rd.onload = (ev) => {
        const im = new Image();
        im.onload = () => {
          const max = 1400, sc = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement("canvas");
          c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          c.toBlob((b) => resolve(b), "image/jpeg", 0.82);
        };
        im.src = ev.target.result;
      };
      rd.readAsDataURL(file);
    });
  }

  $("e-photos").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delphoto]");
    if (del) {
      const p = editPhotos.find((x) => String(x.id) === String(del.dataset.delphoto));
      if (!p) return;
      // the row is authoritative for what the listing shows; the storage object
      // may belong to the owner's folder, so removing it is best-effort
      const r = await supa.from("listing_photos").delete().eq("id", p.id);
      if (r.error) return toast("שגיאה במחיקת התמונה");
      try { await supa.storage.from(BUCKET).remove([p.path]); } catch (er) {}
      editPhotos = editPhotos.filter((x) => x.id !== p.id).map((x, i) => ({ ...x, sort: i }));
      renderEditPhotos(); toast("התמונה נמחקה"); scheduleListReload();
      return;
    }
    const cov = e.target.closest("[data-coverphoto]");
    if (cov) {
      const at = editPhotos.findIndex((x) => String(x.id) === String(cov.dataset.coverphoto));
      if (at <= 0) return;
      editPhotos.unshift(editPhotos.splice(at, 1)[0]);
      renderEditPhotos();
      for (let i = 0; i < editPhotos.length; i++) {
        const r = await supa.from("listing_photos").update({ sort: i }).eq("id", editPhotos[i].id);
        if (r.error) { toast("עדכון התמונה הראשית נכשל"); break; }
        editPhotos[i].sort = i;
      }
      toast("התמונה הראשית עודכנה"); scheduleListReload();
    }
  });

  $("e-photo-file").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => /^image\//.test(f.type));
    e.target.value = "";
    if (!files.length) return;
    const listingId = $("e-id").value;
    let sort = editPhotos.length;
    for (const f of files) {
      const blob = await compressImg(f);
      // admin uploads under their own uid folder (storage insert policy), the
      // listing_photos row is what binds the file to the listing
      const path = `${state.user.id}/${listingId}/${Date.now()}_${sort}.jpg`;
      const up = await supa.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) { toast("העלאת התמונה נכשלה: " + up.error.message); continue; }
      const ins = await supa.from("listing_photos").insert({ listing_id: listingId, path, sort }).select("id,path,sort").single();
      if (ins.error) { toast("שמירת התמונה נכשלה"); continue; }
      editPhotos.push(ins.data); sort++;
    }
    renderEditPhotos(); toast("התמונות נוספו"); scheduleListReload();
  });

  // reload the lists once after a burst of photo changes (keeps the map fresh too)
  let listReloadTimer = null;
  function scheduleListReload() { clearTimeout(listReloadTimer); listReloadTimer = setTimeout(loadAll, 800); }

  function openEdit(id) {
    const l = state.listings.find((x) => String(x.id) === String(id));
    if (!l) return;
    $("e-err").hidden = true;
    editPhotos = sortedPhotos(l).map((p) => ({ id: p.id, path: p.path, sort: p.sort }));
    renderEditPhotos();
    $("e-id").value = l.id;
    $("e-title").value = l.title || "";
    $("e-deal").value = l.deal || "sale";
    $("e-price").value = l.price != null ? l.price : "";
    $("e-category").value = l.category || "residential";
    fillTypeOptions(l.category || "residential", l.type || "flat");
    $("e-rooms").value = l.rooms != null ? l.rooms : "";
    $("e-size").value = l.size != null ? l.size : "";
    $("e-floor").value = l.floor != null ? l.floor : "";
    $("e-floors-total").value = l.floors_total != null ? l.floors_total : "";
    $("e-age").value = l.age || "old";
    $("e-furnished").checked = !!l.furnished;
    $("e-pets").checked = !!l.pets;
    $("e-parking").checked = !!l.parking;
    $("e-elevator").checked = !!l.elevator;
    $("e-balcony").checked = !!l.balcony;
    $("e-yard").checked = !!l.yard;
    $("e-balcony-size").value = l.balcony_size != null ? l.balcony_size : "";
    $("e-yard-size").value = l.yard_size != null ? l.yard_size : "";
    ["safe_room","ac","storage","accessible","bars","solar","renovated"].forEach((k) => { const el = $("e-"+k); if (el) el.checked = !!l[k]; });
    $("e-tour").value = l.tour_url || "";
    $("e-website").value = l.website_url || "";
    $("e-desc").value = l.description || "";
    // address: show current, reset any pending move, warn if the building is shared
    editAddr = null;
    if ($("e-addr-search")) { $("e-addr-search").value = ""; $("e-addr-results").hidden = true; $("e-addr-picked").hidden = true; }
    const cur = $("e-addr-current");
    if (cur) cur.textContent = "נוכחי: " + ((l.buildings && l.buildings.address) || "—");
    const warn = $("e-addr-warn");
    if (warn) {
      const shared = state.listings.filter((x) => x.building_id === l.building_id).length;
      warn.hidden = shared <= 1;
      warn.textContent = shared > 1 ? "⚠️ שינוי הכתובת יעביר רק את הנכס הזה לבניין החדש (" + shared + " נכסים בבניין הנוכחי)." : "";
    }
    syncEditDeal();
    syncEditSizes();
    $("edit-modal").hidden = false;
  }
  function closeEdit() { $("edit-modal").hidden = true; }
  $("edit-close").addEventListener("click", closeEdit);
  $("e-cancel").addEventListener("click", closeEdit);
  $("edit-modal").addEventListener("click", (e) => { if (e.target.id === "edit-modal") closeEdit(); });

  const numOrNull = (v) => (String(v).trim() === "" ? null : +v);
  $("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("e-err").hidden = true;
    const price = +$("e-price").value;
    if (!isFinite(price) || price < 0 || price > 99000000) { $("e-err").textContent = "מחיר לא תקין (עד ₪99,000,000)"; $("e-err").hidden = false; return; }
    const row = {
      title: $("e-title").value.trim(),
      deal: $("e-deal").value,
      price: price,
      category: $("e-category").value,
      type: $("e-type").value,
      rooms: numOrNull($("e-rooms").value),
      size: numOrNull($("e-size").value),
      floor: numOrNull($("e-floor").value),
      floors_total: numOrNull($("e-floors-total").value),
      age: $("e-age").value,
      furnished: $("e-furnished").checked,
      pets: $("e-pets").checked,
      parking: $("e-parking").checked,
      elevator: $("e-elevator").checked,
      balcony: $("e-balcony").checked,
      balcony_size: $("e-balcony").checked ? (numOrNull($("e-balcony-size").value)) : null,
      safe_room: $("e-safe_room").checked,
      ac: $("e-ac").checked,
      storage: $("e-storage").checked,
      accessible: $("e-accessible").checked,
      bars: $("e-bars").checked,
      solar: $("e-solar").checked,
      renovated: $("e-renovated").checked,
      yard: $("e-yard").checked,
      yard_size: $("e-yard").checked ? (numOrNull($("e-yard-size").value)) : null,
      tour_url: $("e-tour").value.trim() || null,
      website_url: $("e-website").value.trim() || null,
      description: $("e-desc").value.trim(),
    };
    const btn = $("e-save"); btn.disabled = true;
    // moving the listing to a new address? resolve/create its building first
    if (editAddr) {
      const fp = editAddr.fp;
      const { data: bid, error: bErr } = await supa.rpc("ensure_building", {
        p_name: editAddr.short,
        p_address: editAddr.label,
        p_city: editAddr.city || null,
        p_lat: fp && fp.center ? fp.center[1] : editAddr.lat,
        p_lng: fp && fp.center ? fp.center[0] : editAddr.lng,
        p_osm_id: (fp && fp.osmId) || editAddr.osmId || null,
        p_footprint: fp ? fp.polygon : null,
        p_height: fp ? fp.height : null,
      });
      if (bErr || !bid) {
        btn.disabled = false;
        $("e-err").textContent = /TOO_MANY_BUILDINGS/.test(bErr && bErr.message || "") ? "נוצרו יותר מדי בניינים, נסה שוב בעוד שעה" : (bErr && bErr.message) || "יצירת הבניין נכשלה";
        $("e-err").hidden = false; return;
      }
      await supa.from("buildings").update({ verified: true }).eq("id", bid);  // admin action = trusted
      row.building_id = bid;
    }
    const { error } = await supa.from("listings").update(row).eq("id", $("e-id").value);
    btn.disabled = false;
    if (error) { $("e-err").textContent = error.message; $("e-err").hidden = false; return; }
    closeEdit(); toast(editAddr ? "הנכס עודכן והועבר לכתובת החדשה" : "הנכס עודכן"); loadAll();
  });

  /* ---------------------------------------------------- listing actions */
  document.addEventListener("click", async (e) => {
    const edl = e.target.closest("[data-editlisting]");
    if (edl) return openEdit(edl.dataset.editlisting);
    const ap = e.target.closest("[data-approve]");
    const rj = e.target.closest("[data-reject]");
    const dl = e.target.closest("[data-del]");
    const oa = e.target.closest("[data-office-approve]");
    const orj = e.target.closest("[data-office-reject]");
    const osu = e.target.closest("[data-office-suspend]");
    if (oa) return reviewOffice(oa.dataset.officeApprove, "approved");
    if (orj) return reviewOffice(orj.dataset.officeReject, "rejected");
    if (osu) return reviewOffice(osu.dataset.officeSuspend, "suspended");
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
    if (e.target.closest("#of-filter")) return renderOffices();
    const r = e.target.closest("[data-role]");
    if (r) setRole(r.dataset.role, r.value);
    const pl = e.target.closest("[data-plan]");
    if (pl) setPlan(pl.dataset.plan, pl.value);
  });
  async function setStatus(id, status) {
    const { error } = await supa.from("listings").update({ status }).eq("id", id);
    if (error) return toast("שגיאה: " + error.message);
    toast("סטטוס עודכן ל: " + (ST_LABEL[status] || status));
    loadAll();
  }

  /* ------------------------------------------------------------- users */
  /* ---- total counts on the browse tabs (how many we have of each) ---- */
  function setTabCounts() {
    const set = (id, n) => { const el = $(id); if (el) el.textContent = n; };
    set("listings-count", (state.listings || []).length);
    set("users-count", (state.profiles || []).length);
    set("agentleads-count", (state.profiles || []).filter((p) => p.role === "agent" || p.role === "admin").length);
    set("buildings-count", (state.buildings || []).length);
    set("offices-count", (state.offices || []).length);
    set("reports-badge", (state.reports || []).filter((r) => r.status === "new").length || "");
  }

  /* ---- user reports on listings (44_listing_reports.sql) ---- */
  const REP_REASON = {
    unavailable: "לא זמין / נמכר", wrong_price: "מחיר שגוי", wrong_details: "פרטים שגויים",
    misleading_photos: "תמונות מטעות", scam: "הונאה / ספאם", offensive: "תוכן פוגעני", other: "אחר",
  };
  const REP_ST = { new: "חדש", reviewed: "נבדק", dismissed: "נדחה", actioned: "טופל" };
  function renderReports() {
    const f = ($("rep-status") && $("rep-status").value) || "new";
    const rows = (state.reports || []).filter((r) => f === "all" || r.status === f);
    $("reports-empty").hidden = rows.length > 0;
    $("reports-list").innerHTML = rows.map((r) => {
      const l = r.listings || {}, b = (l.buildings) || {};
      const agent = state.pmap[r.agent_id];
      return `<div class="row" data-id="${esc(r.id)}">
        <div class="rthumb">🚩</div>
        <div class="rmain">
          <div class="rtitle">${esc(REP_REASON[r.reason] || r.reason)}</div>
          <div class="rsub">${esc(l.title || "—")}${b.address ? " · " + esc(b.address) : ""}</div>
          ${r.details ? `<div class="rsub">${esc(r.details)}</div>` : ""}
          <div class="rmeta">
            <span>סוכן: ${esc(agent ? agent.email : "—")}</span>
            <span>${esc(when(r.created_at))}</span>
            <span class="badge ${r.status === "new" ? "pending" : r.status === "actioned" ? "approved" : "draft"}">${esc(REP_ST[r.status] || r.status)}</span>
          </div>
        </div>
        <div class="ractions">
          <a class="btn-edit" href="https://blockview.co.il/?listing=${esc(r.listing_id)}" target="_blank" rel="noopener">↗ נכס</a>
          <select class="input" data-repstatus="${esc(r.id)}">
            ${Object.keys(REP_ST).map((s) => `<option value="${s}"${s === r.status ? " selected" : ""}>${REP_ST[s]}</option>`).join("")}
          </select>
        </div>
      </div>`;
    }).join("");
  }
  document.addEventListener("change", async (e) => {
    const rs = e.target.closest("[data-repstatus]");
    if (!rs) return;
    const { error } = await supa.from("listing_reports").update({ status: rs.value }).eq("id", rs.dataset.repstatus);
    if (error) return toast("שגיאה: " + error.message);
    toast("סטטוס הדיווח עודכן"); loadAll();
  });
  const repFilter = $("rep-status");
  if (repFilter) repFilter.addEventListener("change", renderReports);

  /* ---- offices: approve / reject / suspend brokerages ---- */
  const OFST = { pending: "ממתין", approved: "מאושר", rejected: "נדחה", suspended: "מושהה" };
  function renderOffices() {
    const list = state.offices || [];
    const filter = ($("of-filter") && $("of-filter").value) || "all";
    const rows = filter === "all" ? list : list.filter((o) => o.status === filter);
    const box = $("offices-list");
    if (!box) return;
    $("offices-empty").hidden = rows.length > 0;
    const members = state.officeMembers || [];
    const clicksOf = (lid) => (state.viewsByListing[lid] || {}).detail || 0;
    box.innerHTML = rows.map((o) => {
      const owner = state.pmap[o.owner_id];
      const canApprove = o.status !== "approved";
      const roster = members.filter((m) => m.office_id === o.id);
      const memberUids = roster.filter((m) => m.user_id).map((m) => m.user_id);
      const officeListings = (state.listings || []).filter((l) => l.office_id === o.id);
      const leadsOf = (lid) => (state.leads || []).filter((x) => x.listing_id === lid).length;
      const leadCount = (state.leads || []).filter((l) => officeListings.some((x) => x.id === l.listing_id)).length;
      const clicks = officeListings.reduce((s, l) => s + clicksOf(l.id), 0);
      const listingsHtml = officeListings.length ? `<div class="al-props">` + officeListings.map((l) => {
        const p = state.pmap[l.agent_id];
        return `<div class="al-prop">
          <span class="al-prop-title">${esc(l.title || "—")}</span>
          <span class="al-stat">${esc((p && p.email) || "")}</span>
          <span class="badge ${esc(l.status)}">${esc(ST[l.status] || l.status)}</span>
          <span class="al-stat">👁️ ${clicksOf(l.id)}</span>
          <span class="al-stat">📩 ${leadsOf(l.id)}</span>
        </div>`;
      }).join("") + `</div>` : `<div class="al-none" style="padding:6px 0">אין נכסים במשרד</div>`;
      // the owner is a broker who also lists, so they count as an agent too
      const agents = roster.slice().sort((a, b) => (b.member_role === "owner") - (a.member_role === "owner"));
      const rosterHtml = agents.length ? `<div class="al-props">` + agents.map((m) => {
        const p = m.user_id ? state.pmap[m.user_id] : null;
        const who = p ? p.email : (m.invited_email || "—");
        return `<div class="al-prop"><span class="al-prop-title">${esc(who)}${m.member_role === "owner" ? " (בעלים)" : ""}</span>
          <span class="badge ${m.status === "active" ? "approved" : "pending"}">${m.status === "active" ? "פעיל" : "הוזמן"}</span></div>`;
      }).join("") + `</div>` : `<div class="al-none" style="padding:6px 0">אין עדיין סוכנים</div>`;
      return `<div class="al-agent" data-office="${esc(o.id)}">
        <div class="al-head">
          <div>
            <b>${esc(o.name || "—")}</b>
            <span class="badge ${esc(o.status === "approved" ? "approved" : o.status === "pending" ? "pending" : "draft")}" style="margin-inline-start:8px">${esc(OFST[o.status] || o.status)}</span>
            <span class="al-email">בעלים: ${esc(owner ? owner.email : o.owner_id)}${o.city ? " · " + esc(o.city) : ""}${o.phone ? " · " + esc(o.phone) : ""}</span>
            ${o.admin_note ? `<span class="al-email">${esc(o.admin_note)}</span>` : ""}
          </div>
          <div class="al-counts">
            <span>${agents.length} סוכנים</span>
            <span>${officeListings.length} נכסים</span>
            <span>👁️ ${clicks}</span>
            <span class="al-leadcount"><b>${leadCount}</b> לידים</span>
          </div>
        </div>
        <div class="al-section-lbl">סוכני המשרד</div>
        ${rosterHtml}
        <div class="al-section-lbl">נכסי המשרד</div>
        ${listingsHtml}
        <div class="ractions" style="padding:10px 14px">
          ${canApprove ? `<button class="btn-ok" data-office-approve="${esc(o.id)}">אשר</button>` : ""}
          ${o.status !== "rejected" ? `<button class="btn-bad" data-office-reject="${esc(o.id)}">דחה</button>` : ""}
          ${o.status === "approved" ? `<button class="btn-ghost" data-office-suspend="${esc(o.id)}">השהה (ביטול הרשאת צירוף)</button>` : ""}
        </div>
      </div>`;
    }).join("");
  }
  async function reviewOffice(id, decision) {
    let note = "";
    if (decision === "rejected" || decision === "suspended") {
      const ok = await askConfirm({ title: decision === "rejected" ? "דחיית משרד" : "השהיית משרד",
        lines: ["הבעלים לא יוכל לצרף סוכנים חדשים כל עוד המשרד אינו מאושר."], okText: "אישור", danger: true });
      if (!ok) return;
    }
    const { error } = await supa.rpc("review_office", { target: id, decision: decision, note: note });
    if (error) return toast("שגיאה: " + (error.message || error));
    toast("סטטוס המשרד עודכן"); loadAll();
  }

  /* ---- each agent: their properties (with clicks), and the leads they got ---- */
  function renderAgentLeads() {
    const box = $("agentleads-list");
    if (!box) return;
    const agents = state.profiles.filter((p) => p.role === "agent" || p.role === "admin");
    $("agentleads-empty").hidden = agents.length > 0;

    const leadsByAgent = {}, leadsByListing = {};
    (state.leads || []).forEach((l) => {
      (leadsByAgent[l.agent_id] = leadsByAgent[l.agent_id] || []).push(l);
      leadsByListing[l.listing_id] = (leadsByListing[l.listing_id] || 0) + 1;
    });
    const clicksOf = (lid) => (state.viewsByListing[lid] || {}).detail || 0;
    const listingsOf = (aid) => state.listings.filter((l) => l.agent_id === aid);

    // busiest agents first (by clicks, then leads)
    agents.sort((a, b) => {
      const ca = listingsOf(a.id).reduce((s, l) => s + clicksOf(l.id), 0);
      const cb = listingsOf(b.id).reduce((s, l) => s + clicksOf(l.id), 0);
      return cb - ca || (leadsByAgent[b.id] || []).length - (leadsByAgent[a.id] || []).length;
    });

    box.innerHTML = agents.map((p) => {
      const ap = state.apmap[p.id] || {};
      const name = [ap.first_name, ap.last_name].filter(Boolean).join(" ") || p.email;
      const mine = listingsOf(p.id);
      const leads = leadsByAgent[p.id] || [];
      const totalClicks = mine.reduce((s, l) => s + clicksOf(l.id), 0);
      const newLeads = leads.filter((l) => l.status === "new").length;

      const props = mine.length
        ? mine.map((l) => `
            <div class="al-prop">
              <span class="al-prop-title">${esc(l.title || "—")}</span>
              <span class="badge ${esc(l.status)}">${esc(ST[l.status] || l.status)}</span>
              <span class="al-stat">👁️ ${clicksOf(l.id)} צפיות</span>
              <span class="al-stat">📩 ${leadsByListing[l.id] || 0} לידים</span>
            </div>`).join("")
        : `<div class="al-none">אין נכסים</div>`;

      const leadRows = leads.length
        ? leads.map((l) => `
            <div class="al-lead">
              <div class="al-lead-main">
                <b>${esc(l.name || "—")}</b>
                <span class="al-reach">${esc([l.phone, l.email].filter(Boolean).join(" · "))}</span>
                <span class="al-for">על: ${esc((l.listings && l.listings.title) || "—")}</span>
              </div>
              ${l.message ? `<div class="al-msg">${esc(l.message)}</div>` : ""}
              <div class="al-meta">
                <span class="badge ${l.status === "new" ? "pending" : l.status === "contacted" ? "approved" : "draft"}">${
                  l.status === "new" ? "חדש" : l.status === "contacted" ? "נוצר קשר" : "סגור"}</span>
                <span>${esc(when(l.created_at))}</span>
              </div>
            </div>`).join("")
        : `<div class="al-none">אין לידים עדיין</div>`;

      return `
        <div class="al-agent">
          <div class="al-head">
            <div>
              <b>${esc(name)}</b>
              ${ap.agency ? `<span class="al-agency">${esc(ap.agency)}</span>` : ""}
              <span class="al-email">${esc(p.email)}</span>
            </div>
            <div class="al-counts">
              <span>${mine.length} נכסים</span>
              <span>👁️ ${totalClicks} צפיות</span>
              <span class="al-leadcount"><b>${leads.length}</b> לידים${newLeads ? ` · ${newLeads} חדשים` : ""}</span>
            </div>
          </div>
          <div class="al-section-lbl">נכסים</div>
          <div class="al-props">${props}</div>
          <div class="al-section-lbl">לידים</div>
          <div class="al-leads">${leadRows}</div>
        </div>`;
    }).join("");
  }

  function renderUsers() {
    const q = $("u-search").value.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");        // for phone matching
    const role = $("u-role").value, plan = $("u-plan").value;
    const rows = state.profiles.filter((p) => {
      if (role !== "all" && p.role !== role) return false;
      if (plan !== "all" && (p.plan === "pro" ? "pro" : "free") !== plan) return false;
      if (!q) return true;
      // search the firm, licence and name too, not just the email
      const a = state.apmap[p.id] || {};
      const text = (String(p.email || "") + " " + (a.agency || "") + " " + (a.license_no || "") +
              " " + (a.first_name || "") + " " + (a.last_name || "")).toLowerCase();
      if (text.includes(q)) return true;
      // phone: compare digits only, so "050-123" matches "0501234567" / "+97250…"
      if (qDigits.length >= 3) {
        const phoneDigits = String(a.phone || "").replace(/\D/g, "");
        if (phoneDigits.indexOf(qDigits) !== -1) return true;
      }
      return false;
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
          <span class="badge ${esc(l.status)}">${esc(ST_LABEL[l.status] || l.status)}</span>
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
    if (!row.first_name || !row.last_name || !row.agency || !row.license_no) return toast("שם פרטי, שם משפחה, משרד ומספר רישיון הם שדות חובה");
    const res = await supa.from("agent_profiles").upsert(row, { onConflict: "user_id" });
    if (res.error) return toast("שגיאה: " + res.error.message);
    toast("פרטי הסוכן נשמרו"); loadAll();
  });

  /* --------------------------------------------------------- buildings */
  // opens the public map centered on the building, so an admin can eyeball the
  // location / footprint before verifying
  const mapUrl = (b) => "https://blockview.co.il/?at=" + encodeURIComponent(b.lat + "," + b.lng);

  function renderBuildings() {
    const q = ($("bl-search").value || "").trim().toLowerCase();
    const f = $("bl-filter").value;
    const rows = state.buildings.filter((b) => {
      if (f === "unverified" && b.verified !== false) return false;
      if (f === "verified" && b.verified === false) return false;
      if (f === "nofootprint" && b.footprint) return false;
      if (!q) return true;
      return ((b.name || "") + " " + (b.address || "") + " " + (b.city || "") + " " + (b.id || "")).toLowerCase().includes(q);
    });
    $("bl-count").textContent = rows.length;
    // count listings per building ONCE (was O(buildings × listings) inline)
    const perB = {};
    state.listings.forEach((l) => { perB[l.building_id] = (perB[l.building_id] || 0) + 1; });
    const CAP = 400;   // keep the DOM light; the count above is the real total
    $("buildings-list").innerHTML = rows.slice(0, CAP).map((b) => `
      <div class="row">
        <div class="rthumb">🏢</div>
        <div class="rmain">
          <div class="rtitle">${esc(b.name)}</div>
          <div class="rsub">${esc(b.address)} · ${esc(b.city)}</div>
          <div class="rmeta"><span>${esc(b.id)}</span><span>${esc(b.lng)}, ${esc(b.lat)}</span>
            <span>${perB[b.id] || 0} נכסים</span>
            <span class="badge ${b.verified === false ? "pending" : "approved"}">${b.verified === false ? "לא מאומת" : "מאומת"}</span>
            ${b.footprint ? `<span class="badge approved">מתאר אמיתי</span>` : `<span class="badge draft">ללא מתאר</span>`}
            ${b.source && b.source !== "manual" ? `<span>${esc(b.source)}</span>` : ""}</div>
        </div>
        <div class="ractions">
          <a class="btn-edit" href="${esc(mapUrl(b))}" target="_blank" rel="noopener">🗺️ מפה</a>
          ${b.verified === false ? `<button class="btn-ok" data-verifyb="${esc(b.id)}">אמת</button>` : ""}
          <button class="btn-bad" data-delb="${esc(b.id)}">מחק</button>
        </div>
      </div>`).join("") +
      (rows.length > CAP ? `<div class="empty">מציג ${CAP} מתוך ${rows.length}. חדד בחיפוש או בסינון כדי לראות עוד.</div>` : "")
      || `<div class="empty">אין בניינים בסינון הזה.</div>`;
  }
  $("bl-search").addEventListener("input", renderBuildings);
  $("bl-filter").addEventListener("change", renderBuildings);
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
    ["overview", "queue", "agents", "listings", "users", "agentleads", "offices", "buildings", "reports", "new"].forEach((n) => ($("tab-" + n).hidden = n !== t.dataset.tab));
  }));

  /* ---- create a listing from a pasted JSON blob (no SQL) ----------------
   * Runs entirely on the admin's own session: is_agent() is true for an admin,
   * so buildings_insert and listings_insert both pass, and enforce_listing_status
   * keeps it 'pending' unless the admin explicitly approves it later. The
   * building is inserted with a fresh id (not ensure_building) so two vague
   * same-city addresses do NOT merge onto one building. */
  /* -------------------------------------------------------------------------
   * New-listing builder — the same flow as the website's owner form and the
   * agent CRM: type a real address, we look up the OSM building outline and
   * ensure_building() dedupes-or-creates it server-side; the listing lands
   * 'pending' (enforce_listing_status) until an admin approves it here.
   * Ported from www/js/publish.js / www/crm/crm.js; reuses admin's state/supa.
   * ------------------------------------------------------------------------- */
  (function newListingBuilder() {
    const form = $("nl-form");
    if (!form) return;
    const BUILDER_TYPES = {
      residential: [["flat", "דירה"], ["house", "בית"], ["penthouse", "פנטהאוז"], ["studio", "סטודיו"]],
      commercial: [["office", "משרד"], ["shop", "חנות"], ["warehouse", "מחסן / לוגיסטיקה"], ["other", "אחר"]],
      agricultural: [["farm", "משק חקלאי"], ["orchard", "מטע"], ["vineyard", "כרם"], ["field", "שדה / קרקע חקלאית"]],
    };
    const nb = { pending: [], picked: null, footprint: null };
    let addrTimer = null;
    function nlErr(m) { const e = $("f-err"); e.textContent = m; e.hidden = false; }

    /* ---- price grouping (37500000 -> 37,500,000), display only ---- */
    function groupDigits(s) {
      const digits = String(s == null ? "" : s).replace(/\D/g, "");
      return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "";
    }
    $("f-price").addEventListener("input", function () {
      const el = this, before = el.value, caret = el.selectionStart || 0;
      const digitsLeft = before.slice(0, caret).replace(/\D/g, "").length;
      const formatted = groupDigits(before);
      el.value = formatted;
      let pos = 0, seen = 0;
      while (pos < formatted.length && seen < digitsLeft) {
        if (/\d/.test(formatted.charAt(pos))) seen++;
        pos++;
      }
      try { el.setSelectionRange(pos, pos); } catch (e) {}
    });
    const MAX_PRICE = 99000000;
    function checkedPrice(v) {
      const n = +String(v == null ? "" : v).replace(/[^\d.]/g, "");
      if (!isFinite(n) || n <= 0) throw new Error("נא למלא מחיר תקין");
      if (n > MAX_PRICE) throw new Error("המחיר המרבי הוא ₪99,000,000");
      return n;
    }

    /* ---- category -> property types ---- */
    function fillTypes(category, selected) {
      const list = BUILDER_TYPES[category] || BUILDER_TYPES.residential;
      $("f-type").innerHTML = list
        .map(([v, label]) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
      if (!list.some(([v]) => v === selected)) $("f-type").value = list[0][0];
    }
    // agricultural land is placed by settlement/area — no house number required
    const isAgri = () => $("f-category").value === "agricultural";
    function syncAgri() {
      $("f-address").placeholder = isAgri()
        ? "יישוב / עיר (לא נדרש מספר בית)"
        : "לדוגמה: אלנבי 20, תל אביב";
    }
    $("f-category").addEventListener("change", () => { fillTypes($("f-category").value, $("f-type").value); syncAgri(); });

    /* ---- deal / rental term / availability dates ---- */
    function syncTermField() {
      const rent = $("f-deal").value === "rent";
      $("f-term-wrap").hidden = !rent;
      const sale = !rent;
      ["f-furnished", "f-pets"].forEach((id) => {
        const cb = $(id), lbl = cb && cb.closest("label");
        if (lbl) lbl.hidden = sale;
        if (cb && sale) cb.checked = false;
      });
      const short = rent && $("f-term").value === "short";
      $("f-from-wrap").hidden = !rent;
      $("f-to-wrap").hidden = !short;
      if (!short) $("f-date-to").value = "";
      if (!rent) { $("f-date-from").value = ""; $("f-date-to").value = ""; }
    }
    $("f-deal").addEventListener("change", syncTermField);
    $("f-term").addEventListener("change", syncTermField);
    function syncSizeFields() {
      $("f-balcony-size-wrap").hidden = !$("f-balcony").checked;
      if (!$("f-balcony").checked) $("f-balcony-size").value = "";
      $("f-yard-size-wrap").hidden = !$("f-yard").checked;
      if (!$("f-yard").checked) $("f-yard-size").value = "";
    }
    $("f-balcony").addEventListener("change", syncSizeFields);
    $("f-yard").addEventListener("change", syncSizeFields);

    /* ---- contacts (up to 5, DB-enforced) ---- */
    const MAX_CONTACTS = 5;
    function contactRow(c, first) {
      const d = document.createElement("div");
      d.className = "contact-row";
      d.innerHTML =
        '<input class="input c-name" maxlength="80" placeholder="שם איש קשר" autocomplete="name" />' +
        '<div class="grid2">' +
          '<input class="input c-phone" type="tel" inputmode="numeric" maxlength="10" placeholder="טלפון (8-10 ספרות)" autocomplete="tel" />' +
          '<input class="input c-email" type="email" maxlength="120" placeholder="אימייל (לא חובה)" />' +
        '</div>' +
        '<label class="wa-check"><input type="checkbox" class="c-wa" /> 💬 המספר זמין בוואטסאפ</label>' +
        (first ? "" : '<button type="button" class="c-remove" aria-label="הסר איש קשר">✕</button>');
      if (c) {
        d.querySelector(".c-name").value = c.name || "";
        d.querySelector(".c-phone").value = c.phone || "";
        d.querySelector(".c-email").value = c.email || "";
        d.querySelector(".c-wa").checked = !!c.whatsapp;
      }
      return d;
    }
    function addContactRow(c) {
      const box = $("f-contacts");
      if (box.children.length >= MAX_CONTACTS) return;
      box.appendChild(contactRow(c, box.children.length === 0));
      $("f-add-contact").hidden = box.children.length >= MAX_CONTACTS;
    }
    function resetContacts() {
      $("f-contacts").innerHTML = "";
      $("f-add-contact").hidden = false;
      addContactRow(null);
    }
    $("f-add-contact").addEventListener("click", () => addContactRow(null));
    $("f-contacts").addEventListener("click", (e) => {
      const b = e.target.closest(".c-remove");
      if (!b) return;
      b.parentNode.remove();
      $("f-add-contact").hidden = $("f-contacts").children.length >= MAX_CONTACTS;
    });
    function readContacts() {
      const out = [];
      Array.prototype.forEach.call($("f-contacts").querySelectorAll(".contact-row"), (r) => {
        const name = r.querySelector(".c-name").value.trim();
        const phone = r.querySelector(".c-phone").value.trim();
        const email = r.querySelector(".c-email").value.trim();
        if (!name && !phone && !email) return;
        if (name.length < 2) throw new Error("נא למלא שם איש קשר");
        if (phone.replace(/\D/g, "").length < 8 || phone.replace(/\D/g, "").length > 10) throw new Error("מספר טלפון חייב להכיל 8-10 ספרות");
        out.push({ name: name, phone: phone, email: email || null, whatsapp: !!r.querySelector(".c-wa").checked });
      });
      return out;
    }

    /* ---- photos: compress in-browser, first is the cover ---- */
    function photoUrl(path) { try { return supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ""; } }
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
    function renderStrip() {
      let idx = 0;
      $("photo-strip").innerHTML = nb.pending.map((p, i) => {
        const first = idx++ === 0;
        return `<div class="ph${first ? " is-cover" : ""}"><img src="${p.preview}" alt="" />` +
          `<button type="button" class="ph-x" data-rm="${i}">✕</button>` +
          (first ? "" : `<button type="button" class="ph-star" data-cover="${i}" title="הפוך לתמונה ראשית">★</button>`) +
          (first ? `<span class="ph-cover">תמונה ראשית</span>` : "") + `</div>`;
      }).join("");
    }
    $("f-photos").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []).filter((f) => /^image\//.test(f.type));
      e.target.value = "";
      for (const f of files) nb.pending.push(await compress(f));
      renderStrip();
    });
    $("photo-strip").addEventListener("click", (e) => {
      const c = e.target.closest("[data-cover]");
      if (c) { const i = +c.dataset.cover; nb.pending.unshift(nb.pending.splice(i, 1)[0]); renderStrip(); return; }
      const b = e.target.closest("[data-rm]");
      if (b) { nb.pending.splice(+b.dataset.rm, 1); renderStrip(); }
    });

    /* ---- address search -> ensure_building (same as website/CRM) ---- */
    function resetAddress() {
      nb.picked = null; nb.footprint = null;
      $("f-addr-results").hidden = true; $("f-addr-results").innerHTML = "";
      $("f-addr-picked").hidden = true; $("f-addr-picked").textContent = "";
      $("f-addr-match").hidden = true; $("f-addr-match").textContent = ""; $("f-addr-match").className = "addr-match";
    }
    $("f-address").addEventListener("input", (e) => {
      const q = e.target.value;
      clearTimeout(addrTimer);
      nb.picked = null;
      if (q.trim().length < 3) { $("f-addr-results").hidden = true; return; }
      addrTimer = setTimeout(async () => {
        if (!window.BVGeo) return;
        showAddrResults(await BVGeo.searchAddress(q));
      }, 600);
    });
    function showAddrResults(items) {
      const box = $("f-addr-results");
      box._items = items || [];
      if (!items || !items.length) { box.hidden = true; box.innerHTML = ""; return; }
      box.innerHTML = items.map((it, i) =>
        '<button type="button" class="ar-item" data-i="' + i + '">' + esc(it.label) + "</button>").join("");
      box.hidden = false;
    }
    $("f-addr-results").addEventListener("click", async (e) => {
      const b = e.target.closest(".ar-item");
      if (!b) return;
      const it = $("f-addr-results")._items[+b.dataset.i];
      $("f-addr-results").hidden = true;
      $("f-address").value = it.short + (it.city ? ", " + it.city : "");
      nb.picked = it;
      const picked = $("f-addr-picked");
      picked.textContent = "מאתר את מתאר הבניין…";
      picked.hidden = false;
      const fp = await BVGeo.fetchFootprint(it.lat, it.lng);
      nb.footprint = fp;
      picked.textContent = "📍 " + it.short +
        (isAgri() ? " — יישוב / אזור נבחר"
            : !it.hasNumber ? " — ⛔ חובה לבחור כתובת עם מספר בית. הכנסת מספר הבניין מאפשר למערכת להראות כל מה שמסביב לבניין במדויק."
                : fp ? " — נמצא מתאר בניין אמיתי"
                     : " — ללא מתאר מדויק, ימוקם לפי הכתובת");
      showAddrMatch(it, fp);
    });
    async function showAddrMatch(a, fp) {
      const box = $("f-addr-match");
      box.hidden = true; box.className = "addr-match";
      try {
        const { data, error } = await supa.rpc("preview_building_match", {
          p_address: a.label,
          p_lat: fp && fp.center ? fp.center[1] : a.lat,
          p_lng: fp && fp.center ? fp.center[0] : a.lng,
          p_osm_id: (fp && fp.osmId) || a.osmId || null,
        });
        if (error || !data || !data.length) return;
        const m = data[0];
        if (m.reason === "new") box.textContent = "🏠 ייווצר בניין חדש בכתובת הזו.";
        else if (m.reason === "existing_hidden") box.textContent = "🏢 הנכס יצורף לבניין קיים בכתובת הזו.";
        else {
          box.className = "addr-match warn";
          box.textContent = '⚠️ הנכס יצורף לבניין הקיים "' + (m.name || "") + '" — ' + (m.address || "") +
            (m.reason === "nearby" ? ". הכתובת שבחרת נמצאת במרחק של כמה מטרים ממנו." : ". זו אותה כתובת.");
        }
        box.hidden = false;
      } catch (err) { /* preview is a courtesy — never block saving */ }
    }
    async function resolveBuilding() {
      if (!nb.picked) throw new Error("נא לבחור את כתובת הנכס");
      if (!nb.picked.hasNumber && !isAgri()) throw new Error("חובה לבחור כתובת עם מספר בית — לא ניתן לפרסם נכס ללא מספר בית");
      const a = nb.picked, fp = nb.footprint;
      const { data, error } = await supa.rpc("ensure_building", {
        p_name: a.short,
        p_address: a.label,
        p_city: a.city || null,
        p_lat: fp && fp.center ? fp.center[1] : a.lat,
        p_lng: fp && fp.center ? fp.center[0] : a.lng,
        p_osm_id: (fp && fp.osmId) || a.osmId || null,
        p_footprint: fp ? fp.polygon : null,
        p_height: fp ? fp.height : null,
      });
      if (error) throw new Error(/TOO_MANY_BUILDINGS/.test(error.message) ? "נוספו יותר מדי בניינים בשעה האחרונה" : "לא הצלחנו לאתר את הבניין לכתובת הזו");
      return data;
    }

    /* ---- reset the whole form ---- */
    function resetForm() {
      form.reset();
      nb.pending = [];
      resetAddress();
      $("f-err").hidden = true;
      $("f-floor").value = 0;
      $("f-category").value = "residential";
      fillTypes("residential", "flat");
      syncAgri();
      $("f-deal").value = "sale";
      $("f-term").value = "long";
      syncTermField();
      syncSizeFields();
      renderStrip();
      resetContacts();
    }
    $("f-reset").addEventListener("click", resetForm);

    /* ---- submit ---- */
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      $("f-err").hidden = true;
      const save = $("f-save");
      save.disabled = true;
      try {
        const contacts = readContacts();
        if (!contacts.length) throw new Error("נא למלא לפחות איש קשר אחד");
        const buildingId = await resolveBuilding();
        const rent = $("f-deal").value === "rent";
        const short = rent && $("f-term").value === "short";
        const row = {
          building_id: buildingId,
          agent_id: state.user.id,
          poster_type: "agent",
          deal: $("f-deal").value,
          rent_term: rent ? $("f-term").value : null,
          available_from: rent ? ($("f-date-from").value || null) : null,
          available_to: short ? ($("f-date-to").value || null) : null,
          title: $("f-title").value.trim(),
          price: checkedPrice($("f-price").value),
          rooms: +$("f-rooms").value,
          size: +$("f-size").value,
          floor: +$("f-floor").value || 0,
          floors_total: +$("f-floors-total").value || null,
          category: $("f-category").value,
          type: $("f-type").value,
          age: $("f-age").value,
          description: $("f-desc").value.trim(),
          furnished: $("f-furnished").checked,
          pets: $("f-pets").checked,
          parking: $("f-parking").checked,
          elevator: $("f-elevator").checked,
          balcony: $("f-balcony").checked,
          balcony_size: $("f-balcony").checked ? (+$("f-balcony-size").value || null) : null,
          yard: $("f-yard").checked,
          yard_size: $("f-yard").checked ? (+$("f-yard-size").value || null) : null,
          safe_room: $("f-safe_room").checked,
          ac: $("f-ac").checked,
          storage: $("f-storage").checked,
          accessible: $("f-accessible").checked,
          bars: $("f-bars").checked,
          solar: $("f-solar").checked,
          renovated: $("f-renovated").checked,
          status: "pending",
        };
        const ins = await supa.from("listings").insert(row).select("id").single();
        if (ins.error) throw ins.error;
        const listingId = ins.data.id;

        for (let i = 0; i < nb.pending.length; i++) {
          const path = `${state.user.id}/${listingId}/${Date.now()}_${i}.jpg`;
          const up = await supa.storage.from(BUCKET).upload(path, nb.pending[i].blob, { contentType: "image/jpeg" });
          if (up.error) throw up.error;
          const pins = await supa.from("listing_photos").insert({ listing_id: listingId, path, sort: i });
          if (pins.error) throw pins.error;
        }
        const cins = await supa.from("listing_contacts").insert(
          contacts.map((c, i) => ({ listing_id: listingId, name: c.name, phone: c.phone, email: c.email, whatsapp: c.whatsapp, sort: i })));
        if (cins.error) throw cins.error;

        toast("הנכס נוצר וממתין לאישור ✓");
        resetForm();
        await loadAll();
        const qtab = document.querySelector('.tab[data-tab="queue"]');
        if (qtab) qtab.click();
      } catch (err) {
        nlErr(err.message || "שגיאה ביצירת הנכס");
      } finally {
        save.disabled = false;
      }
    });

    // initial state
    fillTypes("residential", "flat");
    syncAgri();
    syncTermField();
    resetContacts();
  })();
})();

/* ---- password reset (shared /reset page) ---- */
(function () {
  const go = (email) => (window.location.href = "https://blockview.co.il/reset" + (email ? "?email=" + encodeURIComponent(email) : ""));
  const f = document.getElementById("g-forgot");
  if (f) f.addEventListener("click", () => go(document.getElementById("g-email").value.trim()));
  const p = document.getElementById("sm-password");
  if (p) p.addEventListener("click", () => go(document.getElementById("sm-email").textContent.trim()));
})();
