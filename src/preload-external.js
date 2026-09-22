/**
 * EXTERNAL WEB PRELOAD — preload-external.js
 *
 * Used for ALL external web content loaded in tab WebContentsViews:
 *   - Google, YouTube, GitHub, Reddit, and all other websites
 *
 * SECURITY POLICY:
 *   External web pages MUST NOT have access to any privileged browser APIs.
 *   This preload intentionally exposes NO privileged functionality.
 *
 *   External pages cannot access:
 *     ✗ Tab management (create, close, switch, navigate)
 *     ✗ History data
 *     ✗ Bookmarks data
 *     ✗ Storage / settings
 *     ✗ Filesystem
 *     ✗ IPC channels
 *     ✗ Session / cookies
 *     ✗ System APIs
 *     ✗ Window controls
 *
 * MINIMAL READ-ONLY EXPOSURE:
 *   Only non-privileged, informational data is exposed — nothing that
 *   can be used to interact with the browser application.
 */

const { contextBridge } = require('electron');

const identity = {
  name:    'SHMMOTH Browser',
  version: '1.0.0',
};

contextBridge.exposeInMainWorld('shmmothBrowser', identity);
contextBridge.exposeInMainWorld('mtcBrowser', identity);

// window.mtcAPI and window.shmmothAPI are intentionally NOT defined for external pages.
