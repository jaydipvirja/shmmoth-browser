/**
 * Password autofill — puts a SAVED login into a web page's sign-in form after the user has picked it.
 *
 * Before 1.1.6 the browser could save passwords but never fill them back in (the "Autofill" tab is for addresses).
 *
 * How it works, and why it is built this way:
 *   1. When a normal-window tab finishes loading a page that has saved logins, a small detection script is
 *      injected into an ISOLATED world of the page (same DOM, but the page's own JavaScript cannot see or call
 *      anything in it).
 *   2. When the user clicks / focuses a username or password field, the script reports where the field is. The
 *      message carries a random per-page nonce, so a page cannot fake it from its own world.
 *   3. The browser (main process) shows a small chooser window next to the field. It lists USER NAMES only.
 *   4. Only when the user clicks an entry does the main process decrypt that one password and hand it to the
 *      isolated-world script, which writes it into the form. The page therefore never receives a password it was
 *      not explicitly given, and never learns that saved logins exist before the user acts.
 *   5. Nothing is submitted for the user.
 *
 * Rules: https (plus http on localhost) · the exact origin the login was saved for · never in private windows ·
 * top-level page only (no iframes) · sign-up / "new password" fields are left alone.
 */

'use strict';

const crypto = require('crypto');

const MSG_PREFIX = '__SHMMOTH_PWFILL__:';
const ISOLATED_WORLD_ID = 4242;          // any id outside Electron's own (0 = page, 999 = contextIsolation) and the extension range
const CHOOSER_TTL_MS = 60 * 1000;
const MIN_SHOW_GAP_MS = 120;             // a page that keeps re-focusing a field cannot flood the user with windows
const MAX_MESSAGE_CHARS = 512;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 56;
const MAX_VISIBLE_ROWS = 5;
const BUBBLE_MIN_WIDTH = 260;
const BUBBLE_MAX_WIDTH = 380;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The origin a login may be filled on, or null when the address is not eligible. */
function eligibleOrigin(url) {
  if (typeof url !== 'string' || !url) return null;
  let parsed;
  try { parsed = new URL(url); } catch (_) { return null; }
  if (parsed.protocol === 'https:') return parsed.origin;
  if (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) return parsed.origin;
  return null;
}

/**
 * The script that runs inside the isolated world. It stays quiet until the user acts on a login field, and it holds
 * the only code that ever writes into the form (`fill`).
 */
function buildPageScript(messagePrefix) {
  return `(function (PREFIX) {
  if (window.__shmmothPwFill) return;
  var state = window.__shmmothPwFill = { target: null, shown: false };
  var valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  var TEXTLIKE = { text: 1, email: 1, tel: 1 };

  function send(message) { try { console.log(PREFIX + JSON.stringify(message)); } catch (e) {} }
  function tokens(el) { return (el.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/); }
  function has(list, token) { return list.indexOf(token) !== -1; }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }
  function usable(el) { return !el.disabled && !el.readOnly && isVisible(el); }
  function isPassword(el) { return !!el && el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'password'; }
  function isNewPassword(el) { return has(tokens(el), 'new-password'); }
  function textLike(el) {
    if (!el || el.tagName !== 'INPUT' || !TEXTLIKE[String(el.type).toLowerCase()]) return false;
    var t = tokens(el);
    if (has(t, 'one-time-code') || has(t, 'new-password')) return false;
    for (var i = 0; i < t.length; i++) { if (/^(cc-|address|postal|bday|tel-|street|country|organization)/.test(t[i])) return false; }
    return usable(el);
  }
  // the smallest surrounding container (the form, or up to 8 parents) that satisfies \`accept\`
  function containerWhere(el, accept) {
    var node = el.form || el.parentElement;
    for (var depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      if (accept(node)) return node;
      if (el.form && node === el.form) return null;
    }
    return null;
  }
  function loginPasswordsIn(scope) {
    return Array.prototype.filter.call(scope.querySelectorAll('input[type="password"]'), function (p) { return usable(p) && !isNewPassword(p); });
  }
  function passwordsNear(el) {
    var scope = containerWhere(el, function (n) { return loginPasswordsIn(n).length > 0; });
    return scope ? loginPasswordsIn(scope) : [];
  }
  function isUsernameField(el) {
    if (!textLike(el)) return false;
    var t = tokens(el);
    if (has(t, 'username') || has(t, 'email')) return true;
    return passwordsNear(el).length > 0;
  }
  function usernameBefore(pw) {
    var found = null;
    containerWhere(pw, function (scope) {
      var all = scope.querySelectorAll('input');
      for (var i = 0; i < all.length; i++) {
        if (all[i] === pw) break;
        if (textLike(all[i])) found = all[i];
      }
      return !!found;
    });
    return found;
  }
  function setValue(el, value) {
    valueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function hide() { if (state.shown) { state.shown = false; send({ t: 'hide' }); } }

  function consider(e) {
    if (!e.isTrusted) return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT') return;
    if (isPassword(el)) { if (!usable(el) || isNewPassword(el)) return; }
    else if (!isUsernameField(el)) return;
    if (el.value) return;                               // already has text: no suggestions on top of it
    state.target = el;
    var r = el.getBoundingClientRect();
    state.shown = true;
    send({ t: 'show', l: r.left, tp: r.top, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight });
  }
  document.addEventListener('focusin', consider, true);
  document.addEventListener('click', consider, true);
  document.addEventListener('focusout', function (e) { if (e.target === state.target) hide(); }, true);
  document.addEventListener('input', function (e) { if (e.target === state.target) hide(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); }, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide, true);

  // Called by the browser only after the user has chosen an entry.
  state.fill = function (username, password, origin) {
    state.shown = false;
    if (location.origin !== origin) return { ok: false, reason: 'origin' };
    var target = state.target;
    if (!target || !target.isConnected) return { ok: false, reason: 'field' };
    var userField = null, passField = null;
    if (isPassword(target)) { passField = target; userField = usernameBefore(target); }
    else { userField = target; passField = passwordsNear(target)[0] || null; }
    var user = false, pass = false;
    if (userField) { setValue(userField, username); user = true; }
    if (passField) { setValue(passField, password); pass = true; }
    return { ok: user || pass, user: user, password: pass };
  };
})(${JSON.stringify(messagePrefix)});`;
}

/**
 * Where the chooser goes: just under the field (or above it when there is no room), in screen pixels.
 * @param {object} p
 * @param {{x:number,y:number}} p.content          window content area (screen coordinates)
 * @param {{x:number,y:number,width:number,height:number}} p.view   the tab's view (relative to the content area)
 * @param {{l:number,tp:number,w:number,h:number}} p.rect           the field in page pixels
 * @param {number} p.zoom
 * @param {number} p.rows
 */
function placeChooser({ content, view, rect, zoom = 1, rows }) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const visibleRows = Math.max(1, Math.min(rows, MAX_VISIBLE_ROWS));
  const height = HEADER_HEIGHT + visibleRows * ROW_HEIGHT + 8;
  const fieldW = Math.max(0, rect.w * z);
  const width = Math.round(Math.max(BUBBLE_MIN_WIDTH, Math.min(BUBBLE_MAX_WIDTH, fieldW)));

  const viewLeft = content.x + view.x;
  const viewTop = content.y + view.y;
  const fieldLeft = viewLeft + rect.l * z;
  const fieldTop = viewTop + rect.tp * z;
  const fieldBottom = fieldTop + rect.h * z;

  let x = fieldLeft;
  x = Math.min(x, viewLeft + view.width - width - 4);
  x = Math.max(x, viewLeft + 4);

  let y = fieldBottom + 2;
  if (y + height > viewTop + view.height) {
    const above = fieldTop - height - 2;
    y = above >= viewTop ? above : Math.max(viewTop, viewTop + view.height - height);
  }
  return { x: Math.round(x), y: Math.round(y), width, height };
}

class PasswordAutofill {
  /**
   * @param {object} deps
   * @param {object}   deps.vault           PasswordVault
   * @param {Function} deps.isEnabled       () => boolean  (the Settings switch)
   * @param {Function} deps.getTab          (tabId) => tabData | undefined
   * @param {Function} deps.isActiveTab     (tabData) => boolean
   * @param {Function} deps.getParentWindow (tabData) => BrowserWindow | null
   * @param {Function} deps.createBubble    ({ parent, x, y, width, height }) => BrowserWindow
   * @param {Function} [deps.getCursor]     () => {x,y} screen position of the mouse
   * @param {object}   [deps.log]
   * @param {Function} [deps.now]
   */
  constructor(deps) {
    this.vault = deps.vault;
    this.isEnabled = deps.isEnabled;
    this.getTab = deps.getTab;
    this.isActiveTab = deps.isActiveTab;
    this.getParentWindow = deps.getParentWindow;
    this.createBubble = deps.createBubble;
    this.getCursor = deps.getCursor || null;
    this.log = deps.log || { info() {}, warn() {} };
    this.now = deps.now || Date.now;

    this.pages = new Map();     // tabId → { prefix, wcId, origin }
    this.chooser = null;        // { id, tabId, wcId, origin, accounts, timer }
    this.bubble = null;
    this.counter = 0;
    this.lastShowAt = 0;
  }

  // ── Page side ──────────────────────────────────────────────────────────────

  /** Called when a page has loaded. Injects the detection script when it can be useful. */
  attach(wc, tabId, tabData) {
    this.forgetTab(tabId);
    try {
      if (!wc || wc.isDestroyed() || !tabData || tabData.isIncognito) return false;
      if (!this.isEnabled() || !this.vault || !this.vault.canEncrypt()) return false;
      const origin = eligibleOrigin(wc.getURL());
      if (!origin) return false;
      // nothing saved for this exact site → do not touch the page at all
      if (this.vault.getCredentialsForOrigin(origin).length === 0) return false;

      const prefix = MSG_PREFIX + crypto.randomBytes(12).toString('hex') + ':';
      this.pages.set(tabId, { prefix, wcId: wc.id, origin });
      wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: buildPageScript(prefix) }]).catch(() => {});
      return true;
    } catch (err) {
      this.log.warn('Password autofill could not attach', { error: err.message });
      return false;
    }
  }

  /** Forget a tab's page state (navigation, tab closed). */
  forgetTab(tabId) {
    this.pages.delete(tabId);
    if (this.chooser && this.chooser.tabId === tabId) this.dismiss();
  }

  /**
   * Console messages from the page. Returns true when the message belonged to this feature (so the caller can stop
   * looking at it), whether or not it was acted upon.
   */
  handleConsoleMessage(tabId, message) {
    if (typeof message !== 'string' || !message.startsWith(MSG_PREFIX)) return false;
    const page = this.pages.get(tabId);
    if (!page || !message.startsWith(page.prefix) || message.length > page.prefix.length + MAX_MESSAGE_CHARS) return true;
    let payload;
    try { payload = JSON.parse(message.slice(page.prefix.length)); } catch (_) { return true; }
    if (!payload || typeof payload !== 'object') return true;
    if (payload.t === 'hide') this._hideFor(tabId);
    else if (payload.t === 'show') this._show(tabId, page, payload);
    return true;
  }

  _hideFor(tabId) {
    if (!this.chooser || this.chooser.tabId !== tabId) return;
    // a click that lands on the chooser itself may blur the field first — that must not close it under the mouse
    if (this._cursorOnBubble()) return;
    this.dismiss();
  }

  _cursorOnBubble() {
    try {
      if (!this.getCursor || !this.bubble || this.bubble.isDestroyed()) return false;
      const c = this.getCursor();
      const b = this.bubble.getBounds();
      return c.x >= b.x && c.x <= b.x + b.width && c.y >= b.y && c.y <= b.y + b.height;
    } catch (_) {
      return false;
    }
  }

  _show(tabId, page, msg) {
    const tab = this.getTab(tabId);
    if (!tab || tab.isIncognito || !tab.view || !this.isActiveTab(tab)) return;
    const wc = tab.view.webContents;
    if (!wc || wc.isDestroyed() || wc.id !== page.wcId) return;
    if (eligibleOrigin(wc.getURL()) !== page.origin) return;          // the tab has moved on
    if (!this.isEnabled() || !this.vault.canEncrypt()) return;

    const t = this.now();
    if (t - this.lastShowAt < MIN_SHOW_GAP_MS) return;

    const nums = [msg.l, msg.tp, msg.w, msg.h];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return;

    const accounts = this.vault.getCredentialsForOrigin(page.origin).map((c) => ({ id: c.id, username: c.username }));
    if (accounts.length === 0) return;

    const parent = this.getParentWindow(tab);
    if (!parent || parent.isDestroyed()) return;

    this.dismiss();
    this.lastShowAt = t;

    const rect = { l: msg.l, tp: msg.tp, w: Math.max(0, msg.w), h: Math.max(0, msg.h) };
    const content = parent.getContentBounds();
    const placement = placeChooser({
      content, view: tab.view.getBounds(), rect, zoom: wc.getZoomFactor(), rows: accounts.length
    });

    const id = 'pwfill_' + (++this.counter) + '_' + crypto.randomBytes(6).toString('hex');
    const chooser = { id, tabId, wcId: wc.id, origin: page.origin, accounts, timer: null };
    chooser.timer = setTimeout(() => { if (this.chooser === chooser) this.dismiss(); }, CHOOSER_TTL_MS);
    if (chooser.timer.unref) chooser.timer.unref();
    this.chooser = chooser;

    const win = this.createBubble({ parent, ...placement });
    this.bubble = win;
    win.once('closed', () => { if (this.bubble === win) { this.bubble = null; this._clear(); } });
    win.once('ready-to-show', () => {
      if (this.bubble === win && !win.isDestroyed()) win.showInactive();
    });
  }

  // ── Chooser window side ───────────────────────────────────────────────────

  _fromBubble(senderWc) {
    return Boolean(this.bubble && !this.bubble.isDestroyed() && senderWc && senderWc === this.bubble.webContents);
  }

  /** What the chooser window shows. Usernames only. */
  getChooser(senderWc) {
    if (!this.chooser || !this._fromBubble(senderWc)) return null;
    return { promptId: this.chooser.id, origin: this.chooser.origin, accounts: this.chooser.accounts.map((a) => ({ ...a })) };
  }

  /** The user clicked an entry. */
  async choose(promptId, credentialId, senderWc) {
    const chooser = this.chooser;
    if (!chooser || chooser.id !== promptId || !this._fromBubble(senderWc)) return { success: false, error: 'This suggestion has expired.' };
    const account = chooser.accounts.find((a) => a.id === credentialId);
    if (!account) return { success: false, error: 'Unknown login.' };
    this.dismiss();

    const tab = this.getTab(chooser.tabId);
    const wc = tab && !tab.isIncognito && tab.view ? tab.view.webContents : null;
    if (!wc || wc.isDestroyed() || wc.id !== chooser.wcId) return { success: false, error: 'The page is gone.' };
    if (eligibleOrigin(wc.getURL()) !== chooser.origin) return { success: false, error: 'The page changed, nothing was filled in.' };

    const password = this.vault.decryptForAuthorizedUse(account.id);
    if (typeof password !== 'string' || !password) return { success: false, error: 'The saved password could not be read.' };

    let result;
    try {
      const call = 'window.__shmmothPwFill && window.__shmmothPwFill.fill(' +
        JSON.stringify(account.username) + ',' + JSON.stringify(password) + ',' + JSON.stringify(chooser.origin) + ')';
      result = await wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: call }]);
    } catch (err) {
      this.log.warn('Password autofill failed', { error: err.message });
      return { success: false, error: 'The page did not accept the login.' };
    }
    if (!result || !result.ok) return { success: false, error: 'No sign-in field found.' };
    return { success: true, filledUser: Boolean(result.user), filledPassword: Boolean(result.password) };
  }

  /** Close the chooser (Escape, click elsewhere, navigation, tab switch, window move…). */
  dismiss() {
    const win = this.bubble;
    this.bubble = null;
    this._clear();
    if (win && !win.isDestroyed()) {
      try { win.close(); } catch (_) { /* already closing */ }
    }
  }

  _clear() {
    if (this.chooser && this.chooser.timer) clearTimeout(this.chooser.timer);
    this.chooser = null;
  }

  /** For tests / diagnostics. */
  isChooserOpen() { return Boolean(this.chooser); }
}

module.exports = {
  PasswordAutofill,
  eligibleOrigin,
  buildPageScript,
  placeChooser,
  MSG_PREFIX,
  ISOLATED_WORLD_ID,
};
