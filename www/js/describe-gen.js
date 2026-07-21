/* BlockView — write a listing description from the fields already filled in.
 *
 * No API, no key, no cost: this composes sentences from the values the agent or
 * owner typed. That also means it can only ever state facts that are on the
 * form — it never invents a "sunny balcony" or a "quiet street" that nobody
 * entered. Everything it writes is checkable against the listing itself.
 *
 * Nearby places (supabase/12_nearby_places.sql) are used when they exist,
 * because those are real measured distances, not guesses.
 *
 * Conservative JS on purpose (see CLAUDE.md): no optional chaining, no
 * template-literal-only syntax that older WebViews choke on.
 */
(function () {
  var HE = "he", EN = "en";

  function pick(list, i) { return list[i % list.length]; }
  function clean(s) { return String(s == null ? "" : s).trim(); }
  function nOf(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

  /* ---------------------------------------------------------- Hebrew ---- */
  function hebrew(f, variant) {
    var parts = [];
    var kind = f.type === "house" ? "בית" : "דירה";
    var rooms = nOf(f.rooms), size = nOf(f.size), floor = Number(f.floor) || 0;

    // opening — what it is, how big, where
    var where = clean(f.address) || clean(f.building);
    var open = [];
    // "דירת 3 חדרים" / "בית 3 חדרים" — smichut, not "דירה של 3 חדרים"
    if (rooms) open.push((f.type === "house" ? "בית " : "דירת ") + rooms + " חדרים");
    else open.push(kind);
    if (size) open.push("בשטח " + size + ' מ"ר');
    if (floor > 0) open.push("בקומה " + floor);
    else if (floor === 0 && f.type !== "house") open.push("בקומת קרקע");
    if (where) open.push("ב" + where);
    parts.push(pick([
      open.join(" ") + ".",
      "להשכרה" === f.deal ? open.join(" ") + ", פנוי/ה לכניסה בתיאום." : open.join(" ") + ".",
      open.join(" ") + ".",
    ], variant));

    // what it has — only the boxes that were ticked
    var has = [];
    if (f.elevator) has.push("מעלית");
    if (f.parking) has.push("חניה");
    if (f.furnished) has.push("ריהוט מלא");
    if (has.length) {
      parts.push(pick([
        "הנכס כולל " + list(has) + ".",
        "בנכס " + list(has) + ".",
        "כולל " + list(has) + ".",
      ], variant));
    }
    if (f.pets) parts.push(pick(["מותר להכניס חיות מחמד.", "ידידותי לחיות מחמד.", "בעלי חיים מתקבלים בברכה."], variant));

    // the building
    if (f.age === "new") {
      parts.push(pick(["הבניין חדש.", "מדובר בבניין חדש.", "הבניין נבנה בשנים האחרונות."], variant));
    } else if (f.age === "old") {
      // no "in a sought-after area" or similar: nobody entered that, so it
      // would be an invented claim
      parts.push(pick(["הבניין ותיק.", "מדובר בבניין ותיק.", "הבניין אינו חדש."], variant));
    }

    // surroundings — real measured distances only
    var near = nearbyLine(f, HE);
    if (near) parts.push(near);

    // closing
    if (f.deal === "rent") {
      parts.push(pick([
        "לתיאום ביקור ולפרטים נוספים — צרו קשר.",
        "ניתן לתאם ביקור בימים ובשעות נוחים.",
        "מוזמנים ליצור קשר לתיאום ביקור.",
      ], variant));
    } else {
      parts.push(pick([
        "לפרטים נוספים ולתיאום ביקור — צרו קשר.",
        "מתאים למגורים או להשקעה. מוזמנים ליצור קשר.",
        "נשמח להראות את הנכס בתיאום מראש.",
      ], variant));
    }
    return parts.join(" ");
  }

  function list(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(", ") + " ו" + items[items.length - 1];
  }

  /* --------------------------------------------------------- English ---- */
  function english(f, variant) {
    var parts = [];
    var kind = f.type === "house" ? "house" : "apartment";
    var rooms = nOf(f.rooms), size = nOf(f.size), floor = Number(f.floor) || 0;
    var where = clean(f.address) || clean(f.building);

    var open = [];
    open.push(rooms ? "A " + rooms + "-room " + kind : "An " + kind);
    if (size) open.push("of " + size + " m²");
    if (floor > 0) open.push("on floor " + floor);
    if (where) open.push("at " + where);
    parts.push(open.join(" ") + ".");

    var has = [];
    if (f.elevator) has.push("an elevator");
    if (f.parking) has.push("parking");
    if (f.furnished) has.push("full furnishing");
    if (has.length) parts.push(pick(["The property includes ", "It comes with ", "Includes "], variant) + listEn(has) + ".");
    if (f.pets) parts.push("Pets are welcome.");
    if (f.age === "new") parts.push("The building is new.");
    else if (f.age === "old") parts.push("The building is older and well established.");

    var near = nearbyLine(f, EN);
    if (near) parts.push(near);

    parts.push(f.deal === "rent"
      ? "Get in touch to arrange a viewing."
      : "Suitable to live in or as an investment. Get in touch for details.");
    return parts.join(" ");
  }

  function listEn(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  /* ---- surroundings, from the precomputed nearby data (never invented) ---- */
  var NEAR_HE = { education: "גן ילדים או בית ספר", transit: "תחבורה ציבורית", errands: "סופרמרקט", leisure: "פארק" };
  var NEAR_EN = { education: "a school or kindergarten", transit: "public transport", errands: "a supermarket", leisure: "a park" };

  function nearbyLine(f, lang) {
    var near = f.nearby || {};
    var bits = [];
    var order = ["transit", "errands", "education", "leisure"];
    for (var i = 0; i < order.length; i++) {
      var key = order[i], item = near[key];
      if (!item || !item.minutes) continue;
      bits.push(lang === HE
        ? NEAR_HE[key] + " במרחק " + item.minutes + " דק׳ הליכה"
        : NEAR_EN[key] + " " + item.minutes + " min away on foot");
      if (bits.length === 3) break;
    }
    if (!bits.length) return "";
    return lang === HE
      ? "בסביבה הקרובה: " + bits.join(", ") + "."
      : "Nearby: " + bits.join(", ") + ".";
  }

  /* ------------------------------------------------------------ public ---- */
  window.BVDescribe = {
    /* fields: {deal, type, rooms, size, floor, age, elevator, parking,
     *          furnished, pets, address, building, nearby}
     * nearby: {transit:{minutes}, errands:{minutes}, ...} — optional
     * Returns 3 wordings of the same facts. */
    variants: function (fields, lang) {
      var f = fields || {};
      var write = lang === EN ? english : hebrew;
      var out = [];
      for (var i = 0; i < 3; i++) out.push(write(f, i));
      return out;
    },
    one: function (fields, lang) {
      return this.variants(fields, lang)[Math.floor(Math.random() * 3)];
    },
  };
})();
