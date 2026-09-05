# Browser QR dependencies

ORACLE serves these files directly from its own origin. No CDN, runtime package installation, analytics, or image-upload service is involved.

| File | Upstream version and source | License |
| --- | --- | --- |
| `qrcode-generator-2.0.4.js` | [`qrcode-generator` 2.0.4](https://github.com/kazuhikoarase/qrcode-generator/releases/tag/js2.0.4), npm `dist/qrcode.mjs` | MIT; `qrcode-generator-LICENSE.txt` |
| `jsqr-1.4.0.js` | [`jsqr` 1.4.0](https://github.com/cozmo/jsQR), npm `dist/jsQR.js` | Apache-2.0; `jsqr-LICENSE.txt` |

Retrieved from the official npm packages on 2026-09-05:

- `https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-2.0.4.tgz`
- `https://registry.npmjs.org/jsqr/-/jsqr-1.4.0.tgz`

The generator is copied unchanged, with only the filename extension changed from `.mjs` to `.js`. Its full MIT license comes from the upstream `js2.0.4` tag because the npm archive includes only the source license header.

The jsQR decoder body is unchanged. ORACLE replaced the outer UMD environment-detection wrapper with `const jsQR = (() => { ... })(); export default jsQR;` and added the adaptation notice at the top. It creates no `window` global and is directly importable in browsers and Node. The full upstream Apache license is included unchanged.

Package archive SHA-512 integrity values:

```text
qrcode-generator@2.0.4
sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==

jsqr@1.4.0
sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==
```

Vendored JavaScript SHA-256 values:

```text
ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0  qrcode-generator-2.0.4.js
146a0ab20a2762982a57a15509536ca82833df0c074dd842f6c103aafa7f88b5  jsqr-1.4.0.js
```

Run `node --test test/qr.test.js` to verify generated pixel images with the independent decoder, safe badge-input handling, image rejection, and camera cleanup. Real camera capture still depends on a secure origin, user permission, browser support, and adequate focus/light. The local photo decoder and typed badge code remain available when camera access is unavailable.
