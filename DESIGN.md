# Chaikadi design · v0.4

**Branding source of truth: https://brand.letsimpl.fyi.** Chaikadi defines no
colour, font, size, spacing or component style of its own. Tokens, fonts, base
CSS and `ls-` components are vendored into `brand/` and loaded before
`styles.css`. This file only records what is specific to the product.

- Update the brand: `npm run brand` (fetches the files, writes `brand/brand.json`).
  `npm run brand:check` fails if `brand/` is behind the live site. Never edit `brand/` by hand.
- Rules we follow (from the brand's llms.txt): black and white only; the four status
  fills (danger, warning, success, info) are the only colour, always with an icon or
  word; text on a fill is `#111111`; square corners, 2px ink borders, no shadows,
  gradients or hatch; 16px minimum read text; 44px touch targets; 3px focus outline;
  no third-party requests; honour colour scheme and reduced motion.
- The identity kit comes from the brand repo (letsimplfyi/brand, `assets/chaikadi/`,
  https://brand.letsimpl.fyi/assets/chaikadi/). Copy the files; never redraw, recolour
  or regenerate them. `icons/` holds the copies.
- Tagline: "Decide, order, split."
- Descriptor: "Free. Free Software. Simple and Stupid."
- Mark: a plain Kerala tea glass, black on white (inverse white on black). In the app
  it is inlined with `currentColor` (`Mark` in `js/components.js`).
- `tests/design.test.js` enforces the above: load order, no own colours, shadows,
  gradients or rounded corners, contrast of the status pairs.

## Product decisions

| Decision | Selected |
| --- | --- |
| Tagline | Decide, order, split. |
| Language | English first; short words; catalogue in `js/strings.js` |
| Currency | `Rs` with Indian grouping; ₹ is an optional fallback |
| Theme | Light and Dark. First run follows the device, then persisted |
| Connection | Room code only (PeerJS). No manual / offline pairing |
| Tabs | Menu, My picks, Order, Costs; Group / History / Settings in app menu |
| Paid | Ink stamp “PAID” on the receipt. Never coloured |
| Person placing order | Orderer |

## How brand rules map to the app

| Need | Brand piece |
| --- | --- |
| Room code plate, filled code boxes | Inverse ink block (like the wordmark mark) |
| Primary action (one per screen) | Solid ink button |
| Share, QR, Copy, Pay with app | Outline button with trailing ↗ (outbound) |
| Delete, Start new session, Leave | Danger fill, dashed edge, triangle icon |
| Online / offline | Filled / hollow square plus a word in the label |
| Host, Orderer tags | 1px ink outline |
| Errors, warnings, info | Left bar + cross / double border + triangle / hairline + “i” |
| Receipts | `.ls-receipt` (paper, perforation, Courier Prime, never inverts) |
| QR codes | Black on white in both themes so cameras can read them (only literal colour) |

## Sessions and persistence

Each open starts fresh. Two kinds of data exist:

- **Kept on the device:** display name, UPI ID (`profile.upi`), preferences, contributor key,
  and the archive of earlier sessions.
- **The current session** (group, menus, picks, round): expires after one hour without
  activity (`SESSION_TTL_MS`). Activity is any tap or key, an intent, a synced change,
  or the app being hidden (that moment is stored). On the next open, or when the app
  returns to the foreground, an expired session is archived: an open round with picks is
  finished as it stands, the group is left, and Home shows “archived to History” with a
  View history button. Empty sessions are dropped silently. Leaving a group or starting a
  new session archives too. The archive keeps the 30 newest sessions and is read-only,
  with Pay buttons for your own unpaid share.

## UPI payments

Chaikadi is not a payment app. It opens the payer's own UPI app. Nobody types a UPI ID
on first launch: the payee's own QR is the source, and the payee approves it.

1. The orderer has no UPI ID, so non-orderers see a **Pay {orderer} by UPI** card on Order
   and Costs. It tells them to ask the orderer to show their UPI QR (`My QR` in any UPI app).
2. A payer taps **Scan UPI QR** and scans it (`parseUpiQr`: only `upi://pay?pa=…`, no fixed
   amount). That sends `upi.propose` (protocol v7). Nothing changes yet.
3. The orderer gets an **Add this UPI ID?** prompt (opens by itself, and stays as a banner).
   **Yes** runs `upi.decide`: the ID becomes theirs, is kept on their device (`profile.upi`)
   and is shared with the group. **No** discards it. Only the owner can set their own ID.
4. Once set, everyone sees it; it stays until the owner changes it (Settings, or another
   scan with approval). Round history keeps it with the member list.
5. When the order is locked, a non-orderer with an amount owed sees **Pay** on Costs and in
   History. Only for rupee groups (`Rs`, `₹`, `INR`). The sheet has **Pay with UPI app**
   (`upi://pay?pa&pn&am&cu=INR&tn`, Android chooser), Google Pay / PhonePe / Paytm links for
   iOS, copy ID and a UPI QR for paying from another device.
6. Paid stays the orderer's decision: they mark the stamp when the money arrives.

## Installing

Android Chrome: the `beforeinstallprompt` event is kept and an **Install app** button
shows the native dialog; without the event the card gives browser-menu steps. iOS (Safari
or Chrome): three Share → Add to Home Screen steps, since iOS has no install API.
In-app browsers are told to open Chrome or Safari. The card appears on Home and Group,
snoozes for 14 days on Not now, never shows once installed, and Settings always offers it.

## Receipt

Order, Costs and each History round use the brand receipt. Paid lines carry a tilted ink stamp.

Order, Costs and each History round are receipts: paper stock, perforated top and
bottom edges, a soft lift on white (none on black), Courier Prime, every character
ink black. Leaders are dotted, totals sit under a double rule, the grand total is
32px. Paid lines carry a tilted ink stamp. The receipt never inverts in dark mode.

## Layout

Content measure 560px; spacing scale 4–64px (brand tokens); left-align prose, right-align amounts. Item/amount rows have decorative dotted leaders and wrap long names.

## Structure and components

- **App bar:** ink, 56px minimum plus top safe area; wordmark, compact inverse room
  code, connection symbol and labeled app-menu button. Compact code opens Group.
- **Bottom bar:** four 24px icons and 12px labels, at least 64px plus safe area;
  selected tab has a 3px ink top bar. My picks has a count badge; Order a lock.
- **Home:** one-tap creation with prefilled names, secondary code join, quiet
  Scan QR. Names can be edited/rerolled. Links and completed four-box
  codes auto-join. Boxes accept paste and keyboard navigation.
- **Group:** black plate, double inset paper rule, four underlined characters.
  Tap copies code. Share link / Show QR follow. Square initial avatars use six
  monochrome treatments. Role tags are outlined, with bold Orderer.
- **Menus:** new groups are empty. Saved menus are named and independent. Menu
  selector is outlined, selected by tint and rule; current round also has a check
  and explicit text. Host/orderer selects the round menu. Optional common items
  require a deliberate tap. Existing groups retain their old items in “Menu”.
- **Menu editing:** edit mode exposes Edit/Delete; add/edit item and rename use
  sheets. Scan uses a sheet with local processing, review and explicit save.
- **Picks:** flat menu-board rows, dotted price leaders, category below; squared
  44px minus/plus and a boxed count. Item name opens a note sheet. Notes are small
  italic text with a note icon. Changing quantity is one tap.
- **Order:** receipt card, double-rule total, collapsed per-person breakdown.
  Copied order uses textual leaders. Only orderer can lock/unlock.
- **Costs:** estimate and actual bill separately; aligned amounts and paid status;
  grand total is 32px. Only orderer edits bill or payments.
- **History:** one bordered object per round with original menu name and amounts.
  Outstanding balances remain payable to the original orderer.
- **Sheets:** square, 2px top rule, no shadow, handle; close button, Escape, scrim
  tap and downward handle swipe. Native dialog provides focus containment.
- **Confirmations:** Keep is solid primary, destructive action dashed with alert
  icon. Destructive deletion never relies on a colour distinction.
- **Toasts:** ink/paper, polite live region, 3 seconds, above the bottom bar.
- **Menu library sheet:** city select, search field, result rows (bold name,
  caption item count, freshness chip, optional Sample tag) separated by hair
  rules. Preview uses menu-board leader rows grouped by category, one primary
  **Use this menu**, outlined **Suggest an update** with the external-link icon.
  Re-importing a linked stall offers primary **Add missing items only** and a
  dashed alert **Replace items**.
- **Freshness chip:** 1px ink outline, 16px icon plus words. Fresh: check icon,
  bold “Confirmed N days ago”. Stale: clock icon, 3px double border, “Prices
  may be old”. Unverified: alert icon, dashed border, “Not confirmed recently”.
- **Sample tag:** dashed outline on tint, bold “Sample”.
- **Share prompt:** after Finish round only; changed items as leader rows with
  “was … now …” captions. **Not now** is the solid primary; sharing is outlined.

## Motion

120ms for button states; 200ms for sheets. No page entrance, list staggering or
plate animation. Lock types one character per 40ms, cursor stops, then double rule
reveals over 200ms. Shuffle slows through a ~1.2s sequence of names. Reduced motion
shows the entire lock message, no cursor, a 300ms shuffle fade and sheet fade.
Screen readers always receive complete text; animation never carries sole meaning.

## Accessibility and PWA

Text contrast ≥4.5:1 (large text ≥3:1), control edges ≥3:1. Touch targets ≥44px
(48px preferred), 8px gaps, 3px ink focus outline. Inputs have visible labels,
16px type, decimal input mode for prices, and permit paste. Dialog errors are
announced and associated with fields. Layout must survive 200% text scaling.

Self-hosted fonts, icons and the app shell are cached by the service worker. Theme colour
follows the page: #FFFFFF light, #000000 dark. Apple status bar is
default with safe-area padding. Home shows a
dismissible installation hint.

## Implementation notes

- `brand/`: vendored brand (do not edit). `styles.css`: layout and app components only; no build step.
- `js/strings.js`: English UI catalogue and Indian money formatting.
- `js/components.js`: original local SVG icons, sheets, dialogs, four-box code.
- `brand/fonts/`: from the brand, with OFL notices; Malayalam loads only for Malayalam text. All files are precached.
- OS-controlled splash/icon rendering varies by iOS/Android; the manifest, Apple
  metadata and monochrome icons provide the PWA surfaces the web can control.
- No default menu is silently generated or deleted. History and local state
  remain authoritative; design changes do not reset saved groups.
