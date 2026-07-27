# iOS → TestFlight via Codemagic (no Mac needed)

BlockView is a Capacitor app; it builds on a cloud Mac (Codemagic) and uploads
to TestFlight automatically. The pipeline is [`codemagic.yaml`](../../codemagic.yaml).

## Prerequisites (already done)
- App exists in App Store Connect with bundle id **com.blockview.app** ✅
- iOS project committed under `ios/` ✅

## One-time setup (you do this once)

### 1. Create an App Store Connect API key
App Store Connect → **Users and Access** → **Integrations** tab → **App Store Connect API**
→ **Generate API Key** (Team Keys).
- Role: **App Manager** (or Admin)
- Download the **`.p8`** file (you can only download it once — save it)
- Note the **Key ID** and the **Issuer ID** (shown above the key list)

### 2. Codemagic account
- Sign up at https://codemagic.io with your GitHub account (free tier: ~500 macOS min/mo)
- **Add application** → pick repo **PashaMor/-blockview.co.il** → it detects `codemagic.yaml`

### 3. Connect the API key to Codemagic
Codemagic → **Teams / Settings** → **Integrations** → **App Store Connect** → **Add key**:
- Upload the `.p8`, paste **Key ID** + **Issuer ID**
- **Name the integration EXACTLY:** `BlockView ASC`
  (this string must match `integrations.app_store_connect` in `codemagic.yaml`)

Codemagic uses this key to auto-create the iOS distribution certificate and
provisioning profile — no Mac, no manual certs.

### 4. Run it
Codemagic → BlockView → **Start new build** → workflow **iOS TestFlight**.
On success the build appears in **App Store Connect → TestFlight** after Apple
finishes processing (~5–15 min). Add it to a tester group there.

## Notes
- Build number auto-increments from Codemagic's build index; version stays `1.0`.
- Export compliance is pre-answered (`ITSAppUsesNonExemptEncryption=false`) so
  TestFlight won't prompt each upload.
- To bump the marketing version later: edit `MARKETING_VERSION` in
  `ios/App/App.xcodeproj/project.pbxproj` (or `agvtool new-marketing-version`).

---

## TestFlight release info (v1.0, build 1)

**"What to Test"** (TestFlight test notes — paste into the build's Test Details):

_Hebrew:_
```
גרסה ראשונה לבדיקה 🎉
בדקו את המפה התלת-ממדית: הקישו על בניין, פתחו דירה, סננו לפי מחיר/חדרים,
שמרו למועדפים ונסו לפרסם נכס. דווחו על כל תקלה או משהו שנראה שבור.
```

_English:_
```
First test build 🎉
Try the 3D map: tap a building, open a unit, filter by price/rooms,
save to favorites, and try publishing a property. Report anything broken.
```
