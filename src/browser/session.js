// Start-up tabs, session restore, login durability (cookie flushes), the second instance.
// Methods of the browser application (ShmmothBrowserApp), moved here from main.js unchanged: browser/mixins.js adds
// them to the class, so `this` is the application as before.
'use strict';

const {
  session,
  buildSnapshot,
  log,
  urlsFromArgv
} = require('./shared');

class SessionMethods {
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

  /** What closing the browser does with the data: write it to disk, then clear what Settings asks (privacyCleaner). */
  async _dataOnQuit() {
    await this.flushBrowserData('quit');
    if (this.privacyCleaner) {
      try { await this.privacyCleaner.clearOnExit(); } catch (_) { /* finished at the next start (pending flag) */ }
    }
  }

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
    const schedule = (_event, cookie) => {
      // Sign-in cookies are flushed immediately; ordinary cookies are coalesced for a few seconds.
      if (this._isGoogleAuthCookie(cookie)) {
        this._flushGoogleLogin('google-cookie-change');
        return;
      }
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

  /**
   * Google login cookies need stronger durability than an ordinary site cookie because Google may rotate them
   * immediately after sign-in. Flush the persistent cookie store as soon as an auth cookie changes.
   * Values are never logged or persisted by this helper.
   */
  _isGoogleAuthCookie(cookie) {
    if (!cookie || typeof cookie !== 'object') return false;
    const domain = String(cookie.domain || '').toLowerCase().replace(/^\./, '');
    // Persist all Google/YouTube cookies immediately. Google changes/introduces session-cookie names over time,
    // so relying on a hard-coded allow-list can recreate the "logged in on one PC, signed out on another" bug.
    return domain === 'google.com' || domain.endsWith('.google.com') || domain === 'youtube.com' || domain.endsWith('.youtube.com');
  }

  /** Flush the Google session immediately after a sign-in/navigation event. */
  _flushGoogleLogin(reason = 'google-auth') {
    this.flushBrowserData(reason).catch((err) => {
      log.warn('Could not durably store Google login cookies', { error: err.message });
    });
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
}

module.exports = SessionMethods;
