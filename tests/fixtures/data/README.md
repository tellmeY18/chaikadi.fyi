# Menu library fixtures

Copied verbatim from a `chaikadi-data` build so the app tests use the real
published format:

```sh
cd ../chaikadi-data
node scripts/build.mjs --date 2026-11-12 --commit 0000000 --out /tmp/data-dist
cp /tmp/data-dist/manifest.json ../chaikadi.fyi/tests/fixtures/data/
cp /tmp/data-dist/index/in-kl-ernakulam.json ../chaikadi.fyi/tests/fixtures/data/index/
```

All three places are fictional samples (`"sample": true`). Do not edit by hand:
the manifest's `sha256` must match the bundle bytes. Refresh with the commands
above when the data format changes.
