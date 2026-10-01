# MTC Browser — Storage

## Current Implementation

`src/services/storage.js` — `StorageService`

Single JSON file: `%APPDATA%/mtc-browser/mtc-data.json`

## Schema

```json
{
  "settings": {
    "searchEngine": "google",
    "searchEngineUrls": { "google": "...", "duckduckgo": "...", "bing": "...", "yahoo": "..." },
    "adBlockerEnabled": true,
    "ramSaverEnabled": true,
    "ramSaverTimeoutMinutes": 15,
    "aiSidebarEnabled": true,
    "aiProvider": "gemini",
    "aiCustomUrl": "https://gemini.google.com",
    "theme": "dark",
    "homepage": "mtc://newtab",
    "showBookmarksBar": true
  },
  "bookmarks": [{ "id": "bm_1", "title": "", "url": "", "favicon": "", "createdAt": 0 }],
  "history":   [{ "id": "hist_1", "title": "", "url": "", "timestamp": 0 }],
  "notes":     "string (up to 1MB)",
  "shortcuts": [{ "id": "sc_1", "title": "", "url": "", "icon": "" }]
}
```

## Generic Interface (new in Phase 1)

```js
storage.get('settings')             // → settings object
storage.set('shmmoth', agentState)  // → saves to JSON
storage.has('shmmoth')              // → boolean
storage.delete('shmmoth')           // → removes key
storage.clear('settings')           // → resets to default
```

## Domain Methods (preserved)

```js
getSettings() / updateSettings(delta)
getBookmarks() / addBookmark(bm) / removeBookmark(url)
getHistory() / addHistory(item) / clearHistory() / deleteHistoryItem(id)
getNotes() / saveNotes(content)
getShortcuts() / addShortcut(sc) / removeShortcut(id)
```

## Adding SHMMOTH State

```js
// In main.js, access via this.storage:
const shmmothData = this.storage.get('shmmoth', {});
this.storage.set('shmmoth', { ...shmmothData, lastTask: taskId });
```

## Sensitive Data (NOT stored here)

| Data | Storage Method |
|---|---|
| Passwords | `shmmoth-vault.json`, each password encrypted with Electron `safeStorage` (Windows DPAPI); if OS encryption is unavailable passwords are **refused**, never stored with a weak key |
| API keys | Main process memory only |
| Auth tokens | `getSensitive()` / `setSensitive()` → Electron `safeStorage` (not yet implemented) |
| Session cookies | Chromium session layer (not in our JSON) |

## Crash safety (`src/utils/atomicJson.js`)

All JSON data files (`mtc-data.json`, `shmmoth-vault.json`, `shmmoth-autofill.json`, `shmmoth-proxy.json`, the extension registry) are written with `writeJsonAtomic()`:

1. serialise → temp file (`<file>.tmp-<pid>`), `fsync`
2. refresh `<file>.bak` from the current file **only if the current file still parses** (storage: at most once a minute; vault: every write)
3. `rename` the temp file over the real one (atomic)

and read with `readJsonRecovering()`:

| Situation | Result |
|---|---|
| file missing | fresh defaults |
| file damaged (bad JSON / wrong shape) | damaged file is **moved** to `<file>.corrupt-<timestamp>` (last 3 kept), `<file>.bak` is restored if usable, otherwise defaults |
| file exists but cannot be read (locked / permissions) | `persistBlocked` — the service runs in memory and never overwrites the file |

A damaged file is therefore never silently replaced by empty data. If you ever see a `*.corrupt-*` file next to your data, the app recovered from the backup (`.bak`, at most ~1 minute old for bookmarks/history) and kept the damaged copy for inspection.

## Known Limitations

- Synchronous (but atomic) file I/O on every mutation (~3 ms for a 2,000-entry history)
- No database — not suitable for large datasets (>10K history items)
- No migration system for schema changes

## Roadmap

- Phase 3: debounce/coalesce history writes
- Phase 3: Consider SQLite for history/downloads if volume grows
