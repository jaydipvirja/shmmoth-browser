// Saved passwords: offering to save, the save bubble, the autofill bubble.
// Methods of the browser application (ShmmothBrowserApp), moved here from main.js unchanged: browser/mixins.js adds
// them to the class, so `this` is the application as before.
'use strict';

const {
  BrowserWindow,
  path,
  log,
  PRELOAD_INTERNAL,
  SRC_DIR
} = require('./shared');

class PasswordsMethods {
  // ─── Credential & Autofill Helpers (Stage 6) ─────────────────────────────

  _attachCredentialAndAutofillHooks(wc, tabData) {
    if (!tabData || tabData.isIncognito || !tabData.url) return;
    if (!tabData.url.startsWith('http://') && !tabData.url.startsWith('https://')) return;

    let origin;
    try {
      origin = new URL(tabData.url).origin;
    } catch (_) {
      return;
    }

    if (this.passwordVault && this.passwordVault.isNeverSaveOrigin(origin)) {
      return;
    }

    wc.executeJavaScript(`
      (function() {
        if (window.__shmmoth_login_hook__) return;
        window.__shmmoth_login_hook__ = true;

        document.addEventListener('submit', function(e) {
          try {
            var form = e.target;
            if (!form || typeof form.querySelectorAll !== 'function') return;
            var pw = form.querySelector('input[type="password"]');
            if (!pw || !pw.value) return;

            var allInputs = Array.prototype.slice.call(form.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])'));
            var userInput = allInputs.filter(function(input) {
              var attr = ((input.name || '') + ' ' + (input.id || '') + ' ' + (input.type || '') + ' ' + (input.getAttribute('autocomplete') || '')).toLowerCase();
              return /user|email|login|name|account/i.test(attr);
            })[0] || allInputs[0];

            var usernameVal = userInput ? (userInput.value || '').trim() : '';
            var passwordVal = pw.value;

            if (usernameVal && passwordVal) {
              console.log('__SHMMOTH_LOGIN_SUBMIT__:' + JSON.stringify({
                username: usernameVal,
                password: passwordVal
              }));
            }
          } catch (_) {}
        }, true);
      })();
    `).catch(() => {});
  }

  openPasswordBubble(data, isIncognito = false) {
    if (this.passwordBubbleWin && !this.passwordBubbleWin.isDestroyed()) {
      this.closePasswordBubble();
    }

    const parentWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    if (!parentWin || parentWin.isDestroyed()) return false;

    const width = 340;
    const height = 185;
    const winBounds = parentWin.getBounds();

    // Position neatly at top-right under the toolbar/address bar
    let x = Math.round(winBounds.x + winBounds.width - width - 110);
    let y = Math.round(winBounds.y + 82);

    // Keep on screen within parent window bounds
    x = Math.max(winBounds.x + 10, Math.min(x, winBounds.x + winBounds.width - width - 10));

    this.passwordBubbleWin = new BrowserWindow({
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

    this.passwordBubbleWin.loadFile(path.join(SRC_DIR, 'pages', 'password-bubble.html'));

    this.passwordBubbleWin.once('ready-to-show', () => {
      if (this.passwordBubbleWin && !this.passwordBubbleWin.isDestroyed()) {
        this.passwordBubbleWin.show();
        this.passwordBubbleWin.webContents.send('password:offerSave', data);
      }
    });

    return true;
  }

  /** The small "use a saved login" chooser next to a sign-in field. It never takes keyboard focus from the page. */
  createPasswordAutofillBubble({ parent, x, y, width, height }) {
    const win = new BrowserWindow({
      width, height, x, y,
      parent,
      frame: false,
      resizable: false,
      show: false,
      focusable: false,
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
    win.loadFile(path.join(SRC_DIR, 'pages', 'autofill-bubble.html'));
    return win;
  }

  closePasswordBubble() {
    if (this.passwordBubbleWin && !this.passwordBubbleWin.isDestroyed()) {
      this.passwordBubbleWin.close();
      this.passwordBubbleWin = null;
    }
    this.currentPasswordPrompt = null;
  }

  offerPasswordSave(tabId, origin, username, password) {
    if (!origin || !username || !password) return;
    if (this.passwordVault && this.passwordVault.isNeverSaveOrigin(origin)) return;
    // Signing in with a login that is already saved exactly as typed (e.g. just filled in) is nothing to offer to save
    if (this.passwordVault && this.passwordVault.matchesSaved(origin, username, password)) return;
    // Don't offer a "Save password?" bubble that cannot succeed (no OS-level encryption available)
    if (this.passwordVault && !this.passwordVault.canEncrypt()) {
      if (!this._warnedNoVaultEncryption) {
        this._warnedNoVaultEncryption = true;
        log.warn('Password save prompts disabled: OS-level encryption (safeStorage) is unavailable');
      }
      return;
    }

    const promptId = 'pwd_prompt_' + (++this.passwordPromptCounter);
    this.pendingPasswordPrompts[promptId] = {
      promptId,
      tabId,
      origin,
      username,
      password,
      timeout: setTimeout(() => {
        this.closePasswordBubble();
        delete this.pendingPasswordPrompts[promptId];
      }, 60000)
    };

    this.currentPasswordPrompt = {
      promptId,
      origin,
      username
    };

    // Open native floating password bubble on top of WebContentsView
    this.openPasswordBubble(this.currentPasswordPrompt);
  }

  _handlePasswordPromptResponse(promptId, action) {
    this.closePasswordBubble();

    const prompt = this.pendingPasswordPrompts[promptId];
    if (!prompt) return { success: false, error: 'Prompt expired or invalid' };

    clearTimeout(prompt.timeout);
    delete this.pendingPasswordPrompts[promptId];

    if (action === 'save') {
      try {
        const saved = this.passwordVault.saveCredential({
          origin: prompt.origin,
          username: prompt.username,
          password: prompt.password
        });
        return { success: true, saved: true, id: saved.id };
      } catch (err) {
        log.error('Saving password failed', { code: err.code, error: err.message });
        return { success: false, error: err.message, code: err.code };
      }
    } else if (action === 'never') {
      this.passwordVault.neverSaveOrigin(prompt.origin);
      return { success: true, never: true };
    }
    return { success: true, dismissed: true };
  }
}

module.exports = PasswordsMethods;
