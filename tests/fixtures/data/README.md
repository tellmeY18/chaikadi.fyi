# Menu library fixtures

Copied verbatim from a `chaikadi-data` build so the app tests use the real
published format: `v2/` (current, sectioned places) and the v1 compatibility
files at the root (used by the fallback test).

```sh
cd ../chaikadi-data
node scripts/build.mjs --date 2026-11-12 --commit 0000000 --out /tmp/data-dist
cp /tmp/data-dist/manifest.json ../chaikadi.fyi/tests/fixtures/data/
cp /tmp/data-dist/index/in-kl-ernakulam.json ../chaikadi.fyi/tests/fixtures/data/index/
cp /tmp/data-dist/v2/manifest.json ../chaikadi.fyi/tests/fixtures/data/v2/
cp /tmp/data-dist/v2/index/in-kl-ernakulam.json ../chaikadi.fyi/tests/fixtures/data/v2/index/
```

Three places are fictional samples (`"sample": true`); Smart Foodie Kitchen is
real. Do not edit by hand: the manifest's `sha256` must match the bundle bytes.
