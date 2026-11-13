# Chaikadi · UI accessibility and readability report

Scope: all 24 captured screens in `design/chaikadi-screens.figcraft` (390 × 844), `styles.css`, `js/strings.js`, `js/ui.js`, `js/components.js`, `DESIGN.md`.
Brief: readability first, fewer words, B/W wireframe base with semantic crayon highlights, two themes (white / pitch black), receipt that feels like paper, remove "pair without internet".

---

## Decisions (13 Nov)

1. UI font: Atkinson Hyperlegible Mono. Courier Prime stays for receipts and the wordmark rule only.
2. Menu and My picks: no green button; the bottom tabs are the navigation. (Preview shows this.)
3. Receipt: **every character is ink black (`#111111`)**, no grey. "PAID" is an ink stamp.
4. Dark-mode receipt: dimmed paper `#EDE7D6` (ink 14:1 at `#1A1A1A`; `#111` is higher).
5. Preview lives on the **Redesign v0.3** page of `chaikadi-screens.figcraft`. No code has been changed.
6. Preview fonts are in `design/preview-fonts/` (load them with Text ▸ Load font if the file shows a fallback font).

---

## 1. Verdict

The app is **not failing WCAG on contrast**. Measured ratios are fine. It is hard to *read and use* because of choices made for looks:

1. A thin typewriter face (Courier Prime 400) is used for **everything**, including sentences, at 12–14 px in grey.
2. **Too much text.** About 1,500 words in the string catalogue. Home alone shows ≈42 words, Group ≈52.
3. **The same thing shown 2–3 times:** tagline (title + footer), room code (header chip + plate + QR), online status (header count + every person), category (heading + every row).
4. **Developer features in the main UI:** pairing offers/answers, signalling/ICE JSON, library URL, "Offline app ready".
5. **Decoration doing the job of meaning:** 6 avatar border styles, 3 chip border styles, double/dashed/dotted rules.
6. **The receipt is just another bordered box.** It does not feel like paper.

None of this needs a redesign. It needs removal, a calmer type system, and the colour rules you wrote applied consistently.

### Ten changes, in order of impact

| # | Change | Why |
|---|---|---|
| 1 | Remove "Pair without internet" everywhere (4 entry points, 1 sheet, 46 string keys, connection settings) | Complexity with no payoff; biggest word and clutter cut |
| 2 | Use a readable mono for UI (Atkinson Hyperlegible Mono); keep Courier Prime **only** for receipts and the wordmark | Readability; 0/O, 1/I/l and U/V are unambiguous, which matters for room codes |
| 3 | Raise the type floor: body 18, secondary 16, nothing below 14; stop using grey for needed instructions | 12 px grey mono is the weakest text in the app |
| 4 | Apply the crayon rules strictly, with one green CTA per screen | Colour becomes a guide, not decoration |
| 5 | Light = `#FFF` page, `#000` ink. Dark = `#000` page, `#FFF` ink. Receipt never inverts | Your two themes; maximum contrast |
| 6 | Receipt as paper: warm stock, perforated edges, soft lift, stamp for "Paid" | Physical feel; it is the one place decoration is allowed |
| 7 | Cut copy ≈60% (see §8) | Clear at a glance |
| 8 | Delete repeated elements: footer, install hint on every tab, per-row category, double room code | Less noise |
| 9 | Replace Theme `<select>` with a 2-option toggle; drop "Follow system" | Your 2-theme rule |
| 10 | Fix focus-behind-nav, toast duration, Malayalam `lang`, "Not paid" that looks disabled | The real WCAG-adjacent gaps |

---

## 2. Method and limits

- Reviewed screenshots, CSS, strings and component code. Contrast ratios computed with the WCAG formula (§3), not by eye.
- **Not done:** keyboard, VoiceOver/TalkBack or real-device testing. Items marked *verify* need a live check.
- The FigCraft file is flattened screenshots with hotspots, so layer cleanup and spacing audit had nothing to act on. Spacing was checked in CSS instead: it is on the 4/8 scale throughout.
- Nothing was changed in the FigCraft file or the code. This is a report only.

---

## 3. Measured contrast

| Pair | Ratio | Result |
|---|---|---|
| Light: ink `#111` on paper `#F7F7F7` | 17.6 | Pass |
| Light: muted `#595959` on paper (12–14 px helper, tabs, captions) | 6.5 | Pass AA, but small thin text feels weaker than the number |
| Light: muted on selected-row tint | 6.0 | Pass |
| Light: divider/leader `#BDBDBD` on paper | **1.75** | Decorative only; fails if a divider is needed to see structure |
| Dark: ink `#F2F2F2` on `#0A0A0A` | 17.7 | Pass |
| Dark: muted `#A3A3A3` on paper | 7.9 | Pass |
| Dark: divider `#3A3A3A` on paper / surface | **1.74 / 1.59** | Nearly invisible |
| Light: paper vs surface card (`#F7F7F7` vs `#FFF`) | 1.07 | Card edge relies on a 1 px border |
| Selected row tint vs paper | 1.09 | Row selection carried by the 4 px edge (good), not tint |

**Proposed values**

| Pair | Ratio |
|---|---|
| Light: `#000` on `#FFF` | 21.0 |
| Light: muted `#4D4D4D` on `#FFF` | 8.5 |
| Light: divider `#8C8C8C` on `#FFF` | 3.4 |
| Dark: `#FFF` on `#000` | 21.0 |
| Dark: muted `#B8B8B8` on `#000` | 10.6 |
| Dark: divider `#767676` on `#000` | 4.6 |
| Receipt ink `#1A1A1A` on paper `#FBF6E9` | 16.1 |
| Receipt muted `#595959` on paper | 6.5 |
| Receipt ink on dimmed dark-mode paper `#EDE7D6` | 14.1 |
| Ink `#111` on crayon yellow `#FFE066` / blue `#9FCBFF` / green `#A7E3A0` | 14.5 / 11.2 / 12.7 |

Crayon fills against the page are only 1.3–1.7:1 on white (16.1 on black for yellow). So **a crayon fill can never be the only boundary**: it always keeps the 2 px ink border and a text label.

---

## 4. Findings

🔴 Blocking · 🟠 Important · 🟡 Polish. "WCAG" is shown only where a criterion applies.

### 4.1 Global

| | Where | Problem | Fix |
|---|---|---|---|
| 🟠 | Whole app | Courier Prime 400 has thin strokes and a typewriter look; running sentences are tiring to read at 16 px, about 36 characters per line | Atkinson Hyperlegible Mono 400/700 for UI. Courier Prime only for receipt text and the wordmark |
| 🟠 | Tabs, role tags, chips, captions, footer, item category, notes | 12 px text (`.75rem`) in grey | Floor 14 px, and only for non-essential text. Tab labels 14 px bold |
| 🟠 | Helper lines ("Share the code. Keep the host's app open.", "Save a menu for each stall…") | Needed instructions styled as faint grey | Cut or promote to ink. If it is needed, it is not muted |
| 🟠 | Footer on every screen | Tagline repeated, source link, "Offline app ready" | Remove from the tabs. Keep source link in Settings only |
| 🟠 | "Add to home screen ▸ Got it" on every tab | Disclosure plus a dismiss link in one row; shown repeatedly | Show once on Home. Remove from tabs. Dismiss permanently |
| 🟠 | `.bottom-nav` fixed, `main` has padding but no `scroll-padding-bottom` | Focused controls can sit behind the bar when tabbing (**WCAG 2.4.11**, *verify*) | `html { scroll-padding-bottom: 96px }` |
| 🟠 | Toast, 3 s | Confirmation like "8 added." disappears fast and covers list rows | 6 s, tap to dismiss, sits above the nav without overlapping content |
| 🟡 | User-entered Malayalam names/notes | No `lang="ml"` on those spans (**WCAG 3.1.2**) | Add per element when script is Malayalam |
| 🟡 | Dividers 1.75 / 1.74 | Row separation nearly invisible in dark | `#8C8C8C` light, `#767676` dark |
| 🟡 | DESIGN.md "no distressing, grain, shadows" | Conflicts with the paper receipt | Allow, **receipt and crayon only** |

**Strengths to keep:** 2 px ink borders and 3 px focus ring on every control; 44–48 px touch targets; sheets are native `<dialog>` with focus containment and Escape; `prefers-reduced-motion` honoured; room code alphabet drops 0/O/1/I/L; status is never colour-only; page `lang`, skip link and zoom are not blocked.

### 4.2 Screen by screen

| Screen | Sev | Problem | Fix |
|---|---|---|---|
| **01 Home** | 🟠 | ≈42 words. Tagline appears as the title **and** the footer. Subtitle is a 10-word grey sentence | Wordmark, one line max, two buttons |
| | 🟠 | "Pair without internet" has the same weight as real choices | Delete |
| | 🟠 | "Group and display names ▸" hides fields, but the values ("The Vada Circle / Clever Falcon") show underneath **without labels** | Show one editable line "Your name" with the dice button. Group name is auto-set; edit later in Group |
| **03 Join** | 🟠 | Back is a centred link floating mid-page. Hint "We'll join when the code is complete" plus a Join button is redundant | Back in the top-left. One hint or none; keep the button |
| | 🟡 | 4 boxes are a good pattern, and large | Keep. Yellow fill appears once the code is complete |
| **04/05 Group** | 🟠 | Room code appears **three times** (header chip, plate, QR) | One place: the plate. The header shows only the group name and an online dot |
| | 🟠 | Big solid black plate with double inset rules is decoration; in dark it becomes a white slab | White card, 2 px border, code on a **yellow crayon** strip |
| | 🟠 | "● 2 on" in the header is cryptic; "● Online" repeats per person | Header: dot + number. People list: green dot **only when online**, no word |
| | 🟠 | 6 avatar treatments (solid, grey, double, dashed…) with no meaning | One initial in a 2 px ink square |
| | 🟠 | "Edit" disclosure triangle beside a person is ambiguous | `⋯` button opening a sheet (Make orderer / Remove) |
| | 🟡 | Role tags are 12 px outlined | 14 px, **green crayon** fill for Host and Orderer |
| **09 Menu** | 🟠 | 5 actions plus the menu chip compete (New menu, Edit items, Snap a menu, Add item, Pick from library) | One "+" opening a sheet (Add item / Snap / Library / New menu). Edit becomes a pen on the list |
| | 🟠 | Toast covers the third row | See 4.1 |
| | 🟡 | Menu chip text and "8 items · ✓ This round's menu" repeat the same fact | Chip with ✓ only |
| **13 My picks** | 🟠 | Category ("Tea") repeated in grey 12 px under every row | Remove. Group by heading as the Menu does, or drop it |
| | 🟡 | "Can't decide?" is a small underlined link with an icon | Keep the dice, label it "Surprise me", 16 px |
| | 🟡 | Disabled minus uses a dotted 1 px border | Fine (exempt). Keep a clear disabled style |
| **16/17 Order** | 🟠 | 3-line helper under the buttons ("Copy the order and place it with your shop…") | Delete. The button label says it |
| | 🟠 | "Copy order as text" is outbound sharing, styled like any button | **Blue crayon** |
| | 🟡 | "Order locked." appears twice in the sheet (header and heading) plus an icon | One title, tumbler icon, "Done" |
| **18 Costs** | 🟠 | `[ ] Not paid` is 14 px grey with a 1 px border: it **looks disabled** but is the main action | 16 px bold, 2 px border, "Paid" → ink stamp on the receipt line |
| | 🟡 | "Orderer's own share" caption is a sentence for one row | Green "Orderer" tag already says it; remove the caption |
| **07/08 Library** | 🟠 | Three chip border styles (solid, dashed, double) plus a "Sample" dashed tag, all 12 px | Show a chip **only** when something is wrong ("Old prices"). Fresh = nothing |
| **10–12, 14 Sheets** | 🟡 | Sheet titles and buttons are fine | Keep structure, shorten labels |
| **20 History** | 🟡 | Each round is a bordered `<details>` | Render each round as a small receipt (§7) |
| **21 Settings** | 🟠 | Version, "Check for updates", library URL + Save, Theme select, signalling JSON, ICE JSON, export, leave | See §6. Down to Theme, Name, Currency, Export, Leave |
| **22 Pair** | 🔴 | Offer QR and a Base64 blob; two-step offer/answer flow | **Delete** (§6) |
| **23 Dark** | 🟠 | Paper is `#0A0A0A`, not pitch black; header inverts to a light bar | Pitch black page, white ink; header is the page colour with a 2 px bottom rule |
| **24 App menu** | 🟠 | "Pair without internet" wraps to 3 lines; menu is a 2×2 grid of heavy boxes | Plain list: Group, History, Settings |

---

## 5. Colour system: your rules, checked

### 5.1 Verdict on the rules

The three crayon meanings are sound: a **small, closed vocabulary** (one colour = one meaning) works for people with colour-vision deficiency **as long as text or a shape always repeats the meaning**. Your spec already does that (dot + word, role word, button label). Keep that line: **crayon never carries meaning alone.**

Conflicts and gaps I found, with decisions:

| Situation | Decision |
|---|---|
| Room code is shown in 3 places | Yellow **only** on the plate (and the join boxes once complete). Remove the header chip. Otherwise yellow stops standing out |
| "Share link" / "Show QR" are blue, but "Copy order as text" and "Suggest an update" are also outbound | **Blue** for all outbound/external actions |
| "Scan QR" on Join is connectivity | **Blue**. It is the sibling of Show QR |
| More than one dark primary button per screen (e.g. Snap a menu + Lock order) | **One green CTA per screen.** Everything else is outlined |
| Screens with no forward action (Menu, My picks) | **No green button.** The tab bar is the navigation. Less to read |
| Paid/not paid | Stays **uncoloured**. A black ink **stamp** ("PAID", slightly tilted) on the receipt line |
| Errors and warnings | **No colour.** Alert icon + visually-hidden "Error" + 6 px left bar (keeps `role="alert"`) |
| Destructive actions | Dashed outline, no colour (current rule is good) |
| Selected pick row, active tab | Uncoloured: 4 px ink edge / 3 px top bar + bold + check |

### 5.2 Where every crayon goes

| Screen | 🟨 Yellow | 🟦 Blue | 🟩 Green |
|---|---|---|---|
| Home | none | none | **Create group** |
| Join | code boxes once complete | **Scan QR** | **Join** |
| Group | **Room code plate** | **Share link**, **Show QR** | Host/Orderer tags, online dots, **Go to menu** |
| Menu | none | none | none |
| My picks | none | none | none |
| Order | none | **Copy order** | **Lock order** |
| Costs | none | none | **Finish round** |
| Library / suggest | none | **Suggest an update** | **Use this menu** |
| History | none | none | none |
| Settings | none | **Export backup** | none |

Result: most screens carry **0–1 crayon accents**, so they read as anchors.

### 5.3 How the crayon should look and stay readable

- Fill: `#FFE066` yellow, `#9FCBFF` blue, `#A7E3A0` green. Text on them is **always `#111`** in both themes (11–14:1).
- Shape: slightly irregular edge (hand-coloured), faint streaks at ≈3°. Keep texture variance to about ±4% luminance so text contrast stays ≥10:1 at worst.
- Always keep the 2 px ink border and the text label. A crayon fill vs the page is only 1.3–1.7:1.
- Texture as one tiny reusable SVG/PNG mask (a few KB), not per-element images.
- Dark theme: same crayon fills, black text. They glow against pitch black (12–16:1).

---

## 6. Remove "Pair without internet"

Remove manual (offer/answer, compatibility text) pairing. Keep PeerJS room codes only.

**UI to delete**
- Home create form: "Pair without internet" link. Join form: same.
- Group: "Pair without internet" in the actions stack.
- App menu: "Pair without internet" button.
- Pairing sheet (`Pairing` in `js/ui.js`): offer/answer steps, QR, "Pairing text", "Compatibility text", camera scan for pairing, "Pairing not working?" tips.
- Settings: **Connection settings** (PeerJS signalling JSON, ICE servers JSON). Show defaults only.
- Settings: "Install and offline help" paragraph.
- Footer "Offline app ready / Preparing offline app…", update banner line "people connected by manual pairing will need to pair again".
- Error text: "…or pair without internet" (`hostUnreachable`, `codeUnavailable`).

**Code to delete** (inventory, not done)
- `js/p2p.js`: `encodePairing`, `decodePairing`, `compatibilityPairing`, `makeOffer`, `makeAnswer`, `acceptAnswer`, `cancelManual`, the `manual` link mode and `onManualRequired`.
- `js/store.js`: `showManual`, `closeManual`, `offer`, `pair`, `compatibility`, `manualHint`, `manualOnly` arguments of `create()`/`join()`, `link.mode === 'manual'` branches and their status strings.
- `js/strings.js`: **46 keys** (pairing, offer/answer, compatibility, connection settings, offline help, `updateManual`, `pairHelp`).
- Tests/docs to update: `tests/browser.mjs`, `tests/state.test.js`, `README.md`, `TEST_PLAN.md`, `DESIGN.md` (all mention manual pairing).

**Keep**
- `drawQR` and `scanQR` (`js/qr.js`, `vendor/qrcode.js`, `vendor/jsQR.js`): Show QR and Scan QR for room links still work.
- Service worker caching and local saved data. This is invisible to users. Only the **words** about offline go away (assumption: you meant the pairing feature, not the PWA cache; tell me if you want the cache gone too).

**What users see when the host is offline:** one line and one button. "Host is offline" + Retry. Picks still save locally and sync on return, as now.

---

## 7. Receipt as paper

Receipt text stays exactly as is (Courier Prime, "Estimated total", "x 2", leaders, double rule, "Grand total").

| Layer | Spec |
|---|---|
| Stock | `#FBF6E9` paper (ink `#1A1A1A` 16.1:1, muted `#595959` 6.5:1). Faint fibre noise at ≤3% opacity under text only |
| Edges | Perforated/zig-zag top and bottom (CSS `mask` or small SVG). Sides straight |
| Lift | Two-layer soft shadow so it sits on the page. White page: needed (paper vs white is only 1.08:1). Black page: not needed (19.5:1) |
| Angle | 0°. A tilt hurts reading; only the stamp tilts (≈-3°) |
| Light theme | Cream slip on white page |
| Dark theme | **Does not invert.** Cream slip on pitch black. Option: dim to `#EDE7D6` to cut glare (ink 14.1:1) |
| Header | Group name, date/time, **order number** (yellow only if it must be read aloud to the shop) |
| Totals | Double rule, large total (Courier Prime bold 28–32 px) |
| Paid | Black **ink stamp** "PAID", tilted, on the person's line. Word + shape, so no colour needed |
| Where | Order, Costs ("who owes what"), each History round, and the copied text version |
| Motion | Optional: "print out" slide, 300 ms, disabled under reduced motion |

Rule changes in `DESIGN.md`: allow shadow, texture and edge cuts **only** on the receipt and crayon fills. Everything else stays flat.

---

## 8. Less text

Principle: icon + one word, or one word. No sentence if the screen already explains itself.

| Where | Now | Proposed |
|---|---|---|
| Home subtitle | "A shared order. One person pays. Everyone knows their share." | *(delete; title is enough)* |
| Home names | "Group and display names" | "Your name" (+ dice) |
| Home actions | "Create a group" / "Join with a code" | "Create" / "Join" |
| Footer | "Decide, order, split." + source + "Offline app ready" | *(delete)* |
| Group status | "2/15 people · Picks are open." | "2 people" |
| Invite hint | "Share the code. Keep the host's app open." | *(delete)* |
| Menu intro | "Save a menu for each stall. Choose one for this round." | *(delete)* |
| Menu status | "8 items · ✓ This round's menu" | ✓ on the chip |
| Picks | "From Sample Chai Corner, Kaloor" | *(delete; the menu is already shown)* |
| Order help | "Copy the order and place it with your shop. Chaikadi does not send orders or take payments." | *(delete)* |
| Order buttons | "Copy order as text" / "Lock order" | "Copy" / "Lock" |
| Locked | "Order locked. No more changes until the orderer unlocks." | "Order locked" |
| Costs | "Who owes what" | "Owes" |
| History | "Outstanding across rounds" | "Unpaid" |
| Errors | "Error: …" + alert icon | Icon + hidden "Error" + the message |
| Settings theme | "Follow system / Light / Dark" select | Light / Dark toggle |
| Library chip | "Confirmed 11 days ago" | *(nothing)*; "Old prices" only if old |
| Install | "Add to home screen ▸ Got it" every tab | Once, on Home |

Target: Home ≤ 12 words, Group ≤ 25, Menu ≤ 20 (excluding item names). Never remove: money amounts, names, the room code, anything that prevents a wrong action (delete, lock, unlock, leave still say what happens, in one short line).

---

## 9. Type and themes

**Type**

| Role | Spec |
|---|---|
| UI font | Atkinson Hyperlegible Mono 400 / 700 (OFL, designed for low-vision legibility; confirmed OFL-1.1 and Braille Institute source). Check the latin WOFF2 size against the 150 KB font budget |
| Receipt + wordmark | Courier Prime (kept) |
| Body | 18 / 28 |
| Secondary | 16 / 24 |
| Minimum | 14 / 20, non-essential only |
| Title | 28–32 / 36 |
| Amounts | 18 bold, tabular, right-aligned |
| Room code | 48–56 bold, letter-spaced, yellow strip behind |
| Colour of text | Ink for anything needed. Muted only for truly optional text |

**Themes**

| Token | Light | Dark |
|---|---|---|
| Page | `#FFFFFF` | `#000000` |
| Ink / borders | `#000000` | `#FFFFFF` |
| Muted | `#4D4D4D` | `#B8B8B8` |
| Divider | `#8C8C8C` | `#767676` |
| Card | page colour + 2 px ink border | page colour + 2 px ink border |
| Receipt | `#FBF6E9` | `#FBF6E9` (or `#EDE7D6`) |
| Crayons | same in both | same in both, text `#111` |

Remove `--paper`/`--surface`/`--tint`/"Follow system". Set the theme-color meta and manifest `background_color` to match (`#FFFFFF` / `#000000`, swap with the theme).

---

## 10. Plan

| Step | Work | Effort |
|---|---|---|
| 1 | Remove manual pairing, connection settings, offline copy (+ tests, docs) | M |
| 2 | Tokens and themes (light/dark, crayon, type scale), font swap | S–M |
| 3 | Screen pass: Home, Join, Group (plate, people, header) | M |
| 4 | Menu, Picks, Order, Costs, History (actions, copy, stamp) | M |
| 5 | Receipt component (paper, edges, stamp) and reuse in History | M |
| 6 | Accessibility fixes (scroll-padding, toast, `lang="ml"`, focus order, "Paid" button) | S |
| 7 | Re-capture screens (`tools/capture-screens.mjs`), update `DESIGN.md`, re-run this review live with keyboard and screen reader | S |

---

## 11. Open questions

1. **Offline:** only the pairing feature goes; the installed-app cache and saved data stay? (Assumed yes.)
2. **Font:** OK to replace Courier Prime with Atkinson Hyperlegible Mono for UI, keeping Courier only for receipts? This is the biggest readability win and the biggest visual change.
3. **Menu and Picks without a green button:** accepted (tabs navigate)? Or add "Next" on Picks?
4. **Paid/not paid:** black ink stamp (my recommendation) or green "active status"?
5. **Group name editing:** move off Home (auto-named, editable in Group)?
6. **Dark receipt:** full cream or dimmed `#EDE7D6`?
7. **Library "Sample" tag and freshness chips:** drop unless stale?
