# SHMMOTH Browser — Security Model

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

## Auto-update security

Updates are verified before anything runs — see `docs/releasing.md` for the full flow:

- installers must carry a detached **Ed25519 signature** (`<installer>.sig`) from a key compiled into the app (`services/updateKeys.js`); the private key never lives on GitHub, so a compromised GitHub account/token/release cannot push malware to users (checksums on the same release would be replaced together with the file);
- strict release/asset validation, HTTPS + host allow-list on every redirect hop, size + digest checks, a private download folder and a re-hash right before the installer is launched;
- networking uses Electron's `net`, so the browser's proxy settings apply;
- **fail closed**: no key / no `.sig` / bad signature ⇒ the update is announced but never downloaded or run.

## Keeping the engine current

A browser is only as safe as its Chromium. Electron ships a new major roughly every 8 weeks and **supports only the latest three majors**; older ones get no Chromium security fixes (the project ran on Electron 33 — two years old, dozens of published advisories — until the upgrade to 44). Treat upgrades as routine: check `npm view electron dist-tags.latest` and `npm audit` monthly and follow `docs/upgrading-electron.md`.

## Renderer sandbox

Every `BrowserWindow` / `WebContentsView` (tabs, side panel, browser chrome, bubbles, extension popup, OAuth popups) is created with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. A renderer exploit therefore starts inside Chromium's OS sandbox instead of with the user's full privileges.

Consequences for contributors — preloads (`preload-internal.js`, `preload-external.js`) run in a *sandboxed preload* environment:

- only `require('electron')` (limited to `contextBridge`, `crashReporter`, `ipcRenderer`, `nativeImage`, `webFrame`, `webUtils`), `events`, `timers`, `url`;
- no `fs`, `path`, `child_process`, `__dirname`, no requiring other local files.

Do privileged work in the main process behind an IPC handler. `tests/p0-sandbox.test.js` fails if a window is created without `sandbox: true` or a preload starts using Node-only APIs.

## Session & Authentication Model

- Users authenticate to websites normally through their browser session.
- SHMMOTH Browser does not intercept or proxy passwords. Only when the user chooses "Save password" is one stored, in the password vault, encrypted with the operating system's key store (`safeStorage`; refused if that is unavailable — see `storage.md`).
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

## Downloaded programs

Opening a download whose type runs code (`.exe .msi .bat .cmd .scr .js .vbs .ps1 .hta .jar .lnk .reg .dll .msix .docm …`, judged by the last extension so `invoice.pdf.exe` and `setup.exe.` are caught — `DownloadManager.isDangerousFile`) asks first, with **Cancel** as the default button; Cancel shows the file in its folder instead. Without a confirmation callback such files are never started. Downloading itself is unchanged.

## Network privacy (proxy, WebRTC, fonts)

- **One proxy for every session.** `applyProxyToAllSessions()` (main.js) applies the saved proxy to the normal *and* the incognito session at start-up and whenever it is saved/reset — incognito used to bypass it.
- **WebRTC.** With a manual proxy every tab gets `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` so WebRTC cannot reveal the real IP over UDP; it returns to `default` when the proxy is reset. (Trade-off: some video-call sites may need TCP/relay.)
- **Turbo downloads.** The Turbo engine asks through Chromium's network stack first (which honours the proxy) and through Node's http/https as a second way — Node's sockets ignore browser proxy settings. While a proxy is in effect (manual mode, or a system/PAC proxy detected by `session.resolveProxy`) downloads stay on Chromium's native downloader, which honours it; a Turbo download paused before a proxy was configured is not resumed outside the proxy.
- **No third-party fonts.** Inter is bundled (`pages/fonts.css`, SIL OFL licence in `pages/inter-OFL.txt`); the pages no longer contact Google Fonts and the CSP only allows `'self'` fonts.
- **Ad blocker.** One filter engine is shared by the normal and incognito session; the on/off setting applies to both. The filter lists are downloaded with Electron's `net.fetch`, so they follow the browser's proxy and trust the operating system's certificate store, and the compiled engine is cached in `adblock-engine.bin` (refreshed after 24 h; if a refresh fails the previous copy keeps being used). A short built-in list of the biggest ad networks is armed from the first request.

## Permissions pages get without asking

`security/permissionPolicy.js`: `fullscreen`, `pointerLock` and `clipboard-sanitized-write` (writing text / images to the clipboard, which Chromium only allows while the user is interacting with the page). The permission *check* handler answers "no" to anything it does not know, so a permission missing from this list silently breaks the web feature behind it — `clipboard-sanitized-write` was missing and every "Copy link" / "Copy video URL" button failed with "Write permission denied" (E2E 12 guards it). `clipboard-read`, camera / microphone, location, notifications etc. stay behind the per-site prompt.

## Secure DNS (DNS-over-HTTPS)

`services/secureDns.js` + `app.configureHostResolver()` (called first thing in `init()`, re-applied when the setting changes). Default provider **AdGuard DNS** (`https://dns.adguard-dns.com/dns-query`): lookups are encrypted and known ad / tracker / malware domains are not resolved. Modes: *automatic* (default — try DoH, fall back to the system DNS when the server cannot be reached, so a blocked resolver never stops browsing) and *strict* (`secure`, never falls back). Other choices: AdGuard Family, AdGuard Non-filtering, a custom `https://…` address (validated: https only, no credentials / fragment / whitespace; an invalid saved address degrades to the system DNS, never to a guessed server), or *System default* (off). The setting is global (normal and incognito). Privacy trade-off: the DNS provider learns which host names you look up; with a proxy the proxy resolves the names itself. The legacy host `dns.adguard.com` is not used — AdGuard's current hosts are `*.adguard-dns.com`.

## Ad blocker switches

- **Master switch** (shield bubble or Settings → Ad-Blocker & Privacy): applies to the normal and the incognito session, stops the built-in YouTube ad skipping too, and the page behind the bubble reloads.
- **On this site**: pauses the blocker for the host of the active tab (and its subdomains; `www.` is ignored). The host is always taken from the active tab in the main process, never from the renderer's message; only `http(s)` pages can be paused; at most 500 sites; the list is saved as `adBlockerAllowlist`. Implementation: thin wrappers around the engine's `webRequest` listeners (requests *and* response headers) that skip paused pages, also for the built-in fallback list.

## Process hardening

- **Electron fuses** (`package.json → build.electronFuses`, flipped by electron-builder and read back from the binary by `scripts/check-fuses.js`): `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` / `NODE_EXTRA_CA_CERTS` and `--inspect` are ignored, and the app is loaded only from `app.asar` with its integrity validated (Windows/macOS). Without these, the signed `SHMMOTH Browser.exe` can be turned into a general-purpose Node interpreter by an environment variable, or have its code swapped out of an unpacked `app` folder. Consequence: `NODE_EXTRA_CA_CERTS` is not honoured in a shipped build; network code that must trust a corporate root CA therefore uses Electron's `net` (system certificate store), as the ad-block list download does.
- **Not enabled on purpose:** `grantFileProtocolExtraPrivileges` stays at Electron's default because the browser chrome and the bubble windows are still loaded from `file://` (a packaged build cannot load them with the fuse off). Serving them through `mtc://` would allow switching it off. `enableCookieEncryption` is a one-way switch for existing profiles and gives little against malware running as the same Windows user, so it is left for a deliberate decision.
- **Single instance.** `app.requestSingleInstanceLock()` — a second launch on the same profile hands its URLs to the running window and exits instead of racing it on the data files. Only `http(s)` addresses from the command line are opened (`utils/launchArgs.js`); files, `mtc://` and script URLs are dropped.

## Error pages

A page that cannot be loaded shows `mtc://error` (`pages/error.html`, built by `utils/errorPage.js`) instead of a blank tab: plain explanation, error code, **Try again** / **Go back**. The failed address travels in the query string of an *internal* page, so it is treated as untrusted text: `error.js` writes it with `textContent` only (no markup is ever parsed), offers *Try again* only for `http(s)` addresses, and the error name is reduced to `[A-Za-z0-9_]`. Certificate errors (`ERR_CERT_*`) get an explanation but **no "continue anyway"** option. `ERR_ABORTED` (navigated away / became a download) and sub-frame failures never show the page, and only `http(s)` failures do, so the error page cannot loop. The address bar, history, session file and *Reopen closed tab* use the failed address, not the error page's own address.

The `mtc://` protocol handler is registered on both the normal and the `incognito` session (a handler belongs to one session; incognito tabs used to show blank internal pages).

## Password autofill

`services/passwordAutofill.js` fills a saved login into a sign-in form **after the user picks it**; the vault (`services/passwordVault.js`, OS-encrypted) is unchanged.

- **Nothing is revealed before a click.** A detection script runs in an *isolated world* of the page (same DOM, but the page's JavaScript cannot see or call it) and is injected only on a normal-window tab whose exact origin (https, or localhost over http) has a saved login. It reports where a user-name / password field is when the user clicks or focuses it (`isTrusted` events only). The report travels on the console channel with a random per-page nonce that only the isolated world knows, so a page cannot forge it; the main process also checks that the tab is still the active one on the same origin, clamps and range-checks the numbers, and allows one chooser per 120 ms.
- **The chooser** (`pages/autofill-bubble.html`) is a separate non-focusable window listing **user names only**. Its IPC (`passwordAutofill:*`) is accepted only from that window's own `webContents`, with the prompt id of the open chooser and a credential id that was in that list.
- **On a click** the main process re-checks the tab (exists, not private, same `webContents`, same origin as when the list opened), decrypts that one password, and calls `fill()` in the isolated world, which re-checks `location.origin` itself, writes through the native value setter and dispatches `input` / `change`. The values are JSON-encoded into the call; they are never logged. Nothing is submitted.
- **Left alone:** `autocomplete="new-password"` and one-time-code fields, credit-card / address fields, search boxes, text fields not near a password field, other origins, iframes (the script runs in the top frame only), private windows, pages without OS encryption.
- Not done on purpose: filling on page load without a click. A page's own scripts (ads, trackers) can read a pre-filled password field, which is the known weakness of that approach.
- `SHMMOTH_E2E_INSECURE_VAULT=1` (test key for Linux CI without an OS keyring) is honoured only by an unpackaged run (`!app.isPackaged`).

## Known Remaining Risks (Phase 1)

| Risk | Severity | Mitigation |
|---|---|---|
| Storage is plaintext JSON (no encryption at rest) | Medium | getSensitive/setSensitive stubs ready for safeStorage |
| ~~No atomic write~~ | — | Done: all data files are written atomically with a `.bak` and damaged files are preserved (see storage.md) |
| Installer is not Authenticode-signed (Windows SmartScreen warning on first install) | Low | Buy a code-signing certificate; update signing (Ed25519) already protects updates |
| Password vault: no re-authentication before "reveal password" | Medium | Planned: native confirmation / Windows Hello |
| ~~No Content Security Policy on internal pages~~ | — | Done: CSP header on `mtc://` pages, `<meta>` CSP on the browser chrome |
| AdBlocker filter download requires internet at start-up | Low | A small built-in list of the biggest ad networks is armed immediately and stays in force when the download fails; the full engine replaces it once the lists are loaded |
| notes.html inline script has no XSS protection beyond escapeHtml | Low | Notes content is user-typed only, not web content |
