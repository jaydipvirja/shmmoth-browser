/**
 * One listener per session.webRequest event, shared by everything that needs it.
 *
 * Electron keeps ONE listener per event and session: a second `webRequest.onBeforeRequest(…)` silently replaces the
 * first (checked: the second of two listeners is the only one called). The ad blocker owns onBeforeRequest and
 * onHeadersReceived, Google sign-in owns onBeforeSendHeaders, and the privacy shield (1.5.0) needs all three.
 *
 * install(session) replaces the session's on… methods for the three events with versions that keep the old behaviour
 * for the code that already calls them (one "legacy" slot per event, a new call replaces the previous one, null
 * removes it, its URL filter is honoured), while named handlers added with add() run alongside:
 *   - onBeforeRequest      named handlers first: the first that cancels or redirects decides; then the legacy listener
 *   - onBeforeSendHeaders  the request headers go through every named handler, then through the legacy listener
 *   - onHeadersReceived    the same with the response headers
 * Named handlers are synchronous: (details) => result | null, with result as for an Electron listener's callback.
 */
'use strict';

const EVENTS = ['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived'];
const HUB = Symbol('shmmothWebRequestHub');

/** Does `url` match one Chrome-style match pattern ("<all_urls>", "*://*.google.com/*", "https://x.com/path*")? */
function matchesPattern(pattern, url) {
  if (pattern === '<all_urls>') return true;
  const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(pattern);
  if (!m) return false;
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  if (m[1] === '*' ? !['http', 'https', 'ws', 'wss'].includes(scheme) : m[1].toLowerCase() !== scheme) return false;
  const host = m[2].toLowerCase().replace(/:\d+$/, '');
  const h = u.hostname.toLowerCase();
  if (host !== '*' && host !== '') {
    if (host.startsWith('*.')) { const base = host.slice(2); if (h !== base && !h.endsWith('.' + base)) return false; }
    else if (h !== host) return false;
  }
  const path = m[3] || '/*';
  const re = new RegExp('^' + path.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(u.pathname + u.search);
}

function matchesFilter(filter, details) {
  if (!filter) return true;
  if (Array.isArray(filter.types) && filter.types.length && !filter.types.includes(details.resourceType)) return false;
  const urls = Array.isArray(filter.urls) && filter.urls.length ? filter.urls : ['<all_urls>'];
  return urls.some((p) => matchesPattern(p, details.url));
}

class WebRequestHub {
  constructor(webRequest) {
    this.webRequest = webRequest;
    this.original = {};
    this.legacy = {};                 // event → { filter, listener } | null
    this.named = {};                  // event → Map(name → handler)
    this.blockedObservers = [];       // (details, result) => void — the legacy listener (ad blocker) blocked a request
    for (const ev of EVENTS) {
      this.original[ev] = webRequest[ev].bind(webRequest);
      this.legacy[ev] = null;
      this.named[ev] = new Map();
      webRequest[ev] = (...args) => this._setLegacy(ev, args);
    }
  }

  /** (Re)places the named handler `name` of `event`. */
  add(event, name, handler) {
    if (!EVENTS.includes(event) || typeof handler !== 'function') throw new Error('Unknown event or handler: ' + event);
    this.named[event].set(name, handler);
    this._sync(event);
  }

  /** `fn(details, result)` whenever the legacy onBeforeRequest listener (the ad blocker) cancels or redirects a request. */
  onLegacyBlocked(fn) {
    if (typeof fn === 'function') this.blockedObservers.push(fn);
  }

  remove(event, name) {
    if (!EVENTS.includes(event)) return;
    this.named[event].delete(name);
    this._sync(event);
  }

  // what Electron's own on…([filter,] listener) does: one listener, the newest wins, null removes it
  _setLegacy(event, args) {
    let filter = null;
    let listener = null;
    if (args.length >= 2) { filter = args[0]; listener = args[1]; }
    else listener = args[0];
    this.legacy[event] = typeof listener === 'function' ? { filter, listener } : null;
    this._sync(event);
  }

  _sync(event) {
    const active = this.legacy[event] || this.named[event].size > 0;
    if (!active) { this.original[event](null); return; }
    this.original[event]({ urls: ['<all_urls>'] }, (details, callback) => this._dispatch(event, details, callback));
  }

  _dispatch(event, details, callback) {
    const legacy = this.legacy[event];
    const useLegacy = legacy && matchesFilter(legacy.filter, details);

    if (event === 'onBeforeRequest') {
      for (const handler of this.named[event].values()) {
        let r = null;
        try { r = handler(details); } catch (_) { r = null; }
        if (r && (r.cancel || r.redirectURL)) return callback(r);
      }
      if (!useLegacy) return callback({});
      if (!this.blockedObservers.length) return legacy.listener(details, callback);
      return legacy.listener(details, (res) => {
        if (res && (res.cancel || res.redirectURL)) {
          for (const fn of this.blockedObservers) { try { fn(details, res); } catch (_) { /* counting only */ } }
        }
        callback(res);
      });
    }

    const key = event === 'onBeforeSendHeaders' ? 'requestHeaders' : 'responseHeaders';
    let headers = details[key];
    let changed = false;
    for (const handler of this.named[event].values()) {
      let r = null;
      try { r = handler({ ...details, [key]: headers }); } catch (_) { r = null; }
      if (!r) continue;
      if (r.cancel) return callback(r);
      if (r[key]) { headers = r[key]; changed = true; }
    }
    if (!useLegacy) return callback(changed ? { [key]: headers } : {});
    let answered = false;
    legacy.listener({ ...details, [key]: headers }, (res) => {
      if (answered) return;
      answered = true;
      const r = res || {};
      if (r.cancel) return callback(r);
      if (r[key]) return callback(r);
      return callback(changed ? { ...r, [key]: headers } : r);
    });
  }
}

/** The hub of `session` (installed on first use). */
function install(session) {
  if (!session || !session.webRequest) return null;
  const wr = session.webRequest;
  if (!wr[HUB]) Object.defineProperty(wr, HUB, { value: new WebRequestHub(wr) });
  return wr[HUB];
}

module.exports = { install, matchesPattern, matchesFilter, EVENTS };
