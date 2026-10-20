// Telling the browser windows and pages what changed.
// Methods of the browser application (ShmmothBrowserApp), moved here from main.js unchanged: browser/mixins.js adds
// them to the class, so `this` is the application as before.
'use strict';

const {
  isTrustedInternalUrl,
  displayUrl
} = require('./shared');

class BroadcastMethods {
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
    targetWin.webContents.send('adblocker:count', this.shieldCountFor(this.tabs[activeId]));
  }

  /** The number on the shield: what was stopped on the page the tab shows now (blocked requests + cookies withheld). */
  shieldCountFor(tab) {
    try {
      const wc = tab && tab.view && tab.view.webContents;
      if (!wc || wc.isDestroyed() || !this.privacyStats) return 0;
      const c = this.privacyStats.pageCount(wc.id);
      return c.blocked + c.cookies;
    } catch (_) { return 0; }
  }

  /** Something was stopped in tab `wcId`: refresh its window's shield number (at most every 300 ms per window). */
  sendShieldCountSoon(wcId) {
    if (!this._shieldCountTimers) this._shieldCountTimers = {};
    for (const incognito of [false, true]) {
      const tab = this.tabs[incognito ? this.activeIncognitoTabId : this.activeTabId];
      const wc = tab && tab.view && tab.view.webContents;
      if (!wc || wc.isDestroyed() || wc.id !== wcId) continue;
      const key = incognito ? 'incognito' : 'normal';
      if (this._shieldCountTimers[key]) return;
      this._shieldCountTimers[key] = setTimeout(() => {
        this._shieldCountTimers[key] = null;
        const win = incognito ? this.incognitoWindow : this.mainWindow;
        const active = this.tabs[incognito ? this.activeIncognitoTabId : this.activeTabId];
        const count = this.shieldCountFor(active);
        if (win && !win.isDestroyed()) win.webContents.send('adblocker:count', count);
        if (this.shieldBubbleWin && !this.shieldBubbleWin.isDestroyed()) this.shieldBubbleWin.webContents.send('adblocker:count', count);
      }, 300);
      return;
    }
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
    // the browser windows and the open bubbles (the main menu shows the new theme while it stays open)
    const wins = [this.mainWindow, this.incognitoWindow, this.menuBubbleWin, this.shieldBubbleWin, this.downloadBubbleWin, this.extensionBubbleWin, this.permissionBubbleWin]
      .filter(w => w && !w.isDestroyed() && w.webContents);
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
}

module.exports = BroadcastMethods;
