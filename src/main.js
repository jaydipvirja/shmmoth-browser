/**
 * SHMMOTH BROWSER — MAIN PROCESS (main.js)
 *
 * ARCHITECTURE (Stage 1 — Core Tab System, Navigation, Omnibox)
 * ════════════════════════════════════════════════════════════════
 *
 * CORE BROWSER FOUNDATION:
 *   - Tab management: create, switch, close, duplicate, pin/unpin, drag/reorder,
 *     close-other-tabs, close-tabs-to-right, reopen-closed-tab, audio mute toggle.
 *   - Navigation: Back, Forward, Reload, Stop loading, Reload ignoring cache, Home.
 *   - Omnibox: Intelligent URL vs Search detection, configurable search engines (Google, Bing, DuckDuckGo).
 *   - Security: Preload separation (internal vs external), IPC origin validation, URL policy.
 */

'use strict';

const { app, BrowserWindow, WebContentsView, protocol, net, ipcMain, session, dialog, Menu, MenuItem, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');

const StorageService   = require('./services/storage');
const AdBlockerService = require('./services/adblocker');
const RamSaverService  = require('./services/ramSaver');
const DownloadManager  = require('./services/downloadManager');
const { PasswordVault }   = require('./services/passwordVault');
const { AutofillService } = require('./services/autofillService');
const { ProxyManager }    = require('./services/proxyManager');
const ExtensionManager    = require('./services/extensionManager');
const UpdateManager       = require('./services/updateManager');


const { secureHandlerRaw, validateUrl, sanitizeString } = require('./security/ipcSecurity');
const { checkNavigation, isPopupBlocked, isSafeToLoad }  = require('./security/urlPolicy');
const { mainLogger: log, securityLogger }                 = require('./utils/logger');

// ─── Register custom privileged scheme for internal mtc:// pages ─────────────
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mtc',
    privileges: {
      standard:        true,
      secure:          true,
      supportFetchAPI: true,
      corsEnabled:     true
    }
  }
]);

// ─── Preload path constants ───────────────────────────────────────────────────
const PRELOAD_INTERNAL = path.join(__dirname, 'preload-internal.js');
const PRELOAD_EXTERNAL = path.join(__dirname, 'preload-external.js');

// ─── Standard Zoom Levels (Stage 3) ───────────────────────────────────────────
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

/**
 * Returns the correct preload path for a given URL.
 * Internal pages (mtc://, file://) → full API preload.
 * Everything else → empty/minimal external preload.
 *
 * @param {string} url
 * @returns {string} absolute path to preload file
 */
function selectPreload(url) {
  if (
    typeof url === 'string' &&
    (url.startsWith('mtc://') || url.startsWith('file://'))
  ) {
    return PRELOAD_INTERNAL;
  }
  return PRELOAD_EXTERNAL;
}

// ═════════════════════════════════════════════════════════════════════
// SHMMOTH BROWSER APPLICATION CONTROLLER
// ═════════════════════════════════════════════════════════════════════

class ShmmothBrowserApp {
  constructor() {
    this.mainWindow      = null;
    this.incognitoWindow = null;
    this.storage         = null;
    this.adBlocker       = null;
    this.ramSaver        = null;
    this.downloads       = null;

    // Standard tabs: { [tabId]: TabData }
    this.tabs       = {};
    this.tabOrder   = []; // Ordered array of tab IDs [tab_1, tab_2, ...]
    this.closedTabs = []; // LIFO stack of closed tabs for Reopen Closed Tab
    this.tabCounter = 1;
    this.activeTabId = null;

    // Incognito tabs (Stage 4)
    this.incognitoTabOrder    = [];
    this.activeIncognitoTabId = null;

    // Side Panel state (Notes / Tools)
    this.sidePanelOpen  = false;
    this.sidePanelMode  = null;
    this.sidePanelView  = null;
    this.sidePanelWidth = 420;

    // Header dimensions (Tabs: 42px + Nav: 44px + Bookmarks: 28px = 114px)
    this.headerHeight = 114;

    // Content Permissions & Security (Stage 5)
    this.pendingPermissionRequests = {};
    this.permissionReqCounter = 0;

    // Password Manager, Autofill, and Network (Stage 6)
    this.passwordVault = null;
    this.autofillService = null;
    this.proxyManager = null;
    this.pendingPasswordPrompts = {};
    this.passwordPromptCounter = 0;

    // Chromium Extension Management (Stage 7)
    this.extensionManager = null;
    this.extensionPopupWin = null;

    // Download Flyout Bubble (Chrome Style)
    this.downloadBubbleWin = null;
    this.lastDownloadButtonBounds = null;
    this.downloadBubbleAutoCloseTimer = null;

    // Auto-Update Manager (electron-updater)
    this.updateManager = null;

    // Password Save Bubble (Chrome Style Flyout)
    this.passwordBubbleWin = null;
    this.currentPasswordPrompt = null;
  }

  // ─── Initialisation ─────────────────────────────────────────────────────────

  async init() {
    await app.whenReady();
    log.info('App ready — starting SHMMOTH Browser initialisation');

    // 1. Storage
    this.storage = new StorageService();

    // 2. Extension Manager & Chrome extensions (Stage 7)
    this.extensionManager = new ExtensionManager();
    await this.loadExtensions();

    // 3. Register mtc:// protocol handler
    this.setupProtocol();

    // 4. Register IPC handlers (before window is created)
    this.setupIpc();

    // 5. Create main browser window
    this.createMainWindow();

    // 6. Wire DownloadManager to sessions (with multi-target broadcasting and dialog support)
    this.downloads = new DownloadManager(this.storage, {
      promptSaveDialog: async ({ filename, defaultPath, webContents }) => {
        const win = (webContents && BrowserWindow.fromWebContents(webContents)) || this.mainWindow;
        if (!win || win.isDestroyed()) return { cancelled: true };
        const res = await dialog.showSaveDialog(win, {
          title: 'Save File',
          defaultPath: defaultPath || filename
        });
        return { cancelled: res.canceled, filePath: res.filePath };
      }
    });

    // Standardise User-Agent to match official Google Chrome (strips Electron identifier so sites/APIs don't treat browser as a bot/scraper)
    const cleanUa = session.defaultSession.getUserAgent()
      .replace(/Electron\/\S+\s?/, '')
      .replace(/mtc-browser\/\S+\s?/, '')
      .replace(/shmmoth-browser\/\S+\s?/, '')
      .trim();
    app.userAgentFallback = cleanUa;
    session.defaultSession.setUserAgent(cleanUa);
    session.fromPartition('incognito').setUserAgent(cleanUa);

    this.downloads.attach(session.defaultSession, (record) => {
      this.broadcastDownloadUpdate(record);
    }, { isIncognito: false });

    this.downloads.attach(session.fromPartition('incognito'), (record) => {
      this.broadcastDownloadUpdate(record);
    }, { isIncognito: true });

    // 7. RAM Saver
    this.ramSaver = new RamSaverService(this.storage, {
      tabs: this.tabs,
      activeTabId: this.activeTabId,
      notifyTabStatus: (tabId, status) => {
        if (this.tabs[tabId]) {
          Object.assign(this.tabs[tabId], status);
          this.broadcastTabsUpdate();
        }
      }
    });

    // 8. Wire AdBlocker (Ghostery engine — defense in depth on top of CRX extensions)
    this.adBlocker = new AdBlockerService(this.storage);
    this.adBlocker.setupFilter(session.defaultSession).catch(err => {
      log.warn('AdBlocker setupFilter failed (CRX extensions still active)', { error: err.message });
    });

    // 9. Wire Content Permissions (Stage 5)
    this.setupPermissions(session.defaultSession);

    // 10. Wire PasswordVault, AutofillService, and ProxyManager (Stage 6)
    this.passwordVault = new PasswordVault();
    this.autofillService = new AutofillService();
    this.proxyManager = new ProxyManager(null, this.passwordVault);

    // Apply saved proxy to defaultSession
    await this.proxyManager.applyToSession(session.defaultSession).catch(err => {
      log.warn('Initial proxy setup failed', { error: err.message });
    });

    // Handle authenticated proxy requests
    app.on('login', (event, webContents, authInfo, authResponseDetails, callback) => {
      const cb = typeof callback === 'function' ? callback : (typeof authResponseDetails === 'function' ? authResponseDetails : null);
      const info = (authInfo && typeof authInfo === 'object' && 'isProxy' in authInfo) ? authInfo : ((authResponseDetails && typeof authResponseDetails === 'object' && 'isProxy' in authResponseDetails) ? authResponseDetails : {});
      if (info.isProxy && this.proxyManager && typeof cb === 'function') {
        const cfg = this.proxyManager.getConfig();
        if (cfg.rules && cfg.rules.username) {
          event.preventDefault();
          const pass = this.proxyManager.getDecryptedPassword();
          cb(cfg.rules.username, pass);
        }
      }
    });

    // 11. Auto-Update Manager (electron-updater)
    this.updateManager = new UpdateManager({ storage: this.storage });
    this.updateManager.on('status-changed', (status) => {
      this.broadcastUpdateStatus(status);
    });

    if (app.isPackaged) {
      setTimeout(() => {
        if (this.updateManager) {
          this.updateManager.checkForUpdates().catch(err => {
            log.warn('Background update check error', { error: err.message });
          });
        }
      }, 15000);
    }

    log.info('SHMMOTH Browser initialisation complete');
  }

  // ─── Chrome Extension Management (Stage 7) ───────────────────────────────

  async loadExtensions() {
    if (!this.extensionManager) return;

    // Ensure built-in ad blocker extensions are registered in the manager
    const builtIns = [
      { name: 'uBlock Origin', path: path.join(__dirname, '..', 'extensions', 'uBlock0.chromium') }
    ];

    for (const b of builtIns) {
      if (fs.existsSync(b.path)) {
        try {
          const id = this.extensionManager.generateExtensionId(b.path);
          if (!this.extensionManager.extensions[id]) {
            await this.extensionManager.installUnpacked(b.path, { enabled: true });
          }
        } catch (err) {
          log.warn(`Could not register built-in extension: ${b.name}`, { error: err.message });
        }
      }
    }

    // Load all enabled extensions into defaultSession
    for (const [id, record] of Object.entries(this.extensionManager.extensions)) {
      if (record.enabled) {
        try {
          await this.extensionManager.loadIntoSession(session.defaultSession, id);
        } catch (err) {
          log.error(`Failed to load extension into session: ${record.name}`, { id, error: err.message });
        }
      }
    }
  }

  openExtensionPopup(extensionId, anchorBounds = null) {
    if (this.extensionPopupWin && !this.extensionPopupWin.isDestroyed()) {
      this.extensionPopupWin.close();
      this.extensionPopupWin = null;
    }

    if (!this.extensionManager) return false;
    const record = this.extensionManager.extensions[extensionId];
    if (!record || !record.enabled || !record.action || !record.action.default_popup) {
      return false;
    }

    const popupFile = record.action.default_popup.replace(/^[\/\\]+/, '');
    const popupUrl = `chrome-extension://${record.loadedId || record.id}/${popupFile}`;

    const width = 340;
    const height = 460;
    let x = 100;
    let y = 100;

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const winBounds = this.mainWindow.getBounds();
      if (anchorBounds && typeof anchorBounds === 'object') {
        x = Math.round(winBounds.x + anchorBounds.x - width + (anchorBounds.width || 30));
        y = Math.round(winBounds.y + anchorBounds.y + (anchorBounds.height || 30) + 6);
      } else {
        x = winBounds.x + winBounds.width - width - 20;
        y = winBounds.y + 80;
      }
    }

    this.extensionPopupWin = new BrowserWindow({
      width,
      height,
      x,
      y,
      parent: this.mainWindow,
      frame: false,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      backgroundColor: '#1e293b',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: PRELOAD_EXTERNAL
      }
    });

    this.extensionPopupWin.loadURL(popupUrl).catch(err => {
      log.warn('Could not load extension popup URL', { url: popupUrl, error: err.message });
    });

    this.extensionPopupWin.once('ready-to-show', () => {
      if (this.extensionPopupWin && !this.extensionPopupWin.isDestroyed()) {
        this.extensionPopupWin.show();
      }
    });

    this.extensionPopupWin.on('blur', () => {
      if (this.extensionPopupWin && !this.extensionPopupWin.isDestroyed()) {
        this.extensionPopupWin.close();
        this.extensionPopupWin = null;
      }
    });

    return true;
  }

  // ─── Download Bubble (Chrome Style Flyout) ───────────────────────────────

  toggleDownloadBubble(bounds, isIncognito = false) {
    if (this.downloadBubbleWin && !this.downloadBubbleWin.isDestroyed()) {
      this.closeDownloadBubble();
      return false;
    }
    return this.openDownloadBubble(bounds, isIncognito);
  }

  openDownloadBubble(bounds, isIncognito = false) {
    if (bounds && typeof bounds.x === 'number') {
      this.lastDownloadButtonBounds = bounds;
    }

    if (this.downloadBubbleWin && !this.downloadBubbleWin.isDestroyed()) {
      this.downloadBubbleWin.show();
      this.downloadBubbleWin.focus();
      return true;
    }

    const parentWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    if (!parentWin || parentWin.isDestroyed()) return false;

    const width = 380;
    const height = 450;
    const winBounds = parentWin.getBounds();

    let x, y;
    const b = bounds || this.lastDownloadButtonBounds;
    if (b && typeof b.x === 'number') {
      x = Math.round(winBounds.x + b.x - width + 10);
      y = Math.round(winBounds.y + b.y + 4);
    } else {
      x = winBounds.x + winBounds.width - width - 110;
      y = winBounds.y + 82;
    }

    // Keep on screen within parent window bounds
    x = Math.max(winBounds.x + 10, Math.min(x, winBounds.x + winBounds.width - width - 10));

    this.downloadBubbleWin = new BrowserWindow({
      width,
      height,
      x,
      y,
      parent: parentWin,
      frame: false,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: PRELOAD_INTERNAL
      }
    });

    this.downloadBubbleWin.loadFile(path.join(__dirname, 'pages', 'download-bubble.html'));

    this.downloadBubbleWin.once('ready-to-show', () => {
      if (this.downloadBubbleWin && !this.downloadBubbleWin.isDestroyed()) {
        this.downloadBubbleWin.show();
      }
    });

    this.downloadBubbleWin.on('blur', () => {
      setTimeout(() => {
        if (this.downloadBubbleWin && !this.downloadBubbleWin.isDestroyed() && !this.downloadBubbleWin.isFocused()) {
          this.closeDownloadBubble();
        }
      }, 150);
    });

    if (b && b.autoCloseMs && b.autoCloseMs > 0) {
      if (this.downloadBubbleAutoCloseTimer) clearTimeout(this.downloadBubbleAutoCloseTimer);
      this.downloadBubbleAutoCloseTimer = setTimeout(() => {
        this.closeDownloadBubble();
      }, b.autoCloseMs);
    }

    return true;
  }

  closeDownloadBubble() {
    if (this.downloadBubbleAutoCloseTimer) {
      clearTimeout(this.downloadBubbleAutoCloseTimer);
      this.downloadBubbleAutoCloseTimer = null;
    }
    if (this.downloadBubbleWin && !this.downloadBubbleWin.isDestroyed()) {
      this.downloadBubbleWin.close();
      this.downloadBubbleWin = null;
    }
  }

  // ─── Protocol Handler ────────────────────────────────────────────────────

  setupProtocol() {
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css':  'text/css; charset=utf-8',
      '.js':   'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png':  'image/png',
      '.svg':  'image/svg+xml'
    };

    protocol.handle('mtc', (request) => {
      try {
        const parsed   = new URL(request.url);
        let pageName   = parsed.hostname;
        let pathname   = parsed.pathname;

        if (!pageName || pageName === '') pageName = 'newtab';

        let targetFile;
        if (pathname && pathname !== '/' && !pathname.endsWith('/')) {
          targetFile = path.join(__dirname, 'pages', path.basename(pathname));
        } else {
          targetFile = path.join(__dirname, 'pages', `${pageName}.html`);
        }

        if (fs.existsSync(targetFile)) {
          const content     = fs.readFileSync(targetFile);
          const ext         = path.extname(targetFile).toLowerCase();
          const contentType = mimeTypes[ext] || 'text/html; charset=utf-8';
          return new Response(content, { headers: { 'Content-Type': contentType } });
        }

        return new Response('Page Not Found', { status: 404 });
      } catch (err) {
        log.error('Error handling mtc protocol request', { error: err.message });
        return new Response('Error loading internal page', { status: 500 });
      }
    });

    log.info('mtc:// protocol handler registered');
  }

  // ─── Main Window ─────────────────────────────────────────────────────────

  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width:           1366,
      height:          850,
      minWidth:        850,
      minHeight:       500,
      frame:           false,
      backgroundColor: '#0f172a',
      title:           'SHMMOTH Browser',
      webPreferences: {
        preload:          PRELOAD_INTERNAL,
        contextIsolation: true,
        nodeIntegration:  false,
        sandbox:          false
      }
    });

    this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    this.mainWindow.webContents.on('did-finish-load', () => {
      if (Object.keys(this.tabs).length === 0) {
        this.createTab('mtc://newtab');
      } else {
        this.broadcastTabsUpdate();
        this.updateViewBounds();
      }
    });

    this.mainWindow.on('resize',     () => this.updateViewBounds());
    this.mainWindow.on('maximize',   () => setTimeout(() => this.updateViewBounds(), 50));
    this.mainWindow.on('unmaximize', () => setTimeout(() => this.updateViewBounds(), 50));
    this.mainWindow.on('closed',     () => { this.mainWindow = null; });

    log.info('Main window created');
  }

  // ─── Incognito Window (Stage 4) ──────────────────────────────────────────

  createIncognitoWindow() {
    if (this.incognitoWindow && !this.incognitoWindow.isDestroyed()) {
      this.incognitoWindow.focus();
      return;
    }

    this.incognitoWindow = new BrowserWindow({
      width:           1366,
      height:          850,
      minWidth:        850,
      minHeight:       500,
      frame:           false,
      backgroundColor: '#130d1e',
      title:           'SHMMOTH Browser (Incognito)',
      webPreferences: {
        preload:          PRELOAD_INTERNAL,
        contextIsolation: true,
        nodeIntegration:  false,
        sandbox:          false
      }
    });

    if (this.adBlocker) {
      this.adBlocker.setupFilter(session.fromPartition('incognito')).catch(() => {});
    }

    this.setupPermissions(session.fromPartition('incognito'));

    this.incognitoWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
      query: { incognito: 'true' }
    });

    this.incognitoWindow.webContents.on('did-finish-load', () => {
      if (this.incognitoTabOrder.length === 0) {
        this.createTab('mtc://newtab', null, false, true);
      } else {
        this.broadcastTabsUpdate(true);
        this.updateViewBounds(this.incognitoWindow);
      }
    });

    this.incognitoWindow.on('resize',     () => this.updateViewBounds(this.incognitoWindow));
    this.incognitoWindow.on('maximize',   () => setTimeout(() => this.updateViewBounds(this.incognitoWindow), 50));
    this.incognitoWindow.on('unmaximize', () => setTimeout(() => this.updateViewBounds(this.incognitoWindow), 50));
    this.incognitoWindow.on('closed',     () => {
      // Close all incognito tabs and views
      for (const tabId of [...this.incognitoTabOrder]) {
        const tab = this.tabs[tabId];
        if (tab && tab.view && tab.view.webContents) {
          try { tab.view.webContents.close(); } catch (_) {}
        }
        delete this.tabs[tabId];
      }
      this.incognitoTabOrder = [];
      this.activeIncognitoTabId = null;

      // Wipe ephemeral in-memory storage & cookies
      try {
        const incogSession = session.fromPartition('incognito');
        incogSession.clearStorageData().catch(() => {});
        incogSession.clearCache().catch(() => {});
      } catch (_) {}

      // Clean up ephemeral incognito downloads
      if (this.downloads) {
        this.downloads.clearIncognitoDownloads();
      }

      this.incognitoWindow = null;
      log.info('Incognito window closed and in-memory session wiped');
    });

    log.info('Incognito window created');
  }

  /**
   * Determines whether a webContents belongs to an incognito context.
   * @param {Electron.WebContents} webContents
   * @returns {boolean}
   */
  isIncognitoSender(webContents) {
    if (!webContents) return false;
    if (this.incognitoWindow && !this.incognitoWindow.isDestroyed() && this.incognitoWindow.webContents) {
      if (this.incognitoWindow.webContents.id === webContents.id) return true;
    }
    if (this.tabs) {
      for (const tab of Object.values(this.tabs)) {
        if (tab && tab.view && tab.view.webContents && tab.view.webContents.id === webContents.id) {
          return Boolean(tab.isIncognito);
        }
      }
    }
    try {
      if (webContents.session && webContents.session !== session.defaultSession) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  /**
   * Broadcasts real-time download updates to all interested contexts:
   * 1. The main window chrome
   * 2. The incognito window chrome (if open)
   * 3. All open tab WebContents (including mtc://downloads internal pages)
   *
   * @param {object} record Serialized download record
   */
  broadcastDownloadUpdate(record) {
    if (!record) return;

    // 1. Main window chrome
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents && !this.mainWindow.webContents.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('download:update', record);
      } catch (_) {}
    }

    // 2. Incognito window chrome
    if (this.incognitoWindow && !this.incognitoWindow.isDestroyed() && this.incognitoWindow.webContents && !this.incognitoWindow.webContents.isDestroyed()) {
      try {
        this.incognitoWindow.webContents.send('download:update', record);
      } catch (_) {}
    }

    // 3. Tab WebContents (e.g. mtc://downloads pages running inside tabs)
    if (this.tabs) {
      for (const tab of Object.values(this.tabs)) {
        if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
          try {
            tab.view.webContents.send('download:update', record);
          } catch (_) {}
        }
      }
    }

    // 4. Download Flyout Bubble (Chrome Style)
    if (this.downloadBubbleWin && !this.downloadBubbleWin.isDestroyed() && this.downloadBubbleWin.webContents && !this.downloadBubbleWin.webContents.isDestroyed()) {
      try {
        this.downloadBubbleWin.webContents.send('download:update', record);
      } catch (_) {}
    }
  }

  /**
   * Broadcasts auto-update status to:
   * 1. Main browser window (chrome UI)
   * 2. Incognito browser window (if open)
   * 3. All active tab WebContents running internal pages (e.g. mtc://settings)
   *
   * @param {object} status Serialized update status object
   */
  broadcastUpdateStatus(status) {
    if (!status) return;

    // 1. Main window chrome
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents && !this.mainWindow.webContents.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('updater:status', status);
      } catch (_) {}
    }

    // 2. Incognito window chrome
    if (this.incognitoWindow && !this.incognitoWindow.isDestroyed() && this.incognitoWindow.webContents && !this.incognitoWindow.webContents.isDestroyed()) {
      try {
        this.incognitoWindow.webContents.send('updater:status', status);
      } catch (_) {}
    }

    // 3. Tab WebContents (e.g. mtc://settings pages running inside tabs)
    if (this.tabs) {
      for (const tab of Object.values(this.tabs)) {
        if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
          try {
            const url = tab.url || tab.view.webContents.getURL() || '';
            if (url.startsWith('mtc://') || url.startsWith('file://')) {
              tab.view.webContents.send('updater:status', status);
            }
          } catch (_) {}
        }
      }
    }
  }

  // ─── Content Permissions & Security (Stage 5) ───────────────────────────

  setupPermissions(targetSession) {
    if (!targetSession) return;

    targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      // Internal schemes (mtc://, file://) are trusted for non-destructive permissions
      if (requestingOrigin && (requestingOrigin.startsWith('mtc://') || requestingOrigin.startsWith('file://'))) {
        return true;
      }

      // Safe UI permissions
      if (permission === 'fullscreen' || permission === 'pointerLock') {
        return true;
      }

      // Check stored permissions for this origin
      if (this.storage) {
        const perms = this.storage.getSitePermissions(requestingOrigin);
        if (perms && perms[permission]) {
          return perms[permission] === 'allow';
        }
      }

      // Default to false for sensitive permissions (triggers setPermissionRequestHandler)
      return false;
    });

    targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const requestingUrl = details.requestingUrl || (webContents ? webContents.getURL() : '');
      let origin = '';
      try {
        origin = new URL(requestingUrl).origin;
      } catch (_) {
        origin = requestingUrl || 'unknown';
      }

      // Internal schemes are auto-granted
      if (origin.startsWith('mtc://') || origin.startsWith('file://')) {
        return callback(true);
      }

      // Safe UI permissions
      if (permission === 'fullscreen' || permission === 'pointerLock') {
        return callback(true);
      }

      // Check stored decision
      if (this.storage) {
        const perms = this.storage.getSitePermissions(origin);
        if (perms && perms[permission] === 'allow') {
          return callback(true);
        } else if (perms && perms[permission] === 'block') {
          return callback(false);
        }
      }

      // Find which tab requested this
      let foundTab = null;
      if (webContents) {
        for (const t of Object.values(this.tabs)) {
          if (t.view && t.view.webContents && t.view.webContents.id === webContents.id) {
            foundTab = t;
            break;
          }
        }
      }

      const targetWin = (foundTab && foundTab.isIncognito) ? this.incognitoWindow : this.mainWindow;
      if (!targetWin || targetWin.isDestroyed() || !targetWin.webContents) {
        return callback(false);
      }

      const requestId = 'perm_req_' + (++this.permissionReqCounter);
      this.pendingPermissionRequests[requestId] = {
        callback,
        origin,
        permission,
        tabId: foundTab ? foundTab.id : null
      };

      // Auto-expire after 30 seconds
      const timeout = setTimeout(() => {
        if (this.pendingPermissionRequests[requestId]) {
          const req = this.pendingPermissionRequests[requestId];
          delete this.pendingPermissionRequests[requestId];
          try { req.callback(false); } catch (_) {}
        }
      }, 30000);
      this.pendingPermissionRequests[requestId].timeout = timeout;

      targetWin.webContents.send('permission:request', {
        requestId,
        origin,
        permission,
        details: { mediaTypes: details.mediaTypes || [] },
        tabId: foundTab ? foundTab.id : null
      });
      log.info(`Permission requested: ${permission} by ${origin}`, { requestId });
    });
  }

  // ─── View Bounds ─────────────────────────────────────────────────────────

  updateHeaderHeight() {
    const settings = this.storage ? this.storage.getSettings() : {};
    this.headerHeight = (settings.showBookmarksBar !== false) ? 114 : 86;
  }

  updateViewBounds(targetWin = null) {
    const wins = targetWin ? [targetWin] : [this.mainWindow, this.incognitoWindow].filter(w => w && !w.isDestroyed());
    this.updateHeaderHeight();

    for (const win of wins) {
      const isIncognito = (win === this.incognitoWindow);
      const activeId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;

      const bounds        = win.getContentBounds();
      const contentWidth  = bounds.width;
      const contentHeight = Math.max(bounds.height - this.headerHeight, 200);

      let webWidth = contentWidth;
      if (this.sidePanelOpen && !isIncognito) {
        const panelW = Math.min(this.sidePanelWidth, Math.floor(contentWidth * 0.45));
        webWidth = Math.max(contentWidth - panelW, 400);

        if (this.sidePanelView) {
          this.sidePanelView.setBounds({
            x: webWidth, y: this.headerHeight,
            width: contentWidth - webWidth, height: contentHeight
          });
        }
      }

      const activeTab = this.tabs[activeId];
      if (activeTab && activeTab.view) {
        activeTab.view.setBounds({
          x: 0, y: this.headerHeight,
          width: webWidth, height: contentHeight
        });
      }
    }
  }

  // ─── Tab Management (Stage 1 Core) ───────────────────────────────────────

  createTab(initialUrl = 'mtc://newtab', insertAfterTabId = null, isPinned = false, isIncognito = false, isPopupTab = false) {
    const tabId = 'tab_' + this.tabCounter++;
    const preloadPath = selectPreload(initialUrl);

    const webPreferences = {
      preload:          preloadPath,
      contextIsolation: true,
      nodeIntegration:  false,
      plugins:          true,
      webSecurity:      true,
      sandbox:          false
    };

    if (isIncognito) {
      webPreferences.partition = 'incognito';
    }

    const view = new WebContentsView({ webPreferences });

    const tabData = {
      id:             tabId,
      title:          'New Tab',
      url:            initialUrl,
      favicon:        '',
      view:           view,
      isAudible:      false,
      isMuted:        false,
      isLoading:      false,
      isSleeping:     false,
      isPinned:       Boolean(isPinned),
      isIncognito:    Boolean(isIncognito),
      isPopupTab:     Boolean(isPopupTab),
      openerTabId:    insertAfterTabId,
      canGoBack:      false,
      canGoForward:   false,
      lastActiveTime: Date.now(),
      isCrashed:      false,
      crashReason:    null,
      isUnresponsive: false,
      lastValidUrl:   initialUrl
    };

    this.tabs[tabId] = tabData;

    const targetOrder = isIncognito ? this.incognitoTabOrder : this.tabOrder;

    // Tab ordering
    if (insertAfterTabId && targetOrder.includes(insertAfterTabId)) {
      const idx = targetOrder.indexOf(insertAfterTabId);
      targetOrder.splice(idx + 1, 0, tabId);
    } else if (isPinned) {
      // Pinned tabs stay grouped at the front
      const lastPinnedIndex = this._getLastPinnedIndex(isIncognito);
      targetOrder.splice(lastPinnedIndex + 1, 0, tabId);
    } else {
      targetOrder.push(tabId);
    }

    // Keep pinned tabs cleanly clustered at the beginning
    this._reorderPinnedFirst(isIncognito);

    const wc = view.webContents;

    // ── Title + Favicon updates ──
    wc.on('page-title-updated', (_, title) => {
      tabData.title = title || 'New Tab';
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    wc.on('page-favicon-updated', (_, favicons) => {
      if (favicons && favicons.length > 0) {
        tabData.favicon = favicons[0];
        this.broadcastTabsUpdate(tabData.isIncognito);
      }
    });

    // ── Loading state events (Stage 1) ──
    wc.on('did-start-loading', () => {
      tabData.isLoading = true;
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }
    });

    wc.on('did-stop-loading', () => {
      tabData.isLoading = false;
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }
    });

    wc.on('did-fail-load', (_, errorCode) => {
      tabData.isLoading = false;
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }

      // If a popup/new tab aborted because it converted into a download (-3 ERR_ABORTED),
      // cleanly close the empty tab so user stays on their active page
      if (tabData.isPopupTab && errorCode === -3) {
        setTimeout(() => {
          if (this.tabs[tabId] && (!tabData.lastValidUrl || tabData.lastValidUrl === initialUrl)) {
            log.info(`Auto-closing empty popup tab ${tabId} after download handoff`);
            this.closeTab(tabId);
            if (tabData.openerTabId && this.tabs[tabData.openerTabId]) {
              this.switchTab(tabData.openerTabId);
            }
          }
        }, 150);
      }
    });

    // ── Navigation events ──
    wc.on('did-navigate', (_, navUrl) => {
      tabData.url = navUrl;
      if (navUrl && !navUrl.startsWith('mtc://crash')) {
        tabData.lastValidUrl = navUrl;
        tabData.isCrashed = false;
        tabData.crashReason = null;
      }
      tabData.lastActiveTime = Date.now();
      tabData.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      tabData.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      // Zero history recorded for incognito tabs (Stage 4)
      if (!tabData.isIncognito) {
        this.storage.addHistory({ title: tabData.title, url: navUrl, favicon: tabData.favicon });
      }
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }
      this._applyYouTubeOptimizer(wc, navUrl);
      this._restoreSiteZoom(tabId, navUrl);
    });

    // ── Find in Page results (Stage 3) ──
    wc.on('found-in-page', (_, result) => {
      const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
      if (targetWin && targetWin.webContents) {
        targetWin.webContents.send('find:result', {
          tabId,
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches,
          finalUpdate: result.finalUpdate
        });
      }
    });

    // ── Page Context Menu (Chrome/Edge Style) ──
    wc.on('context-menu', (event, params) => {
      event.preventDefault();
      const menu = new Menu();

      // 1. Link items
      if (params.linkURL) {
        menu.append(new MenuItem({
          label: 'Open link in new tab',
          click: () => this.createTab(params.linkURL, tabId, false, tabData.isIncognito)
        }));
        menu.append(new MenuItem({
          label: 'Save link as...',
          click: () => {
            try {
              const sess = tabData.isIncognito ? session.fromPartition('incognito') : session.defaultSession;
              sess.downloadURL(params.linkURL);
            } catch (err) {
              log.error('Save link as failed', { error: err.message });
            }
          }
        }));
        menu.append(new MenuItem({
          label: 'Copy link address',
          click: () => clipboard.writeText(params.linkURL)
        }));
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // 2. Image / Media items
      if (params.hasImageContents || params.mediaType === 'image') {
        const imgSrc = params.srcURL;
        if (imgSrc) {
          menu.append(new MenuItem({
            label: 'Save image as...',
            click: () => {
              try {
                const sess = tabData.isIncognito ? session.fromPartition('incognito') : session.defaultSession;
                sess.downloadURL(imgSrc);
              } catch (err) {
                log.error('Save image as failed', { error: err.message });
              }
            }
          }));
          menu.append(new MenuItem({
            label: 'Copy image',
            click: () => wc.copyImageAt(params.x, params.y)
          }));
          menu.append(new MenuItem({
            label: 'Copy image address',
            click: () => clipboard.writeText(imgSrc)
          }));
          menu.append(new MenuItem({
            label: 'Open image in new tab',
            click: () => this.createTab(imgSrc, tabId, false, tabData.isIncognito)
          }));
          menu.append(new MenuItem({ type: 'separator' }));
        }
      }

      // 3. Selection / Text search items
      if (params.selectionText && params.selectionText.trim()) {
        const text = params.selectionText.trim();
        menu.append(new MenuItem({
          label: 'Copy',
          role: 'copy'
        }));
        const truncated = text.length > 25 ? text.slice(0, 25) + '…' : text;
        menu.append(new MenuItem({
          label: `Search Google for "${truncated}"`,
          click: () => this.createTab(`https://www.google.com/search?q=${encodeURIComponent(text)}`, tabId, false, tabData.isIncognito)
        }));
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // 4. Editable (input/textarea) items
      if (params.isEditable) {
        menu.append(new MenuItem({ label: 'Undo', role: 'undo' }));
        menu.append(new MenuItem({ label: 'Redo', role: 'redo' }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
        menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
        menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
        menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // 5. General Page Navigation items
      menu.append(new MenuItem({
        label: 'Back',
        enabled: Boolean(tabData.canGoBack),
        click: () => this.goBack(tabId)
      }));
      menu.append(new MenuItem({
        label: 'Forward',
        enabled: Boolean(tabData.canGoForward),
        click: () => this.goForward(tabId)
      }));
      menu.append(new MenuItem({
        label: 'Reload',
        click: () => this.reloadTab(tabId)
      }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: 'Inspect',
        click: () => wc.inspectElement(params.x, params.y)
      }));

      const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
      if (targetWin && !targetWin.isDestroyed()) {
        menu.popup({ window: targetWin });
      }
    });

    // ── Credential Capture & Autofill (Stage 6) ──
    wc.on('console-message', (event, level, message) => {
      if (typeof message === 'string' && message.startsWith('__SHMMOTH_LOGIN_SUBMIT__:')) {
        event.preventDefault();
        try {
          const payload = JSON.parse(message.slice(25));
          if (payload && payload.username && payload.password && tabData.url) {
            const origin = new URL(tabData.url).origin;
            this.offerPasswordSave(tabId, origin, payload.username, payload.password);
          }
        } catch (_) {}
      }
    });

    wc.on('dom-ready', () => {
      this._applyYouTubeOptimizer(wc, tabData.url);
      this._attachCredentialAndAutofillHooks(wc, tabData);
    });

    wc.on('did-navigate-in-page', (_, navUrl) => {
      tabData.url = navUrl;
      tabData.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      tabData.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }
    });

    // ── URL Security Policy ──
    wc.on('will-navigate', (event, navUrl) => {
      const from   = tabData.url;
      const result = checkNavigation(from, navUrl);
      if (!result.allowed) {
        securityLogger.security(`Navigation blocked in tab ${tabId}`, {
          from: from ? from.slice(0, 120) : '',
          to:   navUrl.slice(0, 120),
          reason: result.reason
        });
        event.preventDefault();
      }
    });

    // ── Popup Policy ──
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (isPopupBlocked(url)) {
        securityLogger.security(`Popup blocked`, { url: url.slice(0, 120) });
        return { action: 'deny' };
      }

      // If the target URL is a direct downloadable media/binary file, initiate session download directly
      // without opening an unwanted blank tab that has to abort navigation
      const isDirectDownload = /\.(mkv|mp4|avi|mov|m4v|webm|zip|rar|7z|tar|gz|iso|exe|msi|bin|pdf)(\?.*)?$/i.test(url)
        || url.includes('response-content-disposition=attachment')
        || (url.includes('/hub/') && url.includes('cloudflarestorage.com'))
        || url.includes('cdn.pongala.life');

      if (isDirectDownload) {
        log.info(`Direct file download detected from popup: triggering session download`, { url: url.slice(0, 120) });
        const sess = tabData.isIncognito ? session.fromPartition('incognito') : session.defaultSession;
        sess.downloadURL(url);
        return { action: 'deny' };
      }

      this.createTab(url, tabId, false, tabData.isIncognito, true);
      return { action: 'deny' };
    });

    // ── Audio & Mute State ──
    wc.on('media-started-playing', () => {
      tabData.isAudible = true;
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    wc.on('media-paused', () => {
      tabData.isAudible = false;
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    // ── Crash & Unresponsive Resilience (Stage 5) ──
    wc.on('render-process-gone', (event, details) => {
      log.error(`Renderer process gone for tab ${tabId}`, { reason: details.reason, exitCode: details.exitCode });
      tabData.isCrashed = true;
      tabData.crashReason = details.reason;
      tabData.isLoading = false;
      this.broadcastTabsUpdate(tabData.isIncognito);

      if (details.reason !== 'clean-exit') {
        const fallbackUrl = tabData.lastValidUrl || tabData.url || 'https://google.com';
        const crashUrl = `mtc://crash?tabId=${tabId}&reason=${encodeURIComponent(details.reason || 'crashed')}&url=${encodeURIComponent(fallbackUrl)}`;
        wc.loadURL(crashUrl).catch(() => {});
      }
    });

    wc.on('unresponsive', () => {
      log.warn(`Tab ${tabId} became unresponsive`);
      tabData.isUnresponsive = true;
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    wc.on('responsive', () => {
      log.info(`Tab ${tabId} resumed responsiveness`);
      tabData.isUnresponsive = false;
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    // Load initial URL
    wc.loadURL(initialUrl);

    this.switchTab(tabId);
    log.info(`Tab created: ${tabId}`, { url: initialUrl, isPinned, isIncognito });
    return tabId;
  }

  _getLastPinnedIndex(isIncognito = false) {
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    let idx = -1;
    for (let i = 0; i < order.length; i++) {
      const t = this.tabs[order[i]];
      if (t && t.isPinned) idx = i;
    }
    return idx;
  }

  _reorderPinnedFirst(isIncognito = false) {
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    const pinned = [];
    const unpinned = [];
    for (const id of order) {
      const tab = this.tabs[id];
      if (tab && tab.isPinned) pinned.push(id);
      else if (tab) unpinned.push(id);
    }
    if (isIncognito) {
      this.incognitoTabOrder = [...pinned, ...unpinned];
    } else {
      this.tabOrder = [...pinned, ...unpinned];
    }
  }

  switchTab(tabId) {
    const currentTab = this.tabs[tabId];
    if (!currentTab) return;

    const isIncognito = Boolean(currentTab.isIncognito);
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    const prevActiveId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;

    const prevActiveTab = this.tabs[prevActiveId];
    if (prevActiveTab && prevActiveTab.view && targetWin && !targetWin.isDestroyed()) {
      try { targetWin.contentView.removeChildView(prevActiveTab.view); } catch (_) {}
    }

    if (isIncognito) {
      this.activeIncognitoTabId = tabId;
    } else {
      this.activeTabId = tabId;
    }

    currentTab.lastActiveTime = Date.now();

    if (currentTab.isSleeping && this.ramSaver && !isIncognito) {
      this.ramSaver.wakeTab(tabId, currentTab);
    }

    if (targetWin && !targetWin.isDestroyed() && currentTab.view) {
      targetWin.contentView.addChildView(currentTab.view);
      this.updateViewBounds(targetWin);
    }

    this.broadcastTabsUpdate(isIncognito);
    this.updateNavigationState(isIncognito);

    if (targetWin && !targetWin.isDestroyed() && targetWin.webContents && currentTab.view && currentTab.view.webContents) {
      try {
        const factor = currentTab.view.webContents.getZoomFactor();
        targetWin.webContents.send('zoom:changed', { tabId, zoomFactor: factor });
      } catch (_) {}
    }
  }

  closeTab(tabId) {
    const tabData = this.tabs[tabId];
    if (!tabData) return;

    const isIncognito = Boolean(tabData.isIncognito);
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    const targetOrder = isIncognito ? this.incognitoTabOrder : this.tabOrder;

    // Track closed tab for Reopen Closed Tab (Ctrl+Shift+T) ONLY for standard tabs
    if (!isIncognito && tabData.url && !tabData.url.startsWith('mtc://newtab') && !tabData.url.startsWith('about:blank')) {
      this.closedTabs.push({ url: tabData.url, title: tabData.title || tabData.url });
      if (this.closedTabs.length > 25) {
        this.closedTabs.shift();
      }
    }

    if (targetWin && !targetWin.isDestroyed() && tabData.view) {
      try { targetWin.contentView.removeChildView(tabData.view); } catch (_) {}
      if (tabData.view.webContents) {
        try { tabData.view.webContents.close(); } catch (_) {}
      }
    }

    delete this.tabs[tabId];
    const filtered = targetOrder.filter(id => id !== tabId);
    if (isIncognito) {
      this.incognitoTabOrder = filtered;
    } else {
      this.tabOrder = filtered;
    }

    log.info(`Tab closed: ${tabId} (incognito: ${isIncognito})`);

    const activeId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;
    if (activeId === tabId) {
      if (filtered.length > 0) {
        this.switchTab(filtered[filtered.length - 1]);
      } else {
        if (isIncognito && targetWin && !targetWin.isDestroyed()) {
          targetWin.close();
        } else {
          this.createTab('mtc://newtab', null, false, false);
        }
      }
    } else {
      this.broadcastTabsUpdate(isIncognito);
    }
  }

  duplicateTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab) return null;
    return this.createTab(tab.url, tab.id, tab.isPinned, tab.isIncognito);
  }

  togglePinTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab) return;
    tab.isPinned = !tab.isPinned;
    this._reorderPinnedFirst(tab.isIncognito);
    this.broadcastTabsUpdate(tab.isIncognito);
    log.info(`Tab ${tab.id} pin toggled: ${tab.isPinned}`);
  }

  reorderTabs(tabId, targetIndex) {
    const tab = this.tabs[tabId];
    if (!tab) return;
    const isIncognito = Boolean(tab.isIncognito);
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    if (!order.includes(tabId)) return;
    const fromIndex = order.indexOf(tabId);
    if (fromIndex === targetIndex || targetIndex < 0 || targetIndex >= order.length) return;

    order.splice(fromIndex, 1);
    order.splice(targetIndex, 0, tabId);

    this._reorderPinnedFirst(isIncognito);
    this.broadcastTabsUpdate(isIncognito);
    log.info(`Tab ${tabId} reordered to index ${targetIndex} (incognito: ${isIncognito})`);
  }

  closeOtherTabs(tabId) {
    const keepId = tabId || this.activeTabId;
    const targetTab = this.tabs[keepId];
    if (!targetTab) return;

    const isIncognito = Boolean(targetTab.isIncognito);
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    const toClose = [];

    for (const id of order) {
      if (id === keepId) continue;
      const tab = this.tabs[id];
      if (!targetTab.isPinned && tab.isPinned) continue;
      toClose.push(id);
    }

    for (const id of toClose) {
      this.closeTab(id);
    }
  }

  closeTabsToRight(tabId) {
    const fromId = tabId || this.activeTabId;
    const fromTab = this.tabs[fromId];
    if (!fromTab) return;

    const isIncognito = Boolean(fromTab.isIncognito);
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    const idx = order.indexOf(fromId);
    if (idx === -1) return;

    const toClose = [];
    for (let i = idx + 1; i < order.length; i++) {
      const id = order[i];
      const tab = this.tabs[id];
      if (tab && !tab.isPinned) {
        toClose.push(id);
      }
    }

    for (const id of toClose) {
      this.closeTab(id);
    }
  }

  reopenClosedTab() {
    if (this.closedTabs.length === 0) return null;
    const lastClosed = this.closedTabs.pop();
    log.info('Reopening closed tab', { url: lastClosed.url });
    return this.createTab(lastClosed.url);
  }

  stopTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (tab && tab.view && tab.view.webContents) {
      tab.view.webContents.stop();
      tab.isLoading = false;
      this.broadcastTabsUpdate();
      this.updateNavigationState();
    }
  }

  reloadTabIgnoringCache(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (tab && tab.view && tab.view.webContents) {
      tab.view.webContents.reloadIgnoringCache();
    }
  }

  toggleMuteTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (tab && tab.view && tab.view.webContents) {
      const wc = tab.view.webContents;
      const muted = wc.isAudioMuted();
      wc.setAudioMuted(!muted);
      tab.isMuted = !muted;
      this.broadcastTabsUpdate();
    }
  }

  // ─── Zoom & Page View Controls (Stage 3) ───────────────────────────────────

  getZoomFactor(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (tab && tab.view && tab.view.webContents) {
      try {
        return tab.view.webContents.getZoomFactor();
      } catch (_) {
        return 1.0;
      }
    }
    return 1.0;
  }

  zoomIn(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab || !tab.view || !tab.view.webContents) return 1.0;
    try {
      const current = tab.view.webContents.getZoomFactor();
      const next = ZOOM_LEVELS.find(lvl => lvl > current + 0.01) || ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
      tab.view.webContents.setZoomFactor(next);
      this._saveSiteZoom(tab.url, next);
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('zoom:changed', { tabId: tab.id, zoomFactor: next });
      }
      return next;
    } catch (err) {
      log.warn('zoomIn failed', { error: err.message });
      return 1.0;
    }
  }

  zoomOut(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab || !tab.view || !tab.view.webContents) return 1.0;
    try {
      const current = tab.view.webContents.getZoomFactor();
      const prev = [...ZOOM_LEVELS].reverse().find(lvl => lvl < current - 0.01) || ZOOM_LEVELS[0];
      tab.view.webContents.setZoomFactor(prev);
      this._saveSiteZoom(tab.url, prev);
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('zoom:changed', { tabId: tab.id, zoomFactor: prev });
      }
      return prev;
    } catch (err) {
      log.warn('zoomOut failed', { error: err.message });
      return 1.0;
    }
  }

  resetZoom(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab || !tab.view || !tab.view.webContents) return 1.0;
    try {
      tab.view.webContents.setZoomFactor(1.0);
      this._saveSiteZoom(tab.url, 1.0);
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('zoom:changed', { tabId: tab.id, zoomFactor: 1.0 });
      }
      return 1.0;
    } catch (err) {
      log.warn('resetZoom failed', { error: err.message });
      return 1.0;
    }
  }

  _getSiteKey(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  _saveSiteZoom(url, factor) {
    const key = this._getSiteKey(url);
    if (!key || !this.storage) return;
    try {
      const siteZoom = this.storage.get('siteZoom', {});
      if (Math.abs(factor - 1.0) < 0.01) {
        delete siteZoom[key];
      } else {
        siteZoom[key] = factor;
      }
      this.storage.set('siteZoom', siteZoom);
    } catch (err) {
      log.warn('Could not save site zoom', { error: err.message });
    }
  }

  _restoreSiteZoom(tabId, url) {
    const tab = this.tabs[tabId];
    if (!tab || !tab.view || !tab.view.webContents) return;
    const isIncognito = Boolean(tab.isIncognito);
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    const activeId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;

    const key = this._getSiteKey(url);
    let factor = 1.0;
    if (key && this.storage) {
      try {
        const siteZoom = this.storage.get('siteZoom', {});
        if (siteZoom && siteZoom[key]) {
          factor = siteZoom[key];
        }
      } catch (_) {}
    }
    try {
      tab.view.webContents.setZoomFactor(factor);
      if (targetWin && !targetWin.isDestroyed() && targetWin.webContents && tabId === activeId) {
        targetWin.webContents.send('zoom:changed', { tabId, zoomFactor: factor });
      }
    } catch (err) {
      log.warn('Could not restore site zoom', { error: err.message });
    }
  }

  // ─── Side Panel ──────────────────────────────────────────────────────────

  toggleSidePanel(mode = 'notes') {
    if (this.sidePanelOpen && this.sidePanelMode === mode) {
      this.closeSidePanel();
      return;
    }

    this.sidePanelMode = mode;
    this.sidePanelOpen = true;

    let targetUrl = 'mtc://notes';
    if (mode === 'downloads') {
      targetUrl = 'mtc://downloads';
    }

    const sidePanelPreload = selectPreload(targetUrl);

    const needsNewView = !this.sidePanelView ||
      this.sidePanelView._currentPreload !== sidePanelPreload;

    if (needsNewView) {
      if (this.sidePanelView && this.mainWindow) {
        this.mainWindow.contentView.removeChildView(this.sidePanelView);
        this.sidePanelView.webContents.close();
        this.sidePanelView = null;
      }

      this.sidePanelView = new WebContentsView({
        webPreferences: {
          preload:          sidePanelPreload,
          contextIsolation: true,
          nodeIntegration:  false,
          sandbox:          false
        }
      });
      this.sidePanelView._currentPreload = sidePanelPreload;

      this.sidePanelView.webContents.setWindowOpenHandler(({ url }) => {
        if (isPopupBlocked(url)) return { action: 'deny' };
        this.createTab(url);
        return { action: 'deny' };
      });
    }

    this.sidePanelView.webContents.loadURL(targetUrl);

    if (this.mainWindow) {
      this.mainWindow.contentView.addChildView(this.sidePanelView);
    }

    this.updateViewBounds();
  }

  closeSidePanel() {
    this.sidePanelOpen = false;
    this.sidePanelMode = null;

    if (this.sidePanelView && this.mainWindow) {
      this.mainWindow.contentView.removeChildView(this.sidePanelView);
    }

    this.updateViewBounds();
  }

  // ─── Broadcast Helpers ───────────────────────────────────────────────────

  broadcastTabsUpdate(isIncognito = false) {
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    if (!targetWin || !targetWin.webContents || targetWin.isDestroyed()) return;

    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    const activeId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;

    const serializedTabs = order
      .filter(id => this.tabs[id])
      .map(id => {
        const t = this.tabs[id];
        return {
          id:           t.id,
          title:        t.title,
          url:          t.url,
          favicon:      t.favicon,
          isAudible:    t.isAudible,
          isMuted:      t.isMuted,
          isLoading:    t.isLoading,
          isSleeping:   t.isSleeping,
          isPinned:     t.isPinned,
          isIncognito:  Boolean(t.isIncognito),
          canGoBack:    t.canGoBack,
          canGoForward: t.canGoForward
        };
      });

    targetWin.webContents.send('tabs:updated', serializedTabs, activeId);
    targetWin.webContents.send('adblocker:count', this.adBlocker ? this.adBlocker.getBlockedCount() : 0);
  }

  updateNavigationState(isIncognito = false) {
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    const activeId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;
    const activeTab = this.tabs[activeId];
    if (activeTab && activeTab.view && targetWin && !targetWin.isDestroyed() && targetWin.webContents) {
      const wc = activeTab.view.webContents;
      const canBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      const canFwd  = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      targetWin.webContents.send('tab:navState', {
        canGoBack:    canBack,
        canGoForward: canFwd,
        isLoading:    Boolean(activeTab.isLoading),
        url:          activeTab.url
      });
    }
  }

  // ─── Omnibox URL / Search Classification (Stage 1) ───────────────────────

  formatUrl(input) {
    let target = (input || '').trim();
    if (!target) return 'mtc://newtab';

    // Block dangerous schemes in raw input
    if (/^(javascript|data|vbscript):/i.test(target)) {
      securityLogger.security(`formatUrl blocked dangerous input: ${target.slice(0, 64)}`);
      return 'mtc://newtab';
    }

    let finalUrl;

    // 1. Internal schemes or file protocol
    if (target.startsWith('mtc://') || target.startsWith('file://') || target.startsWith('about:')) {
      finalUrl = target;
    }
    // 2. Contains any whitespace -> definitely search query (e.g. "steel casting manufacturers India")
    else if (/\s/.test(target)) {
      finalUrl = this._getSearchUrl(target);
    }
    // 3. Explicit HTTP / HTTPS
    else if (/^https?:\/\//i.test(target)) {
      finalUrl = target;
    }
    // 4. Localhost or IP address (e.g. localhost, localhost:3000, 127.0.0.1, 192.168.1.1:8080)
    else if (
      /^localhost(:\d+)?(\/.*)?$/i.test(target) ||
      /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/.test(target)
    ) {
      finalUrl = 'http://' + target;
    }
    // 5. Standard domain name with valid TLD (e.g. github.com, example.org/path?a=1)
    else if (/^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(target)) {
      finalUrl = 'https://' + target;
    }
    // 6. Otherwise -> search query
    else {
      finalUrl = this._getSearchUrl(target);
    }

    if (!isSafeToLoad(finalUrl) && !finalUrl.startsWith('mtc://')) {
      return 'mtc://newtab';
    }

    return finalUrl;
  }

  _getSearchUrl(query) {
    const settings   = this.storage ? this.storage.getSettings() : {};
    const engine     = settings.searchEngine || 'google';
    const engineUrls = settings.searchEngineUrls || {
      google:     'https://www.google.com/search?q=',
      bing:       'https://www.bing.com/search?q=',
      duckduckgo: 'https://duckduckgo.com/?q='
    };
    const baseUrl = engineUrls[engine] || engineUrls['google'] || 'https://www.google.com/search?q=';
    return baseUrl + encodeURIComponent(query);
  }

  // ─── YouTube Ad Optimizer ────────────────────────────────────────────────

  _applyYouTubeOptimizer(wc, currentUrl) {
    if (!currentUrl || !currentUrl.includes('youtube.com')) return;

    wc.insertCSS(`
      ytd-banner-promo-renderer, ytd-ad-slot-renderer,
      ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer,
      ytd-promoted-video-renderer, ytd-display-ad-renderer,
      ytd-statement-banner-renderer, .ytp-ad-overlay-container,
      .ytp-ad-message-container, .ytp-ad-action-interstitial,
      #player-ads, #masthead-ad,
      ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
      ytd-item-section-renderer:has(ytd-ad-slot-renderer),
      ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
      tp-yt-paper-dialog:has(ytd-enforcement-message-view-model),
      .ytp-ad-preview-container, .ytp-ad-overlay-slot,
      ytd-companion-slot-renderer { display: none !important; }
    `).catch(() => {});

    wc.executeJavaScript(`
      (function() {
        if (window.__mtc_yt_killer_active__) return;
        window.__mtc_yt_killer_active__ = true;

        try {
          let _yp = window.ytInitialPlayerResponse;
          Object.defineProperty(window, 'ytInitialPlayerResponse', {
            get() { return _yp; },
            set(val) {
              if (val) { delete val.adPlacements; delete val.playerAds; delete val.adSlots; }
              _yp = val;
            },
            configurable: true
          });
          if (_yp) { delete _yp.adPlacements; delete _yp.playerAds; delete _yp.adSlots; }
        } catch(e) {}

        try {
          const origFetch = window.fetch;
          window.fetch = async function(...args) {
            const res = await origFetch.apply(this, args);
            try {
              const url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';
              if (url && (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next'))) {
                const clone = res.clone();
                const text  = await clone.text();
                try {
                  const data = JSON.parse(text);
                  if (data.adPlacements) delete data.adPlacements;
                  if (data.playerAds)    delete data.playerAds;
                  if (data.adSlots)      delete data.adSlots;
                  return new Response(JSON.stringify(data), {
                    headers: res.headers, status: res.status, statusText: res.statusText
                  });
                } catch(err) { return res; }
              }
            } catch(e) {}
            return res;
          };
        } catch(e) {}

        function nukeYouTubeAds() {
          const video  = document.querySelector('video.html5-main-video') || document.querySelector('video');
          const player = document.querySelector('.html5-video-player');
          const isAd   = player && (
            player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting') ||
            document.querySelector('.ytp-ad-player-overlay') ||
            document.querySelector('.ytp-ad-text') || document.querySelector('.ytp-ad-preview-text')
          );
          if (isAd && video) {
            video.muted = true;
            video.playbackRate = 16.0;
            if (isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
          }
          const skipButtons = [
            '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern', '.ytp-skip-ad-button',
            'button.ytp-ad-skip-button-icon', '.ytp-ad-overlay-close-button', '#dismiss-button'
          ];
          for (const sel of skipButtons) {
            const btn = document.querySelector(sel);
            if (btn && typeof btn.click === 'function') btn.click();
          }
          const dialog = document.querySelector(
            'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model) #dismiss-button, ytd-enforcement-message-view-model button'
          );
          if (dialog) { dialog.click(); if (video && video.paused) video.play(); }
        }

        setInterval(nukeYouTubeAds, 100);
        window.addEventListener('yt-navigate-finish', nukeYouTubeAds);
        nukeYouTubeAds();
      })();
    `).catch(() => {});
  }

  // ─── Credential & Autofill Helpers (Stage 6) ─────────────────────────────

  _attachCredentialAndAutofillHooks(wc, tabData) {
    if (!tabData || tabData.isIncognito || !tabData.url) return;
    if (!tabData.url.startsWith('http://') && !tabData.url.startsWith('https://')) return;

    let origin;
    try {
      origin = new URL(tabData.url).origin;
    } catch (_) {
      return;
    }

    if (this.passwordVault && this.passwordVault.isNeverSaveOrigin(origin)) {
      return;
    }

    wc.executeJavaScript(`
      (function() {
        if (window.__shmmoth_login_hook__) return;
        window.__shmmoth_login_hook__ = true;

        document.addEventListener('submit', function(e) {
          try {
            var form = e.target;
            if (!form || typeof form.querySelectorAll !== 'function') return;
            var pw = form.querySelector('input[type="password"]');
            if (!pw || !pw.value) return;

            var allInputs = Array.prototype.slice.call(form.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])'));
            var userInput = allInputs.filter(function(input) {
              var attr = ((input.name || '') + ' ' + (input.id || '') + ' ' + (input.type || '') + ' ' + (input.getAttribute('autocomplete') || '')).toLowerCase();
              return /user|email|login|name|account/i.test(attr);
            })[0] || allInputs[0];

            var usernameVal = userInput ? (userInput.value || '').trim() : '';
            var passwordVal = pw.value;

            if (usernameVal && passwordVal) {
              console.log('__SHMMOTH_LOGIN_SUBMIT__:' + JSON.stringify({
                username: usernameVal,
                password: passwordVal
              }));
            }
          } catch (_) {}
        }, true);
      })();
    `).catch(() => {});
  }

  openPasswordBubble(data, isIncognito = false) {
    if (this.passwordBubbleWin && !this.passwordBubbleWin.isDestroyed()) {
      this.closePasswordBubble();
    }

    const parentWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    if (!parentWin || parentWin.isDestroyed()) return false;

    const width = 340;
    const height = 185;
    const winBounds = parentWin.getBounds();

    // Position neatly at top-right under the toolbar/address bar
    let x = Math.round(winBounds.x + winBounds.width - width - 110);
    let y = Math.round(winBounds.y + 82);

    // Keep on screen within parent window bounds
    x = Math.max(winBounds.x + 10, Math.min(x, winBounds.x + winBounds.width - width - 10));

    this.passwordBubbleWin = new BrowserWindow({
      width,
      height,
      x,
      y,
      parent: parentWin,
      frame: false,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: PRELOAD_INTERNAL
      }
    });

    this.passwordBubbleWin.loadFile(path.join(__dirname, 'pages', 'password-bubble.html'));

    this.passwordBubbleWin.once('ready-to-show', () => {
      if (this.passwordBubbleWin && !this.passwordBubbleWin.isDestroyed()) {
        this.passwordBubbleWin.show();
        this.passwordBubbleWin.webContents.send('password:offerSave', data);
      }
    });

    return true;
  }

  closePasswordBubble() {
    if (this.passwordBubbleWin && !this.passwordBubbleWin.isDestroyed()) {
      this.passwordBubbleWin.close();
      this.passwordBubbleWin = null;
    }
    this.currentPasswordPrompt = null;
  }

  offerPasswordSave(tabId, origin, username, password) {
    if (!origin || !username || !password) return;
    if (this.passwordVault && this.passwordVault.isNeverSaveOrigin(origin)) return;

    const promptId = 'pwd_prompt_' + (++this.passwordPromptCounter);
    this.pendingPasswordPrompts[promptId] = {
      promptId,
      tabId,
      origin,
      username,
      password,
      timeout: setTimeout(() => {
        this.closePasswordBubble();
        delete this.pendingPasswordPrompts[promptId];
      }, 60000)
    };

    this.currentPasswordPrompt = {
      promptId,
      origin,
      username
    };

    // Open native floating password bubble on top of WebContentsView
    this.openPasswordBubble(this.currentPasswordPrompt);
  }

  _handlePasswordPromptResponse(promptId, action) {
    this.closePasswordBubble();

    const prompt = this.pendingPasswordPrompts[promptId];
    if (!prompt) return { success: false, error: 'Prompt expired or invalid' };

    clearTimeout(prompt.timeout);
    delete this.pendingPasswordPrompts[promptId];

    if (action === 'save') {
      const saved = this.passwordVault.saveCredential({
        origin: prompt.origin,
        username: prompt.username,
        password: prompt.password
      });
      return { success: true, saved: true, id: saved.id };
    } else if (action === 'never') {
      this.passwordVault.neverSaveOrigin(prompt.origin);
      return { success: true, never: true };
    }
    return { success: true, dismissed: true };
  }

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
        // IPC navigations are initiated by browser chrome UI
        const result  = checkNavigation('file:///renderer/index.html', safeUrl);
        if (!result.allowed) {
          securityLogger.security(`IPC tab:navigate blocked`, { reason: result.reason });
          return { success: false, error: result.reason };
        }
        tab.view.webContents.loadURL(safeUrl);
      }
    }));

    ipcMain.handle('tab:navigateCurrent', secureHandlerRaw((_, targetUrl) => {
      const tab = this.tabs[this.activeTabId];
      if (tab && tab.view) {
        const safeUrl = this.formatUrl(validateUrl(targetUrl));
        // IPC navigations are initiated by browser chrome UI
        const result  = checkNavigation('file:///renderer/index.html', safeUrl);
        if (!result.allowed) {
          securityLogger.security(`IPC tab:navigateCurrent blocked`, { reason: result.reason });
          return;
        }
        tab.view.webContents.loadURL(safeUrl);
      }
    }));

    ipcMain.handle('tab:reload', secureHandlerRaw((_, tabId) => {
      const tab = this.tabs[tabId || this.activeTabId];
      if (tab && tab.view) {
        if (tab.isCrashed || (tab.url && tab.url.startsWith('mtc://crash'))) {
          tab.isCrashed = false;
          const target = tab.lastValidUrl && !tab.lastValidUrl.startsWith('mtc://crash') ? tab.lastValidUrl : 'mtc://newtab';
          tab.view.webContents.loadURL(target);
          return;
        }
        tab.view.webContents.reload();
      }
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
      const updated = this.storage.updateSettings(delta);
      if (delta.adBlockerEnabled !== undefined) {
        this.adBlocker.setEnabled(delta.adBlockerEnabled);
      }
      if (delta.showBookmarksBar !== undefined) {
        this.updateViewBounds();
      }
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
        const sess = isIncognito ? session.fromPartition('incognito') : session.defaultSession;
        sess.downloadURL(url);
        log.info('Download retried via background session.downloadURL', { url: url.slice(0, 100), isIncognito });
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

      return { success: true };
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
      const saved = this.passwordVault.saveCredential({
        origin: safeOrigin,
        username: safeUser,
        password: safePass,
      });
      return { success: true, credential: saved };
    }));

    ipcMain.handle('passwords:update', secureHandlerRaw(async (event, id, updates) => {
      if (!this.passwordVault) return { success: false, error: 'Password vault unavailable' };
      const safeId = sanitizeString(id || '', 64, 'id');
      const updated = this.passwordVault.updateCredential(safeId, updates);
      return { success: Boolean(updated), credential: updated };
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

    ipcMain.handle('passwords:reveal', secureHandlerRaw(async (event, id) => {
      if (!this.passwordVault) return { success: false, error: 'Password vault unavailable' };
      const safeId = sanitizeString(id || '', 64, 'id');
      const plaintext = this.passwordVault.decryptForAuthorizedUse(safeId);
      if (plaintext === null) {
        return { success: false, error: 'Credential not found or decryption failed' };
      }
      return { success: true, password: plaintext };
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
        await this.proxyManager.applyToSession(session.defaultSession);
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
      const res = await this.proxyManager.resetToSystem(session.defaultSession);
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

    log.info('IPC handlers registered');
  }
}

// ─── Process Error Guards ───────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception in main process', { error: err?.message, stack: err?.stack });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection in main process', { error: reason?.message || String(reason) });
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const shmmothApp = new ShmmothBrowserApp();
shmmothApp.init().catch(err => {
  console.error('[FATAL] SHMMOTH Browser failed to initialise:', err);
  app.quit();
});
