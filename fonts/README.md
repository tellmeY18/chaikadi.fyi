# Self-hosted type (113,276 bytes total)

- Atkinson Hyperlegible Mono v8, variable Latin subset (interface): 17,740 B.
- Courier Prime v11, Latin subsets (receipts): regular 18,640 B, bold 19,348 B.
- Noto Serif Malayalam v32, variable Malayalam subset: 57,548 B, includes ₹.
- SIL Open Font License 1.1; complete copyright notices in the adjacent OFL files.

Downloaded at development time from Google Fonts' font distributions. Runtime
URLs are relative and service-worker cached. No Google Fonts stylesheet is loaded.
`unicode-range` loads the Malayalam face for Malayalam text / ₹, not English.
The interface is English-first; no Malayalam translation is claimed. The small
local Malayalam file is also precached, so names and notes still work offline.

Courier Prime's Latin subset has no rupee glyph. New groups use `Rs`; the optional
`₹` currency uses Noto as a local glyph fallback. Existing currency labels stay.
