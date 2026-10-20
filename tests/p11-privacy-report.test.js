/**
 * SHMMOTH BROWSER — privacy, phase 2 (1.5.1): fingerprinting protection and the Privacy Report
 *
 * With fakes (tests/e2e/29-fingerprint.e2e.js and 28-privacy.e2e.js check the real browser):
 *   - the page script against a fake page: WebGL names the maker only (the test machines have no graphics card),
 *     canvas / audio read-backs change per seed and stay the same for one seed, the changed functions read as native,
 *     cores / memory / battery, frames the page makes itself
 *   - seeds: stable for a site in one session, different between sites, partitions and sessions
 *   - the report: per day, 30 days, tracker sites with the sites they were on, companies, Incognito never counted,
 *     the shield's per-page count and its reset
 *   - the request hub tells who blocked what; wiring of the page, the menu, the shield and Settings
 *
 * Run: node tests/p11-privacy-report.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { buildPageScript, seedFor } = require('../src/services/fingerprintShield');
const { PrivacyStats, companyOf } = require('../src/services/privacyStats');
const { PrivacyShield } = require('../src/services/privacyShield');
const hub = require('../src/services/webRequestHub');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

/** A small fake browser window: enough of the DOM for the page script. */
function fakeWindow() {
  const ctx = vm.createContext({});
  vm.runInContext(`
    function ImageData(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
    function CanvasRenderingContext2D(canvas) { this.canvas = canvas; }
    CanvasRenderingContext2D.prototype.getImageData = function getImageData(x, y, w, h) {
      const img = new ImageData(w, h); img.data.set(this.canvas._pixels.subarray(0, w * h * 4)); return img;
    };
    CanvasRenderingContext2D.prototype.putImageData = function putImageData(img) { this.canvas._pixels.set(img.data); };
    CanvasRenderingContext2D.prototype.drawImage = function drawImage(src) { this.canvas._pixels.set(src._pixels); };
    function HTMLCanvasElement() { this.width = 0; this.height = 0; this._pixels = null; }
    HTMLCanvasElement.prototype.getContext = function getContext() {
      if (!this._pixels) this._pixels = new Uint8ClampedArray(this.width * this.height * 4);
      return new CanvasRenderingContext2D(this);
    };
    HTMLCanvasElement.prototype.toDataURL = function toDataURL() { return 'data:' + Array.prototype.join.call(this._pixels, ','); };
    function Document() {}
    Document.prototype.createElement = function createElement(tag) { return new HTMLCanvasElement(); };
    function WebGLRenderingContext() {}
    WebGLRenderingContext.prototype.getParameter = function getParameter(p) {
      if (p === 0x9245) return 'Google Inc. (NVIDIA)';
      if (p === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return 42;
    };
    WebGLRenderingContext.prototype.readPixels = function readPixels(x, y, w, h, f, t, out) { out.fill(200); };
    function AudioBuffer(n) { this._d = new Float32Array(n).map((_, i) => Math.sin(i / 7)); }
    AudioBuffer.prototype.getChannelData = function getChannelData() { return this._d; };
    AudioBuffer.prototype.copyFromChannel = function copyFromChannel(dest) { dest.set(this._d.subarray(0, dest.length)); };
    function Navigator() {}
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: function () { return 16; }, configurable: true, enumerable: true });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: function () { return 32; }, configurable: true, enumerable: true });
    Navigator.prototype.getBattery = function getBattery() { return Promise.resolve({}); };
    function HTMLIFrameElement() {}
    var window = this; var document = new Document(); var navigator = new Navigator();
    window.open = function open() { return null; };
  `, ctx);
  return ctx;
}

function drawn(ctx) {
  return vm.runInContext(`(() => {
    const c = document.createElement('canvas'); c.width = 20; c.height = 10;
    const x = c.getContext('2d');
    for (let i = 0; i < c._pixels.length; i++) c._pixels[i] = (i % 4 === 3) ? 255 : (i * 7) % 256;
    return c;
  })()`, ctx);
}

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — fingerprinting protection & Privacy Report');
console.log('══════════════════════════════════════════════════════\n');

console.log('📋 The page script');
const plain = fakeWindow();
const plainCanvas = drawn(plain);
const plainUrl = plainCanvas.toDataURL();
const protectedPage = (seed) => { const w = fakeWindow(); vm.runInContext(buildPageScript(seed, 'secret'), w); return w; };
const A = protectedPage(111);
const A2 = protectedPage(111);
const B = protectedPage(777777);

test('canvas read-backs: changed slightly, the same for one seed, different for another; the page\'s canvas untouched', () => {
  const c = drawn(A);
  const before = Array.from(c._pixels).join();
  const a = c.toDataURL();
  eq(Array.from(c._pixels).join(), before, 'toDataURL changed the page\'s canvas');
  assert(a !== plainUrl, 'no change');
  eq(drawn(A2).toDataURL(), a, 'same seed, same drawing');
  assert(drawn(B).toDataURL() !== a, 'another seed gives the same');
  const changed = a.slice(5).split(',').filter((v, i) => Number(v) !== plainCanvas._pixels[i]).length;
  assert(changed > 0 && changed <= 24, `${changed} values changed`);
  const img = vm.runInContext('(c) => c.getContext("2d").getImageData(0, 0, 20, 10)', A)(c);
  assert(Array.from(img.data).join() !== before, 'getImageData is protected too');
});

test('WebGL names the graphics card\'s maker only; readPixels changes slightly', () => {
  const r = vm.runInContext('(() => { const g = new WebGLRenderingContext(); return [g.getParameter(0x9245), g.getParameter(0x9246), g.getParameter(1)]; })()', A);
  eq(r, ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GPU)', 42]);
  const px = vm.runInContext('(() => { const g = new WebGLRenderingContext(); const o = new Uint8Array(10 * 10 * 4); g.readPixels(0, 0, 10, 10, 0, 0, o); return Array.from(o); })()', A);
  assert(px.some((v) => v !== 200) && px.filter((v) => v !== 200).length <= 24);
});

test('audio: a level change far below hearing, once per buffer; another seed, another change', () => {
  const read1 = vm.runInContext('(() => { const b = new AudioBuffer(1000); const d = b.getChannelData(0); const first = d[10]; b.getChannelData(0); return [first, d[10]]; })()', A);
  eq(read1[0], read1[1], 'scaled twice');
  const real = Math.fround(Math.sin(10 / 7));
  assert(read1[0] !== real && Math.abs(read1[0] / real - 1) < 2e-4, `${read1[0]} vs ${real}`);
  const other = vm.runInContext('new AudioBuffer(1000).getChannelData(0)[10]', B);
  assert(other !== read1[0], 'same change on another site');
});

test('2/4/8 cores, 4 or 8 GB, no battery API; the changed functions read as native code', () => {
  eq(vm.runInContext('[navigator.hardwareConcurrency, navigator.deviceMemory, typeof navigator.getBattery]', A), [8, 8, 'undefined']);
  const src = vm.runInContext('[HTMLCanvasElement.prototype.toDataURL.toString(), Function.prototype.toString.toString(), Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency").get.toString(), HTMLCanvasElement.prototype.toDataURL.name, CanvasRenderingContext2D.prototype.getImageData.length]', A);
  assert(/^function toDataURL\(\) \{ return 'data:'/.test(src[0]), 'shows the original, not the wrapper: ' + src[0]);
  assert(!/native\.get|noisyCopy/.test(src.join(' ')), src.join(' | '));
  eq(src[3], 'toDataURL'); eq(src[4], 4);
});

test('a second run in the same page does nothing more (frames patched by their parent and by their own preload)', () => {
  const w = protectedPage(111);
  vm.runInContext(buildPageScript(111, 'secret'), w);
  eq(drawn(w).toDataURL(), drawn(A).toDataURL(), 'patched twice changes the result');
});

test('seeds: stable per site and session, different between sites, private windows and sessions', () => {
  eq(seedFor('s1', 'default', 'a.com'), seedFor('s1', 'default', 'a.com'));
  const set = new Set([seedFor('s1', 'default', 'a.com'), seedFor('s1', 'default', 'b.com'), seedFor('s1', 'incognito', 'a.com'), seedFor('s2', 'default', 'a.com')]);
  eq(set.size, 4);
});

test('the shield hands the script only to web pages, per settings and per site', () => {
  const settings = {};
  const shield = new PrivacyShield({ getSettings: () => settings });
  eq(shield.pageScripts('mtc://settings').length, 0);
  eq(shield.pageScripts('https://accounts.google.com/signin').length, 1, 'Google\'s sign-in pages get only GPC');
  const s = shield.pageScripts('https://news.example.com/a');
  eq(s.length, 2, 'GPC + fingerprinting');
  assert(s[1].includes(String(seedFor(shield.secret, 'default', 'example.com'))), 'the site\'s seed');
  settings.privacyCookieAllowSites = ['example.com'];
  eq(shield.pageScripts('https://news.example.com/a').length, 1, 'relaxed on the site');
  settings.privacyCookieAllowSites = [];
  settings.privacyFingerprintProtection = false;
  eq(shield.pageScripts('https://news.example.com/a').length, 1);
  eq(shield.webRtcPolicy(), 'default');
  settings.privacyFingerprintProtection = true;
  eq(shield.webRtcPolicy(), 'default_public_interface_only');
});

console.log('\n📋 The report');
let clock = new Date('2026-10-20T10:00:00').getTime();
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p11-')), 'privacy-report.json');
const pageEvents = [];
const stats = new PrivacyStats({ file, now: () => clock, onPageCount: (wcId, c) => pageEvents.push([wcId, c]) });

test('what was stopped, per tracker and the sites it was on; companies; Incognito never counted', () => {
  stats.record({ kind: 'blocked', tracker: 'doubleclick.net', site: 'news.com', wcId: 1 });
  stats.record({ kind: 'blocked', tracker: 'doubleclick.net', site: 'shop.com', wcId: 2 });
  stats.record({ kind: 'cookies', tracker: 'facebook.net', site: 'news.com', wcId: 1 });
  stats.record({ kind: 'params', site: 'news.com', wcId: 1 });
  stats.record({ kind: 'https', site: 'old.org', wcId: 1 });
  stats.record({ kind: 'blocked', tracker: 'secret-tracker.com', site: 'private.com', wcId: 3, incognito: true });
  const r = stats.report();
  eq(r.totals.blocked, 2); eq(r.totals.cookies, 1); eq(r.totals.params, 1); eq(r.totals.https, 1);
  eq(r.totals.trackers, 2); eq(r.totals.sitesWithTrackers, 2); eq(r.totals.companies, 2);
  eq(r.topTrackers[0], { site: 'doubleclick.net', company: 'Google', count: 2, sites: 2, examples: ['news.com', 'shop.com'] });
  eq(r.topSites[0], { site: 'news.com', trackers: 2 });
  assert(!JSON.stringify(r).includes('private.com') && !JSON.stringify(r).includes('secret-tracker'), 'incognito in the report');
  eq(companyOf('google-analytics.com'), 'Google'); eq(companyOf('unknown.net'), '');
});

test('the shield counts per page (Incognito too, it is only shown, never kept) and starts again on a new page', () => {
  eq(stats.pageCount(1), { blocked: 1, cookies: 1 });
  eq(stats.pageCount(3), { blocked: 1, cookies: 0 });
  stats.resetPage(1);
  eq(stats.pageCount(1), { blocked: 0, cookies: 0 });
  assert(pageEvents.some(([id, c]) => id === 1 && c.blocked === 0), 'the reset was announced');
  stats.forgetPage(3);
  eq(stats.pageCount(3), { blocked: 0, cookies: 0 });
});

test('kept on disk, 30 days at most, cleared on request', () => {
  stats.flush();
  const again = new PrivacyStats({ file, now: () => clock });
  eq(again.report().totals.blocked, 2, 'read back');
  clock += 31 * 86400000;
  eq(again.report().totals.blocked, 0, 'older than 30 days');
  stats.clear();
  eq(new PrivacyStats({ file, now: () => clock }).report().totals.trackers, 0);
});

console.log('\n📋 The request hub and the wiring');
test('the hub tells when the ad blocker blocked a request; the shield counts it for the page', async () => {
  const listeners = {};
  const fakeSession = { webRequest: {} };
  for (const ev of hub.EVENTS) fakeSession.webRequest[ev] = (...a) => { listeners[ev] = a.length > 1 ? a[1] : a[0]; };
  const h = hub.install(fakeSession);
  const recorded = [];
  const shield = new PrivacyShield({ getSettings: () => ({}), stats: { record: (e) => recorded.push(e) } });
  shield.attach(h, 'default');
  fakeSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => cb({ cancel: d.url.includes('ads') }));
  const wc = { id: 9, getURL: () => 'https://news.com/a', isDestroyed: () => false };
  listeners.onBeforeRequest({ url: 'https://ads.tracker.net/x.js', resourceType: 'script', webContents: wc }, () => {});
  listeners.onBeforeRequest({ url: 'https://cdn.news.com/a.js', resourceType: 'script', webContents: wc }, () => {});
  eq(recorded, [{ kind: 'blocked', tracker: 'tracker.net', site: 'news.com', wcId: 9, incognito: false }]);
});

test('mtc://privacy is an internal page; the menu, the shield and Settings open it; the shield shows this page\'s count', () => {
  assert(/'privacy',\n\]\)/.test(read('src', 'security', 'urlPolicy.js')));
  const html = read('src', 'pages', 'privacy.html');
  assert(/<script src="privacy\.js"><\/script>/.test(html) && !/innerHTML/.test(read('src', 'pages', 'privacy.js')));
  assert(read('src', 'pages', 'menu-bubble.html').includes('data-action="privacy-report"'));
  assert(/'privacy-report': \(\) => openPageTab\('mtc:\/\/privacy'\)/.test(read('src', 'renderer', 'app.js')));
  const bubble = read('src', 'pages', 'shield-bubble.html');
  assert(bubble.includes('id="btn-report"') && /api\.getShieldPageCount\(\)/.test(bubble) && /Blocked on this page/.test(bubble));
  assert(read('src', 'pages', 'settings.html').includes('id="btn-open-privacy-report"') && read('src', 'pages', 'settings.html').includes('id="toggle-privacy-fingerprint"'));
  assert(/privacyStats\.flush\(\)/.test(read('src', 'main.js')), 'the report is written when the browser closes');
  assert(/sess\.registerPreloadScript\(\{ type: 'frame', filePath: path\.join\(SRC_DIR, 'preload-privacy\.js'\) \}\)/.test(read('src', 'browser', 'network.js')));
  assert(/ipcRenderer\.sendSync\('shmmoth:privacy-page', href\)/.test(read('src', 'preload-privacy.js')));
});

console.log(`\n  p11-privacy-report: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
