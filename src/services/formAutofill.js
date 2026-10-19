/**
 * Form autofill — puts a SAVED address profile (Settings → Autofill: name, email, phone, address …) into a web page's
 * form after the user has picked it.
 *
 * Until 1.4.7 the profiles could be saved in Settings but nothing ever filled them in.
 *
 * Built like password autofill (passwordAutofill.js), for the same reasons:
 *   1. When a normal-window tab finishes loading an http(s) page and autofill is on with at least one profile, a
 *      detection script is injected into an ISOLATED world of the page (same DOM; the page's scripts cannot see it).
 *   2. When the user clicks / focuses an empty field that it recognises (autocomplete="email", name="phone",
 *      a label "PIN code" …), it reports the kind of field and where it is (random per-page nonce).
 *   3. The browser shows a small chooser next to the field: one line per profile that has a value for that field.
 *   4. Only when the user clicks a profile does the browser hand THAT profile to the isolated-world script, which fills
 *      the empty recognised fields of the same form. The page learns nothing before the user acts, and nothing is
 *      submitted.
 *
 * Rules: http and https · never in private windows · top-level page only · never password, search, card, one-time
 * code or captcha fields · a field that already has text is left as it is.
 */

'use strict';

const crypto = require('crypto');
const { placeChooser } = require('./passwordAutofill');

const MSG_PREFIX = '__SHMMOTH_FORMFILL__:';
const ISOLATED_WORLD_ID = 4243;          // next to password autofill's 4242
const CHOOSER_TTL_MS = 60 * 1000;
const MIN_SHOW_GAP_MS = 120;
const MAX_MESSAGE_CHARS = 512;

/** Field kinds the page script recognises, and the profile value each one takes. */
const KINDS = ['name', 'given', 'family', 'email', 'phone', 'address', 'city', 'state', 'country', 'postalCode'];

/** The origin a profile may be filled on, or null. */
function eligibleOrigin(url) {
  if (typeof url !== 'string' || !url) return null;
  let parsed;
  try { parsed = new URL(url); } catch (_) { return null; }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
}

/** The value of `kind` in a profile ('given' / 'family' are split from the full name). */
function valueFor(profile, kind) {
  if (!profile || typeof profile !== 'object') return '';
  const name = String(profile.name || '').trim();
  if (kind === 'given') return name.split(/\s+/)[0] || '';
  if (kind === 'family') { const parts = name.split(/\s+/); return parts.length > 1 ? parts.slice(1).join(' ') : ''; }
  const v = profile[kind];
  return typeof v === 'string' ? v.trim() : '';
}

/** What is handed to the page for one profile: the values of every kind (strings only). */
function fillValues(profile) {
  const out = {};
  for (const k of KINDS) out[k] = valueFor(profile, k);
  return out;
}

/** One line in the chooser: who, and the value this field will get. */
function describe(profile, kind) {
  const value = valueFor(profile, kind);
  const name = String(profile.name || '').trim();
  const title = name || String(profile.email || '').trim() || String(profile.address || '').trim();
  return { title, detail: value && value !== title ? value : [profile.address, profile.city].filter(Boolean).join(', ') };
}

/**
 * The script that runs inside the isolated world. It recognises the fields and holds the only code that writes into
 * the form (`fill`).
 */
function buildPageScript(messagePrefix) {
  return `(function (PREFIX) {
  if (window.__shmmothFormFill) return;
  var state = window.__shmmothFormFill = { target: null, kind: null, shown: false };
  var inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  var areaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  var selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  var TEXTLIKE = { text: 1, email: 1, tel: 1, number: 1 };
  // a word on its own (names and ids join words with _ or -, which \\b does not separate)
  function word(w) { return new RegExp('(^|[^a-z])' + w + '([^a-z]|$)'); }
  var W = { name: word('name'), state: word('state'), tel: word('tel'), pin: word('pin') };

  function send(message) { try { console.log(PREFIX + JSON.stringify(message)); } catch (e) {} }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }
  function usable(el) { return !el.disabled && !el.readOnly && isVisible(el); }
  function labelText(el) {
    var parts = [];
    try { if (el.labels) for (var i = 0; i < el.labels.length; i++) parts.push(el.labels[i].textContent || ''); } catch (e) {}
    var by = el.getAttribute('aria-labelledby');
    if (by) by.split(/\\s+/).forEach(function (id) { var n = document.getElementById(id); if (n) parts.push(n.textContent || ''); });
    return parts.join(' ');
  }
  // what kind of field this is, or null
  function kindOf(el) {
    if (!el) return null;
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return null;
    var type = tag === 'INPUT' ? String(el.getAttribute('type') || 'text').toLowerCase() : '';
    if (tag === 'INPUT' && !TEXTLIKE[type]) return null;
    var ac = String(el.getAttribute('autocomplete') || '').toLowerCase();
    if (/\\b(off|false)\\b/.test(ac) && !/\\b(name|email|tel|address|postal|country)/.test(ac)) ac = '';
    if (/(cc-|one-time-code|password|username|bday|transaction|webauthn)/.test(ac)) return null;
    var tokens = ac.split(/\\s+/);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === 'name') return 'name';
      if (t === 'given-name') return 'given';
      if (t === 'family-name') return 'family';
      if (t === 'email') return 'email';
      if (t === 'tel' || t === 'tel-national') return 'phone';
      if (t === 'street-address' || t === 'address-line1') return 'address';
      if (t === 'address-level2') return 'city';
      if (t === 'address-level1') return 'state';
      if (t === 'country' || t === 'country-name') return 'country';
      if (t === 'postal-code') return 'postalCode';
    }
    var hint = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), labelText(el)].join(' ').toLowerCase();
    if (/pass|search|query|captcha|otp|one.?time|card|cvv|coupon|promo|user.?name|login|amount|qty|quantity|company|business|subject|message|comment/.test(hint)) return null;
    if (/line.?2|address.?2|apartment|suite|landmark/.test(hint)) return null;      // the second address line stays the user's
    var kind = null;
    if (type === 'email' || /e-?mail/.test(hint)) kind = 'email';
    else if (type === 'tel' || /phone|mobile|contact.?(no|num)|whatsapp/.test(hint) || W.tel.test(hint)) kind = 'phone';
    else if (/zip|postal|post.?code|pin.?code/.test(hint) || W.pin.test(hint)) kind = 'postalCode';
    else if (/country/.test(hint)) kind = 'country';
    else if (/province|region/.test(hint) || W.state.test(hint)) kind = 'state';
    else if (/city|town|district/.test(hint)) kind = 'city';
    else if (/address|street|addr|line.?1|house|flat|locality/.test(hint)) kind = 'address';
    else if (/first.?name|fname|given/.test(hint)) kind = 'given';
    else if (/last.?name|lname|surname|family/.test(hint)) kind = 'family';
    else if (/full.?name|your.?name|customer.?name|contact.?name/.test(hint) || W.name.test(hint)) kind = 'name';
    if (type === 'number' && kind !== 'phone' && kind !== 'postalCode') return null;
    return kind;
  }
  function scopeOf(el) {
    if (el.form) return el.form;
    var node = el.parentElement;
    for (var depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (node.querySelectorAll('input, select, textarea').length >= 3) return node;
    }
    return document.body;
  }
  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setSelect(el, value) {
    var want = String(value).toLowerCase();
    for (var i = 0; i < el.options.length; i++) {
      var o = el.options[i];
      if (String(o.value).toLowerCase() === want || String(o.textContent).trim().toLowerCase() === want) {
        selectSetter.call(el, o.value);
        fire(el);
        return true;
      }
    }
    return false;
  }
  function setValue(el, value) {
    if (el.tagName === 'SELECT') return setSelect(el, value);
    (el.tagName === 'TEXTAREA' ? areaSetter : inputSetter).call(el, value);
    fire(el);
    return true;
  }
  function isEmpty(el) { return el.tagName === 'SELECT' ? el.selectedIndex <= 0 : !el.value; }
  function hide() { if (state.shown) { state.shown = false; send({ t: 'hide' }); } }

  function consider(e) {
    if (!e.isTrusted) return;
    var el = e.target;
    var kind = kindOf(el);
    if (!kind || !usable(el) || !isEmpty(el)) return;
    state.target = el;
    state.kind = kind;
    var r = el.getBoundingClientRect();
    state.shown = true;
    send({ t: 'show', k: kind, l: r.left, tp: r.top, w: r.width, h: r.height });
  }
  document.addEventListener('focusin', consider, true);
  document.addEventListener('click', consider, true);
  document.addEventListener('focusout', function (e) { if (e.target === state.target) hide(); }, true);
  document.addEventListener('input', function (e) { if (e.target === state.target) hide(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); }, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide, true);

  // Called by the browser only after the user has chosen a profile: fills the empty recognised fields of the form.
  state.fill = function (values, origin) {
    state.shown = false;
    if (location.origin !== origin) return { ok: false, reason: 'origin' };
    var target = state.target;
    if (!target || !target.isConnected) return { ok: false, reason: 'field' };
    var fields = scopeOf(target).querySelectorAll('input, select, textarea');
    var filled = 0, nameUsed = false;
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      var kind = kindOf(el);
      if (!kind || !usable(el) || !isEmpty(el)) continue;
      var v = values[kind];
      if (typeof v !== 'string' || !v) continue;
      if (kind === 'name') { if (nameUsed) continue; nameUsed = true; }
      if (setValue(el, v)) filled++;
    }
    return { ok: filled > 0, filled: filled };
  };
})(${JSON.stringify(messagePrefix)});`;
}

class FormAutofill {
  /**
   * @param {object} deps
   * @param {object}   deps.service         AutofillService (profiles + the Settings switch)
   * @param {Function} deps.getTab          (tabId) => tabData | undefined
   * @param {Function} deps.isActiveTab     (tabData) => boolean
   * @param {Function} deps.getParentWindow (tabData) => BrowserWindow | null
   * @param {Function} deps.createBubble    ({ parent, x, y, width, height }) => BrowserWindow
   * @param {Function} [deps.getCursor]     () => {x,y} screen position of the mouse
   * @param {object}   [deps.log]
   * @param {Function} [deps.now]
   */
  constructor(deps) {
    this.service = deps.service;
    this.getTab = deps.getTab;
    this.isActiveTab = deps.isActiveTab;
    this.getParentWindow = deps.getParentWindow;
    this.createBubble = deps.createBubble;
    this.getCursor = deps.getCursor || null;
    this.log = deps.log || { info() {}, warn() {} };
    this.now = deps.now || Date.now;

    this.pages = new Map();     // tabId → { prefix, wcId, origin }
    this.chooser = null;        // { id, tabId, wcId, origin, kind, profiles: [{id,title,detail}], timer }
    this.bubble = null;
    this.counter = 0;
    this.lastShowAt = 0;
  }

  _profiles() {
    if (!this.service || !this.service.isAutofillEnabled()) return [];
    return this.service.getProfiles();
  }

  /** Called when a page has loaded. Injects the detection script when it can be useful. */
  attach(wc, tabId, tabData) {
    this.forgetTab(tabId);
    try {
      if (!wc || wc.isDestroyed() || !tabData || tabData.isIncognito) return false;
      const origin = eligibleOrigin(wc.getURL());
      if (!origin || this._profiles().length === 0) return false;
      const prefix = MSG_PREFIX + crypto.randomBytes(12).toString('hex') + ':';
      this.pages.set(tabId, { prefix, wcId: wc.id, origin });
      wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: buildPageScript(prefix) }]).catch(() => {});
      return true;
    } catch (err) {
      this.log.warn('Form autofill could not attach', { error: err.message });
      return false;
    }
  }

  forgetTab(tabId) {
    this.pages.delete(tabId);
    if (this.chooser && this.chooser.tabId === tabId) this.dismiss();
  }

  /** Console messages from the page; true when the message belonged to this feature. */
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
    if (!KINDS.includes(msg.k)) return;
    const tab = this.getTab(tabId);
    if (!tab || tab.isIncognito || !tab.view || !this.isActiveTab(tab)) return;
    const wc = tab.view.webContents;
    if (!wc || wc.isDestroyed() || wc.id !== page.wcId) return;
    if (eligibleOrigin(wc.getURL()) !== page.origin) return;

    const t = this.now();
    if (t - this.lastShowAt < MIN_SHOW_GAP_MS) return;
    const nums = [msg.l, msg.tp, msg.w, msg.h];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return;

    const profiles = this._profiles()
      .filter((p) => valueFor(p, msg.k))
      .map((p) => ({ id: p.id, ...describe(p, msg.k) }));
    if (profiles.length === 0) return;

    const parent = this.getParentWindow(tab);
    if (!parent || parent.isDestroyed()) return;

    this.dismiss();
    this.lastShowAt = t;

    const rect = { l: msg.l, tp: msg.tp, w: Math.max(0, msg.w), h: Math.max(0, msg.h) };
    const placement = placeChooser({
      content: parent.getContentBounds(), view: tab.view.getBounds(), rect, zoom: wc.getZoomFactor(), rows: profiles.length
    });

    const id = 'formfill_' + (++this.counter) + '_' + crypto.randomBytes(6).toString('hex');
    const chooser = { id, tabId, wcId: wc.id, origin: page.origin, kind: msg.k, profiles, timer: null };
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

  _fromBubble(senderWc) {
    return Boolean(this.bubble && !this.bubble.isDestroyed() && senderWc && senderWc === this.bubble.webContents);
  }

  /** What the chooser window shows. */
  getChooser(senderWc) {
    if (!this.chooser || !this._fromBubble(senderWc)) return null;
    return { promptId: this.chooser.id, origin: this.chooser.origin, profiles: this.chooser.profiles.map((p) => ({ ...p })) };
  }

  /** The user clicked a profile. */
  async choose(promptId, profileId, senderWc) {
    const chooser = this.chooser;
    if (!chooser || chooser.id !== promptId || !this._fromBubble(senderWc)) return { success: false, error: 'This suggestion has expired.' };
    if (!chooser.profiles.some((p) => p.id === profileId)) return { success: false, error: 'Unknown profile.' };
    this.dismiss();

    const profile = this.service.getProfileById(profileId);
    if (!profile) return { success: false, error: 'The profile was removed.' };
    const tab = this.getTab(chooser.tabId);
    const wc = tab && !tab.isIncognito && tab.view ? tab.view.webContents : null;
    if (!wc || wc.isDestroyed() || wc.id !== chooser.wcId) return { success: false, error: 'The page is gone.' };
    if (eligibleOrigin(wc.getURL()) !== chooser.origin) return { success: false, error: 'The page changed, nothing was filled in.' };

    let result;
    try {
      const call = 'window.__shmmothFormFill && window.__shmmothFormFill.fill(' +
        JSON.stringify(fillValues(profile)) + ',' + JSON.stringify(chooser.origin) + ')';
      result = await wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: call }]);
    } catch (err) {
      this.log.warn('Form autofill failed', { error: err.message });
      return { success: false, error: 'The page did not accept the profile.' };
    }
    if (!result || !result.ok) return { success: false, error: 'No field to fill.' };
    return { success: true, filled: result.filled };
  }

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

  isChooserOpen() { return Boolean(this.chooser); }
}

module.exports = {
  FormAutofill,
  eligibleOrigin,
  buildPageScript,
  valueFor,
  fillValues,
  describe,
  KINDS,
  MSG_PREFIX,
  ISOLATED_WORLD_ID,
};
