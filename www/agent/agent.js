/* BlockView — public agent profile page.
 * Reads ?id=<agent user id> and shows the agent's branding + their approved
 * listings. Everything here is public data (agent_profiles is world-readable
 * branding only; only approved listings are visible via RLS), so the anon
 * publishable key is all it needs. No session, no private fields.
 */
(function () {
  var cfg = window.BLOCKVIEW_CONFIG;
  var supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  var $ = function (id) { return document.getElementById(id); };

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var nis = function (n) { return "₪" + Number(n || 0).toLocaleString("he-IL"); };
  var photoUrl = function (p) { return supa.storage.from("listing-photos").getPublicUrl(p).data.publicUrl; };
  var logoUrl = function (p) { return supa.storage.from("agent-logos").getPublicUrl(p).data.publicUrl; };

  function waNumber(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.indexOf("972") === 0) return d;
    if (d.charAt(0) === "0") return "972" + d.slice(1);
    return d;
  }

  function param(name) {
    try { return new URLSearchParams(location.search).get(name) || ""; } catch (e) { return ""; }
  }

  // back arrow returns to the page you came from (the property), not the map;
  // the href stays as the fallback for a direct open / new tab (no history).
  (function () {
    var back = document.querySelector(".back");
    if (!back) return;
    back.addEventListener("click", function (e) {
      if (window.history && history.length > 1 && document.referrer) {
        e.preventDefault();
        history.back();
      }
    });
  })();

  function typeHe(t) {
    return { flat: "דירה", house: "בית", penthouse: "פנטהאוז", studio: "סטודיו",
      office: "משרד", shop: "חנות", warehouse: "מחסן", other: "אחר" }[t] || "";
  }

  function listingCard(l) {
    var b = l.buildings || {};
    var photos = (l.listing_photos || []).slice().sort(function (a, c) { return a.sort - c.sort; });
    var thumb = photos.length
      ? '<div class="c-thumb" style="background-image:url(\'' + photoUrl(photos[0].path) + '\')"></div>'
      : '<div class="c-thumb empty">🏠</div>';
    var deal = l.deal === "sale" ? "מכירה" : "השכרה";
    var per = l.deal === "rent" ? ' <span class="per">/ לחודש</span>' : "";
    var where = [b.name, b.city].filter(Boolean).join(" · ");
    return '<a class="card" href="https://blockview.co.il/?listing=' + encodeURIComponent(l.id) + '">' +
      thumb +
      '<div class="c-body">' +
        '<div class="c-deal ' + esc(l.deal) + '">' + deal + '</div>' +
        '<div class="c-price">' + nis(l.price) + per + '</div>' +
        '<div class="c-title">' + esc(l.title || "") + '</div>' +
        '<div class="c-where">' + esc(where) + '</div>' +
        '<div class="c-specs">' +
          '<span>' + esc(typeHe(l.type)) + '</span>' +
          '<span>🚪 ' + esc(l.rooms) + '</span>' +
          '<span>📐 ' + esc(l.size) + ' מ"ר</span>' +
        '</div>' +
      '</div></a>';
  }

  function done(which) {
    ["loading", "notfound"].forEach(function (n) { $(n).hidden = true; });
    if (which === "notfound") { $("notfound").hidden = false; return; }
    $("profile").hidden = false;
    $("listings-wrap").hidden = false;
  }

  async function load() {
    var id = param("id");
    if (!id) return done("notfound");

    // profile and listings in parallel; show the page if EITHER exists
    var results = await Promise.all([
      supa.from("agent_profiles")
        .select("first_name,last_name,agency,license_no,logo_path,phone,website")
        .eq("user_id", id).maybeSingle(),
      supa.from("listings")
        .select("id,deal,price,rooms,size,type,title,buildings(name,city),listing_photos(path,sort)")
        .eq("agent_id", id).eq("status", "approved").order("created_at", { ascending: false }),
    ]);
    var p = (results[0] && results[0].data) || null;
    var rows = (results[1] && results[1].data) || [];
    if (!p && !rows.length) return done("notfound");
    p = p || {};                                   // no profile yet — show listings under a plain header

    var name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.agency || "סוכן";
    document.title = name + " · BlockView";
    $("p-name").textContent = name;
    $("p-agency").textContent = p.agency || "";
    $("p-license").textContent = p.license_no ? ("רישיון תיווך " + p.license_no) : "";

    // thumbnail: the logo, or a coloured circle with the name's initial
    if (p.logo_path) {
      var img = new Image();
      img.alt = ""; img.src = logoUrl(p.logo_path);
      $("p-logo").textContent = ""; $("p-logo").appendChild(img);
    } else {
      var hue = 0, ns = name || "?"; for (var i = 0; i < ns.length; i++) hue = (hue * 31 + ns.charCodeAt(i)) % 360;
      $("p-logo").textContent = ns.charAt(0).toUpperCase();
      $("p-logo").style.background = "hsl(" + hue + ",60%,92%)";
      $("p-logo").style.color = "hsl(" + hue + ",55%,38%)";
      $("p-logo").style.fontWeight = "800";
    }

    // contact actions: phone, WhatsApp (opens a ready message), website
    var acts = [];
    var wa = waNumber(p.phone);
    if (p.phone) acts.push('<a class="act" href="tel:' + esc(p.phone) + '">📞 ' + esc(p.phone) + '</a>');
    if (wa) {
      var msg = encodeURIComponent("שלום " + (p.first_name || "") + ", ראיתי את העמוד שלך ב-BlockView ואשמח לפרטים.");
      acts.push('<a class="act wa" href="https://wa.me/' + wa + '?text=' + msg + '" target="_blank" rel="noopener">💬 שליחת הודעה בוואטסאפ</a>');
    }
    if (p.website && /^https?:\/\//i.test(p.website)) acts.push('<a class="act" href="' + esc(p.website) + '" target="_blank" rel="noopener noreferrer">🌐 אתר</a>');
    $("p-actions").innerHTML = acts.join("") || '<span class="p-nocontact">אין פרטי קשר לסוכן זה</span>';

    done();

    $("l-count").textContent = rows.length;
    if (!rows.length) { $("l-empty").hidden = false; return; }
    $("listings").innerHTML = rows.map(listingCard).join("");
  }

  load().catch(function (e) { console.warn("[agent] load failed:", e && e.message); done("notfound"); });
})();
