// The small windows next to the toolbar: downloads, extensions, ad-blocker shield, site permission.
// Methods of the browser application (ShmmothBrowserApp), moved here from main.js unchanged: browser/mixins.js adds
// them to the class, so `this` is the application as before.
'use strict';

const {
  BrowserWindow,
  path,
  PRELOAD_INTERNAL,
  SRC_DIR
} = require('./shared');
const { normalizeTheme } = require('../services/theme');

// Entries of the main menu that the browser window runs itself (renderer/app.js MENU_ACTIONS); theme and zoom are
// handled here, everything else is refused.
const FRAME_MENU_ACTIONS = new Set(['new-tab', 'new-incognito', 'history', 'downloads', 'bookmarks', 'passwords', 'notes',
  'extensions', 'import-signin', 'devtools', 'check-update', 'settings', 'about']);

class BubblesMethods {
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

    this.downloadBubbleWin.loadFile(path.join(SRC_DIR, 'pages', 'download-bubble.html'));

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

    this.extensionBubbleWin.loadFile(path.join(SRC_DIR, 'pages', 'extension-bubble.html'));

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

    this.shieldBubbleWin.loadFile(path.join(SRC_DIR, 'pages', 'shield-bubble.html'));

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

    this.permissionBubbleWin.loadFile(path.join(SRC_DIR, 'pages', 'permission-bubble.html'));

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

  // ─── Main menu (⋮) ────────────────────────────────────────────────────────
  // A small window of its own like the other bubbles, so it can open over the page. Its entries either change the
  // theme / zoom (here, the menu stays open and shows the new value) or are handed to the browser window it was opened
  // from (renderer/app.js runMenuAction), which then closes it.

  toggleMenuBubble(bounds, isIncognito = false) {
    if (this.menuBubbleWin && !this.menuBubbleWin.isDestroyed()) {
      this.closeMenuBubble();
      return false;
    }
    return this.openMenuBubble(bounds, isIncognito);
  }

  openMenuBubble(bounds, isIncognito = false) {
    const parentWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    if (!parentWin || parentWin.isDestroyed()) return false;
    this.closeShieldBubble();
    this.closeDownloadBubble();
    this.closeExtensionBubble();
    this.closeMenuBubble();

    const width = 320;
    const height = 590;
    const winBounds = parentWin.getBounds();
    let x, y;
    if (bounds && typeof bounds.x === 'number') {
      x = Math.round(winBounds.x + bounds.x + (bounds.width || 36) - width + 6);   // right edge under the ⋮ button
      y = Math.round(winBounds.y + bounds.y + 2);
    } else {
      x = winBounds.x + winBounds.width - width - 8;
      y = winBounds.y + 88;
    }
    x = Math.max(winBounds.x + 8, Math.min(x, winBounds.x + winBounds.width - width - 4));

    this.menuBubbleIncognito = Boolean(isIncognito);
    this.menuBubbleWin = new BrowserWindow({
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

    this.menuBubbleWin.loadFile(path.join(SRC_DIR, 'pages', 'menu-bubble.html'));

    this.menuBubbleWin.once('ready-to-show', () => {
      if (this.menuBubbleWin && !this.menuBubbleWin.isDestroyed()) {
        this.menuBubbleWin.show();
        this.menuBubbleWin.focus();
      }
    });

    this.menuBubbleWin.on('blur', () => {
      setTimeout(() => {
        if (this.menuBubbleWin && !this.menuBubbleWin.isDestroyed() && !this.menuBubbleWin.isFocused()) {
          this.closeMenuBubble();
        }
      }, 150);
    });

    return true;
  }

  closeMenuBubble() {
    if (this.menuBubbleWin && !this.menuBubbleWin.isDestroyed()) {
      this.menuBubbleWin.close();
    }
    this.menuBubbleWin = null;
  }

  /** What the menu shows: the Theme setting, the zoom of the tab it belongs to, the update state. */
  menuState() {
    const isIncognito = Boolean(this.menuBubbleIncognito);
    const tabId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;
    const settings = this.storage ? this.storage.getSettings() : {};
    let update = null;
    try { update = this.updateManager ? this.updateManager.getStatus() : null; } catch (_) { update = null; }
    return {
      isIncognito,
      theme: normalizeTheme(settings.theme),
      zoom: Math.round(this.getZoomFactor(tabId) * 100),
      update: update ? { status: update.status, availableVersion: update.availableVersion || '' } : null
    };
  }

  /** An entry of the menu was chosen. Returns the new menu state (theme / zoom) or true (handed to the window). */
  runMenuAction(action) {
    const isIncognito = Boolean(this.menuBubbleIncognito);
    const tabId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;
    if (action === 'zoom-in') { this.zoomIn(tabId); return this.menuState(); }
    if (action === 'zoom-out') { this.zoomOut(tabId); return this.menuState(); }
    if (action === 'zoom-reset') { this.resetZoom(tabId); return this.menuState(); }
    if (typeof action === 'string' && action.startsWith('theme-')) {
      const theme = normalizeTheme(action.slice('theme-'.length));
      const updated = this.storage.updateSettings({ theme });
      try { require('electron').nativeTheme.themeSource = theme; } catch (_) { /* not in tests */ }
      this.broadcastThemeChange(theme);
      this.broadcastSettingsUpdated(updated);
      return this.menuState();
    }
    if (!FRAME_MENU_ACTIONS.has(action)) return false;
    this.closeMenuBubble();
    const win = isIncognito ? this.incognitoWindow : this.mainWindow;
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', action);
    return true;
  }
}

module.exports = BubblesMethods;
