# Chaikadi design and brand book · v0.2

**Build source of truth.** Based on the supplied v0.2 proposal. This edition selects
its recommended direction and incorporates multiple named menus without default
items. Product: an offline-capable group tea-break ledger, for 2–15 people.

## Decisions

| Decision | Selected |
| --- | --- |
| Paper | Neutral `#F7F7F7` |
| Typeface | Courier Prime 400 and 700, locally hosted WOFF2 |
| Tagline | Decide, order, split. |
| Language | English first; catalogue in `js/strings.js` for future translation |
| Currency | `Rs` with Indian grouping; ₹ is an optional local-font fallback |
| Theme | System preference plus persisted Light / Dark / Follow system |
| Tabs | Menu, My picks, Order, Costs; Group / History / Settings in app menu |
| Lock moment | Typed “Order locked.”, static tumbler, double rule |
| Mark | Geometric tumbler with two steam strokes |
| Person placing order | Orderer |
| Corners | Square; 2px for avatars, 6px SVG icon tile |

## Essence and voice

A Kerala tea stall’s ledger in your pocket: typed, not painted. Quiet, warm through
plain words, premium through restraint. No distressing, grain, stains, shadows,
gradients, mascots, decorative photographs or hue. Sentence case, two weights,
short verbs. No eyebrow labels or tracked capitals. User-entered names retain
their casing. “Room code” is the only use of “room” in normal UI; technical
connection settings are confined to Settings and pairing help.

The app bar reads **Chaikadi**, never the marketing-only **Chaikadi.** lockup.
The signature room plate is the one large ink surface in content. Photos are
inputs to the scanner, not decoration.

## Palette

| Token | Light | Dark |
| --- | --- | --- |
| `--ink` | #111111 | #F2F2F2 |
| `--paper` | #F7F7F7 | #0A0A0A |
| `--surface` | #FFFFFF | #161616 |
| `--tint` | #EDEDED | #232323 |
| `--muted` | #595959 | #A3A3A3 |
| `--line` | #BDBDBD | #3A3A3A |

Rule grey is decorative only. Controls have 2px ink borders. Status always has a
word and/or a symbol, a distinct border or weight: filled/hollow dot plus online /
offline; `[x] Paid` / `[ ] Not paid`; selected pick rows have both tint and a 4px
ink edge. Errors have an alert icon, “Error:” prefix and a 6px left bar; notes use
a double border. A 50% ink scrim is the sole decorative translucent surface.

## Type and grid

All Latin UI: Courier Prime, 400 / 700. Malayalam names/notes and optional ₹ use
local Noto Serif Malayalam. Combined fonts are below 150 KB; `font-display: swap`.
Malayalam text is never forced into a character-width name column.

| Role | Size / line height |
| --- | --- |
| Plate | 56 / 60 maximum; scales to fit narrow screens |
| Screen title | 28 / 34 |
| Section heading | 22 / 28 |
| Subheading / amount | 18 / 24 |
| Body | 16 / 24 |
| Helper | 14 / 20 |
| Caption | 12 / 16 |
| Grand total | 32 / 36 |

Sizes are rem-based. Content measure: 560px maximum, 16px side padding on phones,
24px from 600px. Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64px. Left-align prose,
right-align amounts. Only the plate and empty-state drawings are centered.
Screen titles have a 2px ink rule. Totals have a 3px double rule. Item/amount
rows have decorative dotted leaders and wrap long names instead of truncating.

## Structure and components

- **App bar:** ink, 56px minimum plus top safe area; wordmark, compact inverse room
  code, connection symbol and labeled app-menu button. Compact code opens Group.
- **Bottom bar:** four 24px icons and 12px labels, at least 64px plus safe area;
  selected tab has a 3px ink top bar. My picks has a count badge; Order a lock.
- **Home:** one-tap creation with prefilled names, secondary code join, quiet
  offline pairing. Names can be edited/rerolled. Links and completed four-box
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

Self-hosted fonts, icons and complete app shell are cached offline. Theme colour
is #111111, #0A0A0A in dark mode; background #F7F7F7. Apple status bar is
black-translucent with safe-area padding. The first successful group shows a
dismissible installation hint. QR pairing always offers copy/paste text.

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
