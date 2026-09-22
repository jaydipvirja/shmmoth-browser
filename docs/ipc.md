# MTC Browser — IPC Reference

## Architecture

```
[Renderer / Internal Pages]
        window.mtcAPI.*
              ↓
    preload-internal.js
       ipcRenderer.invoke()
              ↓
       [IPC boundary]
              ↓
   secureHandlerRaw(handler)
     → validateTrustedSender(event)
     → handler(event, ...args)
              ↓
      ipcMain.handle()
              ↓
     MtcBrowserApp methods
```

## Full IPC Channel Inventory

### Fire-and-forget (ipcMain.on) — No origin validation needed (no data returned)

| Channel | Direction | Notes |
|---|---|---|
| `window:minimize` | R → M | Minimize window |
| `window:maximize` | R → M | Toggle maximize |
| `window:close` | R → M | Close window |

### Invoke/Handle (ipcMain.handle) — All wrapped with secureHandlerRaw()

| Channel | Direction | Args | Returns |
|---|---|---|---|
| `tab:create` | R → M | `url: string` | `tabId: string` |
| `tab:close` | R → M | `tabId: string` | void |
| `tab:switch` | R → M | `tabId: string` | void |
| `tab:navigate` | R → M | `tabId: string, url: string` | void |
| `tab:navigateCurrent` | R → M | `url: string` | void |
| `tab:reload` | R → M | `tabId?: string` | void |
| `tab:goBack` | R → M | `tabId?: string` | void |
| `tab:goForward` | R → M | `tabId?: string` | void |
| `tab:toggleDevTools` | R → M | `tabId?: string` | void |
| `sidepanel:toggle` | R → M | `mode: 'ai'|'notes'` | void |
| `settings:get` | R → M | — | `Settings object` |
| `settings:update` | R → M | `delta: Partial<Settings>` | `Settings object` |
| `bookmarks:get` | R → M | — | `Bookmark[]` |
| `bookmarks:add` | R → M | `bm: BookmarkInput` | `Bookmark[]` |
| `bookmarks:remove` | R → M | `url: string` | `Bookmark[]` |
| `history:get` | R → M | — | `HistoryItem[]` |
| `history:clear` | R → M | — | `true` |
| `history:deleteItem` | R → M | `id: string` | `HistoryItem[]` |
| `shortcuts:get` | R → M | — | `Shortcut[]` |
| `shortcuts:add` | R → M | `sc: ShortcutInput` | `Shortcut[]` |
| `shortcuts:remove` | R → M | `id: string` | `Shortcut[]` |
| `notes:get` | R → M | — | `string` |
| `notes:save` | R → M | `content: string` | `true` |
| `adblocker:getCount` | R → M | — | `number` |
| `cache:clear` | R → M | — | `true` |
| `download:getAll` | R → M | — | `DownloadRecord[]` |
| `download:cancel` | R → M | `id: string` | `boolean` |
| `download:clearCompleted` | R → M | — | `number` |

### Push events (webContents.send) — Main → Renderer

| Channel | Payload | Trigger |
|---|---|---|
| `tabs:updated` | `(tabs: Tab[], activeTabId: string)` | Any tab state change |
| `tab:navState` | `{ canGoBack, canGoForward, url }` | Navigation |
| `adblocker:count` | `number` | Every tabs:updated |
| `download:update` | `DownloadRecord` | Download state change |

## Security Guards

`secureHandlerRaw(handler)` validates `event.senderFrame.url` before calling the handler. Untrusted origins throw `UNTRUSTED_ORIGIN` which surfaces as a rejected promise to the renderer — the renderer gets no data.

## Adding New Channels for SHMMOTH

1. Add the handler in `setupIpc()` in `main.js`:
   ```js
   ipcMain.handle('shmmoth:myAction', secureHandlerRaw(async (event, arg) => {
     // validate arg
     // perform action
     return result;
   }));
   ```
2. Expose it in `preload-internal.js`:
   ```js
   myAction: (arg) => ipcRenderer.invoke('shmmoth:myAction', arg),
   ```
3. Document it in this file.
