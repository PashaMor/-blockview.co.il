/* BlockView — "my properties" inside the account sheet.
 *
 * An owner publishes from the website but had nowhere to see what happened to
 * it afterwards: whether it was approved, why it was rejected, or how to fix a
 * price. The CRM is for agents only, so this is the owner's equivalent — a list
 * of their own listings with the status, and edit / delete.
 *
 * RLS does the access control: listings_read already returns a row to the
 * person whose agent_id it is, so this asks for "mine" and gets exactly that.
 * Editing an approved listing sends it back for approval — the DB does that
 * (supabase/26_listing_revisions.sql), and we say so plainly here.
 *
 * Conservative JS (see CLAUDE.md).
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var T = function (k, fb) { return (window.t ? window.t(k) : fb) || fb; };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var STATUS = {
    approved: { cls: "approved", key: "st_approved", fb: "מאושר — מופיע במפה" },
    pending:  { cls: "pending",  key: "st_pending",  fb: "ממתין לאישור" },
    rejected: { cls: "rejected", key: "st_rejected", fb: "נדחה" },
    sold:     { cls: "sold",     key: "st_sold",     fb: "נמכר" },
    draft:    { cls: "draft",    key: "st_draft",    fb: "טיוטה" },
  };

  function db() { return window.BVSupa || window.BVDB; }
  function money(n) { return "₪" + Number(n || 0).toLocaleString("he-IL"); }

  var state = { rows: [] };

  async function load() {
    if (!db() || !window.BVAuth || !window.BVAuth.isLoggedIn()) return [];
    var res = await db().from("listings")
      .select("*, buildings(name,address,city), listing_photos(path,sort)")
      .order("created_at", { ascending: false });
    if (res.error) { console.warn("[BlockView] my listings:", res.error.message); return []; }
    return res.data || [];
  }

  function photoUrl(path) {
    try { return db().storage.from("listing-photos").getPublicUrl(path).data.publicUrl; }
    catch (e) { return ""; }
  }

  function card(l) {
    var st = STATUS[l.status] || STATUS.pending;
    var b = l.buildings || {};
    var ph = (l.listing_photos || []).slice().sort(function (a, c) { return a.sort - c.sort; })[0];
    var thumb = ph
      ? '<img class="ml-thumb" src="' + esc(photoUrl(ph.path)) + '" alt="" />'
      : '<div class="ml-thumb">🏠</div>';
    var canEdit = !!window.BVPublish;    // website only; the app has no publish form
    return '<article class="ml-card">' +
      thumb +
      '<div class="ml-main">' +
        '<div class="ml-title">' + esc(l.title || "") + "</div>" +
        '<div class="ml-sub">' + esc(b.address || b.name || "") + "</div>" +
        '<div class="ml-meta">' +
          "<span>" + esc(money(l.price)) + "</span>" +
          (l.rooms ? "<span>" + esc(l.rooms) + " " + T("rooms", "חדרים") + "</span>" : "") +
          (l.size ? "<span>" + esc(l.size) + ' מ"ר</span>' : "") +
          '<span class="badge ' + st.cls + '">' + esc(T(st.key, st.fb)) + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="ml-actions">' +
        (canEdit ? '<button class="ml-btn" data-ml-edit="' + esc(l.id) + '">' + esc(T("edit", "עריכה")) + "</button>" : "") +
        '<button class="ml-btn danger" data-ml-del="' + esc(l.id) + '">' + esc(T("delete", "מחיקה")) + "</button>" +
      "</div>" +
    "</article>";
  }

  async function render() {
    var wrap = $("acc-listings-wrap");
    if (!wrap) return;
    state.rows = await load();
    if (!state.rows.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $("acc-listings-count").textContent = state.rows.length;
    $("acc-listings").innerHTML = state.rows.map(card).join("");
  }

  /* ------------------------------------------------------------ actions ---- */
  document.addEventListener("click", async function (e) {
    var ed = e.target.closest ? e.target.closest("[data-ml-edit]") : null;
    if (ed) {
      var row = findRow(ed.getAttribute("data-ml-edit"));
      if (row && window.BVPublish) window.BVPublish.openEdit(row);
      return;
    }
    var del = e.target.closest ? e.target.closest("[data-ml-del]") : null;
    if (!del) return;
    var l = findRow(del.getAttribute("data-ml-del"));
    if (!l) return;
    if (!window.confirm(T("del_listing_warn", "למחוק את הנכס לצמיתות? התמונות והפניות שהתקבלו יימחקו גם הם."))) return;
    var res = await db().from("listings").delete().eq("id", l.id);
    if (res.error) {
      if (window.bvToast) window.bvToast(T("del_listing_failed", "מחיקת הנכס נכשלה"));
      return;
    }
    if (window.bvToast) window.bvToast(T("del_listing_ok", "הנכס נמחק"));
    await render();
    if (window.reloadLiveData) window.reloadLiveData();
  });

  function findRow(id) {
    for (var i = 0; i < state.rows.length; i++) if (state.rows[i].id === id) return state.rows[i];
    return null;
  }

  window.BVMyListings = { render: render };
})();
