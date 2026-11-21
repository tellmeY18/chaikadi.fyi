# Chaikadi → Eatsights integration plan

Status: **draft for review** (2026-11-14). No app code is written until the UI changes in
section 5 are designed in `design/chaikadi-screens.figcraft` and approved.
Work happens on the `eatsight` branch (worktree `../chaikadi.fyi-eatsight`). `main` and
chaikadi.fyi stay untouched until the final switch is approved.

## 1. Goal and ground rules

Replace the static menu library (`chaikadi-data` → `data.chaikadi.fyi`) with
[Eatsights](https://github.com/tellmeY18/eatsights), the open food data API, and later let
groups contribute prices back to it.

- **Same public API as every app.** Chaikadi gets no special endpoints, keys, weights or
  exports from Eatsights.
- **Opt-in, never automatic.** Today "Share these price updates?" has **Not now** as the
  primary button and sends nothing by itself. Contributions to Eatsights keep that rule.
- **Privacy stays as it is.** No member names, group names, notes, picks or locations
  leave the group. Eatsights only receives structured facts (a price, "sold out", a wait)
  plus a per-device key, which Eatsights never publishes (it shows a per-place pseudonym).
- **CC0 and no copying.** Everything sent is CC0. Nothing comes from OSM, Google, Zomato
  or Swiggy; OSM is linked by ID only (as today).
- **No free text.** Eatsights has no comment fields; Chaikadi's `note`/`description` stay
  local or are dropped.
- **Reversible.** One setting flips the data source back to the static library.

## 2. Today vs target

| | Today | Target |
|---|---|---|
| Library source | Static JSON at `data.chaikadi.fyi` (v2 manifest + city bundles, sha256) | `https://eatsights.letsimpl.fyi/v1` (develop: `https://develop.letsimpl.fyi`) |
| Read path | `js/data.js` `createDataClient` | New `js/eatsights.js` with the **same interface**; `configureData` picks one |
| Freshness | `last_confirmed` date, computed on device | Eatsights facts: status (`confirmed`, `unconfirmed`, `contested`, `stale`), confidence, number of contributors, `last_observed_at` |
| Updates | "Suggest an update" → GitHub issue (or `SUGGEST_ENDPOINT`) | Signed observations to `POST /v1/submissions` (opt-in), GitHub issue kept as fallback during transition |
| Identity | None (room member UUID + token, local) | One Ed25519 device key for contributions, stored on the device only |
| New stalls | PR / issue to `chaikadi-data` | Signed `POST /v1/entities` (phase 4) |

## 3. Phases and approval gates

| Phase | What | Gate before it starts |
|---|---|---|
| 0 | Eatsights prerequisites (section 7) | — |
| 1 | **Design** of every UI change in section 5 in FigCraft | — |
| 2 | **Read switch**: library loads from Eatsights behind a flag; static library stays as fallback | Design approved |
| 3 | **Data migration**: seed Eatsights with the CC0 `chaikadi-data` stalls (section 6) | Phase 2 reviewed on develop |
| 4 | **Contributions**: device key; "Share price updates" and the one-tap prompts send signed observations | Eatsights proposal 0001 (signing format) approved |
| 5 | **Add a stall** from the app | Location decision (section 8, D3) |
| 6 | Switch production: `DATA_SOURCE = 'eatsights'` on `main`, retire `data.chaikadi.fyi` | Eatsights production deployed with backups (its M6) |

Each phase ends with passing `npm test`, the browser checks in `TEST_PLAN.md`, a short
note in this file, and your approval.

## 4. Read switch (phase 2) — technical design

**Seam.** `createDataClient` in `js/data.js` exposes `loadManifest`, `loadCityBundle`,
`searchPlaces`, `getPlace`, `refreshManifest`, `subscribe`. A new
`createEatsightsClient` implements the same interface and returns objects that pass the
existing `sanitize*` functions, so `library-ui.js`, `store.js` and `state.js` don't change.

**Calls** (all public, cacheable, no credentials; Eatsights sends CORS headers):

| Need | Eatsights call |
|---|---|
| City list | Config list in `js/config.js` (Eatsights has no cities endpoint yet; see 7) |
| Stalls in a city | `GET /v1/places?city=ernakulam&limit=500` (cursor pagination) |
| One stall's menu | `GET /v1/places/{id}/menu` → `{place, sections, items:[{item, facts}], place_facts, built_at}` (pre-built, gzip, ETag/304) |
| Search | Same as today: on-device over the city's places; `q=` server search later |
| Bulk / offline | `GET /v1/export` snapshot later, if city bundles get large |

**Mapping**

| Chaikadi library field | Eatsights source |
|---|---|
| `place.id` (slug or OSM ref, ≤ 60 chars) | `pl_<ULID>` → reversible slug `es-<lowercase ULID>` (no protocol change) |
| `name`, `localName` | `place.names.en`, `place.names.ml` |
| `kind` | `place.category` (`tea_stall`→`tea-stall`, `juice_shop`→`juice-shop`, `small_hotel`→`hotel`, `street_cart`/`office_counter`→`other`, …) |
| `osm {type,id,relation}` | Only when `place.osm.state = linked` → `relation: 'is'` |
| `last_confirmed` | Newest `last_observed_at` across the stall's facts (date) |
| `sample` | Not in Eatsights; sample stalls are not migrated |
| `hours` | `hours.declared` fact (place) |
| section `name`, nesting | `sections[].labels.en`, `parent_section_id`, `sort` |
| item `name`, `localName` | `item.labels.en`, `item.labels.ml` |
| item `category` | From section `kind` (`drinks`→`Tea`/`Drinks`, `snacks`, `meals`/`mains`/`breakfast`→`Meal`, `desserts`→`Dessert`, else `Other`) |
| item `price` (rupees) | `price.amount` fact `current_value.amount_minor / 100` |
| `variants[]` | Separate Eatsights menu items with `variant.size` / `variant.label`, regrouped by dish/name |
| `available` | `listing.status` fact (`unlisted` → false); fresh `availability.observed` "sold out" → false |
| `uncertain` | Fact status `unconfirmed`, `contested` or `stale` |
| `priceStatus` (market/seasonal/ask) | No equivalent → item shown without price |
| `diet`, `spice` | `dish.diet` (dish scope; needs dish links), spice: none |
| `portion` | `serving.quantity` |
| `tax {included}` | `price.amount` value `tax_included` |
| `note`, `description` | **Not sent** (free text). Dropped on migration |

**Caching and offline.** Same behaviour as today: show cached data first, refresh in the
background, IndexedDB (`chaikadi-library`) + service worker runtime cache, using ETags
instead of sha256. Menus fetched with bounded concurrency.

**Fallback.** If Eatsights is unreachable and nothing is cached, use the static library.
`DATA_SOURCE` (`'static'` | `'eatsights'`) in `js/config.js`, overridable per device in
Settings like the existing library address.

**Group sync.** Library place IDs travel in `menuSource` between peers. The `es-…` slug
fits the current regexes, so `PROTOCOL_VERSION` stays 5 and mixed versions keep working.

## 5. UI changes to design first (FigCraft)

Please design these in `design/chaikadi-screens.figcraft`; each follows DESIGN.md
(black-and-white wireframe, crayon colour = meaning, every chip has icon + words).

**Phase 2 (reads)**
1. **Library sheet → source line**: "Menus from Eatsights · CC0" instead of the
   chaikadi-data attribution; link target.
2. **Freshness chip v2** on stall rows and the preview, mapping fact status:
   - Confirmed — "Confirmed by 3 people · 2 days ago"
   - Unconfirmed — "1 report · 5 days ago" (also all freshly migrated data)
   - Contested — "Prices disagree" (and what the preview shows: the leading value)
   - Stale — "Not confirmed recently"
3. **Price-level uncertainty** in the preview list: how an unconfirmed or contested price
   looks next to a confirmed one; "From the stall" mark when the value is vendor-declared,
   and "Stall says ₹12 · customers say ₹10" when they differ.
4. **Empty and error states**: city with no stalls yet; Eatsights offline with cached
   data; offline with nothing cached (falls back to the old library).
5. **Settings → Data source**: Eatsights / Static library (developer-ish, below the
   library address).

**Phase 4 (contributions)**
6. **Settings → Contributions**: "Share prices with Eatsights" on/off (off by default since 2026-11-22: Eatsights is shelved until Chaikadi gains traction),
   what is shared (CC0, no names, a device key), "Reset my contributor key".
7. **"Share these price updates?" sheet v2** after Finish round: same content, now sends
   to Eatsights; per-item result (accepted / already sent / rejected); offline: "Will send
   when online".
8. **One-tap confirm** (optional, never blocking): "Still ₹10?" on an item that was ordered
   — Yes / Changed / Skip.
9. **Sold out** mark by the orderer ("Sold out today") → `availability.observed`.
10. **Wait time** (optional, after Finish round): "How long did the order take?" chips
    (≤5, 10, 15, 20+ min) → `prep.wait_time`.
11. **Quality score** (optional, structured only, no text): 1–5 per item → `quality.score`.

**Phase 5 (new stalls)**
12. **Add a stall**: name (en/ml), kind, city, location (see decision D3), duplicate
    check ("Is it one of these?") before creating.

## 6. Data migration (phase 3)

- **Source:** `chaikadi-data/places/**/*.json` (CC0, Chaikadi's own data).
- **Tool:** `tools/eatsights-seed.mjs` on the branch (Node 22, no new dependencies). Uses a
  dedicated import key (private key in git-ignored `.dev/`), signed `POST /v1/entities` for
  stall → sections → menu items, then `POST /v1/submissions` for `price.amount` and
  `listing.status` with `source_type: import`.
- **Idempotent:** IDs derived from the Chaikadi IDs, so reruns report "duplicate".
- **Dates:** see decision D9. Using the run date would overstate freshness.
- **Location:** the library has no coordinates and they must not come from OSM. Interim:
  the city centre with `precision_m: 5000`, until someone drops a real pin (decision D3).
- **Dropped:** sample stalls, `note`, `description`, `priceStatus` without a price.
- **Confidence:** imported facts start `unconfirmed` (one contributor, import weight).
  They become `confirmed` when a second, independent person reports the same price.
- **`chaikadi-data` afterwards:** frozen read-only with a README pointer to Eatsights;
  `data.chaikadi.fyi` stays up during the fallback period (decision D5).

## 7. Eatsights prerequisites (phase 0)

1. Approve Eatsights proposal 0001 (key ID, signed bytes, entity writes). Chaikadi code
   depends on it; changing it later breaks installed apps.
2. A stable host: develop now runs on a laptop behind a Cloudflare tunnel
   (`develop.letsimpl.fyi`) — fine for design review and phase 2, not for real users.
3. Production root key created offline, at least one verifier key.
4. Backups and the M6 security review before phase 6.
5. Nice to have (generic, useful to every app, not Chaikadi-specific):
   `GET /v1/cities` (or a facet on `/v1/places`), and per-place ETags.

## 8. Decisions needed

- **D1** Default data source on `main` after approval: Eatsights with static fallback
  (recommended), or keep static until phase 4.
- **D2** (revised 2026-11-22: **off by default**) Contributions default: off until the user turns them on (recommended), or a
  one-time prompt.
- **D3** Location for new stalls: Chaikadi blocks geolocation (`Permissions-Policy:
  geolocation=()`) and stores no coordinates. Options: (a) one-time, opt-in "Use my
  location for this stall" (pin only, never a trail), (b) manual pin on a map (needs a
  map that loads without a runtime CDN), (c) city centre + coarse precision only.
- **D4** Keep the GitHub-issue suggestion path as a fallback during the transition?
- **D5** How long `data.chaikadi.fyi` stays as fallback after the switch.
- **D6** Which optional prompts (8–11) to include in phase 4.
- **D7** Vouch the import key to `member` (root-signed) so the seed tool can later correct
  stalls it created. Unverified keys can create but not edit.
- **D8** How migrated data looks. Every imported fact starts `unconfirmed`, because one key
  can never confirm alone. Should the UI label it "From the old library, not yet confirmed",
  or style it like any other unconfirmed price?
- **D9** Dates for migrated prices. Eatsights rejects observations older than 30 days
  (`EATSIGHTS_MAX_OBSERVATION_AGE_DAYS`). Options: (a) raise the limit for the one-time
  import so the real `last_confirmed` dates are kept (recommended; honest freshness), or
  (b) use the run date, which makes old prices look new.

## 9. Testing and rollout

- Unit tests with recorded Eatsights responses; mapping and ID round-trip; fallback;
  signing test vectors cross-checked with the Eatsights CLI.
- Live smoke test against `develop.letsimpl.fyi` on `localhost:8090` (8080 is Eatsights).
- `TEST_PLAN.md` gets an Eatsights section (library, offline, fallback, contributions).
- Branch previews: the deploy workflow only deploys `main`, so the `eatsight` branch never
  reaches chaikadi.fyi. A Cloudflare Pages preview of the branch is a manual,
  maintainer-only step if you want to try it on phones.
- Rollback at any point: set `DATA_SOURCE = 'static'`.

## 10. Current status

- Eatsights develop is live at `https://develop.letsimpl.fyi` (end-to-end checks pass
  through the tunnel; CORS enabled for browser apps).
- Branch `eatsight` and worktree `../chaikadi.fyi-eatsight` exist. Code work is **paused**
  pending design approval.

## 11. Branch `eatsight` (2026-11-14)

- Design approved; Eatsights proposal 0001 accepted (key_id and signed bytes final,
  full-replacement edits, private entity history).
- Implemented on this branch, pointing at develop (`EATSIGHTS_BASE_URL`):
  - Phase 2: `js/eatsights.js` read client (same interface, static fallback via
    `withFallback`), freshness chips v2, price marks, empty/offline/fallback states,
    Settings → Data source.
  - Phase 4: `js/contrib.js` (device Ed25519 key, JCS signing, outbox),
    Settings → Contributions (on by default per D2 decision; each send still needs a tap), share sheet v2 with per-item results,
    one-tap "Still ₹10?", sold out (orderer), wait time and 1–5 rating after Finish round.
  - Phase 5: Add a stall with duplicate check. Location is city centre only
    (precision 5 km) until D3 is decided; the other two options are shown disabled.
- Not done yet: phase 3 seed tool, `TEST_PLAN.md` browser automation for these flows,
  variants regrouping, sold-out marks syncing to other group members (device-local today).
- Preview: pushes to `eatsight` deploy to https://eatsight.chaikadi.pages.dev.

### Contribution triggers (2026-11-14)

One optional sheet per round, at Finish, for the orderer only ("Help the next group"):
changed prices, items Eatsights lacks (created on Eatsights when sent), up to 3 uncertain
prices (contested, unconfirmed, stale, or confirmed over 14 days ago), sold-out marks, wait
time, and a 1–5 rating at most weekly per stall. Confirmed fresh prices are never asked;
the same item is not asked again within 14 days; three skips in a row pause asking for 14
days (the orderer's own changes are kept for the next sheet). Rules: `js/prompts.js`,
tests: `tests/prompts.test.js` and `tests/eatsights.mjs`. The separate "Still ₹10?" card,
wait and rating sheets were replaced by this sheet.

## 12. Switched over (2026-11-15)

- Merged to `main`: the menu library reads only from Eatsights
  (`EATSIGHTS_BASE_URL`, currently develop). The static `chaikadi-data` /
  `data.chaikadi.fyi` client, the Data source setting, the static fallback, the
  service-worker data cache, the library address and the GitHub-issue suggestion
  path are removed (D1, D4, D5 settled). Old caches are deleted on update.
- Menus already imported from the old library stay in groups as ordinary menus.
- Before real users: move `EATSIGHTS_BASE_URL` to production Eatsights (its M6).

## 13. Production (2026-11-16)

- `EATSIGHTS_BASE_URL` is `https://eatsights.letsimpl.fyi` (phase 6). Develop stays at
  `https://develop.letsimpl.fyi` for testing.
- Device keys register once per Eatsights server, so keys first registered on develop
  register again on production before the first contribution.
- Production starts empty; library data is added by people or by `tools/eatsights-seed.mjs --base`.
