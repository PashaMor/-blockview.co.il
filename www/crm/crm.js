/* BlockView CRM — agent dashboard.
 * Security: browser publishable key only. Every read/write is constrained by
 * Row-Level Security (agents see/modify only their own listings & leads).
 * All user-supplied text is HTML-escaped before rendering (no stored XSS).
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
  const STATUS_HE = { pending: "ממתין לאישור", approved: "מאושר", rejected: "נדחה", sold: "נמכר", draft: "טיוטה" };

  const state = { user: null, role: "user", application: null, buildings: [], listings: [], leads: [], photos: [], pending: [],
                  logoPath: null, logoBlob: null, logoPreview: null };

  /* consent to the terms & privacy policy — the DB trigger stamps the real time,
     so this can be recorded but never back-dated (supabase/08_terms_consent.sql) */
  const CONSENT_KEY = "blockview_consent";
  function savedConsent() { try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; } }
  function rememberConsent() { try { localStorage.setItem(CONSENT_KEY, cfg.LEGAL_VERSION); } catch (e) {} }
  function isSocial(session) {
    const p = session && session.user && session.user.app_metadata && session.user.app_metadata.provider;
    return !!p && p !== "email";
  }
  async function recordConsent() {
    const { error } = await supa.from("profiles")
      .update({ terms_accepted_at: new Date().toISOString(), terms_version: cfg.LEGAL_VERSION })
      .eq("id", state.user.id);
    if (error) return console.warn("[BlockView] consent not saved:", error.message);
    try { localStorage.removeItem(CONSENT_KEY); } catch (e) {}
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400);
  }

  /* ------------------------------------------------------------ auth ---- */
  supa.auth.onAuthStateChange(async (_e, session) => {
    state.user = session ? session.user : null;
    if (!state.user) return showGate();
    const { data } = await supa.from("profiles").select("role, terms_accepted_at").eq("id", state.user.id).single();
    state.role = (data && data.role) || "user";
    // record the sign-up consent; with email verification on it lands at first sign-in
    if (data && !data.terms_accepted_at && (savedConsent() || isSocial(session))) await recordConsent();
    const roleHe = state.role === "admin" ? "מנהל מערכת" : state.role === "agent" ? "סוכן נדל\"ן" : "משתמש";
    $("who").textContent = state.user.email + " · " + roleHe;
    $("settings-btn").hidden = false;
    $("sm-email").textContent = state.user.email;
    $("sm-role").textContent = roleHe;
    $("sm-avatar").textContent = String(state.user.email || "?").charAt(0).toUpperCase();
    if (state.role !== "agent" && state.role !== "admin") return showApply();
    if (!(await mfaLoginGate())) return;   // only blocks if the agent enabled 2FA
    showApp();
    loadAll();
    refreshSecurity();
  });

  function hideAll() { ["gate", "apply", "mfa", "app"].forEach((n) => ($(n).hidden = true)); }
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

  /* -------------------------------------------------- sign in / sign up ---- */
  let gateMode = "in";
  function setGateMode(m) {
    gateMode = m;
    const up = m === "up";
    $("g-title").textContent = up ? "הרשמה כסוכן" : "CRM לסוכנים";
    $("g-sub").textContent = up
      ? "צור חשבון, מלא את פרטי הסוכן, ומנהל המערכת יאשר אותך."
      : "התחבר כדי לנהל את הנכסים והלידים שלך.";
    $("g-signin").hidden = up;
    $("g-signup").hidden = !up;
    $("g-consent").hidden = !up;
    $("g-consent-cb").checked = false;
    $("g-alt-tx").textContent = up ? "כבר יש לך חשבון?" : "עוד לא רשום כסוכן?";
    $("g-toggle").textContent = up ? "התחברות" : "הרשמה כסוכן";
    $("g-pw").setAttribute("autocomplete", up ? "new-password" : "current-password");
    $("g-err").hidden = true; $("g-ok").hidden = true;
  }
  $("g-toggle").addEventListener("click", () => setGateMode(gateMode === "in" ? "up" : "in"));

  $("g-signin").addEventListener("click", async () => {
    const email = $("g-email").value.trim(), password = $("g-pw").value;
    if (!email || !password) return showErr("g-err", "נא למלא אימייל וסיסמה");
    const { error } = await supa.auth.signInWithPassword({ email, password });
    if (error) showErr("g-err", error.message);
  });
  $("g-signup").addEventListener("click", async () => {
    $("g-err").hidden = true; $("g-ok").hidden = true;
    const email = $("g-email").value.trim(), password = $("g-pw").value;
    if (!email || !password) return showErr("g-err", "נא למלא אימייל וסיסמה");
    if (password.length < 8) return showErr("g-err", "הסיסמה חייבת להיות באורך 8 תווים לפחות");
    if (!$("g-consent-cb").checked) return showErr("g-err", "יש לאשר את תנאי השימוש ומדיניות הפרטיות");
    const { data, error } = await supa.auth.signUp({ email, password });
    if (!error) rememberConsent();   // recorded once the session exists (see below)
    if (error) return showErr("g-err", error.message);
    if (data && !data.session) {
      const ok = $("g-ok");
      ok.textContent = "נשלח אימייל אימות. אשר אותו, התחבר, והשלם את פרטי הסוכן.";
      ok.hidden = false;
      setGateMode("in");
      $("g-ok").hidden = false;   // keep the confirmation visible after the mode switch
    }
    // with email-confirmation off, onAuthStateChange takes over and opens the form
  });
  $("g-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") (gateMode === "up" ? $("g-signup") : $("g-signin")).click(); });
  $("signout").addEventListener("click", () => supa.auth.signOut());
  function showErr(id, msg) { const e = $(id); e.textContent = msg; e.hidden = false; }
  // Google / Apple. A social sign-in still lands on the agent-application screen
  // until an admin approves the account (role stays 'user').
  if (window.BVOAuth) BVOAuth.wire(supa, $("gate"), (m) => showErr("g-err", m));

  /* ------------------------------------------------- agent application ---- */
  const AP_STATE = {
    pending:  { badge: "pending",  label: "ממתין",  tx: "הבקשה שלך נשלחה וממתינה לאישור מנהל. נעדכן אותך במייל." },
    rejected: { badge: "rejected", label: "נדחתה",  tx: "הבקשה נדחתה. ניתן לתקן את הפרטים ולשלוח שוב." },
    approved: { badge: "approved", label: "אושרה",  tx: "הבקשה אושרה. התנתק והתחבר מחדש כדי לפתוח את ה-CRM." },
  };

  async function showApply() {
    hideAll(); $("apply").hidden = false;
    $("ap-err").hidden = true;
    const { data } = await supa.from("agent_applications").select("*").eq("user_id", state.user.id).maybeSingle();
    state.application = data || null;
    renderApply();
  }

  function renderApply(forceForm) {
    const a = state.application;
    const showForm = forceForm || !a || a.status === "rejected";
    const meta = a ? AP_STATE[a.status] : null;

    $("ap-status").hidden = !a;
    if (a && meta) {
      $("ap-badge").className = "badge " + meta.badge;
      $("ap-badge").textContent = meta.label;
      $("ap-state-tx").textContent = meta.tx;
      const note = $("ap-admin-note");
      note.hidden = !a.admin_note;
      note.textContent = a.admin_note ? "הערת מנהל: " + a.admin_note : "";
    }
    $("ap-title").textContent = a ? "סטטוס הבקשה" : "בקשה להצטרף כסוכן";
    $("ap-sub").hidden = !!a;

    $("ap-form").hidden = !showForm;
    $("ap-edit").hidden = !(a && a.status === "pending");
    $("ap-signout2").hidden = showForm;

    if (a) {
      $("ap-first").value = a.first_name || (a.full_name || "").split(" ")[0] || "";
      $("ap-last").value = a.last_name || (a.full_name || "").split(" ").slice(1).join(" ");
      $("ap-phone").value = a.phone || "";
      $("ap-agency").value = a.agency || "";
      $("ap-license").value = a.license_no || "";
      $("ap-city").value = a.city || "";
      $("ap-note").value = a.note || "";
      state.logoPath = a.logo_path || null;
    }
    renderLogo();
    $("ap-submit").textContent = a ? "שלח שוב לבדיקה" : "שלח בקשה";
  }

  /* ---- firm logo: compressed in the browser, uploaded to the agent's folder ---- */
  const LOGO_BUCKET = "agent-logos";
  const logoUrl = (p) => supa.storage.from(LOGO_BUCKET).getPublicUrl(p).data.publicUrl;

  function renderLogo() {
    const box = $("ap-logo-preview");
    const src = state.logoPreview || (state.logoPath ? logoUrl(state.logoPath) : null);
    box.textContent = "";
    if (src) {
      const img = document.createElement("img");
      img.src = src; img.alt = "";
      box.appendChild(img);
    } else {
      const s = document.createElement("span");
      s.textContent = "🏢";
      box.appendChild(s);
    }
  }

  function compressLogo(file) {
    return new Promise((resolve) => {
      const rd = new FileReader();
      rd.onload = (ev) => {
        const im = new Image();
        im.onload = () => {
          const max = 512, sc = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement("canvas");
          c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          // PNG keeps a transparent background, which most firm logos rely on
          c.toBlob((blob) => resolve({ blob, preview: c.toDataURL("image/png") }), "image/png");
        };
        im.src = ev.target.result;
      };
      rd.readAsDataURL(file);
    });
  }

  $("ap-logo").addEventListener("change", async (e) => {
    const f = (e.target.files || [])[0];
    e.target.value = "";
    if (!f || !/^image\//.test(f.type)) return;
    if (f.size > 5 * 1024 * 1024) return showErr("ap-err", "הקובץ גדול מדי (עד 5MB)");
    const out = await compressLogo(f);
    state.logoBlob = out.blob;
    state.logoPreview = out.preview;
    renderLogo();
  });

  $("ap-edit").addEventListener("click", () => renderApply(true));
  $("ap-signout").addEventListener("click", () => supa.auth.signOut());
  $("ap-signout2").addEventListener("click", () => supa.auth.signOut());

  $("ap-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("ap-err").hidden = true;
    const btn = $("ap-submit"); btn.disabled = true;
    try {
      const first = $("ap-first").value.trim(), last = $("ap-last").value.trim();
      if (!state.logoBlob && !state.logoPath) throw new Error("נא להעלות את לוגו המשרד");

      // upload the logo first: RLS allows writing only inside a folder named
      // after the user's own uid
      if (state.logoBlob) {
        const path = `${state.user.id}/logo_${Date.now()}.png`;
        const up = await supa.storage.from(LOGO_BUCKET)
          .upload(path, state.logoBlob, { contentType: "image/png", upsert: true });
        if (up.error) throw up.error;
        const old = state.logoPath;
        state.logoPath = path;
        state.logoBlob = null;
        if (old && old !== path) { try { await supa.storage.from(LOGO_BUCKET).remove([old]); } catch (e) {} }
      }

      const row = {
        user_id: state.user.id,
        first_name: first,
        last_name: last,
        full_name: (first + " " + last).trim(),
        phone: $("ap-phone").value.trim(),
        agency: $("ap-agency").value.trim(),
        license_no: $("ap-license").value.trim(),
        logo_path: state.logoPath,
        city: $("ap-city").value.trim(),
        note: $("ap-note").value.trim(),
        status: "pending",       // the DB trigger forces this anyway
      };
      // upsert so a rejected applicant can fix and re-send (RLS allows it while
      // status is pending/rejected; an approved row is locked)
      const { data, error } = await supa.from("agent_applications")
        .upsert(row, { onConflict: "user_id" }).select("*").single();
      if (error) throw error;
      state.application = data;
      renderApply();
      toast("הבקשה נשלחה ✓");
    } catch (err) {
      showErr("ap-err", err.message || "שגיאה בשליחת הבקשה");
    } finally {
      btn.disabled = false;
    }
  });

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
          <div><span class="lead-name">${esc(l.name)}</span> ${l.phone ? `· <a class="ltr" href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : ""} ${l.email ? `· <a class="ltr" href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ""}</div>
          <span class="lead-when">${esc(when)}</span>
        </div>
        <div class="lead-for">על הנכס: ${esc((l.listings || {}).title || "—")}</div>
        ${l.message ? `<div class="lead-msg">${esc(l.message)}</div>` : ""}
        <div class="lead-actions">
          <span class="badge ${l.status === "new" ? "pending" : l.status === "contacted" ? "approved" : "draft"}">${
            l.status === "new" ? "חדש" : l.status === "contacted" ? "נוצר קשר" : "סגור"}</span>
          ${l.status !== "contacted" ? `<button class="btn-ghost" data-lead="${esc(l.id)}" data-to="contacted">סמן כנוצר קשר</button>` : ""}
          ${l.status !== "closed" ? `<button class="btn-ghost" data-lead="${esc(l.id)}" data-to="closed">סגור</button>` : ""}
          <button class="btn-ghost danger" data-dellead="${esc(l.id)}">מחק</button>
        </div>
      </div>`;
    }).join("");
  }

  $("leads-list").addEventListener("click", async (e) => {
    const d = e.target.closest("[data-dellead]");
    if (d) {
      if (!confirm("למחוק את הפנייה לצמיתות?")) return;
      const res = await supa.from("leads").delete().eq("id", d.dataset.dellead);
      if (res.error) return toast("שגיאה במחיקה");
      toast("הפנייה נמחקה"); await loadLeads();
      return;
    }
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

  setGateMode("in");
})();

/* ---- password reset (shared /reset page) ---- */
(function () {
  const go = (email) => (window.location.href = "https://blockview.co.il/reset" + (email ? "?email=" + encodeURIComponent(email) : ""));
  const f = document.getElementById("g-forgot");
  if (f) f.addEventListener("click", () => go(document.getElementById("g-email").value.trim()));
  const p = document.getElementById("sm-password");
  if (p) p.addEventListener("click", () => go(document.getElementById("sm-email").textContent.trim()));
})();
