/**
 * PRIVACY CLEANER — privacyCleaner.js (privacy phase 3, 1.5.6)
 *
 * Two cleanups of the normal (not Incognito) profile:
 *
 *   Clear on exit (Settings → Privacy → "When SHMMOTH closes, clear", all off by default). What is ticked — history,
 *   cookies and site data, cached files, the download list — is cleared while the browser closes. The cookies of the
 *   sites in "Keep cookies for" (google.com and youtube.com by default, and every site of the same company, so a Google
 *   sign-in survives) are kept. A run that was cut off (a crash, the power going) is finished at the next start, before
 *   any page opens: the flag `privacyClearPending` is set first and cleared only when everything is done.
 *
 *   Tracker cookie cleanup (like Safari's Intelligent Tracking Prevention, on by default). A site that the Privacy Report
 *   saw as a tracker on other sites, and that you have not used yourself (clicked or typed in) for 7 days, loses its
 *   cookies and site data — the trick of setting a "first-party" cookie while a link bounces through the tracker stops
 *   working after a week. Sites you use, sites of the same company as one you use, the sites in "Keep cookies for" and
 *   the sites where tracking protection is off are never touched. It runs a minute after start and then once a day.
 *
 * Which sites you used (and when) is kept in privacy-interactions.json, on this computer only; Incognito is never noted.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, readJsonRecovering, isPlainObject } = require('../utils/atomicJson');
const { siteOf, siteOfUrl, sameParty } = require('./privacyShield');

const DAY_MS = 24 * 60 * 60 * 1000;
const TRACKER_IDLE_MS = 7 * DAY_MS;
const KEEP_INTERACTIONS_MS = 90 * DAY_MS;
const NOTE_EVERY_MS = 60 * 1000;           // one note per site per minute is plenty
const SITE_STORAGES = ['localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'];
const CLEAR_TYPES = ['history', 'cookies', 'cache', 'downloads'];

class PrivacyCleaner {
  /**
   * @param {object} o
   * @param {Function} o.getSession   () => the normal profile's session
   * @param {object}   o.storage      settings, history (clearHistory), plain values (get / set)
   * @param {Function} [o.getDownloads] () => the download manager (clearCompleted)
   * @param {object}   [o.stats]      PrivacyStats (trackerSites)
   * @param {Function} [o.openSites]  () => the sites open in tabs now (never cleaned)
   * @param {string}   [o.file]       where the interactions are kept
   * @param {Function} [o.now]
   * @param {object}   [o.log]
   */
  constructor(o) {
    this.getSession = o.getSession;
    this.storage = o.storage;
    this.getDownloads = o.getDownloads || (() => null);
    this.stats = o.stats || null;
    this.openSites = o.openSites || (() => []);
    this.file = o.file || null;
    this.now = o.now || Date.now;
    this.log = o.log || null;
    this.interactions = {};               // site → last time you clicked or typed there
    this.lastCleanup = null;              // { at, sites: [...] }
    this._timer = null;
    this._daily = null;
    this._load();
  }

  _settings() {
    try { return this.storage.getSettings() || {}; } catch (_) { return {}; }
  }

  /** The sites whose cookies are never cleared: the "Keep cookies for" list. */
  keptSites() {
    const list = this._settings().clearOnExitKeepSites;
    return Array.isArray(list) ? list.map((s) => siteOf(String(s).toLowerCase().replace(/^\.+/, ''))).filter(Boolean) : [];
  }

  _isKept(site, kept = this.keptSites()) {
    return kept.some((k) => k === site || sameParty(k, site));
  }

  // ─── interactions ───

  /** You clicked or typed on a page of `url` (tabs.js, normal windows only). */
  noteInteraction(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return;          // web pages only (not mtc://, file:, about:)
    const site = siteOfUrl(url);
    if (!site) return;
    const now = this.now();
    if (now - (this.interactions[site] || 0) < NOTE_EVERY_MS) return;
    this.interactions[site] = now;
    this._saveSoon();
  }

  /** Used yourself within the last 7 days: the site, or a site of the same company. */
  _recentlyUsed(site, now) {
    for (const [s, at] of Object.entries(this.interactions)) {
      if (now - at <= TRACKER_IDLE_MS && (s === site || sameParty(s, site))) return true;
    }
    return false;
  }

  // ─── clear on exit ───

  /** What "When SHMMOTH closes, clear" asks for: { history, cookies, cache, downloads } (all false by default). */
  exitChoices() {
    const c = this._settings().clearOnExit;
    const out = {};
    for (const k of CLEAR_TYPES) out[k] = Boolean(c && c[k]);
    return out;
  }

  /** Runs while the browser closes (main.js before-quit). The pending flag makes the next start finish it if cut off. */
  async clearOnExit() {
    const choices = this.exitChoices();
    if (!CLEAR_TYPES.some((k) => choices[k])) return { cleared: false };
    this._setPending(choices);
    const done = await this._clear(choices);
    this._setPending(null);
    return done;
  }

  /** At start, before any page: a clear-on-exit that was cut off is finished now. */
  async finishPendingAtStart() {
    let pending = null;
    try { pending = this.storage.get('privacyClearPending', null); } catch (_) { pending = null; }
    if (!isPlainObject(pending)) return { cleared: false };
    const done = await this._clear(pending);
    this._setPending(null);
    if (this.log) this.log.info('Finished clearing data that was cut off when the browser last closed', { types: Object.keys(pending).filter((k) => pending[k]) });
    return done;
  }

  _setPending(choices) {
    try { this.storage.set('privacyClearPending', choices); } catch (_) { /* best effort */ }
  }

  async _clear(choices) {
    const result = { cleared: true };
    const sess = this.getSession();
    if (choices.history) {
      try { result.history = this.storage.clearHistory(); } catch (_) { result.history = false; }
    }
    if (choices.downloads) {
      try { const d = this.getDownloads(); result.downloads = d ? d.clearCompleted() : 0; } catch (_) { result.downloads = false; }
    }
    if (choices.cookies && sess) {
      result.cookies = await this._removeCookies(sess, () => true);
      try { await sess.clearStorageData({ storages: SITE_STORAGES }); } catch (_) { /* best effort */ }
    }
    if (choices.cache && sess) {
      try { await sess.clearCache(); await sess.clearStorageData({ storages: ['cachestorage', 'shadercache'] }); result.cache = true; } catch (_) { result.cache = false; }
    }
    if (sess && sess.cookies && typeof sess.cookies.flushStore === 'function') {
      try { await sess.cookies.flushStore(); } catch (_) { /* best effort */ }
    }
    if (this.log) this.log.info('Cleared browsing data as the browser closed', { types: CLEAR_TYPES.filter((k) => choices[k]) });
    return result;
  }

  /**
   * Removes every cookie whose site `pick(site)` approves, except the kept sites. @returns {Promise<string[]>} the sites
   * that lost cookies
   */
  async _removeCookies(sess, pick) {
    const kept = this.keptSites();
    let cookies = [];
    try { cookies = await sess.cookies.get({}); } catch (_) { return []; }
    const sites = new Set();
    for (const c of cookies) {
      const host = String(c.domain || '').replace(/^\.+/, '');
      const site = siteOf(host);
      if (!site || this._isKept(site, kept) || !pick(site)) continue;
      const url = `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`;
      try { await sess.cookies.remove(url, c.name); sites.add(site); } catch (_) { /* gone already */ }
    }
    return [...sites];
  }

  // ─── tracker cookie cleanup ───

  /**
   * Clears the cookies and site data of trackers you have not used for 7 days. @returns {Promise<string[]>} their sites
   */
  async cleanTrackers() {
    if (this._settings().trackerCookieCleanup === false) return [];
    const sess = this.getSession();
    if (!sess || !this.stats) return [];
    const now = this.now();
    const trackers = this.stats.trackerSites();
    const allowed = new Set((this._settings().privacyCookieAllowSites || []).map((s) => siteOf(String(s))));
    const open = new Set((this.openSites() || []).filter(Boolean));
    const pick = (site) => trackers.has(site) && !allowed.has(site) && !open.has(site) &&
      ![...open].some((o) => sameParty(o, site)) && !this._recentlyUsed(site, now);
    const sites = await this._removeCookies(sess, pick);
    for (const site of sites) {
      for (const origin of [`https://${site}`, `https://www.${site}`, `http://${site}`]) {
        try { await sess.clearStorageData({ origin, storages: SITE_STORAGES }); } catch (_) { /* best effort */ }
      }
    }
    if (sess.cookies && typeof sess.cookies.flushStore === 'function') { try { await sess.cookies.flushStore(); } catch (_) {} }
    this.lastCleanup = { at: now, sites };
    this._saveSoon();
    if (sites.length && this.log) this.log.info('Removed the cookies of trackers not used for 7 days', { count: sites.length });
    return sites;
  }

  /** A minute after start, then once a day. */
  start({ firstDelayMs = 60 * 1000 } = {}) {
    const run = () => { this.cleanTrackers().catch(() => {}); };
    this._first = setTimeout(run, firstDelayMs);
    this._daily = setInterval(run, DAY_MS);
    for (const t of [this._first, this._daily]) if (t && t.unref) t.unref();
  }

  stop() {
    clearTimeout(this._first);
    clearInterval(this._daily);
  }

  // ─── kept on disk ───

  _load() {
    if (!this.file) return;
    try {
      const res = readJsonRecovering(this.file, { validate: isPlainObject });
      const data = res && res.data;
      if (!data) return;
      const oldest = this.now() - KEEP_INTERACTIONS_MS;
      for (const [site, at] of Object.entries(data.interactions || {})) {
        if (typeof site === 'string' && Number.isFinite(at) && at >= oldest) this.interactions[site] = at;
      }
      if (isPlainObject(data.lastCleanup) && Array.isArray(data.lastCleanup.sites)) this.lastCleanup = data.lastCleanup;
    } catch (_) { /* start again */ }
  }

  _saveSoon() {
    if (!this.file || this._timer) return;
    this._timer = setTimeout(() => this.flush(), 5000);
    if (this._timer.unref) this._timer.unref();
  }

  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this.file) return;
    try {
      const oldest = this.now() - KEEP_INTERACTIONS_MS;
      for (const [site, at] of Object.entries(this.interactions)) if (at < oldest) delete this.interactions[site];
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      writeJsonAtomic(this.file, { version: 1, interactions: this.interactions, lastCleanup: this.lastCleanup }, { validate: isPlainObject });
    } catch (_) { /* a convenience, never a reason to fail */ }
  }
}

module.exports = { PrivacyCleaner, TRACKER_IDLE_MS, CLEAR_TYPES };
