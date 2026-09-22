const { contextBridge, ipcRenderer } = require('electron');

// Expose internal browser API unconditionally so Chrome UI & Internal Pages always work
contextBridge.exposeInMainWorld('mtcAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowState: (callback) => ipcRenderer.on('window:state', (event, state) => callback(state)),

  // Tab controls
  createTab: (url) => ipcRenderer.invoke('tab:create', url),
  closeTab: (tabId) => ipcRenderer.invoke('tab:close', tabId),
  switchTab: (tabId) => ipcRenderer.invoke('tab:switch', tabId),
  navigateTab: (tabId, url) => ipcRenderer.invoke('tab:navigate', tabId, url),
  navigateCurrentTab: (url) => ipcRenderer.invoke('tab:navigateCurrent', url),
  reloadTab: (tabId) => ipcRenderer.invoke('tab:reload', tabId),
  goBack: (tabId) => ipcRenderer.invoke('tab:goBack', tabId),
  goForward: (tabId) => ipcRenderer.invoke('tab:goForward', tabId),
  toggleDevTools: (tabId) => ipcRenderer.invoke('tab:toggleDevTools', tabId),

  // Events from Main Process
  onTabsUpdated: (callback) => ipcRenderer.on('tabs:updated', (event, tabs, activeTabId) => callback(tabs, activeTabId)),
  onNavigationState: (callback) => ipcRenderer.on('tab:navState', (event, state) => callback(state)),
  onAdsCountUpdate: (callback) => ipcRenderer.on('adblocker:count', (event, count) => callback(count)),

  // Storage / Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (delta) => ipcRenderer.invoke('settings:update', delta),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('bookmarks:get'),
  addBookmark: (bm) => ipcRenderer.invoke('bookmarks:add', bm),
  removeBookmark: (url) => ipcRenderer.invoke('bookmarks:remove', url),

  // History
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  deleteHistoryItem: (id) => ipcRenderer.invoke('history:deleteItem', id),

  // Shortcuts
  getShortcuts: () => ipcRenderer.invoke('shortcuts:get'),
  addShortcut: (shortcut) => ipcRenderer.invoke('shortcuts:add', shortcut),
  removeShortcut: (id) => ipcRenderer.invoke('shortcuts:remove', id),

  // Notes
  getNotes: () => ipcRenderer.invoke('notes:get'),
  saveNotes: (content) => ipcRenderer.invoke('notes:save', content),

  // Side Panel (AI & Notes)
  toggleSidePanel: (mode) => ipcRenderer.invoke('sidepanel:toggle', mode),
  getAdsBlockedCount: () => ipcRenderer.invoke('adblocker:getCount'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),

  // Downloads Bubble
  toggleDownloadBubble: (bounds) => ipcRenderer.invoke('download:toggleBubble', bounds),
  openDownloadBubble:   (bounds) => ipcRenderer.invoke('download:openBubble', bounds),
  closeDownloadBubble:  ()       => ipcRenderer.invoke('download:closeBubble'),

  // Auto-Update
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate:   () => ipcRenderer.invoke('updater:install'),
  getUpdateStatus: () => ipcRenderer.invoke('updater:getStatus'),
  onUpdateStatus:  (cb) => ipcRenderer.on('updater:status', (_, d) => cb(d))
});
