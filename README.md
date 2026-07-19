# BlockView

A 3D real-estate discovery map for Israel. Fly over the city, **tap a building, and see the apartments for sale or rent inside it.** The tappable 3D city is the differentiator over Yad2 / Madlan; listings are posted by owners and agents (no scraping).

This is the **Phase 1 prototype** — it proves the core experience (orbit → tap building → see units → filter) on sample data for a few blocks of central Tel Aviv. No API keys, no build step, no signup.

## Run it in the browser

Web assets live in `www/`. Serve that folder (don't double-click — it fetches map tiles over the network):
```bash
cd "f:\Projects\3D Map\www"
python -m http.server 5173
```
Then open http://localhost:5173

## Run it as an Android app (Capacitor)

The web app is wrapped with Capacitor into a native Android shell (`android/`).

After changing anything in `www/`, sync and run on a connected emulator/device:
```bash
cd "f:\Projects\3D Map"
npx cap sync android          # copy www/ into the native project
npx cap run android           # build + install + launch on the emulator
```
Or open `android/` in **Android Studio** and press ▶.

Build just the APK:
```bash
cd android && ./gradlew assembleDebug
# output: android/app/build/outputs/apk/debug/app-debug.apk
```

**Auth note:** email/password sign-in works in the app. Google/Apple OAuth is blocked inside plain WebViews and needs native deep-link setup — added later.

## How to use

- **Drag** to rotate · **scroll** to zoom · **two fingers / right-drag** to tilt.
- **Amber buildings** have available listings — **tap one** to see its apartments.
- Use the **מכירה / השכרה** (sale / rent) toggle and the **rooms** filter; buildings with no matches dim to grey.
- **⟲** resets the view; **✕** closes the panel.

## What's under the hood

| Piece | Choice | Why |
|---|---|---|
| Map + 3D | **MapLibre GL JS** | Open-source, free, buildings are native clickable features |
| Base tiles | **OpenFreeMap** | Free, no API key, includes building data |
| RTL labels | mapbox-gl-rtl-text plugin | Correct Hebrew rendering |
| Data | `js/data.js` | Hand-authored sample buildings + listings |

## Files

```
index.html      structure + brand + filters + panel
css/style.css   BlockView styling (amber "lit-window" accent, RTL)
js/data.js      sample buildings & listings  ← edit this to add data
js/app.js       map, clickable buildings, selection, filtering, panel
```

## What this prototype deliberately does NOT do yet

These are the next steps on the roadmap, not bugs:

- **Real building footprints.** Sample buildings are hand-placed boxes, so they won't line up perfectly with the photorealistic base. Phase 1's real work is pulling actual footprints from OSM / govmap and solving **address → building matching**.
- **Real listings / posting flow.** Data is fake. Phase 2 adds the backend and the owner/agent posting flow.
- **Photorealistic (Google Earth) look.** That's the later upgrade — swap the base for Google Photorealistic 3D Tiles once the interaction model is proven.
- Accounts, contact, saved searches, interior tours — later phases.

See the roadmap for the full plan.
