/* BlockView — legal pages renderer (terms / privacy).
 * Content lives in lang/<code>.js, one file per language, loaded on demand.
 * The page follows the app's saved language (localStorage "blockview_lang"),
 * so switching the language here also switches it in the app, and vice versa.
 * Everything is rendered as text nodes (never innerHTML), so the documents
 * cannot introduce markup injection even if a translation file is edited.
 */
(function () {
  var LANGS = [
    { code: "he", name: "עברית", flag: "🇮🇱" },
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "es", name: "Español", flag: "🇪🇸" },
    { code: "ar", name: "العربية", flag: "🇸🇦" },
    { code: "fr", name: "Français", flag: "🇫🇷" },
    { code: "ru", name: "Русский", flag: "🇷🇺" },
  ];
  var RTL = ["he", "ar"];
  var CODES = LANGS.map(function (l) { return l.code; });
  var doc = document.body.getAttribute("data-doc") || "terms";   // "terms" | "privacy"
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- pick the language: ?lang= > saved > browser > he ---------- */
  function pickLang() {
    var q = "";
    try { q = new URLSearchParams(location.search).get("lang") || ""; } catch (e) {}
    if (CODES.indexOf(q) >= 0) return q;
    var saved = "";
    try { saved = localStorage.getItem("blockview_lang") || ""; } catch (e) {}
    if (CODES.indexOf(saved) >= 0) return saved;
    var nav = (navigator.language || "he").slice(0, 2).toLowerCase();
    return CODES.indexOf(nav) >= 0 ? nav : "he";
  }

  /* ---------- tiny DOM helpers (text only, no innerHTML) ---------- */
  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text != null) n.appendChild(document.createTextNode(text));
    if (cls) n.className = cls;
    return n;
  }
  // turn bare emails / urls into real links, safely (text nodes + <a>, no innerHTML)
  function linkify(node, text) {
    var rest = String(text);
    var re = /([\w.+-]+@[\w-]+\.[\w.]+)|(https?:\/\/[^\s)]+)/;
    var m;
    while ((m = re.exec(rest))) {
      if (m.index > 0) node.appendChild(document.createTextNode(rest.slice(0, m.index)));
      var a = document.createElement("a");
      a.textContent = m[0];
      a.href = m[1] ? "mailto:" + m[1] : m[0];
      if (m[2]) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
      node.appendChild(a);
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) node.appendChild(document.createTextNode(rest));
    return node;
  }
  function para(text, cls) {
    var p = document.createElement("p");
    if (cls) p.className = cls;
    return linkify(p, text);
  }

  /* ---------- render ---------- */
  function render(pack) {
    var d = pack[doc], ui = pack.ui;
    var dir = RTL.indexOf(pack.code) >= 0 ? "rtl" : "ltr";
    document.documentElement.lang = pack.code;
    document.documentElement.dir = dir;
    document.title = d.title + " · BlockView";

    // top bar
    $("back-link").textContent = ui.back;
    var other = doc === "terms" ? "privacy" : "terms";
    var navBox = $("doc-nav");
    navBox.textContent = "";
    [["terms", pack.terms.title], ["privacy", pack.privacy.title]].forEach(function (pair) {
      var a = el("a", pair[1], pair[0] === doc ? "on" : "");
      a.href = pair[0] + ".html?lang=" + pack.code;
      navBox.appendChild(a);
    });

    var box = $("doc-body");
    box.textContent = "";
    box.appendChild(el("h1", d.title));
    box.appendChild(el("p", ui.updated + ": " + pack.updated, "updated"));
    box.appendChild(para(d.intro, "intro"));

    // table of contents
    var toc = el("nav", null, "toc");
    toc.appendChild(el("h2", ui.toc));
    var ol = document.createElement("ol");
    d.sections.forEach(function (s, i) {
      var li = document.createElement("li");
      var a = el("a", s.h);
      a.href = "#s" + (i + 1);
      li.appendChild(a);
      ol.appendChild(li);
    });
    toc.appendChild(ol);
    box.appendChild(toc);

    // sections
    d.sections.forEach(function (s, i) {
      var h = el("h2", (i + 1) + ". " + s.h);
      h.id = "s" + (i + 1);
      box.appendChild(h);
      (s.p || []).forEach(function (t) { box.appendChild(para(t)); });
      if (s.ul && s.ul.length) {
        var ul = document.createElement("ul");
        s.ul.forEach(function (t) { ul.appendChild(linkify(document.createElement("li"), t)); });
        box.appendChild(ul);
      }
    });

    // footer note
    var foot = $("foot");
    foot.textContent = "";
    foot.appendChild(document.createTextNode("BlockView · "));
    var link = el("a", ui.otherDoc);
    link.href = other + ".html?lang=" + pack.code;
    foot.appendChild(link);

    // language picker
    var sel = $("lang-select");
    sel.textContent = "";
    LANGS.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.code;
      o.textContent = l.flag + "  " + l.name;
      if (l.code === pack.code) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      try { localStorage.setItem("blockview_lang", sel.value); } catch (e) {}
      location.search = "?lang=" + sel.value;
    };
  }

  /* ---------- load the language pack (falls back to English, then Hebrew) ---------- */
  function load(code, tried) {
    tried = tried || [];
    if (window.BVLEGAL && window.BVLEGAL[code]) {
      var pack = window.BVLEGAL[code];
      pack.code = code;
      return render(pack);
    }
    tried.push(code);
    var s = document.createElement("script");
    s.src = "lang/" + code + ".js?v=1";
    s.onload = function () {
      if (window.BVLEGAL && window.BVLEGAL[code]) { var p = window.BVLEGAL[code]; p.code = code; render(p); }
      else next(tried);
    };
    s.onerror = function () { next(tried); };
    document.head.appendChild(s);
  }
  function next(tried) {
    if (tried.indexOf("en") < 0) return load("en", tried);
    if (tried.indexOf("he") < 0) return load("he", tried);
    $("doc-body").textContent = "Content unavailable. Please try again later.";
  }

  load(pickLang());
})();
