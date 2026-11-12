# Manual acceptance test · 1 iPhone + 1 Android + 1 laptop

Record device models, OS/browser versions, deployment URL, date, and results.
The laptop can serve as the host and use DevTools. Repeat the lifecycle tests
with the **iPhone as host**, since its background suspension is important.

## Preparation

- Deploy the complete directory at `https://chaikadi.fyi` with HTTPS enabled.
- Use Safari 16+ on iPhone, Chrome on Android, and a recent laptop browser.
- Start with separate clean browser profiles/site data on each device. Do not
  open multiple Chaikadi tabs sharing a profile while testing.
- Visit online on all three devices. Wait for **Offline app ready**.
- Confirm all scripts, icons and styles load from the same origin. The only
  external connection endpoints should be configured PeerJS and ICE servers;
  no CDN, analytics, remote fonts or remote QR requests.
- Install on both phones. Verify name **Chaikadi**, tea-cup icon, standalone
  launch, sensible portrait layout, light/dark mode and keyboard usability.
- Use the installed app consistently after this step. If browser and installed
  app storage differ on iPhone, create the test group in the installed app.

## 1. Create/join by code, link and QR

1. Laptop: create `4 PM crew`, name `Anu`. Verify a four-character code that
   contains no `0/O/1/I/L`, invite link and QR, host badge and orderer badge.
2. iPhone: Join → type code → name `Bala`. Both devices show two online members.
3. Android: open copied link / scan room QR → name `Chitra`. All see three people.
4. Verify the app does not show/need an account, email, password or local hotspot.
5. Test a malformed code, then a valid-format unused code. Expect actionable
   invalid/unreachable messages, retry behavior and manual pairing option.
6. In a separate temporary laptop profile, try joining as `bala`. Expect a name
   conflict. Change to `Dev`, retry, and confirm successful join. Remove Dev.
7. On a throwaway group, open the same host's saved group in a duplicate tab.
   Expect a room-ID collision message, not two authoritative live hosts. Close
   the duplicate immediately. For deterministic new-room collision testing,
   register a fixed code in a mocked PeerJS harness and emit `unavailable-id`;
   expect regeneration before the new room is shared.

## 2. Shared menu, picks and permissions

1. Laptop: tap **Add tea-break presets**. Verify exactly nine named presets,
   prices ₹0, and editable categories. Tap again; no duplicate preset names.
2. iPhone: edit Chai to ₹10. Android: edit Samosa to ₹20. All devices converge.
3. Add a custom item in Other, edit it and delete it from a different device.
   Pick it before deletion; verify deletion removes those current picks too.
4. Anu picks 1 Chai, Bala picks 1 Samosa, Chitra picks nothing.
5. Bala enters `extra chutney` and taps **Save note**. Verify it in the order
   breakdown on all devices and after a refresh.
6. Test +/−, quantity 0 removing a pick, max 99, invalid negative/decimal prices,
   and long names/notes. No negative quantity or invalid price is stored.
7. Use **Surprise me**, re-roll and accept. Only that member gains quantity 1;
   other members' picks never change. Restore picks to the ₹10/₹20 fixture.
8. Group → host makes Bala orderer. Only Bala sees **Lock & place order**.
   Non-hosts cannot remove members or reassign the orderer.

## 2b. Menu scanning

1. Online, open Menu once on each phone (downloads the reader, ~7 MB).
2. iPhone: **Take photo** → opens the rear camera → snap a real printed menu
   (tea shop board, laminated card). Review list appears in a few seconds.
   Verify names/prices, untick wrong rows, fix one price, change one category.
   **Add N items** → items appear on all devices.
3. Android: **Choose photo** from the gallery; same checks. Re-scan the same
   menu: rows show “Already on menu — price will update”, no duplicates.
4. Airplane mode (Wi-Fi off), reopen the app, scan again: still works.
5. Lock the order: scan buttons are disabled.
6. Try a blurry/angled photo and a handwritten board: expect few/no items and a
   clear hint, never a crash. Record accuracy (items found / items on menu).
7. Laptop Chrome with built-in AI enabled and the model downloaded: review
   note says “Read with on-device AI”. Everywhere else: “on-device OCR”.

## 3. Lock/unlock and copy order

1. Bala: Order → Copy order as text. Paste into Notes or a chat draft. It should
   contain consolidated quantities, names, per-person notes, ₹30 total and Bala
   as orderer. It must not send anything to a shop automatically.
2. Bala locks. All devices show locked; menu/pick controls are disabled. Non-
   orderers cannot unlock. Confirm prices cannot drift under a locked bill.
3. Bala unlocks. Picks become editable. Lock again and enter a test bill, mark a
   payment, then unlock: bill and payment marks clear; picks remain.

## 4. Bill split and payments

Use Anu = ₹10 in picks; Bala = ₹20; Chitra = no picks. Bala is orderer.

1. Lock and enter actual ₹36, equal **difference**. Expected final shares:
   **Anu ₹13, Bala ₹23, Chitra ₹0**, total ₹36.
2. Save proportional. Expected **Anu ₹12, Bala ₹24, Chitra ₹0**.
3. Test ₹30.01 and confirm displayed shares add to precisely ₹30.01.
4. Test discounted actual ₹5 with equal difference. No negative share; total ₹5.
5. Restore ₹36 equal; mark Anu Paid. Everyone sees Paid. Toggle Not paid.
6. Test that only the orderer can change bill/payment fields.
7. In another round, zero-price picks plus a ₹10 bill must split without NaN,
   division by zero or lost cents. A person with no picks owes zero.

## 5. Finish round, history and running debt

1. Leave Anu Not paid on the ₹36 equal fixture. Bala finishes the round.
2. All devices: picks empty, status open, menu/members/orderer retained.
3. History: archived date, picks/notes/menu prices, estimated ₹30, actual ₹36,
   equal split and payment marks. Outstanding **Anu → Bala ₹13**.
4. Change current menu prices and display names. Archived snapshot stays intact.
5. Bala marks Anu Paid in History. Outstanding balance becomes zero everywhere.
6. Complete another unpaid round with a different orderer. Verify debts go to
   each round's actual orderer; currencies are not added together if changed.
7. Refresh/close/reopen each device. History/menu/group and identity remain.

## 6. Drop/rejoin, host suspension, offline conflicts

1. With phones and laptop connected, turn **internet uplink off while keeping
   the Wi-Fi LAN active**. Existing local DataChannels should keep syncing.
   If peers used different networks, losing that path can legitimately drop them.
2. Disconnect Bala's Wi-Fi. Other devices show Bala offline within ~25 seconds.
   Bala still sees saved state and a host-offline banner; local edits are pending.
3. Edit Bala's picks offline, then refresh while still offline. Verify pending
   picks and notes persist. Restore internet/Wi-Fi; same name/identity reconnects
   and host-accepted edits converge without duplicate quantities.
4. Repeat but lock the order from the orderer while Bala is offline. Bala's
   pending pick must be rejected on reconnect with a visible message and the
   locked authoritative state restored.
5. Repeat with an offline change followed by the host finishing the old round.
   Old-round picks must not leak into the new round.
6. Host: background/lock the phone long enough for suspension. Members show
   **Host offline** rather than choosing a replacement host. Bring the host
   foreground; saved group resumes and full sync occurs.
7. Force-close/reopen the host. Group, menu, history and versioned state return.
   Members reconnect with the saved room code. No duplicate member entries.
8. Host removes a member while open; that member cannot keep editing/rejoin
   with its revoked identity. Historical debts and snapshots remain.

## 7. Manual pairing with internet off

Use all three devices on **one Wi-Fi LAN with its WAN disconnected**. Disable
cellular data on both phones, but leave Wi-Fi on. Precache before this test.

1. Start a fresh local-only group on laptop with **Create offline · pair manually**.
2. Host → Add person manually → Create offer. Wait until gathering completes;
   do not accept partial candidates. Offer appears as QR and copyable text.
3. iPhone → Join, enter name → No internet? Pair manually → allow camera, scan
   offer → Create answer. Hold iPhone answer QR up to laptop camera; host scans
   and connects. If no laptop camera, use copy/paste text instead.
4. Both show Connected and online member. Close panels and edit menu/picks on
   both; verify bidirectional state flow with WAN/cellular still disabled.
5. Repeat a fresh offer for Android. Do not reuse the iPhone's offer or answer.
6. Deny camera permission; verify copy/paste still pairs successfully. Try
   Compatibility text; oversized codes display a clear text-only fallback.
7. Paste corrupted text, an answer from an old offer, and a room-link QR where
   an SDP offer belongs. Errors should be readable inside the pairing panel.
8. Close an unconnected pairing panel; camera LED should turn off and pending
   connection should be canceled. Reopen with a fresh offer.
9. Refresh a manually connected member. Saved data survives; show host offline.
   With internet still off, re-pair manually. Same member identity/picks return.
10. Repeat with **iPhone as host**, Android and laptop as joiners. If mDNS or
    guest-network isolation prevents connection, confirm the troubleshooting tip
    and record device/network details. Try a non-isolated shared Wi-Fi network.

## 8. PWA storage, service worker and configuration

1. After an online visit, close all app windows, disable internet, launch the
   installed app, and reload `/?room=ABCD`. Shell and saved data must still open.
2. DevTools → Application: confirm manifest icons, service worker control and
   complete cached shell. No missing local vendor files on offline reload.
3. Edit host menu/picks and complete a bill/round entirely offline. Restart;
   state and history persist. Members work locally with visible pending state.
4. Test IndexedDB denial/failure with browser debugging or a test stub. Verify
   localStorage fallback on reload. Simulate both stores full/disabled: show a
   persistent storage warning and do not claim changes are durably saved.
5. Export JSON and inspect identity/state/history/outbox. Keep private. Clearing
   group data requires confirmation; no silent clearing during refresh.
6. Settings: enter invalid JSON and invalid server/ICE formats; readable errors.
   Configure a controlled PeerServer on all devices, retry, and connect. If a
   TURN service is available, test across networks requiring relay and inspect
   the selected ICE candidate pair. Manual mode must still use an empty ICE list.
7. Deploy a new shell with a bumped service-worker cache version during a round.
   Current session must not reload. Close all windows and reopen; update applies
   with existing saved group/history intact.
8. Test 320px width, 200% zoom, VoiceOver/TalkBack labels for quantity buttons,
   keyboard focus, dark mode and reduced-motion preference.

## Evidence / release record

- Record pass/fail for each section and keep screenshots of the room, locked
  order, exact bill split and offline-relaunch state.
- Automated reducer/protocol checks do not replace physical iOS/Android camera,
  installation, background suspension and local mDNS/network checks.
- Note public signaling failures separately from application failures. Re-run
  with manual pairing or a known-good PeerServer to isolate network causes.
