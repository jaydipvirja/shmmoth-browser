# Changelog

## 1.1.0

A large security and reliability release. **Updates are now signed**: from this version on the browser installs an update only if it carries a valid signature from the publisher's key.

### New
- **Continue where I left off** (Settings → On Start-up): your tabs come back after a restart or a crash. Background tabs load only when you open them. Incognito tabs are never saved.
- **Error pages**: a page that cannot be loaded now explains why (no internet, server not found, connection refused, proxy problem, untrusted certificate …) instead of showing a blank tab. The address bar keeps the address, and *Try again* / *Reload* retry it.
- **One window per profile**: opening SHMMOTH again (or a link from another app) brings the running window to the front and opens the link in a new tab.
- **New logo** and app icon.
- Opening a downloaded program (`.exe`, `.msi`, `.bat`, `.js`, …) now asks for confirmation first.

### Security
- Signed updates (Ed25519); the installer is hashed again right before it is started.
- Page titles can no longer run code inside the browser's own pages (stored XSS), and local `file://` documents no longer receive the browser API. A Content-Security-Policy protects every internal page.
- All pages, windows and tabs run in the Chromium sandbox.
- Passwords are stored only with the operating system's encryption (Windows DPAPI); if it is unavailable the browser refuses to save them instead of using a weak key. Data files are written atomically with a backup, and a damaged file is kept aside instead of being overwritten.
- Incognito tabs now use the configured proxy, and downloads use the proxy-aware downloader while a proxy is active. WebRTC no longer reveals the real IP when a proxy is configured.
- The browser no longer contacts Google Fonts (Inter is bundled).
- Hardened build: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are disabled, and the app loads only from its signed archive.

### Fixes
- Internal pages (new tab, Settings, History …) were blank inside incognito tabs.
- The ad blocker now blocks from the very first request, caches its filter lists (faster start, works offline) and fetches them through the browser's proxy. Switching it off applies to normal and incognito tabs alike.
- History showed the *previous* page's title; it is now correct, and history is written more efficiently.
- The RAM Saver could put the tab you were using to sleep.
- The page context menu's *Reload* did nothing.
- The bundled uBlock Origin copy (which never worked in installed builds) was removed; the built-in blocker does the work.
- Removed the non-functional "AI Assistant" settings.

### Under the hood
- Electron 33 → 44 (Chromium 152).
- Automated tests: unit tests plus end-to-end tests of the real app on Linux and Windows, including the packaged build, on every change.
