// Chrome extensions: loading them and their pop-ups.
// Methods of the browser application (ShmmothBrowserApp), moved here from main.js unchanged: browser/mixins.js adds
// them to the class, so `this` is the application as before.
'use strict';

const {
  BrowserWindow,
  session,
  fs,
  log,
  PRELOAD_EXTERNAL
} = require('./shared');

class ExtensionsMethods {
  // ─── Chrome Extension Management (Stage 7) ───────────────────────────────

  async loadExtensions() {
    if (!this.extensionManager) return;

    // Older versions bundled uBlock Origin under <app>/extensions/ and registered it on every start. It never
    // loaded from an installed (asar) build and blocks nothing under Electron's extension support — the Ghostery
    // engine in AdBlockerService does the blocking — so it is no longer shipped. Forget the stale registry entry.
    for (const [id, record] of Object.entries(this.extensionManager.extensions)) {
      const dir = String(record && record.path || '').replace(/\\/g, '/');
      if (/\/extensions\/uBlock0\.chromium\/?$/.test(dir) && !fs.existsSync(record.path)) {
        try {
          await this.extensionManager.removeExtension(id);
          log.info('Removed the registry entry of the retired bundled uBlock Origin', { id });
        } catch (err) {
          log.warn('Could not remove the retired uBlock Origin entry', { id, error: err.message });
        }
      }
    }

    // Load all enabled extensions into defaultSession
    for (const [id, record] of Object.entries(this.extensionManager.extensions)) {
      if (record.enabled) {
        try {
          await this.extensionManager.loadIntoSession(session.defaultSession, id);
        } catch (err) {
          log.error(`Failed to load extension into session: ${record.name}`, { id, error: err.message });
        }
      }
    }
  }

  openExtensionPopup(extensionId, anchorBounds = null) {
    if (this.extensionPopupWin && !this.extensionPopupWin.isDestroyed()) {
      this.extensionPopupWin.close();
      this.extensionPopupWin = null;
    }

    if (!this.extensionManager) return false;
    const record = this.extensionManager.extensions[extensionId];
    if (!record || !record.enabled || !record.action || !record.action.default_popup) {
      return false;
    }

    const popupFile = record.action.default_popup.replace(/^[\/\\]+/, '');
    const popupUrl = `chrome-extension://${record.loadedId || record.id}/${popupFile}`;

    const width = 340;
    const height = 460;
    let x = 100;
    let y = 100;

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const winBounds = this.mainWindow.getBounds();
      if (anchorBounds && typeof anchorBounds === 'object') {
        x = Math.round(winBounds.x + anchorBounds.x - width + (anchorBounds.width || 30));
        y = Math.round(winBounds.y + anchorBounds.y + (anchorBounds.height || 30) + 6);
      } else {
        x = winBounds.x + winBounds.width - width - 20;
        y = winBounds.y + 80;
      }
    }

    this.extensionPopupWin = new BrowserWindow({
      width,
      height,
      x,
      y,
      parent: this.mainWindow,
      frame: false,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      backgroundColor: '#1e293b',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: PRELOAD_EXTERNAL
      }
    });

    this.extensionPopupWin.loadURL(popupUrl).catch(err => {
      log.warn('Could not load extension popup URL', { url: popupUrl, error: err.message });
    });

    this.extensionPopupWin.once('ready-to-show', () => {
      if (this.extensionPopupWin && !this.extensionPopupWin.isDestroyed()) {
        this.extensionPopupWin.show();
      }
    });

    this.extensionPopupWin.on('blur', () => {
      if (this.extensionPopupWin && !this.extensionPopupWin.isDestroyed()) {
        this.extensionPopupWin.close();
        this.extensionPopupWin = null;
      }
    });

    return true;
  }
}

module.exports = ExtensionsMethods;
