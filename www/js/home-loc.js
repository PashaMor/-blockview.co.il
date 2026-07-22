/* BlockView — set a "home location" in the profile; the ⟲ reset button flies
 * there. Reuses BVGeo (OSM/Nominatim) for the address search and BVAuth for the
 * stored value (profiles.home_*). Nothing here is trusted for anything but the
 * map centre — it's the user's own preference on their own row. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var input = $("acc-home-input");
  if (!input) return;
  var results = $("acc-home-results");
  var label = $("acc-home-label");
  var clearBtn = $("acc-home-clear");
  var T = function (k, fb) { return (window.t ? window.t(k) : fb) || fb; };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; });
  };
  var timer = null;

  // reflect the current stored home in the profile row
  function paint(h) {
    if (h && h.label) { label.textContent = "📍 " + h.label; clearBtn.hidden = false; }
    else if (h) { label.textContent = "📍 " + h.lat.toFixed(4) + ", " + h.lng.toFixed(4); clearBtn.hidden = false; }
    else { label.textContent = T("home_loc_none", "לא הוגדר — כפתור האיפוס חוזר למרכז תל אביב"); clearBtn.hidden = true; }
  }
  // auth.js calls this on load and after every change
  var prevHook = window.onHomeLocation;
  window.onHomeLocation = function (h) {
    if (typeof prevHook === "function") prevHook(h);   // keep app.js's hook working
    paint(h);
  };

  function hideResults() { results.hidden = true; results.innerHTML = ""; }

  input.addEventListener("input", function (e) {
    var q = e.target.value;
    clearTimeout(timer);
    if (q.trim().length < 3) { hideResults(); return; }
    timer = setTimeout(async function () {
      if (!window.BVGeo) return;
      var items = await BVGeo.searchAddress(q);
      results._items = items;
      results.innerHTML = items.length
        ? items.map(function (it, i) {
            return '<button type="button" class="ar-item" data-i="' + i + '"><b>' +
              esc(it.short) + "</b><small>" + esc(it.label) + "</small></button>";
          }).join("")
        : '<div class="ar-empty">' + T("address_none", "לא נמצאה כתובת. נסה ניסוח אחר.") + "</div>";
      results.hidden = false;
    }, 600);
  });

  results.addEventListener("click", async function (e) {
    var b = e.target.closest ? e.target.closest(".ar-item") : null;
    if (!b) return;
    var it = results._items[+b.getAttribute("data-i")];
    hideResults();
    input.value = "";
    if (!window.BVAuth) return;
    var err = await BVAuth.saveHome(it.lat, it.lng, it.short + (it.city ? ", " + it.city : ""));
    if (window.bvToast) window.bvToast(err ? T("home_loc_failed", "שמירת המיקום נכשלה") : T("home_loc_saved", "מיקום הבית נשמר ✓ כפתור האיפוס יביא לכאן"));
  });

  clearBtn.addEventListener("click", async function () {
    if (window.BVAuth) await BVAuth.clearHome();
    if (window.bvToast) window.bvToast(T("home_loc_cleared", "מיקום הבית נמחק"));
  });
})();
