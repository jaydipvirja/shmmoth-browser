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

// imports and constants shared with the modules in src/browser/
const {
  app,
  BrowserWindow,
  protocol,
  session,
  dialog,
  clipboard,
  screen,
  path,
  fs,
  StorageService,
  AdBlockerService,
  PopupPolicy,
  GoogleSignIn,
  PasswordGate,
  RamSaverService,
  DownloadManager,
  PasswordVault,
  PasswordAutofill,
  FormAutofill,
  PrivacyShield,
  webRequestHub,
  AutofillService,
  ProxyManager,
  ExtensionManager,
  UpdateManager,
  SessionStore,
  log,
  urlsFromArgv,
  DESKTOP_UA_FALLBACK
} = require('./browser/shared');
const { normalizeTheme } = require('./services/theme');

// Prevent Chromium automation flags from interfering with Google Sign-in and anti-bot verification
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

app.userAgentFallback = DESKTOP_UA_FALLBACK;

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

class ShmmothBrowserApp {
  constructor() {
    this.mainWindow      = null;
    this.incognitoWindow = null;
    this.storage         = null;
    this.adBlocker       = null;
    this.popupPolicy     = null;
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
    this.passwordAutofill = null;
    this.formAutofill = null;
    this.privacyShield = null;
    this.passwordGate = null;
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

    // Floating Bubbles (Chrome Style)
    this.extensionBubbleWin = null;
    this.shieldBubbleWin = null;
    this.permissionBubbleWin = null;

    // Windows 10 Lag & Compositor Caching
    this._cachedHeaderHeight = 114;
    this._resizeTimeout = null;
    this.cleanUa = '';

    // Web addresses given on the command line, waiting for the browser window to be ready
    this.launchUrls = [];

    // Session restore: tabs are written to disk shortly after every change, but only once start-up has finished
    // creating its tabs (otherwise the half-built tab list would overwrite the session that is about to be restored)
    this.sessionStore = null;
    this._sessionReady = false;
    this._sessionTimer = null;
  }

  // ─── Initialisation ─────────────────────────────────────────────────────────

  async init() {
    await app.whenReady();
    log.info('App ready — starting SHMMOTH Browser initialisation');

    // 1. Storage
    this.storage = new StorageService();
    this.sessionStore = new SessionStore(app.getPath('userData'));
    this.applySecureDns();
    // What Chromium draws itself (scroll bars, form controls, menus) follows the Theme setting (services/theme.js)
    require('electron').nativeTheme.themeSource = normalizeTheme(this.storage.getSettings().theme);

    // Standardise User-Agent to match official Google Chrome early (before any windows or tabs are created)
    const rawUa = session.defaultSession.getUserAgent();
    this.cleanUa = rawUa
      .replace(/Electron\/\S+\s?/, '')
      .replace(/mtc-browser\/\S+\s?/, '')
      .replace(/shmmoth-browser\/\S+\s?/, '')
      .trim() || DESKTOP_UA_FALLBACK;

    app.userAgentFallback = this.cleanUa;
    session.defaultSession.setUserAgent(this.cleanUa);
    session.fromPartition('incognito').setUserAgent(this.cleanUa);

    // Google's sign-in pages: which browser identity is shown there, and a retry with the next one when Google refuses
    this.googleSignIn = new GoogleSignIn({
      storage: this.storage, platform: process.platform, chromeVersion: process.versions.chrome, appVersion: app.getVersion(), log
    });
    // Privacy shield (cross-site cookies, link tracking, GPC, referrer, HTTPS-Only). The request hub goes in first: the
    // sign-in rules below and the ad blocker then share the session's request events with it (services/webRequestHub.js)
    this.privacyShield = new PrivacyShield({
      getSettings: () => this.storage.getSettings(),
      updateSettings: (delta) => this.storage.updateSettings(delta),
      log
    });
    this.privacyShield.attach(webRequestHub.install(session.defaultSession), 'default');
    this.privacyShield.attach(webRequestHub.install(session.fromPartition('incognito')), 'incognito');
    this.applyGpcPreload();

    this.setupSignInClientHints(session.defaultSession);
    this.setupSignInClientHints(session.fromPartition('incognito'));

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
      isProxyActive: () => this.isProxyActive(),
      // a live tab of the normal / incognito session: downloads started from a WebContents carry the Referer
      getDownloadHost: (isIncognito) => {
        const live = (t) => (t && t.view && t.view.webContents && !t.view.webContents.isDestroyed() ? t.view.webContents : null);
        let wc = live(this.tabs[isIncognito ? this.activeIncognitoTabId : this.activeTabId]);
        if (!wc) {
          for (const t of Object.values(this.tabs)) {
            if (Boolean(t.isIncognito) === Boolean(isIncognito) && (wc = live(t))) break;
          }
        }
        return wc;
      },
      confirmOpenDangerous: async ({ filename }) => {
        const win = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null;
        const res = await dialog.showMessageBox(...(win ? [win] : []), {
          type: 'warning',
          title: 'Open this file?',
          message: `"${filename}" can run programs on your computer.`,
          detail: 'Only open it if you downloaded it on purpose from a website you trust. Otherwise choose Cancel and delete it.',
          buttons: ['Cancel', 'Open anyway'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        });
        return res.response === 1;
      },
      // Synchronous on purpose: Electron needs the save path before the "will-download" handler returns (a path chosen
      // later is ignored and Electron opens its own dialog instead), and the dialog is modal anyway.
      promptSaveDialog: ({ filename, defaultPath, webContents }) => {
        const win = (webContents && BrowserWindow.fromWebContents(webContents)) || this.mainWindow;
        if (!win || win.isDestroyed()) return { cancelled: true };
        const filePath = dialog.showSaveDialogSync(win, {
          title: 'Save File',
          defaultPath: defaultPath || filename
        });
        return { cancelled: !filePath, filePath };
      }
    });

    this.downloads.attach(session.defaultSession, (record) => {
      this.broadcastDownloadUpdate(record);
    }, { isIncognito: false });

    this.downloads.attach(session.fromPartition('incognito'), (record) => {
      this.broadcastDownloadUpdate(record);
    }, { isIncognito: true });

    // 7. RAM Saver
    const browser = this;
    this.ramSaver = new RamSaverService(this.storage, {
      tabs: this.tabs,
      // getters: a plain `activeTabId: this.activeTabId` copied the value (null) at start-up, so the tab in use could be
      // put to sleep after the idle time
      get activeTabId() { return browser.activeTabId; },
      get activeIncognitoTabId() { return browser.activeIncognitoTabId; },
      notifyTabStatus: (tabId, status) => {
        if (this.tabs[tabId]) {
          Object.assign(this.tabs[tabId], status);
          this.broadcastTabsUpdate();
        }
      }
    });

    // 8. Wire AdBlocker (Ghostery engine; a short built-in list covers the first seconds and offline starts)
    this.adBlocker = new AdBlockerService(this.storage, { cacheFile: path.join(app.getPath('userData'), 'adblock-engine-2.bin') });
    // the engine of 1.1.6 and before (EasyList + EasyPrivacy only, no element hiding) is replaced by the new one
    for (const old of ['adblock-engine.bin', 'adblock-engine.bin.stale', 'adblock-engine.bin.tmp']) {
      fs.rm(path.join(app.getPath('userData'), old), { force: true }, () => {});
    }
    this.popupPolicy = new PopupPolicy({ adBlocker: this.adBlocker, getSettings: () => this.storage.getSettings() });
    this.registerGesturePreload(session.defaultSession);
    this.adBlocker.setupFilter(session.defaultSession).catch(err => {
      log.warn('AdBlocker setupFilter failed', { error: err.message });
    });

    // 9. Wire Content Permissions (Stage 5)
    this.setupPermissions(session.defaultSession);

    // 10. Wire PasswordVault, AutofillService, and ProxyManager (Stage 6)
    // The OS-encrypted vault is required everywhere. Only an UNPACKAGED dev run may opt into the test key, which is
    // what lets the end-to-end tests store a login on a Linux CI machine that has no OS keyring.
    this.passwordVault = new PasswordVault(null, {
      allowInsecureFallback: !app.isPackaged && process.env.SHMMOTH_E2E_INSECURE_VAULT === '1'
    });
    // Showing or copying a saved password asks first, in a native window of the browser (services/passwordGate.js)
    this.passwordGate = new PasswordGate({
      clipboard,
      log,
      confirm: async ({ title, message, detail, confirmLabel, parent }) => {
        const options = { type: 'question', title, message, detail, buttons: [confirmLabel, 'Cancel'], defaultId: 1, cancelId: 1, noLink: true };
        const result = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
        return result.response === 0;
      }
    });
    this.passwordAutofill = new PasswordAutofill({
      vault: this.passwordVault,
      isEnabled: () => this.storage.getSettings().passwordAutofillEnabled !== false,
      getTab: (tabId) => this.tabs[tabId],
      isActiveTab: (tab) => tab.id === (tab.isIncognito ? this.activeIncognitoTabId : this.activeTabId),
      getParentWindow: (tab) => (tab.isIncognito ? this.incognitoWindow : this.mainWindow),
      createBubble: (opts) => this.createPasswordAutofillBubble(opts),
      getCursor: () => screen.getCursorScreenPoint(),
      log
    });
    this.autofillService = new AutofillService();
    this.formAutofill = new FormAutofill({
      service: this.autofillService,
      getTab: (tabId) => this.tabs[tabId],
      isActiveTab: (tab) => tab.id === (tab.isIncognito ? this.activeIncognitoTabId : this.activeTabId),
      getParentWindow: (tab) => (tab.isIncognito ? this.incognitoWindow : this.mainWindow),
      createBubble: (opts) => this.createPasswordAutofillBubble(opts, 'form-autofill-bubble.html'),
      getCursor: () => screen.getCursorScreenPoint(),
      log
    });
    this.proxyManager = new ProxyManager(null, this.passwordVault);

    // Apply saved proxy to EVERY browsing session (normal + incognito) so incognito never bypasses it
    await this.applyProxyToAllSessions().catch(err => {
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
    this.updateManager = new UpdateManager({
      storage: this.storage,
      // the installer may end this process the hard way: everything must be on disk before it starts
      prepareToQuit: () => Promise.race([this.flushBrowserData('quit'), new Promise((resolve) => setTimeout(resolve, 3000))])
    });
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

    app.on('before-quit', (event) => {
      this._finalizeSession();
      // a copied password does not outlive the browser
      const clipboardCleared = this.passwordGate ? this.passwordGate.clearClipboardNow().catch(() => {}) : Promise.resolve();
      // fast-engine downloads still running: which blocks are on the disk is saved now, so Resume after the next
      // start continues from the last one
      try { if (this.downloads) this.downloads.checkpointAll(); } catch (_) { /* best effort */ }
      if (this._dataFlushed) return;
      // Cookies and page storage are written to disk before the process goes away. Chromium writes them in batches
      // (about every 30 s): what is still in the last batch would be lost, and a session that Google has already
      // renewed would come back with the old cookies and be refused ("signed out").
      event.preventDefault();
      this._dataFlushed = true;
      Promise.race([Promise.all([this.flushBrowserData('quit'), clipboardCleared]), new Promise((resolve) => setTimeout(resolve, 3000))])
        .catch(() => {})
        .then(() => app.quit());
    });
    this.setupLoginDurability();

    log.info('SHMMOTH Browser initialisation complete');
  }
}

// The rest of the class lives in src/browser/ (one file per area, see docs/architecture.md)
require('./browser/mixins')(ShmmothBrowserApp);

// ─── Process Error Guards ───────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception in main process', { error: err?.message, stack: err?.stack });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection in main process', { error: reason?.message || String(reason) });
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const shmmothApp = new ShmmothBrowserApp();
if (!app.requestSingleInstanceLock()) {
  log.info('SHMMOTH Browser is already running with this profile — handing over and exiting');
  app.quit();
} else {
  shmmothApp.launchUrls = urlsFromArgv(process.argv);
  app.on('second-instance', (_event, argv) => shmmothApp.handleSecondInstance(argv));
  shmmothApp.init().catch(err => {
    console.error('[FATAL] SHMMOTH Browser failed to initialise:', err);
    app.quit();
  });
}
