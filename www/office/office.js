/* BlockView — public office (brokerage) page.
 * Reads ?id=<office id> and shows the office branding, its agents, and every
 * approved listing across the office. All public data: offices are readable
 * when approved, office_members/agent_profiles are public branding, and RLS
 * limits listings to approved ones. Anon publishable key only. */
(function () {
  var cfg = window.BLOCKVIEW_CONFIG;
  var supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var nis = function (n) { return "₪" + Number(n || 0).toLocaleString("he-IL"); };
  var photoUrl = function (p) { return supa.storage.from("listing-photos").getPublicUrl(p).data.publicUrl; };
  var logoUrl = function (p) { return supa.storage.from("agent-logos").getPublicUrl(p).data.publicUrl; };
  function param(name) { try { return new URLSearchParams(location.search).get(name) || ""; } catch (e) { return ""; } }
  function waNumber(raw) { var d = String(raw || "").replace(/\D/g, ""); if (!d) return "";
    if (d.indexOf("972") === 0) return d; if (d.charAt(0) === "0") return "972" + d.slice(1); return d; }
  function typeHe(t) { return { flat: "דירה", house: "בית", penthouse: "פנטהאוז", studio: "סטודיו",
    office: "משרד", shop: "חנות", warehouse: "מחסן", other: "אחר" }[t] || ""; }

  (function () {
    var back = document.querySelector(".back");
    if (back) back.addEventListener("click", function (e) {
      if (window.history && history.length > 1 && document.referrer) { e.preventDefault(); history.back(); }
    });
  })();

  function listingCard(l) {
    var b = l.buildings || {};
    var photos = (l.listing_photos || []).slice().sort(function (a, c) { return a.sort - c.sort; });
    var thumb = photos.length
      ? '<div class="c-thumb" style="background-image:url(\'' + photoUrl(photos[0].path) + '\')"></div>'
      : '<div class="c-thumb empty">🏠</div>';
    var deal = l.deal === "sale" ? "מכירה" : "השכרה";
    var per = l.deal === "rent" ? ' <span class="per">/ לחודש</span>' : "";
    return '<a class="card" href="https://blockview.co.il/?listing=' + encodeURIComponent(l.id) + '">' + thumb +
      '<div class="c-body"><div class="c-deal ' + esc(l.deal) + '">' + deal + '</div>' +
      '<div class="c-price">' + nis(l.price) + per + '</div>' +
      '<div class="c-title">' + esc(l.title || "") + '</div>' +
      '<div class="c-where">' + esc([b.name, b.city].filter(Boolean).join(" · ")) + '</div>' +
      '<div class="c-specs"><span>' + esc(typeHe(l.type)) + '</span><span>🚪 ' + esc(l.rooms) +
      '</span><span>📐 ' + esc(l.size) + ' מ"ר</span></div></div></a>';
  }

  function agentChip(a) {
    var name = [a.first_name, a.last_name].filter(Boolean).join(" ") || "סוכן";
    var logo = a.logo_path
      ? '<span class="ac-logo" style="background-image:url(\'' + logoUrl(a.logo_path) + '\')"></span>'
      : '<span class="ac-logo ac-init">' + esc(name.charAt(0)) + "</span>";
    return '<a class="agent-chip" href="https://blockview.co.il/agent/?id=' + encodeURIComponent(a.user_id) + '">' +
      logo + '<span class="ac-name">' + esc(name) + "</span></a>";
  }

  function done(which) {
    $("loading").hidden = true;
    if (which === "notfound") { $("notfound").hidden = false; return; }
    $("profile").hidden = false; $("agents-wrap").hidden = false; $("listings-wrap").hidden = false;
  }

  async function load() {
    var id = param("id");
    if (!id) return done("notfound");

    var or = await supa.from("offices").select("name,city,address,phone,website,license_no,logo_path,status")
      .eq("id", id).maybeSingle();
    var o = or && or.data;
    if (!o || o.status !== "approved") return done("notfound");

    document.title = (o.name || "משרד") + " · BlockView";
    $("p-name").textContent = o.name || "משרד";
    $("p-city").textContent = [o.city, o.address].filter(Boolean).join(" · ");
    $("p-license").textContent = o.license_no ? ("רישיון " + o.license_no) : "";
    if (o.logo_path) { var img = new Image(); img.alt = ""; img.src = logoUrl(o.logo_path);
      $("p-logo").textContent = ""; $("p-logo").appendChild(img); }

    var acts = [];
    var wa = waNumber(o.phone);
    if (o.phone) acts.push('<a class="act" href="tel:' + esc(o.phone) + '">📞 ' + esc(o.phone) + "</a>");
    if (wa) acts.push('<a class="act wa" href="https://wa.me/' + wa + '" target="_blank" rel="noopener">💬 וואטסאפ</a>');
    if (o.website && /^https?:\/\//i.test(o.website)) acts.push('<a class="act" href="' + esc(o.website) + '" target="_blank" rel="noopener noreferrer">🌐 אתר</a>');
    $("p-actions").innerHTML = acts.join("");
    done();

    // members -> agent profiles
    var mr = await supa.from("office_members").select("user_id,member_role").eq("office_id", id).eq("status", "active");
    var ids = ((mr && mr.data) || []).map(function (m) { return m.user_id; }).filter(Boolean);
    if (ids.length) {
      var pr = await supa.from("agent_profiles").select("user_id,first_name,last_name,logo_path").in("user_id", ids);
      var profs = (pr && pr.data) || [];
      $("a-count").textContent = ids.length;
      $("agents").innerHTML = profs.map(agentChip).join("");
    }

    // every approved listing across the office
    var lr = await supa.from("listings")
      .select("id,deal,price,rooms,size,type,title,buildings(name,city),listing_photos(path,sort)")
      .eq("office_id", id).eq("status", "approved").order("created_at", { ascending: false });
    var rows = (lr && lr.data) || [];
    $("l-count").textContent = rows.length;
    if (!rows.length) { $("l-empty").hidden = false; return; }
    $("listings").innerHTML = rows.map(listingCard).join("");
  }

  load().catch(function (e) { console.warn("[office] load failed:", e && e.message); done("notfound"); });
})();
