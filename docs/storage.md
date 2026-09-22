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
| Passwords | NEVER stored |
| API keys | Main process memory only |
| Auth tokens | `getSensitive()` / `setSensitive()` → Electron `safeStorage` (Phase 2) |
| Session cookies | Chromium session layer (not in our JSON) |

## Known Limitations

- Synchronous `fs.writeFileSync` — blocking on every mutation
- No atomic write (crash mid-write can corrupt the file)
- No database — not suitable for large datasets (>10K history items)
- No migration system for schema changes

## Roadmap

- Phase 2: Add atomic write (temp file + rename)
- Phase 2: Add `safeStorage` for encrypted sensitive fields
- Phase 3: Consider SQLite for history/downloads if volume grows
