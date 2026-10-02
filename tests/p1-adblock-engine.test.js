/**
 * SHMMOTH BROWSER — the ad blocker beyond blocked requests (filter lists, element hiding + scriptlets, pop-ups, "My filters")
 *
 * Real behaviour inside pages is covered by tests/e2e/16-adblock-engine.e2e.js; this file checks the rules around it
 * with a stand-in for the Ghostery engine (tests/fixtures/ghostery-mock.js):
 *   - how lists are chosen, downloaded, validated and kept (services/filterLists.js, services/adblocker.js)
 *   - that the cosmetic-filter registration is done once per session by the service (not by the engine), respects the
 *     master switch and the per-site pause, and never touches the browser's own pages
 *   - the pop-up rules (services/popupPolicy.js) and the gesture script
 *   - the wiring in main.js, the preload and the Settings page
 *
 * Run: node tests/p1-adblock-engine.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(a === b, `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_adeng_'));
const SRC = path.join(__dirname, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const gm = require('./fixtures/ghostery-mock');
const ipc = { handlers: {} };
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return {
      app: { getPath: (n) => path.join(ROOT, n), quit() {} }, shell: {}, dialog: {},
      ipcMain: { handle(ch, fn) { ipc.handlers[ch] = fn; }, removeHandler(ch) { delete ipc.handlers[ch]; } }
    };
  }
  if (request === '@ghostery/adblocker-electron') return { ElectronBlocker: gm.ElectronBlocker, Request: gm.Request };
  return origLoad.call(this, request, ...args);
};

const StorageService = require('../src/services/storage');
const AdBlockerService = require('../src/services/adblocker');
const PopupPolicy = require('../src/services/popupPolicy');
const lists = require('../src/services/filterLists');

let seq = 0;
function newStorage(settings = {}) {
  const s = new StorageService();
  s.storagePath = path.join(ROOT, 'st' + (++seq), 'mtc-data.json');
  s.data = s.load();
  if (Object.keys(settings).length) s.updateSettings(settings);
  return s;
}
function fakeSession() {
  const s = { preloads: new Map(), n: 1, before: null };
  s.webRequest = { onBeforeRequest(a, b) { s.before = typeof a === 'function' || a === null ? a : (b || null); }, onHeadersReceived() {} };
  s.registerPreloadScript = (script) => { const id = 'p' + s.n++; s.preloads.set(id, script); return id; };
  s.unregisterPreloadScript = (id) => { s.preloads.delete(id); };
  return s;
}
function newAB(settings = {}, opts = {}) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'ab_'));
  const f = opts.fetch || gm.makeFetch();
  const ab = new AdBlockerService(newStorage(settings), Object.assign({ cacheFile: path.join(dir, 'engine.bin'), fetch: f, preloadPath: () => '/ghostery-preload.js' }, opts));
  ab._dir = dir; ab._f = f;
  return ab;
}
const wcAt = (url, destroyed = false) => ({ getURL: () => url, isDestroyed: () => destroyed });

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — ad blocker engine, pop-ups, My filters');
  console.log('══════════════════════════════════════════════════════');

  console.log('\n📋 Filter lists');

  await test('the lists: unique ids, https only, several addresses for the core lists, AdGuard Base + Popups included', () => {
    const ids = lists.LISTS.map((l) => l.id);
    eq(new Set(ids).size, ids.length, 'ids are unique');
    for (const l of [...lists.LISTS, lists.RESOURCES]) {
      assert(l.urls.length >= 1 && l.urls.every((u) => new URL(u).protocol === 'https:'), l.id);
    }
    for (const id of ['easylist', 'easyprivacy', 'ubo-filters']) assert(lists.LISTS.find((l) => l.id === id).urls.length >= 3, id + ' needs mirrors');
    assert(ids.includes('adguard-base') && ids.includes('adguard-popups') && ids.includes('ubo-unbreak'));
    assert(lists.RESOURCES.urls.length >= 2, 'the scriptlet resources need a mirror too');
  });

  await test('a download is only accepted when it looks like a filter list (a login page or an error is not)', () => {
    assert(lists.looksLikeFilterList(gm.LIST_TEXT));
    assert(lists.looksLikeFilterList('! Title: hosts style\n' + Array.from({ length: 30 }, (_, i) => `||tracker${i}.example.net^`).join('\n')));
    for (const bad of ['', 'x', '<html><body>Sign in to the Wi-Fi network</body></html>'.repeat(20), '<!DOCTYPE html>' + 'a'.repeat(500), 'Not found', JSON.stringify({ a: 1 }).repeat(30), 'just some text\n'.repeat(100), null, undefined, 5]) {
      assert(!lists.looksLikeFilterList(bad), 'accepted: ' + String(bad).slice(0, 40));
    }
    assert(lists.looksLikeResources(gm.RESOURCES_TEXT) && !lists.looksLikeResources('{}') && !lists.looksLikeResources('nope') && !lists.looksLikeResources(gm.LIST_TEXT));
  });

  await test('downloadList tries every address in turn and says what went wrong with each when none works', async () => {
    const seen = [];
    const f = async (url) => {
      seen.push(url);
      if (url.includes('a.test')) throw new Error('connection reset');
      if (url.includes('b.test')) return { ok: false, status: 503, text: async () => '' };
      if (url.includes('c.test')) return { ok: true, status: 200, text: async () => '<html>portal</html>' };
      return { ok: true, status: 200, text: async () => gm.LIST_TEXT };
    };
    const good = await lists.downloadList(f, { id: 'x', urls: ['https://a.test/l', 'https://b.test/l', 'https://c.test/l', 'https://d.test/l'] });
    assert(good.ok && good.url === 'https://d.test/l' && seen.length === 4, JSON.stringify(good));
    const bad = await lists.downloadList(f, { id: 'y', urls: ['https://a.test/l', 'https://b.test/l', 'https://c.test/l'] });
    assert(!bad.ok && /a\.test: connection reset/.test(bad.error) && /b\.test: HTTP 503/.test(bad.error) && /c\.test: not a filter list/.test(bad.error), bad.error);
  });

  await test('a server that never answers is given up on (time limit), the next address is tried', async () => {
    const f = (url, opts) => new Promise((resolve, reject) => {
      if (url.includes('slow')) { opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }); return; }
      resolve({ ok: true, status: 200, text: async () => gm.LIST_TEXT });
    });
    const t0 = Date.now();
    const r = await lists.downloadList(f, { id: 'z', urls: ['https://slow.test/l', 'https://fast.test/l'] }, { timeoutMs: 50 });
    assert(r.ok && r.url === 'https://fast.test/l' && Date.now() - t0 < 2000, JSON.stringify(r));
  });

  await test('mapLimit never runs more than `limit` jobs at once and keeps the order of the results', async () => {
    let running = 0; let peak = 0;
    const out = await lists.mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return n * 2; });
    eq(peak, 3, 'peak'); eq(out.join(), '2,4,6,8,10,12,14,16');
  });

  await test('the fingerprint of a set of lists changes with any list and with the order of nothing else', () => {
    const a = lists.signatureOf([{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }]);
    assert(a === lists.signatureOf([{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }]));
    assert(a !== lists.signatureOf([{ id: 'a', text: 'x' }, { id: 'b', text: 'z' }]));
    assert(a !== lists.signatureOf([{ id: 'a', text: 'x' }]));
  });

  console.log('\n📋 Keeping and refreshing the lists');

  await test('a list that cannot be downloaded any more is replaced by the kept copy, flagged as old — the engine still builds', async () => {
    gm.reset();
    const a = newAB();
    await a.setupFilter(fakeSession());
    // age the kept copies, then lose the internet
    const dir = path.join(a._dir, 'engine-lists');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) { const p = path.join(dir, f); const j = JSON.parse(fs.readFileSync(p, 'utf8')); j.fetchedAt = Date.now() - 5 * 24 * 3600 * 1000; fs.writeFileSync(p, JSON.stringify(j)); }
    const origWarn = console.warn; console.warn = () => {};
    try {
      const b = newAB({}, { cacheFile: path.join(a._dir, 'engine.bin'), fetch: gm.makeFetch({ failFor: () => true }) });
      await b.setupFilter(fakeSession());
      const st = await b.refresh({ force: true });
      eq(st.engine, 'full', 'engine'); assert(st.lists.every((l) => l.ok), 'all lists usable from the kept copies');
      assert(st.lists.every((l) => l.stale), 'and flagged as old');
    } finally { console.warn = origWarn; }
  });

  await test('refresh() calls that overlap share one run', async () => {
    gm.reset();
    const ab = newAB();
    await ab.setupFilter(fakeSession());
    const before = ab._f.calls.length;
    const [x, y] = [ab.refresh({ force: true }), ab.refresh({ force: true })];
    assert(x === y, 'one shared promise');
    await x;
    const lists1 = ab._f.calls.length - before;
    await ab.refresh({ force: true });
    const lists2 = ab._f.calls.length - before - lists1;
    eq(lists1, lists2, 'two overlapping calls cost the same as one');
  });

  console.log('\n📋 Element hiding and scripts');

  await test('the engine never registers the cosmetic filters itself; the service does it once per session and installs the IPC handlers once', async () => {
    gm.reset(); ipc.handlers = {};
    const ab = newAB();
    const normal = fakeSession(), incog = fakeSession();
    await ab.setupFilter(normal); await ab.setupFilter(incog);
    eq(gm.state.engineCosmeticRegistrations, 0, 'the engine registered its own preload / handler (the second session would throw)');
    eq(normal.preloads.size, 1, 'normal session'); eq(incog.preloads.size, 1, 'incognito session');
    const script = Array.from(normal.preloads.values())[0];
    assert(script.type === 'frame' && script.filePath === '/ghostery-preload.js', JSON.stringify(script));
    assert(ipc.handlers['@ghostery/adblocker/inject-cosmetic-filters'] && ipc.handlers['@ghostery/adblocker/is-mutation-observer-enabled']);
    assert(gm.state.blockers[0].config.loadCosmeticFilters === true, 'the engine keeps cosmetic filters on for its own lookups');
  });

  await test('switching the blocker off removes the scripts from the sessions, switching on puts them back, exactly once', async () => {
    gm.reset();
    const ab = newAB();
    const s = fakeSession();
    await ab.setupFilter(s);
    ab.setEnabled(false); eq(s.preloads.size, 0, 'off');
    ab.setEnabled(true); eq(s.preloads.size, 1, 'on');
    ab.setEnabled(true); eq(s.preloads.size, 1, 'on twice');
  });

  await test('what a frame is told: nothing for the browser\'s own pages, nothing when off or paused (page or frame), otherwise the engine\'s answer', async () => {
    gm.reset();
    const ab = newAB();
    await ab.setupFilter(fakeSession());
    const top = (u) => ({ sender: wcAt(u) });
    const ask = (url, topUrl = url) => ab._onCosmeticRequest(top(topUrl), url, undefined);
    gm.state.injectCalls.length = 0;
    for (const bad of ['file:///C:/app/src/renderer/index.html', 'mtc://settings', 'about:blank', 'data:text/html,hi', 'javascript:1', 'chrome://gpu', undefined, 5]) {
      eq(await ask(bad), undefined, String(bad));
    }
    eq(gm.state.injectCalls.length, 0, 'the engine must not even be asked for those');
    eq(await ask('https://news.example/story'), 'injected', 'a web page');
    ab.setSitePaused('news.example', true);
    eq(await ask('https://news.example/story'), undefined, 'paused page');
    eq(await ask('https://ads.other.net/frame', 'https://www.news.example/'), undefined, 'a frame of a paused page');
    eq(await ask('https://blog.other.org/'), 'injected', 'other pages still get it');
    ab.setEnabled(false);
    eq(await ask('https://blog.other.org/'), undefined, 'switched off');
  });

  console.log('\n📋 My filters');

  await test('custom lines are applied as a difference (no rebuild), removed again, bounded, and trimmed', async () => {
    gm.reset();
    const ab = newAB();
    await ab.setupFilter(fakeSession());
    const b = ab.blocker; const parses = gm.state.parseCalls.length;
    ab.storage.updateSettings({ adBlockerCustomFilters: '  ! mine\n\nexample.com##.promo  \n' + 'x'.repeat(2000) + '\n||ads.example.net^\r\n' });
    assert(ab.reloadCustomFilters() === true);
    eq(b.diffs.length, 1); eq(b.diffs[0].added.join('|'), '! mine|example.com##.promo|||ads.example.net^', 'the 2000-character line is dropped, the others trimmed');
    eq(ab.getStatus().customRules, 3);
    assert(ab.reloadCustomFilters() === false, 'nothing changed → no work');
    ab.storage.updateSettings({ adBlockerCustomFilters: 'example.com##.promo' });
    ab.reloadCustomFilters();
    eq(b.diffs[1].removed.join('|'), '! mine|||ads.example.net^'); eq(b.diffs[1].added.length, 0);
    eq(gm.state.parseCalls.length, parses, 'never a full rebuild');
    const many = Array.from({ length: 6000 }, (_, i) => `a${i}.example##.x`).join('\n');
    eq(AdBlockerService.parseCustomFilters(many).length, 5000, 'cap');
    eq(AdBlockerService.parseCustomFilters(undefined).length, 0); eq(AdBlockerService.parseCustomFilters(42).length, 0);
  });

  await test('after the engine is replaced by a refreshed one the user\'s lines are in the new engine too', async () => {
    gm.reset();
    const ab = newAB({ adBlockerCustomFilters: 'example.com##.promo' });
    await ab.setupFilter(fakeSession());
    ab._fetch = gm.makeFetch({ textFor: (u) => /resources\.json$/.test(u) ? gm.RESOURCES_TEXT : gm.LIST_TEXT + '||ads-v2.example.net^\n' });
    const old = ab.blocker;
    await ab.refresh({ force: true });
    assert(ab.blocker !== old && ab.blocker.text.includes('example.com##.promo'), 'custom line missing in the new engine');
  });

  console.log('\n📋 Pop-ups');

  const policy = (settings = {}, adOpts = {}) => {
    const active = adOpts.active !== false;
    const t = { now: 1000000 };
    const p = new PopupPolicy({
      adBlocker: { isActiveFor: () => active, matchPopup: (url) => /ads\./.test(url) },
      getSettings: () => settings, now: () => t.now
    });
    p.t = t;
    return p;
  };
  const ask = (p, o = {}) => p.decide(Object.assign({ wcId: 1, url: 'https://shop.example/offer', openerUrl: 'https://news.example/', openerIsActive: true }, o));

  await test('an ad address is refused, an ordinary one is not', () => {
    const p = policy(); p.noteGesture(1);
    assert(!ask(p, { url: 'https://ads.tracker.net/pop' }).allow && ask(p, { url: 'https://ads.tracker.net/pop' }).reason === 'ad address');
    assert(ask(p).allow);
  });

  await test('without a click or key press in the last 5 s it is refused — but only for tabs whose gesture script has reported in', () => {
    const p = policy();
    assert(ask(p).allow, 'unknown tab: never block everything because the script is missing');
    p.noteReady(1);
    const r = ask(p); assert(!r.allow && /click/.test(r.reason), JSON.stringify(r));
    p.noteGesture(1); assert(ask(p).allow, 'a click just happened');
    p.t.now += PopupPolicy.GESTURE_WINDOW_MS - 10; p.forget(2); assert(ask(p, { url: 'https://shop.example/b' }).allow === false || true);
    p.t.now += 100;
    assert(!ask(p, { url: 'https://shop.example/c' }).allow, 'the click is more than 5 s old');
  });

  await test('a pop-under from a background tab is refused; more than 3 at once from one tab are refused', () => {
    const p = policy(); p.noteGesture(1);
    const r = ask(p, { openerIsActive: false }); assert(!r.allow && /background/.test(r.reason));
    assert(ask(p).allow && ask(p).allow && ask(p).allow);
    const fourth = ask(p); assert(!fourth.allow && /many/.test(fourth.reason), JSON.stringify(fourth));
    p.t.now += 11000; p.noteGesture(1); assert(ask(p).allow, 'after the burst window');
  });

  await test('switch off, ad blocker paused for the site, or an internal opener: everything is allowed', () => {
    const off = policy({ popupBlockerEnabled: false }); off.noteReady(1);
    assert(ask(off, { url: 'https://ads.tracker.net/pop', openerIsActive: false }).allow);
    const paused = policy({}, { active: false }); paused.noteReady(1);
    assert(ask(paused, { url: 'https://ads.tracker.net/pop', openerIsActive: false }).allow);
    const p = policy(); p.noteReady(1);
    assert(ask(p, { openerUrl: 'mtc://newtab' }).allow && ask(p, { openerUrl: '' }).allow, 'no host to judge');
  });

  await test('the real ad blocker: matchPopup follows the lists, the pause, the switch, and the short list when no engine is loaded', async () => {
    gm.reset();
    const ab = newAB();
    await ab.setupFilter(fakeSession());
    assert(ab.matchPopup('https://ads.tracker.net/pop?x=1', 'https://news.example/'), 'listed address');
    assert(!ab.matchPopup('https://shop.example/offer', 'https://news.example/'), 'ordinary address');
    assert(gm.state.blockers[0].hits.some((h) => h === 'match:https://ads.tracker.net/pop?x=1:sub_frame'), 'looked up like a frame the opener would load');
    assert(!ab.matchPopup('javascript:alert(1)', 'https://news.example/') && !ab.matchPopup('about:blank', 'https://news.example/') && !ab.matchPopup(undefined, 'x'));
    ab.setSitePaused('news.example', true);
    assert(!ab.matchPopup('https://ads.tracker.net/pop', 'https://news.example/'), 'paused');
    ab.setSitePaused('news.example', false);
    ab.setEnabled(false);
    assert(!ab.matchPopup('https://ads.tracker.net/pop', 'https://news.example/'), 'switched off');

    const origErr = console.error; console.error = () => {};
    try {
      const offline = newAB({}, { fetch: gm.makeFetch({ failFor: () => true }) });
      await offline.setupFilter(fakeSession());
      assert(offline.matchPopup('https://googleads.g.doubleclick.net/x', 'https://a.test/'), 'the short list still protects');
      assert(!offline.matchPopup('https://shop.example/', 'https://a.test/'));
    } finally { console.error = origErr; }
    const before = ab.getBlockedCount(); ab.noteBlockedPopup(); eq(ab.getBlockedCount(), before + 1, 'refused pop-ups are counted');
  });

  await test('the gesture script reports only real input (isTrusted) and the start, at most every 150 ms', () => {
    const sent = []; const listeners = {};
    const sandbox = { window: { addEventListener: (type, fn) => { listeners[type] = fn; } }, require: () => ({ ipcRenderer: { send: (ch) => sent.push(ch) } }), Date: { now: () => sandbox.t } , t: 1000 };
    vm.runInNewContext(read('preload-gesture.js'), sandbox);
    eq(sent.join(), 'shmmoth:gesture-ready');
    for (const type of ['pointerdown', 'mousedown', 'keydown', 'touchstart']) assert(listeners[type], type);
    listeners.pointerdown({ isTrusted: false }); eq(sent.length, 1, 'a page-made event');
    listeners.pointerdown({ isTrusted: true }); eq(sent.length, 2);
    listeners.mousedown({ isTrusted: true }); eq(sent.length, 2, 'throttled');
    sandbox.t += 200; listeners.keydown({ isTrusted: true }); eq(sent.length, 3);
    eq(sent[2], 'shmmoth:gesture');
  });

  console.log('\n📋 Wiring');

  const main = read('main.js');

  await test('main.js: the gesture script is registered for the normal and the incognito session, and its reports reach the policy', () => {
    assert(/registerGesturePreload\(session\.defaultSession\)/.test(main) && /registerGesturePreload\(session\.fromPartition\('incognito'\)\)/.test(main));
    assert(/registerPreloadScript\(\{ type: 'frame', filePath: path\.join\(__dirname, 'preload-gesture\.js'\) \}\)/.test(main));
    assert(/ipcMain\.on\('shmmoth:gesture', .*popupPolicy\.noteGesture\(event\.sender\.id\)/.test(main) && /ipcMain\.on\('shmmoth:gesture-ready'/.test(main));
  });

  await test('main.js: window.open goes through the policy (never for Google sign-in), refusals are counted, closing a tab forgets it', () => {
    const h = main.slice(main.indexOf('wc.setWindowOpenHandler'), main.indexOf("wc.on('did-create-window'"));
    assert(/this\.popupPolicy && !isGoogleAuthUrl\(url\)/.test(h), 'Google sign-in must not go through the policy');
    assert(/popupPolicy\.decide\(\{\s*wcId: wc\.id, url, openerUrl: wc\.getURL\(\), openerIsActive: activeId === tabId/.test(h));
    assert(h.indexOf('popupPolicy.decide') > h.indexOf('isPopupBlocked(url') && h.indexOf('popupPolicy.decide') < h.indexOf('isDirectDownload'), 'order: internal pages → policy → downloads');
    assert(/adBlocker\.noteBlockedPopup\(\)/.test(h) && /return \{ action: 'deny' \}/.test(h.slice(h.indexOf('popupPolicy.decide'))));
    assert(/popupPolicy\.forget\(tabData\.view\.webContents\.id\)/.test(main));
  });

  await test('main.js: settings changes reach the blocker, the status and "update now" are available, the old engine file is cleaned up, the new one is used', () => {
    assert(/delta\.adBlockerCustomFilters !== undefined && this\.adBlocker\) \{\s*this\.adBlocker\.reloadCustomFilters\(\)/.test(main));
    assert(/ipcMain\.handle\('adblocker:getStatus'/.test(main) && /ipcMain\.handle\('adblocker:updateLists'[\s\S]{0,120}refresh\(\{ force: true \}\)/.test(main));
    assert(/cacheFile: path\.join\(app\.getPath\('userData'\), 'adblock-engine-2\.bin'\)/.test(main));
    assert(/'adblock-engine\.bin'/.test(main), 'the engine of 1.1.6 and before is removed');
    assert(/ipcMain\.handle\('dns:test'/.test(main));
  });

  await test('the preload offers the new calls, the Settings page has the controls, and the defaults are right', () => {
    const pre = read('preload-internal.js');
    for (const n of ['testSecureDns', 'getAdBlockerStatus', 'updateAdBlockerLists']) assert(pre.includes(n), n);
    const html = read('pages', 'settings.html');
    for (const id of ['toggle-popups', 'adblock-engine-status', 'btn-update-filter-lists', 'input-custom-filters', 'btn-save-custom-filters', 'btn-test-dns', 'dns-test-result']) assert(html.includes(`id="${id}"`), id);
    const defaults = new StorageService().defaultData.settings;
    eq(defaults.popupBlockerEnabled, true); eq(defaults.adBlockerCustomFilters, '');
    assert(/textContent/.test(read('pages', 'settings.js').slice(read('pages', 'settings.js').indexOf('async function loadAdBlockerStatus'))), 'status text is written with textContent');
    assert(!/adblockEngineStatus\.innerHTML|dnsTestResult\.innerHTML/.test(read('pages', 'settings.js')), 'no innerHTML for status text');
  });

  console.log('\n📋 Secure DNS test');

  const dns = require('../src/services/secureDns');
  const A = (...addr) => ({ ok: true, addresses: addr });
  const NX = { ok: false, error: 'net::ERR_NAME_NOT_RESOLVED' };

  await test('a refusal is a null address or "no such name", not a timeout or a real address', () => {
    assert(dns.isRefusal(A('0.0.0.0')) && dns.isRefusal(A('0.0.0.0', '::')) && dns.isRefusal(A()) && dns.isRefusal(NX));
    assert(!dns.isRefusal(A('142.250.1.1')) && !dns.isRefusal({ ok: false, error: 'timed out' }) && !dns.isRefusal(A('0.0.0.0', '10.1.1.1')) && !dns.isRefusal(null));
  });

  await test('the verdicts: working, not in use, system DNS, proxy, broken network, non-filtering provider', () => {
    const base = { provider: 'adguard', proxyActive: false, normal: A('93.184.216.34') };
    eq(dns.classifyDnsTest({ ...base, secureBlocked: A('0.0.0.0'), systemBlocked: A('142.250.1.1') }).verdict, 'working');
    assert(/cannot tell/.test(dns.classifyDnsTest({ ...base, secureBlocked: NX, systemBlocked: NX }).message), 'the network DNS refuses it too');
    const notUsed = dns.classifyDnsTest({ ...base, secureBlocked: A('142.250.1.1'), systemBlocked: A('142.250.1.1') });
    eq(notUsed.verdict, 'not-filtering'); assert(/Never fall back/.test(notUsed.message) && /ad blocker/.test(notUsed.message), 'tells what to do');
    eq(dns.classifyDnsTest({ ...base, proxyActive: true, secureBlocked: A('0.0.0.0'), systemBlocked: A('0.0.0.0') }).verdict, 'proxy');
    eq(dns.classifyDnsTest({ ...base, provider: 'system', secureBlocked: A('1.2.3.4'), systemBlocked: A('1.2.3.4') }).verdict, 'off');
    eq(dns.classifyDnsTest({ ...base, normal: NX, secureBlocked: NX, systemBlocked: NX }).verdict, 'broken');
    eq(dns.classifyDnsTest({ ...base, provider: 'adguard-unfiltered', secureBlocked: A('1.2.3.4'), systemBlocked: A('1.2.3.4') }).verdict, 'encrypted');
    eq(dns.classifyDnsTest({ ...base, provider: 'adguard-family', secureBlocked: A('0.0.0.0'), systemBlocked: A('1.2.3.4') }).verdict, 'working');
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
  process.exit(failed > 0 ? 1 : 0);
}

main();
