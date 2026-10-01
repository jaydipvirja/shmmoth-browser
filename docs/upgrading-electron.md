# Upgrading Electron

Why: Electron supports only the **latest three major versions**; each major bundles a Chromium that receives security fixes only while supported. Running an old one means running a browser with known, published vulnerabilities. Aim to be on the newest major (or at most one behind) — a major comes out about every 8 weeks.

Current: **Electron 44.5.1** → Chromium 152, Node 24, V8 15.2.

## Routine

```bash
npm view electron dist-tags.latest        # what is current?
npm install --save-dev electron@<version> # updates package.json + package-lock.json
node node_modules/electron/install.js     # (re)download the binary if npm did not
npm audit                                 # should report 0 vulnerabilities
```

Then verify (all must pass) before releasing:

1. **Unit tests**: run every `tests/*.test.js` (`node tests/<file>`; `stage11…` and `live-*` need Electron).
2. **Boot the app** (`npm start`) and check the console for `(electron) … is deprecated` lines — fix them now; they become errors in a later major.
3. **Manual smoke on Windows** (the real target; CI/containers only cover Linux): tabs, omnibox, window drag/resize/maximize/fullscreen, YouTube fullscreen, a download (normal + Turbo), incognito window, Settings → Network (proxy), password save prompt, extension popup, Settings → About → Check for updates.
4. **Packaged build**: `npx electron-builder --dir` and run the result — `app.asar` paths and `app.isPackaged` behave differently from `npm start` (the trusted-page check in `security/trustedPages.js` and the updater both depend on them).
5. Security invariants (covered by the `tests/p0-*.test.js` files): sandbox on for every window, `window.mtcAPI` only on trusted pages, CSP active, proxy applied to incognito, updater verifies signatures.

## What the 33 → 44 upgrade needed

| Area | Change |
|---|---|
| `webContents` `console-message` | Electron ≥ 35 passes one `details` object (`details.message`); the positional `(level, message, …)` arguments are deprecated. The login-capture listener reads `event.message`, declares a single parameter (declaring more triggers a warning) and keeps `arguments[2]` as a fallback. |
| Extensions | `session.loadExtension` / `removeExtension` → `session.extensions.*` (helper `extensionsApi()` in `extensionManager.js`, falls back for old runtimes/test fakes). |
| User-Agent / Client Hints | Were hard-coded to Chrome 130; now derived from `process.versions.chrome` so they always match the engine. |
| Everything else | No change needed: `WebContentsView`, `protocol.handle`, `webRequest`, permission handlers, `navigationHistory`, `setWindowOpenHandler`, sandboxed preloads, `net` all behaved identically. |

## Known caveats

* uBlock Origin (MV2, `extensions/uBlock0.chromium`) loads when running from source but **fails inside the packaged `app.asar`** (Chromium cannot read extension files from an asar archive), and Electron implements only a subset of the extension APIs (no `webRequest` blocking), so real ad-blocking comes from the Ghostery engine. Decide whether to drop the bundled extension.
* Electron "fuses" (`runAsNode`, `onlyLoadAppFromAsar`, ASAR integrity, …) are not flipped yet — see electron-builder's `electronFuses` option.
