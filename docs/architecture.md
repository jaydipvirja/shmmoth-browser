# SHMMOTH Browser — Architecture

## Overview

SHMMOTH Browser is an Electron desktop browser built on Chromium (Blink/V8) — currently Electron 44 / Chromium 152 / Node 24 (see `docs/upgrading-electron.md`). It uses a multi-process architecture where each browser tab runs in a sandboxed `WebContentsView`, and the browser chrome (tabs, omnibox, toolbar) runs in a dedicated `BrowserWindow`.

## Process Model

```
┌─────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js)  — main.js                  │
│                                                     │
│  MtcBrowserApp                                      │
│  ├── StorageService      (mtc-data.json)            │
│  ├── AdBlockerService    (Ghostery engine)          │
│  ├── RamSaverService     (60s interval)             │
│  ├── DownloadManager     (session will-download)    │
│  └── ipcMain handlers    (all privileged ops)       │
│                                                     │
│  Security modules:                                  │
│  ├── security/ipcSecurity.js                        │
│  ├── security/urlPolicy.js                          │
│  └── utils/logger.js                               │
└──────────────┬──────────────────────────────────────┘
               │ IPC (contextBridge)
┌──────────────▼─────────────────┐
│  BROWSER CHROME (Renderer)     │
│  renderer/index.html + app.js  │
│  preload: preload-internal.js  │  ← Full window.mtcAPI
│  window.mtcAPI: FULL           │
└──────────────┬─────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼──────┐  ┌──────▼──────────────────┐
│  Tab Views  │  │  Side Panel View         │
│  (N tabs)   │  │  (Notes)                 │
│             │  │                          │
│  mtc:// URL │  │  mtc://notes             │
│  → internal │  │  → preload-internal.js   │
│  preload    │  │  → Full window.mtcAPI    │
│             │  │                          │
│  https:// U │  │  https://gemini.google   │
│  → external │  │  → preload-external.js   │
│  preload    │  │  → NO window.mtcAPI      │
│             │  └──────────────────────────┘
│  window.    │
│  mtcAPI:    │
│  undefined  │ ← for external pages
│  for extern │
└─────────────┘
```

## Key Files

| File | Role |
|---|---|
| `src/main.js` | Main process controller |
| `src/preload-internal.js` | Full browser API bridge (trusted pages only) |
| `src/preload-external.js` | Empty bridge (external web pages) |
| `src/security/ipcSecurity.js` | IPC origin validation |
| `src/security/urlPolicy.js` | URL classification + navigation policy |
| `src/utils/logger.js` | Structured logger |
| `src/services/storage.js` | JSON persistence layer |
| `src/services/adblocker.js` | Ghostery ad blocking |
| `src/services/ramSaver.js` | Tab sleep/wake management |
| `src/services/downloadManager.js` | File download lifecycle |
| `src/ai/` | AI provider abstraction + providers (scaffolding for the SHMMOTH agent, **not wired in yet**) |
| `src/agent/` | Future SHMMOTH agent interface and action schema (stub, **not wired in yet**) |
| `src/renderer/` | Browser chrome HTML/JS/CSS |
| `src/pages/` | Internal mtc:// page files |

## Preload Architecture

Two preload files determine what APIs are available in each rendering context:

- **`preload-internal.js`** — exposes the full `window.mtcAPI` surface. Used for the browser chrome and all `mtc://` internal pages.
- **`preload-external.js`** — exposes **nothing privileged**. Only a read-only `window.mtcBrowser` identity object. Used for all external web content.

The `selectPreload(url)` function in `main.js` routes the correct preload at `WebContentsView` creation time based on the initial URL.

## Internal Pages (mtc:// scheme)

Internal pages are served from `src/pages/` by a privileged custom protocol handler:

| URL | File |
|---|---|
| `mtc://newtab` | `pages/newtab.html` |
| `mtc://settings` | `pages/settings.html` |
| `mtc://bookmarks` | `pages/bookmarks.html` |
| `mtc://history` | `pages/history.html` |
| `mtc://notes` | `pages/notes.html` |
| `mtc://downloads` | `pages/downloads.html` |

## Naming: SHMMOTH vs "mtc"

The product is **SHMMOTH Browser**. The project started as "MTC Browser", and a few internal identifiers still say `mtc`. They are deliberately **not** renamed, because changing them would break existing installs or links:

| Identifier | Why it stays |
|---|---|
| `package.json → name: "mtc-browser"` | Electron derives the profile folder (`%APPDATA%\mtc-browser`) from it; renaming would orphan every user's bookmarks, history, passwords and session |
| `build.appId: com.mtc.shmmothbrowser` | Identity of the installer / update channel on Windows |
| `mtc://` internal pages, `window.mtcAPI` | Stable internal API surface used by every page and test |
| `mtc-data.json`, `[MTC:…]` log prefix | Existing profile file name / log format |
| `run-mtc-browser.bat` | Referenced from the README and from users' shortcuts |

Everything a user can see (window titles, page titles, greeting, installer name, README) says SHMMOTH. A real rename would need a one-time profile migration (copy the old folder, keep a fallback `mtc://` alias); do that deliberately, in its own change.
