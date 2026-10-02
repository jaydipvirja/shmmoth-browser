/**
 * Secure DNS (DNS-over-HTTPS, AdGuard) and the ad blocker's per-site pause / master switch.
 * Run: node tests/p1-dns-adblock.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const Module = require('module');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_dns_'));
const SRC  = path.join(__dirname, '..', 'src');

// ── mocks: electron, and a Ghostery engine whose context behaves like the real one (tests/fixtures/ghostery-mock.js) ──
const gm = require('./fixtures/ghostery-mock');
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return { app: { getPath: (n) => path.join(ROOT, n), quit() {} }, shell: {}, dialog: {}, ipcMain: { handle() {}, removeHandler() {} } };
  }
  if (request === '@ghostery/adblocker-electron') return { ElectronBlocker: gm.ElectronBlocker, Request: gm.Request };
  return origLoad.call(this, request, ...args);
};

const StorageService   = require('../src/services/storage');
const RealAdBlockerService = require('../src/services/adblocker');
/** The service with fake downloads and its own folder, so the engine really loads (no network, nothing in the profile). */
function AdBlockerService(storage, opts = {}) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'eng_'));
  return new RealAdBlockerService(storage, Object.assign({ cacheFile: path.join(dir, 'engine.bin'), fetch: gm.makeFetch(), preloadPath: () => '/preload.js' }, opts));
}
AdBlockerService.normalizeHost = RealAdBlockerService.normalizeHost;
const enabledSessions = () => new Set(gm.state.blockers.flatMap((b) => Array.from(b.enabledSessions)));
const dns = require('../src/services/secureDns');
const mainJs = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');

function newStorage(tag, settings = {}) {
  const s = new StorageService();
  s.storagePath = path.join(ROOT, tag, 'mtc-data.json');
  s.data = s.load();
  s.updateSettings(settings);
  return s;
}
function fakeSession() {
  const s = { before: null, headers: null };
  s.webRequest = {
    onBeforeRequest(a, b) { s.before = typeof a === 'function' || a === null ? a : (b || null); },
    onHeadersReceived(a, b) { s.headers = typeof a === 'function' || a === null ? a : (b || null); }
  };
  return s;
}
const ask = (listener, url, page) => {
  let out = null;
  listener({ url, webContents: page ? { getURL: () => page, isDestroyed: () => false } : undefined }, (r) => { out = r; });
  return out;
};

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Secure DNS & Ad-blocker Switch Tests ');
  console.log('══════════════════════════════════════════════════════\n');

  console.log('📋 1. Secure DNS configuration');
  await test('default: AdGuard DNS over HTTPS, "automatic" mode (falls back to normal DNS), built-in resolver on', async () => {
    const { provider, options } = dns.buildHostResolverConfig({});
    assert(provider === 'adguard' && options.secureDnsMode === 'automatic' && options.enableBuiltInResolver === true);
    assert(options.secureDnsServers.join() === 'https://dns.adguard-dns.com/dns-query', options.secureDnsServers.join());
  });
  await test('the three AdGuard flavours point at the official AdGuard DNS hosts, over https only', async () => {
    assert(dns.PROVIDERS.adguard.servers[0] === 'https://dns.adguard-dns.com/dns-query');
    assert(dns.PROVIDERS['adguard-family'].servers[0] === 'https://family.adguard-dns.com/dns-query');
    assert(dns.PROVIDERS['adguard-unfiltered'].servers[0] === 'https://unfiltered.adguard-dns.com/dns-query');
    for (const p of Object.values(dns.PROVIDERS)) for (const u of p.servers) assert(new URL(u).protocol === 'https:' && !new URL(u).username, u);
  });
  await test('strict turns on "secure" mode (never falls back); "system" turns secure DNS off completely', async () => {
    assert(dns.buildHostResolverConfig({ secureDnsProvider: 'adguard', secureDnsStrict: true }).options.secureDnsMode === 'secure');
    const off = dns.buildHostResolverConfig({ secureDnsProvider: 'system', secureDnsStrict: true });
    assert(off.options.secureDnsMode === 'off' && off.options.secureDnsServers.length === 0 && off.provider === 'system');
  });
  await test('unknown provider ids fall back to the default; junk settings never throw', async () => {
    for (const v of ['nope', '', null, undefined, 5, {}, '__proto__', 'constructor']) {
      assert(dns.normalizeProvider(v) === 'adguard', String(v));
    }
    assert(dns.buildHostResolverConfig(undefined).provider === 'adguard' && dns.buildHostResolverConfig(null).provider === 'adguard');
  });
  await test('custom address: accepted when it is a plain https URL; anything else degrades to system DNS, never to a guess', async () => {
    const ok = dns.buildHostResolverConfig({ secureDnsProvider: 'custom', secureDnsCustomUrl: ' https://dns.example.com/dns-query ' });
    assert(ok.provider === 'custom' && ok.options.secureDnsServers[0] === 'https://dns.example.com/dns-query');
    for (const bad of ['http://dns.example.com/dns-query', 'ftp://x/y', 'https://user:pw@dns.example.com/q', 'https://dns.example.com/q#f', 'dns.example.com', '', '   ', 'https://a b.example/q', null, 42, 'https://' + 'a'.repeat(300) + '.com/q', 'javascript:alert(1)']) {
      const r = dns.buildHostResolverConfig({ secureDnsProvider: 'custom', secureDnsCustomUrl: bad });
      assert(r.provider === 'system' && r.options.secureDnsMode === 'off', 'accepted: ' + String(bad).slice(0, 40));
      assert(dns.validateDohUrl(bad).ok === false);
    }
  });
  await test('storage defaults: AdGuard on, automatic, nothing paused', async () => {
    const s = newStorage('defaults').getSettings();
    assert(s.secureDnsProvider === 'adguard' && s.secureDnsStrict === false && s.secureDnsCustomUrl === '' && Array.isArray(s.adBlockerAllowlist) && s.adBlockerAllowlist.length === 0);
  });
  await test('main.js: applied right after storage exists (before any window), caches cleared, invalid custom address saves nothing', async () => {
    assert(/new StorageService\(\);[\s\S]{0,400}this\.applySecureDns\(\);/.test(mainJs), 'applySecureDns must run at the start of init()');
    assert(/app\.configureHostResolver\(options\)/.test(mainJs) && /clearHostResolverCache\(\)/.test(mainJs));
    const h = mainJs.slice(mainJs.indexOf("ipcMain.handle('dns:set'"), mainJs.indexOf("log.info('IPC handlers registered')"));
    assert(h.indexOf('validateDohUrl') > 0 && h.indexOf('validateDohUrl') < h.indexOf('this.storage.updateSettings'), 'validate BEFORE saving');
    assert(/return \{ success: false, error: v\.reason/.test(h));
  });

  console.log('\n📋 2. Ad blocker: master switch');
  await test('switching off twice, or off when the engine was never started for a session, does not throw', async () => {
    gm.reset();
    const ab = new AdBlockerService(newStorage('sw1', { adBlockerEnabled: false }));
    const s = fakeSession();
    await ab.setupFilter(s);                    // disabled at start: engine never enabled for s
    ab.setEnabled(false); ab.setEnabled(false);
    const disableCalls = () => gm.state.blockers.reduce((n, b) => n + (b.disableCalls || 0), 0);
    assert(disableCalls() === 0, 'must not call disable for a session that was not enabled');
    ab.setEnabled(true); assert(enabledSessions().has(s));
    ab.setEnabled(false); ab.setEnabled(false);
    assert(disableCalls() === 1 && !enabledSessions().has(s), 'disable calls: ' + disableCalls());
  });
  await test('the YouTube ad optimizer is part of the blocker: it stops when the blocker is off or paused for the site', async () => {
    const f = mainJs.slice(mainJs.indexOf('  _applyYouTubeOptimizer('));
    assert(/this\.adBlocker\.isActiveFor\(new URL\(currentUrl\)\.hostname\)\) return/.test(f.slice(0, 600)), 'optimizer ignores the switch');
  });

  console.log('\n📋 3. Ad blocker: pausing a site');
  await test('host names are normalised (case, www., trailing dot); anything that is not a plain host is refused', async () => {
    const n = AdBlockerService.normalizeHost;
    assert(n('WWW.Example.COM.') === 'example.com' && n('a.b.example.co.uk') === 'a.b.example.co.uk' && n('localhost') === 'localhost' && n('127.0.0.1') === '127.0.0.1');
    for (const bad of ['', ' ', 'exa mple.com', 'a/b.com', 'http://example.com', '-x.com', 'x'.repeat(300), '[::1]', 'a..b', null, undefined, 5, {}]) assert(n(bad) === '', String(bad));
  });
  await test('pausing example.com also pauses its subdomains, but not look-alikes; resuming reverses it', async () => {
    const ab = new AdBlockerService(newStorage('p1'));
    assert(ab.setSitePaused('www.example.com', true) === true);
    assert(ab.isSitePaused('example.com') && ab.isSitePaused('www.example.com') && ab.isSitePaused('a.b.example.com'));
    assert(!ab.isSitePaused('notexample.com') && !ab.isSitePaused('example.com.evil.net') && !ab.isSitePaused('example.org') && !ab.isSitePaused(''));
    assert(ab.isActiveFor('other.org') && !ab.isActiveFor('shop.example.com'));
    assert(ab.setSitePaused('example.com', true) === false, 'already paused');
    assert(ab.setSitePaused('shop.example.com', false) === true && !ab.isSitePaused('example.com'), 'resuming a subdomain removes the covering parent');
    assert(ab.setSitePaused('example.com', false) === false);
  });
  await test('the list is saved, survives a restart, and a damaged list in the settings is cleaned', async () => {
    const st = newStorage('p2');
    const a = new AdBlockerService(st);
    a.setSitePaused('one.com', true); a.setSitePaused('two.org', true);
    assert(st.getSettings().adBlockerAllowlist.join() === 'one.com,two.org');
    assert(new AdBlockerService(st).isSitePaused('two.org'), 'a new service instance must read it back');
    st.updateSettings({ adBlockerAllowlist: ['ok.com', 'http://bad.com/x', 5, null, 'also ok.net', '../../etc'] });
    const b = new AdBlockerService(st);
    assert(b.getPausedSites().join() === 'ok.com' , b.getPausedSites().join());
    st.updateSettings({ adBlockerAllowlist: 'not a list' });
    assert(new AdBlockerService(st).getPausedSites().length === 0);
  });
  await test('the list is capped', async () => {
    const ab = new AdBlockerService(newStorage('p3'));
    for (let i = 0; i < 520; i++) ab.setSitePaused(`site${i}.example${i}.com`, true);
    assert(ab.getPausedSites().length === 500, String(ab.getPausedSites().length));
  });
  await test('requests of a paused page are let through untouched, all others still go to the engine (requests AND response headers)', async () => {
    gm.reset();
    const ab = new AdBlockerService(newStorage('p4'));
    ab.setSitePaused('news.example', true);
    const s = fakeSession();
    await ab.setupFilter(s);
    assert(s.before && s.before.engine === true, 'the engine must be in charge');
    assert(JSON.stringify(ask(s.before, 'https://ads.tracker.net/x.js', 'https://news.example/story')) === '{}', 'paused page must not be filtered');
    assert(JSON.stringify(ask(s.before, 'https://ads.tracker.net/x.js', 'https://blog.other.org/post')) === '{"cancel":true}', 'other pages are still protected');
    assert(JSON.stringify(ask(s.before, 'https://ads.tracker.net/x.js', 'https://sub.news.example/')) === '{}', 'subdomain of a paused site');
    ask(s.headers, 'https://news.example/', 'https://news.example/'); ask(s.headers, 'https://other.org/', 'https://other.org/');
    const hits = gm.state.blockers[0].hits;
    assert(hits.filter((h) => h.startsWith('hdr:')).join() === 'hdr:https://other.org/', 'headers of the paused site must not reach the engine: ' + hits.join());
    assert(hits.includes('req:https://ads.tracker.net/x.js'), 'the engine saw the unpaused requests');
  });
  await test('pausing while a page is open takes effect for the very next request (no restart)', async () => {
    const ab = new AdBlockerService(newStorage('p5'));
    const s = fakeSession(); await ab.setupFilter(s);
    assert(JSON.stringify(ask(s.before, 'https://ads.x.net/a', 'https://shop.test/')) === '{"cancel":true}');
    ab.setSitePaused('shop.test', true);
    assert(JSON.stringify(ask(s.before, 'https://ads.x.net/a', 'https://shop.test/')) === '{}');
    ab.setSitePaused('shop.test', false);
    assert(JSON.stringify(ask(s.before, 'https://ads.x.net/a', 'https://shop.test/')) === '{"cancel":true}');
  });
  await test('falls back to the referrer when the request has no tab; a missing or odd address never throws', async () => {
    const ab = new AdBlockerService(newStorage('p6')); ab.setSitePaused('ref.test', true);
    const s = fakeSession(); await ab.setupFilter(s);
    let out = null; s.before({ url: 'https://ads.q.net/a', referrer: 'https://ref.test/page' }, (r) => { out = r; });
    assert(JSON.stringify(out) === '{}');
    for (const d of [{ url: 'https://ads.q.net/a' }, { url: 'https://ads.q.net/a', referrer: 'garbage' }, { url: 'https://ads.q.net/a', webContents: { getURL() { throw new Error('gone'); } } }]) {
      s.before(d, (r) => { out = r; }); assert(JSON.stringify(out) === '{"cancel":true}', JSON.stringify(d));
    }
  });
  await test('the built-in fallback list honours the master switch and the pause as well', async () => {
    gm.reset();
    const ab = new AdBlockerService(newStorage('p7'));
    const s = fakeSession(); ab.setupFallbackFilter(s);
    assert(JSON.stringify(ask(s.before, 'https://googleads.g.doubleclick.net/x', 'https://a.test/')) === '{"cancel":true}');
    ab.setSitePaused('a.test', true);
    assert(JSON.stringify(ask(s.before, 'https://googleads.g.doubleclick.net/x', 'https://a.test/')) === '{"cancel":false}');
    ab.setEnabled(false);
    assert(JSON.stringify(ask(s.before, 'https://googleads.g.doubleclick.net/x', 'https://b.test/')) === '{"cancel":false}');
  });
  await test('IPC: the site always comes from the active tab (never from the renderer), only http(s) pages can be paused, the page reloads', async () => {
    const h = mainJs.slice(mainJs.indexOf('const shieldTarget'), mainJs.indexOf("// ── Secure DNS (DNS-over-HTTPS) ──"));
    assert(/ipcMain\.handle\('adblocker:setSite', secureHandlerRaw\(\(event, paused\) =>/.test(h) && !/host\s*=\s*(paused|arg|payload)/.test(h));
    assert(/u\.protocol === 'http:' \|\| u\.protocol === 'https:'/.test(h), 'only websites');
    assert(/setSitePaused\(host, paused === true\);\s*this\.reloadTab\(tabId\)/.test(h), 'must reload the page');
    assert(/getParentWindow/.test(h), 'an incognito bubble must act on the incognito tab');
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
})();
