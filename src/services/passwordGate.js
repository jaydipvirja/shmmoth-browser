/**
 * PASSWORD GATE — what must happen before a saved password leaves the vault for the screen or the clipboard.
 *
 * Settings → Passwords used to hand the plain password to the page on a single click of the eye icon, keep it on screen
 * until the page was left, and copy it to the clipboard through the page, where it stayed for ever. Now:
 *   - every reveal / copy first asks in a NATIVE confirmation window of the browser (outside any web page, so neither an
 *     injected script in an internal page nor an unattended click can get past it); the text names the user name and the
 *     site, with control characters stripped (user names come from web pages)
 *   - requests are rate limited (a script cannot flood the screen with dialogs or probe passwords one after another) and
 *     only one dialog is open at a time
 *   - "copy" never sends the password to the page at all: it goes from the vault straight to the clipboard, which is
 *     emptied again after 30 s (only when it still holds that password), and when the browser quits
 *   - a revealed password hides itself again after 15 s (the page is told how long; see pages/settings.js)
 *
 * What this is not: a login. Anyone who can answer the dialog on an unlocked, running browser can still see the
 * password — real re-authentication (Windows Hello) needs a native module and is planned.
 */

'use strict';

const REVEAL_HIDE_MS = 15 * 1000;
const CLIPBOARD_CLEAR_MS = 30 * 1000;
const WINDOW_MS = 30 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_SHOWN_CHARS = 60;

/** Text that came from a web page, made safe to show in a dialog: no control characters, one line, shortened. */
function plainText(value, max = MAX_SHOWN_CHARS) {
  let s = String(value == null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

class PasswordGate {
  /**
   * @param {object} deps
   * @param {Function} deps.confirm       async ({ title, message, detail, confirmLabel, parent }) => boolean   (the native dialog)
   * @param {object}   deps.clipboard     { writeText(text), readText(), clear() }
   * @param {Function} [deps.now]
   * @param {Function} [deps.setTimer]    (fn, ms) => handle (default setTimeout, unref'd)
   * @param {Function} [deps.clearTimer]
   * @param {object}   [deps.log]
   */
  constructor({ confirm, clipboard, now = Date.now, setTimer, clearTimer, log }) {
    this.confirm = confirm;
    this.clipboard = clipboard;
    this.now = now;
    this.setTimer = setTimer || ((fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; });
    this.clearTimer = clearTimer || clearTimeout;
    this.log = log || { info() {}, warn() {} };
    this.recent = [];
    this.busy = false;
    this.pendingClear = null;          // { text, timer }
  }

  _rateLimited() {
    const t = this.now();
    this.recent = this.recent.filter((x) => t - x < WINDOW_MS);
    if (this.recent.length >= MAX_REQUESTS_PER_WINDOW) return true;
    this.recent.push(t);
    return false;
  }

  /**
   * Asks the user. @returns {Promise<{ ok: true } | { ok: false, reason: 'cancelled'|'busy'|'rate'|'error' }>}
   * @param {'show'|'copy'} purpose
   * @param {object} credential  { username, origin }
   * @param {{ parent?: object }} [ctx]  the window the dialog belongs to
   */
  async authorize(purpose, credential, ctx = {}) {
    if (this.busy) return { ok: false, reason: 'busy' };
    if (this._rateLimited()) return { ok: false, reason: 'rate' };
    const user = plainText(credential && credential.username);
    const site = plainText(credential && credential.origin, 80);
    const copy = purpose === 'copy';
    this.busy = true;
    try {
      const yes = await this.confirm({
        title: copy ? 'Copy password' : 'Show password',
        message: copy ? `Copy the saved password for “${user}” on ${site} to the clipboard?` : `Show the saved password for “${user}” on ${site}?`,
        detail: copy
          ? 'Anyone who uses this computer in the next 30 seconds can paste it. The browser clears the clipboard after 30 seconds.'
          : 'Anyone who can see your screen will see it. It hides itself again after 15 seconds.',
        confirmLabel: copy ? 'Copy' : 'Show',
        parent: ctx.parent
      });
      return yes === true ? { ok: true } : { ok: false, reason: 'cancelled' };
    } catch (err) {
      this.log.warn('Password confirmation failed', { error: err && err.message });
      return { ok: false, reason: 'error' };
    } finally {
      this.busy = false;
    }
  }

  /**
   * Puts a password on the clipboard and arranges for it to be removed again. Never throws.
   * (Electron's clipboard methods return promises — a comparison with the text read back must wait for it.)
   */
  async copyToClipboard(text) {
    try {
      await this.clipboard.writeText(text);
    } catch (err) {
      this.log.warn('Could not copy the password', { error: err && err.message });
      return false;
    }
    if (this.pendingClear) this.clearTimer(this.pendingClear.timer);
    const pending = { text, timer: null };
    pending.timer = this.setTimer(() => { this.clearClipboardNow().catch(() => {}); }, CLIPBOARD_CLEAR_MS);
    this.pendingClear = pending;
    return true;
  }

  /** Empties the clipboard if it still holds the password we put there (something the user copied since stays). */
  async clearClipboardNow() {
    const pending = this.pendingClear;
    if (!pending) return false;
    this.clearTimer(pending.timer);
    this.pendingClear = null;
    try {
      if ((await this.clipboard.readText()) === pending.text) { await this.clipboard.clear(); return true; }
    } catch (_) { /* clipboard busy: nothing more to do */ }
    return false;
  }
}

PasswordGate.REVEAL_HIDE_MS = REVEAL_HIDE_MS;
PasswordGate.CLIPBOARD_CLEAR_MS = CLIPBOARD_CLEAR_MS;
PasswordGate.plainText = plainText;
module.exports = PasswordGate;
