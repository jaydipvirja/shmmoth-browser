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

const { app, BrowserWindow, WebContentsView, protocol, net, ipcMain, session, dialog, Menu, MenuItem, clipboard, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

const StorageService   = require('./services/storage');
const AdBlockerService = require('./services/adblocker');
const PopupPolicy      = require('./services/popupPolicy');
const RamSaverService  = require('./services/ramSaver');
const DownloadManager  = require('./services/downloadManager');
const { PasswordVault }   = require('./services/passwordVault');
const { PasswordAutofill } = require('./services/passwordAutofill');
const { AutofillService } = require('./services/autofillService');
const { ProxyManager }    = require('./services/proxyManager');
const ExtensionManager    = require('./services/extensionManager');
const UpdateManager       = require('./services/updateManager');
const { SessionStore, buildSnapshot } = require('./services/sessionStore');


const { secureHandlerRaw, validateUrl, sanitizeString } = require('./security/ipcSecurity');
const { checkNavigation, isPopupBlocked, isSafeToLoad }  = require('./security/urlPolicy');
const { isTrustedInternalUrl, BROWSER_CHROME_URL }        = require('./security/trustedPages');
const { MTC_PAGE_CSP }                                    = require('./security/csp');
const { mainLogger: log, securityLogger }                 = require('./utils/logger');
const { urlsFromArgv }                                    = require('./utils/launchArgs');
const { shouldShowErrorPage, buildErrorPageUrl, displayUrl } = require('./utils/errorPage');
const secureDns = require('./services/secureDns');
const { isAlwaysAllowedPermission } = require('./security/permissionPolicy');

// Prevent Chromium automation flags from interfering with Google Sign-in and anti-bot verification
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// The UA / Client-Hints strings we present must match the Chromium that is actually running; a
// hard-coded version drifts apart from the engine on every Electron upgrade (and looks inconsistent
// to anti-bot checks). Always derive it from the runtime.
const CHROME_MAJOR = String((process.versions && process.versions.chrome) || '130').split('.')[0];
const CHROME_REDUCED = `Chrome/${CHROME_MAJOR}.0.0.0`;
const DESKTOP_UA_FALLBACK = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${CHROME_REDUCED} Safari/537.36`;
app.userAgentFallback = DESKTOP_UA_FALLBACK;

// Dedicated Google Authentication User-Agent to pass BotGuard web attestation on accounts.google.com
const GOOGLE_AUTH_UA = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ${CHROME_REDUCED} Mobile Safari/537.36`;

function isGoogleAuthUrl(url) {
  if (typeof url !== 'string') return false;
  return url.includes('accounts.google.com') || url.includes('accounts.youtube.com');
}

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
 * Trusted internal pages (mtc:// and the exact app-shipped file:// documents)
 * → full API preload. Everything else, including arbitrary local files, →
 * empty/minimal external preload.
 *
 * @param {string} url
 * @returns {string} absolute path to preload file
 */
function selectPreload(url) {
  return isTrustedInternalUrl(url) ? PRELOAD_INTERNAL : PRELOAD_EXTERNAL;
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

    // Synchronize Client Hints and headers for Google accounts and services
    this.setupGoogleAuthHeaders(session.defaultSession);
    this.setupGoogleAuthHeaders(session.fromPartition('incognito'));

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
      if (this._dataFlushed) return;
      // Cookies and page storage are written to disk before the process goes away. Chromium writes them in batches
      // (about every 30 s): what is still in the last batch would be lost, and a session that Google has already
      // renewed would come back with the old cookies and be refused ("signed out").
      event.preventDefault();
      this._dataFlushed = true;
      Promise.race([this.flushBrowserData('quit'), new Promise((resolve) => setTimeout(resolve, 3000))])
        .catch(() => {})
        .then(() => app.quit());
    });
    this.setupLoginDurability();

    log.info('SHMMOTH Browser initialisation complete');
  }

  // ─── Secure DNS ──────────────────────────────────────────────────────────

  /** Applies the saved DNS-over-HTTPS choice (app.configureHostResolver must run after 'ready'; init() calls this first). */
  applySecureDns() {
    const { provider, options } = secureDns.buildHostResolverConfig(this.storage.getSettings());
    try {
      app.configureHostResolver(options);
      // answers cached from the previous resolver (e.g. the system's) would otherwise live on for a while
      Promise.all(this._browsingSessions().map((s) => s.clearHostResolverCache())).catch(() => {});
      log.info('Secure DNS configured', { provider, mode: options.secureDnsMode, servers: options.secureDnsServers });
    } catch (err) {
      log.warn('Could not configure secure DNS', { error: err.message });
    }
    return provider;
  }

  /** What the Settings page shows. */
  getSecureDnsState() {
    const s = this.storage.getSettings();
    const provider = secureDns.normalizeProvider(s.secureDnsProvider);
    const effective = secureDns.buildHostResolverConfig(s);
    return {
      provider,
      effectiveProvider: effective.provider,
      customUrl: typeof s.secureDnsCustomUrl === 'string' ? s.secureDnsCustomUrl : '',
      strict: s.secureDnsStrict === true,
      servers: effective.options.secureDnsServers,
      providers: Object.values(secureDns.PROVIDERS).map((p) => ({ id: p.id, label: p.label, description: p.description }))
    };
  }

  // ─── Session restore ─────────────────────────────────────────────────────

  /** The first tabs of this run: the previous session ("Continue where I left off"), command-line URLs, or the new-tab page. */
  _createStartupTabs() {
    const launchUrls = this.launchUrls.splice(0);
    const wantsRestore = this.storage.getSettings().startupBehavior === 'restore';
    const saved = wantsRestore && this.sessionStore ? this.sessionStore.load() : null;

    if (saved) {
      const ids = saved.tabs.map((t, i) => this.createTab(t.url, null, t.pinned, false, false, {
        // only the tab the user will see is loaded now; the others load when they are first selected
        background: i !== saved.active, deferLoad: i !== saved.active, title: t.title, favicon: t.favicon
      }));
      log.info('Previous session restored', { tabs: ids.length });
      // a pinned tab moves to the front, so select the tab by id rather than by position
      const wanted = ids[saved.active];
      if (wanted && this.tabs[wanted]) this.switchTab(wanted);
    }
    launchUrls.forEach((u) => this.createTab(u));
    if (!saved && launchUrls.length === 0) this.createTab('mtc://newtab');

    this._sessionReady = true;
    this._saveSessionNow();
  }

  /** Writes the session one last time and stops further writes (window closing / app quitting). */
  // ─── Login durability ────────────────────────────────────────────────────

  /** Writes the cookies and page storage of the normal profile to disk now (incognito is in memory by design). */
  async flushBrowserData(tag = 'flush') {
    const normal = session.defaultSession;
    try { await normal.cookies.flushStore(); } catch (err) { log.warn('Could not write cookies to disk', { error: err.message }); }
    try { normal.flushStorageData(); } catch (_) { /* nothing to write */ }
    if (tag === 'quit') await this.logLoginHealth('at quit');
  }

  /**
   * Cookie changes reach the disk a moment after they happen instead of with the next batch. Google renews its session
   * cookies every few minutes; if the browser is ended hard (update installer, Task Manager, crash, power cut) the
   * renewed value must already be stored.
   */
  setupLoginDurability() {
    let timer = null;
    let last = 0;
    const schedule = () => {
      if (timer) return;
      const wait = Math.max(500, 3000 - (Date.now() - last));
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        this.flushBrowserData().catch(() => {});
      }, wait);
      if (timer.unref) timer.unref();
    };
    try {
      session.defaultSession.cookies.on('changed', schedule);
    } catch (err) {
      log.warn('Could not watch cookie changes', { error: err.message });
    }
    // what survives a restart, written to the log (names only, never values) to see where a lost login went
    const t = setTimeout(() => this.logLoginHealth('at start').catch(() => {}), 8000);
    if (t.unref) t.unref();
  }

  /** Logs which sign-in cookies of Google exist (names and counts only). */
  async logLoginHealth(when) {
    try {
      const cookies = await session.defaultSession.cookies.get({ domain: 'google.com' });
      const names = new Set(cookies.map((c) => c.name));
      const keys = ['SID', 'HSID', 'LSID', '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PSIDTS', '__Host-GAPS'];
      log.info(`Google sign-in cookies ${when}`, {
        cookies: cookies.length,
        present: keys.filter((k) => names.has(k)),
        sessionOnly: cookies.filter((c) => c.session).length
      });
    } catch (_) { /* logging only */ }
  }

  _finalizeSession() {
    this._saveSessionNow();
    this._sessionReady = false;
    if (this.storage) this.storage.flush();            // coalesced history writes
  }

  /** Called on every tab change; writes at most once a second. */
  _scheduleSessionSave() {
    if (!this._sessionReady || this._sessionTimer) return;
    this._sessionTimer = setTimeout(() => { this._sessionTimer = null; this._saveSessionNow(); }, 1000);
    if (this._sessionTimer.unref) this._sessionTimer.unref();
  }

  _saveSessionNow() {
    if (!this._sessionReady || !this.sessionStore) return;
    if (this._sessionTimer) { clearTimeout(this._sessionTimer); this._sessionTimer = null; }
    this.sessionStore.save(buildSnapshot(this.tabs, this.tabOrder, this.activeTabId));
  }

  // ─── Single instance ─────────────────────────────────────────────────────

  /**
   * A second launch with the same profile (double-clicked shortcut, `shmmoth.exe <url>`) must not start another
   * process that fights over the same data files; the running browser comes to the front and opens the URLs.
   */
  handleSecondInstance(argv) {
    const urls = urlsFromArgv(argv);
    log.info('Second instance handed over to the running browser', { urls: urls.length });
    const win = this.mainWindow;
    if (!win || win.isDestroyed() || Object.keys(this.tabs).length === 0) {
      this.launchUrls.push(...urls);                       // still starting up: the first tab will pick them up
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    urls.forEach((u) => this.createTab(u));
  }

  // ─── Proxy / network privacy ─────────────────────────────────────────────

  /** All sessions that carry web content. A proxy must apply to every one of them. */
  _browsingSessions() {
    return [session.defaultSession, session.fromPartition('incognito')];
  }

  /**
   * WebRTC can open UDP sockets that bypass an HTTP/SOCKS proxy and reveal the real IP.
   * With a manual proxy only proxied UDP is allowed; otherwise Chromium's default is kept.
   */
  _webRtcPolicyForProxy() {
    const cfg = this.proxyManager ? this.proxyManager.getConfig() : null;
    return cfg && cfg.mode === 'manual' ? 'disable_non_proxied_udp' : 'default';
  }

  _applyWebRtcPolicy(wc) {
    try {
      if (wc && !wc.isDestroyed()) wc.setWebRTCIPHandlingPolicy(this._webRtcPolicyForProxy());
    } catch (err) {
      log.warn('Could not set WebRTC IP handling policy', { error: err.message });
    }
  }

  /** Applies the saved proxy to the normal AND the incognito session, and refreshes WebRTC policy of open tabs. */
  async applyProxyToAllSessions() {
    if (!this.proxyManager) return;
    for (const sess of this._browsingSessions()) {
      await this.proxyManager.applyToSession(sess);
    }
    await this.refreshSystemProxyState();
    for (const tab of Object.values(this.tabs)) {
      if (tab && tab.view) this._applyWebRtcPolicy(tab.view.webContents);
    }
  }

  /**
   * In 'system' mode Chromium may still be using a proxy (Windows settings / PAC). Node-based code such as the
   * Turbo downloader cannot see it, so remember whether one is in effect. Cached because callers are synchronous.
   */
  async refreshSystemProxyState() {
    try {
      const resolved = await session.defaultSession.resolveProxy('https://www.example.com/');
      const hops = String(resolved || '').split(';').map(h => h.trim()).filter(Boolean);
      this._systemProxyActive = hops.some(h => !/^DIRECT$/i.test(h));
    } catch (_) {
      this._systemProxyActive = true; // unknown → be conservative (keeps downloads on the proxied native path)
    }
  }

  /** True when web traffic is currently routed through a proxy. */
  isProxyActive() {
    const cfg = this.proxyManager ? this.proxyManager.getConfig() : null;
    if (!cfg || cfg.mode === 'direct') return false;
    if (cfg.mode === 'manual') return Boolean(cfg.rules && cfg.rules.host);
    return Boolean(this._systemProxyActive);
  }

  // ─── Chrome Extension Management (Stage 7) ───────────────────────────────

  async loadExtensions() {
    if (!this.extensionManager) return;

    // Older versions bundled uBlock Origin under <app>/extensions/ and registered it on every start. It never
    // loaded from an installed (asar) build and blocks nothing under Electron's extension support — the Ghostery
    // engine in AdBlockerService does the blocking — so it is no longer shipped. Forget the stale registry entry.
    for (const [id, record] of Object.entries(this.extensionManager.extensions)) {
      const dir = String(record && record.path || '').replace(/\\/g, '/');
      if (/\/extensions\/uBlock0\.chromium\/?$/.test(dir) && !fs.existsSync(record.path)) {
        try {
          await this.extensionManager.removeExtension(id);
          log.info('Removed the registry entry of the retired bundled uBlock Origin', { id });
        } catch (err) {
          log.warn('Could not remove the retired uBlock Origin entry', { id, error: err.message });
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
        sandbox: true,
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
        sandbox: true,
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

  // ─── Extensions Floating Bubble (Chrome Style Flyout) ──────────────────────

  toggleExtensionBubble(bounds, isIncognito = false) {
    if (this.extensionBubbleWin && !this.extensionBubbleWin.isDestroyed()) {
      this.closeExtensionBubble();
      return false;
    }
    return this.openExtensionBubble(bounds, isIncognito);
  }

  openExtensionBubble(bounds, isIncognito = false) {
    if (this.extensionBubbleWin && !this.extensionBubbleWin.isDestroyed()) {
      this.extensionBubbleWin.show();
      this.extensionBubbleWin.focus();
      return true;
    }

    const parentWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    if (!parentWin || parentWin.isDestroyed()) return false;

    const width = 300;
    const height = 380;
    const winBounds = parentWin.getBounds();

    let x, y;
    if (bounds && typeof bounds.x === 'number') {
      x = Math.round(winBounds.x + bounds.x - width + (bounds.width || 30));
      y = Math.round(winBounds.y + bounds.y + (bounds.height || 30) + 4);
    } else {
      x = winBounds.x + winBounds.width - width - 140;
      y = winBounds.y + 82;
    }

    x = Math.max(winBounds.x + 10, Math.min(x, winBounds.x + winBounds.width - width - 10));

    this.extensionBubbleWin = new BrowserWindow({
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
        sandbox: true,
        preload: PRELOAD_INTERNAL
      }
    });

    this.extensionBubbleWin.loadFile(path.join(__dirname, 'pages', 'extension-bubble.html'));

    this.extensionBubbleWin.once('ready-to-show', () => {
      if (this.extensionBubbleWin && !this.extensionBubbleWin.isDestroyed()) {
        this.extensionBubbleWin.show();
      }
    });

    this.extensionBubbleWin.on('blur', () => {
      setTimeout(() => {
        if (this.extensionBubbleWin && !this.extensionBubbleWin.isDestroyed() && !this.extensionBubbleWin.isFocused()) {
          this.closeExtensionBubble();
        }
      }, 150);
    });

    return true;
  }

  closeExtensionBubble() {
    if (this.extensionBubbleWin && !this.extensionBubbleWin.isDestroyed()) {
      this.extensionBubbleWin.close();
      this.extensionBubbleWin = null;
    }
  }

  // ─── AdBlocker Shield Floating Bubble (Chrome Style Flyout) ────────────────

  toggleShieldBubble(bounds, isIncognito = false) {
    if (this.shieldBubbleWin && !this.shieldBubbleWin.isDestroyed()) {
      this.closeShieldBubble();
      return false;
    }
    return this.openShieldBubble(bounds, isIncognito);
  }

  openShieldBubble(bounds, isIncognito = false) {
    if (this.shieldBubbleWin && !this.shieldBubbleWin.isDestroyed()) {
      this.shieldBubbleWin.show();
      this.shieldBubbleWin.focus();
      return true;
    }

    const parentWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    if (!parentWin || parentWin.isDestroyed()) return false;

    const width = 300;
    const height = 330;
    const winBounds = parentWin.getBounds();

    let x, y;
    if (bounds && typeof bounds.x === 'number') {
      x = Math.round(winBounds.x + bounds.x - width + (bounds.width || 30));
      y = Math.round(winBounds.y + bounds.y + (bounds.height || 30) + 4);
    } else {
      x = winBounds.x + winBounds.width - width - 200;
      y = winBounds.y + 82;
    }

    x = Math.max(winBounds.x + 10, Math.min(x, winBounds.x + winBounds.width - width - 10));

    this.shieldBubbleWin = new BrowserWindow({
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
        sandbox: true,
        preload: PRELOAD_INTERNAL
      }
    });

    this.shieldBubbleWin.loadFile(path.join(__dirname, 'pages', 'shield-bubble.html'));

    this.shieldBubbleWin.once('ready-to-show', () => {
      if (this.shieldBubbleWin && !this.shieldBubbleWin.isDestroyed()) {
        this.shieldBubbleWin.show();
      }
    });

    this.shieldBubbleWin.on('blur', () => {
      setTimeout(() => {
        if (this.shieldBubbleWin && !this.shieldBubbleWin.isDestroyed() && !this.shieldBubbleWin.isFocused()) {
          this.closeShieldBubble();
        }
      }, 150);
    });

    return true;
  }

  closeShieldBubble() {
    if (this.shieldBubbleWin && !this.shieldBubbleWin.isDestroyed()) {
      this.shieldBubbleWin.close();
      this.shieldBubbleWin = null;
    }
  }

  // ─── Permission Request Floating Bubble (Chrome Style) ─────────────────────

  openPermissionBubble(data, isIncognito = false) {
    if (this.permissionBubbleWin && !this.permissionBubbleWin.isDestroyed()) {
      this.closePermissionBubble();
    }

    const parentWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    if (!parentWin || parentWin.isDestroyed()) return false;

    const width = 360;
    const height = 160;
    const winBounds = parentWin.getBounds();

    let x = winBounds.x + 115;
    let y = winBounds.y + (this.headerHeight ? (this.headerHeight - 34) : 80);

    x = Math.max(winBounds.x + 10, Math.min(x, winBounds.x + winBounds.width - width - 10));

    this.permissionBubbleWin = new BrowserWindow({
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
        sandbox: true,
        preload: PRELOAD_INTERNAL
      }
    });

    this.permissionBubbleWin.loadFile(path.join(__dirname, 'pages', 'permission-bubble.html'));

    this.permissionBubbleWin.once('ready-to-show', () => {
      if (this.permissionBubbleWin && !this.permissionBubbleWin.isDestroyed()) {
        this.permissionBubbleWin.show();
        this.permissionBubbleWin.webContents.send('permission:request', data);
      }
    });

    return true;
  }

  closePermissionBubble() {
    if (this.permissionBubbleWin && !this.permissionBubbleWin.isDestroyed()) {
      this.permissionBubbleWin.close();
      this.permissionBubbleWin = null;
    }
  }

  // ─── Windows 10 Lag-Free Resize Throttler ───────────────────────────────────

  throttledUpdateViewBounds(targetWin = null) {
    if (this._resizeTimeout) return;
    this._resizeTimeout = setTimeout(() => {
      this._resizeTimeout = null;
      this.updateViewBounds(targetWin);
    }, 16);
  }

  // ─── Protocol Handler ────────────────────────────────────────────────────

  setupProtocol() {
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css':  'text/css; charset=utf-8',
      '.js':   'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png':  'image/png',
      '.svg':  'image/svg+xml',
      '.woff2': 'font/woff2'
    };

    const handleMtc = (request) => {
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
          const headers = { 'Content-Type': contentType };
          if (ext === '.html') headers['Content-Security-Policy'] = MTC_PAGE_CSP;
          return new Response(content, { headers });
        }

        return new Response('Page Not Found', { status: 404 });
      } catch (err) {
        log.error('Error handling mtc protocol request', { error: err.message });
        return new Response('Error loading internal page', { status: 500 });
      }
    };

    // A protocol handler belongs to one session. Incognito tabs run in their own partition, and without a handler
    // there their new-tab page, Settings and error pages stayed blank.
    protocol.handle('mtc', handleMtc);
    session.fromPartition('incognito').protocol.handle('mtc', handleMtc);

    log.info('mtc:// protocol handler registered');
  }

  // ─── Main Window ─────────────────────────────────────────────────────────

  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width:           1366,
      height:          850,
      minWidth:        400,
      minHeight:       300,
      frame:           false,
      resizable:       true,
      thickFrame:      true,
      fullscreenable:  true,
      backgroundColor: '#0f172a',
      title:           'SHMMOTH Browser',
      webPreferences: {
        preload:          PRELOAD_INTERNAL,
        contextIsolation: true,
        nodeIntegration:  false,
        sandbox:          true
      }
    });

    this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    this.mainWindow.webContents.on('did-finish-load', () => {
      if (Object.keys(this.tabs).length === 0) {
        this._createStartupTabs();
      } else {
        this.broadcastTabsUpdate();
        this.updateViewBounds();
      }
    });

    const broadcastWindowState = (isMax) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('window:state', { isMaximized: isMax });
      }
    };

    this.mainWindow.on('resize',     () => this.throttledUpdateViewBounds(this.mainWindow));
    this.mainWindow.on('resize',     () => { if (this.passwordAutofill) this.passwordAutofill.dismiss(); });
    this.mainWindow.on('move',       () => { if (this.passwordAutofill) this.passwordAutofill.dismiss(); });
    this.mainWindow.on('minimize',   () => { if (this.passwordAutofill) this.passwordAutofill.dismiss(); });
    this.mainWindow.on('maximize',   () => {
      broadcastWindowState(true);
      setTimeout(() => this.updateViewBounds(), 50);
    });
    this.mainWindow.on('unmaximize', () => {
      broadcastWindowState(false);
      setTimeout(() => this.updateViewBounds(), 50);
    });
    this.mainWindow.on('enter-full-screen', () => {
      broadcastWindowState(false);
      setTimeout(() => this.updateViewBounds(this.mainWindow), 50);
    });
    this.mainWindow.on('leave-full-screen', () => {
      broadcastWindowState(this.mainWindow.isMaximized());
      setTimeout(() => this.updateViewBounds(this.mainWindow), 50);
    });
    // The tab list is final the moment the window starts closing; tearing the tabs down must not rewrite the session
    this.mainWindow.on('close',      () => this._finalizeSession());
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
      minWidth:        400,
      minHeight:       300,
      frame:           false,
      resizable:       true,
      thickFrame:      true,
      fullscreenable:  true,
      backgroundColor: '#130d1e',
      title:           'SHMMOTH Browser (Incognito)',
      webPreferences: {
        preload:          PRELOAD_INTERNAL,
        contextIsolation: true,
        nodeIntegration:  false,
        sandbox:          true
      }
    });

    this.registerGesturePreload(session.fromPartition('incognito'));
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

    const broadcastIncognitoWindowState = (isMax) => {
      if (this.incognitoWindow && !this.incognitoWindow.isDestroyed() && this.incognitoWindow.webContents) {
        this.incognitoWindow.webContents.send('window:state', { isMaximized: isMax });
      }
    };

    this.incognitoWindow.on('resize',     () => this.throttledUpdateViewBounds(this.incognitoWindow));
    this.incognitoWindow.on('maximize',   () => {
      broadcastIncognitoWindowState(true);
      setTimeout(() => this.updateViewBounds(this.incognitoWindow), 50);
    });
    this.incognitoWindow.on('unmaximize', () => {
      broadcastIncognitoWindowState(false);
      setTimeout(() => this.updateViewBounds(this.incognitoWindow), 50);
    });
    this.incognitoWindow.on('enter-full-screen', () => {
      broadcastIncognitoWindowState(false);
      setTimeout(() => this.updateViewBounds(this.incognitoWindow), 50);
    });
    this.incognitoWindow.on('leave-full-screen', () => {
      broadcastIncognitoWindowState(this.incognitoWindow.isMaximized());
      setTimeout(() => this.updateViewBounds(this.incognitoWindow), 50);
    });
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
            if (isTrustedInternalUrl(url)) {
              tab.view.webContents.send('updater:status', status);
            }
          } catch (_) {}
        }
      }
    }
  }

  /**
   * Synchronizes Client Hints (sec-ch-ua) and User-Agent headers with genuine Google Chrome
   * for all Google Authentication and Google service requests.
   *
   * @param {Electron.Session} targetSession
   */
  setupGoogleAuthHeaders(targetSession) {
    if (!targetSession || !targetSession.webRequest) return;
    const filter = {
      urls: [
        '*://*.google.com/*',
        '*://*.gstatic.com/*',
        '*://*.googleusercontent.com/*',
        '*://*.youtube.com/*',
        '*://*.recaptcha.net/*'
      ]
    };
    targetSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const headers = details.requestHeaders;
      const isAuthUrl = isGoogleAuthUrl(details.url);

      if (isAuthUrl) {
        headers['User-Agent'] = GOOGLE_AUTH_UA;
        headers['sec-ch-ua'] = `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not?A_Brand";v="99"`;
        headers['sec-ch-ua-mobile'] = '?1';
        headers['sec-ch-ua-platform'] = '"Android"';
      } else {
        const ua = this.cleanUa || app.userAgentFallback || DESKTOP_UA_FALLBACK;
        const chromeVer = (ua.match(/Chrome\/(\d+)/) || [])[1] || CHROME_MAJOR;

        headers['User-Agent'] = ua;
        headers['sec-ch-ua'] = `"Chromium";v="${chromeVer}", "Google Chrome";v="${chromeVer}", "Not?A_Brand";v="99"`;
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = '"Windows"';
      }

      callback({ requestHeaders: headers });
    });
  }

  // ─── Content Permissions & Security (Stage 5) ───────────────────────────

  setupPermissions(targetSession) {
    if (!targetSession) return;

    targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      // Our own pages (mtc:// and the exact app-shipped documents) are trusted.
      // Arbitrary local files are NOT: their origin is just "file://".
      const checkUrl = (details && details.requestingUrl) || requestingOrigin;
      if (isTrustedInternalUrl(checkUrl)) {
        return true;
      }

      // Permissions every page gets without a prompt (fullscreen, pointer lock, writing to the clipboard on a click)
      if (isAlwaysAllowedPermission(permission)) {
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

      // Our own pages are auto-granted; arbitrary local files go through the normal prompt
      if (isTrustedInternalUrl(requestingUrl)) {
        return callback(true);
      }

      // Permissions every page gets without a prompt (see security/permissionPolicy.js)
      if (isAlwaysAllowedPermission(permission)) {
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

      const permData = {
        requestId,
        origin,
        permission,
        details: { mediaTypes: details.mediaTypes || [] },
        tabId: foundTab ? foundTab.id : null
      };

      targetWin.webContents.send('permission:request', permData);
      this.openPermissionBubble(permData, Boolean(foundTab && foundTab.isIncognito));
      log.info(`Permission requested: ${permission} by ${origin}`, { requestId });
    });
  }

  // ─── View Bounds ─────────────────────────────────────────────────────────

  updateHeaderHeight(force = false) {
    if (this._cachedHeaderHeight !== undefined && !force) {
      this.headerHeight = this._cachedHeaderHeight;
      return;
    }
    const settings = this.storage ? this.storage.getSettings() : {};
    this.headerHeight = (settings.showBookmarksBar !== false) ? 114 : 86;
    this._cachedHeaderHeight = this.headerHeight;
  }

  updateViewBounds(targetWin = null) {
    const wins = targetWin ? [targetWin] : [this.mainWindow, this.incognitoWindow].filter(w => w && !w.isDestroyed());
    this.updateHeaderHeight();

    for (const win of wins) {
      const isIncognito = (win === this.incognitoWindow);
      const activeId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      const activeTab = this.tabs[activeId];

      const isFullScreen = win.isFullScreen() || Boolean(activeTab && activeTab.isHtmlFullScreen);
      const bounds = win.getContentBounds();

      // In Fullscreen mode (e.g. YouTube video or F11), fill 100% of the display borderless
      if (isFullScreen) {
        if (activeTab && activeTab.view) {
          activeTab.view.setBounds({
            x: 0,
            y: 0,
            width: bounds.width,
            height: bounds.height
          });
        }
        if (this.sidePanelView && !isIncognito) {
          this.sidePanelView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
        continue;
      }

      const isMax = win.isMaximized();
      const contentWidth  = bounds.width;

      // When windowed (not maximized), leave a 4px edge margin on left, right, and bottom
      // so native Windows resize hit-testing (WM_NCHITTEST) is not eaten by child WebContentsView!
      const edgeMargin = isMax ? 0 : 4;
      const leftOffset = edgeMargin;
      const effectiveWidth = Math.max(contentWidth - (edgeMargin * 2), 200);
      const contentHeight = Math.max(bounds.height - this.headerHeight - edgeMargin, 150);

      let webWidth = effectiveWidth;
      if (this.sidePanelOpen && !isIncognito) {
        const panelW = Math.min(this.sidePanelWidth, Math.floor(effectiveWidth * 0.45));
        webWidth = Math.max(effectiveWidth - panelW, 300);

        if (this.sidePanelView) {
          this.sidePanelView.setBounds({
            x: leftOffset + webWidth, y: this.headerHeight,
            width: effectiveWidth - webWidth, height: contentHeight
          });
        }
      }

      if (activeTab && activeTab.view) {
        activeTab.view.setBounds({
          x: leftOffset, y: this.headerHeight,
          width: webWidth, height: contentHeight
        });
      }
    }
  }

  // ─── Tab Management (Stage 1 Core) ───────────────────────────────────────

  createTab(initialUrl = 'mtc://newtab', insertAfterTabId = null, isPinned = false, isIncognito = false, isPopupTab = false, options = {}) {
    const tabId = 'tab_' + this.tabCounter++;
    const preloadPath = selectPreload(initialUrl);

    // Every renderer runs inside the Chromium OS sandbox: a compromised tab (e.g. a Blink/V8 exploit)
    // cannot touch the filesystem or spawn processes directly. This is why the preloads may only use
    // the small Electron subset available to sandboxed preloads (see tests/p0-sandbox.test.js).
    const webPreferences = {
      preload:          preloadPath,
      contextIsolation: true,
      nodeIntegration:  false,
      plugins:          true,
      webSecurity:      true,
      sandbox:          true
    };

    if (isIncognito) {
      webPreferences.partition = 'incognito';
    }

    const view = new WebContentsView({ webPreferences });

    if (view.webContents) {
      view.webContents.setUserAgent(isGoogleAuthUrl(initialUrl) ? GOOGLE_AUTH_UA : (this.cleanUa || app.userAgentFallback));
    }

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
      isHtmlFullScreen: false,
      lastValidUrl:   initialUrl,
      pendingLoadUrl: null,           // set for a restored background tab until it is first selected
      failedUrl:      null            // the address behind the error page this tab currently shows
    };
    if (options.deferLoad) tabData.pendingLoadUrl = initialUrl;
    // a restored tab shows its saved title / icon straight away (the page replaces them as soon as it reports its own)
    if (typeof options.title === 'string' && options.title) tabData.title = options.title;
    if (typeof options.favicon === 'string') tabData.favicon = options.favicon;

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
    this._applyWebRtcPolicy(wc);

    // ── Title + Favicon updates ──
    wc.on('page-title-updated', (_, title) => {
      tabData.title = title || 'New Tab';
      if (!tabData.isIncognito && title) this.storage.updateHistoryEntry(tabData.url, { title });
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    wc.on('page-favicon-updated', (_, favicons) => {
      if (favicons && favicons.length > 0) {
        tabData.favicon = favicons[0];
        if (!tabData.isIncognito) this.storage.updateHistoryEntry(tabData.url, { favicon: favicons[0] });
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

    wc.on('did-fail-load', (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
      tabData.isLoading = false;
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }

      // Electron leaves a tab whose page could not be loaded blank: show a proper error page instead
      if (shouldShowErrorPage({ errorCode, validatedURL, isMainFrame })) {
        this._showErrorPage(tabData, errorCode, errorDescription, validatedURL);
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
    const updateTabUa = (targetUrl) => {
      if (!wc || wc.isDestroyed()) return;
      if (isGoogleAuthUrl(targetUrl)) {
        wc.setUserAgent(GOOGLE_AUTH_UA);
      } else if (this.cleanUa) {
        wc.setUserAgent(this.cleanUa);
      }
    };

    wc.on('will-navigate', (_, navUrl) => {
      updateTabUa(navUrl);
    });

    wc.on('did-start-navigation', (_, navUrl, isInPlace, isMainFrame) => {
      if (isMainFrame) {
        updateTabUa(navUrl);
        if (!isInPlace && this.passwordAutofill) this.passwordAutofill.forgetTab(tabId);
      }
    });

    wc.on('did-navigate', (_, navUrl) => {
      updateTabUa(navUrl);
      tabData.url = navUrl;
      const isErrorPage = Boolean(navUrl) && navUrl.startsWith('mtc://error');
      if (!isErrorPage) tabData.failedUrl = null;              // a real page loaded: forget the address that failed before
      if (navUrl && !navUrl.startsWith('mtc://crash') && !isErrorPage) {
        tabData.lastValidUrl = navUrl;
        tabData.isCrashed = false;
        tabData.crashReason = null;
      }
      tabData.lastActiveTime = Date.now();
      tabData.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      tabData.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      // Zero history recorded for incognito tabs (Stage 4)
      if (!tabData.isIncognito && !isErrorPage) {
        // tabData.title / favicon still belong to the PREVIOUS page here; the real ones are filled in by the
        // page-title-updated / page-favicon-updated handlers above
        this.storage.addHistory({ title: '', url: navUrl, favicon: '' });
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

      // 2b. Video / audio items (what Chrome offers; pages such as YouTube show their own menu and only let this one
      //     through on a second right-click)
      if (params.mediaType === 'video' || params.mediaType === 'audio') {
        const kind = params.mediaType;
        const flags = params.mediaFlags || {};
        const px = Math.max(0, Math.round(Number(params.x) || 0));
        const py = Math.max(0, Math.round(Number(params.y) || 0));
        // runs `body` with `m` = the <video>/<audio> under the cursor, as a user action (play() and Picture-in-picture need one)
        const withMedia = (body) => wc.executeJavaScript(
          `(function(){var m=document.elementsFromPoint(${px},${py}).find(function(e){return e.tagName==='VIDEO'||e.tagName==='AUDIO';});if(!m)return;${body}})()`, true
        ).catch((err) => log.warn('Media menu action failed', { error: err.message }));
        const mediaUrl = /^https?:\/\//i.test(params.srcURL || '') ? params.srcURL : '';

        menu.append(new MenuItem({ label: flags.isPaused === false ? 'Pause' : 'Play', click: () => withMedia('if(m.paused){m.play();}else{m.pause();}') }));
        menu.append(new MenuItem({ label: flags.isMuted ? 'Unmute' : 'Mute', click: () => withMedia('m.muted=!m.muted;') }));
        menu.append(new MenuItem({ label: 'Loop', type: 'checkbox', checked: Boolean(flags.isLooping), click: () => withMedia('m.loop=!m.loop;') }));
        if (kind === 'video') {
          menu.append(new MenuItem({
            label: 'Show controls', type: 'checkbox', checked: Boolean(flags.isControlsVisible),
            enabled: flags.canToggleControls !== false, click: () => withMedia('m.controls=!m.controls;')
          }));
          menu.append(new MenuItem({
            label: 'Picture in picture', enabled: flags.canShowPictureInPicture !== false,
            click: () => withMedia('if(document.pictureInPictureElement===m){document.exitPictureInPicture();}else if(m.requestPictureInPicture){m.requestPictureInPicture();}')
          }));
        }
        if (mediaUrl) {
          menu.append(new MenuItem({ type: 'separator' }));
          menu.append(new MenuItem({
            label: `Save ${kind} as...`,
            click: () => {
              try {
                const sess = tabData.isIncognito ? session.fromPartition('incognito') : session.defaultSession;
                sess.downloadURL(mediaUrl);
              } catch (err) {
                log.error('Save media as failed', { error: err.message });
              }
            }
          }));
          menu.append(new MenuItem({ label: `Copy ${kind} address`, click: () => clipboard.writeText(mediaUrl) }));
          menu.append(new MenuItem({ label: `Open ${kind} in new tab`, click: () => this.createTab(mediaUrl, tabId, false, tabData.isIncognito) }));
        }
        menu.append(new MenuItem({ type: 'separator' }));
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
    // Electron >= 35 passes one `details` object (details.message); the positional (level, message, …)
    // arguments are deprecated and slated for removal, but older runtimes only provide those.
    // (Declared with a single parameter on purpose: Electron prints a deprecation warning for listeners that
    //  declare the positional arguments.)
    const browserApp = this;
    wc.on('console-message', function onConsoleMessage(event) {
      const message = (event && typeof event.message === 'string') ? event.message : arguments[2];
      if (browserApp.passwordAutofill && browserApp.passwordAutofill.handleConsoleMessage(tabId, message)) return;
      if (typeof message === 'string' && message.startsWith('__SHMMOTH_LOGIN_SUBMIT__:')) {
        try {
          const payload = JSON.parse(message.slice(25));
          if (payload && payload.username && payload.password && tabData.url) {
            const origin = new URL(tabData.url).origin;
            browserApp.offerPasswordSave(tabId, origin, payload.username, payload.password);
          }
        } catch (_) {}
      }
    });

    wc.on('dom-ready', () => {
      this._applyYouTubeOptimizer(wc, tabData.url);
      this._attachCredentialAndAutofillHooks(wc, tabData);
      if (this.passwordAutofill) this.passwordAutofill.attach(wc, tabId, tabData);
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
      // Web content must not be able to open mtc:// pages or local files
      if (isPopupBlocked(url, tabData.url)) {
        securityLogger.security(`Popup blocked`, { url: url.slice(0, 120) });
        return { action: 'deny' };
      }

      // Ad pop-ups and pop-unders: refused before a tab exists (Google sign-in windows are never touched)
      if (this.popupPolicy && !isGoogleAuthUrl(url)) {
        const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
        const verdict = this.popupPolicy.decide({
          wcId: wc.id, url, openerUrl: wc.getURL(), openerIsActive: activeId === tabId
        });
        if (!verdict.allow) {
          log.info('Pop-up blocked', { reason: verdict.reason, url: url.slice(0, 120) });
          if (this.adBlocker) this.adBlocker.noteBlockedPopup();
          return { action: 'deny' };
        }
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

      // Google OAuth and Single Sign-On popups require window.opener preservation for token exchange
      const isGoogleOAuth = isGoogleAuthUrl(url);

      if (isGoogleOAuth) {
        log.info(`Google OAuth popup permitted with window.opener preserved`, { url: url.slice(0, 120) });
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 680,
            autoHideMenuBar: true,
            title: 'Sign in - Google Accounts',
            webPreferences: {
              preload: PRELOAD_EXTERNAL,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              partition: tabData.isIncognito ? 'incognito' : undefined
            }
          }
        };
      }

      this.createTab(url, tabId, false, tabData.isIncognito, true);
      return { action: 'deny' };
    });

    // When an allowed popup window is created (such as Google OAuth login window)
    wc.on('did-create-window', (childWin, { url: childUrl }) => {
      if (!childWin || !childWin.webContents) return;
      this._applyWebRtcPolicy(childWin.webContents);
      if (isGoogleAuthUrl(childUrl)) {
        childWin.webContents.setUserAgent(GOOGLE_AUTH_UA);
      }
      childWin.webContents.on('will-navigate', (_, navUrl) => {
        if (isGoogleAuthUrl(navUrl)) {
          childWin.webContents.setUserAgent(GOOGLE_AUTH_UA);
        } else if (this.cleanUa) {
          childWin.webContents.setUserAgent(this.cleanUa);
        }
      });
      childWin.webContents.on('did-start-navigation', (_, navUrl, isInPlace, isMainFrame) => {
        if (isMainFrame) {
          if (isGoogleAuthUrl(navUrl)) {
            childWin.webContents.setUserAgent(GOOGLE_AUTH_UA);
          } else if (this.cleanUa) {
            childWin.webContents.setUserAgent(this.cleanUa);
          }
        }
      });
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

    // ── HTML5 Fullscreen (YouTube, HTML5 Video, Canvas) ──
    wc.on('enter-html-full-screen', () => {
      const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
      if (!targetWin || targetWin.isDestroyed()) return;

      tabData.isHtmlFullScreen = true;
      targetWin._wasMaximizedBeforeFullscreen = targetWin.isMaximized();

      targetWin.setFullScreen(true);
      this.updateViewBounds(targetWin);

      if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
        targetWin.webContents.send('window:fullscreen-change', {
          isFullScreen: true,
          isHtmlFullScreen: true,
          tabId: tabData.id
        });
      }
      log.info(`Tab ${tabId} entered HTML full screen`);
    });

    wc.on('leave-html-full-screen', () => {
      const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
      if (!targetWin || targetWin.isDestroyed()) return;

      tabData.isHtmlFullScreen = false;

      targetWin.setFullScreen(false);
      if (targetWin._wasMaximizedBeforeFullscreen) {
        targetWin.maximize();
      }
      this.updateViewBounds(targetWin);
      setTimeout(() => {
        if (targetWin && !targetWin.isDestroyed()) {
          this.updateViewBounds(targetWin);
        }
      }, 100);

      if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
        targetWin.webContents.send('window:fullscreen-change', {
          isFullScreen: false,
          isHtmlFullScreen: false,
          tabId: tabData.id
        });
      }
      log.info(`Tab ${tabId} left HTML full screen`);
    });

    // ── Keyboard Shortcuts inside WebContents (e.g. F11 Fullscreen) ──
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        event.preventDefault();
        const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
        if (targetWin && !targetWin.isDestroyed()) {
          const nextState = !targetWin.isFullScreen();
          tabData.isHtmlFullScreen = nextState;
          if (nextState) {
            targetWin._wasMaximizedBeforeFullscreen = targetWin.isMaximized();
            targetWin.setFullScreen(true);
          } else {
            targetWin.setFullScreen(false);
            if (targetWin._wasMaximizedBeforeFullscreen) {
              targetWin.maximize();
            }
          }
          this.updateViewBounds(targetWin);
          setTimeout(() => {
            if (targetWin && !targetWin.isDestroyed()) this.updateViewBounds(targetWin);
          }, 100);
          if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
            targetWin.webContents.send('window:fullscreen-change', {
              isFullScreen: nextState,
              isHtmlFullScreen: nextState,
              tabId: tabData.id
            });
          }
        }
      }
    });

    // Load initial URL (a restored background tab waits until it is selected)
    if (!tabData.pendingLoadUrl) wc.loadURL(initialUrl);

    if (options.background) this.broadcastTabsUpdate(isIncognito);
    else this.switchTab(tabId);
    log.info(`Tab created: ${tabId}`, { url: initialUrl, isPinned, isIncognito, deferred: Boolean(tabData.pendingLoadUrl) });
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

    this.closePermissionBubble();
    this.closeExtensionBubble();
    this.closeShieldBubble();
    this.closeDownloadBubble();
    if (this.passwordAutofill) this.passwordAutofill.dismiss();

    const isIncognito = Boolean(currentTab.isIncognito);
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    const prevActiveId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;

    const prevActiveTab = this.tabs[prevActiveId];
    if (prevActiveTab && prevActiveTab.view && targetWin && !targetWin.isDestroyed()) {
      try { targetWin.contentView.removeChildView(prevActiveTab.view); } catch (_) {}
    }

    if (prevActiveTab && prevActiveTab.isHtmlFullScreen) {
      prevActiveTab.isHtmlFullScreen = false;
      if (targetWin && !targetWin.isDestroyed() && targetWin.isFullScreen()) {
        targetWin.setFullScreen(false);
      }
    }

    if (isIncognito) {
      this.activeIncognitoTabId = tabId;
    } else {
      this.activeTabId = tabId;
    }

    currentTab.lastActiveTime = Date.now();
    this._loadPendingUrl(currentTab);

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

  /** Replaces a blank, failed page with mtc://error (the failed address stays what the address bar shows). */
  _showErrorPage(tab, errorCode, errorDescription, failedUrl) {
    if (!tab || !tab.view) return;
    log.warn(`Page failed to load in ${tab.id}`, { errorCode, errorDescription, url: String(failedUrl).slice(0, 200) });
    tab.failedUrl = failedUrl;
    // not inside the did-fail-load event itself: starting a navigation from there can race with the failed one
    setImmediate(() => {
      const wc = tab.view && tab.view.webContents;
      if (!this.tabs[tab.id] || !wc || wc.isDestroyed()) return;
      wc.loadURL(buildErrorPageUrl(errorCode, errorDescription, failedUrl)).catch(() => {});
    });
  }

  /** A restored background tab has not loaded its page yet; do it now (selected, reloaded or navigated). */
  _loadPendingUrl(tab) {
    if (!tab || !tab.pendingLoadUrl) return;
    const url = tab.pendingLoadUrl;
    tab.pendingLoadUrl = null;
    if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.loadURL(url).catch(() => {});
    }
  }

  closeTab(tabId) {
    const tabData = this.tabs[tabId];
    if (!tabData) return;

    this.closePermissionBubble();
    this.closeExtensionBubble();
    this.closeShieldBubble();
    if (this.passwordAutofill) this.passwordAutofill.forgetTab(tabId);
    try { if (this.popupPolicy && tabData.view && tabData.view.webContents) this.popupPolicy.forget(tabData.view.webContents.id); } catch (_) {}

    const isIncognito = Boolean(tabData.isIncognito);
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    const targetOrder = isIncognito ? this.incognitoTabOrder : this.tabOrder;

    if (tabData.isHtmlFullScreen) {
      tabData.isHtmlFullScreen = false;
      if (targetWin && !targetWin.isDestroyed() && targetWin.isFullScreen()) {
        targetWin.setFullScreen(false);
      }
    }

    // Track closed tab for Reopen Closed Tab (Ctrl+Shift+T) ONLY for standard tabs
    const closedUrl = displayUrl(tabData);
    if (!isIncognito && closedUrl && !closedUrl.startsWith('mtc://newtab') && !closedUrl.startsWith('about:blank')) {
      this.closedTabs.push({ url: closedUrl, title: tabData.title || closedUrl });
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
    return this.createTab(displayUrl(tab), tab.id, tab.isPinned, tab.isIncognito);
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

  reloadTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab || !tab.view) return;
    if (tab.pendingLoadUrl) { this._loadPendingUrl(tab); return; }      // restored tab that never loaded: "reload" = load
    if (tab.failedUrl && tab.url && tab.url.startsWith('mtc://error')) { tab.view.webContents.loadURL(tab.failedUrl); return; }
    if (tab.isCrashed || (tab.url && tab.url.startsWith('mtc://crash'))) {
      tab.isCrashed = false;
      const target = tab.lastValidUrl && !tab.lastValidUrl.startsWith('mtc://crash') ? tab.lastValidUrl : 'mtc://newtab';
      tab.view.webContents.loadURL(target);
      return;
    }
    tab.view.webContents.reload();
  }

  reloadTabIgnoringCache(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (tab && tab.pendingLoadUrl) { this._loadPendingUrl(tab); return; }
    if (tab && tab.view && tab.failedUrl && tab.url && tab.url.startsWith('mtc://error')) { tab.view.webContents.loadURL(tab.failedUrl); return; }
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
          sandbox:          true
        }
      });
      this.sidePanelView._currentPreload = sidePanelPreload;

      this.sidePanelView.webContents.setWindowOpenHandler(({ url }) => {
        if (isPopupBlocked(url, targetUrl)) return { action: 'deny' };
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
    if (!isIncognito) this._scheduleSessionSave();
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
          url:          displayUrl(t),
          hasError:     Boolean(t.failedUrl && t.url && t.url.startsWith('mtc://error')),
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
        url:          displayUrl(activeTab)
      });
    }
  }

  broadcastThemeChange(theme) {
    const wins = [this.mainWindow, this.incognitoWindow].filter(w => w && !w.isDestroyed() && w.webContents);
    for (const win of wins) {
      try { win.webContents.send('theme:changed', theme); } catch (_) {}
    }
    if (this.tabs) {
      for (const tab of Object.values(this.tabs)) {
        if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
          try { tab.view.webContents.send('theme:changed', theme); } catch (_) {}
        }
      }
    }
  }

  broadcastSettingsUpdated(settings) {
    const wins = [this.mainWindow, this.incognitoWindow].filter(w => w && !w.isDestroyed() && w.webContents);
    for (const win of wins) {
      try { win.webContents.send('settings:updated', settings); } catch (_) {}
    }
    if (this.tabs) {
      for (const tab of Object.values(this.tabs)) {
        if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
          try { tab.view.webContents.send('settings:updated', settings); } catch (_) {}
        }
      }
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
    const engine     = (settings.searchEngine || 'google').toLowerCase();
    const defaultUrls = {
      google:     'https://www.google.com/search?q=',
      bing:       'https://www.bing.com/search?q=',
      duckduckgo: 'https://duckduckgo.com/?q=',
      yahoo:      'https://search.yahoo.com/search?p='
    };
    const engineUrls = Object.assign({}, defaultUrls, settings.searchEngineUrls || {});
    const baseUrl = engineUrls[engine] || defaultUrls[engine] || defaultUrls['google'];
    return baseUrl + encodeURIComponent(query);
  }

  // ─── YouTube Ad Optimizer ────────────────────────────────────────────────

  _applyYouTubeOptimizer(wc, currentUrl) {
    if (!currentUrl || !currentUrl.includes('youtube.com')) return;
    // part of the ad blocker: it has to stop when the user switches the blocker off (everywhere, or for this site)
    try {
      if (this.adBlocker && !this.adBlocker.isActiveFor(new URL(currentUrl).hostname)) return;
    } catch (_) { return; }

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
        sandbox: true,
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

  /** Every frame of every web page of the session reports real clicks / key presses (see services/popupPolicy.js). */
  registerGesturePreload(sess) {
    try {
      sess.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'preload-gesture.js') });
    } catch (err) {
      log.warn('Could not register the gesture script', { error: err.message });
    }
  }

  /** The small "use a saved login" chooser next to a sign-in field. It never takes keyboard focus from the page. */
  createPasswordAutofillBubble({ parent, x, y, width, height }) {
    const win = new BrowserWindow({
      width, height, x, y,
      parent,
      frame: false,
      resizable: false,
      show: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: PRELOAD_INTERNAL
      }
    });
    win.loadFile(path.join(__dirname, 'pages', 'autofill-bubble.html'));
    return win;
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
    // Signing in with a login that is already saved exactly as typed (e.g. just filled in) is nothing to offer to save
    if (this.passwordVault && this.passwordVault.matchesSaved(origin, username, password)) return;
    // Don't offer a "Save password?" bubble that cannot succeed (no OS-level encryption available)
    if (this.passwordVault && !this.passwordVault.canEncrypt()) {
      if (!this._warnedNoVaultEncryption) {
        this._warnedNoVaultEncryption = true;
        log.warn('Password save prompts disabled: OS-level encryption (safeStorage) is unavailable');
      }
      return;
    }

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
      try {
        const saved = this.passwordVault.saveCredential({
          origin: prompt.origin,
          username: prompt.username,
          password: prompt.password
        });
        return { success: true, saved: true, id: saved.id };
      } catch (err) {
        log.error('Saving password failed', { code: err.code, error: err.message });
        return { success: false, error: err.message, code: err.code };
      }
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
