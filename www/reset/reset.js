/* BlockView — password reset (shared by website users, agents and admins).
 * Two modes on one page:
 *   1. no recovery token  -> ask for the email, send a reset link
 *   2. arrived from link  -> let them set a new password
 * Security: never reveals whether an email exists (Supabase behaves the same
 * either way, and we always show the same confirmation).
 */
(function () {
  const cfg = window.BLOCKVIEW_CONFIG;
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (id) => document.getElementById(id);
  const SITE = "https://blockview.co.il";

  function msg(text, kind) {
    const m = $("msg"); m.textContent = text; m.className = "msg " + (kind || "");
    m.hidden = false;
  }

  // prefill the email if we were sent one (e.g. from the settings menu)
  const qp = new URLSearchParams(location.search);
  if (qp.get("email")) $("email").value = qp.get("email");

  // did we land here from the emailed recovery link?
  const hash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  let recovery = hash.get("type") === "recovery" || qp.get("type") === "recovery";

  function showChoose() {
    recovery = true;
    $("request").hidden = true;
    $("choose").hidden = false;
    $("pw1").focus();
  }
  if (recovery) showChoose();

  // supabase-js parses the token from the URL and emits this
  supa.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") showChoose();
  });

  /* -------- step 1: send the reset link -------- */
  $("send").addEventListener("click", async () => {
    const email = $("email").value.trim();
    if (!email || !/.+@.+\..+/.test(email)) return msg("הזן כתובת אימייל תקינה", "err");
    $("send").disabled = true;
    const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: SITE + "/reset" });
    $("send").disabled = false;
    if (error) return msg(error.message, "err");
    // same message regardless of whether the account exists (no account enumeration)
    msg("אם קיים חשבון עם האימייל הזה — נשלח אליו קישור לאיפוס הסיסמה. בדוק גם בספאם.", "ok");
  });
  $("email").addEventListener("keydown", (e) => { if (e.key === "Enter") $("send").click(); });

  /* -------- step 2: set the new password -------- */
  $("save").addEventListener("click", async () => {
    const a = $("pw1").value, b = $("pw2").value;
    if (a.length < 8) return msg("הסיסמה חייבת להכיל לפחות 8 תווים", "err");
    if (a !== b) return msg("הסיסמאות אינן תואמות", "err");
    $("save").disabled = true;
    const { error } = await supa.auth.updateUser({ password: a });
    $("save").disabled = false;
    if (error) return msg(error.message, "err");
    $("choose").hidden = true;
    msg("הסיסמה עודכנה בהצלחה ✓ אפשר להתחבר עכשיו.", "ok");
  });
  $("pw2").addEventListener("keydown", (e) => { if (e.key === "Enter") $("save").click(); });

  $("back").addEventListener("click", () => (window.location.href = SITE));
})();
