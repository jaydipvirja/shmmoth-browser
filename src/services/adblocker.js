// Ad & Tracker Blocker Engine for MTC BROWSER
// Powered by Ghostery / Brave ElectronBlocker (EasyList + EasyPrivacy + Cosmetic Filtering)
const fs   = require('fs');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
    this.blockedCount = 0;
    this.isEnabled = this.storage.getSettings().adBlockerEnabled ?? true;
    this.blocker = null;
    this._blockerPromise = null;
    // Every session the blocker protects (normal + incognito). Previously a single `this.session`
    // was overwritten when the incognito window opened, so toggling the setting only affected
    // incognito and the normal session could never be switched off again.
    this.sessions = new Set();
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
        this.blocker.enableBlockingInSession(sessionInstance);
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
      if (!this.isEnabled) {
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
          this.blocker.enableBlockingInSession(sess);
        } else {
          this.blocker.disableBlockingInSession(sess);
        }
      }
    }
  }

  getBlockedCount() {
    return this.blockedCount;
  }
}

module.exports = AdBlockerService;
