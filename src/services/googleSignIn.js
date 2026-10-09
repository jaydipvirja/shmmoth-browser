/**
 * GOOGLE SIGN-IN — how the browser presents itself on Google's sign-in pages, and what it does when Google refuses it.
 *
 * Google refuses to sign in browsers it takes for an embedded or automated browser ("Couldn't sign you in — This browser
 * or app may not be secure"). Up to 1.1.14 the browser tried to pass for Google Chrome: a script in every page replaced
 * navigator.userAgentData.brands and getHighEntropyValues() with JavaScript functions that said "Google Chrome", and the
 * requests to Google got a rewritten Sec-CH-UA header saying the same. Google's sign-in check runs in the page and sees
 * through exactly that: the replaced functions are not native code, frames and workers the script never reached still
 * said "Chromium", and the version fields did not match the engine. A browser that lies about itself is what the check
 * is there to stop, so the sign-in was refused.
 *
 * Now nothing is disguised: every page sees the engine's own, native values. Only the User-Agent string of the sign-in
 * pages (accounts.google.com, accounts.youtube.com) is chosen, from a short list of honest identities:
 *   1. "app"     — a Chromium-based browser that names itself: "... SHMMOTH/1.1.15 Chrome/152.0.x.y Safari/537.36"
 *                  (the form Opera, Edge and other Chromium browsers use; no "Electron" token, which Google blocks)
 *   2. "chrome"  — the plain Chromium form: "... Chrome/152.0.0.0 Safari/537.36"
 *   3. "firefox" — Firefox's form, with the Chromium client hints left out of the sign-in requests
 * When Google shows its refusal page anyway, the next identity is tried at once and the sign-in starts again at its
 * beginning; the identity that works is kept for next time. When all of them were refused in one sign-in, the user is
 * told once (no loop).
 *
 * Pure logic (no Electron): main.js applies the User-Agent and the navigations.
 */

'use strict';

const SIGN_IN_HOSTS = new Set(['accounts.google.com', 'accounts.youtube.com']);
const PROFILE_IDS = Object.freeze(['app', 'chrome', 'firefox']);
const FIREFOX_VERSION = '140.0';                  // Firefox ESR
// Google's help article for this refusal ("This browser or app may not be secure"); its link is on the refusal page in
// every language
const REFUSAL_HELP_ANSWER = '7675428';

function parse(url) {
  try { return new URL(url); } catch (_) { return null; }
}

/** A Google sign-in page (exact host names; "https://evil.example/?accounts.google.com" is not one). */
function isSignInUrl(url) {
  const u = parse(url);
  return Boolean(u) && u.protocol === 'https:' && SIGN_IN_HOSTS.has(u.hostname.toLowerCase());
}

/** Google's refusal page ("Couldn't sign you in"), recognised by its address. */
function isRefusalUrl(url) {
  const u = parse(url);
  if (!u || u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'accounts.google.com') return false;
  // /v3/signin/rejected, /signin/rejected, /signin/v2/deniedsigninrejected
  return /\/signin\/.*rejected/i.test(u.pathname);
}

/** The operating-system part of the User-Agent, as Chromium writes it (frozen values since the User-Agent reduction). */
function osToken(platform) {
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64';
  if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7';
  return 'X11; Linux x86_64';
}

function firefoxOsToken(platform) {
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64';
  if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10.15';
  return 'X11; Linux x86_64';
}

/**
 * The User-Agent of an identity.
 * @param {string} id  'app' | 'chrome' | 'firefox'
 * @param {{ platform: string, chromeVersion: string, appVersion: string }} env
 */
function userAgentOf(id, { platform, chromeVersion, appVersion }) {
  const full = String(chromeVersion || '').trim() || '0.0.0.0';
  const major = full.split('.')[0];
  const os = osToken(platform);
  if (id === 'firefox') return `Mozilla/5.0 (${firefoxOsToken(platform)}; rv:${FIREFOX_VERSION}) Gecko/20100101 Firefox/${FIREFOX_VERSION}`;
  if (id === 'chrome') return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  const version = String(appVersion || '').replace(/[^0-9A-Za-z.\-]/g, '') || '1.0.0';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) SHMMOTH/${version} Chrome/${full} Safari/537.36`;
}

/**
 * Where a sign-in starts again after a refusal: an OAuth request ("Sign in with Google" on another site) is repeated as
 * it was; any other sign-in starts at ServiceLogin with the same destination (`continue`), service and language.
 */
function restartUrl(startUrl, refusalUrl) {
  const start = parse(startUrl);
  if (start && /^\/(?:o\/oauth2|signin\/oauth)/i.test(start.pathname)) return start.toString();
  const refusal = parse(refusalUrl);
  const origin = refusal && refusal.hostname.toLowerCase() === 'accounts.google.com' ? refusal.origin : 'https://accounts.google.com';
  const restart = new URL('/ServiceLogin', origin);
  for (const src of [start, refusal]) {
    if (!src) continue;
    for (const key of ['continue', 'service', 'hl', 'passive', 'followup']) {
      const v = src.searchParams.get(key);
      if (v && !restart.searchParams.has(key)) restart.searchParams.set(key, v);
    }
  }
  return restart.toString();
}

class GoogleSignIn {
  /**
   * @param {object} deps
   * @param {object} deps.storage          { getSettings(), updateSettings(obj) } — the identity in use is kept there
   * @param {string} deps.platform         process.platform
   * @param {string} deps.chromeVersion    process.versions.chrome
   * @param {string} deps.appVersion       app.getVersion()
   * @param {object} [deps.log]
   */
  constructor({ storage, platform, chromeVersion, appVersion, log }) {
    this.storage = storage;
    this.env = { platform, chromeVersion, appVersion };
    this.log = log || { info() {}, warn() {} };
    this.flows = new Map();                     // webContents id → { start, tried: Set, gaveUp }
  }

  /** The identity in use (the last one that was not refused). */
  currentProfile() {
    const saved = this.storage && this.storage.getSettings ? this.storage.getSettings().googleSignInProfile : '';
    return PROFILE_IDS.includes(saved) ? saved : PROFILE_IDS[0];
  }

  /** The User-Agent for a page: the sign-in identity on Google's sign-in pages, `normalUa` everywhere else. */
  userAgentFor(url, normalUa) {
    return isSignInUrl(url) ? userAgentOf(this.currentProfile(), this.env) : normalUa;
  }

  /** Should the Chromium client hints be left out of this webContents' requests? (only while it shows the Firefox identity) */
  hidesClientHints(url) {
    return isSignInUrl(url) && this.currentProfile() === 'firefox';
  }

  /**
   * A webContents arrived at `url` (a navigation, also within the page), or its page turned out to be the refusal page
   * (`refused: true`, found in the page itself). Returns what to do:
   *   { action: 'none' }
   *   { action: 'retry', url, profile }    — use the new identity and load `url` (the sign-in again from the start)
   *   { action: 'give-up', tried }         — every identity was refused in this sign-in; tell the user (once)
   */
  noteNavigation(wcId, url, { refused = false } = {}) {
    if (!isSignInUrl(url)) {
      // left the sign-in pages (signed in, or went elsewhere): the next sign-in starts afresh
      if (parse(url) && /^https?:$/.test(parse(url).protocol)) this.flows.delete(wcId);
      return { action: 'none' };
    }
    let flow = this.flows.get(wcId);
    if (!flow) {
      flow = { start: url, tried: new Set([this.currentProfile()]), gaveUp: false };
      this.flows.set(wcId, flow);
    }
    if (!refused && !isRefusalUrl(url)) return { action: 'none' };
    if (flow.gaveUp) return { action: 'none' };
    // (the refusal page of the identity in use; the flow may have begun with another one)
    flow.tried.add(this.currentProfile());
    const next = PROFILE_IDS.find((p) => !flow.tried.has(p));
    if (!next) {
      flow.gaveUp = true;
      this.log.warn('Google refused the sign-in with every browser identity', { tried: Array.from(flow.tried) });
      return { action: 'give-up', tried: Array.from(flow.tried) };
    }
    flow.tried.add(next);
    try { this.storage.updateSettings({ googleSignInProfile: next }); } catch (_) { /* kept in memory only */ }
    this.log.info('Google refused the sign-in; trying the next browser identity', { profile: next });
    return { action: 'retry', url: restartUrl(flow.start, url), profile: next };
  }

  /** The user asked to try again after a refusal: every identity may be tried once more. */
  resetFlow(wcId) {
    this.flows.delete(wcId);
  }

  forget(wcId) {
    this.flows.delete(wcId);
  }
}

GoogleSignIn.PROFILE_IDS = PROFILE_IDS;
GoogleSignIn.REFUSAL_HELP_ANSWER = REFUSAL_HELP_ANSWER;
GoogleSignIn.isSignInUrl = isSignInUrl;
GoogleSignIn.isRefusalUrl = isRefusalUrl;
GoogleSignIn.userAgentOf = userAgentOf;
GoogleSignIn.restartUrl = restartUrl;
GoogleSignIn.osToken = osToken;
module.exports = GoogleSignIn;
