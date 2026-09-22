# MTC Browser — AI Architecture

## Current State (Phase 1)

AI in the browser is a **display-URL side panel** — the browser loads an external AI web app (Gemini, ChatGPT) in a sandboxed `WebContentsView`.

The AI provider is selected via settings and resolved in `main.js` using the `resolveAiProvider(settings)` factory.

## Provider Class Hierarchy

```
AIProvider (abstract)          src/ai/AIProvider.js
├── GeminiProvider             src/ai/providers/GeminiProvider.js
├── OpenAIProvider             src/ai/providers/OpenAIProvider.js
└── CustomProvider             src/ai/providers/CustomProvider.js
```

## Provider Interface

```js
provider.getName()          → 'gemini' | 'chatgpt' | 'custom'
provider.getDisplayName()   → 'Google Gemini' | 'OpenAI ChatGPT' | 'Custom AI'
provider.getDisplayUrl()    → URL string for the side panel
provider.supportsNativeApi() → boolean (all false in Phase 1)
await provider.query(prompt) → throws (not yet implemented)
```

## Security

- The AI side panel loading an **external URL** (Gemini, ChatGPT) uses **`preload-external.js`** — no `window.mtcAPI` access.
- The AI sidebar cannot call `navigateTab`, `getHistory`, `getBookmarks`, or any other browser API.
- Users can interact with the AI normally — the restriction is one-way (webpage cannot call browser APIs).

## Settings Integration

```js
// settings.aiProvider: 'gemini' | 'chatgpt' | 'custom'
// settings.aiCustomUrl: string (for 'custom' provider)
```

## Future Native API Integration (Phase 2+)

When native API support is added:

1. Add `query(prompt, options)` implementation to the concrete provider.
2. Store API key via `storage.setSensitive('gemini_api_key', key)` (safeStorage).
3. Add `ipcMain.handle('ai:query', ...)` handler — main process makes the HTTP request.
4. Renderer calls `window.mtcAPI.aiQuery(prompt)` — key never reaches renderer.
5. SHMMOTH agent calls `provider.query()` directly in main process — no renderer involvement.

## SHMMOTH Integration Path

```
SHMMOTH Agent (main process)
    ↓
AIProvider.query(prompt)    ← main process API call
    ↓
HTTP request to AI API      ← authenticated from main process
    ↓
Response text returned to agent
    ↓
Agent plans BrowserActions
    ↓
executeAction() via MtcBrowserApp
```
