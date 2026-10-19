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

    // Sign-ins are noticed when the form is submitted, and also when its button is clicked or Enter is pressed in the
    // password field: most sites today sign in with a script and never submit a form, so before 1.4.7 their
    // passwords were never offered for saving (and so could never be filled in later). On a two-step sign-in (the
    // user name on one page, the password on the next) the user name of the first step is remembered.
    wc.executeJavaScript(`
      (function() {
        if (window.__shmmoth_login_hook__) return;
        window.__shmmoth_login_hook__ = true;
        var sent = '';

        function scopeOf(el) {
          if (el.form) return el.form;
          var node = el.parentElement;
          for (var depth = 0; node && depth < 6; depth++, node = node.parentElement) {
            if (node.querySelectorAll('input').length >= 2) return node;
          }
          return document;
        }
        function textInputs(scope) {
          return Array.prototype.slice.call(scope.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])'))
            .filter(function(input) { return input.offsetWidth > 0 || input.offsetHeight > 0 || input.value; });
        }
        function userInputIn(scope) {
          var all = textInputs(scope);
          return all.filter(function(input) {
            var attr = ((input.name || '') + ' ' + (input.id || '') + ' ' + (input.type || '') + ' ' + (input.getAttribute('autocomplete') || '')).toLowerCase();
            return /user|email|login|name|account|mobile|phone/i.test(attr);
          })[0] || all[0];
        }
        function filledPassword(scope) {
          var pws = Array.prototype.slice.call(scope.querySelectorAll('input[type="password"]')).filter(function(p) { return p.value; });
          return pws[0] || null;
        }
        function report(scope) {
          try {
            var pw = filledPassword(scope);
            if (!pw) {
              // a first step that asks only for the user name
              var only = userInputIn(scope);
              if (only && only.value && !scope.querySelector('input[type="password"]') && /user|email|login|account|identifier|mobile|phone/i.test((only.name || '') + ' ' + (only.id || '') + ' ' + (only.type || '') + ' ' + (only.getAttribute('autocomplete') || ''))) {
                console.log('__SHMMOTH_LOGIN_USER__:' + JSON.stringify({ username: only.value.trim() }));
              }
              return;
            }
            var userInput = userInputIn(scopeOf(pw));
            var usernameVal = userInput ? (userInput.value || '').trim() : '';
            var key = JSON.stringify([usernameVal, pw.value]);
            if (key === sent) return;
            sent = key;
            console.log('__SHMMOTH_LOGIN_SUBMIT__:' + JSON.stringify({ username: usernameVal, password: pw.value }));
          } catch (_) {}
        }

        // a button that sends the sign-in — not "show password", "forgot password" and the like
        function isSignInButton(b) {
          var text = ((b.textContent || '') + ' ' + (b.value || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.id || '')).toLowerCase();
          if (/show|hide|eye|reveal|forgot|reset|cancel|back|close|register|sign.?up|create/.test(text)) return false;
          if ((b.tagName === 'BUTTON' && b.form && (b.getAttribute('type') || 'submit').toLowerCase() === 'submit') || (b.type || '').toLowerCase() === 'submit') return true;
          return /log.?in|sign.?in|submit|continue|next|proceed|verify|^\\s*(ok|go|enter)\\s*$/.test(text.trim());
        }

        document.addEventListener('submit', function(e) {
          var form = e.target;
          if (form && typeof form.querySelectorAll === 'function') report(form);
        }, true);
        document.addEventListener('keydown', function(e) {
          if (e.key !== 'Enter' || !e.isTrusted) return;
          var el = e.target;
          if (el && el.tagName === 'INPUT') report(scopeOf(el));
        }, true);
        document.addEventListener('click', function(e) {
          if (!e.isTrusted || !e.target || typeof e.target.closest !== 'function') return;
          var button = e.target.closest('button, input[type="submit"], input[type="button"], [role="button"]');
          if (button && isSignInButton(button)) report(scopeOf(button));
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
  createPasswordAutofillBubble({ parent, x, y, width, height }, page = 'autofill-bubble.html') {
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
    win.loadFile(path.join(SRC_DIR, 'pages', page));
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
