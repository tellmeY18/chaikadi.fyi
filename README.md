# Chaikadi · chaikadi.fyi

A small-group tea-break / food-order PWA for **2–15 people**. Create a group,
share a four-character room code, choose items, designate one orderer, and track
the bill. No accounts, app-store installation, backend database, analytics or
runtime CDN dependencies.

**Deploy these files as-is. There is no build step or `npm install`.** The UI is
Preact + htm, vendored locally; state, persistence and networking are plain ES
modules independent of the UI framework.

The visual source of truth is [DESIGN.md](DESIGN.md): monochrome, locally hosted
Courier Prime, square controls and receipt-like rows. The four bottom tabs are
Menu, My picks, Order and Costs. Group, History and Settings are in the app bar
menu; the compact room code also opens Group. Theme follows the device, with
persisted Light / Dark / Follow system overrides in Settings.

## Run locally

With Nix:

```sh
nix develop
python3 tools/serve.py        # http://localhost:8080
# Open http://localhost:8080
```

`tools/serve.py` is the stdlib server with a larger connection queue. Plain
`python3 -m http.server` works for one browser, but drops connections when
several fresh browsers load the app at once.

Or run the Python command with an existing Python installation. `localhost` is a
secure-context exception for development. **A phone visiting an HTTP LAN IP is
not a secure context**: use an HTTPS staging deployment for camera, service
worker, installation and real-device tests. Do not open `index.html` via `file:`.

Pure state/protocol tests require Node 22+ (included in `flake.nix`):

```sh
nix develop --command npm test
# or node --test tests/*.test.js
# Optional sandboxed check for the current platform:
nix flake check
```

`flake.lock` pins the dev environment. Node/Python are **development tools only**.
`tools/generate-icons.mjs` regenerates the already committed PNGs if desired.

Optional browser integration checks use a separate Playwright installation
(not a shipped dependency). With the static server running:

```sh
# In the Nix dev shell, install test tooling outside the deployment directory:
npm install --prefix /path/to/test-tools playwright
/path/to/test-tools/node_modules/.bin/playwright install chromium webkit
export PLAYWRIGHT_MODULE=/path/to/test-tools/node_modules/playwright/index.mjs
node tests/browser.mjs                 # real local WebRTC + offline/PWA flow
BROWSER=webkit node tests/browser.mjs  # WebKit equivalent
node tests/room.mjs                    # real public signaling; needs internet
node tests/scan.mjs                    # on-device menu OCR, online + offline
node tests/design.mjs                  # multiple menus, themes, sheets, 200% text
node tests/library.mjs                 # menu library import, offline, hash checks
node tests/update.mjs                  # in-app update: waits, Update now, state kept
node --test tests/data.test.js         # library client only (no browser)
```

Set `TEST_URL` to override `http://127.0.0.1:8080`. `SCREENSHOT_PATH` overrides
the browser smoke's screenshot destination. The tests use isolated profiles;
they do not edit an existing user's group. Run browser suites sequentially.

## Deploy with the custom domain

Use the **root of a domain** (e.g. `https://chaikadi.fyi/`). Invite links and
QRs use whatever origin the app is opened from, so `chaikadi.pages.dev` and
`chaikadi.fyi` both work. Room-QR scanning accepts those two hosts plus the
current one (see `js/ui.js`).

### GitHub Pages

1. Put these files in a GitHub repository, including `vendor/`, `icons/`,
   `.nojekyll`, and `CNAME`.
2. Settings → Pages → Deploy from a branch → choose your branch and `/ (root)`.
3. Set the custom domain to `chaikadi.fyi`. The included `CNAME` has that value.
4. At your DNS provider, configure the apex using GitHub Pages' current A/AAAA
   records (or an ALIAS/ANAME to `<username>.github.io` if supported). Follow
   GitHub's custom-domain verification instructions.
5. After GitHub provisions the certificate, enable **Enforce HTTPS**.
6. Open the custom domain and wait for **Offline app ready** in the footer.

GitHub project-subdirectory preview URLs can load the relative shell, but invites
still point at the production domain. Use the actual custom domain for group tests.

### Netlify

1. Import the repository or deploy the directory with drag-and-drop.
2. Leave the build command empty; publish directory is `.`.
3. Domain management → add `chaikadi.fyi`; point DNS to the records Netlify shows.
4. Enable/provision HTTPS and redirect HTTP to HTTPS.

### Cloudflare Pages

1. Create a Pages project from the repository, framework preset **None**.
2. No build command; output directory `.` (the repository root).
3. Add `chaikadi.fyi` under Custom domains and complete DNS verification.
4. Enable HTTPS. No Worker or Functions are needed.

For all providers: serve `.js` as JavaScript, `.json` as JSON and `.png` as PNG.
Avoid long-lived HTTP caching for `sw.js`; normal revalidation is appropriate.
The included `_headers` uses `public, no-cache, no-transform`. Cloudflare honours
`no-transform` by not injecting its automatic Web Analytics beacon. Keep Pages
Web Analytics disabled as well. This preserves the app's no-tracking requirement
even when the custom domain has automatic analytics enabled at the zone level.
There are no path routes to rewrite: navigation is one page with `?room=ABCD`.
Development files may be omitted from deployment; all files in `sw.js`'s `SHELL`
must be present. Do not rename or remove a precached file without updating it.

### Updating the app

Bump `CACHE` in `sw.js` (and `APP_VERSION` in `js/config.js`) whenever an app or
vendor file changes, then deploy the complete directory together. The new shell
is precached atomically and then **waits**: an active order never switches
versions by itself. The app checks for updates when it returns to the
foreground (at most every 30 minutes) and from **Settings → Check for updates**.
When one is ready, a banner offers **Update now**: the app saves everything,
activates the new worker and restarts the page once (running new JavaScript
requires that). Groups, picks, history and queued changes are restored and
room-code connections reconnect; manual pairings must pair again (the banner
says so when one is active). Tested by `node tests/update.mjs`.

## Install on phones

- **iPhone / iPad (Safari 16+)**: visit the HTTPS site in Safari → Share → Add to
  Home Screen → Add. Launch the new Chaikadi icon.
- **Android (Chrome)**: visit the HTTPS site → browser menu → Install app / Add to
  Home screen. The exact menu label varies by Chrome version.
- Visit online once and wait for **Offline app ready** before disconnecting.
  The service worker precaches all UI, scripts, dependencies and icons.
- Create or join from the environment you will keep using. Safari and a
  home-screen app may have separate storage on some iOS versions; do not assume
  a browser group's identity transfers to the installed app.

## How to use it

1. **Create a group** in one tap. Group and display names are prefilled and can
   be edited or rerolled. You are the host and initial orderer. Keep your app open.
2. Others enter the four-box room code, open your invite link, or scan its QR.
   A completed valid code / link joins automatically. Name collisions receive
   a number suffix; display names can be changed in Settings.
3. New groups have **no default menu or items**. Create a named menu per shop,
   add items, or use **Snap a menu → Take photo / Choose photo**.
   Items and prices are read on the phone; review/untick/edit, then **Add N
   items**. The first menu becomes this round’s menu. Names/prices update only
   within the selected menu. **Add common tea-break items** is optional and
   never resets an existing price. Anyone can edit menus; the host or orderer
   chooses **Use for this round**. Switching confirms before clearing picks.
4. In **My picks**, use +/−; tap an item name for a note sheet and **Save note**.
   **Can’t decide? / Roll again** opens a private suggestion sheet, not a vote.
5. **Order** shows quantities, notes, per-person details and a copyable summary.
   Only the assigned orderer can **Lock order** or unlock. This is a
   bookkeeping action: place the order yourself by phone/chat/shop app.
6. **Costs** shows subtotals to everyone. Once locked, the orderer enters the
   actual bill, chooses the difference split, and toggles Paid / Not paid.
7. **Finish round** archives a full snapshot, clears current picks/bill/payments,
   and retains the group, members and saved menus. History records the original
   menu name and shows outstanding amounts
   across rounds and lets each round's orderer mark late payments.
8. **Settings** changes your name, host-controlled currency label and connection
   settings. Export local JSON before leaving a group or clearing browser data.

Saved single-menu groups migrate into one named **Menu**, preserving item IDs,
picks, prices, currency and history. Nothing is silently deleted. Only the active
round’s menu is frozen by locking; other saved menus remain editable. Refresh all
devices onto the same app version before using multiple menus together.
The handshake checks the multi-menu protocol version and asks older clients to
update, preserving saved state rather than letting an old writer drop menu IDs.

### Bill arithmetic

All prices and totals are **integer minor units** (paise for INR), displayed with
Indian grouping and two decimal places when fractional. New groups use **Rs**;
existing currency settings stay intact. Only members with picks share the bill.
The orderer's own share is displayed but is not counted as debt to themselves.

- Estimated subtotals ₹10 + ₹20, actual bill ₹36:
  - Equal **difference**: ₹13 + ₹23 (each pays ₹3 of the ₹6 extra).
  - Proportional difference: ₹12 + ₹24.
- Zero-priced picks are valid. If all subtotals are zero, proportional falls
  back to equal splitting.
- Largest-remainder allocation makes shares add up exactly to the actual bill.
- Discounts are supported. Equal discounts cannot make someone's share
  negative; excess discount is redistributed among remaining positive shares.
- Saving a bill again, or unlocking, clears current payment marks. Finish may
  archive an estimated-only round if no actual bill was entered; it is labeled
  accordingly. Archived amounts and currencies are not affected by menu edits.

## Menu scanning (on-device)

`js/ingest.js` turns a photo into menu items without any server:

1. The photo is downscaled (max 2000 px), EXIF-rotated, grayscaled and
   contrast-boosted on a canvas.
2. **Built-in AI (optional):** if the browser exposes Chrome's Prompt API with
   image input and the model is *already downloaded* (`availability() ===
   'available'`), Gemini Nano returns items as JSON (schema-constrained). It
   never triggers a model download itself. Today this is limited to some
   desktop Chrome builds; phones use step 3.
3. **OCR (everywhere):** Tesseract 7 (WASM, vendored) reads words with
   positions and confidence. `cleanOcrLines()` drops dotted-leader junk and
   fixes the ₹ sign (absent from the English model, misread as 3/7/¥/%) on
   low-confidence trailing prices. `parseMenuText()` then extracts
   `name … price` lines, name/price split across lines, `Rs.`/`/-` styles,
   decimals and ALL-CAPS names, skips headings/phone/tax lines and guesses
   the category from keywords (chai/coffee/juice → Tea, samosa/puff → Snacks,
   biryani/meals/dosa → Meal).
4. Everyone reviews before saving. Nothing changes until **Add N items**; each
   saved item is a normal `menu.upsert` intent (validated by the host, synced
   to everyone, blocked while the order is locked).

Footprint: ~7 MB downloaded once per device the first time the Menu tab is
opened, then cached for offline use. Photos are never stored or sent; they stay
in memory for the scan. Works best with a straight, well-lit photo of one
printed menu section. Handwritten boards and non-Latin scripts (e.g. Malayalam,
Hindi) are not recognised by the English model; adding a language means
vendoring its `*.traineddata.gz` and passing `'eng+mal'` to `createWorker`.

## Menu library (shared, volunteer-maintained)

Groups can **Pick from library** on the Menu tab: choose a city (remembered),
search a stall by name, preview its menu-board rows with a freshness chip, and
**Use this menu**. The data is a separate CC0 repository,
[`chaikadi-data`](https://github.com/tellmeY18/chaikadi-data), published as
static JSON at `https://data.chaikadi.fyi`.

- **Import:** creates a saved menu named after the stall, linked to its library
  ID and a snapshot of library prices, through the normal `menu.create` /
  `menu.upsert` intents so every peer receives it. Importing a stall that is
  already linked asks **Add missing items only** (keeps group prices) or
  **Replace items** (library prices; removes items the library lacks; same-name
  items keep their IDs so picks survive). Unavailable items are skipped. The
  library `Coffee` category maps to the app's `Tea` (drinks) category.
- **Freshness:** computed on the device from `last_confirmed` using the
  manifest thresholds (≤ 90 days “Confirmed N days ago”, ≤ 365 “Prices may be
  old”, otherwise “Not confirmed recently”). Every chip has an icon and words.
  Fictional sample stalls are labelled **Sample**.
- **Suggest an update:** if `SUGGEST_ENDPOINT` (in `js/config.js`) is set, a
  validated JSON body is POSTed (no credentials). Otherwise a prefilled
  GitHub *Update a menu* issue opens in a new tab. Payloads contain only the
  place ID, city, stall name, item names/categories/prices and today's date —
  never member names, group names, notes or picks.
- **After Finish round:** if the round's menu came from the library and its
  prices were changed, the orderer sees **Share these price updates?** with only
  the changed items. **Not now** is the primary button; nothing is ever sent
  automatically. Sample stalls never prompt.
- **Settings:** the library address can be changed per device (HTTPS only;
  `http://localhost` for development), with the CC0 attribution line.

### Offline, caching and integrity

`js/data.js` has no UI code. `loadManifest()`, `loadCityBundle(cityId)`,
`searchPlaces(cityId, query)` and `getPlace(id)` return cached IndexedDB data
immediately and revalidate in the background when online (requests use
`cache: 'reload'`, which also tells the service worker to go network-first).
Each city bundle is verified against the manifest `sha256` (Web Crypto). On a
mismatch the download is discarded and the last good copy kept. Never-cached
plus offline shows a clear empty state. All data is treated as untrusted:
response size caps, schema and pattern checks, unknown fields dropped, control
and bidi-override characters removed, text rendered only as escaped text.

The service worker runtime-caches `https://data.chaikadi.fyi` in the versioned
`chaikadi-data-v1` cache (stale-while-revalidate) and deletes unknown
`chaikadi-*` caches on activation. A custom library address is cached through
IndexedDB only.

**CORS:** GitHub Pages sends `Access-Control-Allow-Origin: *`. Check:

```sh
curl -sI -H "Origin: https://chaikadi.fyi" https://data.chaikadi.fyi/manifest.json | grep -i access-control
# In the browser console on https://chaikadi.fyi:
fetch('https://data.chaikadi.fyi/manifest.json', { credentials: 'omit' }).then(r => r.json()).then(console.log)
```

Data repo setup, deployment and the library test plan are in
[TEST_PLAN.md](TEST_PLAN.md#menu-library).

## Connections

### A. Room codes (default)

- The host creates a cryptographically random four-character code using
  `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no `0/O/1/I/L`).
- The host registers the PeerJS ID **`chaikadi-<ROOMCODE>`**. New-room registration
  collisions regenerate the code. A saved host whose ID is taken gets a clear
  message rather than silently abandoning the saved code.
- Joiners get transient PeerJS IDs and connect directly to that host.
- Public PeerJS cloud signaling exchanges SDP/ICE metadata. The configured
  public STUN servers help discover reachable addresses. No group, display
  name, picks, bill or history is sent through signaling messages.
- Once a WebRTC DataChannel opens, all application data is exchanged over that
  encrypted peer connection. Signaling may remain connected for new joins and
  reconnects; it never carries application state. With a configured TURN server,
  encrypted peer traffic may be relayed through TURN.
- Settings defaults use `0.peerjs.com:443`, path `/`, key `peerjs`, and Google /
  Twilio STUN. PeerJS's bundled default TURN configuration is **overridden** by
  the explicitly supplied STUN-only ICE list.
- Invalid/expired/unreachable codes, name conflicts and capacity errors produce
  human-readable messages. The manual pairing option is always available and
  highlighted when signaling fails.

### B. Manual pairing (no internet)

1. Both devices join the **same local Wi-Fi**. Internet access may be disabled.
   Both must have loaded/installed Chaikadi online beforehand.
2. Host chooses **Create offline · pair manually**, or uses an existing group.
3. Host opens **Add person manually → Create offer**. Wait for ICE gathering.
4. Joiner chooses **Join group**, enters a name, and taps **No internet? Pair
   manually**. Scan or paste the host's offer → **Create answer**.
5. Joiner shows/copies their answer. Host scans or pastes it → **Connect person**.
6. Wait for **Connected!** and the new online member. Close the panels. Repeat
   with a fresh offer for every additional person.

This uses raw `RTCPeerConnection({ iceServers: [] })`: no signaling, STUN or TURN
calls for the manual exchange. We wait for ICE gathering to finish, strip a few
irrelevant SDP lines, and use deflate compression where `CompressionStream`
exists. Uncompressed `CK1.n.…` text is the fallback; **Compatibility text** can
be selected when the receiving browser cannot decompress. `CK1.z.…` is deflated.

QR generation and camera decoding are local (`qrcode-generator`, `jsQR`), using
`getUserMedia`. No `BarcodeDetector`, Bluetooth, sharing API, or external QR
service. Codes over 1,500 characters use the **text-only fallback** instead of
an unreliable dense QR. Copy/paste can be transferred using any channel the
users already have, including chat, AirDrop or Nearby Share; the app does not
integrate with or invoke those services. Camera denial always leaves text input.

Manual SDP is valid only for the live pending connection. A refresh, closed
pending panel, or failed channel needs a **new offer and answer**. Keep the
pairing panels open until connected. A manual-only group's visible room code
becomes discoverable only when its host also registers with signaling.

### Reconnect, offline edits and authority

- The **host is the sole authoritative writer**; members send validated intents.
- The envelope is `{ type, payload, version, senderId }`. Intents add unique
  `id` and `roundId`. Full-state snapshots include a monotonic group version.
- A persistent random member ID and secret reconnect token authenticate the
  returning device. Tokens are transmitted only inside the peer channel; the
  host's credential table is never included in the shared state. Sender identity
  is bound to the channel, not trusted from a submitted payload.
- Four-character codes are convenient invitations, **not strong access control**.
  Anyone who knows/guesses a live code can join an available slot. Use this MVP
  for small trusted groups; do not store sensitive information in names/notes.
- Each accepted change is persisted before acknowledgement/broadcast. Item IDs,
  an acknowledged-intent window and monotonically increasing versions prevent
  duplicates. Round IDs reject stale picks/bills/finish commands.
- On members, edits made without the host are persisted in an outbox and shown
  as local pending changes. On reconnect, a full authoritative snapshot arrives
  and queued intents replay one by one. The host can reject them if the round
  finished, item was removed, privileges changed, or picks were locked. Rejected
  intents are removed with a visible message. Locks always win at the host.
- A heartbeat marks lost peers offline after about 25 seconds. Foregrounding
  triggers room-code reconnect and full sync. Manual channels cannot redo their
  handshake automatically; re-pair if disconnected. A room reconnect is also
  attempted if internet and the saved room code are available.
- Host offline means edits cannot become shared/authoritative. When the same
  host returns, its locally saved group resumes. **No host migration**.
- Dropping the internet does not require dropping a live local peer connection.
  A network-interface change (e.g. Wi-Fi to cellular) can still break WebRTC.

## Self-hosted signaling and TURN configuration

The documented hook is `js/config.js` → `DEFAULT_CONFIG`. Settings can override
it per device without changing deployed files. Example:

```json
{
  "signaling": {
    "host": "signal.example.com",
    "port": 443,
    "path": "/peerjs",
    "secure": true,
    "key": "peerjs"
  },
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    {
      "urls": ["turn:turn.example.com:3478", "turns:turn.example.com:5349"],
      "username": "issued-username",
      "credential": "issued-password"
    }
  ]
}
```

Paste `signaling` and `iceServers` into the separate JSON fields in Settings.
Use a **PeerServer-compatible** signaling service with HTTPS/WSS, correct
WebSocket proxying and origin configuration. A generic WebSocket server/worker
is not sufficient. All devices need the same signaling host/port/path/key.
Manual pairing deliberately ignores this config and always uses `iceServers: []`.
Changes affect new connections; use **Retry room connection** when ready.

TURN credentials shipped in static source or entered locally are visible to
that client. Use suitable quotas/short-lived credentials for a real deployment;
credential issuance needs a service you control. No such service is required
or shipped with this MVP.

## Persistence and limitations

- IndexedDB stores one transactional snapshot containing identity, config,
  group/menu/picks, history, outbox, and (host-only) reconnect credentials.
  If unavailable or a write fails, localStorage is used. A newer fallback
  snapshot wins on reload. Storage errors are visible; no false “saved” success.
- Browser eviction, private browsing restrictions, clearing site data, or losing
  the host device can lose data. JSON export includes private reconnect
  credentials: keep it private. Automated backup import is not in this MVP.
- One active group and one active app tab per device. Use separate browser
  profiles for multiple simulated people. Display names can be changed without
  changing member IDs. Removed members retain their local historical copy, but
  cannot reconnect as that revoked identity to the same group.
- A member with an old saved group is not silently moved into a different group
  that happens to reuse its room code. Leave explicitly to join the new group.
- Limits: 15 people, 20 saved menus with 200 items each, quantity 0–99, 160-character notes, 500
  pending offline changes per device, and a 2,000-intent deduplication window.
  Full peer snapshots are bounded to 4 MiB; very large multi-round histories
  require export and starting a fresh group. Data is never silently truncated.
- Room-code handshakes need brief internet access; manual pairing needs a
  shared local network and working local candidate resolution.
- Strict corporate networks, guest Wi-Fi isolation and symmetric NAT can block
  direct peer connections. A TURN server helps room mode; manual mode cannot
  bypass network isolation.
- Public PeerJS cloud is best-effort, rate-limited and outside our control.
- iOS suspends background tabs and may drop channels. Keep the host foregrounded;
  automatic room reconnect runs on return. No Wake Lock or platform-specific API.
- Some iOS versions obscure local ICE candidates with mDNS names that may not
  resolve on another device/network. The pairing panel includes a troubleshooting
  tip; try another shared Wi-Fi or room mode with internet.
- All members see the group’s picks, notes, costs and history. The host can edit
  its own saved state; this is coordination among friends, not an audit ledger.
- Currency is a label, with two decimals, not an exchange-rate conversion.
- The order is copied/placed externally, and Paid is bookkeeping, not a payment.

## Architecture / file tree

```text
chaikadi.fyi/
├── index.html                 SPA entry; only local scripts/styles
├── styles.css                 mobile-first, dark-mode, accessible tap targets
├── manifest.json              install metadata + PNG/maskable icons
├── sw.js                      atomic whole-shell precache; offline navigation
├── CNAME                      chaikadi.fyi for GitHub Pages
├── .nojekyll                  serve static files unchanged
├── .gitignore                 local tooling / generated test-output exclusions
├── flake.nix                  optional Node/Python development environment
├── flake.lock                 pinned Nix inputs
├── package.json               ES-module mode and dependency-free test command
├── README.md
├── DESIGN.md                  selected v0.2 brand and component rules
├── LICENSE                    AGPL-3.0
├── _headers                   Cloudflare cache / response headers
├── TEST_PLAN.md               laptop + iPhone + Android acceptance plan
├── fonts/
│   ├── courier-prime-400-latin.woff2
│   ├── courier-prime-700-latin.woff2
│   ├── noto-serif-malayalam.woff2
│   ├── Courier-Prime.OFL.txt
│   ├── Noto-Serif-Malayalam.OFL.txt
│   └── README.md
├── icons/
│   ├── icon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── maskable-512.png
│   └── apple-touch-icon.png
├── js/
│   ├── config.js              defaults, config hook, IDs and code validation
│   ├── state.js               pure reducer, totals, debt tally, persistence
│   ├── store.js               subscribed app store, protocol, offline outbox
│   ├── p2p.js                 framework-free PeerJS/raw WebRTC transport
│   ├── qr.js                  local generation and camera scan lifecycle
│   ├── ingest.js              menu photo -> items (on-device AI / OCR + parser)
│   ├── strings.js             English UI catalogue / Indian money formatting
│   ├── data.js                menu library client: SWR cache, sha256, sanitising
│   ├── library-ui.js          library sheet, freshness chips, import/suggest UI
│   ├── components.js          local SVG icons, sheets and four-box code input
│   ├── ui.js                  Preact + htm rendering; subscribes to store
│   └── main.js                boot, PWA registration, foreground reconnect
├── vendor/
│   ├── preact.module.js
│   ├── htm.module.js
│   ├── peerjs.min.js
│   ├── qrcode.js
│   ├── jsQR.js
│   ├── preact.LICENSE
│   ├── htm.LICENSE
│   ├── peerjs.LICENSE
│   ├── qrcode.LICENSE
│   ├── jsQR.LICENSE
│   ├── ocr/                   locally vendored WASM, worker and English model
│   └── README.md              pinned versions and provenance
├── tests/
│   ├── state.test.js          reducer, arithmetic, pairing codec, fallback
│   ├── protocol.test.js       authority, identity, replay and offline sync
│   ├── menus.test.js          multi-menu selection, migration and preservation
│   ├── design.test.js         contrast, font budget and money formatting
│   ├── design.mjs             theme, menu sheets and 200% text browser checks
│   ├── data.test.js           library cache-first, hash mismatch, offline, import
│   ├── library.mjs            library browser flow incl. opt-in share
│   ├── fixtures/data/         manifest + bundle copied from chaikadi-data build
│   ├── browser.mjs            optional real-browser / manual-WebRTC smoke
│   ├── room.mjs               optional public-cloud / room-reconnect smoke
│   ├── scan.mjs               optional real-browser menu-scan test
│   └── ingest.test.js         menu text parser / OCR cleanup unit tests
└── tools/
    ├── serve.py               local dev server (bigger connection queue)
    └── generate-icons.mjs     optional dependency-free icon utility
```

For new features, add a validated reducer intent, route it through the store,
then render it in the UI. Do not mutate shared state directly from components.
Private UI helpers (suggestion animation, draft fields, scanner) do not become
shared intents until the member accepts/saves them. IDs and timestamps are
provided to the reducer, keeping it deterministic and straightforward to test.

## Suggested next enhancements

1. Malayalam/Hindi/Tamil UI translations using the English string catalogue.
2. Self-hosted PeerServer-compatible signaling (or a compatible worker adapter).
3. Host migration with explicit authority epochs and conflict recovery.
4. Per-member payment reminders with opt-in sharing.
5. Shared favourites and importing/exporting menus across groups.
6. Order from history with unavailable-item and price-change review.

See [TEST_PLAN.md](TEST_PLAN.md) for the real-device acceptance checklist.

Bundled third-party code and data: Preact, htm, PeerJS, qrcode-generator,
jsQR, tesseract.js / tesseract.js-core and the Tesseract English model (all
MIT or Apache-2.0).

## License

Copyright © 2026 Vysakh Premkumar.

Chaikadi is free software: you can redistribute it and/or modify it under the
terms of the **GNU Affero General Public License, version 3** only, as published
by the Free Software Foundation. See [LICENSE](LICENSE).

Under AGPL §13, if you run a modified version for others over a network, you
must offer them its source. The app footer links to this repository; point it
at your fork if you deploy modifications.

The files in `vendor/` are third-party libraries under their own licenses
(MIT and Apache-2.0, see `vendor/README.md` and the `*.LICENSE` files there).
Both are compatible with AGPL-3.0 when combined in this work.

Fonts in `fonts/` are separately licensed under SIL OFL 1.1. Their complete
copyright and license notices are distributed alongside the local WOFF2 files.
