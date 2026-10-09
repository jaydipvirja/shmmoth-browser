/**
 * A stand-in for @ghostery/adblocker-electron that behaves like the real engine in the ways the ad blocker service
 * depends on (so the unit tests can run without Electron or the network):
 *   - enableBlockingInSession(session) registers webRequest listeners and returns a context; like the real engine it
 *     would also register a cosmetic-filter preload script + a global ipcMain handler when config.loadCosmeticFilters
 *     is true at that moment (counted in `state.engineCosmeticRegistrations` — the service must keep that at 0)
 *   - disableBlockingInSession(session) removes the listeners and throws for a session that was never enabled
 *   - serialize() / ElectronBlocker.deserialize() round-trip, a damaged buffer throws
 *   - match(request) blocks hosts that start with "ads." and emits 'request-blocked'
 *   - updateFromDiff({ added, removed }), updateResources(), getFilters(), onInjectCosmeticFilters()
 *   - getCosmeticsFilters(options): styles from the `##` lines, scripts from the `##+js(...)` lines, each asked for part
 *     only when the options ask for it (calls are recorded in `state.cosmeticsCalls`)
 * Plus makeFetch(): a fake fetch that serves list texts (or fails) per host.
 */

'use strict';

const state = {
  parseCalls: [], deserializeCalls: 0, blockers: [], engineCosmeticRegistrations: 0, injectCalls: [], cosmeticsCalls: [], failParse: false
};

function reset() {
  state.parseCalls.length = 0; state.blockers.length = 0; state.injectCalls.length = 0; state.cosmeticsCalls.length = 0;
  state.deserializeCalls = 0; state.engineCosmeticRegistrations = 0; state.failParse = false;
}

function makeBlocker(text, config, extra = {}) {
  const handlers = {};
  const blocker = {
    text, resources: null, diffs: [],
    config: Object.assign({ loadNetworkFilters: true, loadCosmeticFilters: true, enableMutationObserver: true }, config),
    enabledSessions: new Set(),
    hits: [],
    on(evt, cb) { handlers[evt] = cb; },
    fire(evt, ...a) { if (handlers[evt]) handlers[evt](...a); },
    isBlockingEnabled(s) { return this.enabledSessions.has(s); },
    enableBlockingInSession(s) {
      this.enabledSessions.add(s);
      if (this.config.loadCosmeticFilters === true) state.engineCosmeticRegistrations++;
      const context = {
        onBeforeRequest: (d, cb) => { this.hits.push('req:' + d.url); if (/\/\/ads\./.test(d.url)) { this.fire('request-blocked'); cb({ cancel: true }); } else cb({}); },
        onHeadersReceived: (d, cb) => { this.hits.push('hdr:' + d.url); cb({}); }
      };
      if (this.config.loadNetworkFilters && s.webRequest) {
        s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, context.onBeforeRequest);
        s.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, context.onHeadersReceived);
      }
      return context;
    },
    disableBlockingInSession(s) {
      this.disableCalls = (this.disableCalls || 0) + 1;
      if (!this.enabledSessions.delete(s)) throw new Error('Trying to disable blocking which was not enabled');
      if (s.webRequest) { s.webRequest.onBeforeRequest(null); s.webRequest.onHeadersReceived(null); }
    },
    updateResources(data, checksum) { this.resources = { data, checksum }; },
    updateFromDiff({ added = [], removed = [] }) {
      this.diffs.push({ added, removed });
      const lines = this.text.split('\n').filter((l) => !removed.includes(l));
      this.text = lines.concat(added).join('\n');
    },
    getFilters() {
      const lines = this.text.split('\n').filter((l) => l && !l.startsWith('!'));
      return { networkFilters: lines.filter((l) => !l.includes('##')), cosmeticFilters: lines.filter((l) => l.includes('##')) };
    },
    match(request) {
      this.hits.push('match:' + request.url + ':' + request.type);
      if (/\/\/ads\./.test(request.url)) { this.fire('request-blocked'); return { match: true, redirect: undefined }; }
      return { match: false, redirect: undefined };
    },
    onInjectCosmeticFilters: async (event, url, msg) => { state.injectCalls.push({ url, msg }); return 'injected'; },
    getCosmeticsFilters(o) {
      state.cosmeticsCalls.push(o);
      const lines = Array.from(new Set(this.text.split('\n')));
      const hiding = lines.filter((l) => /##[^+]/.test(l)).map((l) => l.slice(l.indexOf('##') + 2));
      const wantStyles = o.getBaseRules || o.getRulesFromHostname || o.getRulesFromDOM;
      return {
        active: true,
        styles: wantStyles && hiding.length ? hiding.join(',') + ' { display: none !important; }' : '',
        scripts: o.getInjectionRules ? lines.filter((l) => l.includes('##+js(')).map((l) => `/* ${l} */ window.__scriptlet = true;`) : []
      };
    },
    serialize() { return Buffer.from(JSON.stringify({ text: this.text, config: this.config, resources: this.resources })); },
    ...extra
  };
  state.blockers.push(blocker);
  return blocker;
}

const ElectronBlocker = {
  parse(text, config) {
    if (state.failParse) throw new Error('parse failed');
    state.parseCalls.push({ text, config });
    return makeBlocker(text, config);
  },
  deserialize(bytes) {
    state.deserializeCalls++;
    const obj = JSON.parse(Buffer.from(bytes).toString('utf8'));
    const b = makeBlocker(obj.text, obj.config);
    b.resources = obj.resources;
    return b;
  }
};

const Request = { fromRawDetails: (d) => d };

/** A list that passes the "does this look like a filter list" check. */
const LIST_TEXT = '[Adblock Plus 2.0]\n! Title: test list\n' + Array.from({ length: 30 }, (_, i) => `||ads${i}.example.com^`).join('\n') + '\nexample.com##.ad-banner\nexample.com##+js(set-constant, adsEnabled, false)\n';
const RESOURCES_TEXT = JSON.stringify({ scriptlets: [{ name: 'set-constant.js', aliases: [], body: 'x'.repeat(300) }] });

/**
 * @param {object} [o]
 * @param {Function} [o.textFor]   (url) => text to serve (default: a valid list / resources file)
 * @param {Function} [o.failFor]   (url) => true to answer with a network error
 * @param {Promise}  [o.gate]      requests wait for it
 */
function makeFetch(o = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (o.gate) await o.gate;
    if (o.failFor && o.failFor(url)) throw new Error('network down');
    const text = o.textFor ? o.textFor(url) : (/resources\.json$/.test(url) ? RESOURCES_TEXT : LIST_TEXT + `! source ${url}\n`);
    if (text === null) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => text };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

module.exports = { state, reset, makeBlocker, ElectronBlocker, Request, makeFetch, LIST_TEXT, RESOURCES_TEXT };
