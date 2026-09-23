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
    this.session = null;
  }

  async setupFilter(sessionInstance) {
    if (!sessionInstance) return;
    this.session = sessionInstance;

    try {
      console.log('Loading Ghostery ElectronBlocker rules (EasyList + EasyPrivacy)...');
      this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      this.blocker.config.loadCosmeticFilters = false;

      if (this.isEnabled) {
        this.blocker.enableBlockingInSession(this.session);
        console.log('Ad-Blocker successfully activated across all sessions.');
      }

      this.blocker.on('request-blocked', () => {
        this.blockedCount++;
      });
      this.blocker.on('request-redirected', () => {
        this.blockedCount++;
      });
    } catch (err) {
      console.error('Failed to initialize Ghostery ElectronBlocker, using fallback filter:', err);
      this.setupFallbackFilter(sessionInstance);
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
    if (this.blocker && this.session) {
      if (enabled) {
        this.blocker.enableBlockingInSession(this.session);
      } else {
        this.blocker.disableBlockingInSession(this.session);
      }
    }
  }

  getBlockedCount() {
    return this.blockedCount;
  }
}

module.exports = AdBlockerService;
