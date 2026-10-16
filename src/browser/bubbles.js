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
}

module.exports = BubblesMethods;
