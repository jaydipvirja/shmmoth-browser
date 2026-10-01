# MTC Browser — Security Model

## Core Security Principles

1. **External web content has no access to browser APIs** — preload-external.js exposes nothing.
2. **All IPC handlers validate sender origin** — ipcSecurity.js rejects untrusted frames.
3. **URL policy enforced at all navigation points** — urlPolicy.js gates every navigation.
4. **No secrets stored in plain JSON** — safeStorage stubs documented in storage.js.
5. **Downloads are never auto-executed** — DownloadManager enforces this explicitly.
6. **Webpage content is untrusted data** — not instructions, not commands.

## Preload Separation

| Context | Preload | window.mtcAPI |
|---|---|---|
| Browser chrome (BrowserWindow, exact app file) | `preload-internal.js` | ✅ Full |
| `mtc://` internal pages | `preload-internal.js` | ✅ Full |
| External web tabs (https://, http://) | `preload-external.js` | ❌ None |
| AI side panel (Gemini, ChatGPT) | `preload-external.js` | ❌ None |
| Notes side panel (`mtc://notes`) | `preload-internal.js` | ✅ Full |

## IPC Security

All privileged `ipcMain.handle()` calls are wrapped with `secureHandlerRaw()` from `security/ipcSecurity.js`.

The guard checks `event.senderFrame.url` against `security/trustedPages.js`. A frame is trusted only if it is served by our `mtc://` handler, or is **one of the exact HTML files shipped with the app** (browser chrome `renderer/index.html` and the native bubble pages), loaded via `file://`. Any other `file://` URL — a downloaded `.html`, a file on a network share (UNC) — is ordinary untrusted content and is rejected like `https://` (`UNTRUSTED_ORIGIN`, logged at the SECURITY level).

`selectPreload()` in `main.js` and the gate at the bottom of `preload-internal.js` apply the same rule, so an arbitrary local file opened in a tab never receives `window.mtcAPI`.

## URL Policy

`security/urlPolicy.js` classifies all URLs into:

- `TRUSTED_INTERNAL` — `mtc://` and the exact app-shipped `file://` documents
- `LOCAL_FILE` — any other `file://` URL (viewable by the user, but no browser API)
- `TRUSTED_EXTERNAL` — Standard HTTPS
- `UNKNOWN_EXTERNAL` — HTTP, blob:
- `DANGEROUS` — `javascript:`, `data:`, `vbscript:`

Dangerous URLs are blocked in:
- `formatUrl()` — before loading any URL
- `will-navigate` event — on every tab view
- `tab:navigate` IPC handler — before loading via IPC
- `setWindowOpenHandler` — for popup/new-window requests

Web content **cannot navigate to, or `window.open()`, `mtc://` routes or `file://` URLs** — `isInternalNavigationAllowedFrom()` enforces this for navigations and `isPopupBlocked(url, openerUrl)` for popups. (A local document may still link to a sibling local document.)

## HTML Injection / Content-Security-Policy

Internal pages render data that originates from untrusted websites (page titles, URLs, favicon URLs, cookie names, …) while holding the privileged `window.mtcAPI`. Two independent layers protect them:

1. **Escaping** — all pages and the browser chrome use the single `pages/safe-html.js` `escapeHtml()` (escapes `& < > " ' \``, so it is safe in element text *and* quoted attributes). Never re-implement it with the `textContent → innerHTML` trick, which does not escape quotes (that was the original vulnerability).
2. **CSP** — every `mtc://` `.html` response carries `security/csp.js` (`script-src 'self'`, no inline script, no inline event-handler attributes); `renderer/index.html` has an equivalent `<meta>` policy. Consequence for contributors: no inline `<script>` and no `onerror=`/`onclick=` attributes in internal pages. For image fallbacks use `<img data-fallback="🌐">`.

`tests/p0-xss-and-trusted-pages.test.js` guards both layers.

## Session & Authentication Model

- Users authenticate to websites normally through their browser session.
- MTC Browser does not store, intercept, or proxy passwords.
- The future SHMMOTH agent operates using the **existing authenticated browser session** — it never receives the user's password.
- Session cookies are managed by Chromium's session layer. The browser does not expose raw cookie access via IPC.

## Popup Policy

`setWindowOpenHandler()` is registered on every `WebContentsView`. Dangerous popup URLs are denied. Safe popups (links, background tabs) are opened as new tabs in the existing window instead of as new `BrowserWindows`.

## Download Security

- All downloads intercepted via `session.on('will-download')`.
- Files saved to user's system Downloads folder.
- `item.openInShell()` / `shell.openPath()` are **never called automatically**.
- The user must manually open files after download.

## Prompt Injection Boundary

Webpage content is **untrusted data**. Even if a page contains text that looks like a browser command ("navigate to X", "close this tab"), it has no pathway to execute those actions because:
- External preload exposes no methods
- IPC handlers reject external origins
- The page cannot forge an internal origin

## Known Remaining Risks (Phase 1)

| Risk | Severity | Mitigation |
|---|---|---|
| Storage is plaintext JSON (no encryption at rest) | Medium | getSensitive/setSensitive stubs ready for safeStorage |
| ~~No atomic write~~ | — | Done: all data files are written atomically with a `.bak` and damaged files are preserved (see storage.md) |
| Password vault: no re-authentication before "reveal password" | Medium | Planned: native confirmation / Windows Hello |
| ~~No Content Security Policy on internal pages~~ | — | Done: CSP header on `mtc://` pages, `<meta>` CSP on the browser chrome |
| AdBlocker filter download requires internet on first run | Low | Falls back to CRX extensions if unavailable |
| notes.html inline script has no XSS protection beyond escapeHtml | Low | Notes content is user-typed only, not web content |
