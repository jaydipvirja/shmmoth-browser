// Ad & Tracker Blocker Engine for SHMMOTH BROWSER
// Powered by Ghostery / Brave ElectronBlocker (EasyList + EasyPrivacy + Cosmetic Filtering)
const fs   = require('fs');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PAUSED_SITES = 500;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lower-case host name without a leading "www." or trailing dot; '' when it is not a plain host name / IPv4 address. */
function normalizeHost(input) {
  if (typeof input !== 'string') return '';
  const h = input.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return HOST.test(h) ? h : '';
}

/**
 * Lists are fetched with Electron's net.fetch: unlike Node's http it follows the browser's proxy setting and trusts the
 * operating system's certificate store (corporate / antivirus root CAs), which Node-side requests do not.
 * (Resolved lazily so the module can be loaded without Electron, e.g. in unit tests.)
 */
const electronFetch = (...args) => require('electron').net.fetch(...args);

class AdBlockerService {
  /**
   * @param {object} storageService
   * @param {object} [options]
   * @param {string} [options.cacheFile]  where the compiled filter engine is kept between runs (none = never cached)
   * @param {Function} [options.fetch]    fetch implementation (default: Electron net.fetch)
   * @param {number} [options.ttlMs]      how long a cached engine is used before the lists are downloaded again
   */
  constructor(storageService, options = {}) {
    this.storage = storageService;
    this.cacheFile = options.cacheFile || null;
    this._fetch = options.fetch || electronFetch;
    this.cacheTtlMs = options.ttlMs || CACHE_TTL_MS;
    // Sites where the user paused the blocker ("Ad blocker on this site: off"). Matches the host and its subdomains.
    this._paused = new Set();
    this.reloadAllowlist();
    this.blockedCount = 0;
    this.isEnabled = this.storage.getSettings().adBlockerEnabled ?? true;
    this.blocker = null;
    this._blockerPromise = null;
    // Every session the blocker protects (normal + incognito). Previously a single `this.session`
    // was overwritten when the incognito window opened, so toggling the setting only affected
    // incognito and the normal session could never be switched off again.
    this.sessions = new Set();
  }

  // ─── Per-site pause ───────────────────────────────────────────────────────

  /** (Re)reads the paused sites from the saved settings, dropping anything that is not a plain host name. */
  reloadAllowlist() {
    const saved = this.storage.getSettings().adBlockerAllowlist;
    const list = Array.isArray(saved) ? saved : [];
    this._paused = new Set(list.map(normalizeHost).filter(Boolean).slice(0, MAX_PAUSED_SITES));
  }

  getPausedSites() {
    return Array.from(this._paused).sort();
  }

  /** True when the blocker is paused for this host or one of its parent domains (www.a.example.com → example.com). */
  isSitePaused(host) {
    let h = normalizeHost(host);
    if (!h || this._paused.size === 0) return false;
    for (;;) {
      if (this._paused.has(h)) return true;
      const dot = h.indexOf('.');
      if (dot < 0) return false;
      h = h.slice(dot + 1);
    }
  }

  /** Is blocking in force for pages of this host? (the master switch AND not paused for the site) */
  isActiveFor(host) {
    return this.isEnabled && !this.isSitePaused(host);
  }

  /**
   * Pauses (or resumes) the blocker for a site. Resuming a site also removes the parent domain that covered it, so
   * "turn it back on here" always works. @returns {boolean} true when the list changed
   */
  setSitePaused(host, paused) {
    const h = normalizeHost(host);
    if (!h) return false;
    if (paused) {
      if (this.isSitePaused(h) || this._paused.size >= MAX_PAUSED_SITES) return false;
      this._paused.add(h);
    } else {
      let changed = false;
      for (const entry of Array.from(this._paused)) {
        if (h === entry || h.endsWith('.' + entry)) { this._paused.delete(entry); changed = true; }
      }
      if (!changed) return false;
    }
    this.storage.updateSettings({ adBlockerAllowlist: this.getPausedSites() });
    return true;
  }

  /** The address of the page a request belongs to: the tab that issued it, else the referrer. */
  _pageHost(details) {
    try {
      const wc = details && details.webContents;
      const url = (wc && !(wc.isDestroyed && wc.isDestroyed()) && wc.getURL && wc.getURL()) || (details && details.referrer) || '';
      return url ? new URL(url).hostname : '';
    } catch (_) {
      return '';
    }
  }

  _pausedFor(details) {
    return this._paused.size > 0 && this.isSitePaused(this._pageHost(details));
  }

  /**
   * Turns the engine on for a session. The engine registers its own webRequest listeners; they are replaced by thin
   * wrappers that let requests of paused sites through untouched and hand everything else to the engine.
   */
  _enableEngine(sessionInstance) {
    const context = this.blocker.enableBlockingInSession(sessionInstance);
    if (!context || this.blocker.config.loadNetworkFilters === false) return;
    const filter = { urls: ['<all_urls>'] };
    if (typeof context.onBeforeRequest === 'function') {
      sessionInstance.webRequest.onBeforeRequest(filter, Object.assign(
        (details, callback) => (this._pausedFor(details) ? callback({}) : context.onBeforeRequest(details, callback)), { engine: true }));
    }
    if (typeof context.onHeadersReceived === 'function') {
      sessionInstance.webRequest.onHeadersReceived(filter, (details, callback) => (this._pausedFor(details) ? callback({}) : context.onHeadersReceived(details, callback)));
    }
  }

  /** True when a cached engine exists but is older than the time-to-live. */
  _cacheIsStale() {
    try {
      return Date.now() - fs.statSync(this.cacheFile).mtimeMs > this.cacheTtlMs;
    } catch (_) {
      return false;                                  // no file: nothing to be stale (the first load downloads it)
    }
  }

  /**
   * The compiled engine is kept on disk: a start-up with a fresh cache needs no network at all (and blocks from the
   * first request), a stale one is refreshed, and if the refresh fails the old copy keeps being used rather than
   * leaving the browser with the small built-in list.
   */
  async _createEngine() {
    if (!this.cacheFile) return ElectronBlocker.fromPrebuiltAdsAndTracking(this._fetch);

    const caching = { path: this.cacheFile, read: fs.promises.readFile, write: fs.promises.writeFile };
    if (!this._cacheIsStale()) return ElectronBlocker.fromPrebuiltAdsAndTracking(this._fetch, caching);

    const old = this.cacheFile + '.stale';
    await fs.promises.rename(this.cacheFile, old);
    try {
      const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(this._fetch, caching);
      await fs.promises.rm(old, { force: true });
      return blocker;
    } catch (err) {
      console.warn('Could not refresh the ad-block lists, using the previous copy:', err && err.message);
      await fs.promises.rename(old, this.cacheFile).catch(() => {});
      return ElectronBlocker.fromPrebuiltAdsAndTracking(this._fetch, caching);        // reads the restored copy, or throws
    }
  }

  /** Builds the (expensive, network-backed) filter engine once and shares it between sessions. */
  _loadBlocker() {
    if (!this._blockerPromise) {
      this._blockerPromise = this._createEngine().then((blocker) => {
        blocker.config.loadCosmeticFilters = false;
        blocker.on('request-blocked', () => { this.blockedCount++; });
        blocker.on('request-redirected', () => { this.blockedCount++; });
        return blocker;
      });
      // A failed download must not be cached forever
      this._blockerPromise.catch(() => { this._blockerPromise = null; });
    }
    return this._blockerPromise;
  }

  async setupFilter(sessionInstance) {
    if (!sessionInstance) return;
    this.sessions.add(sessionInstance);

    // The full engine needs a network download first (seconds, or never when offline), and until then nothing would be
    // blocked. Start with the short built-in list; when the engine is ready its own webRequest listeners replace this one.
    if (!this.blocker) this.setupFallbackFilter(sessionInstance);

    try {
      console.log('Loading Ghostery ElectronBlocker rules (EasyList + EasyPrivacy)...');
      this.blocker = await this._loadBlocker();

      if (this.isEnabled) {
        this._enableEngine(sessionInstance);
        console.log('Ad-Blocker successfully activated for a session.');
      }
    } catch (err) {
      console.error('Failed to initialize Ghostery ElectronBlocker, keeping the built-in fallback filter:', err);
    }
  }

  setupFallbackFilter(sessionInstance) {
    const blockedDomains = [
      'doubleclick.net',
      'googleads.g.doubleclick.net',
      'pagead2.googlesyndication.com',
      'adservice.google.com',
      'ads.pubmatic.com',
      'adnxs.com',
      'criteo.com',
      'taboola.com',
      'outbrain.com',
      'popads.net',
      'propellerads.com'
    ];

    sessionInstance.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (!this.isEnabled || this._pausedFor(details)) {
        callback({ cancel: false });
        return;
      }
      const url = details.url.toLowerCase();

      // Whitelist Google authentication, captcha challenges, and security telemetry endpoints
      if (
        url.includes('accounts.google.com') ||
        url.includes('accounts.youtube.com') ||
        url.includes('play.google.com/log') ||
        url.includes('gstatic.com') ||
        url.includes('recaptcha')
      ) {
        callback({ cancel: false });
        return;
      }

      let cancel = false;
      for (const d of blockedDomains) {
        if (url.includes(d)) {
          cancel = true;
          break;
        }
      }
      if (cancel) this.blockedCount++;
      callback({ cancel });
    });
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    this.storage.updateSettings({ adBlockerEnabled: enabled });
    if (this.blocker) {
      for (const sess of this.sessions) {
        if (enabled) {
          this._enableEngine(sess);
        } else if (typeof this.blocker.isBlockingEnabled !== 'function' || this.blocker.isBlockingEnabled(sess)) {
          this.blocker.disableBlockingInSession(sess);          // (throws for a session that was never enabled)
        }
      }
    }
  }

  getBlockedCount() {
    return this.blockedCount;
  }
}

AdBlockerService.normalizeHost = normalizeHost;
module.exports = AdBlockerService;
