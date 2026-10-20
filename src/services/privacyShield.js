/**
 * Privacy shield (1.5.0) — the parts of Safari's privacy protection that a browser can do on its own:
 *
 *   - Cross-site cookies are blocked: a request to another site than the page's own (by registrable domain, so
 *     www.example.com and shop.example.com are one site) neither sends nor sets cookies. Sites of one owner count as one
 *     (google.com / youtube.com …), and the user can allow them for a site from the shield.
 *   - Link tracking protection: known click identifiers (utm_…, fbclid, gclid, igshid …) are removed from the address
 *     of a page before it is requested.
 *   - Global Privacy Control: every request says "Sec-GPC: 1" and pages see navigator.globalPrivacyControl === true.
 *   - Referrer trimming: another site only learns the site a request comes from (https://example.com/), never the
 *     page, whatever referrer policy the page set (Chromium's own default already does this for most pages).
 *   - HTTPS-Only: a page asked for over http:// is asked for over https://. When the site has no working https, the
 *     error page says so and offers to continue over http (remembered for this site until the browser is closed).
 *     Local addresses (IPs, localhost, single-word names, .local / .lan / .internal / .home) and the names reserved
 *     for tests (.test / .example / .invalid) are left alone.
 *
 * Everything runs through services/webRequestHub.js, next to the ad blocker and the Google sign-in rules.
 */
'use strict';

const crypto = require('crypto');
const { getDomain } = require('tldts-experimental');
const fingerprintShield = require('./fingerprintShield');

/** Query parameters that only identify a click or a campaign (removed from page addresses). */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name', 'utm_cid', 'utm_reader',
  'utm_referrer', 'utm_social', 'utm_social-type', 'utm_brand', 'utm_place', 'utm_pubreferrer', 'utm_swu', 'utm_viz_id',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid', 'msclkid', 'yclid', 'ysclid',
  'twclid', 'ttclid', 'li_fat_id', 'igshid', 'igsh', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp',
  'hsctatracking', 'mkt_tok', 'oly_anon_id', 'oly_enc_id', 'vero_conv', 'vero_id', 'rb_clickid', 's_cid', '_openstat',
  'wickedid', 'ml_subscriber', 'ml_subscriber_hash', 'epik', 'srsltid', 'si_src'
]);
/** Parameters that are tracking only on some sites. */
const SITE_PARAMS = [
  { sites: ['youtube.com', 'youtu.be', 'spotify.com'], params: ['si'] },
  { sites: ['twitter.com', 'x.com'], params: ['ref_src', 'ref_url', 't', 's'] },
  { sites: ['instagram.com'], params: ['img_index'] }
];

/** Sites of one owner: cookies between them are not cross-site tracking (sign-in across them keeps working). */
const RELATED = [
  ['google.com', 'youtube.com', 'gstatic.com', 'googleusercontent.com', 'googleapis.com', 'ggpht.com', 'ytimg.com', 'googlevideo.com',
    'google.co.in', 'gmail.com', 'blogger.com', 'withgoogle.com', 'youtube-nocookie.com', 'recaptcha.net'],
  ['microsoft.com', 'live.com', 'microsoftonline.com', 'office.com', 'office365.com', 'sharepoint.com', 'outlook.com', 'bing.com',
    'msn.com', 'skype.com', 'xbox.com', 'azure.com', 'windows.net', 'msauth.net', 'msftauth.net'],
  ['apple.com', 'icloud.com', 'apple-cloudkit.com', 'mzstatic.com'],
  ['amazon.com', 'amazon.in', 'media-amazon.com', 'ssl-images-amazon.com', 'amazonpay.in', 'primevideo.com'],
  ['facebook.com', 'fbcdn.net', 'instagram.com', 'cdninstagram.com', 'whatsapp.com', 'messenger.com']
];
const GROUP_OF = new Map();
RELATED.forEach((group, i) => group.forEach((site) => GROUP_OF.set(site, i)));

// names of this network, and the names reserved for tests and examples (RFC 6761 — they can never have a public
// certificate, so an upgrade could only fail)
const SIGN_IN_HOSTS = new Set(['accounts.google.com', 'accounts.youtube.com']);

const LOCAL_SUFFIXES = ['.local', '.lan', '.internal', '.home', '.localhost', '.home.arpa', '.test', '.example', '.invalid'];
const HTTPS_DOWNGRADE_WINDOW_MS = 15000;

/** The site (registrable domain) of a host name; the host itself for IPs, localhost and the like. */
function siteOf(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return '';
  return getDomain(h, { allowPrivateDomains: true }) || h;
}

function siteOfUrl(url) {
  try { return siteOf(new URL(url).hostname); } catch (_) { return ''; }
}

/** One site, or sites of one owner? */
function sameParty(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ga = GROUP_OF.get(a);
  return ga !== undefined && ga === GROUP_OF.get(b);
}

/** Never upgraded to https: addresses that only exist on this computer or network. */
function isLocalHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || h === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return true;      // IPv4 / IPv6
  if (!h.includes('.')) return true;                                           // "router", "nas"
  return LOCAL_SUFFIXES.some((s) => h.endsWith(s));
}

/** `url` without its tracking parameters, or null when there is nothing to remove. */
function stripTrackingParams(url) {
  let u;
  try { u = new URL(url); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.search) return null;
  const site = siteOf(u.hostname);
  const extra = new Set();
  for (const rule of SITE_PARAMS) if (rule.sites.includes(site)) rule.params.forEach((p) => extra.add(p));
  let removed = false;
  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || extra.has(k)) { u.searchParams.delete(key); removed = true; }
  }
  if (!removed) return null;
  let out = u.toString();
  if (!u.search) out = out.replace(/\?(?=#|$)/, '');
  return out;
}

function headerName(headers, name) {
  const lower = name.toLowerCase();
  return Object.keys(headers || {}).find((k) => k.toLowerCase() === lower);
}

class PrivacyShield {
  /**
   * @param {object} deps
   * @param {Function} deps.getSettings     () => settings
   * @param {Function} [deps.updateSettings] (delta) => settings
   * @param {object}   [deps.log]
   * @param {Function} [deps.now]
   */
  constructor(deps = {}) {
    this.getSettings = deps.getSettings || (() => ({}));
    this.stats = deps.stats || null;    // PrivacyStats (the Privacy Report and the shield's count)
    this.updateSettings = deps.updateSettings || null;
    this.log = deps.log || { info() {}, warn() {} };
    this.now = deps.now || Date.now;
    this.httpAllowed = new Set();       // "partition|host": continue over http (until the browser is closed)
    this.secret = crypto.randomBytes(16).toString('hex');   // fingerprint seeds and marks: new every browser session
    this.upgrades = new Map();          // webContents id → { host, httpUrl, httpsUrl, at }
    this.counters = { cookiesBlocked: 0, paramsRemoved: 0, upgraded: 0 };
  }

  _on(key) { return this.getSettings()[key] !== false; }

  /**
   * What a frame's page gets before its own scripts run (preload-privacy.js asks): the scripts to run in it — GPC's
   * navigator.globalPrivacyControl, and fingerprinting protection with this site's seed. `topUrl`: the tab's page.
   * Sites where the user relaxed tracking protection (shield) get no fingerprinting protection either.
   */
  pageScripts(topUrl, partition = 'default') {
    if (!/^https?:/i.test(String(topUrl || ''))) return [];
    const scripts = [];
    if (this._on('privacyGpc')) {
      scripts.push("try{Object.defineProperty(Navigator.prototype,'globalPrivacyControl',{get:function(){return true},configurable:true,enumerable:true})}catch(e){}");
    }
    const site = siteOfUrl(topUrl);
    // Google's sign-in pages measure the browser to tell people from bots: they get the real values (a changed canvas
    // there could make Google refuse the sign-in — see services/googleSignIn.js)
    let host = '';
    try { host = new URL(topUrl).hostname.toLowerCase(); } catch (_) { host = ''; }
    const signIn = SIGN_IN_HOSTS.has(host);
    if (site && !signIn && this._on('privacyFingerprintProtection') && !this.allowsCrossSiteCookies(site)) {
      scripts.push(fingerprintShield.buildPageScript(fingerprintShield.seedFor(this.secret, partition, site), this.secret));
    }
    return scripts;
  }

  /** WebRTC: only the default route's public address, never the local network's addresses (unless switched off). */
  webRtcPolicy() {
    return this._on('privacyFingerprintProtection') ? 'default_public_interface_only' : 'default';
  }

  /** Is the page's own site allowed cross-site cookies (from the shield)? */
  allowsCrossSiteCookies(site) {
    const list = this.getSettings().privacyCookieAllowSites;
    return Array.isArray(list) && list.includes(site);
  }

  setCrossSiteCookiesAllowed(site, allowed) {
    if (!site || !this.updateSettings) return false;
    const list = new Set(Array.isArray(this.getSettings().privacyCookieAllowSites) ? this.getSettings().privacyCookieAllowSites : []);
    if (allowed) list.add(site); else list.delete(site);
    this.updateSettings({ privacyCookieAllowSites: [...list].sort() });
    return true;
  }

  /** Hooks the shield into a session's request hub. `partition`: 'default' | 'incognito'. */
  attach(hub, partition = 'default') {
    if (!hub) return;
    hub.add('onBeforeRequest', 'privacy', (d) => this.onBeforeRequest(d, partition));
    hub.add('onBeforeSendHeaders', 'privacy', (d) => this.onBeforeSendHeaders(d, partition));
    hub.add('onHeadersReceived', 'privacy', (d) => this.onHeadersReceived(d, partition));
    // requests the ad blocker refused, for the Privacy Report and the shield's count
    hub.onLegacyBlocked((d) => this._record('blocked', d, partition));
  }

  _record(kind, details, partition, site = null) {
    if (!this.stats) return;
    const wc = details.webContents;
    const top = details.resourceType === 'mainFrame' ? details.url : this._topUrl(details);
    this.stats.record({
      kind,
      tracker: kind === 'blocked' || kind === 'cookies' ? siteOfUrl(details.url) : '',
      site: site || siteOfUrl(top),
      wcId: wc && typeof wc.id === 'number' ? wc.id : null,
      incognito: partition === 'incognito'
    });
  }

  // ── which page a request belongs to ──
  _topUrl(details) {
    try {
      const wc = details.webContents;
      if (wc && !(wc.isDestroyed && wc.isDestroyed())) return wc.getURL() || '';
    } catch (_) { /* gone */ }
    return '';
  }

  /** The page's site when `details` is a cross-site request of a web page (null otherwise). */
  _crossSite(details) {
    if (details.resourceType === 'mainFrame') return null;
    const top = this._topUrl(details);
    if (!/^https?:/i.test(top)) return null;                  // browser pages, downloads, the Turbo engine …
    const topSite = siteOfUrl(top);
    const reqSite = siteOfUrl(details.url);
    if (!topSite || !reqSite || sameParty(topSite, reqSite)) return null;
    return topSite;
  }

  _cookiesBlockedFor(details) {
    if (!this._on('privacyBlockThirdPartyCookies')) return false;
    const topSite = this._crossSite(details);
    return Boolean(topSite) && !this.allowsCrossSiteCookies(topSite);
  }

  // ── onBeforeRequest: HTTPS-Only, link tracking protection ──
  onBeforeRequest(details, partition) {
    if (details.resourceType !== 'mainFrame' || (details.method && details.method !== 'GET')) return null;
    let u;
    try { u = new URL(details.url); } catch (_) { return null; }

    if (u.protocol === 'http:' && this._on('privacyHttpsOnly')) {
      const r = this._httpsOnly(details, u, partition);
      if (r) return r;
    }
    if (this._on('privacyStripTrackingParams')) {
      const clean = stripTrackingParams(details.url);
      if (clean && clean !== details.url) {
        this.counters.paramsRemoved++;
        this._record('params', details, partition, siteOfUrl(details.url));
        return { redirectURL: clean };
      }
    }
    return null;
  }

  _httpsOnly(details, u, partition) {
    const host = u.hostname.toLowerCase();
    if (isLocalHost(host) || this.httpAllowed.has(partition + '|' + host)) return null;
    const wcId = details.webContents && details.webContents.id;
    // "Continue to the site" on the error page that said the site has no https
    const top = this._topUrl(details);
    if (/^mtc:\/\/error\//i.test(top) || /^mtc:\/\/error\?/i.test(top)) {
      try {
        const p = new URL(top).searchParams;
        if (p.get('https') === '1' && p.get('url') === details.url) {
          this.httpAllowed.add(partition + '|' + host);
          return null;
        }
      } catch (_) { /* not that page */ }
    }
    // the site sent us back to http right after the upgrade, before the https page ever opened: it has no https of its
    // own, do not loop (a later http link on a site whose https page did open is upgraded as usual)
    const last = wcId !== undefined ? this.upgrades.get(wcId) : null;
    if (last && last.host === host && !last.committed && this.now() - last.at < HTTPS_DOWNGRADE_WINDOW_MS && last.httpUrl !== details.url) {
      this.httpAllowed.add(partition + '|' + host);
      this.log.info('HTTPS-Only: the site redirects back to http, allowed for this session', { host });
      return null;
    }
    const httpsUrl = 'https://' + details.url.slice('http://'.length);
    if (wcId !== undefined) this.upgrades.set(wcId, { host, httpUrl: details.url, httpsUrl, at: this.now() });
    this.counters.upgraded++;
    this._record('https', details, partition, siteOf(host));
    return { redirectURL: httpsUrl };
  }

  /**
   * A page that failed in tab `wcId`: when it was an https upgrade of an http address, the http address (for the
   * error page's "continue" button), else null.
   */
  httpsFallbackFor(wcId, failedUrl, errorCode) {
    const last = this.upgrades.get(wcId);
    if (!last || errorCode === -3) return null;               // -3: aborted (a download, a new navigation)
    if (errorCode === -105 || errorCode === -106 || errorCode === -21) return null;   // no such host / offline: http fails too
    let failedHost = '';
    try { failedHost = new URL(failedUrl).hostname.toLowerCase(); } catch (_) { return null; }
    if (failedHost !== last.host || !/^https:/i.test(failedUrl)) return null;
    return last.httpUrl;
  }

  /** A page opened in tab `wcId`: an upgraded https page that opened is a site with working https. */
  noteNavigation(wcId, url) {
    const last = this.upgrades.get(wcId);
    if (!last) return;
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' && u.hostname.toLowerCase() === last.host) last.committed = true;
    } catch (_) { /* not a web page */ }
  }

  forgetTab(wcId) { this.upgrades.delete(wcId); }

  // ── onBeforeSendHeaders: GPC, cookies, referrer ──
  onBeforeSendHeaders(details, partition = 'default') {
    const headers = { ...(details.requestHeaders || {}) };
    let changed = false;
    if (this._on('privacyGpc') && !headerName(headers, 'Sec-GPC')) { headers['Sec-GPC'] = '1'; changed = true; }

    if (this._cookiesBlockedFor(details)) {
      const name = headerName(headers, 'Cookie');
      if (name) { delete headers[name]; changed = true; this.counters.cookiesBlocked++; this._record('cookies', details, partition); }
    }

    const refName = headerName(headers, 'Referer');
    if (refName) {
      let ref;
      try { ref = new URL(headers[refName]); } catch (_) { ref = null; }
      if (ref && /^https?:$/.test(ref.protocol) && siteOf(ref.hostname) !== siteOfUrl(details.url)) {
        const origin = ref.origin + '/';
        if (headers[refName] !== origin) { headers[refName] = origin; changed = true; }
      }
    }
    return changed ? { requestHeaders: headers } : null;
  }

  // ── onHeadersReceived: cookies ──
  onHeadersReceived(details, partition = 'default') {
    if (!this._cookiesBlockedFor(details)) return null;
    const headers = details.responseHeaders || {};
    const names = Object.keys(headers).filter((k) => k.toLowerCase() === 'set-cookie');
    if (!names.length) return null;
    const out = { ...headers };
    for (const n of names) delete out[n];
    this.counters.cookiesBlocked++;
    this._record('cookies', details, partition);
    return { responseHeaders: out };
  }

}

module.exports = { PrivacyShield, siteOf, siteOfUrl, sameParty, isLocalHost, stripTrackingParams, TRACKING_PARAMS };
