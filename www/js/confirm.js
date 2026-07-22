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
  var elInputLabel = document.getElementById("confirm-input-label");
  var elInput = document.getElementById("confirm-input");
  var btnOk = document.getElementById("confirm-ok");
  var btnCancel = document.getElementById("confirm-cancel");
  var T = function (k, fb) { return (window.t ? window.t(k) : fb) || fb; };
  var resolver = null;
  var mode = "confirm";   // "confirm" -> boolean, "prompt" -> typed value | null
  var requireMatch = "";  // when set, OK stays disabled until the input matches it

  // What OK resolves to, and what a cancel resolves to, depend on the mode.
  function okValue() { return mode === "prompt" ? elInput.value.trim() : true; }
  function cancelValue() { return mode === "prompt" ? null : false; }

  function close(answer) {
    modal.hidden = true;
    document.removeEventListener("keydown", onKey);
    var r = resolver; resolver = null;
    if (r) r(answer);
  }
  function onKey(e) {
    if (e.key === "Escape") close(cancelValue());
    else if (e.key === "Enter" && !btnOk.disabled) close(okValue());
  }
  // with a required phrase, the destructive button only wakes up on an exact match
  function refreshOk() {
    if (!requireMatch) { btnOk.disabled = false; return; }
    btnOk.disabled = elInput.value.trim().toLowerCase() !== requireMatch.toLowerCase();
  }

  btnOk.addEventListener("click", function () { if (!btnOk.disabled) close(okValue()); });
  btnCancel.addEventListener("click", function () { close(cancelValue()); });
  modal.addEventListener("click", function (e) { if (e.target === modal) close(cancelValue()); });
  elInput.addEventListener("input", refreshOk);

  window.bvConfirm = function (opts) {
    opts = opts || {};
    // a second call would strand the first promise — answer it as "cancelled"
    if (resolver) close(cancelValue());
    mode = opts.input ? "prompt" : "confirm";
    requireMatch = opts.requireMatch || "";
    elIc.textContent = opts.icon || (opts.danger ? "🗑️" : "⚠️");
    elTitle.textContent = opts.title || T("are_you_sure", "לאשר את הפעולה?");
    elText.textContent = opts.text || "";
    elText.hidden = !opts.text;
    if (opts.input) {
      elInput.hidden = false;
      elInput.type = opts.inputType || "text";
      elInput.value = "";
      elInput.placeholder = opts.inputPlaceholder || "";
      elInputLabel.textContent = opts.inputLabel || "";
      elInputLabel.hidden = !opts.inputLabel;
    } else {
      elInput.hidden = true;
      elInputLabel.hidden = true;
    }
    btnOk.textContent = opts.okText || T("confirm", "אישור");
    btnCancel.textContent = opts.cancelText || T("cancel", "ביטול");
    btnOk.className = "confirm-ok" + (opts.danger ? " danger" : "");
    refreshOk();
    modal.hidden = false;
    document.addEventListener("keydown", onKey);
    // focus the field when we're asking them to type, else the safe button
    setTimeout(function () { (opts.input ? elInput : btnCancel).focus(); }, 30);
    return new Promise(function (resolve) { resolver = resolve; });
  };
})();
