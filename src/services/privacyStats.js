/**
 * Privacy Report (1.5.1) — what the shield stopped, like Safari's report: the last 30 days, kept on this computer only.
 *
 * Fed by the request hub (requests the ad blocker blocked) and the privacy shield (cross-site cookies withheld, tracking
 * removed from links, pages upgraded to https). Per day: how many of each, which tracker sites (with the sites they
 * were found on) and which sites carried trackers. Incognito windows are never counted.
 *
 * Also counts per tab what was stopped on the page it shows now (the number on the shield), reset when the tab opens
 * another page.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, readJsonRecovering, isPlainObject } = require('../utils/atomicJson');

const KEEP_DAYS = 30;
const MAX_TRACKERS_PER_DAY = 500;
const MAX_SITES_PER_TRACKER = 100;
const MAX_SITES_PER_DAY = 500;
const SAVE_DELAY_MS = 10000;

/** Who is behind a tracker site (the best known ones; everything else is shown by its own name). */
const COMPANIES = {
  Google: ['doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'googletagmanager.com', 'googleadservices.com',
    'googletagservices.com', 'adservice.google.com', 'app-measurement.com', 'googleoptimize.com', 'gstatic.com', 'google.com'],
  Meta: ['facebook.net', 'facebook.com', 'fbcdn.net', 'instagram.com'],
  Amazon: ['amazon-adsystem.com', 'assoc-amazon.com'],
  Microsoft: ['clarity.ms', 'bing.com', 'msn.com', 'live.com'],
  'X (Twitter)': ['ads-twitter.com', 'twitter.com', 'x.com', 't.co'],
  LinkedIn: ['licdn.com', 'linkedin.com'],
  TikTok: ['tiktok.com', 'tiktokw.us', 'byteoversea.com'],
  Criteo: ['criteo.com', 'criteo.net'],
  Taboola: ['taboola.com'],
  Outbrain: ['outbrain.com'],
  'Microsoft Xandr': ['adnxs.com'],
  PubMatic: ['pubmatic.com'],
  Magnite: ['rubiconproject.com'],
  OpenX: ['openx.net'],
  'Index Exchange': ['casalemedia.com'],
  Hotjar: ['hotjar.com'],
  Comscore: ['scorecardresearch.com'],
  Quantcast: ['quantserve.com', 'quantcount.com'],
  Yandex: ['yandex.ru', 'mc.yandex.ru', 'yandex.net'],
  Adobe: ['demdex.net', 'omtrdc.net', 'everesttech.net'],
  Oracle: ['bluekai.com', 'addthis.com'],
  'Media.net': ['media.net'],
  InMobi: ['inmobi.com'],
  AppsFlyer: ['appsflyer.com'],
  Branch: ['branch.io'],
  Mixpanel: ['mixpanel.com'],
  Segment: ['segment.io', 'segment.com'],
  'New Relic': ['nr-data.net', 'newrelic.com'],
  Snap: ['snapchat.com', 'sc-static.net'],
  Pinterest: ['pinimg.com', 'pinterest.com'],
  Yahoo: ['yahoo.com', 'yimg.com', 'adtech.com'],
  'Trade Desk': ['adsrvr.org']
};
const COMPANY_OF = new Map();
for (const [company, sites] of Object.entries(COMPANIES)) for (const s of sites) COMPANY_OF.set(s, company);

function companyOf(site) {
  return COMPANY_OF.get(site) || '';
}

function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyDay() {
  return { blocked: 0, cookies: 0, params: 0, https: 0, trackers: {}, sites: {} };
}

class PrivacyStats {
  /**
   * @param {object} [opts]
   * @param {string}   [opts.file]      where the report is kept (default: none, in memory only)
   * @param {Function} [opts.now]
   * @param {Function} [opts.onPageCount] (wcId, counts) => void — the number on the shield changed
   */
  constructor(opts = {}) {
    this.file = opts.file || null;
    this.now = opts.now || Date.now;
    this.onPageCount = opts.onPageCount || null;
    this.days = {};
    this.pages = new Map();             // webContents id → { blocked, cookies }
    this._timer = null;
    this._load();
  }

  _load() {
    if (!this.file) return;
    try {
      const res = readJsonRecovering(this.file, { validate: isPlainObject });
      if (res.data && isPlainObject(res.data.days)) this.days = res.data.days;
    } catch (_) { this.days = {}; }
    this._prune();
  }

  _prune() {
    const oldest = dayKey(this.now() - (KEEP_DAYS - 1) * 86400000);
    for (const k of Object.keys(this.days)) if (k < oldest) delete this.days[k];
  }

  _saveSoon() {
    if (!this.file || this._timer) return;
    this._timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    if (this._timer.unref) this._timer.unref();
  }

  /** Writes the report now (the browser is closing). */
  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      writeJsonAtomic(this.file, { version: 1, days: this.days }, { validate: isPlainObject });
    } catch (_) { /* the report is a convenience, never a reason to fail */ }
  }

  /**
   * Something was stopped. kind: 'blocked' (a request the ad blocker refused) | 'cookies' (cookies withheld from a
   * cross-site request) | 'params' (tracking removed from a link) | 'https' (a page upgraded).
   * `tracker`: the site of the request (blocked / cookies); `site`: the site of the page; `wcId`: the tab.
   */
  record({ kind, tracker = '', site = '', wcId = null, incognito = false }) {
    if (!['blocked', 'cookies', 'params', 'https'].includes(kind)) return;
    if (wcId !== null && wcId !== undefined && (kind === 'blocked' || kind === 'cookies')) {
      const page = this.pages.get(wcId) || { blocked: 0, cookies: 0 };
      page[kind]++;
      this.pages.set(wcId, page);
      if (this.onPageCount) { try { this.onPageCount(wcId, { ...page }); } catch (_) { /* display only */ } }
    }
    if (incognito) return;                                    // private windows leave no trace, not even here

    const key = dayKey(this.now());
    if (!this.days[key]) { this.days[key] = emptyDay(); this._prune(); }
    const day = this.days[key];
    day[kind]++;
    if (tracker && (kind === 'blocked' || kind === 'cookies')) {
      let t = day.trackers[tracker];
      if (!t && Object.keys(day.trackers).length < MAX_TRACKERS_PER_DAY) t = day.trackers[tracker] = { n: 0, sites: {} };
      if (t) {
        t.n++;
        if (site && site !== tracker && (t.sites[site] || Object.keys(t.sites).length < MAX_SITES_PER_TRACKER)) t.sites[site] = (t.sites[site] || 0) + 1;
      }
      if (site && site !== tracker) {
        if (!day.sites[site] && Object.keys(day.sites).length >= MAX_SITES_PER_DAY) { /* full for today */ } else {
          day.sites[site] = day.sites[site] || {};
          day.sites[site][tracker] = 1;
        }
      }
    }
    this._saveSoon();
  }

  /** The tab opened another page: its shield count starts again. */
  resetPage(wcId) {
    this.pages.delete(wcId);
    if (this.onPageCount) { try { this.onPageCount(wcId, { blocked: 0, cookies: 0 }); } catch (_) { /* display only */ } }
  }

  /** The tab was closed. */
  forgetPage(wcId) { this.pages.delete(wcId); }

  pageCount(wcId) {
    const p = this.pages.get(wcId);
    return p ? { ...p } : { blocked: 0, cookies: 0 };
  }

  /** Every site seen as a tracker in the last 30 days (blocked, or refused its cookies on another site). */
  trackerSites() {
    this._prune();
    const out = new Set();
    for (const day of Object.values(this.days)) for (const t of Object.keys(day.trackers || {})) out.add(t);
    return out;
  }

  /** The report of the last 30 days. */
  report() {
    this._prune();
    const totals = { blocked: 0, cookies: 0, params: 0, https: 0 };
    const trackers = new Map();          // site → { count, sites:Set }
    const sites = new Map();             // site → Set(trackers)
    let since = null;
    for (const [key, day] of Object.entries(this.days)) {
      if (!since || key < since) since = key;
      for (const k of Object.keys(totals)) totals[k] += Number(day[k]) || 0;
      for (const [tsite, t] of Object.entries(day.trackers || {})) {
        const e = trackers.get(tsite) || { count: 0, sites: new Set() };
        e.count += Number(t.n) || 0;
        for (const s of Object.keys(t.sites || {})) e.sites.add(s);
        trackers.set(tsite, e);
      }
      for (const [s, ts] of Object.entries(day.sites || {})) {
        const set = sites.get(s) || new Set();
        for (const tr of Object.keys(ts || {})) set.add(tr);
        sites.set(s, set);
      }
    }
    const topTrackers = [...trackers.entries()]
      .map(([site, e]) => ({ site, company: companyOf(site), count: e.count, sites: e.sites.size, examples: [...e.sites].slice(0, 3) }))
      .sort((a, b) => b.sites - a.sites || b.count - a.count || a.site.localeCompare(b.site))
      .slice(0, 20);
    const topSites = [...sites.entries()]
      .map(([site, set]) => ({ site, trackers: set.size }))
      .sort((a, b) => b.trackers - a.trackers || a.site.localeCompare(b.site))
      .slice(0, 10);
    const companies = new Set([...trackers.keys()].map((s) => companyOf(s) || s));
    return {
      days: KEEP_DAYS,
      since,
      totals: { ...totals, trackers: trackers.size, companies: companies.size, sitesWithTrackers: sites.size },
      topTrackers,
      topSites
    };
  }

  clear() {
    this.days = {};
    this.flush();
  }
}

module.exports = { PrivacyStats, companyOf, dayKey, KEEP_DAYS };
