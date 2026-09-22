/**
 * INTERNAL BROWSER PRELOAD — preload-internal.js
 *
 * Used exclusively for trusted SHMMOTH Browser application contexts:
 *   - renderer/index.html  (browser chrome UI)
 *   - mtc://newtab         (new tab dashboard)
 *   - mtc://settings       (settings page)
 *   - mtc://bookmarks      (bookmarks page)
 *   - mtc://history        (history page)
 *   - mtc://notes          (notes side panel — internal page)
 *   - mtc://downloads      (download manager page)
 *
 * SECURITY:
 *   This preload MUST NOT be attached to WebContentsViews that load
 *   external URLs (Google, YouTube, arbitrary websites).
 *   External pages must use preload-external.js instead.
 */

const { contextBridge, ipcRenderer } = require('electron');

const apiSurface = {
  // ─── Window Controls ────────────────────────────────────────────────────────
  minimizeWindow:    () => ipcRenderer.send('window:minimize'),
  maximizeWindow:    () => ipcRenderer.send('window:maximize'),
  closeWindow:       () => ipcRenderer.send('window:close'),
  isWindowMaximized:  () => ipcRenderer.invoke('window:isMaximized'),
  isWindowFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  toggleFullScreen:   (flag) => ipcRenderer.invoke('window:setFullScreen', flag),
  onWindowState:      (callback) => ipcRenderer.on('window:state', (event, state) => callback(state)),
  onFullScreenChange: (callback) => ipcRenderer.on('window:fullscreen-change', (event, state) => callback(state)),

  // ─── Tab Controls ────────────────────────────────────────────────────────────
  createTab:              (url)                => ipcRenderer.invoke('tab:create', url),
  closeTab:               (tabId)              => ipcRenderer.invoke('tab:close', tabId),
  switchTab:              (tabId)              => ipcRenderer.invoke('tab:switch', tabId),
  navigateTab:            (tabId, url)         => ipcRenderer.invoke('tab:navigate', tabId, url),
  navigateCurrentTab:     (url)                => ipcRenderer.invoke('tab:navigateCurrent', url),
  reloadTab:              (tabId)              => ipcRenderer.invoke('tab:reload', tabId),
  reloadTabIgnoringCache: (tabId)              => ipcRenderer.invoke('tab:reloadIgnoringCache', tabId),
  stopTab:                (tabId)              => ipcRenderer.invoke('tab:stop', tabId),
  goBack:                 (tabId)              => ipcRenderer.invoke('tab:goBack', tabId),
  goForward:              (tabId)              => ipcRenderer.invoke('tab:goForward', tabId),
  toggleDevTools:         (tabId)              => ipcRenderer.invoke('tab:toggleDevTools', tabId),
  duplicateTab:           (tabId)              => ipcRenderer.invoke('tab:duplicate', tabId),
  togglePinTab:           (tabId)              => ipcRenderer.invoke('tab:togglePin', tabId),
  reorderTabs:            (tabId, targetIndex) => ipcRenderer.invoke('tab:reorder', tabId, targetIndex),
  closeOtherTabs:         (tabId)              => ipcRenderer.invoke('tab:closeOthers', tabId),
  closeTabsToRight:       (tabId)              => ipcRenderer.invoke('tab:closeToRight', tabId),
  reopenClosedTab:        ()                   => ipcRenderer.invoke('tab:reopenClosed'),
  toggleMuteTab:          (tabId)              => ipcRenderer.invoke('tab:toggleMute', tabId),
  printTab:               (tabId)              => ipcRenderer.invoke('tab:print', tabId),

  // ─── Find in Page (Stage 3) ──────────────────────────────────────────────────
  findInPage:     (tabId, text, opts) => ipcRenderer.invoke('find:start', tabId, text, opts),
  findNext:       (tabId, text, fwd)  => ipcRenderer.invoke('find:next', tabId, text, fwd),
  stopFindInPage: (tabId, action)     => ipcRenderer.invoke('find:stop', tabId, action),
  onFindResult:   (cb)                => ipcRenderer.on('find:result', (_, res) => cb(res)),

  // ─── Zoom (Stage 3) ──────────────────────────────────────────────────────────
  zoomIn:        (tabId) => ipcRenderer.invoke('zoom:in', tabId),
  zoomOut:       (tabId) => ipcRenderer.invoke('zoom:out', tabId),
  resetZoom:     (tabId) => ipcRenderer.invoke('zoom:reset', tabId),
  getZoomFactor: (tabId) => ipcRenderer.invoke('zoom:get', tabId),
  onZoomChanged: (cb)    => ipcRenderer.on('zoom:changed', (_, data) => cb(data)),

  // ─── Push Events from Main Process ──────────────────────────────────────────
  onTabsUpdated:      (cb) => ipcRenderer.on('tabs:updated',      (_, tabs, activeTabId) => cb(tabs, activeTabId)),
  onNavigationState:  (cb) => ipcRenderer.on('tab:navState',      (_, state) => cb(state)),
  onAdsCountUpdate:   (cb) => ipcRenderer.on('adblocker:count',   (_, count) => cb(count)),
  onDownloadUpdate:   (cb) => ipcRenderer.on('download:update',   (_, info)  => cb(info)),
  onThemeChanged:     (cb) => ipcRenderer.on('theme:changed',     (_, theme) => cb(theme)),
  onSettingsUpdated:  (cb) => ipcRenderer.on('settings:updated',  (_, s)     => cb(s)),

  // ─── Settings ────────────────────────────────────────────────────────────────
  getSettings:    ()      => ipcRenderer.invoke('settings:get'),
  updateSettings: (delta) => ipcRenderer.invoke('settings:update', delta),

  // ─── Bookmarks (Stage 2) ─────────────────────────────────────────────────────
  getBookmarks:        (filter)       => ipcRenderer.invoke('bookmarks:get', filter),
  getBookmarkFolders:  ()             => ipcRenderer.invoke('bookmarks:getFolders'),
  addBookmarkFolder:   (name)         => ipcRenderer.invoke('bookmarks:addFolder', name),
  removeBookmarkFolder:(name)         => ipcRenderer.invoke('bookmarks:removeFolder', name),
  addBookmark:         (bm)           => ipcRenderer.invoke('bookmarks:add', bm),
  editBookmark:        (id, updates)  => ipcRenderer.invoke('bookmarks:edit', id, updates),
  moveBookmark:        (id, folder)   => ipcRenderer.invoke('bookmarks:move', id, folder),
  removeBookmark:      (urlOrId)      => ipcRenderer.invoke('bookmarks:remove', urlOrId),
  searchBookmarks:     (query)        => ipcRenderer.invoke('bookmarks:search', query),

  // ─── History (Stage 2) ───────────────────────────────────────────────────────
  getHistory:          (query)        => ipcRenderer.invoke('history:get', query),
  clearHistory:        ()             => ipcRenderer.invoke('history:clear'),
  clearHistoryByRange: (range)        => ipcRenderer.invoke('history:clearByRange', range),
  deleteHistoryItem:   (id)           => ipcRenderer.invoke('history:deleteItem', id),
  deleteHistoryItems:  (ids)          => ipcRenderer.invoke('history:deleteItems', ids),

  // ─── Shortcuts ───────────────────────────────────────────────────────────────
  getShortcuts:   ()        => ipcRenderer.invoke('shortcuts:get'),
  addShortcut:    (sc)      => ipcRenderer.invoke('shortcuts:add', sc),
  removeShortcut: (id)      => ipcRenderer.invoke('shortcuts:remove', id),

  // ─── Notes ───────────────────────────────────────────────────────────────────
  getNotes:  ()        => ipcRenderer.invoke('notes:get'),
  saveNotes: (content) => ipcRenderer.invoke('notes:save', content),

  // ─── Side Panel (Notes / Tools) ──────────────────────────────────────────────
  toggleSidePanel: (mode) => ipcRenderer.invoke('sidepanel:toggle', mode),

  // ─── Ad Blocker ──────────────────────────────────────────────────────────────
  getAdsBlockedCount: () => ipcRenderer.invoke('adblocker:getCount'),

  // ─── Cache ───────────────────────────────────────────────────────────────────
  clearCache: () => ipcRenderer.invoke('cache:clear'),

  // ─── Downloads (Stage 3 & Download Engine) ───────────────────────────────────
  getDownloads:        ()    => ipcRenderer.invoke('download:getAll'),
  pauseDownload:       (id)  => ipcRenderer.invoke('download:pause', id),
  resumeDownload:      (id)  => ipcRenderer.invoke('download:resume', id),
  cancelDownload:      (id)  => ipcRenderer.invoke('download:cancel', id),
  openDownloadedFile:  (id)  => ipcRenderer.invoke('download:openFile', id),
  showDownloadInFolder:(id)  => ipcRenderer.invoke('download:showInFolder', id),
  removeDownload:      (id)  => ipcRenderer.invoke('download:remove', id),
  clearDownloads:      ()    => ipcRenderer.invoke('download:clearCompleted'),
  openDownloadsFolder: ()    => ipcRenderer.invoke('download:openDownloadsFolder'),
  retryDownload:       (url) => ipcRenderer.invoke('download:retry', url),
  chooseDownloadFolder:()    => ipcRenderer.invoke('download:chooseDirectory'),
  toggleDownloadBubble:(bounds) => ipcRenderer.invoke('download:toggleBubble', bounds),
  openDownloadBubble:  (bounds) => ipcRenderer.invoke('download:openBubble', bounds),
  closeDownloadBubble: ()    => ipcRenderer.invoke('download:closeBubble'),
  startTurboDownload:  (opts) => ipcRenderer.invoke('download:startTurbo', opts),
  getTurboState:       ()    => ipcRenderer.invoke('download:getTurboState'),
  getNetworkInterfaces:()    => ipcRenderer.invoke('download:getNetworkInterfaces'),

  // ─── Private Browsing & Window (Stage 4) ──────────────────────────────────────
  newIncognitoWindow: () => ipcRenderer.invoke('window:newIncognito'),
  isIncognitoWindow:  () => ipcRenderer.invoke('window:isIncognito'),

  // ─── Cookies & Site Data (Stage 4) ───────────────────────────────────────────
  getCookies:   (partition)         => ipcRenderer.invoke('cookies:getAll', partition),
  removeCookie: (cookie, partition) => ipcRenderer.invoke('cookies:remove', cookie, partition),
  clearCookies: (partition)         => ipcRenderer.invoke('cookies:clear', partition),

  // ─── Clear Browsing Data (Stage 4) ───────────────────────────────────────────
  clearBrowsingData: (options) => ipcRenderer.invoke('browsingData:clear', options),

  // ─── Site Permissions & Security (Stage 5) ───────────────────────────────────
  getSitePermissions:        (origin)                       => ipcRenderer.invoke('permissions:getForOrigin', origin),
  getAllPermissions:         ()                             => ipcRenderer.invoke('permissions:getAll'),
  setSitePermission:         (origin, permission, decision) => ipcRenderer.invoke('permissions:set', origin, permission, decision),
  removeSitePermission:      (origin, permission)           => ipcRenderer.invoke('permissions:remove', origin, permission),
  clearAllPermissions:       ()                             => ipcRenderer.invoke('permissions:clearAll'),
  respondPermissionRequest:  (requestId, decision, remember)=> ipcRenderer.invoke('permissions:respond', requestId, decision, remember),
  onPermissionRequest:       (callback)                     => ipcRenderer.on('permission:request', (_, data) => callback(data)),
  openPermissionBubble:      (data)                         => ipcRenderer.invoke('permissions:openBubble', data),
  closePermissionBubble:     ()                             => ipcRenderer.invoke('permissions:closeBubble'),

  // ─── Passwords & Credentials (Stage 6) ─────────────────────────────────────────
  getAllPasswords:            ()                           => ipcRenderer.invoke('passwords:getAll'),
  getPasswordsForOrigin:      (origin)                     => ipcRenderer.invoke('passwords:getForOrigin', origin),
  savePassword:               (cred)                       => ipcRenderer.invoke('passwords:save', cred),
  updatePassword:             (id, updates)                => ipcRenderer.invoke('passwords:update', id, updates),
  deletePassword:             (id)                         => ipcRenderer.invoke('passwords:delete', id),
  clearAllPasswords:          ()                           => ipcRenderer.invoke('passwords:clearAll'),
  revealPassword:             (id)                         => ipcRenderer.invoke('passwords:reveal', id),
  respondPasswordSavePrompt:  (promptId, action)           => ipcRenderer.invoke('passwords:respondPrompt', promptId, action),
  getActivePasswordPrompt:    ()                           => ipcRenderer.invoke('passwords:getActivePrompt'),
  closePasswordBubble:        ()                           => ipcRenderer.invoke('passwords:closeBubble'),
  onPasswordOfferSave:        (callback)                   => ipcRenderer.on('password:offerSave', (_, data) => callback(data)),

  // ─── Form Autofill (Stage 6) ──────────────────────────────────────────────────
  getAutofillProfiles:        ()                           => ipcRenderer.invoke('autofill:getProfiles'),
  saveAutofillProfile:        (profile)                    => ipcRenderer.invoke('autofill:saveProfile', profile),
  updateAutofillProfile:      (id, updates)                => ipcRenderer.invoke('autofill:updateProfile', id, updates),
  deleteAutofillProfile:      (id)                         => ipcRenderer.invoke('autofill:deleteProfile', id),
  clearAllAutofillProfiles:   ()                           => ipcRenderer.invoke('autofill:clearAll'),
  isAutofillEnabled:          ()                           => ipcRenderer.invoke('autofill:isEnabled'),
  setAutofillEnabled:         (enabled)                    => ipcRenderer.invoke('autofill:setEnabled', enabled),
  getAutofillSuggestions:     (fieldType, prefix)          => ipcRenderer.invoke('autofill:getSuggestions', fieldType, prefix),

  // ─── Proxy & Network Settings (Stage 6) ───────────────────────────────────────
  getProxyConfig:             ()                           => ipcRenderer.invoke('proxy:get'),
  saveProxyConfig:            (config)                     => ipcRenderer.invoke('proxy:save', config),
  testProxyConnection:        (config)                     => ipcRenderer.invoke('proxy:test', config),
  resetProxyConfig:           ()                           => ipcRenderer.invoke('proxy:reset'),

  // ─── Chromium Extension Management (Stage 7) ───────────────────────────────────
  getAllExtensions:         ()                           => ipcRenderer.invoke('extensions:getAll'),
  getExtensionDetails:      (id)                         => ipcRenderer.invoke('extensions:getDetails', id),
  validateExtension:        (folderPath)                 => ipcRenderer.invoke('extensions:validate', folderPath),
  installExtension:         (folderPath)                 => ipcRenderer.invoke('extensions:install', folderPath),
  enableExtension:          (id)                         => ipcRenderer.invoke('extensions:enable', id),
  disableExtension:         (id)                         => ipcRenderer.invoke('extensions:disable', id),
  removeExtension:          (id)                         => ipcRenderer.invoke('extensions:remove', id),
  reloadExtension:          (id)                         => ipcRenderer.invoke('extensions:reload', id),
  setExtensionPinned:       (id, pinned)                 => ipcRenderer.invoke('extensions:setPinned', id, pinned),
  setDeveloperMode:         (enabled)                    => ipcRenderer.invoke('extensions:setDeveloperMode', enabled),
  isDeveloperMode:          ()                           => ipcRenderer.invoke('extensions:isDeveloperMode'),
  updateExtensionSettings:  (id, settings)               => ipcRenderer.invoke('extensions:updateSettings', id, settings),
  browseExtensionFolder:    ()                           => ipcRenderer.invoke('extensions:browse'),
  clearExtensionErrors:     (id)                         => ipcRenderer.invoke('extensions:clearErrors', id),
  checkExtensionUpdates:    (id)                         => ipcRenderer.invoke('extensions:checkForUpdates', id),
  openExtensionPopup:       (id, bounds)                 => ipcRenderer.invoke('extensions:openPopup', id, bounds),
  toggleExtensionBubble:    (bounds)                     => ipcRenderer.invoke('extensions:toggleBubble', bounds),
  openExtensionBubble:      (bounds)                     => ipcRenderer.invoke('extensions:openBubble', bounds),
  closeExtensionBubble:     ()                           => ipcRenderer.invoke('extensions:closeBubble'),
  toggleShieldBubble:       (bounds)                     => ipcRenderer.invoke('shield:toggleBubble', bounds),
  openShieldBubble:         (bounds)                     => ipcRenderer.invoke('shield:openBubble', bounds),
  closeShieldBubble:        ()                           => ipcRenderer.invoke('shield:closeBubble'),
  triggerExtensionAction:   (id)                         => ipcRenderer.invoke('extensions:triggerAction', id),
  togglePinExtension:       (id, pinned)                 => ipcRenderer.invoke('extensions:setPinned', id, pinned),
  onExtensionsUpdated:      (callback)                   => ipcRenderer.on('extensions:updated', (_, list) => callback(list)),

  // ─── Auto-Update (Chromium / electron-updater) ──────────────────────────────
  checkForUpdates:          ()                           => ipcRenderer.invoke('updater:check'),
  installUpdate:            ()                           => ipcRenderer.invoke('updater:install'),
  getUpdateStatus:          ()                           => ipcRenderer.invoke('updater:getStatus'),
  onUpdateStatus:           (callback)                   => ipcRenderer.on('updater:status', (_, data) => callback(data)),
};

contextBridge.exposeInMainWorld('mtcAPI', apiSurface);
contextBridge.exposeInMainWorld('shmmothAPI', apiSurface);
