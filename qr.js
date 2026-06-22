/*
 * Renders the login blob (passed in the URL hash) as a big, easy-to-scan QR.
 * Opened in its own tab by the background page when the user is signed in. Kept
 * as an external file because Manifest V3 blocks inline <script> on extension
 * pages (Firefox enforces this too).
 *
 * If the blob is too large to fit in a single QR, falls back to a copyable text
 * box so the user can paste it into the app manually.
 *
 * Firefox port: window/tab calls use browser.* promises instead of chrome.*
 * callbacks.
 */
(function () {
  var data = decodeURIComponent((location.hash || "").slice(1));
  var qrEl = document.getElementById("qr");
  var errEl = document.getElementById("err");

  if (!data) {
    errEl.textContent = "No login data — re-open this from the extension.";
    return;
  }

  function showFallback(message) {
    qrEl.replaceChildren();
    errEl.textContent = message;
    document.getElementById("blob").value = data;
    document.getElementById("fallback").style.display = "block";
  }

  document.getElementById("copy").addEventListener("click", function () {
    var ta = document.getElementById("blob");
    ta.select();
    try {
      navigator.clipboard.writeText(ta.value);
    } catch (e) {
      document.execCommand("copy");
    }
  });

  // Close the private window AND this QR tab once the phone has the login. The
  // private session must NOT keep running on this computer: whoever holds a
  // Google session rotates its __Secure-*PSIDTS cookie (~every 30 min), which
  // invalidates the copy we just gave the flip phone. Closing the window leaves
  // the phone as the session's only holder, so the link stays alive. Closing
  // this tab too just saves the user a step.
  var autoTimer = null;
  var closing = false;
  async function closePrivateWindows() {
    if (closing) return;
    closing = true;
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
    var auto = document.getElementById("autoclose");
    if (auto) auto.textContent = "";
    document.getElementById("doneMsg").textContent = "all set — closing…";
    try {
      var wins = await browser.windows.getAll();
      for (var i = 0; i < wins.length; i++) {
        if (wins[i].incognito) {
          try { await browser.windows.remove(wins[i].id); } catch (e) { /* ignore */ }
        }
      }
      // Close this QR tab too. If it lived inside the private window we just
      // closed, remove() no-ops.
      try {
        var tab = await browser.tabs.getCurrent();
        if (tab && tab.id != null) await browser.tabs.remove(tab.id);
      } catch (e) { /* ignore */ }
    } catch (e) {
      console.error("[dumbdown] couldn't close private window:", e);
    }
  }

  document.getElementById("done").addEventListener("click", closePrivateWindows);

  // Safety net: most people won't tap the button, so auto-close the private
  // window after 60s (plenty of time to scan). A countdown next to the button
  // shows what's about to happen; tapping the button closes immediately.
  var secondsLeft = 60;
  var autoEl = document.getElementById("autoclose");
  function tick() {
    if (autoEl) autoEl.textContent = "(auto-closes in " + secondsLeft + "s)";
    if (secondsLeft <= 0) {
      closePrivateWindows();
      return;
    }
    secondsLeft -= 1;
  }
  tick();
  autoTimer = setInterval(tick, 1000);

  if (typeof qrcode !== "function") {
    showFallback("QR library missing (add qrcode.min.js — see README).");
    return;
  }

  try {
    var qr = qrcode(0, "L"); // 0 = auto-size, L = max capacity for a big blob
    qr.addData(data);
    qr.make();
    // Build the <img> via DOM (createDataURL + appendChild) rather than
    // innerHTML, so the add-on linter stays clean. Large modules so a phone
    // camera reads it easily; CSS scales it to fill.
    var img = document.createElement("img");
    img.src = qr.createDataURL(12, 6);
    img.alt = "Sign-in QR code";
    qrEl.replaceChildren(img);
  } catch (e) {
    showFallback(
      "Login is too large for one QR. Copy the text below and paste it into " +
        "the app instead."
    );
  }
})();
