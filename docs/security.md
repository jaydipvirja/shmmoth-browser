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
| Browser chrome (BrowserWindow) | `preload-internal.js` | ✅ Full |
| `mtc://` internal pages | `preload-internal.js` | ✅ Full |
| External web tabs (https://, http://) | `preload-external.js` | ❌ None |
| AI side panel (Gemini, ChatGPT) | `preload-external.js` | ❌ None |
| Notes side panel (`mtc://notes`) | `preload-internal.js` | ✅ Full |

## IPC Security

All privileged `ipcMain.handle()` calls are wrapped with `secureHandlerRaw()` from `security/ipcSecurity.js`.

The guard checks `event.senderFrame.url` against trusted prefixes (`mtc://`, `file://`). Any call from an external origin (`https://`, `http://`) is rejected with an `UNTRUSTED_ORIGIN` error logged at the SECURITY level.

## URL Policy

`security/urlPolicy.js` classifies all URLs into:

- `TRUSTED_INTERNAL` — `mtc://`, `file://`
- `TRUSTED_EXTERNAL` — Standard HTTPS
- `UNKNOWN_EXTERNAL` — HTTP, blob:
- `DANGEROUS` — `javascript:`, `data:`, `vbscript:`

Dangerous URLs are blocked in:
- `formatUrl()` — before loading any URL
- `will-navigate` event — on every tab view
- `tab:navigate` IPC handler — before loading via IPC
- `setWindowOpenHandler` — for popup/new-window requests

External pages **cannot navigate tabs to `mtc://` internal routes** — `isInternalNavigationAllowedFrom()` enforces this.

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
| Synchronous file I/O in StorageService.save() | Low | No atomic write; crash-safe write is a Phase 2 improvement |
| No Content Security Policy on internal pages | Medium | Add CSP headers via protocol handler in Phase 2 |
| AdBlocker filter download requires internet on first run | Low | Falls back to CRX extensions if unavailable |
| notes.html inline script has no XSS protection beyond escapeHtml | Low | Notes content is user-typed only, not web content |
