# MTC Browser — Architecture

## Overview

MTC Browser is an Electron 33 desktop browser built on Chromium (Blink/V8). It uses a multi-process architecture where each browser tab runs in a sandboxed `WebContentsView`, and the browser chrome (tabs, omnibox, toolbar) runs in a dedicated `BrowserWindow`.

## Process Model

```
┌─────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js)  — main.js                  │
│                                                     │
│  MtcBrowserApp                                      │
│  ├── StorageService      (mtc-data.json)            │
│  ├── AdBlockerService    (Ghostery + CRX)           │
│  ├── RamSaverService     (60s interval)             │
│  ├── DownloadManager     (session will-download)    │
│  ├── AI Providers        (GeminiProvider etc.)      │
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
│  (N tabs)   │  │  (AI or Notes)           │
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
| `src/services/adblocker.js` | Ghostery + CRX ad blocking |
| `src/services/ramSaver.js` | Tab sleep/wake management |
| `src/services/downloadManager.js` | File download lifecycle |
| `src/ai/AIProvider.js` | AI provider abstraction |
| `src/ai/providers/` | Concrete providers (Gemini, OpenAI, Custom) |
| `src/agent/BrowserAgent.js` | Future SHMMOTH interface (stub) |
| `src/agent/BrowserAction.js` | Structured action schema |
| `src/renderer/` | Browser chrome HTML/JS/CSS |
| `src/pages/` | Internal mtc:// page files |
| `extensions/` | Bundled CRX extensions |

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
