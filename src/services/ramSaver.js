// RAM Saver / Tab Sleep Service for MTC BROWSER
class RamSaverService {
  constructor(storageService, tabManager) {
    this.storage = storageService;
    this.tabManager = tabManager;
    this.timer = null;
    this.init();
  }

  init() {
    // Check every 60 seconds for idle tabs
    this.timer = setInterval(() => {
      this.checkTabs();
    }, 60 * 1000);
  }

  checkTabs() {
    const settings = this.storage.getSettings();
    if (!settings.ramSaverEnabled) return;

    const timeoutMs = (settings.ramSaverTimeoutMinutes || 15) * 60 * 1000;
    const now = Date.now();

    if (!this.tabManager || !this.tabManager.tabs) return;

    const activeTabId = this.tabManager.activeTabId;

    for (const [tabId, tabData] of Object.entries(this.tabManager.tabs)) {
      // Never sleep the active tab
      if (tabId === activeTabId) continue;

      // Never sleep audio playing tabs
      if (tabData.view && tabData.view.webContents && tabData.view.webContents.isCurrentlyAudible()) continue;

      // Never sleep internal settings/newtab pages
      if (tabData.url && tabData.url.startsWith('mtc://')) continue;

      if (!tabData.isSleeping && (now - tabData.lastActiveTime) > timeoutMs) {
        this.sleepTab(tabId, tabData);
      }
    }
  }

  sleepTab(tabId, tabData) {
    if (!tabData || tabData.isSleeping) return;
    try {
      tabData.isSleeping = true;
      // In modern Electron, background webContents can be throttled or muted
      if (tabData.view && tabData.view.webContents) {
        tabData.view.webContents.setBackgroundThrottling(true);
        // Optional: stop rendering paint events to save GPU/CPU
      }
      if (this.tabManager.notifyTabStatus) {
        this.tabManager.notifyTabStatus(tabId, { isSleeping: true });
      }
    } catch (err) {
      console.error(`Failed to sleep tab ${tabId}:`, err);
    }
  }

  wakeTab(tabId, tabData) {
    if (!tabData) return;
    tabData.isSleeping = false;
    tabData.lastActiveTime = Date.now();
    try {
      if (tabData.view && tabData.view.webContents) {
        tabData.view.webContents.setBackgroundThrottling(false);
      }
      if (this.tabManager.notifyTabStatus) {
        this.tabManager.notifyTabStatus(tabId, { isSleeping: false });
      }
    } catch (err) {
      console.error(`Failed to wake tab ${tabId}:`, err);
    }
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}

module.exports = RamSaverService;
