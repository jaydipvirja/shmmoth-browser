/**
 * SHMMOTH BROWSER — P0 NETWORK PRIVACY TESTS
 *   1. Turbo downloads must not bypass a configured proxy
 *   2. The ad blocker protects every session (normal + incognito) and can be toggled for all of them
 *   3. The browser never contacts Google Fonts (fonts are bundled), and CSP no longer allows it
 *
 * (Proxy application to the incognito session and the WebRTC policy live in main.js and are
 *  covered by the real-app end-to-end run.)
 *
 * Run with: node tests/p0-network-privacy.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }
function assertEqual(actual, expected, message) { assert(actual === expected, message || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_p0_net_'));
const SRC  = path.join(__dirname, '..', 'src');

// ── Module mocks: electron + the Ghostery engine (tests/fixtures/ghostery-mock.js) ──────────────────────────
const gm = require('./fixtures/ghostery-mock');
const Module = require('module');
const origLoad = Module._load;
const ipc = { handlers: {} };
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return {
      app: { getPath: (n) => path.join(ROOT, n), quit() {} },
      shell: { openPath: async () => '', showItemInFolder() {} },
      dialog: {},
      ipcMain: { handle(ch, fn) { ipc.handlers[ch] = fn; }, removeHandler(ch) { delete ipc.handlers[ch]; }, on() {}, removeAllListeners() {} }
    };
  }
  if (request === '@ghostery/adblocker-electron') return { ElectronBlocker: gm.ElectronBlocker, Request: gm.Request };
  return origLoad.call(this, request, ...args);
};

const StorageService   = require('../src/services/storage');
const DownloadManager  = require('../src/services/downloadManager');
const AdBlockerService = require('../src/services/adblocker');
const { MTC_PAGE_CSP } = require('../src/security/csp');

function newStorage(tag) {
  const s = new StorageService();
  s.storagePath = path.join(ROOT, tag, 'mtc-data.json');
  s.data = s.load();
  return s;
}

function mockItem(url = 'https://cdn.example.com/big.iso') {
  const calls = { cancel: 0, setSavePath: 0 };
  return {
    calls,
    getFilename: () => 'big.iso', getURL: () => url, getTotalBytes: () => 50 * 1024 * 1024,
    getReceivedBytes: () => 0, isPaused: () => false, canResume: () => true,
    setSavePath() { calls.setSavePath++; }, getSavePath: () => '',
    cancel() { calls.cancel++; }, pause() {}, resume() {},
    on() {}, once() {}
  };
}
function mockWebContents() {
  return {
    getURL: () => 'https://example.com/page',
    session: { getUserAgent: () => 'UA', cookies: { get: async () => [] } }
  };
}
/** A session whose webRequest.onBeforeRequest keeps only the latest listener, like Electron's. */
function webRequestSession(extra = {}) {
  const sess = { ...extra, listener: null, preloads: new Map(), nextPreload: 1 };
  sess.webRequest = {
    onBeforeRequest(filter, handler) { sess.listener = typeof filter === 'function' ? filter : (handler || null); },
    onHeadersReceived() {}
  };
  sess.registerPreloadScript = (script) => { const id = 'pre' + sess.nextPreload++; sess.preloads.set(id, script); return id; };
  sess.unregisterPreloadScript = (id) => { sess.preloads.delete(id); };
  return sess;
}
function verdict(sess, url, referrer = '') {
  let out = null;
  sess.listener({ url, referrer }, (r) => { out = r; });
  return out;
}
function mockSession() {
  const s = { downloadedUrls: [], listeners: {} };
  s.on = (evt, cb) => { s.listeners[evt] = cb; };
  s.downloadURL = (u) => s.downloadedUrls.push(u);
  return s;
}

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — P0 Network Privacy Tests           ');
  console.log('══════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('📋 1. Turbo downloads vs. proxy');
  // ═══════════════════════════════════════════════════════════════════════════

  function newManager(proxyActive) {
    const dm = new DownloadManager(newStorage('dm' + Math.random()), { isProxyActive: () => proxyActive.value });
    dm.turboStarts = [];
    dm.turboEngine.start = async (opts) => { dm.turboStarts.push(opts); };
    // the browser's own download is only given up once a ranged request has proven the link (no network in this test)
    dm.turboEngine.probe = async (url) => ({ acceptsRanges: true, totalBytes: 50 * 1024 * 1024, finalUrl: url, filename: 'big.iso', status: 206 });
    return dm;
  }

  await test('no proxy: a browser download is taken over by the Turbo engine (existing behaviour)', async () => {
    const flag = { value: false }; const dm = newManager(flag);
    const item = mockItem();
    await dm._handleDownload(item, mockWebContents(), { isIncognito: false });
    assert(dm.turboStarts.length === 1, 'turbo should have started');
    assert(item.calls.cancel === 1, 'native item should be cancelled when turbo takes over');
  });

  await test('proxy active: the download stays on the native (proxy-aware) downloader', async () => {
    const flag = { value: true }; const dm = newManager(flag);
    const item = mockItem();
    await dm._handleDownload(item, mockWebContents(), { isIncognito: false });
    assert(dm.turboStarts.length === 0, 'turbo must not start while a proxy is active');
    assert(item.calls.cancel === 0, 'native item must not be cancelled');
    assert(item.calls.setSavePath === 1, 'native item must get its save path');
    assert(Object.values(dm.downloads).length === 1 && !Object.values(dm.downloads)[0].isTurbo);
  });

  await test('proxy toggled at runtime is honoured immediately', async () => {
    const flag = { value: false }; const dm = newManager(flag);
    flag.value = true;
    await dm._handleDownload(mockItem('https://cdn.example.com/a.iso'), mockWebContents(), {});
    assert(dm.turboStarts.length === 0);
  });

  await test('manual Turbo start with a proxy active is re-routed to session.downloadURL', async () => {
    const flag = { value: true }; const dm = newManager(flag);
    const def = mockSession(), inc = mockSession();
    dm.attach(def, null, { isIncognito: false });
    dm.attach(inc, null, { isIncognito: true });
    const r1 = await dm.startTurboDownload({ url: 'https://cdn.example.com/x.iso', isIncognito: false });
    const r2 = await dm.startTurboDownload({ url: 'https://cdn.example.com/y.iso', isIncognito: true });
    assert(r1 === null && r2 === null);
    assert(def.downloadedUrls.join() === 'https://cdn.example.com/x.iso', 'normal download must use the normal session');
    assert(inc.downloadedUrls.join() === 'https://cdn.example.com/y.iso', 'incognito download must use the incognito session');
    assert(dm.turboStarts.length === 0);
  });

  await test('manual Turbo start with a proxy active and no session to fall back to fails loudly', async () => {
    const flag = { value: true }; const dm = newManager(flag);
    let msg = '';
    try { await dm.startTurboDownload({ url: 'https://cdn.example.com/x.iso' }); } catch (e) { msg = e.message; }
    assert(/proxy/i.test(msg), 'message: ' + msg);
    assert(dm.turboStarts.length === 0);
  });

  await test('a Turbo download resumed after a proxy was configured is not continued outside the proxy', async () => {
    const flag = { value: false }; const dm = newManager(flag);
    await dm._handleDownload(mockItem(), mockWebContents(), {});
    const rec = Object.values(dm.downloads)[0];
    assert(rec && rec.isTurbo);
    flag.value = true;
    rec.state = 'paused'; rec.isPaused = true;
    dm.turboStarts.length = 0;
    const ok = dm.resumeDownload(rec.id);
    assert(ok === false && rec.state === 'interrupted', 'state=' + rec.state);
    assert(dm.turboStarts.length === 0);
  });

  await test('a broken proxy-state callback is treated as "proxy active" (fail closed)', async () => {
    const dm = new DownloadManager(newStorage('dm_throw'), { isProxyActive: () => { throw new Error('boom'); } });
    assert(dm.isProxyActive(false) === true);
  });

  await test('without the callback (older callers/tests) behaviour is unchanged', async () => {
    const dm = new DownloadManager(newStorage('dm_none'));
    assert(dm.isProxyActive(false) === false);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 2. AdBlockerService with several sessions');
  // ═══════════════════════════════════════════════════════════════════════════

  /** A service with fake downloads and its own folders (nothing touches the network or the user's profile). */
  let abSeq = 0;
  const newAB = (settings = {}, opts = {}) => {
    const dir = fs.mkdtempSync(path.join(ROOT, 'ab_'));
    const fetchImpl = opts.fetch || gm.makeFetch();
    const st = newStorage('abs' + (++abSeq)); if (Object.keys(settings).length) st.updateSettings(settings);
    const ab = new AdBlockerService(st, Object.assign({ cacheFile: path.join(dir, 'engine.bin'), fetch: fetchImpl, preloadPath: () => '/preload.js' }, opts));
    ab._dir = dir; ab._fetch = fetchImpl;
    return ab;
  };

  await test('one engine is built and shared by the normal and incognito session', async () => {
    gm.reset();
    const ab = newAB();
    const normal = webRequestSession({ name: 'normal' }), incog = webRequestSession({ name: 'incognito' });
    await ab.setupFilter(normal);
    await ab.setupFilter(incog);
    assert(gm.state.parseCalls.length === 1, 'the engine was built ' + gm.state.parseCalls.length + ' times');
    const b = gm.state.blockers[0];
    assert(b.enabledSessions.has(normal) && b.enabledSessions.has(incog), 'both sessions must be protected');
  });

  await test('REGRESSION: full ad-block engine never blocks Google sign-in or its auth-only supporting resources', async () => {
    gm.reset();
    const ab = newAB();
    const s = webRequestSession();
    await ab.setupFilter(s);

    const authRef = 'https://accounts.google.com/v3/signin/identifier';
    assertEqual(Boolean(verdict(s, 'https://accounts.google.com/ServiceLogin', authRef)?.cancel), false);
    assertEqual(Boolean(verdict(s, 'https://accounts.youtube.com/o/oauth2/auth', authRef)?.cancel), false);
    assertEqual(Boolean(verdict(s, 'https://www.gstatic.com/crypto/crypt.js', authRef)?.cancel), false);
    assertEqual(Boolean(verdict(s, 'https://www.googleusercontent.com/avatar.png', authRef)?.cancel), false);
    assertEqual(Boolean(verdict(s, 'https://www.recaptcha.net/recaptcha/api2/bframe', authRef)?.cancel), false);

    // The allowlist is auth-context-only; ordinary Google traffic still goes through the filter.
    assertEqual(Boolean(verdict(s, 'https://ads.example.com/tracker', 'https://www.google.com/').cancel), true);
  });

  await test('REGRESSION: opening incognito no longer detaches the normal session from the setting', async () => {
    gm.reset();
    const ab = newAB();
    const normal = webRequestSession(), incog = webRequestSession();
    await ab.setupFilter(normal);
    await ab.setupFilter(incog);          // incognito window opened
    ab.setEnabled(false);                  // user switches the ad blocker off
    const b = gm.state.blockers[0];
    assert(!b.enabledSessions.has(normal), 'normal session still blocking after being switched off');
    assert(!b.enabledSessions.has(incog));
    ab.setEnabled(true);
    assert(b.enabledSessions.has(normal) && b.enabledSessions.has(incog));
  });

  await test('disabled setting: sessions are registered but blocking stays off until enabled', async () => {
    gm.reset();
    const ab = newAB({ adBlockerEnabled: false });
    const s = webRequestSession();
    await ab.setupFilter(s);
    assert(gm.state.blockers[0].enabledSessions.size === 0);
    ab.setEnabled(true);
    assert(gm.state.blockers[0].enabledSessions.has(s));
  });

  await test('the built-in list blocks the big ad networks immediately, before the engine has downloaded its lists', async () => {
    gm.reset();
    let release; const gate = new Promise((r) => { release = r; });
    const ab = newAB({}, { fetch: gm.makeFetch({ gate }) });
    const s = webRequestSession();
    const pending = ab.setupFilter(s);
    await new Promise((r) => setImmediate(r));
    assert(s.listener && !s.listener.engine, 'the fallback list should already be armed');
    assert(verdict(s, 'https://googleads.g.doubleclick.net/pagead/ads').cancel === true, 'ad network not blocked while the engine loads');
    assert(verdict(s, 'https://example.com/index.html').cancel === false, 'normal sites must pass');
    release(); await pending;
    assert(s.listener && s.listener.engine === true, 'once ready, the engine takes over from the fallback');
    assert(ab.getBlockedCount() === 1, 'blocked count ' + ab.getBlockedCount());
  });

  await test('offline start: the engine cannot load, the built-in list keeps protecting the session', async () => {
    gm.reset();
    const origErr = console.error; console.error = () => {};
    try {
      const ab = newAB({}, { fetch: gm.makeFetch({ failFor: () => true }) });
      const s = webRequestSession();
      await ab.setupFilter(s);
      assert(s.listener && !s.listener.engine && verdict(s, 'https://adservice.google.com/x').cancel === true);
      assert(ab.getStatus().engine === 'fallback', ab.getStatus().engine);
    } finally { console.error = origErr; }
  });

  await test('switching the blocker off lets the built-in list through too', async () => {
    gm.reset();
    const origErr = console.error; console.error = () => {};
    try {
      const ab = newAB({}, { fetch: gm.makeFetch({ failFor: () => true }) });
      const s = webRequestSession();
      await ab.setupFilter(s);
      ab.setEnabled(false);
      assert(verdict(s, 'https://googleads.g.doubleclick.net/x').cancel === false, 'still blocking while switched off');
      ab.setEnabled(true);
      assert(verdict(s, 'https://googleads.g.doubleclick.net/x').cancel === true);
    } finally { console.error = origErr; }
  });

  // ── compiled-engine cache ──
  const age = (dir, ms) => {                       // makes every kept list and the meta look `ms` old
    const t = Date.now() - ms;
    const listsDir = path.join(dir, 'engine-lists');
    for (const f of fs.readdirSync(listsDir).filter((x) => x.endsWith('.json'))) {
      const file = path.join(listsDir, f); const j = JSON.parse(fs.readFileSync(file, 'utf8')); j.fetchedAt = t; fs.writeFileSync(file, JSON.stringify(j));
    }
  };
  const flush = () => new Promise((r) => setTimeout(r, 30));

  await test('first start downloads the lists and keeps the compiled engine; the next start needs no network at all', async () => {
    gm.reset();
    const a = newAB();
    await a.setupFilter(webRequestSession());
    assert(a._fetch.calls.length > 0 && fs.existsSync(path.join(a._dir, 'engine.bin')) && fs.existsSync(path.join(a._dir, 'engine.json')), 'first start should download and keep the engine');
    const b = newAB({}, { cacheFile: path.join(a._dir, 'engine.bin'), fetch: gm.makeFetch() });
    gm.state.parseCalls.length = 0;
    await b.setupFilter(webRequestSession()); await flush();
    assert(b._fetch.calls.length === 0, 'second start: ' + b._fetch.calls.length + ' downloads');
    assert(gm.state.parseCalls.length === 0 && gm.state.deserializeCalls >= 1, 'the kept engine must be loaded, not rebuilt');
  });

  await test('the lists are fetched with the injected fetch (Electron net.fetch in the app), never with Node http', async () => {
    gm.reset();
    const ab = newAB();
    await ab.setupFilter(webRequestSession());
    assert(ab._fetch.calls.length > 5, 'the injected fetch must have been used for the lists');
    const src = fs.readFileSync(path.join(SRC, 'services', 'adblocker.js'), 'utf8');
    assert(/require\('electron'\)\.net\.fetch/.test(src) && !/cross-fetch|node-fetch|require\('https?'\)/.test(src), 'default fetch must be net.fetch');
  });

  await test('lists older than the time-to-live are downloaded again; a changed list rebuilds the engine, an unchanged one does not', async () => {
    gm.reset();
    const a = newAB();
    await a.setupFilter(webRequestSession());
    age(a._dir, 3 * 24 * 3600 * 1000);
    const b = newAB({}, { cacheFile: path.join(a._dir, 'engine.bin'), fetch: gm.makeFetch() });
    gm.state.parseCalls.length = 0;
    await b.setupFilter(webRequestSession());          // starts from the kept engine ...
    await b.refresh();                                  // ... and refreshes in the background
    assert(b._fetch.calls.length > 5, 'stale lists should have been downloaded again: ' + b._fetch.calls.length);
    assert(gm.state.parseCalls.length === 0, 'same content → no rebuild (' + gm.state.parseCalls.length + ')');
    const c = newAB({}, { cacheFile: path.join(a._dir, 'engine.bin'), fetch: gm.makeFetch({ textFor: (u) => /resources\.json$/.test(u) ? gm.RESOURCES_TEXT : gm.LIST_TEXT + '||ads-new.example.net^\n' }) });
    await c.setupFilter(webRequestSession()); age(a._dir, 3 * 24 * 3600 * 1000);
    const s2 = webRequestSession(); await c.setupFilter(s2);
    await c.refresh({ force: true });
    assert(gm.state.parseCalls.length === 1, 'changed lists → one rebuild (' + gm.state.parseCalls.length + ')');
    assert(c.blocker.text.includes('ads-new.example.net'), 'the new engine is the one in use');
  });

  await test('a refresh swaps the new engine into every session; the old one is switched off in all of them', async () => {
    gm.reset();
    const a = newAB();
    const s1 = webRequestSession(), s2 = webRequestSession();
    await a.setupFilter(s1); await a.setupFilter(s2);
    const old = a.blocker;
    a._fetch = gm.makeFetch({ textFor: (u) => /resources\.json$/.test(u) ? gm.RESOURCES_TEXT : gm.LIST_TEXT + '||ads-changed.example.net^\n' });
    a._fetch.calls.length = 0;
    // the service reads its fetch from this field when it downloads
    await a.refresh({ force: true });
    assert(a.blocker !== old, 'a new engine should be in use');
    assert(old.enabledSessions.size === 0, 'the old engine must be off in all sessions');
    assert(a.blocker.enabledSessions.has(s1) && a.blocker.enabledSessions.has(s2), 'the new engine protects both sessions');
    assert(s1.listener && s1.listener.engine === true, 'the engine listener is in place');
  });

  await test('lists: every address is tried in turn, an HTML page is not accepted as a list, and the status says what failed', async () => {
    gm.reset();
    const ab = newAB({}, { fetch: gm.makeFetch({
      textFor: (u) => (/easylist\.txt/.test(u) && /raw\.githubusercontent/.test(u)) ? '<html><body>Sign in to the Wi-Fi</body></html>' : (/resources\.json$/.test(u) ? gm.RESOURCES_TEXT : gm.LIST_TEXT + '! ' + u),
      failFor: (u) => /easyprivacy/.test(u) && !/easylist\.to/.test(u)
    }) });
    await ab.setupFilter(webRequestSession());
    const st = ab.getStatus();
    assert(st.engine === 'full' && st.listsLoaded === st.listsTotal, JSON.stringify(st));
    const source = (id) => ab.meta.lists.find((l) => l.id === id).source;
    assert(/jsdelivr/.test(source('easylist')), 'the captive-portal page must be refused and the next address used: ' + source('easylist'));
    assert(/easylist\.to/.test(source('easyprivacy')), 'the list\'s own server is the last resort: ' + source('easyprivacy'));
  });

  await test('some lists failing is not fatal: the others are used and the status names the failed ones', async () => {
    gm.reset();
    const ab = newAB({}, { fetch: gm.makeFetch({ failFor: (u) => /adguard|adtidy/i.test(u) }) });
    await ab.setupFilter(webRequestSession());
    const st = ab.getStatus();
    assert(st.engine === 'full', st.engine);
    const failed = st.lists.filter((l) => !l.ok).map((l) => l.id).sort().join();
    assert(failed === 'adguard-base,adguard-popups', failed);
    assert(st.listsLoaded === st.listsTotal - 2);
  });

  await test('no internet at all: it gives up after a few lists instead of waiting for every address of all of them', async () => {
    gm.reset();
    const origErr = console.error; console.error = () => {};
    try {
      const f = gm.makeFetch({ failFor: () => true });
      const ab = newAB({}, { fetch: f });
      await ab.setupFilter(webRequestSession());
      assert(f.calls.length < 40, 'tried ' + f.calls.length + ' addresses');
      assert(ab.getStatus().engine === 'fallback' && /no filter list/.test(ab.getStatus().error), JSON.stringify(ab.getStatus()));
    } finally { console.error = origErr; }
  });

  await test('no kept engine + no internet: the short built-in list stays in force and a later start can still download', async () => {
    gm.reset();
    const origErr = console.error; console.error = () => {};
    const dir = fs.mkdtempSync(path.join(ROOT, 'ab_off_'));
    try {
      const s = webRequestSession();
      const off = newAB({}, { cacheFile: path.join(dir, 'engine.bin'), fetch: gm.makeFetch({ failFor: () => true }) });
      await off.setupFilter(s);
      assert(!fs.existsSync(path.join(dir, 'engine.bin')) && s.listener && !s.listener.engine, 'nothing kept, fallback in force');
    } finally { console.error = origErr; }
    const on = newAB({}, { cacheFile: path.join(dir, 'engine.bin') });
    await on.setupFilter(webRequestSession());
    assert(fs.existsSync(path.join(dir, 'engine.bin')), 'second start (online) should create the engine');
  });

  await test('a damaged engine file is ignored: the engine is rebuilt from the kept lists without downloading anything', async () => {
    gm.reset();
    const a = newAB();
    await a.setupFilter(webRequestSession());
    fs.writeFileSync(path.join(a._dir, 'engine.bin'), 'garbage');
    const b = newAB({}, { cacheFile: path.join(a._dir, 'engine.bin'), fetch: gm.makeFetch() });
    gm.state.parseCalls.length = 0;
    await b.setupFilter(webRequestSession());
    assert(b._fetch.calls.length === 0, 'kept lists are fresh: ' + b._fetch.calls.length + ' downloads');
    assert(gm.state.parseCalls.length === 1 && b.getStatus().engine === 'full', 'rebuilt once');
  });

  await test('blocked-request counter aggregates across sessions', async () => {
    gm.reset();
    const ab = newAB();
    await ab.setupFilter(webRequestSession()); await ab.setupFilter(webRequestSession());
    gm.state.blockers[0].fire('request-blocked'); gm.state.blockers[0].fire('request-redirected');
    assert(ab.getBlockedCount() === 2);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 3. No third-party font requests');
  // ═══════════════════════════════════════════════════════════════════════════

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const uiFiles = walk(path.join(SRC, 'pages')).concat(walk(path.join(SRC, 'renderer')))
    .filter(f => /\.(html|css|js)$/.test(f));

  await test('no page, stylesheet or script references Google Fonts', async () => {
    for (const f of uiFiles) {
      const txt = fs.readFileSync(f, 'utf8');
      assert(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(txt), path.relative(SRC, f) + ' still references Google Fonts');
    }
  });

  await test('the bundled font + license exist and fonts.css points at the local file', async () => {
    const css = fs.readFileSync(path.join(SRC, 'pages', 'fonts.css'), 'utf8');
    const m = css.match(/url\('([^']+)'\)/);
    assert(m && !/^https?:/.test(m[1]), 'fonts.css must use a relative url');
    const font = fs.statSync(path.join(SRC, 'pages', m[1]));
    assert(font.size > 10 * 1024, 'font file looks empty');
    assert(fs.existsSync(path.join(SRC, 'pages', 'inter-OFL.txt')), 'OFL license text must ship with the font');
  });

  await test('every page that uses Inter loads the local fonts.css', async () => {
    for (const page of ['newtab', 'settings', 'crash']) {
      assert(/href="fonts\.css"/.test(fs.readFileSync(path.join(SRC, 'pages', page + '.html'), 'utf8')), page);
    }
    assert(/href="\.\.\/pages\/fonts\.css"/.test(fs.readFileSync(path.join(SRC, 'renderer', 'index.html'), 'utf8')));
  });

  await test('CSP (mtc:// header and chrome <meta>) no longer allows Google font hosts', async () => {
    assert(!/google/i.test(MTC_PAGE_CSP), MTC_PAGE_CSP);
    assert(/font-src 'self'/.test(MTC_PAGE_CSP));
    const meta = fs.readFileSync(path.join(SRC, 'renderer', 'index.html'), 'utf8').match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
    assert(!/google/i.test(meta) && /font-src 'self'/.test(meta), meta);
  });

  await test('the mtc:// protocol handler knows the woff2 mime type', async () => {
    assert(/'\.woff2':\s*'font\/woff2'/.test(fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')));
  });

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
})();
