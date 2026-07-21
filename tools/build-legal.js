/* BlockView — generate STATIC legal pages from lang/<code>.js.
 *
 * Why: the terms and the privacy policy used to exist only after legal.js ran.
 * This project has twice been bitten by JS silently dying (a CDN stall, and `?.`
 * blanking a script on an older WebView — see CLAUDE.md §10). A legal document
 * that disappears when a script fails is worthless as proof that the user was
 * shown it, invisible to search engines, and harder for screen readers.
 *
 * So the text now ships inside the HTML. lang/<code>.js stays the single source
 * of truth; this script renders it to disk.
 *
 *   node tools/build-legal.js
 *
 * Output (www/legal/):
 *   terms.html      privacy.html       <- Hebrew, the binding version
 *   terms.en.html   privacy.en.html    <- one pair per other language
 *   ...
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const LEGAL = path.join(__dirname, "..", "www", "legal");
const LANGS = [
  { code: "he", name: "עברית", flag: "🇮🇱" },
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "ar", name: "العربية", flag: "🇸🇦" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "ru", name: "Русский", flag: "🇷🇺" },
];
const RTL = ["he", "ar"];
const DOCS = ["terms", "privacy"];
const CACHE_V = 2;

/* ---------- load a language pack by running it in a sandbox ---------- */
function loadPack(code) {
  const src = fs.readFileSync(path.join(LEGAL, "lang", code + ".js"), "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const pack = sandbox.window.BVLEGAL && sandbox.window.BVLEGAL[code];
  if (!pack) throw new Error("no BVLEGAL." + code + " in lang/" + code + ".js");
  pack.code = code;
  return pack;
}

/* ---------- text -> HTML ---------- */
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// same behaviour as legal.js linkify(): bare emails and URLs become real links
function linkify(text) {
  const re = /([\w.+-]+@[\w-]+\.[\w.]+)|(https?:\/\/[^\s)]+)/g;
  let out = "", last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    out += m[1]
      ? '<a href="mailto:' + esc(m[1]) + '">' + esc(m[1]) + "</a>"
      : '<a href="' + esc(m[2]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[2]) + "</a>";
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

const fileFor = (doc, code) => (code === "he" ? doc + ".html" : doc + "." + code + ".html");

/* ---------- render one document ---------- */
function render(pack, doc, packs) {
  const d = pack[doc];
  const ui = pack.ui;
  const code = pack.code;
  const dir = RTL.indexOf(code) >= 0 ? "rtl" : "ltr";
  const other = doc === "terms" ? "privacy" : "terms";

  const alts = LANGS.map(
    (l) => '  <link rel="alternate" hreflang="' + l.code + '" href="' + fileFor(doc, l.code) + '" />'
  ).join("\n");

  // language switcher: real links, so it works with JS disabled
  const langLinks = LANGS.map((l) =>
    l.code === code
      ? '<span class="lang-on">' + l.flag + " " + esc(l.name) + "</span>"
      : '<a href="' + fileFor(doc, l.code) + '" hreflang="' + l.code + '">' + l.flag + " " + esc(l.name) + "</a>"
  ).join("\n        ");

  const docNav = DOCS.map((k) =>
    '<a href="' + fileFor(k, code) + '"' + (k === doc ? ' class="on"' : "") + ">" + esc(packs[k]) + "</a>"
  ).join("\n      ");

  const toc = d.sections
    .map((s, i) => '        <li><a href="#s' + (i + 1) + '">' + esc(s.h) + "</a></li>")
    .join("\n");

  const body = d.sections
    .map((s, i) => {
      let h = '      <h2 id="s' + (i + 1) + '">' + (i + 1) + ". " + esc(s.h) + "</h2>";
      const ps = (s.p || []).map((t) => "      <p>" + linkify(t) + "</p>").join("\n");
      const ul =
        s.ul && s.ul.length
          ? "      <ul>\n" + s.ul.map((t) => "        <li>" + linkify(t) + "</li>").join("\n") + "\n      </ul>"
          : "";
      return [h, ps, ul].filter(Boolean).join("\n");
    })
    .join("\n\n");

  return `<!DOCTYPE html>
<html lang="${code}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(d.title)} · BlockView</title>
  <meta name="description" content="${esc(d.title)} — BlockView" />
  <link rel="stylesheet" href="legal.css?v=${CACHE_V}" />
${alts}
</head>
<body data-doc="${doc}" data-lang="${code}">

  <header class="topbar">
    <a class="brand" href="https://blockview.co.il"><img src="../logo.png" alt="BlockView" /></a>
    <div class="top-right">
      <nav class="lang-links" aria-label="Language">
        ${langLinks}
      </nav>
      <a class="back-link" href="https://blockview.co.il">${esc(ui.back)}</a>
    </div>
  </header>

  <main>
    <nav class="doc-nav">
      ${docNav}
    </nav>

    <article class="doc">
      <h1>${esc(d.title)}</h1>
      <p class="updated">${esc(ui.updated)}: ${esc(pack.updated)}</p>
      <p class="intro">${linkify(d.intro)}</p>

      <nav class="toc">
        <h2>${esc(ui.toc)}</h2>
        <ol>
${toc}
        </ol>
      </nav>

${body}
    </article>

    <div class="foot">
      BlockView · <a href="${fileFor(other, code)}">${esc(ui.otherDoc)}</a>
    </div>
  </main>

  <script src="legal.js?v=${CACHE_V}"></script>
</body>
</html>
`;
}

/* ---------- build ---------- */
const packs = LANGS.map((l) => loadPack(l.code));
let n = 0;
packs.forEach((pack) => {
  const titles = { terms: pack.terms.title, privacy: pack.privacy.title };
  DOCS.forEach((doc) => {
    const file = path.join(LEGAL, fileFor(doc, pack.code));
    fs.writeFileSync(file, render(pack, doc, titles), "utf8");
    n++;
    console.log("  " + path.basename(file));
  });
});
console.log("built " + n + " static legal pages from lang/*.js");
