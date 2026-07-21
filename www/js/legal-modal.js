/* BlockView — read the legal documents without leaving the app.
 *
 * In the native app a link to legal/terms.html replaces the whole WebView: the
 * map is gone, and the only way back is "חזרה לאתר", which reloads everything.
 * On a website that is fine (the links open a new tab); inside an app it is a
 * dead end.
 *
 * So in the app the same links open a sheet over the map instead. The document
 * is fetched from the very same static file the website serves — one source of
 * truth, no second copy of the terms to keep in sync — and only the <article>
 * is taken, leaving that page's own header and language bar behind.
 *
 * Conservative JS (see CLAUDE.md).
 */
(function () {
  var isNativeApp = !!window.Capacitor || /BlockViewApp/i.test(navigator.userAgent);
  if (!isNativeApp) return;                 // the website keeps opening a tab

  var $ = function (id) { return document.getElementById(id); };
  var T = function (k, fb) { return (window.t ? window.t(k) : fb) || fb; };
  var cache = {};

  // legal/terms.html -> terms ; also /terms and /privacy (the pretty routes)
  function docOf(href) {
    if (/terms/.test(href)) return "terms";
    if (/privacy/.test(href)) return "privacy";
    if (/accessibility/.test(href)) return "accessibility";
    return "";
  }

  // he keeps the plain name, the rest carry the language: terms.en.html
  function fileFor(doc) {
    var lang = window.currentLang ? window.currentLang() : "he";
    return "legal/" + doc + (lang && lang !== "he" ? "." + lang : "") + ".html";
  }

  function titleFor(doc) {
    if (doc === "terms") return T("terms_link", "תנאי השימוש");
    if (doc === "privacy") return T("privacy_link", "מדיניות הפרטיות");
    return T("a11y_link", "הצהרת נגישות");
  }

  async function fetchDoc(doc) {
    var url = fileFor(doc);
    if (cache[url]) return cache[url];
    var res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var html = await res.text();
    // parse, then adopt only the article — never inject the whole document
    var parsed = new DOMParser().parseFromString(html, "text/html");
    var article = parsed.querySelector("article.doc");
    if (!article) throw new Error("no article");
    cache[url] = article.innerHTML;
    return cache[url];
  }

  function open(doc) {
    var sheet = $("legal-sheet");
    if (!sheet) return;
    $("legal-title").textContent = titleFor(doc);
    var body = $("legal-body");
    body.innerHTML = '<p class="legal-loading">' + T("loading", "טוען…") + "</p>";
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    var back = $("sheet-backdrop");
    if (back) back.hidden = false;

    fetchDoc(doc).then(
      function (inner) { body.innerHTML = inner; body.scrollTop = 0; },
      function () {
        // fall back to the browser rather than showing an empty sheet
        body.innerHTML = "";
        var a = document.createElement("a");
        a.className = "auth-link";
        a.href = fileFor(doc);
        a.textContent = T("open_in_browser", "פתח בדפדפן");
        body.appendChild(a);
      }
    );
  }

  function close() {
    var sheet = $("legal-sheet");
    if (!sheet) return;
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    var back = $("sheet-backdrop");
    if (back) back.hidden = true;
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a[href]") : null;
    if (a) {
      var doc = docOf(a.getAttribute("href") || "");
      if (doc && /legal\/|\/terms|\/privacy|\/accessibility/.test(a.getAttribute("href"))) {
        e.preventDefault();
        open(doc);
        return;
      }
    }
    if (e.target && (e.target.id === "legal-close" || e.target.id === "sheet-backdrop")) close();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  window.BVLegalSheet = { open: open, close: close };
})();
