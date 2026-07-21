/* BlockView — legal pages: progressive enhancement only.
 *
 * The documents are now STATIC HTML, generated from lang/<code>.js by
 * tools/build-legal.js. This script must never rewrite the text — if it fails
 * to load, the terms are still fully readable. That is the whole point:
 * a legal document may not depend on JavaScript running successfully.
 *
 * All this does is follow the language the user picked in the app:
 *   ?lang=xx  >  the language saved by the app  >  the page as generated
 */
(function () {
  var CODES = ["he", "en", "es", "ar", "fr", "ru"];
  var KEY = "blockview_lang";
  var body = document.body;
  var doc = body.getAttribute("data-doc") || "terms";       // "terms" | "privacy"
  var here = body.getAttribute("data-lang") || "he";        // language of THIS file

  function fileFor(code) { return code === "he" ? doc + ".html" : doc + "." + code + ".html"; }

  function saved() {
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }

  /* ---------- remember the language when one of the links is clicked ---------- */
  var links = document.querySelectorAll(".lang-links a[hreflang]");
  Array.prototype.forEach.call(links, function (a) {
    a.addEventListener("click", function () {
      try { localStorage.setItem(KEY, a.getAttribute("hreflang")); } catch (e) {}
    });
  });

  /* ---------- send the reader to their language, once ---------- */
  var want = "";
  try { want = new URLSearchParams(location.search).get("lang") || ""; } catch (e) {}
  if (CODES.indexOf(want) >= 0) {
    // an explicit ?lang= also updates the saved choice (old links still work)
    try { localStorage.setItem(KEY, want); } catch (e) {}
  } else {
    want = saved();
  }

  // Only ever redirect to a DIFFERENT file: the target's data-lang matches the
  // wanted language, so it will not redirect again.
  if (CODES.indexOf(want) >= 0 && want !== here) location.replace(fileFor(want));
})();
