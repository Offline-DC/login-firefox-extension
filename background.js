/*
 * Dumb Down — Google Messages login helper (Firefox background event page).
 *
 * Firefox port of the Chrome helper. Two Firefox-specific differences from the
 * Chrome version:
 *   1. API namespace is `browser.*` (promise-based), not `chrome.*`.
 *   2. Background is an MV3 *event page* (background.scripts), because Firefox
 *      does not support service-worker backgrounds. Listeners + the in-memory
 *      guard behave the same; the cross-wake guard is browser.storage.session.
 *
 * Auto-opens the QR once the private-window sign-in completes, so the user
 * doesn't have to click the toolbar icon a second time. It watches google.com
 * cookies (browser.cookies.onChanged) and, when the private cookie store has
 * the full set of account cookies, opens the QR page (qr.html) and focuses it.
 *
 * Deliberately uses ONLY the `cookies` permission — no code injection into
 * google.com pages. It makes no network requests.
 */

// Cookies the GAIA / Messages-for-web flow needs. We forward ONLY these (not
// every google.com cookie) so the blob still fits in a single QR code.
//
// Keep this list as small as the Messages session actually needs: every cookie
// here adds to the QR payload, and a denser (higher-version) QR is harder for a
// phone camera to read off a monitor. NID is deliberately EXCLUDED — it's
// Google's preferences/ad-personalization cookie (~200 chars), not part of the
// auth session, so dropping it shrinks the QR (~v30 → v27) with no effect on
// sign-in. The phone parses whatever cookies it receives and only requires
// CRITICAL below, so omitting NID stays compatible with every app version.
const WANTED = new Set([
  "SID", "HSID", "SSID", "APISID", "SAPISID", "OSID", "SIDCC",
  "__Secure-1PSID", "__Secure-3PSID",
  "__Secure-1PSIDTS", "__Secure-3PSIDTS",
  "__Secure-1PSIDCC", "__Secure-3PSIDCC",
  "__Secure-OSID", "__Secure-1PAPISID", "__Secure-3PAPISID",
]);
// Must match the phone's REQUIRED_COOKIES (GoogleMessagesSignInScreen.kt):
// SID, HSID, OSID, SSID, APISID, SAPISID. OSID in particular is set a moment
// AFTER the account sign-in (once the messages.google.com service session is
// established), so gating on it makes the auto-open wait for a COMPLETE login.
const CRITICAL = ["SID", "HSID", "OSID", "SSID", "APISID", "SAPISID"];

// In-memory guard against double-opens within one event-page wake; the
// cross-wake guard is browser.storage.session ("qrShown").
let opening = false;
// Re-arm flag: if a trigger arrives while a check is mid-flight (opening), we
// can't just drop it — that trigger might be the OSID write that completes the
// login, and the in-flight check may have read the cookies a moment too early.
// Setting this makes tryOpenQR run exactly once more after the current pass, so
// the final signed-in state is never missed. (This used to be masked by NID,
// which updated on nearly every request and kept re-firing the cookie trigger;
// now that NID is no longer watched, we handle the race explicitly.)
let rerun = false;

/** Locate the private cookie store + a window to open the QR in. In Firefox all
 *  private windows share the "firefox-private" store, but we match the store by
 *  its tabIds against the tabs of actual private windows so this stays correct
 *  regardless of the store id. */
async function findPrivate() {
  const wins = await browser.windows.getAll({ populate: true });
  const priv = wins.filter((w) => w.incognito);
  if (!priv.length) return null;
  const tabIds = new Set(priv.flatMap((w) => (w.tabs || []).map((t) => t.id)));
  const stores = await browser.cookies.getAllCookieStores();
  const store = stores.find((s) => s.tabIds.some((id) => tabIds.has(id)));
  if (!store) return null;
  return { storeId: store.id, windowId: priv[0].id };
}

async function readGoogleCookies(storeId) {
  const merged = {};
  const list = await browser.cookies.getAll({ domain: "google.com", storeId });
  for (const c of list) if (WANTED.has(c.name)) merged[c.name] = c.value;
  return merged;
}

function toCookieHeader(map) {
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

/** If the private window is signed in, open the QR (exactly once). */
async function tryOpenQR() {
  // Claim the in-memory lock SYNCHRONOUSLY, before any await. cookies.onChanged
  // fires a burst during sign-in; if we set this after the awaits, every event
  // in the burst slips through and we open a tab each (the "10 tabs" bug).
  // A trigger that arrives mid-flight isn't dropped — it re-arms a single
  // follow-up pass (see `rerun`) so the OSID-completes-login event can't be lost.
  if (opening) { rerun = true; return; }
  opening = true;
  try {
    const { qrShown } = await browser.storage.session.get("qrShown");
    if (qrShown) return; // cross-wake guard (storage.session survives restarts)

    const found = await findPrivate();
    if (!found) return;
    const map = await readGoogleCookies(found.storeId);
    if (CRITICAL.some((n) => !map[n])) return; // sign-in not finished yet

    // Mark shown BEFORE the async tab-open so a later wake can't also open one.
    // If the open fails, clear it so a retry can happen.
    await browser.storage.session.set({ qrShown: true });
    try {
      const url =
        browser.runtime.getURL("qr.html") + "#" + encodeURIComponent(toCookieHeader(map));
      // Prefer the private window so the QR shows where the user is looking;
      // Firefox refuses to open an extension page in a private window unless the
      // add-on is allowed there, so fall back to a normal tab. Either way, focus
      // it so it can't hide behind another window.
      let tab;
      try {
        tab = await browser.tabs.create({ windowId: found.windowId, url, active: true });
      } catch (e) {
        tab = await browser.tabs.create({ url, active: true });
      }
      if (tab && tab.windowId != null) {
        await browser.windows.update(tab.windowId, { focused: true });
      }
    } catch (e) {
      console.error("[dumbdown] couldn't open QR:", e);
      await browser.storage.session.set({ qrShown: false });
    }
  } finally {
    opening = false;
    // If a trigger came in while we were checking, run one more pass now that
    // the latest cookie writes have landed. Scheduled as a microtask so we don't
    // recurse on the stack. The qrShown guard makes the extra pass a no-op once
    // the QR is up, so this can't open duplicates.
    if (rerun) {
      rerun = false;
      Promise.resolve().then(tryOpenQR);
    }
  }
}

// Sign-in writes/updates google.com cookies repeatedly — use that as the
// trigger. Cheap name filter first so we don't churn on unrelated cookies.
browser.cookies.onChanged.addListener((info) => {
  if (info.removed) return;
  if (!WANTED.has(info.cookie.name)) return;
  tryOpenQR();
});

// Definitive completion signal: the sign-in flow's continue URL lands the
// private window on messages.google.com/web/config (popup.js LOGIN_URL). When
// that page finishes loading, the account + messages-service session (incl.
// OSID) is established, so it's the most reliable moment to open the QR — more
// so than any single cookie write. We need this because dropping NID removed the
// chatty cookie events that used to re-fire the trigger after sign-in. tab.url
// is visible here without the `tabs` permission thanks to our google.com host
// access. Filtered to private-window tabs only.
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.incognito) return;
  if (changeInfo.status !== "complete") return;
  const url = tab.url || "";
  if (/^https:\/\/messages\.google\.com\/web\//.test(url)) tryOpenQR();
});

// The popup kicks this when it opens the sign-in window: clear the guard so a
// fresh sign-in re-arms, then check immediately (covers already-signed-in).
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "watchSignin") {
    browser.storage.session.set({ qrShown: false }).then(tryOpenQR);
  }
});
