# Chaikadi design and brand book · v0.3

**Build source of truth.** v0.3 puts readability first: a black-and-white
wireframe, a hyperlegible monospace for the interface, crayon colour only where it
means something, and a receipt that feels like paper. Product: a group tea-break
ledger for 2–15 people, connected peer-to-peer by room code (PeerJS). Preview:
the **Redesign v0.3** page of `design/chaikadi-screens.figcraft`; audit in
`design/UI-ACCESSIBILITY-REPORT.md`.

## Decisions

| Decision | Selected |
| --- | --- |
| Page | Pure white `#FFFFFF` (light), pitch black `#000000` (dark) |
| Interface type | Atkinson Hyperlegible Mono 400 / 700, locally hosted WOFF2 |
| Receipt type | Courier Prime 400 / 700, receipts and the lock moment only |
| Colour | Crayon only, with meaning (below); everything else black and white |
| Tagline | Decide, order, split. |
| Language | English first; short words; catalogue in `js/strings.js` |
| Currency | `Rs` with Indian grouping; ₹ is an optional local-font fallback |
| Theme | Two: Light and Dark. First run follows the device, then persisted |
| Connection | Room code only (PeerJS). No manual / offline pairing |
| Tabs | Menu, My picks, Order, Costs; Group / History / Settings in app menu |
| Paid | Ink stamp “PAID” on the receipt. Never coloured |
| Person placing order | Orderer |

## Essence and voice

A Kerala tea stall’s ledger in your pocket. Clear before clever: use a word only
if the screen needs it; no explanatory sentences where a label will do. Sentence
case, two weights, short verbs. User-entered names retain their casing.

## Crayon colour = meaning

Soft hand-coloured wax fills, used sparingly. Text on crayon is always `#111111`.
Colour never works alone: every crayon also carries a word or shape.

| Crayon | Hex | Only for |
| --- | --- | --- |
| Yellow | `#FFE066` | The room code (plate, completed join boxes) |
| Blue | `#9FCBFF` | Outbound: Share link, Show QR, Scan QR, Copy, Export, Suggest an update |
| Green | `#A7E3A0` | Online dots, Host / Orderer tags, the one forward button per screen |

Menu, My picks and History have no green button: the bottom tabs move you on.

## Palette

| Token | Light | Dark |
| --- | --- | --- |
| `--page` | #FFFFFF | #000000 |
| `--ink` | #000000 | #FFFFFF |
| `--muted` | #4D4D4D | #B8B8B8 |
| `--line` | #8C8C8C | #767676 |
| `--receipt` | #FBF6E9 | #EDE7D6 (dimmed for glare) |
| `--receipt-ink` | #111111 | #111111 |

Controls have 2px ink borders. Disabled is dashed grey. Errors: alert icon, 8px left
bar, hidden “Error” prefix for screen readers. Warnings: double border. Destructive
actions: dashed border plus alert icon. A 50% black scrim is the only translucency.

## Receipt

Order, Costs and each History round are receipts: paper stock, perforated top and
bottom edges, a soft lift on white (none on black), Courier Prime, every character
ink black. Leaders are dotted, totals sit under a double rule, the grand total is
32px. Paid lines carry a tilted ink stamp. The receipt never inverts in dark mode.

## Type and grid

Interface: Atkinson Hyperlegible Mono (distinct 0/O, 1/I/l). Malayalam names/notes
and optional ₹ use local Noto Serif Malayalam. Fonts total under 150 KB.

| Role | Size / line height |
| --- | --- |
| Plate | 56 / 60 maximum; scales to fit narrow screens |
| Screen title | 32 / 40 (1.75rem of an 18px root) |
| Section heading | 22 / 30 |
| Subheading / amount | 18 / 28 |
| Body | 18 / 28 |
| Secondary | 16 / 24 |
| Smallest (optional text only) | 14 / 20 |
| Grand total | 32 / 36 |

Sizes are rem-based. Content measure: 560px maximum, 16px side padding on phones,
24px from 600px. Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64px. Left-align prose,
right-align amounts. Only the plate and empty-state drawings are centered.
Screen titles have a 2px ink rule. Totals have a double rule. Item/amount
rows have decorative dotted leaders and wrap long names instead of truncating.

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

- `styles.css`: tokens, layout and components; no build step.
- `js/strings.js`: English UI catalogue and Indian money formatting.
- `js/components.js`: original local SVG icons, sheets, dialogs, four-box code.
- `fonts/`: complete OFL notices; Malayalam is glyph-triggered rather than an
  untranslated language switch. All font files are small enough to precache.
- OS-controlled splash/icon rendering varies by iOS/Android; the manifest, Apple
  metadata and monochrome icons provide the PWA surfaces the web can control.
- No default menu is silently generated or deleted. History and local state
  remain authoritative; design changes do not reset saved groups.
