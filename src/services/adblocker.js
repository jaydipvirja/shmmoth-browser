// Ad & Tracker Blocker Engine for MTC BROWSER
// Powered by Ghostery / Brave ElectronBlocker (EasyList + EasyPrivacy + Cosmetic Filtering)
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');

class AdBlockerService {
  constructor(storageService) {
    this.storage = storageService;
    this.blockedCount = 0;
    this.isEnabled = this.storage.getSettings().adBlockerEnabled ?? true;
    this.blocker = null;
    this._blockerPromise = null;
    // Every session the blocker protects (normal + incognito). Previously a single `this.session`
    // was overwritten when the incognito window opened, so toggling the setting only affected
    // incognito and the normal session could never be switched off again.
    this.sessions = new Set();
  }

  /** Builds the (expensive, network-backed) filter engine once and shares it between sessions. */
  _loadBlocker() {
    if (!this._blockerPromise) {
      this._blockerPromise = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
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
