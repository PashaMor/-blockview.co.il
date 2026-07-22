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
  const STATUS_HE = { pending: "ממתין לאישור", approved: "מאושר", rejected: "נדחה", frozen: "מוקפא", sold: "נמכר", draft: "טיוטה" };

  const state = { user: null, role: "user", application: null, buildings: [], listings: [], leads: [], photos: [], pending: [],
                  logoPath: null, logoBlob: null, logoPreview: null, agent: null };

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

  /* ---------------------------------------------------- confirm dialog ----
   * Browsers suppress window.confirm after a few in a row, and a silently
   * cancelled action looks like a broken button. This asks inside the page.
   *   opts.mustType — text the user has to retype (used before deleting) */
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
        const p = document.createElement("p"); p.textContent = line; box.appendChild(p);
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
      cancel.className = "btn-ghost"; cancel.textContent = "ביטול";
      const ok = document.createElement("button");
      ok.className = opts.danger ? "btn-danger" : "btn-primary";
      ok.textContent = opts.okText || "אישור";
      row.appendChild(cancel); row.appendChild(ok);
      box.appendChild(row); back.appendChild(box); document.body.appendChild(back);
      (input || ok).focus();

      function close(v) { document.removeEventListener("keydown", onKey, true); back.remove(); resolve(v); }
      function accept() {
        if (opts.mustType && input.value.trim().toLowerCase() !== String(opts.mustType).toLowerCase()) {
          input.classList.add("bad"); toast("הטקסט לא תואם"); return;
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

  /* ask the server to import nearby places for a building (no-op if it already
     has them). Fire-and-forget: never awaited, never surfaced. */
  async function primeNearby(buildingId) {
    if (!buildingId) return;
    try {
      const s = await supa.auth.getSession();
      const token = s && s.data && s.data.session && s.data.session.access_token;
      if (!token) return;
      fetch("/api/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ building_id: buildingId }),
      }).catch(function () {});
    } catch (e) { /* best effort */ }
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

  /* ---- delete my agent account (supabase/20 + 22) ----
   * delete_my_account() acts on auth.uid() only. Removing the auth user cascades
   * to the profile, listings, their photos rows, contacts, enquiries and the
   * agent application + branding. Files go through the Storage API first, since
   * SQL is not allowed to delete from storage.objects. */
  $("sm-delete").addEventListener("click", async () => {
    $("settings-menu").hidden = true;
    if (!state.user) return;
    const mine = state.listings.length;
    const go = await askConfirm({
      title: "מחיקת חשבון הסוכן",
      lines: [
        state.user.email || "",
        `יימחקו ${mine} נכסים שפרסמת, התמונות שלהם, הלידים שקיבלת ופרטי המשרד.`,
        "הפעולה אינה הפיכה.",
      ],
      mustType: state.user.email || "",
      okText: "מחק את החשבון", danger: true,
    });
    if (!go) return;

    const uid = state.user.id;
    for (const bucket of ["listing-photos", LOGO_BUCKET]) {
      try {
        const paths = [];
        const { data: top } = await supa.storage.from(bucket).list(uid, { limit: 1000 });
        for (const entry of top || []) {
          if (entry.id) { paths.push(uid + "/" + entry.name); continue; }
          const { data: inner } = await supa.storage.from(bucket).list(uid + "/" + entry.name, { limit: 1000 });
          (inner || []).forEach((f) => paths.push(uid + "/" + entry.name + "/" + f.name));
        }
        if (paths.length) await supa.storage.from(bucket).remove(paths);
      } catch (e) { console.warn("[BlockView] file cleanup failed:", e.message); }
    }

    const { error } = await supa.rpc("delete_my_account");
    if (error) {
      return toast(/LAST_ADMIN/.test(error.message)
        ? "זהו חשבון המנהל האחרון ולכן אי אפשר למחוק אותו"
        : "מחיקת החשבון נכשלה, נסה שוב");
    }
    await supa.auth.signOut();
  });
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
    if (!(await askConfirm({ title: "כיבוי אימות דו-שלבי", lines: ["החשבון יהיה מוגן פחות."], okText: "כבה 2FA", danger: true }))) return;
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
    $("g-forgot").hidden = up;          // nothing to recover before the account exists
    $("g-legal").hidden = up;           // the consent checkbox already carries both links
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
  async function loadAll() { await loadMyAgentProfile(); await loadBuildings(); await loadListings(); await loadLeads(); }

  // name + phone the agent gave when applying — used to prefill a listing's contact
  async function loadMyAgentProfile() {
    const r = await supa.from("agent_profiles").select("*").eq("user_id", state.user.id).maybeSingle();
    state.agent = (r && r.data) || null;
    // an agent promoted by hand has no branding row; fall back to their application
    if (!state.agent && !state.application) {
      const a = await supa.from("agent_applications").select("*").eq("user_id", state.user.id).maybeSingle();
      if (a && a.data) state.application = a.data;
    }
  }
  function myContact() {
    const a = state.agent, ap = state.application;
    const full = (o) => ((o.first_name || "") + " " + (o.last_name || "")).trim() || (o.full_name || "");
    const name = a ? full(a) : (ap ? full(ap) : "");
    const phone = (a && a.phone) || (ap && ap.phone) || "";
    return { name: name, phone: phone, email: state.user.email || "" };
  }

  async function loadBuildings() {
    const { data } = await supa.from("buildings").select("id,name,address,city").order("name");
    state.buildings = data || [];
    $("f-building").innerHTML = state.buildings
      .map((b) => `<option value="${esc(b.id)}">${esc(b.name)} — ${esc(b.address)}</option>`).join("");
  }

  async function loadListings() {
    const { data, error } = await supa
      .from("listings")
      .select("*, buildings(name,address), listing_photos(id,path,sort), listing_contacts(id,name,phone,email,whatsapp,sort)")
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

  /* ---- property types depend on the category (see 25_listing_fields.sql) ---- */
  const TYPES = {
    residential: [["flat", "דירה"], ["house", "בית"], ["penthouse", "פנטהאוז"], ["studio", "סטודיו"]],
    commercial:  [["office", "משרד"], ["shop", "חנות"], ["warehouse", "מחסן / לוגיסטיקה"], ["other", "אחר"]],
  };
  function fillTypes(category, selected) {
    const list = TYPES[category] || TYPES.residential;
    $("f-type").innerHTML = list
      .map(([v, label]) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(label)}</option>`)
      .join("");
    // a type from the other category can't stay selected — the DB rejects it
    if (!list.some(([v]) => v === selected)) $("f-type").value = list[0][0];
  }
  $("f-category").addEventListener("change", () => fillTypes($("f-category").value, $("f-type").value));

  // rental term applies only to a rental; a sale hides it and saves null
  function syncTermField() {
    const w = $("f-term-wrap");
    if (w) w.hidden = $("f-deal").value !== "rent";
    // furniture & pets apply to rentals only
    const sale = $("f-deal").value === "sale";
    ["f-furnished", "f-pets"].forEach((id) => {
      const cb = $(id), lbl = cb && cb.closest("label");
      if (lbl) lbl.hidden = sale;
      if (cb && sale) cb.checked = false;
    });
  }
  $("f-deal").addEventListener("change", syncTermField);
  function syncSizeFields() {
    const bw = $("f-balcony-size-wrap"), yw = $("f-yard-size-wrap");
    if (bw) { bw.hidden = !$("f-balcony").checked; if (!$("f-balcony").checked) $("f-balcony-size").value = ""; }
    if (yw) { yw.hidden = !$("f-yard").checked; if (!$("f-yard").checked) $("f-yard-size").value = ""; }
  }
  $("f-balcony").addEventListener("change", syncSizeFields);
  $("f-yard").addEventListener("change", syncSizeFields);

  /* ---------------------------------------------------------- editor ---- */
  function openEditor(l) {
    switchTab("editor");
    $("f-err").hidden = true;
    state.pending = [];
    state.photos = l ? (l.listing_photos || []).slice().sort((a, b) => a.sort - b.sort) : [];
    $("editor-title").textContent = l ? "עריכת נכס" : "נכס חדש";
    $("f-id").value = l ? l.id : "";
    $("f-building").value = l ? l.building_id : (state.buildings[0] || {}).id || "";
    // editing keeps the building it already has; a new listing starts from an address
    resetAddress(l ? (l.buildings || {}) : null);
    $("f-deal").value = l ? l.deal : "sale";
    $("f-term").value = (l && l.rent_term) || "long";
    syncTermField();
    $("f-title").value = l ? l.title : "";
    $("f-price").value = l ? l.price : "";
    $("f-rooms").value = l ? l.rooms : "";
    $("f-size").value = l ? l.size : "";
    $("f-floor").value = l ? l.floor : 0;
    $("f-floors-total").value = l && l.floors_total ? l.floors_total : "";
    $("f-category").value = (l && l.category) || "residential";
    fillTypes($("f-category").value, l ? l.type : "flat");
    $("f-website").value = l && l.website_url ? l.website_url : "";
    $("f-age").value = l ? l.age : "old";
    // status is meaningless while creating — a new listing always goes to moderation
    $("f-status").value = l ? (["pending", "frozen"].includes(l.status) ? l.status : "pending") : "pending";
    $("f-status-field").hidden = !l;
    $("f-tour").value = l && l.tour_url ? l.tour_url : "";
    $("f-desc").value = l ? l.description : "";
    syncTermField();
    $("f-furnished").checked = !!(l && l.furnished);
    $("f-pets").checked = !!(l && l.pets);
    $("f-parking").checked = !!(l && l.parking);
    $("f-elevator").checked = !!(l && l.elevator);
    $("f-balcony").checked = !!(l && l.balcony);
    $("f-yard").checked = !!(l && l.yard);
    $("f-balcony-size").value = l && l.balcony_size != null ? l.balcony_size : "";
    $("f-yard-size").value = l && l.yard_size != null ? l.yard_size : "";
    syncSizeFields();
    $("f-delete").hidden = !l;
    $("f-photos").value = "";
    renderPhotoStrip();
    const cs = l ? (l.listing_contacts || []).slice().sort((a, b) => a.sort - b.sort) : [];
    resetContacts(cs, myContact());
  }

  /* --------------------------------------------------------- contacts ----
   * Same rule as the website: full details are readable by signed-in users only
   * (supabase/10_listing_contacts.sql). Up to 5 per listing — the DB enforces it. */
  const MAX_CONTACTS = 5;
  function contactRow(c, first) {
    const d = document.createElement("div");
    d.className = "contact-row";
    d.innerHTML =
      '<input class="input c-name" maxlength="80" placeholder="שם איש קשר" autocomplete="name" />' +
      '<div class="grid2">' +
        '<input class="input c-phone" type="tel" maxlength="20" placeholder="טלפון" autocomplete="tel" />' +
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
  function resetContacts(list, mine) {
    $("f-contacts").innerHTML = "";
    $("f-add-contact").hidden = false;
    if (list && list.length) list.forEach((c) => addContactRow(c));
    else addContactRow(mine || { name: "", phone: "", email: "" });
  }
  $("f-add-contact").addEventListener("click", () => addContactRow(null));
  $("f-contacts").addEventListener("click", (e) => {
    const b = e.target.closest(".c-remove");
    if (!b) return;
    b.parentNode.remove();
    $("f-add-contact").hidden = $("f-contacts").children.length >= MAX_CONTACTS;
  });
  // ₪99M ceiling — the DB enforces it too (26_price_cap.sql)
  const MAX_PRICE = 99000000;
  function checkedPrice(v) {
    const n = +v;
    if (!isFinite(n) || n <= 0) throw new Error("נא למלא מחיר תקין");
    if (n > MAX_PRICE) throw new Error("המחיר המרבי הוא ₪99,000,000");
    return n;
  }

  function readContacts() {
    const out = [];
    Array.prototype.forEach.call($("f-contacts").querySelectorAll(".contact-row"), (r) => {
      const name = r.querySelector(".c-name").value.trim();
      const phone = r.querySelector(".c-phone").value.trim();
      const email = r.querySelector(".c-email").value.trim();
      if (!name && !phone && !email) return;
      if (name.length < 2) throw new Error("נא למלא שם איש קשר");
      if (phone.replace(/\D/g, "").length < 6) throw new Error("נא למלא מספר טלפון תקין");
      out.push({ name: name, phone: phone, email: email || null, whatsapp: !!r.querySelector(".c-wa").checked });
    });
    return out;
  }

  // the first photo is the cover — what the map card and search results show
  function renderPhotoStrip() {
    let idx = 0;
    const saved = state.photos.map((p) => {
      const first = idx++ === 0;
      return `<div class="ph${first ? " is-cover" : ""}"><img src="${esc(photoUrl(p.path))}" alt="" />` +
        `<button type="button" class="ph-x" data-delph="${esc(p.id)}">✕</button>` +
        (first ? "" : `<button type="button" class="ph-star" data-cover="${esc(p.id)}" title="הפוך לתמונה ראשית">★</button>`) +
        (first ? `<span class="ph-cover">תמונה ראשית</span>` : "") + `</div>`;
    });
    const canStar = !state.photos.length;   // mixing saved and unsaved order would be ambiguous
    const pend = state.pending.map((p, i) => {
      const first = idx++ === 0;
      return `<div class="ph${first ? " is-cover" : ""}"><img src="${esc(p.preview)}" alt="" />` +
        `<button type="button" class="ph-x" data-delpend="${i}">✕</button>` +
        (first || !canStar ? "" : `<button type="button" class="ph-star" data-coverpend="${i}" title="הפוך לתמונה ראשית">★</button>`) +
        (first ? `<span class="ph-cover">תמונה ראשית</span>` : "") + `</div>`;
    });
    $("photo-strip").innerHTML = saved.concat(pend).join("");
  }

  $("photo-strip").addEventListener("click", async (e) => {
    const c = e.target.closest("[data-cover]");
    if (c) {
      const at = state.photos.findIndex((p) => String(p.id) === String(c.dataset.cover));
      if (at > 0) {
        state.photos.unshift(state.photos.splice(at, 1)[0]);
        renderPhotoStrip();
        for (let i = 0; i < state.photos.length; i++) {
          const r = await supa.from("listing_photos").update({ sort: i }).eq("id", state.photos[i].id);
          if (r.error) { toast("עדכון התמונה הראשית נכשל"); break; }
          state.photos[i].sort = i;
        }
        toast("התמונה הראשית עודכנה");
        await loadListings();
      }
      return;
    }
    const cp = e.target.closest("[data-coverpend]");
    if (cp) { const i = +cp.dataset.coverpend; state.pending.unshift(state.pending.splice(i, 1)[0]); renderPhotoStrip(); return; }
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

  /* ------------------------------------------------------------ address ----
   * Until now an agent could only attach a listing to one of the buildings we
   * already had, so anything else in the country was unpublishable. Same flow
   * as the website: search the address (Nominatim), fetch the real outline
   * (Overpass), and let ensure_building() dedupe-or-create server-side.
   * The building dropdown stays as the fallback when the lookup is down. */
  const addr = { picked: null, footprint: null };
  let addrTimer = null;

  function resetAddress(building) {
    addr.picked = null; addr.footprint = null;
    $("f-address").value = "";
    $("f-addr-results").hidden = true; $("f-addr-results").innerHTML = "";
    $("f-addr-match").hidden = true; $("f-addr-match").textContent = "";
    const picked = $("f-addr-picked");
    // Editing: show the current building as text, but keep the dropdown closed.
    // Leaving it open made it look like the field that decides, when the
    // address search is what actually does.
    if (building && building.address) {
      picked.textContent = "📍 " + (building.name || "") + " — " + building.address;
      picked.hidden = false;
    } else {
      picked.hidden = true; picked.textContent = "";
    }
  }

  $("f-address").addEventListener("input", (e) => {
    const q = e.target.value;
    clearTimeout(addrTimer);
    addr.picked = null;
    if (q.trim().length < 3) { $("f-addr-results").hidden = true; return; }
    addrTimer = setTimeout(async () => {           // debounce: Nominatim is shared
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
    addr.picked = it;
    const picked = $("f-addr-picked");
    picked.textContent = "מאתר את מתאר הבניין…";
    picked.hidden = false;
    const fp = await BVGeo.fetchFootprint(it.lat, it.lng);   // a bonus, not a requirement
    addr.footprint = fp;
    // a match with no house number is the street, not the building — say so
    picked.textContent = "📍 " + it.short +
      (fp ? " — נמצא מתאר בניין אמיתי"
          : it.hasNumber ? " — ללא מתאר מדויק, ימוקם לפי הכתובת"
                         : " — ⚠️ התוצאה היא הרחוב בלבד, ללא מספר בית. הנכס ימוקם באמצע הרחוב.");
    showAddrMatch(it, fp);
  });

  // say which building this will attach to, before saving
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
      if (error || !data || !data.length) {
        // 25/26 not applied, or the call was refused — say nothing rather than
        // guess, but leave a trace so this is diagnosable instead of silent
        console.warn("[BlockView] building match preview unavailable:", error && error.message);
        return;
      }
      const m = data[0];
      if (m.reason === "new") {
        box.textContent = "🏠 ייווצר בניין חדש בכתובת הזו.";
      } else if (m.reason === "existing_hidden") {
        box.textContent = "🏢 הנכס יצורף לבניין קיים בכתובת הזו.";
      } else {
        box.className = "addr-match warn";
        box.textContent = '⚠️ הנכס יצורף לבניין הקיים "' + (m.name || "") + '" — ' + (m.address || "") +
          (m.reason === "nearby" ? ". הכתובת שבחרת נמצאת במרחק של כמה מטרים ממנו." : ". זו אותה כתובת.");
      }
      box.hidden = false;
    } catch (err) { /* the preview is a courtesy — never block saving */ }
  }

  /* The building id to save against.
   * The address decides. The only case that does not need one is editing a
   * listing whose address the agent did not touch. */
  async function resolveBuilding() {
    if (!addr.picked) {
      if ($("f-id").value && $("f-building").value) return $("f-building").value; // editing, address untouched
      throw new Error("נא לבחור את כתובת הנכס");
    }
    const a = addr.picked, fp = addr.footprint;
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

  $("listing-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("f-err").hidden = true;
    $("f-save").disabled = true;
    try {
      const contacts = readContacts();   // validated before anything is written
      const buildingId = await resolveBuilding();
      const row = {
        building_id: buildingId,
        agent_id: state.user.id,
        deal: $("f-deal").value,
        rent_term: $("f-deal").value === "rent" ? $("f-term").value : null,
        title: $("f-title").value.trim(),
        price: checkedPrice($("f-price").value),
        rooms: +$("f-rooms").value,
        size: +$("f-size").value,
        floor: +$("f-floor").value || 0,
        floors_total: +$("f-floors-total").value || null,
        category: $("f-category").value,
        type: $("f-type").value,
        age: $("f-age").value,
        status: $("f-id").value ? $("f-status").value : "pending",
        tour_url: $("f-tour").value.trim() || null,
        website_url: $("f-website").value.trim() || null,
        description: $("f-desc").value.trim(),
        furnished: $("f-furnished").checked,
        pets: $("f-pets").checked,
        parking: $("f-parking").checked,
        elevator: $("f-elevator").checked,
        balcony: $("f-balcony").checked,
        balcony_size: $("f-balcony").checked ? (+$("f-balcony-size").value || null) : null,
        yard: $("f-yard").checked,
        yard_size: $("f-yard").checked ? (+$("f-yard-size").value || null) : null,
      };
      const id = $("f-id").value;
      let listingId = id;
      let bouncedBack = false;
      if (id) {
        // read the status back: editing a live listing sends it for re-approval
        // (supabase/26_listing_revisions.sql), and the agent should hear that
        // from us rather than notice it later
        const was = (state.listings.find((l) => l.id === id) || {}).status;
        const { data, error } = await supa.from("listings").update(row).eq("id", id).select("status").single();
        if (error) throw error;
        bouncedBack = was === "approved" && data && data.status === "pending";
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
      // contacts: replace the whole set (RLS keeps this to our own listing)
      const del = await supa.from("listing_contacts").delete().eq("listing_id", listingId);
      if (del.error) throw del.error;
      if (contacts.length) {
        const cins = await supa.from("listing_contacts").insert(
          contacts.map((c, i) => ({ listing_id: listingId, name: c.name, phone: c.phone, email: c.email, whatsapp: c.whatsapp, sort: i })));
        if (cins.error) throw cins.error;
      }
      // fill in "what's nearby" for the building if it has none yet
      // (api/nearby.js) — fire-and-forget, never blocks the save
      primeNearby(row.building_id);
      toast(bouncedBack ? "הנכס עודכן ונשלח לאישור מחדש" : id ? "הנכס עודכן" : "הנכס נוסף");
      await loadListings();
      switchTab("listings");
    } catch (err) {
      showErr("f-err", err.message || "שגיאה בשמירה");
    } finally {
      $("f-save").disabled = false;
    }
  });

  /* ---- description writer (js/describe-gen.js) ----
   * Builds the text from the fields on this form, plus the measured walking
   * distances for the building, so everything it writes is checkable. It never
   * overwrites without asking. */
  $("f-desc-gen").addEventListener("click", async () => {
    if (!window.BVDescribe) return toast("מחולל הניסוח לא נטען");
    const b = state.buildings.find((x) => x.id === $("f-building").value) || {};
    const fields = {
      deal: $("f-deal").value,
      category: $("f-category").value,
      type: $("f-type").value,
      rooms: $("f-rooms").value,
      size: $("f-size").value,
      floor: $("f-floor").value,
      floorsTotal: $("f-floors-total").value,
      city: b.city || "",
      age: $("f-age").value,
      elevator: $("f-elevator").checked,
      parking: $("f-parking").checked,
      furnished: $("f-furnished").checked,
      pets: $("f-pets").checked,
      address: b.address || "",
      building: b.name || "",
      nearby: await nearbyFor($("f-building").value),
    };
    if (!fields.rooms || !fields.size) return toast("מלא חדרים ושטח כדי לנסח תיאור");

    const options = window.BVDescribe.variants(fields, "he");
    const chosen = await chooseText("ניסוח תיאור", options);
    if (chosen === null) return;
    const current = $("f-desc").value.trim();
    if (current && !(await askConfirm({
      title: "להחליף את התיאור הקיים?",
      lines: ["הטקסט שכתבת יוחלף בניסוח שנבחר."],
      okText: "החלף", danger: true,
    }))) return;
    $("f-desc").value = chosen;
    toast("התיאור עודכן — אפשר לערוך");
  });

  // nearest place per category for a building, cached (public read, no auth)
  const nearbyCache = {};
  async function nearbyFor(buildingId) {
    if (!buildingId) return {};
    if (nearbyCache[buildingId]) return nearbyCache[buildingId];
    try {
      const { data } = await supa.from("building_places")
        .select("category, walk_minutes, rank").eq("building_id", buildingId).eq("rank", 1);
      const out = {};
      (data || []).forEach((r) => (out[r.category] = { minutes: r.walk_minutes }));
      nearbyCache[buildingId] = out;
      return out;
    } catch (e) { return {}; }
  }

  /* a small chooser: same look as askConfirm, but the buttons are the options */
  function chooseText(title, options) {
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.className = "bv-modal-back";
      const box = document.createElement("div");
      box.className = "bv-modal wide";
      const h = document.createElement("h3");
      h.textContent = title;
      box.appendChild(h);
      const hint = document.createElement("p");
      hint.className = "bv-modal-hint";
      hint.textContent = "בחר ניסוח. הכל נבנה מהפרטים שמילאת ואפשר לערוך אחר כך.";
      box.appendChild(hint);

      options.forEach((text) => {
        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "gen-option";
        opt.textContent = text;
        opt.addEventListener("click", () => close(text));
        box.appendChild(opt);
      });

      const row = document.createElement("div");
      row.className = "bv-modal-actions";
      const cancel = document.createElement("button");
      cancel.className = "btn-ghost";
      cancel.textContent = "ביטול";
      cancel.addEventListener("click", () => close(null));
      row.appendChild(cancel);
      box.appendChild(row);
      back.appendChild(box);
      document.body.appendChild(back);

      function close(v) { document.removeEventListener("keydown", onKey, true); back.remove(); resolve(v); }
      function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(null); } }
      back.addEventListener("click", (e) => { if (e.target === back) close(null); });
      document.addEventListener("keydown", onKey, true);
    });
  }

  $("f-cancel").addEventListener("click", () => switchTab("listings"));
  $("f-delete").addEventListener("click", async () => {
    const id = $("f-id").value;
    if (!id) return;
    if (!(await askConfirm({ title: "מחיקת נכס", lines: ["הנכס והתמונות שלו יימחקו לצמיתות."], okText: "מחק נכס", danger: true }))) return;
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
      if (!(await askConfirm({ title: "מחיקת פנייה", lines: ["הפנייה תימחק לצמיתות."], okText: "מחק פנייה", danger: true }))) return;
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
    $("tab-analytics").hidden = name !== "analytics";
    if (name === "security") refreshSecurity();
    if (name === "analytics") loadAnalytics();
  }
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => { if (t.dataset.tab === "editor") openEditor(null); else switchTab(t.dataset.tab); }));

  /* -------------------------------------------------------- analytics ----
   * Numbers come from agent_listing_stats(), a SECURITY DEFINER function that
   * only ever returns aggregates for the caller's own listings — raw view rows
   * are not readable from the browser at all (supabase/16_analytics.sql).
   */
  const iso = (d) => d.toISOString().slice(0, 10);
  function analyticsRange() {
    const sel = $("an-range").value;
    if (sel === "custom") {
      const from = $("an-from").value, to = $("an-to").value;
      if (from && to && from <= to) return { from, to };
    }
    const days = parseInt(sel, 10) || 30;
    const to = new Date();
    const from = new Date(Date.now() - (days - 1) * 86400000);
    return { from: iso(from), to: iso(to) };
  }

  function tile(n, label) { return `<div class="stat"><b>${esc(n)}</b><span>${esc(label)}</span></div>`; }

  // hand-rolled SVG bars: no chart library, nothing loaded at runtime
  function renderChart(daily, range) {
    const box = $("an-chart");
    const byDay = {};
    daily.forEach((d) => (byDay[d.day] = d));
    const days = [];
    for (let t = new Date(range.from + "T00:00:00"); iso(t) <= range.to; t.setDate(t.getDate() + 1)) {
      const key = iso(t);
      days.push({ day: key, views: (byDay[key] || {}).views || 0 });
    }
    const max = Math.max(1, ...days.map((d) => d.views));
    const W = Math.max(days.length * 14, 300), H = 120, pad = 18;
    const bw = (W - pad) / days.length;
    const bars = days.map((d, i) => {
      const h = Math.round((d.views / max) * (H - pad - 14));
      const x = pad + i * bw, y = H - 14 - h;
      const label = new Date(d.day + "T00:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(2, bw - 3).toFixed(1)}" height="${Math.max(h, d.views ? 2 : 0)}"
                rx="2" fill="#0038B8" opacity="${d.views ? 0.9 : 0.12}"><title>${esc(label)}: ${d.views}</title></rect>`;
    }).join("");
    const ticks = `<text x="2" y="12" font-size="10" fill="#8592A2">${max}</text>
                   <text x="2" y="${H - 16}" font-size="10" fill="#8592A2">0</text>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
      aria-label="צפיות לפי יום">${ticks}${bars}</svg>`;
  }

  function renderAnalytics(stats, range) {
    const tot = stats.totals || {};
    $("an-stats").innerHTML =
      tile(tot.views || 0, "צפיות בנכס") +
      tile(tot.unique_viewers || 0, "מבקרים ייחודיים") +
      tile(tot.impressions || 0, "הופעות ברשימה") +
      tile(tot.contacts || 0, "פניות ויצירות קשר") +
      tile((tot.web || 0) + " / " + (tot.app || 0), "אתר / אפליקציה");

    renderChart(stats.daily || [], range);

    const rows = (stats.listings || []).filter((l) => l.views || l.impressions);
    $("an-empty").hidden = rows.length > 0;
    $("an-list").innerHTML = rows.map((l) => {
      const total = (l.web || 0) + (l.app || 0);
      const webPct = total ? Math.round((l.web / total) * 100) : 0;
      const rate = l.views ? Math.round((l.contacts / l.views) * 100) : 0;
      return `<div class="an-row">
        <div class="an-main">
          <div class="an-title">${esc(l.title)} <span class="badge ${esc(l.status)}">${esc(STATUS_HE[l.status] || l.status)}</span></div>
          <div class="an-split">
            <div class="an-bar"><span style="width:${webPct}%"></span></div>
            <span class="an-legend">אתר ${l.web || 0} · אפליקציה ${l.app || 0}</span>
          </div>
        </div>
        <div class="an-nums">
          <div><b>${l.views || 0}</b><span>צפיות</span></div>
          <div><b>${l.unique_viewers || 0}</b><span>ייחודיים</span></div>
          <div><b>${l.contacts || 0}</b><span>פניות</span></div>
          <div><b>${rate}%</b><span>המרה</span></div>
        </div>
      </div>`;
    }).join("");
  }

  async function loadAnalytics() {
    const range = analyticsRange();
    const surface = $("an-surface").value || null;
    const { data, error } = await supa.rpc("agent_listing_stats", {
      from_date: range.from, to_date: range.to, surface_filter: surface, listing: null,
    });
    if (error) {
      $("an-list").innerHTML = "";
      $("an-empty").hidden = false;
      $("an-empty").textContent = /function/i.test(error.message)
        ? "טבלת האנליטיקס לא הוגדרה עדיין — הרץ את supabase/16_analytics.sql."
        : "שגיאה בטעינת הנתונים: " + error.message;
      return;
    }
    $("an-empty").textContent = "אין עדיין צפיות בטווח הזה. הנתונים נאספים מרגע שהנכס מאושר ומופיע במפה.";
    renderAnalytics(data || {}, range);
  }

  $("an-range").addEventListener("change", () => {
    const custom = $("an-range").value === "custom";
    $("an-from").hidden = !custom; $("an-to").hidden = !custom;
    if (custom) {
      if (!$("an-to").value) $("an-to").value = iso(new Date());
      if (!$("an-from").value) $("an-from").value = iso(new Date(Date.now() - 29 * 86400000));
    }
    loadAnalytics();
  });
  ["an-from", "an-to", "an-surface"].forEach((id) => $(id).addEventListener("change", loadAnalytics));

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
