/* BlockView — confirmation dialog in the app's own design.
 * window.confirm() is a jarring grey OS box, and inside the Android WebView it
 * shows the site's URL. bvConfirm() returns the same boolean, as a promise:
 *
 *   if (!(await bvConfirm({ title: "...", text: "...", danger: true })) return;
 */
(function () {
  var modal = document.getElementById("confirm-modal");
  if (!modal) return;

  var elIc = document.getElementById("confirm-ic");
  var elTitle = document.getElementById("confirm-title");
  var elText = document.getElementById("confirm-text");
  var btnOk = document.getElementById("confirm-ok");
  var btnCancel = document.getElementById("confirm-cancel");
  var T = function (k, fb) { return (window.t ? window.t(k) : fb) || fb; };
  var resolver = null;

  function close(answer) {
    modal.hidden = true;
    document.removeEventListener("keydown", onKey);
    var r = resolver; resolver = null;
    if (r) r(answer);
  }
  function onKey(e) {
    if (e.key === "Escape") close(false);
    else if (e.key === "Enter") close(true);
  }

  btnOk.addEventListener("click", function () { close(true); });
  btnCancel.addEventListener("click", function () { close(false); });
  modal.addEventListener("click", function (e) { if (e.target === modal) close(false); });

  window.bvConfirm = function (opts) {
    opts = opts || {};
    // a second call would strand the first promise — answer it as "cancelled"
    if (resolver) close(false);
    elIc.textContent = opts.icon || (opts.danger ? "🗑️" : "⚠️");
    elTitle.textContent = opts.title || T("are_you_sure", "לאשר את הפעולה?");
    elText.textContent = opts.text || "";
    elText.hidden = !opts.text;
    btnOk.textContent = opts.okText || T("confirm", "אישור");
    btnCancel.textContent = opts.cancelText || T("cancel", "ביטול");
    btnOk.className = "confirm-ok" + (opts.danger ? " danger" : "");
    modal.hidden = false;
    document.addEventListener("keydown", onKey);
    setTimeout(function () { btnCancel.focus(); }, 30);
    return new Promise(function (resolve) { resolver = resolve; });
  };
})();
