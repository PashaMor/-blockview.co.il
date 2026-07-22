/* BlockView — Supabase auth + per-user data layer.
 * Security: uses the browser publishable key only; every table is protected by
 * Row-Level Security and the free-tier limits are enforced by DB triggers, so
 * the client cannot exceed them even if this code is bypassed.
 */
(function () {
  const cfg = window.BLOCKVIEW_CONFIG;
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY,
    window.BVOAuth ? BVOAuth.clientOptions() : undefined);
  if (window.BVOAuth && BVOAuth.shareSession) BVOAuth.shareSession(supa);   // share session across *.blockview.co.il
  window.BVSupa = supa; // shared client (publish.js reuses it)
  const limits = cfg.LIMITS;
  const state = { user: null, plan: "free", avatar: null, notifications: false, termsAcceptedAt: null, home: null };
  let consentPending = false;   // set when the user ticks the box on sign-up
  const $ = (id) => document.getElementById(id);

  /* ---------- load this user's data ---------- */
  async function loadUserData() {
    if (!state.user) { if (window.onUserData) window.onUserData([], [], {}, "free"); return; }
    const [prof, fav, fol, nt] = await Promise.all([
      // select * so a missing/new column can never break the whole profile load
      supa.from("profiles").select("*").eq("id", state.user.id).single(),
      supa.from("favorites").select("listing_id"),
      supa.from("follows").select("building_id"),
      supa.from("notes").select("listing_id, body"),
    ]);
    if (prof.error) console.warn("[BlockView] profile load failed:", prof.error.message);
    const p = prof.data || {};
    state.plan = p.plan || "free";
    state.avatar = p.avatar_url || null;
    state.notifications = !!p.notifications;
    state.termsAcceptedAt = p.terms_accepted_at || null;
    state.home = (p.home_lat != null && p.home_lng != null)
      ? { lat: +p.home_lat, lng: +p.home_lng, label: p.home_label || "" } : null;
    if (window.onHomeLocation) window.onHomeLocation(state.home);
    const notesObj = {};
    (nt.data || []).forEach((r) => (notesObj[r.listing_id] = r.body));
    if (window.onUserData)
      window.onUserData((fav.data || []).map((r) => r.listing_id), (fol.data || []).map((r) => r.building_id), notesObj, state.plan);
    if (window.onSavedFilter) window.onSavedFilter(p.saved_filter || null);
    if (window.applyTheme && p.theme) window.applyTheme(p.theme, false);
  }

  supa.auth.onAuthStateChange(async (_evt, session) => {
    state.user = session ? session.user : null;
    await loadUserData();
    // Stamp the consent as soon as a session exists. With email verification on,
    // sign-up returns no session, so the tick is remembered across the verification
    // link (localStorage) and recorded at first sign-in. A social sign-in counts as
    // consent through the notice shown next to the buttons.
    if (state.user && !state.termsAcceptedAt && (consentPending || savedConsent() || isSocial(session))) {
      await recordConsent();
    }
    updateAccountUI();
    closeAuth();
  });

  /* ---------- public API used by app.js ---------- */
  window.BVAuth = {
    isLoggedIn: () => !!state.user,
    plan: () => state.plan,
    canAdd(kind, count) { return count < (limits[state.plan] || limits.free)[kind]; },
    async addFav(id) {
      const { error } = await supa.from("favorites").insert({ user_id: state.user.id, listing_id: id });
      return error ? (/FREE_LIMIT/.test(error.message) ? "limit" : "error") : null;
    },
    async removeFav(id) { await supa.from("favorites").delete().eq("listing_id", id); },
    async addFollow(bid) {
      const { error } = await supa.from("follows").insert({ user_id: state.user.id, building_id: bid });
      return error ? (/FREE_LIMIT/.test(error.message) ? "limit" : "error") : null;
    },
    async removeFollow(bid) { await supa.from("follows").delete().eq("building_id", bid); },
    async saveNote(id, body) {
      if (body && body.trim())
        await supa.from("notes").upsert({ user_id: state.user.id, listing_id: id, body, updated_at: new Date().toISOString() }, { onConflict: "user_id,listing_id" });
      else
        await supa.from("notes").delete().eq("listing_id", id);
    },
    async saveFilter(obj) { if (state.user) await supa.from("profiles").update({ saved_filter: obj }).eq("id", state.user.id); },
    async clearFilter() { if (state.user) await supa.from("profiles").update({ saved_filter: null }).eq("id", state.user.id); },
    async saveTheme(m) { if (state.user) await supa.from("profiles").update({ theme: m }).eq("id", state.user.id); },
    email: () => (state.user ? state.user.email || "" : ""),
    home: () => state.home,
    async saveHome(lat, lng, label) {
      if (!state.user) return "auth";
      const { error } = await supa.from("profiles")
        .update({ home_lat: lat, home_lng: lng, home_label: label || null }).eq("id", state.user.id);
      if (error) return "error";
      state.home = { lat: lat, lng: lng, label: label || "" };
      if (window.onHomeLocation) window.onHomeLocation(state.home);
      return null;
    },
    async clearHome() {
      if (!state.user) return;
      await supa.from("profiles").update({ home_lat: null, home_lng: null, home_label: null }).eq("id", state.user.id);
      state.home = null;
      if (window.onHomeLocation) window.onHomeLocation(null);
    },
    openAuth, showUpgrade,
  };

  /* ---------- auth sheet ---------- */
  const authSheet = $("auth-sheet"), backdrop = $("sheet-backdrop");
  let signMode = "in";
  function openAuth() {
    if (window.closeAllSheets) window.closeAllSheets();
    $("auth-error").hidden = true;
    authSheet.classList.add("open"); authSheet.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
  }
  function closeAuth() { authSheet.classList.remove("open"); authSheet.setAttribute("aria-hidden", "true"); if (backdrop) backdrop.hidden = true; }
  function setMode(m) {
    signMode = m;
    $("auth-title").textContent = t(m === "in" ? "sign_in" : "sign_up");
    $("auth-submit").textContent = t(m === "in" ? "do_sign_in" : "do_sign_up");
    $("auth-toggle").textContent = t(m === "in" ? "sign_up" : "sign_in");
    // signing up requires ticking the consent box; signing in only shows the note
    const up = m === "up";
    $("auth-consent").hidden = !up;
    $("auth-legal-note").hidden = up;
    $("auth-consent-cb").checked = false;
  }
  function showError(msg) { const e = $("auth-error"); e.textContent = msg; e.hidden = false; }

  $("auth-close").addEventListener("click", closeAuth);
  $("auth-toggle").addEventListener("click", () => setMode(signMode === "in" ? "up" : "in"));
  // Google / Apple (hidden until enabled in config.js — see OAUTH_SETUP.md)
  if (window.BVOAuth) BVOAuth.wire(supa, authSheet, showError);
  $("auth-submit").addEventListener("click", async () => {
    const email = $("auth-email").value.trim(), pw = $("auth-pw").value;
    if (!email || !pw) { showError("נא למלא אימייל וסיסמה"); return; }
    if (signMode === "up" && !$("auth-consent-cb").checked) { showError(t("must_agree")); return; }
    const { data, error } = signMode === "in"
      ? await supa.auth.signInWithPassword({ email, password: pw })
      : await supa.auth.signUp({ email, password: pw });
    if (error) { showError(error.message); return; }
    if (signMode === "up") {
      consentPending = true;
      rememberConsent();                           // survives the email-verification gap
      if (data && data.session) await recordConsent();
      else showError(t("verify_email"));
    }
  });

  /* ---------- terms & privacy consent (recorded in the DB) ----------
   * The trigger in supabase/08_terms_consent.sql overwrites the timestamp with
   * now(), so the client can record consent but can neither back-date nor erase it. */
  const CONSENT_KEY = "blockview_consent";
  function savedConsent() { try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; } }
  function rememberConsent() { try { localStorage.setItem(CONSENT_KEY, cfg.LEGAL_VERSION); } catch (e) {} }
  function forgetConsent() { try { localStorage.removeItem(CONSENT_KEY); } catch (e) {} }
  function isSocial(session) {
    const p = session && session.user && session.user.app_metadata && session.user.app_metadata.provider;
    return !!p && p !== "email";
  }
  async function recordConsent() {
    if (!state.user) return;                       // retried from onAuthStateChange
    const { error } = await supa.from("profiles")
      .update({ terms_accepted_at: new Date().toISOString(), terms_version: cfg.LEGAL_VERSION })
      .eq("id", state.user.id);
    if (error) { console.warn("[BlockView] consent not saved:", error.message); return; }
    consentPending = false;
    forgetConsent();
    state.termsAcceptedAt = new Date().toISOString();
  }

  /* ---------- account sheet ---------- */
  const accountSheet = $("account-sheet");
  function openAccount() {
    if (!state.user) { openAuth(); return; }
    if (window.closeAllSheets) window.closeAllSheets();
    renderAccount();
    accountSheet.classList.add("open"); accountSheet.setAttribute("aria-hidden", "false");
  }
  function closeAccount() { accountSheet.classList.remove("open"); accountSheet.setAttribute("aria-hidden", "true"); }
  function renderAccount() {
    // signing out fires onAuthStateChange while this sheet may still be open
    if (!state.user) { closeAccount(); return; }
    // the listings this account published (js/my-listings.js); async, so it
    // fills in a moment after the sheet paints
    if (window.BVMyListings) window.BVMyListings.render();
    // agent status: CRM shortcut for approved agents, application for the rest
    if (window.BVAgent) window.BVAgent.refresh(state.user);
    const lim = limits[state.plan] || limits.free;
    const favN = window.favCount ? window.favCount() : 0, folN = window.subCount ? window.subCount() : 0;
    $("acc-email").textContent = state.user.email || "";
    $("acc-plan").textContent = state.plan === "pro" ? "Pro" : t("free");
    $("acc-usage").innerHTML =
      `<div class="row"><span>${t("saved_props")}</span><b>${favN} / ${lim.favorites === Infinity ? "∞" : lim.favorites}</b></div>` +
      `<div class="row"><span>${t("followed_buildings")}</span><b>${folN} / ${lim.follows === Infinity ? "∞" : lim.follows}</b></div>`;
    $("acc-upgrade").style.display = state.plan === "pro" ? "none" : "";
    // avatar
    const img = $("acc-avatar-img"), ini = $("acc-avatar-initial");
    if (state.avatar && /^data:image\//.test(state.avatar)) { img.src = state.avatar; img.hidden = false; ini.hidden = true; }
    else { img.hidden = true; ini.hidden = false; ini.textContent = (state.user.email || "?").charAt(0).toUpperCase(); }
    // notifications
    $("acc-notif").checked = !!state.notifications;
  }
  function updateAccountUI() {
    const btn = $("account-btn");
    if (state.user) {
      if (state.avatar && /^data:image\//.test(state.avatar)) { btn.textContent = ""; btn.style.backgroundImage = `url("${state.avatar}")`; }
      else { btn.style.backgroundImage = ""; btn.textContent = (state.user.email || "?").charAt(0).toUpperCase(); }
      btn.classList.add("in");
    } else { btn.style.backgroundImage = ""; btn.textContent = "👤"; btn.classList.remove("in"); }
    if (accountSheet.classList.contains("open")) renderAccount();
  }
  $("account-btn").addEventListener("click", () => (state.user ? openAccount() : openAuth()));
  $("account-close").addEventListener("click", closeAccount);
  $("acc-signout").addEventListener("click", async () => { closeAccount(); await supa.auth.signOut(); });

  /* ---------- delete my account (the right the privacy policy promises) ----------
   * delete_my_account() runs in the database and removes the auth user, which
   * cascades to the profile, saved properties, notes, listings, their photos and
   * any enquiries. Irreversible, so it asks twice. */
  $("acc-delete").addEventListener("click", async () => {
    if (!state.user) return;
    const email = state.user.email || "";
    // one on-brand dialog: the irreversible warning plus a type-your-email
    // confirmation. The OK button stays disabled until the email matches, so
    // there is no separate mismatch path to fall through.
    const typed = window.bvConfirm
      ? await window.bvConfirm({
          danger: true,
          icon: "🗑️",
          title: t("delete_account") || "מחיקת החשבון",
          text: t("delete_warn"),
          input: true,
          inputType: "email",
          inputPlaceholder: email,
          requireMatch: email,
          okText: t("delete_confirm_btn") || "מחק לצמיתות",
        })
      : (confirm(t("delete_warn")) ? prompt(t("delete_prompt")) : null);
    if (typed === null || typed === false) return;
    if (String(typed).trim().toLowerCase() !== email.toLowerCase()) {
      if (window.bvToast) window.bvToast(t("delete_mismatch"));
      return;
    }
    // Files go through the Storage API (SQL may not delete from storage.objects).
    // RLS already limits each user to their own <uid>/ folder. Best effort.
    const uid = state.user.id;
    for (const bucket of ["listing-photos", "agent-logos"]) {
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
      if (window.bvToast) window.bvToast(/LAST_ADMIN/.test(error.message) ? t("delete_last_admin") : t("delete_failed"));
      return;
    }
    closeAccount();
    await supa.auth.signOut();
    if (window.bvToast) window.bvToast(t("delete_done"));
  });
  $("acc-upgrade").addEventListener("click", () => { closeAccount(); showUpgrade(); });

  // avatar upload — resized & compressed client-side, stored as a small data-URL (RLS-protected profile row)
  $("acc-avatar-btn").addEventListener("click", () => $("acc-avatar-file").click());
  $("acc-avatar-file").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f || !/^image\//.test(f.type)) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const im = new Image();
      im.onload = async () => {
        const s = 128, c = document.createElement("canvas"); c.width = s; c.height = s;
        const ctx = c.getContext("2d");
        const sc = Math.max(s / im.width, s / im.height), w = im.width * sc, h = im.height * sc;
        ctx.drawImage(im, (s - w) / 2, (s - h) / 2, w, h);
        const dataUrl = c.toDataURL("image/jpeg", 0.82);
        const { error } = await supa.from("profiles").update({ avatar_url: dataUrl }).eq("id", state.user.id);
        if (error) {
          console.warn("[BlockView] avatar save failed:", error.message);
          if (window.bvToast) window.bvToast("שמירת התמונה נכשלה");
          return;
        }
        state.avatar = dataUrl;
        renderAccount(); updateAccountUI();
        if (window.bvToast) window.bvToast("תמונת הפרופיל עודכנה");
      };
      im.src = ev.target.result;
    };
    reader.readAsDataURL(f);
  });
  // notifications preference (real push needs native FCM later; this saves the preference)
  $("acc-notif").addEventListener("change", async (e) => {
    state.notifications = e.target.checked;
    await supa.from("profiles").update({ notifications: state.notifications }).eq("id", state.user.id);
    if (state.notifications && window.bvToast) window.bvToast("התראות יופעלו (דורש הגדרת פוש)");
  });

  /* ---------- upgrade modal ---------- */
  const upModal = $("upgrade-modal");
  function showUpgrade(kind) {
    $("upgrade-sub").textContent = t("pro_sub");
    upModal.hidden = false;
  }
  document.querySelectorAll(".pro-plan").forEach((p) =>
    p.addEventListener("click", () => {
      document.querySelectorAll(".pro-plan").forEach((x) => x.classList.remove("on"));
      p.classList.add("on");
    })
  );
  $("upgrade-close").addEventListener("click", () => (upModal.hidden = true));
  $("upgrade-go").addEventListener("click", () => {
    const sel = document.querySelector(".pro-plan.on");
    const price = sel && sel.dataset.plan === "month" ? "₪7.90 לחודש" : "₪54.90 לשנה";
    upModal.hidden = true;
    if (window.bvToast) window.bvToast(`תשלום (${price}) יתווסף בקרוב 💳`);
  });

  /* ---------- clean up after a social redirect ---------- */
  // supabase-js consumes ?code= itself; this only surfaces a provider error and
  // strips leftovers, keeping ?listing= (the share deep link) intact.
  (function afterOAuthRedirect() {
    const q = new URLSearchParams(location.search);
    const err = q.get("error_description") || q.get("error");
    if (err) { openAuth(); showError(err); }
    if (!err && !q.get("code")) return;
    ["code", "error", "error_description", "error_code", "state"].forEach((k) => q.delete(k));
    const qs = q.toString();
    history.replaceState({}, "", location.pathname + (qs ? "?" + qs : ""));
  })();

  window.closeAuthSheets = () => { closeAuth(); closeAccount(); };
  window.reRenderAuth = () => setMode(signMode);
  window.renderAccountIfOpen = () => { if (accountSheet.classList.contains("open")) renderAccount(); };
  setMode("in");
})();
