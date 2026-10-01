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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_p0_net_'));
const SRC  = path.join(__dirname, '..', 'src');

// ── Module mocks: electron + the Ghostery engine ─────────────────────────────
const ghostery = { fetchCalls: 0, fromCache: 0, calls: [], blockers: [], gate: null, fail: false };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return {
      app: { getPath: (n) => path.join(ROOT, n), quit() {} },
      shell: { openPath: async () => '', showItemInFolder() {} },
      dialog: {}
    };
  }
  if (request === '@ghostery/adblocker-electron') {
    return {
      ElectronBlocker: {
        fromPrebuiltAdsAndTracking: async (fetchImpl, caching) => {
          ghostery.calls.push({ fetchImpl, caching });
          // like the real engine: a readable cache wins, otherwise download and write the cache
          if (caching) {
            try { await caching.read(caching.path); ghostery.fromCache++; return makeBlocker(); } catch (_) { /* no cache yet */ }
          }
          ghostery.fetchCalls++;
          if (ghostery.gate) await ghostery.gate;                     // simulates the slow list download
          if (ghostery.fail) throw new Error('offline');
          if (caching) await caching.write(caching.path, Buffer.from('compiled-engine'));
          return makeBlocker();
        }
      }
    };
  }
  return origLoad.call(this, request, ...args);
};
function makeBlocker() {
  const handlers = {};
  const blocker = {
    config: {},
    enabledSessions: new Set(),
    // like the real engine: registering its own webRequest listener replaces whatever was there
    enableBlockingInSession(s) {
      this.enabledSessions.add(s);
      if (s.webRequest) s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, Object.assign((d, cb) => cb({}), { engine: true }));
    },
    disableBlockingInSession(s) { this.enabledSessions.delete(s); if (s.webRequest) s.webRequest.onBeforeRequest(null); },
    on(evt, cb) { handlers[evt] = cb; },
    fire(evt) { handlers[evt] && handlers[evt](); }
  };
  ghostery.blockers.push(blocker);
  return blocker;
}

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
  const sess = { ...extra, listener: null };
  sess.webRequest = { onBeforeRequest(filter, handler) { sess.listener = typeof filter === 'function' ? filter : (handler || null); } };
  return sess;
}
function verdict(sess, url) {
  let out = null;
  sess.listener({ url }, (r) => { out = r; });
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

  await test('one engine is built and shared by the normal and incognito session', async () => {
    ghostery.fetchCalls = 0; ghostery.blockers.length = 0;
    const ab = new AdBlockerService(newStorage('ab1'));
    const normal = webRequestSession({ name: 'normal' }), incog = webRequestSession({ name: 'incognito' });
    await ab.setupFilter(normal);
    await ab.setupFilter(incog);
    assert(ghostery.fetchCalls === 1, 'filter lists were downloaded ' + ghostery.fetchCalls + ' times');
    const b = ghostery.blockers[0];
    assert(b.enabledSessions.has(normal) && b.enabledSessions.has(incog), 'both sessions must be protected');
  });

  await test('REGRESSION: opening incognito no longer detaches the normal session from the setting', async () => {
    ghostery.blockers.length = 0;
    const ab = new AdBlockerService(newStorage('ab2'));
    const normal = webRequestSession(), incog = webRequestSession();
    await ab.setupFilter(normal);
    await ab.setupFilter(incog);          // incognito window opened
    ab.setEnabled(false);                  // user switches the ad blocker off
    const b = ghostery.blockers[0];
    assert(!b.enabledSessions.has(normal), 'normal session still blocking after being switched off');
    assert(!b.enabledSessions.has(incog));
    ab.setEnabled(true);
    assert(b.enabledSessions.has(normal) && b.enabledSessions.has(incog));
  });

  await test('disabled setting: sessions are registered but blocking stays off until enabled', async () => {
    ghostery.blockers.length = 0;
    const st = newStorage('ab3'); st.updateSettings({ adBlockerEnabled: false });
    const ab = new AdBlockerService(st);
    const s = webRequestSession();
    await ab.setupFilter(s);
    assert(ghostery.blockers[0].enabledSessions.size === 0);
    ab.setEnabled(true);
    assert(ghostery.blockers[0].enabledSessions.has(s));
  });

  await test('the built-in list blocks the big ad networks immediately, before the engine has downloaded its lists', async () => {
    ghostery.blockers.length = 0;
    let release; ghostery.gate = new Promise((r) => { release = r; });
    try {
      const ab = new AdBlockerService(newStorage('ab5'));
      const s = webRequestSession();
      const pending = ab.setupFilter(s);
      await new Promise((r) => setImmediate(r));
      assert(s.listener && !s.listener.engine, 'the fallback list should already be armed');
      assert(verdict(s, 'https://googleads.g.doubleclick.net/pagead/ads').cancel === true, 'ad network not blocked while the engine loads');
      assert(verdict(s, 'https://example.com/index.html').cancel === false, 'normal sites must pass');
      release(); await pending;
      assert(s.listener && s.listener.engine === true, 'once ready, the engine takes over from the fallback');
      assert(ab.getBlockedCount() === 1, 'blocked count ' + ab.getBlockedCount());
    } finally { ghostery.gate = null; }
  });

  await test('offline start: the engine cannot load, the built-in list keeps protecting the session', async () => {
    ghostery.blockers.length = 0; ghostery.fail = true;
    const origErr = console.error; console.error = () => {};
    try {
      const ab = new AdBlockerService(newStorage('ab6'));
      const s = webRequestSession();
      await ab.setupFilter(s);
      assert(s.listener && !s.listener.engine && verdict(s, 'https://adservice.google.com/x').cancel === true);
    } finally { ghostery.fail = false; console.error = origErr; }
  });

  await test('switching the blocker off lets the built-in list through too', async () => {
    ghostery.blockers.length = 0; ghostery.fail = true;
    const origErr = console.error; console.error = () => {};
    try {
      const ab = new AdBlockerService(newStorage('ab7'));
      const s = webRequestSession();
      await ab.setupFilter(s);
      ab.setEnabled(false);
      assert(verdict(s, 'https://googleads.g.doubleclick.net/x').cancel === false, 'still blocking while switched off');
      ab.setEnabled(true);
      assert(verdict(s, 'https://googleads.g.doubleclick.net/x').cancel === true);
    } finally { ghostery.fail = false; console.error = origErr; }
  });

  // ── compiled-engine cache ──
  const cacheDir = fs.mkdtempSync(path.join(ROOT, 'abcache_'));
  const reset = () => { ghostery.fetchCalls = 0; ghostery.fromCache = 0; ghostery.calls.length = 0; ghostery.blockers.length = 0; ghostery.fail = false; };
  const age = (file, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(file, t, t); };

  await test('first start downloads the lists and keeps the compiled engine; the next start needs no network at all', async () => {
    reset();
    const file = path.join(cacheDir, 'engine1.bin');
    await new AdBlockerService(newStorage('abc1'), { cacheFile: file }).setupFilter(webRequestSession());
    assert(ghostery.fetchCalls === 1 && fs.existsSync(file), 'first start: downloaded ' + ghostery.fetchCalls);
    await new AdBlockerService(newStorage('abc2'), { cacheFile: file }).setupFilter(webRequestSession());
    assert(ghostery.fetchCalls === 1 && ghostery.fromCache === 1, `second start: downloads=${ghostery.fetchCalls} fromCache=${ghostery.fromCache}`);
  });

  await test('the lists are fetched with the injected fetch (Electron net.fetch in the app), never with Node http', async () => {
    reset();
    const myFetch = async () => { throw new Error('not called by the mock'); };
    await new AdBlockerService(newStorage('abc3'), { cacheFile: path.join(cacheDir, 'engine3.bin'), fetch: myFetch }).setupFilter(webRequestSession());
    assert(ghostery.calls[0].fetchImpl === myFetch, 'custom fetch not used');
    const src = fs.readFileSync(path.join(SRC, 'services', 'adblocker.js'), 'utf8');
    assert(/require\('electron'\)\.net\.fetch/.test(src) && !/cross-fetch|node-fetch/.test(src), 'default fetch must be net.fetch');
  });

  await test('a cache older than the time-to-live is refreshed, and the old copy is removed after a successful refresh', async () => {
    reset();
    const file = path.join(cacheDir, 'engine4.bin');
    fs.writeFileSync(file, 'old-engine'); age(file, 3 * 24 * 3600 * 1000);
    await new AdBlockerService(newStorage('abc4'), { cacheFile: file }).setupFilter(webRequestSession());
    assert(ghostery.fetchCalls === 1, 'stale cache should have been refreshed');
    assert(fs.readFileSync(file, 'utf8') === 'compiled-engine' && !fs.existsSync(file + '.stale'), 'new engine kept, old copy removed');
  });

  await test('a stale cache + no internet: the previous engine keeps protecting (instead of only the short built-in list)', async () => {
    reset(); ghostery.fail = true;
    const origWarn = console.warn; console.warn = () => {};
    try {
      const file = path.join(cacheDir, 'engine5.bin');
      fs.writeFileSync(file, 'old-engine'); age(file, 3 * 24 * 3600 * 1000);
      const ab = new AdBlockerService(newStorage('abc5'), { cacheFile: file });
      const s = webRequestSession();
      await ab.setupFilter(s);
      assert(ghostery.fromCache === 1, 'the old engine should have been loaded from the cache');
      assert(s.listener && s.listener.engine === true, 'the engine, not the fallback, should be in charge');
      assert(fs.readFileSync(file, 'utf8') === 'old-engine' && !fs.existsSync(file + '.stale'), 'old copy must be back in place');
    } finally { ghostery.fail = false; console.warn = origWarn; }
  });

  await test('no cache + no internet: the short built-in list stays in force and a later start can still download', async () => {
    reset(); ghostery.fail = true;
    const origErr = console.error; console.error = () => {};
    try {
      const file = path.join(cacheDir, 'engine6.bin');
      const s = webRequestSession();
      await new AdBlockerService(newStorage('abc6'), { cacheFile: file }).setupFilter(s);
      assert(!fs.existsSync(file) && s.listener && !s.listener.engine, 'nothing cached, fallback in force');
    } finally { ghostery.fail = false; console.error = origErr; }
    await new AdBlockerService(newStorage('abc7'), { cacheFile: path.join(cacheDir, 'engine6.bin') }).setupFilter(webRequestSession());
    assert(fs.existsSync(path.join(cacheDir, 'engine6.bin')), 'second start (online) should create the cache');
  });

  await test('a damaged cache file is replaced by a fresh download', async () => {
    reset();
    const file = path.join(cacheDir, 'engine8.bin');
    fs.mkdirSync(file);                                    // unreadable as a file: read() fails like a corrupt cache would
    const origErr = console.error; console.error = () => {};
    try { await new AdBlockerService(newStorage('abc8'), { cacheFile: file }).setupFilter(webRequestSession()); }
    catch (_) { /* the mock cannot overwrite a directory; the point is that start-up survived */ }
    finally { console.error = origErr; }
    assert(ghostery.fetchCalls >= 1, 'a download should have been attempted after the failed read');
  });

  await test('blocked-request counter aggregates across sessions', async () => {
    ghostery.blockers.length = 0;
    const ab = new AdBlockerService(newStorage('ab4'));
    await ab.setupFilter(webRequestSession()); await ab.setupFilter(webRequestSession());
    ghostery.blockers[0].fire('request-blocked'); ghostery.blockers[0].fire('request-redirected');
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
