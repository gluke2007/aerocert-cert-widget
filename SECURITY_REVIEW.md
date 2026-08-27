# Pre-publish Security Review — grist-cert-widget

Scope: `index.html`, `style.css`, `app.js` (static, client-side-only Grist Custom Widget, no backend, no build/dependency tree).

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Hardcoded secrets (API keys, tokens, passwords, private keys, etc.) | **PASS** | `grep` across all 3 files for key/secret/password/token/bearer/private-key/PEM patterns returned zero matches. |
| 2 | Forbidden browser APIs (localStorage, sessionStorage, indexedDB, Pointer Lock, Fullscreen) | **PASS** | No occurrences of `localStorage`, `sessionStorage`, `indexedDB`, `requestPointerLock`, or `requestFullscreen`/`fullscreenElement` in any file. Widget persists its config via `window.grist.setOption`, not browser storage — safe for the Perplexity preview iframe. |
| 3 | Exposed internal URLs / absolute file-system paths / debug endpoints | **PASS** | No `localhost`, private IP ranges, `file://`, `/home/`, `/Users/`, or leftover `TODO`/`FIXME`/`debug` strings found. |
| 4 | External network calls limited to expected public CDNs | **PASS** | Only external references found in `index.html`: `fonts.googleapis.com` / `fonts.gstatic.com` (Google Fonts), `docs.getgrist.com/grist-plugin-api.js` (Grist SDK), `cdnjs.cloudflare.com/.../jspdf` (jsPDF), `cdn.jsdelivr.net/npm/qrcode-generator` (QR library). No `fetch`, `XMLHttpRequest`, `.ajax`, or `WebSocket` calls exist in `app.js` — all four expected CDNs, nothing else. |
| 5 | General app.js code safety (eval, unsanitized innerHTML from untrusted data, etc.) | **PASS** | No `eval(` or `new Function(` anywhere. Three `innerHTML` assignments exist (lines 325, 331, 379) but all only inject static, hardcoded UI strings from the internal `FIELD_DEFS`/`COMPUTED_FIELD_DEFS` constant arrays (e.g. `"Engineer Name"`, `"Course / Qualification"`) — never actual Grist row/record data. Real record values (names, dates, course text, etc.) are rendered onto the `<canvas>` via `ctx.fillText`, which cannot execute HTML/script. Grist iframe communication uses the official SDK surface (`grist.ready`, `grist.onOptions`, `grist.onRecord`, `grist.mapColumnNames`) rather than a raw/custom `postMessage` listener, which is the standard safe integration pattern. |

## Summary
All 5 checks **PASS** with no WARN or BLOCK findings — no secrets, no forbidden storage/fullscreen APIs, no leaked internal paths, network calls limited to the four expected public CDNs, and no unsafe eval/innerHTML-from-untrusted-data patterns in `app.js`; the widget is clear to publish.
