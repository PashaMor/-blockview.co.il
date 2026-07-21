/* BlockView — "become an agent" from the website and the app.
 * Same application the CRM takes (public.agent_applications) and the same logo
 * bucket, so an application started here is the one the admin reviews.
 *
 * Security: this only *asks*. The role is granted exclusively by an admin
 * through review_agent_application(); RLS lets a user write only their own
 * application row, and a trigger forces status='pending'.
 */
(function () {
  var LOGO_BUCKET = "agent-logos";
  var $ = function (id) { return document.getElementById(id); };
  var T = function (k, fb) { return (window.t ? window.t(k) : fb) || fb; };
  var supa = function () { return window.BVSupa; };
  if (!$("agent-sheet")) return;

  var state = { user: null, role: "user", app: null, logoBlob: null, logoPath: null };

  /* ------------------------------------------------------- the profile row */
  // Called by auth.js whenever the account sheet is rendered.
  window.BVAgent = {
    // opens the application form; refreshes the state first so a pending or
    // rejected application is prefilled rather than shown as a blank form
    openApply: async function () {
      try {
        var u = await supa().auth.getUser();
        var user = u && u.data ? u.data.user : null;
        if (!user) { if (window.BVAuth) window.BVAuth.openAuth(); return; }
        await window.BVAgent.refresh(user);
      } catch (e) {}
      open();
    },
    refresh: async function (user) {
      state.user = user || null;
      var row = $("acc-agent-row");
      if (!row) return;
      if (!state.user) { row.hidden = true; return; }
      try {
        var pr = await supa().from("profiles").select("role").eq("id", state.user.id).single();
        state.role = (pr && pr.data && pr.data.role) || "user";
        var ar = await supa().from("agent_applications").select("*").eq("user_id", state.user.id).maybeSingle();
        state.app = (ar && ar.data) || null;
      } catch (e) { state.role = "user"; state.app = null; }
      paint();
    },
  };

  function paint() {
    var row = $("acc-agent-row");
    var title = $("acc-agent-title"), sub = $("acc-agent-sub"), btn = $("acc-agent-btn");
    row.hidden = false;

    if (state.role === "agent" || state.role === "admin") {
      title.textContent = T("agent_account", "חשבון סוכן");
      sub.textContent = T("agent_account_sub", "ניהול הנכסים, הלידים והמיתוג שלך");
      btn.textContent = T("go_to_crm", "🧑‍💼 מעבר ל-CRM");
      btn.className = "acc-agent-btn primary";
      btn.onclick = openCrm;
      return;
    }
    var st = state.app && state.app.status;
    if (st === "pending") {
      title.textContent = T("agent_pending", "בקשת הסוכן ממתינה לאישור");
      sub.textContent = T("agent_pending_sub", "נעדכן אותך כשמנהל המערכת יבדוק אותה");
      btn.textContent = T("view_edit", "צפייה ועריכה");
    } else if (st === "rejected") {
      title.textContent = T("agent_rejected", "הבקשה נדחתה");
      sub.textContent = (state.app && state.app.admin_note) || T("agent_rejected_sub", "אפשר לתקן ולשלוח שוב");
      btn.textContent = T("apply_again", "שליחה מחדש");
    } else {
      title.textContent = T("are_you_agent", "אתה מתווך?");
      sub.textContent = T("are_you_agent_sub", "הירשם כסוכן וקבל CRM לניהול נכסים ולידים");
      btn.textContent = T("agent_register", "הרשמה כסוכן");
    }
    btn.className = "acc-agent-btn";
    btn.onclick = open;
  }

  function openCrm() {
    var url = "https://crm.blockview.co.il";
    var cap = window.Capacitor;
    var browser = cap && cap.Plugins && cap.Plugins.Browser;
    // in the app the CRM opens outside the WebView, so the map is still there
    if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
      if (browser && browser.open) browser.open({ url: url });
      else window.open(url, "_system");
      return;
    }
    window.location.href = url;
  }

  /* ------------------------------------------------------------- the form */
  var sheet = function () { return $("agent-sheet"); };

  function open() {
    if (window.closeAllSheets) window.closeAllSheets();
    if (window.closeAuthSheets) window.closeAuthSheets();
    $("ag-err").hidden = true;
    $("ag-form").reset();
    state.logoBlob = null;
    state.logoPath = (state.app && state.app.logo_path) || null;
    $("ag-logo-preview").hidden = true;

    var a = state.app;
    if (a) {
      $("ag-first").value = a.first_name || "";
      $("ag-last").value = a.last_name || "";
      $("ag-agency").value = a.agency || "";
      $("ag-license").value = a.license_no || "";
      $("ag-phone").value = a.phone || "";
      $("ag-city").value = a.city || "";
      $("ag-note").value = a.note || "";
      if (a.logo_path) showLogo(logoUrl(a.logo_path));
    }
    var box = $("ag-status");
    if (a && a.status === "rejected" && a.admin_note) {
      box.textContent = T("admin_note", "הערת מנהל") + ": " + a.admin_note;
      box.hidden = false;
    } else box.hidden = true;

    sheet().classList.add("open");
    sheet().setAttribute("aria-hidden", "false");
  }
  function close() { sheet().classList.remove("open"); sheet().setAttribute("aria-hidden", "true"); }
  $("ag-close").addEventListener("click", close);

  function logoUrl(p) {
    try { return supa().storage.from(LOGO_BUCKET).getPublicUrl(p).data.publicUrl; }
    catch (e) { return ""; }
  }
  function showLogo(src) { $("ag-logo-img").src = src; $("ag-logo-preview").hidden = false; }

  // squared + compressed in the browser, like the CRM does
  $("ag-logo").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f || !/^image\//.test(f.type)) return;
    var rd = new FileReader();
    rd.onload = function (ev) {
      var im = new Image();
      im.onload = function () {
        var s = 256, c = document.createElement("canvas");
        c.width = s; c.height = s;
        var ctx = c.getContext("2d");
        var sc = Math.min(s / im.width, s / im.height);
        var w = im.width * sc, h = im.height * sc;
        ctx.drawImage(im, (s - w) / 2, (s - h) / 2, w, h);
        showLogo(c.toDataURL("image/png"));
        c.toBlob(function (b) { state.logoBlob = b; }, "image/png");
      };
      im.src = ev.target.result;
    };
    rd.readAsDataURL(f);
  });

  $("ag-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = $("ag-err"); err.hidden = true;
    var btn = $("ag-submit"); btn.disabled = true;
    try {
      if (!state.user) throw new Error(T("login_first", "יש להתחבר תחילה"));
      var first = $("ag-first").value.trim(), last = $("ag-last").value.trim();
      if (!state.logoBlob && !state.logoPath) throw new Error(T("logo_required", "נא להעלות את לוגו המשרד"));

      // storage RLS: a user may only write inside a folder named after their uid
      if (state.logoBlob) {
        var path = state.user.id + "/logo_" + Date.now() + ".png";
        var up = await supa().storage.from(LOGO_BUCKET)
          .upload(path, state.logoBlob, { contentType: "image/png", upsert: true });
        if (up.error) throw up.error;
        var old = state.logoPath;
        state.logoPath = path;
        state.logoBlob = null;
        if (old && old !== path) { try { await supa().storage.from(LOGO_BUCKET).remove([old]); } catch (e2) {} }
      }

      var row = {
        user_id: state.user.id,
        first_name: first,
        last_name: last,
        full_name: (first + " " + last).trim(),
        phone: $("ag-phone").value.trim(),
        agency: $("ag-agency").value.trim(),
        license_no: $("ag-license").value.trim(),
        logo_path: state.logoPath,
        city: $("ag-city").value.trim(),
        note: $("ag-note").value.trim(),
        status: "pending",          // the DB trigger forces this anyway
      };
      // upsert so a rejected applicant can fix and resend; an approved row is locked by RLS
      var res = await supa().from("agent_applications")
        .upsert(row, { onConflict: "user_id" }).select("*").single();
      if (res.error) throw res.error;
      state.app = res.data;
      close();
      paint();
      if (window.bvToast) window.bvToast(T("agent_apply_ok", "הבקשה נשלחה ✓"));
    } catch (e3) {
      err.textContent = e3.message || T("agent_apply_failed", "שליחת הבקשה נכשלה");
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
})();
