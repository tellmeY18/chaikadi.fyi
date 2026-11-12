# Locally vendored dependencies

No package installation or CDN access is required to run the app. These files
were downloaded at development time from the pinned npm package distributions:

| File | Package | Version | License |
| --- | --- | --- | --- |
| preact.module.js | preact | 10.26.4 | MIT, preact.LICENSE |
| htm.module.js | htm | 3.1.1 | Apache-2.0, htm.LICENSE |
| peerjs.min.js | peerjs | 1.5.5 | MIT, peerjs.LICENSE |
| qrcode.js | qrcode-generator | 1.4.4 | MIT, embedded header / qrcode.LICENSE |
| jsQR.js | jsqr | 1.4.0 | Apache-2.0, jsQR.LICENSE |
| ocr/tesseract.min.js, ocr/worker.min.js | tesseract.js | 7.0.0 | Apache-2.0, ocr/tesseract.LICENSE |
| ocr/tesseract-core-simd-lstm.wasm.js, ocr/tesseract-core-lstm.wasm.js | tesseract.js-core | 7.0.0 | Apache-2.0 |
| ocr/eng.traineddata.gz | @tesseract.js-data/eng (4.0.0_best_int) | 1.0.0 | Apache-2.0 model (Tesseract tessdata), MIT package |

`vendor/ocr/` (~7 MB used per device) is **not** in the precached app shell. It
is loaded only when someone opens the Menu tab, then cached by the service
worker in its own cache (`chaikadi-ocr-v1`) so scanning works offline. Only the
WASM build the device needs is fetched (SIMD on iOS 16.4+ / modern Chrome).
Source-map comments were stripped from the two tesseract.js files. The library
has built-in jsDelivr default URLs; Chaikadi always overrides `workerPath`,
`corePath` and `langPath`, so they are never contacted (verified by
`tests/scan.mjs`, which blocks all third-party requests).

Source distributions: `https://cdn.jsdelivr.net/npm/<package>@<version>/…`.
These are provenance URLs, **not runtime imports**. All imports and script tags
point at files in this directory. Source-map directives, if any, are local and
are not required at runtime. Upgrade deliberately, run tests, and bump the
service-worker cache version when replacing a vendor file.
