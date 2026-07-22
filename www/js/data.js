/* BlockView — sample data (prototype)
 * In production, buildings come from OSM / govmap footprints and listings are
 * posted by owners & agents. Here we hand-author a small central Tel Aviv set
 * to prove the "tap a building -> see its units" experience.
 *
 * Each building: id, name (he), address (he), lng/lat (footprint center),
 * w/h (footprint size, degrees), height (meters for 3D extrusion).
 */
var BUILDINGS = [
  { id: "b1", name: "רוטשילד 22",     address: "שדרות רוטשילד 22, תל אביב", lng: 34.77145, lat: 32.06405, w: 0.00028, h: 0.00034, height: 32 },
  { id: "b2", name: "רוטשילד 45",     address: "שדרות רוטשילד 45, תל אביב", lng: 34.77320, lat: 32.06520, w: 0.00030, h: 0.00030, height: 54 },
  { id: "b3", name: "אלנבי 40",       address: "אלנבי 40, תל אביב",         lng: 34.76980, lat: 32.06480, w: 0.00026, h: 0.00040, height: 24 },
  { id: "b4", name: "שינקין 12",      address: "שינקין 12, תל אביב",        lng: 34.77420, lat: 32.06660, w: 0.00024, h: 0.00028, height: 19 },
  { id: "b5", name: "נחלת בנימין 18", address: "נחלת בנימין 18, תל אביב",   lng: 34.77060, lat: 32.06310, w: 0.00026, h: 0.00032, height: 27 },
  { id: "b6", name: "הרצל 8",         address: "הרצל 8, תל אביב",           lng: 34.76900, lat: 32.06090, w: 0.00030, h: 0.00034, height: 38 },
  { id: "b7", name: "פלורנטין 5",     address: "פלורנטין 5, תל אביב",        lng: 34.76960, lat: 32.05760, w: 0.00028, h: 0.00030, height: 16 },
  { id: "b8", name: "מזא\"ה 33",      address: "מזא\"ה 33, תל אביב",         lng: 34.77540, lat: 32.06430, w: 0.00024, h: 0.00030, height: 22 },
];

/* Transit lines. Colors are the real line colors.
 *  - Red line: REAL geometry from OSM (Overpass relation 2224880), operational.
 *  - Blue: Israel Railways along the real Ayalon corridor (approx trace).
 * Purple & Green light rail are still under construction and not yet mapped as
 * usable route relations in OSM, so they're omitted rather than faked.
 */
const TRANSIT_LINES = {
  type: "FeatureCollection",
  // Heavy rail is loaded as real OSM geometry from www/data/israel-rail.geojson.
  // No hand-drawn transit lines here; this stays as the hook for future light-rail
  // lines when their geometry is properly mapped.
  features: [],
};

/* Listings keyed by building id. deal: "sale" | "rent".
 * price: ₪ (rent = per month). rooms, size (m²), floor. tour: has 3D interior tour.
 */
var LISTINGS = {
  b1: [
    { id: "b1-1", deal: "sale", price: 3250000, title: "דירת 3 חדרים משופצת", rooms: 3, size: 78,  floor: 2, tour: true },
    { id: "b1-2", deal: "rent", price: 7800,    title: "דירת 2 חדרים עם מרפסת", rooms: 2, size: 55,  floor: 4, tour: false },
    { id: "b1-3", deal: "sale", price: 5900000, title: "פנטהאוז 4 חדרים",       rooms: 4, size: 132, floor: 8, tour: true },
  ],
  b2: [
    { id: "b2-1", deal: "rent", price: 9500,    title: "דירת 3 חדרים מפוארת",  rooms: 3, size: 90,  floor: 11, tour: true },
    { id: "b2-2", deal: "rent", price: 6200,    title: "סטודיו מעוצב",          rooms: 1, size: 38,  floor: 6,  tour: false },
  ],
  b3: [
    { id: "b3-1", deal: "sale", price: 2450000, title: "דירת 2 חדרים לשיפוץ",   rooms: 2, size: 52,  floor: 1, tour: false },
    { id: "b3-2", deal: "sale", price: 3100000, title: "דירת 3 חדרים מוארת",    rooms: 3, size: 74,  floor: 3, tour: true },
    { id: "b3-3", deal: "rent", price: 5400,    title: "דירת חדר וחצי",         rooms: 1, size: 42,  floor: 2, tour: false },
    { id: "b3-4", deal: "rent", price: 8100,    title: "דירת 3 חדרים משופצת",   rooms: 3, size: 80,  floor: 4, tour: true },
  ],
  b4: [
    { id: "b4-1", deal: "rent", price: 6800,    title: "דירת 2 חדרים ברחוב שינקין", rooms: 2, size: 48, floor: 2, tour: false },
  ],
  b5: [
    { id: "b5-1", deal: "sale", price: 4200000, title: "דירת 4 חדרים עם חניה",  rooms: 4, size: 110, floor: 5, tour: true },
    { id: "b5-2", deal: "sale", price: 2790000, title: "דירת 2 חדרים",          rooms: 2, size: 58,  floor: 2, tour: false },
  ],
  b6: [
    { id: "b6-1", deal: "sale", price: 6500000, title: "פנטהאוז 5 חדרים + גג",  rooms: 5, size: 165, floor: 12, tour: true },
    { id: "b6-2", deal: "rent", price: 12000,   title: "דירת 4 חדרים מפוארת",   rooms: 4, size: 120, floor: 9,  tour: true },
    { id: "b6-3", deal: "rent", price: 7200,    title: "דירת 2.5 חדרים",        rooms: 2, size: 62,  floor: 3,  tour: false },
  ],
  b7: [
    { id: "b7-1", deal: "rent", price: 5900,    title: "דירת 2 חדרים בפלורנטין", rooms: 2, size: 46, floor: 1, tour: false },
    { id: "b7-2", deal: "rent", price: 4500,    title: "סטודיו צעיר",            rooms: 1, size: 32, floor: 2, tour: false },
    { id: "b7-3", deal: "sale", price: 2150000, title: "דירת 2 חדרים להשקעה",    rooms: 2, size: 44, floor: 3, tour: true },
  ],
  b8: [
    { id: "b8-1", deal: "sale", price: 3690000, title: "דירת 3 חדרים בבניין בוטיק", rooms: 3, size: 82, floor: 4, tour: true },
    { id: "b8-2", deal: "rent", price: 8800,    title: "דירת 3 חדרים חדשה",         rooms: 3, size: 78, floor: 5, tour: false },
  ],
};
