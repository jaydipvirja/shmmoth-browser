// Every IPC handler the browser windows and internal pages use.
// Methods of the browser application (ShmmothBrowserApp), moved here from main.js unchanged: browser/mixins.js adds
// them to the class, so `this` is the application as before.
'use strict';

const {
  app,
  BrowserWindow,
  protocol,
  ipcMain,
  session,
  dialog,
  path,
  AdBlockerService,
  PasswordGate,
  secureHandlerRaw,
  validateUrl,
  sanitizeString,
  getSenderUrl,
  checkNavigation,
  BROWSER_CHROME_URL,
  log,
  securityLogger,
  displayUrl,
  secureDns
} = require('./shared');
const { normalizeTheme } = require('../services/theme');
const { supportsMica } = require('../services/windowMaterial');
const defaultBrowser = require('../services/defaultBrowser');
const browserImport = require('../services/browserImport');

class IpcMethods {
  // ─── IPC Setup (Stage 1 Core) ────────────────────────────────────────────

  setupIpc() {
    // Window controls
    ipcMain.on('window:minimize', (event) => {
      const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : this.mainWindow;
      if (win) win.minimize();
    });
    ipcMain.on('window:maximize', (event) => {
      const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : this.mainWindow;
      if (win) {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      }
    });
    ipcMain.on('window:close', (event) => {
      const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : this.mainWindow;
      if (win) win.close();
    });

    // ── Window Management (Stage 4) ──
    ipcMain.handle('window:newIncognito', secureHandlerRaw(() => {
      this.createIncognitoWindow();
      return true;
    }));

    ipcMain.handle('window:isIncognito', secureHandlerRaw((event) => {
      const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : null;
      return Boolean(win && win === this.incognitoWindow);
    }));

    // what this computer offers (Settings shows the Mica switch only where Windows has it)
    ipcMain.handle('app:features', secureHandlerRaw(() => ({ mica: supportsMica() })));

    // Default browser (Settings → General): read-only status, and Windows' own page to choose it (fixed address)
    ipcMain.handle('defaultBrowser:status', secureHandlerRaw(() => defaultBrowser.getStatus()));
    ipcMain.handle('defaultBrowser:openSettings', secureHandlerRaw(async () => {
      const status = await defaultBrowser.getStatus();
      if (!status.supported || !status.registered) return false;
      const { shell } = require('electron');
      await shell.openExternal(defaultBrowser.settingsUrl(status.scope));
      return true;
    }));

    ipcMain.handle('window:isMaximized', secureHandlerRaw((event) => {
      const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : this.mainWindow;
      return win ? win.isMaximized() : false;
    }));

    ipcMain.handle('window:isFullScreen', secureHandlerRaw((event) => {
      const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : this.mainWindow;
      return win ? win.isFullScreen() : false;
    }));

    ipcMain.handle('window:setFullScreen', secureHandlerRaw((event, flag) => {
      const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : this.mainWindow;
      if (!win) return false;
      const target = (typeof flag === 'boolean') ? flag : !win.isFullScreen();
      win.setFullScreen(target);
      this.updateViewBounds(win);
      return target;
    }));

    // ── Tab operations ──
    ipcMain.handle('tab:create', secureHandlerRaw((event, url) => {
      const win = (event && event.sender) ? BrowserWindow.fromWebContents(event.sender) : null;
      const isIncognito = Boolean(win && win === this.incognitoWindow);
      const targetUrl = this.formatUrl(url);
      return this.createTab(targetUrl, null, false, isIncognito);
    }));

    ipcMain.handle('tab:close', secureHandlerRaw((_, tabId) => {
      sanitizeString(tabId, 64, 'tabId');
      return this.closeTab(tabId);
    }));

    ipcMain.handle('tab:switch', secureHandlerRaw((_, tabId) => {
      sanitizeString(tabId, 64, 'tabId');
      return this.switchTab(tabId);
    }));

    ipcMain.handle('tab:duplicate', secureHandlerRaw((_, tabId) => {
      sanitizeString(tabId, 64, 'tabId');
      return this.duplicateTab(tabId);
    }));

    ipcMain.handle('tab:togglePin', secureHandlerRaw((_, tabId) => {
      sanitizeString(tabId, 64, 'tabId');
      return this.togglePinTab(tabId);
    }));

    ipcMain.handle('tab:reorder', secureHandlerRaw((_, tabId, targetIndex) => {
      sanitizeString(tabId, 64, 'tabId');
      const idx = Number(targetIndex);
      return this.reorderTabs(tabId, isNaN(idx) ? 0 : idx);
    }));

    ipcMain.handle('tab:closeOthers', secureHandlerRaw((_, tabId) => {
      sanitizeString(tabId, 64, 'tabId');
      return this.closeOtherTabs(tabId);
    }));

    ipcMain.handle('tab:closeToRight', secureHandlerRaw((_, tabId) => {
      sanitizeString(tabId, 64, 'tabId');
      return this.closeTabsToRight(tabId);
    }));

    ipcMain.handle('tab:reopenClosed', secureHandlerRaw(() => {
      return this.reopenClosedTab();
    }));

    ipcMain.handle('tab:stop', secureHandlerRaw((_, tabId) => {
      sanitizeString(tabId, 64, 'tabId');
      return this.stopTab(tabId);
    }));

    ipcMain.handle('tab:toggleMute', secureHandlerRaw((_, tabId) => {
      sanitizeString(tabId, 64, 'tabId');
      return this.toggleMuteTab(tabId);
    }));

    ipcMain.handle('tab:reloadIgnoringCache', secureHandlerRaw((_, tabId) => {
      sanitizeString(tabId, 64, 'tabId');
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view) {
        if (tab.isCrashed || (tab.url && tab.url.startsWith('mtc://crash'))) {
          tab.isCrashed = false;
          const target = tab.lastValidUrl && !tab.lastValidUrl.startsWith('mtc://crash') ? tab.lastValidUrl : 'mtc://newtab';
          tab.view.webContents.loadURL(target);
          return;
        }
      }
      return this.reloadTabIgnoringCache(tabId);
    }));

    ipcMain.handle('tab:navigate', secureHandlerRaw((_, tabId, targetUrl) => {
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view) {
        const safeUrl = this.formatUrl(validateUrl(targetUrl));
        if (safeUrl.startsWith('mtc://') && (!tab.url || !tab.url.startsWith('mtc://'))) {
          return this.createTab(safeUrl, tab.id, false, tab.isIncognito);
        }
        // IPC navigations are initiated by browser chrome UI
        const result  = checkNavigation(BROWSER_CHROME_URL, safeUrl);
        if (!result.allowed) {
          securityLogger.security(`IPC tab:navigate blocked`, { reason: result.reason });
          return { success: false, error: result.reason };
        }
        tab.pendingLoadUrl = null;
        tab.view.webContents.loadURL(safeUrl);
      }
    }));

    ipcMain.handle('tab:navigateCurrent', secureHandlerRaw((_, targetUrl) => {
      const tab = this.tabs[this.activeTabId];
      if (tab && tab.view) {
        const safeUrl = this.formatUrl(validateUrl(targetUrl));
        if (safeUrl.startsWith('mtc://') && (!tab.url || !tab.url.startsWith('mtc://'))) {
          return this.createTab(safeUrl, tab.id, false, tab.isIncognito);
        }
        // IPC navigations are initiated by browser chrome UI
        const result  = checkNavigation(BROWSER_CHROME_URL, safeUrl);
        if (!result.allowed) {
          securityLogger.security(`IPC tab:navigateCurrent blocked`, { reason: result.reason });
          return;
        }
        tab.view.webContents.loadURL(safeUrl);
      }
    }));

    ipcMain.handle('tab:reload', secureHandlerRaw((_, tabId) => {
      this.reloadTab(tabId);
    }));

    ipcMain.handle('tab:goBack', secureHandlerRaw((_, tabId) => {
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view) {
        const wc = tab.view.webContents;
        if (wc.navigationHistory && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        else if (wc.canGoBack && wc.canGoBack()) wc.goBack();
      }
    }));

    ipcMain.handle('tab:goForward', secureHandlerRaw((_, tabId) => {
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view) {
        const wc = tab.view.webContents;
        if (wc.navigationHistory && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
        else if (wc.canGoForward && wc.canGoForward()) wc.goForward();
      }
    }));

    ipcMain.handle('tab:toggleDevTools', secureHandlerRaw((_, tabId) => {
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view) tab.view.webContents.toggleDevTools();
    }));

    ipcMain.handle('tab:print', secureHandlerRaw((_, tabId) => {
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view && tab.view.webContents) {
        tab.view.webContents.print();
        return true;
      }
      return false;
    }));

    // ── Find in Page (Stage 3) ──
    ipcMain.handle('find:start', secureHandlerRaw((_, tabId, text, options) => {
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view && tab.view.webContents && text) {
        const safeText = sanitizeString(text, 500, 'text');
        const forward = options && options.forward !== undefined ? Boolean(options.forward) : true;
        const matchCase = options && options.matchCase !== undefined ? Boolean(options.matchCase) : false;
        const findNext = options && options.findNext !== undefined ? Boolean(options.findNext) : false;
        return tab.view.webContents.findInPage(safeText, { forward, matchCase, findNext });
      }
      return null;
    }));

    ipcMain.handle('find:next', secureHandlerRaw((_, tabId, text, forward) => {
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view && tab.view.webContents && text) {
        const safeText = sanitizeString(text, 500, 'text');
        return tab.view.webContents.findInPage(safeText, { forward: forward !== false, findNext: true });
      }
      return null;
    }));

    ipcMain.handle('find:stop', secureHandlerRaw((_, tabId, action) => {
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view && tab.view.webContents) {
        const validActions = ['clearSelection', 'keepSelection', 'activateSelection'];
        const safeAction = validActions.includes(action) ? action : 'clearSelection';
        tab.view.webContents.stopFindInPage(safeAction);
        return true;
      }
      return false;
    }));

    // ── Zoom (Stage 3) ──
    ipcMain.handle('zoom:in', secureHandlerRaw((_, tabId) => {
      return this.zoomIn(tabId || this.activeTabId);
    }));

    ipcMain.handle('zoom:out', secureHandlerRaw((_, tabId) => {
      return this.zoomOut(tabId || this.activeTabId);
    }));

    ipcMain.handle('zoom:reset', secureHandlerRaw((_, tabId) => {
      return this.resetZoom(tabId || this.activeTabId);
    }));

    ipcMain.handle('zoom:get', secureHandlerRaw((_, tabId) => {
      return this.getZoomFactor(tabId || this.activeTabId);
    }));

    // ── Side panel ──
    ipcMain.handle('sidepanel:toggle', secureHandlerRaw((_, mode) => {
      const safeMode = sanitizeString(mode || 'notes', 32, 'mode');
      return this.toggleSidePanel(safeMode);
    }));

    // ── Settings ──
    ipcMain.handle('settings:get', secureHandlerRaw(() => {
      return this.storage.getSettings();
    }));

    ipcMain.handle('settings:update', secureHandlerRaw((_, delta) => {
      if (typeof delta !== 'object' || delta === null || Array.isArray(delta)) {
        throw new Error('settings:update requires a plain object');
      }
      if (delta.theme !== undefined) delta = { ...delta, theme: normalizeTheme(delta.theme) };
      const updated = this.storage.updateSettings(delta);
      if (delta.adBlockerAllowlist !== undefined && this.adBlocker) {
        this.adBlocker.reloadAllowlist();
      }
      if (delta.adBlockerCustomFilters !== undefined && this.adBlocker) {
        this.adBlocker.reloadCustomFilters();
      }
      if (delta.adBlockerEnabled !== undefined && this.adBlocker) {
        this.adBlocker.setEnabled(delta.adBlockerEnabled);
      }
      if (delta.micaEffect !== undefined) this.applyWindowMaterial();
      if (delta.showBookmarksBar !== undefined) {
        this.updateHeaderHeight(true);
        this.updateViewBounds();
      }
      if (delta.theme !== undefined) {
        try {
          const { nativeTheme } = require('electron');
          nativeTheme.themeSource = delta.theme;
        } catch (_) {}
        this.broadcastThemeChange(delta.theme);
      }
      this.broadcastSettingsUpdated(updated);
      return updated;
    }));

    // ── Bookmarks (Stage 2) ──
    ipcMain.handle('bookmarks:get', secureHandlerRaw((_, filter) => {
      return this.storage.getBookmarks(filter);
    }));

    ipcMain.handle('bookmarks:getFolders', secureHandlerRaw(() => {
      return this.storage.getBookmarkFolders();
    }));

    ipcMain.handle('bookmarks:addFolder', secureHandlerRaw((_, name) => {
      return this.storage.addBookmarkFolder(sanitizeString(name || '', 100, 'name'));
    }));

    ipcMain.handle('bookmarks:removeFolder', secureHandlerRaw((_, name) => {
      return this.storage.removeBookmarkFolder(sanitizeString(name || '', 100, 'name'));
    }));

    // Import from Chrome / Edge / Brave on this computer: only a browser and profile that detect() offered
    ipcMain.handle('import:detect', secureHandlerRaw(() => browserImport.detect()));
    ipcMain.handle('import:run', secureHandlerRaw((_, req) => {
      if (!req || typeof req !== 'object') throw new Error('Invalid import request');
      const browserId = sanitizeString(req.browserId, 16, 'browserId');
      const profileDir = sanitizeString(req.profileDir, 64, 'profileDir');
      try {
        const result = browserImport.runImport(this.storage, { browserId, profileDir, bookmarks: req.bookmarks !== false, history: req.history !== false });
        log.info('Imported from another browser', { browser: browserId, bookmarks: result.bookmarks, history: result.history });
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('bookmarks:add', secureHandlerRaw((_, bm) => {
      if (!bm || typeof bm !== 'object') throw new Error('Invalid bookmark object');
      return this.storage.addBookmark(bm);
    }));

    ipcMain.handle('bookmarks:edit', secureHandlerRaw((_, id, updates) => {
      sanitizeString(id, 64, 'id');
      if (!updates || typeof updates !== 'object') throw new Error('Invalid bookmark updates');
      return this.storage.editBookmark(id, updates);
    }));

    ipcMain.handle('bookmarks:move', secureHandlerRaw((_, id, folder) => {
      sanitizeString(id, 64, 'id');
      return this.storage.moveBookmark(id, sanitizeString(folder || '', 100, 'folder'));
    }));

    ipcMain.handle('bookmarks:remove', secureHandlerRaw((_, urlOrId) => {
      return this.storage.removeBookmark(sanitizeString(urlOrId, 2048, 'urlOrId'));
    }));

    ipcMain.handle('bookmarks:search', secureHandlerRaw((_, query) => {
      return this.storage.searchBookmarks(sanitizeString(query || '', 200, 'query'));
    }));

    // ── History (Stage 2) ──
    ipcMain.handle('history:get', secureHandlerRaw((_, query) => {
      const q = typeof query === 'string' ? sanitizeString(query, 200, 'query') : '';
      return this.storage.getHistory(q);
    }));

    ipcMain.handle('history:clear', secureHandlerRaw(() => {
      return this.storage.clearHistory();
    }));

    ipcMain.handle('history:clearByRange', secureHandlerRaw((_, range) => {
      return this.storage.clearHistoryByRange(sanitizeString(range || 'all', 32, 'range'));
    }));

    ipcMain.handle('history:deleteItem', secureHandlerRaw((_, id) => {
      return this.storage.deleteHistoryItem(sanitizeString(id, 64, 'id'));
    }));

    ipcMain.handle('history:deleteItems', secureHandlerRaw((_, ids) => {
      if (!Array.isArray(ids)) throw new Error('ids must be an array');
      const safeIds = ids.map(id => sanitizeString(id, 64, 'id'));
      return this.storage.deleteHistoryItems(safeIds);
    }));

    // ── Shortcuts ──
    ipcMain.handle('shortcuts:get',    secureHandlerRaw(() => this.storage.getShortcuts()));
    ipcMain.handle('shortcuts:add',    secureHandlerRaw((_, sc) => {
      if (!sc || typeof sc !== 'object') throw new Error('Invalid shortcut object');
      return this.storage.addShortcut(sc);
    }));
    ipcMain.handle('shortcuts:remove', secureHandlerRaw((_, id) => {
      return this.storage.removeShortcut(sanitizeString(id, 64, 'id'));
    }));

    // ── Notes ──
    ipcMain.handle('notes:get',  secureHandlerRaw(() => this.storage.getNotes()));
    ipcMain.handle('notes:save', secureHandlerRaw((_, content) => {
      if (typeof content !== 'string') throw new Error('Notes content must be a string');
      return this.storage.saveNotes(content.slice(0, 1_000_000));
    }));

    // ── Ad Blocker ──
    ipcMain.handle('adblocker:getStatus', secureHandlerRaw(() => {
      return this.adBlocker ? this.adBlocker.getStatus() : null;
    }));

    ipcMain.handle('adblocker:updateLists', secureHandlerRaw(() => {
      return this.adBlocker ? this.adBlocker.refresh({ force: true }) : null;
    }));

    // Reports from the gesture script (preload-gesture.js, runs in every frame of every web page)
    ipcMain.on('shmmoth:gesture', (event) => { if (this.popupPolicy && event.sender) this.popupPolicy.noteGesture(event.sender.id); });
    ipcMain.on('shmmoth:gesture-ready', (event) => { if (this.popupPolicy && event.sender) this.popupPolicy.noteReady(event.sender.id); });

    ipcMain.handle('adblocker:getCount', secureHandlerRaw(() => {
      return this.adBlocker ? this.adBlocker.getBlockedCount() : 0;
    }));

    // ── Cache ──
    ipcMain.handle('cache:clear', secureHandlerRaw(async () => {
      await session.defaultSession.clearCache();
      log.info('Browser cache cleared by user');
      return true;
    }));

    // ── Downloads (Stage 3 & Download Engine) ──
    ipcMain.handle('download:getAll', secureHandlerRaw((event) => {
      const isIncognito = this.isIncognitoSender(event.sender);
      return this.downloads ? this.downloads.getDownloads({ includeIncognito: isIncognito }) : [];
    }));

    ipcMain.handle('download:pause', secureHandlerRaw((_, id) => {
      return this.downloads
        ? this.downloads.pauseDownload(sanitizeString(id, 64, 'id'))
        : false;
    }));

    ipcMain.handle('download:resume', secureHandlerRaw((_, id) => {
      return this.downloads
        ? this.downloads.resumeDownload(sanitizeString(id, 64, 'id'))
        : false;
    }));

    ipcMain.handle('download:cancel', secureHandlerRaw((_, id) => {
      return this.downloads
        ? this.downloads.cancelDownload(sanitizeString(id, 64, 'id'))
        : false;
    }));

    ipcMain.handle('download:openFile', secureHandlerRaw((_, id) => {
      return this.downloads
        ? this.downloads.openFile(sanitizeString(id, 64, 'id'))
        : { success: false, error: 'Download manager not available' };
    }));

    ipcMain.handle('download:showInFolder', secureHandlerRaw((_, id) => {
      return this.downloads
        ? this.downloads.showInFolder(sanitizeString(id, 64, 'id'))
        : false;
    }));

    ipcMain.handle('download:remove', secureHandlerRaw((_, id) => {
      return this.downloads
        ? this.downloads.removeDownload(sanitizeString(id, 64, 'id'))
        : false;
    }));

    ipcMain.handle('download:clearCompleted', secureHandlerRaw(() => {
      return this.downloads ? this.downloads.clearCompleted() : 0;
    }));

    ipcMain.handle('download:openDownloadsFolder', secureHandlerRaw(() => {
      return this.downloads ? this.downloads.openDownloadsFolder() : false;
    }));

    ipcMain.handle('download:retry', secureHandlerRaw(async (event, url) => {
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'Invalid URL for download retry' };
      }
      try {
        const isIncognito = this.isIncognitoSender(event.sender);
        // Always Chromium's own downloader: it is the most compatible one, and a retry follows a failure
        if (!this.downloads.retryDownload(url, isIncognito)) {
          return { success: false, error: 'Downloads are not available right now' };
        }
        log.info('Download retried with the standard downloader', { url: url.slice(0, 100), isIncognito });
        return { success: true };
      } catch (err) {
        log.error('Failed to retry download', { url, error: err.message });
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('download:chooseDirectory', secureHandlerRaw(async (event) => {
      const win = (event && event.sender && BrowserWindow.fromWebContents(event.sender)) || this.mainWindow;
      const res = await dialog.showOpenDialog(win, {
        title: 'Select Download Folder',
        properties: ['openDirectory', 'createDirectory']
      });
      if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
        const chosen = res.filePaths[0];
        if (this.downloads) {
          this.downloads.setSaveDir(chosen);
        }
        return { success: true, path: chosen };
      }
      return { success: false, cancelled: true };
    }));

    ipcMain.handle('download:toggleBubble', secureHandlerRaw((event, bounds) => {
      const isIncognito = this.isIncognitoSender(event.sender);
      return this.toggleDownloadBubble(bounds, isIncognito);
    }));

    ipcMain.handle('download:openBubble', secureHandlerRaw((event, bounds) => {
      const isIncognito = this.isIncognitoSender(event.sender);
      return this.openDownloadBubble(bounds, isIncognito);
    }));

    ipcMain.handle('download:closeBubble', secureHandlerRaw(() => {
      this.closeDownloadBubble();
      return true;
    }));

    ipcMain.handle('download:startTurbo', secureHandlerRaw(async (event, opts) => {
      if (!this.downloads) return { success: false, error: 'Download manager unavailable' };
      try {
        const isIncognito = this.isIncognitoSender(event.sender);
        const record = await this.downloads.startTurboDownload({
          ...opts,
          isIncognito,
          webContents: event.sender
        });
        return { success: true, record };
      } catch (err) {
        log.error('Failed to start manual Turbo download', { error: err.message });
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('download:getTurboState', secureHandlerRaw(async () => {
      if (!this.downloads) return { isTurboEnabled: false, interfaces: [] };
      return {
        isTurboEnabled: this.downloads.isTurboEnabled(),
        isMultiSourceEnabled: this.downloads.isMultiSourceEnabled(),
        turboThreads: this.downloads.getTurboThreads(),
        // getNetworkInterfaces() is asynchronous: handing the Promise itself to IPC made the whole call fail
        interfaces: await this.downloads.getNetworkInterfaces()
      };
    }));

    // Settings → Downloads → "Check": what this computer needs for multi-network downloads (read-only checks)
    ipcMain.handle('download:multiNetworkCheck', secureHandlerRaw(async () => {
      const TurboDownloadEngine = require('../services/turboDownloadEngine');
      const check = require('../services/multiNetworkCheck');
      const settings = this.storage.getSettings();
      const [interfaces, policy] = await Promise.all([TurboDownloadEngine.getAvailableNetworkInterfacesAsync(), check.readMinimizePolicy()]);
      return check.evaluate({
        interfaces, policy,
        proxyActive: this.downloads ? this.downloads.isProxyActive(false) : false,
        turboOn: settings.turboDownloadEnabled !== false,
        multiOn: settings.multiSourceBonding !== false
      });
    }));

    ipcMain.handle('download:getNetworkInterfaces', secureHandlerRaw(() => {
      return this.downloads ? this.downloads.getNetworkInterfaces() : [];
    }));

    // ── Cookies & Site Data (Stage 4) ──
    ipcMain.handle('cookies:getAll', secureHandlerRaw(async (event, partition) => {
      const sess = (partition === 'incognito') ? session.fromPartition('incognito') : session.defaultSession;
      try {
        const raw = await sess.cookies.get({});
        return raw.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: Boolean(c.secure),
          httpOnly: Boolean(c.httpOnly),
          session: Boolean(c.session),
          expirationDate: c.expirationDate || null
        }));
      } catch (err) {
        log.warn('cookies:getAll failed', { error: err.message });
        return [];
      }
    }));

    ipcMain.handle('cookies:remove', secureHandlerRaw(async (event, cookie, partition) => {
      if (!cookie || !cookie.domain || !cookie.name) {
        throw new Error('Invalid cookie parameter');
      }
      const sess = (partition === 'incognito') ? session.fromPartition('incognito') : session.defaultSession;
      const protocol = cookie.secure ? 'https://' : 'http://';
      const cleanDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
      const url = `${protocol}${cleanDomain}${cookie.path || '/'}`;
      try {
        await sess.cookies.remove(url, cookie.name);
        return { success: true };
      } catch (err) {
        log.warn('cookies:remove failed', { error: err.message });
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('cookies:clear', secureHandlerRaw(async (event, partition) => {
      const sess = (partition === 'incognito') ? session.fromPartition('incognito') : session.defaultSession;
      try {
        await sess.clearStorageData({ storages: ['cookies'] });
        return { success: true };
      } catch (err) {
        log.warn('cookies:clear failed', { error: err.message });
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('cookies:import', secureHandlerRaw(async (event, cookieData, partition) => {
      const sess = (partition === 'incognito') ? session.fromPartition('incognito') : session.defaultSession;
      let cookieList = cookieData;
      if (typeof cookieData === 'string') {
        try {
          cookieList = JSON.parse(cookieData.trim());
        } catch (e) {
          throw new Error('Invalid JSON format: ' + e.message);
        }
      }
      if (!Array.isArray(cookieList)) {
        throw new Error('Cookie data must be a JSON array of cookies');
      }

      let imported = 0;
      const affectedDomains = new Set();

      for (const c of cookieList) {
        if (!c || !c.name || (!c.domain && !c.host_key)) continue;
        const rawDomain = c.domain || c.host_key;
        const cleanDomain = rawDomain.replace(/^\./, '');
        const isSecure = (c.secure === true || c.secure === 'true' || c.is_secure === 1);
        const protocol = isSecure ? 'https://' : 'http://';
        const cookiePath = c.path || '/';
        const url = `${protocol}${cleanDomain}${cookiePath}`;

        try {
          const cookieObj = {
            url,
            name: String(c.name),
            value: String(c.value !== undefined ? c.value : ''),
            path: cookiePath,
            secure: isSecure,
            httpOnly: Boolean(c.httpOnly || c.http_only || c.is_httponly)
          };

          if (rawDomain.startsWith('.')) {
            cookieObj.domain = rawDomain;
          }

          if (c.sameSite) {
            const ss = String(c.sameSite).toLowerCase();
            if (ss === 'lax' || ss === 'strict' || ss === 'no_restriction') {
              cookieObj.sameSite = ss;
            }
          }

          if (c.expirationDate && typeof c.expirationDate === 'number') {
            if (c.expirationDate > Math.floor(Date.now() / 1000)) {
              cookieObj.expirationDate = Math.floor(c.expirationDate);
            }
          }

          await sess.cookies.set(cookieObj);
          imported++;
          affectedDomains.add(cleanDomain);
        } catch (err) {
          log.warn('Failed to set imported cookie', { name: c.name, domain: rawDomain, error: err.message });
        }
      }

      log.info('Session cookies imported successfully', { count: imported, domains: Array.from(affectedDomains) });
      return { success: true, count: imported, domains: Array.from(affectedDomains) };
    }));

    // ── Clear Browsing Data (Stage 4) ──
    ipcMain.handle('browsingData:clear', secureHandlerRaw(async (event, options) => {
      const safeOptions = options || {};
      const range = sanitizeString(safeOptions.range || 'all', 32, 'range');
      const types = safeOptions.dataTypes || { history: true, downloads: true, cookies: true, cache: true };

      const results = {};

      if (types.history) {
        results.history = this.storage.clearHistoryByRange(range);
      }

      if (types.downloads && this.downloads) {
        results.downloads = this.downloads.clearCompleted();
      }

      if (types.cookies) {
        try {
          await session.defaultSession.clearStorageData({ storages: ['cookies'] });
          results.cookies = true;
        } catch (_) {
          results.cookies = false;
        }
      }

      if (types.cache) {
        try {
          await session.defaultSession.clearCache();
          await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'shadercache'] });
          results.cache = true;
        } catch (_) {
          results.cache = false;
        }
      }

      log.info('Browsing data cleared', { range, types, results });
      return { success: true, results };
    }));

    // ── Site Permissions & Content Settings (Stage 5) ──
    ipcMain.handle('permissions:getForOrigin', secureHandlerRaw((event, origin) => {
      const safeOrigin = sanitizeString(origin || '', 256, 'origin');
      return this.storage ? this.storage.getSitePermissions(safeOrigin) : {};
    }));

    ipcMain.handle('permissions:getAll', secureHandlerRaw(() => {
      return this.storage ? this.storage.getSitePermissions() : {};
    }));

    ipcMain.handle('permissions:set', secureHandlerRaw((event, origin, permission, decision) => {
      const safeOrigin = sanitizeString(origin || '', 256, 'origin');
      const safePerm   = sanitizeString(permission || '', 64, 'permission');
      const safeDec    = sanitizeString(decision || 'ask', 16, 'decision');
      if (this.storage) {
        return this.storage.setSitePermission(safeOrigin, safePerm, safeDec);
      }
      return false;
    }));

    ipcMain.handle('permissions:remove', secureHandlerRaw((event, origin, permission) => {
      const safeOrigin = sanitizeString(origin || '', 256, 'origin');
      const safePerm   = permission ? sanitizeString(permission, 64, 'permission') : null;
      if (this.storage) {
        return this.storage.removeSitePermission(safeOrigin, safePerm);
      }
      return false;
    }));

    ipcMain.handle('permissions:clearAll', secureHandlerRaw(() => {
      if (this.storage) {
        return this.storage.clearAllSitePermissions();
      }
      return false;
    }));

    ipcMain.handle('permissions:respond', secureHandlerRaw((event, requestId, decision, remember) => {
      const safeReqId = sanitizeString(requestId || '', 64, 'requestId');
      const pending = this.pendingPermissionRequests[safeReqId];
      if (!pending) {
        return { success: false, error: 'Permission request expired or invalid' };
      }

      clearTimeout(pending.timeout);
      delete this.pendingPermissionRequests[safeReqId];

      const isAllowed = (decision === 'allow');
      if (remember && pending.origin && this.storage) {
        this.storage.setSitePermission(pending.origin, pending.permission, isAllowed ? 'allow' : 'block');
      }

      try {
        pending.callback(isAllowed);
      } catch (err) {
        log.warn('Permission callback execution failed', { error: err.message });
      }

      this.closePermissionBubble();
      return { success: true };
    }));

    ipcMain.handle('permissions:openBubble', secureHandlerRaw((event, data) => {
      return this.openPermissionBubble(data, this.isIncognitoSender(event.sender));
    }));

    ipcMain.handle('permissions:closeBubble', secureHandlerRaw(() => {
      this.closePermissionBubble();
      return true;
    }));

    // ── Password Manager (Stage 6) ──
    ipcMain.handle('passwords:getAll', secureHandlerRaw(() => {
      return this.passwordVault ? this.passwordVault.getAllCredentialsMetadata() : [];
    }));

    ipcMain.handle('passwords:getForOrigin', secureHandlerRaw((event, origin) => {
      const safeOrigin = sanitizeString(origin || '', 255, 'origin');
      return this.passwordVault ? this.passwordVault.getCredentialsForOrigin(safeOrigin) : [];
    }));

    ipcMain.handle('passwords:save', secureHandlerRaw(async (event, cred) => {
      if (!this.passwordVault || !cred || typeof cred !== 'object') {
        return { success: false, error: 'Invalid password vault or credential' };
      }
      const safeOrigin = sanitizeString(cred.origin || '', 255, 'origin');
      const safeUser = sanitizeString(cred.username || '', 255, 'username');
      const safePass = cred.password;
      if (!safeOrigin || !safeUser || !safePass) {
        return { success: false, error: 'Origin, username, and password are required' };
      }
      try {
        const saved = this.passwordVault.saveCredential({
          origin: safeOrigin,
          username: safeUser,
          password: safePass,
        });
        return { success: true, credential: saved };
      } catch (err) {
        return { success: false, error: err.message, code: err.code };
      }
    }));

    ipcMain.handle('passwords:update', secureHandlerRaw(async (event, id, updates) => {
      if (!this.passwordVault) return { success: false, error: 'Password vault unavailable' };
      const safeId = sanitizeString(id || '', 64, 'id');
      try {
        const updated = this.passwordVault.updateCredential(safeId, updates);
        return { success: Boolean(updated), credential: updated };
      } catch (err) {
        return { success: false, error: err.message, code: err.code };
      }
    }));

    ipcMain.handle('passwords:delete', secureHandlerRaw(async (event, id) => {
      if (!this.passwordVault) return { success: false };
      const safeId = sanitizeString(id || '', 64, 'id');
      const deleted = this.passwordVault.deleteCredential(safeId);
      return { success: deleted };
    }));

    ipcMain.handle('passwords:clearAll', secureHandlerRaw(async () => {
      if (!this.passwordVault) return { success: false };
      this.passwordVault.clearAllCredentials();
      return { success: true };
    }));

    // Showing or copying a password: only from Settings → Passwords, only after the user confirmed in a native window.
    const gateMessages = {
      cancelled: 'Cancelled.',
      busy: 'Another confirmation is already open.',
      rate: 'Too many requests — wait a moment and try again.',
      error: 'The confirmation could not be shown.'
    };
    const askGate = async (event, id, purpose) => {
      if (!this.passwordVault || !this.passwordGate) return { error: { success: false, error: 'Password vault unavailable' } };
      if (!/^mtc:\/\/settings(?:[/?#]|$)/.test(getSenderUrl(event) || '')) {
        securityLogger.security('Password request from outside Settings refused', { from: String(getSenderUrl(event)).slice(0, 80) });
        return { error: { success: false, error: 'Passwords can only be shown from Settings.' } };
      }
      const safeId = sanitizeString(id || '', 64, 'id');
      const credential = this.passwordVault.getCredentialById(safeId);
      if (!credential) return { error: { success: false, error: 'Credential not found or decryption failed' } };
      const parent = BrowserWindow.fromWebContents(event.sender) || this.mainWindow;
      const gate = await this.passwordGate.authorize(purpose, credential, { parent });
      if (!gate.ok) return { error: { success: false, cancelled: gate.reason === 'cancelled', error: gateMessages[gate.reason] || gateMessages.error } };
      const plaintext = this.passwordVault.decryptForAuthorizedUse(safeId);
      if (plaintext === null) return { error: { success: false, error: 'Credential not found or decryption failed' } };
      log.info(purpose === 'copy' ? 'Saved password copied' : 'Saved password shown', { origin: credential.origin });   // never the password itself
      return { plaintext };
    };

    ipcMain.handle('passwords:reveal', secureHandlerRaw(async (event, id) => {
      const r = await askGate(event, id, 'show');
      if (r.error) return r.error;
      return { success: true, password: r.plaintext, hideAfterMs: PasswordGate.REVEAL_HIDE_MS };
    }));

    // The password goes from the vault straight to the clipboard; the page never sees it
    ipcMain.handle('passwords:copy', secureHandlerRaw(async (event, id) => {
      const r = await askGate(event, id, 'copy');
      if (r.error) return r.error;
      const ok = await this.passwordGate.copyToClipboard(r.plaintext);
      return ok ? { success: true, clearAfterMs: PasswordGate.CLIPBOARD_CLEAR_MS } : { success: false, error: 'The password could not be copied.' };
    }));

    ipcMain.handle('passwords:respondPrompt', secureHandlerRaw(async (event, promptId, action) => {
      const safePromptId = sanitizeString(promptId || '', 64, 'promptId');
      const safeAction = sanitizeString(action || '', 32, 'action');
      return this._handlePasswordPromptResponse(safePromptId, safeAction);
    }));

    ipcMain.handle('passwords:getActivePrompt', secureHandlerRaw(() => {
      return this.currentPasswordPrompt;
    }));

    ipcMain.handle('passwords:closeBubble', secureHandlerRaw(() => {
      this.closePasswordBubble();
      return true;
    }));

    // ── Password autofill chooser (only the chooser window itself may talk to it) ──
    ipcMain.handle('passwordAutofill:getChooser', secureHandlerRaw((event) => {
      return this.passwordAutofill ? this.passwordAutofill.getChooser(event.sender) : null;
    }));

    ipcMain.handle('passwordAutofill:choose', secureHandlerRaw(async (event, promptId, credentialId) => {
      if (!this.passwordAutofill) return { success: false, error: 'Unavailable' };
      return this.passwordAutofill.choose(
        sanitizeString(promptId || '', 64, 'promptId'),
        sanitizeString(credentialId || '', 64, 'credentialId'),
        event.sender
      );
    }));

    ipcMain.handle('passwordAutofill:dismiss', secureHandlerRaw((event) => {
      if (this.passwordAutofill && this.passwordAutofill._fromBubble(event.sender)) this.passwordAutofill.dismiss();
      return true;
    }));

    // ── Form autofill chooser (only the chooser window itself may talk to it) ──
    ipcMain.handle('formAutofill:getChooser', secureHandlerRaw((event) => {
      return this.formAutofill ? this.formAutofill.getChooser(event.sender) : null;
    }));

    ipcMain.handle('formAutofill:choose', secureHandlerRaw(async (event, promptId, profileId) => {
      if (!this.formAutofill) return { success: false, error: 'Unavailable' };
      return this.formAutofill.choose(
        sanitizeString(promptId || '', 64, 'promptId'),
        sanitizeString(profileId || '', 64, 'profileId'),
        event.sender
      );
    }));

    ipcMain.handle('formAutofill:dismiss', secureHandlerRaw((event) => {
      if (this.formAutofill && this.formAutofill._fromBubble(event.sender)) this.formAutofill.dismiss();
      return true;
    }));

    // ── Form Autofill (Stage 6) ──
    ipcMain.handle('autofill:getProfiles', secureHandlerRaw(() => {
      return this.autofillService ? this.autofillService.getProfiles() : [];
    }));

    ipcMain.handle('autofill:saveProfile', secureHandlerRaw(async (event, profile) => {
      if (!this.autofillService || !profile) return { success: false, error: 'Invalid profile data' };
      const created = this.autofillService.saveProfile(profile);
      return { success: true, profile: created };
    }));

    ipcMain.handle('autofill:updateProfile', secureHandlerRaw(async (event, id, updates) => {
      if (!this.autofillService) return { success: false };
      const safeId = sanitizeString(id || '', 64, 'id');
      const updated = this.autofillService.updateProfile(safeId, updates);
      return { success: Boolean(updated), profile: updated };
    }));

    ipcMain.handle('autofill:deleteProfile', secureHandlerRaw(async (event, id) => {
      if (!this.autofillService) return { success: false };
      const safeId = sanitizeString(id || '', 64, 'id');
      const deleted = this.autofillService.deleteProfile(safeId);
      return { success: deleted };
    }));

    ipcMain.handle('autofill:clearAll', secureHandlerRaw(async () => {
      if (!this.autofillService) return { success: false };
      this.autofillService.clearAllProfiles();
      return { success: true };
    }));

    ipcMain.handle('autofill:isEnabled', secureHandlerRaw(() => {
      return this.autofillService ? this.autofillService.isAutofillEnabled() : false;
    }));

    ipcMain.handle('autofill:setEnabled', secureHandlerRaw((event, enabled) => {
      if (this.autofillService) {
        this.autofillService.setAutofillEnabled(Boolean(enabled));
      }
      return { success: true, enabled: Boolean(enabled) };
    }));

    ipcMain.handle('autofill:getSuggestions', secureHandlerRaw((event, fieldType, prefix) => {
      if (!this.autofillService) return [];
      const safeField = sanitizeString(fieldType || '', 64, 'fieldType');
      const safePrefix = sanitizeString(prefix || '', 128, 'prefix');
      return this.autofillService.getFieldSuggestions(safeField, safePrefix);
    }));

    // ── Proxy & Network Configuration (Stage 6) ──
    ipcMain.handle('proxy:get', secureHandlerRaw(() => {
      return this.proxyManager ? this.proxyManager.getPublicConfig() : { mode: 'system' };
    }));

    ipcMain.handle('proxy:save', secureHandlerRaw(async (event, config) => {
      if (!this.proxyManager) return { success: false, error: 'Proxy manager unavailable' };
      try {
        const publicCfg = this.proxyManager.setConfig(config);
        await this.applyProxyToAllSessions();
        return { success: true, config: publicCfg };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('proxy:test', secureHandlerRaw(async (event, testConfig) => {
      if (!this.proxyManager) return { success: false, error: 'Proxy manager unavailable' };
      try {
        const result = await this.proxyManager.testConnection(testConfig);
        return result;
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('proxy:reset', secureHandlerRaw(async () => {
      if (!this.proxyManager) return { success: false };
      const res = await this.proxyManager.resetToSystem();
      await this.applyProxyToAllSessions();
      return { success: true, config: res };
    }));

    // ─── Extension Management (Stage 7) ───────────────────────────────────
    ipcMain.handle('extensions:getAll', secureHandlerRaw(() => {
      if (!this.extensionManager) return { extensions: [], developerMode: false };
      return {
        extensions: this.extensionManager.getAllExtensions(),
        developerMode: this.extensionManager.isDeveloperMode()
      };
    }));

    ipcMain.handle('extensions:getDetails', secureHandlerRaw((_, id) => {
      if (!this.extensionManager) return null;
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      return this.extensionManager.getExtensionDetails(safeId);
    }));

    ipcMain.handle('extensions:validate', secureHandlerRaw(async (_, folderPath) => {
      if (!this.extensionManager) return { valid: false, error: 'Extension manager unavailable' };
      try {
        const safePath = sanitizeString(folderPath || '', 512, 'folderPath');
        const result = this.extensionManager.validateExtension(safePath);
        return { success: true, validation: result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('extensions:install', secureHandlerRaw(async (_, folderPath) => {
      if (!this.extensionManager) return { success: false, error: 'Extension manager unavailable' };
      try {
        const safePath = sanitizeString(folderPath || '', 512, 'folderPath');
        const installed = await this.extensionManager.installUnpacked(safePath);
        if (installed.enabled) {
          await this.extensionManager.loadIntoSession(session.defaultSession, installed.id);
        }
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('extensions:updated', this.extensionManager.getAllExtensions());
        }
        return { success: true, extension: installed };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('extensions:enable', secureHandlerRaw(async (_, id) => {
      if (!this.extensionManager) return { success: false };
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      try {
        const res = await this.extensionManager.enableExtension(safeId, session.defaultSession);
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('extensions:updated', this.extensionManager.getAllExtensions());
        }
        return { success: true, extension: res };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('extensions:disable', secureHandlerRaw(async (_, id) => {
      if (!this.extensionManager) return { success: false };
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      try {
        const res = await this.extensionManager.disableExtension(safeId, session.defaultSession);
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('extensions:updated', this.extensionManager.getAllExtensions());
        }
        return { success: true, extension: res };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('extensions:remove', secureHandlerRaw(async (_, id) => {
      if (!this.extensionManager) return { success: false };
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      try {
        await this.extensionManager.removeExtension(safeId, session.defaultSession);
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('extensions:updated', this.extensionManager.getAllExtensions());
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('extensions:reload', secureHandlerRaw(async (_, id) => {
      if (!this.extensionManager) return { success: false };
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      try {
        const res = await this.extensionManager.reloadExtension(safeId, session.defaultSession);
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('extensions:updated', this.extensionManager.getAllExtensions());
        }
        return { success: true, extension: res };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('extensions:setPinned', secureHandlerRaw((_, id, pinned) => {
      if (!this.extensionManager) return { success: false };
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      try {
        const result = this.extensionManager.setPinned(safeId, pinned);
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('extensions:updated', this.extensionManager.getAllExtensions());
        }
        return { success: true, pinned: result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('extensions:setDeveloperMode', secureHandlerRaw((_, enabled) => {
      if (!this.extensionManager) return false;
      return this.extensionManager.setDeveloperMode(enabled);
    }));

    ipcMain.handle('extensions:isDeveloperMode', secureHandlerRaw(() => {
      return this.extensionManager ? this.extensionManager.isDeveloperMode() : false;
    }));

    ipcMain.handle('extensions:updateSettings', secureHandlerRaw((_, id, settings) => {
      if (!this.extensionManager) return { success: false };
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      try {
        const updated = this.extensionManager.updateExtensionSettings(safeId, settings);
        return { success: true, extension: updated };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('extensions:browse', secureHandlerRaw(async () => {
      try {
        const res = await dialog.showOpenDialog(this.mainWindow, {
          title: 'Select Unpacked Extension Directory',
          properties: ['openDirectory']
        });
        if (!res.canceled && res.filePaths.length > 0) {
          return res.filePaths[0];
        }
        return null;
      } catch (err) {
        log.warn('Folder browse dialog failed', { error: err.message });
        return null;
      }
    }));

    ipcMain.handle('extensions:clearErrors', secureHandlerRaw((_, id) => {
      if (!this.extensionManager) return false;
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      return this.extensionManager.clearErrors(safeId);
    }));

    ipcMain.handle('extensions:checkForUpdates', secureHandlerRaw(async (_, id) => {
      if (!this.extensionManager) return { success: false, error: 'Extension manager unavailable' };
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      try {
        const updateRes = await this.extensionManager.checkForUpdates(safeId);
        return { success: true, ...updateRes };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }));

    ipcMain.handle('extensions:openPopup', secureHandlerRaw(async (_, id, bounds) => {
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      return this.openExtensionPopup(safeId, bounds);
    }));

    ipcMain.handle('extensions:toggleBubble', secureHandlerRaw((event, bounds) => {
      return this.toggleExtensionBubble(bounds, this.isIncognitoSender(event.sender));
    }));

    ipcMain.handle('extensions:openBubble', secureHandlerRaw((event, bounds) => {
      return this.openExtensionBubble(bounds, this.isIncognitoSender(event.sender));
    }));

    ipcMain.handle('extensions:closeBubble', secureHandlerRaw(() => {
      this.closeExtensionBubble();
      return true;
    }));

    ipcMain.handle('extensions:triggerAction', secureHandlerRaw(async (_, id) => {
      const safeId = sanitizeString(id || '', 64, 'extensionId');
      if (!safeId || !this.extensionManager) return false;
      const record = this.extensionManager.extensions[safeId];
      if (!record || !record.enabled) return false;
      if (record.action && record.action.default_popup) {
        return this.openExtensionPopup(safeId, null);
      }
      return true;
    }));

    ipcMain.handle('shield:toggleBubble', secureHandlerRaw((event, bounds) => {
      return this.toggleShieldBubble(bounds, this.isIncognitoSender(event.sender));
    }));

    ipcMain.handle('shield:openBubble', secureHandlerRaw((event, bounds) => {
      return this.openShieldBubble(bounds, this.isIncognitoSender(event.sender));
    }));

    ipcMain.handle('shield:closeBubble', secureHandlerRaw(() => {
      this.closeShieldBubble();
      return true;
    }));

    // ── Main menu (⋮) ──
    ipcMain.handle('menu:toggleBubble', secureHandlerRaw((event, bounds) => {
      return this.toggleMenuBubble(bounds, this.isIncognitoSender(event.sender));
    }));

    ipcMain.handle('menu:closeBubble', secureHandlerRaw(() => {
      this.closeMenuBubble();
      return true;
    }));

    // only the menu window itself may choose an entry
    const fromMenu = (event) => Boolean(this.menuBubbleWin && !this.menuBubbleWin.isDestroyed() && event.sender === this.menuBubbleWin.webContents);

    ipcMain.handle('menu:getState', secureHandlerRaw((event) => {
      if (!fromMenu(event)) throw new Error('menu:getState is only for the menu');
      return this.menuState();
    }));

    ipcMain.handle('menu:action', secureHandlerRaw((event, action) => {
      if (!fromMenu(event)) throw new Error('menu:action is only for the menu');
      return this.runMenuAction(sanitizeString(action, 32, 'action'));
    }));

    // ── Auto-Update (Chromium / electron-updater) ──
    ipcMain.handle('updater:getStatus', secureHandlerRaw(() => {
      return this.updateManager ? this.updateManager.getStatus() : { status: 'idle', currentVersion: app.getVersion() };
    }));

    ipcMain.handle('updater:check', secureHandlerRaw(async () => {
      if (!this.updateManager) return { status: 'error', message: 'Update service unavailable' };
      return this.updateManager.checkForUpdates();
    }));

    ipcMain.handle('updater:install', secureHandlerRaw(() => {
      if (!this.updateManager) return false;
      return this.updateManager.quitAndInstall();
    }));

    ipcMain.handle('updater:downloadLatestInstaller', secureHandlerRaw(async (event) => {
      try {
        let version = app.getVersion ? app.getVersion() : '1.1.0';
        if (this.updateManager) {
          const status = this.updateManager.getStatus();
          if (status && status.availableVersion) {
            version = status.availableVersion;
          }
        }
        const url = `https://github.com/jaydipvirja/shmmoth-browser/releases/download/v${version}/SHMMOTH-Browser-Setup-${version}.exe`;
        const isIncognito = this.isIncognitoSender(event.sender);
        const sess = isIncognito ? session.fromPartition('incognito') : session.defaultSession;
        sess.downloadURL(url);
        log.info('Latest installer download started via downloadURL', { url, version });
        return { success: true, url, version };
      } catch (err) {
        log.error('Failed to download latest installer', { error: err.message });
        return { success: false, error: err.message };
      }
    }));

    // ── Ad blocker on/off for the site in the active tab (shield bubble) ──
    // The site is always taken from the active tab here, never from the renderer's message, so a page cannot name another site.
    const shieldTarget = (event) => {
      const bubble = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null;
      const parent = bubble && typeof bubble.getParentWindow === 'function' ? bubble.getParentWindow() : null;
      const incognito = Boolean(parent && this.incognitoWindow && parent === this.incognitoWindow);
      const tabId = incognito ? this.activeIncognitoTabId : this.activeTabId;
      const tab = this.tabs[tabId];
      let host = '';
      try {
        const u = new URL(tab ? displayUrl(tab) : '');
        if (u.protocol === 'http:' || u.protocol === 'https:') host = AdBlockerService.normalizeHost(u.hostname);
      } catch (_) { /* internal page or no tab */ }
      return { tabId, host };
    };

    ipcMain.handle('adblocker:getSite', secureHandlerRaw((event) => {
      const { host } = shieldTarget(event);
      return {
        host,
        canPause: Boolean(host && this.adBlocker),
        paused: Boolean(host && this.adBlocker && this.adBlocker.isSitePaused(host)),
        enabled: Boolean(this.adBlocker && this.adBlocker.isEnabled)
      };
    }));

    // reload the page the shield bubble belongs to (after the master switch changed)
    ipcMain.handle('adblocker:reloadPage', secureHandlerRaw((event) => {
      const { tabId } = shieldTarget(event);
      if (tabId && this.tabs[tabId]) this.reloadTab(tabId);
      return true;
    }));

    ipcMain.handle('adblocker:setSite', secureHandlerRaw((event, paused) => {
      const { tabId, host } = shieldTarget(event);
      if (!host || !this.adBlocker) return { success: false, error: 'The ad blocker can only be paused for a website.' };
      this.adBlocker.setSitePaused(host, paused === true);
      this.reloadTab(tabId);                                  // so the page the user is looking at reflects the change
      return { success: true, host, paused: this.adBlocker.isSitePaused(host) };
    }));

    // ── Secure DNS (DNS-over-HTTPS) ──
    ipcMain.handle('dns:get', secureHandlerRaw(() => this.getSecureDnsState()));

    ipcMain.handle('dns:set', secureHandlerRaw((_, choice) => {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) throw new Error('dns:set requires an object');
      const provider = secureDns.normalizeProvider(choice.provider);
      const update = { secureDnsProvider: provider, secureDnsStrict: choice.strict === true };
      if (provider === 'custom') {
        const v = secureDns.validateDohUrl(choice.customUrl);
        if (!v.ok) return { success: false, error: v.reason, state: this.getSecureDnsState() };      // nothing is saved or applied
        update.secureDnsCustomUrl = v.url;
      }
      this.storage.updateSettings(update);
      this.applySecureDns();
      const state = this.getSecureDnsState();
      this.broadcastSettingsUpdated(this.storage.getSettings());
      return { success: true, state };
    }));

    // "Test it" next to the secure-DNS choice: does the browser's resolver really refuse an ad domain?
    ipcMain.handle('dns:test', secureHandlerRaw(async () => {
      const ses = session.defaultSession;
      const ask = async (host, secureDnsPolicy) => {
        try {
          const r = await Promise.race([
            ses.resolveHost(host, { cacheUsage: 'disallowed', secureDnsPolicy }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 8000))
          ]);
          return { ok: true, addresses: (r.endpoints || []).map((e) => e.address) };
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) };
        }
      };
      const state = this.getSecureDnsState();
      const [secureBlocked, systemBlocked, normal] = await Promise.all([
        ask(secureDns.TEST_BLOCKED_HOST, 'allow'), ask(secureDns.TEST_BLOCKED_HOST, 'disable'), ask(secureDns.TEST_NORMAL_HOST, 'allow')
      ]);
      const result = secureDns.classifyDnsTest({ provider: state.effectiveProvider, proxyActive: this.isProxyActive(), secureBlocked, systemBlocked, normal });
      const show = (a) => (a.ok ? (a.addresses.join(', ') || '(no address)') : a.error);
      return { ...result, details: { adDomainSecure: show(secureBlocked), adDomainSystem: show(systemBlocked), ordinarySecure: show(normal) } };
    }));

    log.info('IPC handlers registered');
  }
}

module.exports = IpcMethods;
