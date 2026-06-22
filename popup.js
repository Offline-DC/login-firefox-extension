/*
 * Dumb Down — Google Messages login helper (Firefox popup).
 *
 * The login MUST be captured from a private window. Why: Google rotates the
 * __Secure-*PSIDTS session cookie every ~30 minutes, and only ONE holder of a
 * cookie session can rotate it. If we copy cookies from the user's everyday
 * profile, that profile keeps rotating the session and the flip phone's copy is
 * invalidated within half an hour. A private window the user signs into ONCE and
 * then closes leaves the flip phone as the session's only holder, so the link
 * stays alive. (Same approach mautrix-gmessages documents.)
 *
 * Firefox notes: API is `browser.*` (promises); the private-browsing permission
 * is "Run in Private Windows" in about:addons (Firefox's equivalent of Chrome's
 * "Allow in Incognito").
 *
 * Privacy: cookies are only read and drawn on screen; no network requests.
 */

// Sign in WITHOUT pairing the browser: the continue URL lands on the config
// endpoint, not the Messages-for-web app (which would register this browser as
// a linked device and start its own session traffic).
const LOGIN_URL =
  "https://accounts.google.com/AccountChooser?continue=https://messages.google.com/web/config";

const STATES = ["loading", "allow", "start", "waiting", "error"];
function show(id) {
  for (const el of STATES) {
    document.getElementById(el).style.display = el === id ? "block" : "none";
  }
}

function fail(e) {
  document.getElementById("errmsg").textContent =
    "Error: " + (e && e.message ? e.message : e);
  show("error");
}

/** Is there already an open private window? (So we don't open a duplicate.) */
async function hasPrivateWindow() {
  const wins = await browser.windows.getAll();
  return wins.some((w) => w.incognito);
}

// --- buttons -----------------------------------------------------------------

// Open the private sign-in window, then let the background page take over (it
// opens the QR automatically once you've signed in).
document.getElementById("openIncognito").addEventListener("click", async () => {
  try {
    await browser.windows.create({ url: LOGIN_URL, incognito: true, focused: true });
    browser.runtime.sendMessage({ type: "watchSignin" });
    show("waiting");
    setTimeout(() => window.close(), 1200);
  } catch (e) {
    fail(
      "Couldn't open a private window (is private browsing disabled by policy?): " +
        (e && e.message ? e.message : e),
    );
  }
});

// Get the user back to the Google sign-in. Reuse the existing private window if
// one is open (focus it, and make sure it has a Google sign-in tab); otherwise
// open a fresh private window at the login URL.
document.getElementById("focusIncognito").addEventListener("click", async () => {
  try {
    const wins = await browser.windows.getAll({ populate: true });
    const w = wins.find((x) => x.incognito);
    if (w) {
      await browser.windows.update(w.id, { focused: true });
      const onGoogle = (w.tabs || []).some(
        (t) => t.url && /(accounts|messages)\.google\.com/.test(t.url),
      );
      if (!onGoogle) {
        await browser.tabs.create({ windowId: w.id, url: LOGIN_URL, active: true });
      }
    } else {
      await browser.windows.create({ url: LOGIN_URL, incognito: true, focused: true });
    }
    browser.runtime.sendMessage({ type: "watchSignin" });
    window.close();
  } catch (e) {
    fail(
      "Couldn't open the private sign-in window: " +
        (e && e.message ? e.message : e),
    );
  }
});

// --- main --------------------------------------------------------------------

(async () => {
  try {
    // Step 1: we can only read the private window's cookies if the user enabled
    // "Run in Private Windows" for this extension.
    const allowed = await browser.extension.isAllowedIncognitoAccess();
    if (!allowed) {
      show("allow");
      return;
    }

    // Step 2: if a private window is already open the user is mid-sign-in —
    // nudge the background page to (re)check and show the "finish signing in"
    // hint. Otherwise, offer to open the sign-in window.
    if (await hasPrivateWindow()) {
      browser.runtime.sendMessage({ type: "watchSignin" });
      show("waiting");
    } else {
      show("start");
    }
  } catch (e) {
    fail(e);
  }
})();
