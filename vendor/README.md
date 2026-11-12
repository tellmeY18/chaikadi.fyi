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

Source distributions: `https://cdn.jsdelivr.net/npm/<package>@<version>/…`.
These are provenance URLs, **not runtime imports**. All imports and script tags
point at files in this directory. Source-map directives, if any, are local and
are not required at runtime. Upgrade deliberately, run tests, and bump the
service-worker cache version when replacing a vendor file.
