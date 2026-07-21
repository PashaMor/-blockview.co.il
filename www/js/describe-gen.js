/* BlockView — write a listing description from the fields already filled in.
 *
 * No API, no key, no cost: this composes sentences from the values the agent or
 * owner typed. That also means it can only ever state facts that are on the
 * form — it never invents a "sunny balcony" or a "quiet street" that nobody
 * entered. Everything it writes is checkable against the listing itself.
 *
 * Written for search as well as for people: the opening line carries the words
 * someone actually types into Google ("דירה 3 חדרים למכירה בתל אביב"), the
 * street and city appear early, and the facts are repeated once in natural
 * prose rather than stuffed. Length lands around 60–110 words, which is what a
 * property page wants — long enough to rank, short enough to read.
 *
 * Nearby places (supabase/12_nearby_places.sql) are used when they exist,
 * because those are real measured distances, not guesses.
 *
 * Conservative JS on purpose (see CLAUDE.md): no optional chaining.
 */
(function () {
  var HE = "he", EN = "en";

  var KIND_HE = {
    flat: "דירה", house: "בית", penthouse: "פנטהאוז", studio: "סטודיו",
    office: "משרד", shop: "חנות", warehouse: "מחסן", other: "נכס מסחרי",
  };
  var KIND_EN = {
    flat: "apartment", house: "house", penthouse: "penthouse", studio: "studio",
    office: "office", shop: "retail space", warehouse: "warehouse", other: "commercial property",
  };

  function pick(list, i) { return list[i % list.length]; }
  function clean(s) { return String(s == null ? "" : s).trim(); }
  function nOf(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function isCommercial(f) { return f.category === "commercial"; }

  // "שדרות רוטשילד 22, תל אביב" -> "שדרות רוטשילד 22"; keeps the street for the
  // headline so the city can be stated separately without repeating it
  function streetOf(f) {
    var addr = clean(f.address);
    if (!addr) return clean(f.building);
    var city = clean(f.city);
    if (!city) return addr;
    // The address usually ends in the city, but not always spelled the same way
    // ("תל אביב" vs "תל אביב-יפו"), so a plain contains() check misses and the
    // city ends up printed twice. Everything before the first comma is the
    // street, which is what the headline wants.
    if (addr.indexOf(",") > -1) addr = addr.split(",")[0];
    addr = addr.trim();
    // still the city and nothing else? then there is no street to show
    var a = addr.replace(/[-–]/g, " "), c = city.replace(/[-–]/g, " ");
    if (a === c || c.indexOf(a) > -1) return "";
    return addr;
  }

  /* ---------------------------------------------------------- Hebrew ---- */
  function hebrew(f, variant) {
    var rooms = nOf(f.rooms), size = nOf(f.size);
    var floor = Number(f.floor), floors = nOf(f.floorsTotal);
    var kind = KIND_HE[f.type] || KIND_HE.flat;
    var deal = f.deal === "rent" ? "להשכרה" : "למכירה";
    var street = streetOf(f), city = clean(f.city);
    var out = [];

    /* --- headline: the words people actually search --- */
    var head = kind;
    if (rooms && !isCommercial(f)) head += " " + rooms + " חדרים";
    head += " " + deal;
    if (street) head += " ב" + street;
    if (city) head += (street ? ", " : " ב") + city;
    out.push(head + ".");

    /* --- the measurable facts, in prose --- */
    var facts = [];
    if (size) facts.push('שטח ' + size + ' מ"ר');
    if (isFinite(floor) && floor > 0) facts.push(floors ? "קומה " + floor + " מתוך " + floors : "קומה " + floor);
    else if (floor === 0 && !isCommercial(f)) facts.push("קומת קרקע");
    if (facts.length) {
      out.push(pick([
        "ה" + kind + ": " + facts.join(", ") + ".",
        facts.join(", ") + ".",
        "מדובר ב" + kind + " בעל" + (kind === "דירה" || kind === "חנות" ? "ת " : " ") + facts.join(", ") + ".",
      ], variant));
    }

    /* --- what it comes with (ticked boxes only) --- */
    var has = [];
    if (f.elevator) has.push("מעלית");
    if (f.parking) has.push("חניה");
    if (f.furnished) has.push(isCommercial(f) ? "ריהוט" : "ריהוט מלא");
    if (has.length) {
      out.push(pick([
        "ה" + kind + " כולל" + fem(kind) + " " + listHe(has) + ".",
        "בנכס " + listHe(has) + ".",
        "כולל " + listHe(has) + ".",
      ], variant));
    }
    if (f.pets && !isCommercial(f)) {
      out.push(pick(["מותר להכניס חיות מחמד.", "ידידותי לחיות מחמד.", "בעלי חיים מתקבלים בברכה."], variant));
    }

    /* --- the building --- */
    if (f.age === "new") out.push(pick(["הבניין חדש.", "מדובר בבניין חדש.", "הבניין נבנה בשנים האחרונות."], variant));
    else if (f.age === "old") out.push(pick(["הבניין ותיק.", "מדובר בבניין ותיק.", "הבניין אינו חדש."], variant));

    /* --- surroundings: measured walking times, never adjectives --- */
    var near = nearbyLine(f, HE);
    if (near) out.push(near);

    /* --- close with the search phrase again, naturally --- */
    if (isCommercial(f)) {
      out.push(pick([
        "מתאים לעסקים המחפשים " + kind + " " + deal + (city ? " ב" + city : "") + ". לפרטים ולתיאום סיור — צרו קשר.",
        "לפרטים נוספים ולתיאום סיור בנכס — צרו קשר.",
        "נשמח להציג את הנכס בתיאום מראש.",
      ], variant));
    } else if (f.deal === "rent") {
      out.push(pick([
        "לתיאום ביקור ולפרטים נוספים — צרו קשר.",
        "פנוי/ה לכניסה בתיאום. מוזמנים ליצור קשר.",
        "מוזמנים ליצור קשר לתיאום ביקור.",
      ], variant));
    } else {
      out.push(pick([
        "מתאים למגורים או להשקעה. לפרטים ולתיאום ביקור — צרו קשר.",
        "לפרטים נוספים ולתיאום ביקור — צרו קשר.",
        "נשמח להראות את הנכס בתיאום מראש.",
      ], variant));
    }
    return out.join(" ");
  }

  // "דירה כוללת" vs "בית כולל"
  function fem(kind) { return (kind === "דירה" || kind === "חנות") ? "ת" : ""; }

  function listHe(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(", ") + " ו" + items[items.length - 1];
  }

  /* --------------------------------------------------------- English ---- */
  function english(f, variant) {
    var rooms = nOf(f.rooms), size = nOf(f.size);
    var floor = Number(f.floor), floors = nOf(f.floorsTotal);
    var kind = KIND_EN[f.type] || KIND_EN.flat;
    var deal = f.deal === "rent" ? "for rent" : "for sale";
    var street = streetOf(f), city = clean(f.city);
    var out = [];

    var head = (rooms && !isCommercial(f) ? rooms + "-room " : "") + kind + " " + deal;
    if (street) head += " on " + street;
    if (city) head += (street ? ", " : " in ") + city;
    out.push(cap(head) + ".");

    var facts = [];
    if (size) facts.push(size + " m²");
    if (isFinite(floor) && floor > 0) facts.push(floors ? "floor " + floor + " of " + floors : "floor " + floor);
    else if (floor === 0 && !isCommercial(f)) facts.push("ground floor");
    if (facts.length) out.push(cap(facts.join(", ")) + ".");

    var has = [];
    if (f.elevator) has.push("an elevator");
    if (f.parking) has.push("parking");
    if (f.furnished) has.push("furnishing");
    if (has.length) out.push(pick(["The property includes ", "It comes with ", "Includes "], variant) + listEn(has) + ".");
    if (f.pets && !isCommercial(f)) out.push("Pets are welcome.");
    if (f.age === "new") out.push("The building is new.");
    else if (f.age === "old") out.push("The building is older.");

    var near = nearbyLine(f, EN);
    if (near) out.push(near);

    out.push(f.deal === "rent"
      ? "Get in touch to arrange a viewing."
      : "Suitable to live in or as an investment. Get in touch for details.");
    return out.join(" ");
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function listEn(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  /* ---- surroundings, from the precomputed nearby data (never invented) ---- */
  var NEAR_HE = { transit: "תחבורה ציבורית", errands: "סופרמרקט", education: "גן ילדים או בית ספר", leisure: "פארק" };
  var NEAR_EN = { transit: "public transport", errands: "a supermarket", education: "a school or kindergarten", leisure: "a park" };

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
    return lang === HE ? "בסביבה הקרובה: " + bits.join(", ") + "." : "Nearby: " + bits.join(", ") + ".";
  }

  /* ------------------------------------------------------------ public ---- */
  window.BVDescribe = {
    /* fields: {deal, category, type, rooms, size, floor, floorsTotal, age,
     *          elevator, parking, furnished, pets, address, building, city, nearby}
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
