# Dumb Down — Google Messages login helper (Firefox add-on)

Firefox build of the Chrome login helper. It walks the user through signing into
Google in a **private window**, reads that window's login cookies, and shows them
as a **QR code + copyable text**. The Dumb Down companion app scans/pastes that
and forwards it to the flip phone over the existing encrypted relay.

**Why a private window:** Google rotates the `__Secure-*PSIDTS` session cookie
roughly every 30 minutes, and only one holder of a session can rotate it.
Cookies copied from the user's everyday profile get invalidated as soon as that
profile rotates them. A private window that is signed into once and **closed
after the transfer** leaves the flip phone as the session's only holder, so the
link stays alive.

**Why Firefox at all:** Firefox doesn't implement Chrome's Device Bound Session
Credentials (DBSC), which on Windows binds the login to the computer and makes
the transferred cookies useless on the flip phone. Signing in through Firefox
sidesteps DBSC entirely — this add-on is the durable fix for users hitting that.

**Privacy:** the add-on only *reads* cookies and draws them on screen. It makes
no network requests of its own — the login never leaves the computer except when
the user's own phone scans the QR.

## What's different from the Chrome version

Same UX, same files, ported for Firefox:

- API namespace is `browser.*` (promise-based) instead of `chrome.*`.
- Background is an MV3 **event page** (`background.scripts`) — Firefox doesn't
  support service-worker backgrounds.
- `manifest.json` carries a `browser_specific_settings.gecko.id` (required to
  sign/distribute) and `strict_min_version`.
- Cookies are read from Firefox's **private** cookie store; the private-browsing
  permission is **"Run in Private Windows"** in `about:addons` (Firefox's
  equivalent of Chrome's "Allow in Incognito").

`qrcode.min.js` and `icons/` are bundled (copied from the Chrome extension).

## Load it for testing (no signing needed)

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick this folder's `manifest.json`.
3. Open `about:addons` → on **Dumb Down login helper** click the **···** (three
   dots) → **Manage** → set **Run in Private Windows** to **Allow** (the helper
   can't see the private sign-in otherwise).
4. Click the toolbar icon and follow the steps.

Temporary add-ons are removed when Firefox restarts — fine for testing, not for
real users. For that you must sign it (below).

> Note: a temporary add-on with no signing works on any Firefox channel. A
> permanently-installed *unsigned* add-on only works on Firefox **Developer
> Edition / Nightly / ESR** with `xpinstall.signatures.required` set to `false`
> in `about:config`. Release and Beta Firefox require a Mozilla-signed build —
> so for general users, sign it.

## Distribute to real users (Mozilla signing via AMO)

Firefox add-ons must be signed by Mozilla (addons.mozilla.org, "AMO") to install
in normal Firefox. Signing is free. Two routes — pick based on how public you
want it:

### Option A — Listed on AMO (recommended for general release)

Mozilla hosts it, users install one-click from a public AMO page, and Firefox
auto-updates it for you.

1. Create an AMO account at <https://addons.mozilla.org/developers/>.
2. **Submit a New Add-on** → upload a zip of this folder's **contents** (not the
   folder itself). Do NOT use Finder's right-click "Compress" — it adds
   `__MACOSX/._*` and `.DS_Store` junk that the linter flags. Use one of:
   ```bash
   cd login-firefox-extension

   # Recommended — web-ext builds a clean package (no macOS junk):
   npx web-ext build --overwrite-dest        # → web-ext-artifacts/*.zip

   # Or plain zip, with macOS AppleDouble/.DS_Store files suppressed:
   COPYFILE_DISABLE=1 zip -r -X ../dumbdown-firefox.zip . \
     -x '.*' -x '*/.DS_Store' -x '__MACOSX/*'
   ```
3. Choose **"On this site"** (listed), fill in name/description/icons/screenshots,
   set visibility (you can keep it **Unlisted-on-search / invisible** during a
   beta so only people with the link find it), and submit.
4. Because it requests the `cookies` permission on Google domains, justify it in
   the review notes: it reads the signed-in Google cookies *solely* to let the
   user transfer their own Messages-for-web login to their own paired device, and
   makes no network requests. Point reviewers at this README.
   - The manifest declares `data_collection_permissions.required: ["authenticationInfo"]`
     (required by AMO since Nov 2025). That's accurate: the add-on handles Google
     login cookies. It still transmits nothing to the developer — the login only
     leaves the computer when the user's own phone scans the QR.
5. After approval, share the AMO link. Updates: bump `version` in `manifest.json`
   and upload a new build; Firefox updates users automatically.

### Option B — Self-distributed signed .xpi (good for a private beta)

Mozilla signs it but **you** host the `.xpi` (e.g. on `dumb.co`) and users
install from your link. Mirrors the "Unlisted" approach you use for Chrome.

1. Get API credentials: AMO → **Tools → Manage API Keys** → note the JWT issuer
   and secret.
2. Install Mozilla's `web-ext` and sign on the **unlisted** channel:
   ```bash
   npm install -g web-ext
   cd login-firefox-extension
   web-ext sign \
     --channel=unlisted \
     --api-key="$AMO_JWT_ISSUER" \
     --api-secret="$AMO_JWT_SECRET"
   ```
   This validates, submits for (mostly automated) signing, and drops a signed
   `*.xpi` in `./web-ext-artifacts/`.
3. Host that `.xpi` somewhere on your site and give users the link. Clicking it in
   Firefox prompts an install (allow the `cookies` + google.com permissions).
4. **Auto-updates** (optional but recommended): host an update manifest and point
   the add-on at it. Add to `manifest.json`:
   ```json
   "browser_specific_settings": {
     "gecko": {
       "id": "gmessages-login@dumb.co",
       "strict_min_version": "115.0",
       "update_url": "https://dumb.co/ext/updates.json"
     }
   }
   ```
   and host `https://dumb.co/ext/updates.json`:
   ```json
   {
     "addons": {
       "gmessages-login@dumb.co": {
         "updates": [
           {
             "version": "1.5.6",
             "update_link": "https://dumb.co/ext/dumbdown-login-1.5.6.xpi"
           }
         ]
       }
     }
   }
   ```
   To ship an update: bump `version`, re-sign, upload the new `.xpi`, and add a
   new entry to `updates.json`. Firefox checks it and updates users.

### Which to choose

- **Listed (A)** — least friction for users (one click, auto-updates, Mozilla
  hosts), but public-ish and a real review. Best once it's stable.
- **Self-distributed (B)** — you keep it off the public store and control the
  install link; slightly more setup for updates. Best for the beta, exactly like
  your Chrome "Unlisted" path.

## Files

- `manifest.json` — MV3 manifest; `cookies` permission + `*.google.com` host
  access + an event-page background. Carries the `gecko` id needed for signing.
- `popup.html` / `popup.js` — first-run guidance (enable Run in Private Windows),
  then open the private sign-in window.
- `background.js` — event page. Watches google.com cookies and auto-opens the QR
  (`qr.html`) once the private-window sign-in completes.
- `qr.html` / `qr.js` — the QR page: renders the login blob as a QR + copy text,
  with the red "close the private window" button.
- `qrcode.min.js` — the `qrcode-generator` library (Kazuhiko Arase, MIT).
- `icons/` — toolbar/store icons.
# login-firefox-extension
