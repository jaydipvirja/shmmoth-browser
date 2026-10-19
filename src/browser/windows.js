// The browser windows, the mtc:// protocol, where the tab views and the side panel are placed.
// Methods of the browser application (ShmmothBrowserApp), moved here from main.js unchanged: browser/mixins.js adds
// them to the class, so `this` is the application as before.
'use strict';

const {
  BrowserWindow,
  WebContentsView,
  protocol,
  session,
  screen,
  path,
  fs,
  isPopupBlocked,
  MTC_PAGE_CSP,
  log,
  PRELOAD_INTERNAL,
  selectPreload,
  SRC_DIR
} = require('./shared');
const { applyMica } = require('../services/windowMaterial');

class WindowsMethods {
  // ─── Windows 11 Mica (Settings → Appearance; services/windowMaterial.js) ───

  /** Applies the Mica setting to the main window and tells its frame page whether to leave the tab strip clear. */
  applyWindowMaterial() {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    const on = applyMica(win, this.storage.getSettings().micaEffect === true, '#0f172a');
    win.webContents.send('window:material', { mica: on });
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
          targetFile = path.join(SRC_DIR, 'pages', path.basename(pathname));
        } else {
          targetFile = path.join(SRC_DIR, 'pages', `${pageName}.html`);
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

    this.mainWindow.loadFile(path.join(SRC_DIR, 'renderer', 'index.html'));

    this.mainWindow.webContents.on('did-finish-load', () => {
      this.applyWindowMaterial();
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
    this.mainWindow.on('resize',     () => { if (this.passwordAutofill) this.passwordAutofill.dismiss(); if (this.formAutofill) this.formAutofill.dismiss(); });
    this.mainWindow.on('move',       () => { if (this.passwordAutofill) this.passwordAutofill.dismiss(); if (this.formAutofill) this.formAutofill.dismiss(); });
    this.mainWindow.on('minimize',   () => { if (this.passwordAutofill) this.passwordAutofill.dismiss(); if (this.formAutofill) this.formAutofill.dismiss(); });
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

    this.incognitoWindow.loadFile(path.join(SRC_DIR, 'renderer', 'index.html'), {
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
}

module.exports = WindowsMethods;
