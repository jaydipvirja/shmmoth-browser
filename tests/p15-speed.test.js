/**
 * P15 — Speed (1.5.6)
 *
 *   - the ad-block engine is built in a worker thread with the real engine: it blocks what the lists say, the engine
 *     file is written by the worker and read back at the next start, and the browser's thread keeps running meanwhile
 *   - without the worker (or when it cannot run) the engine is built on the browser's thread as before
 *   - the request hub's match patterns are worked out once and still match as before
 *   - the wiring: connect ahead while typing (tabs.js, IPC, preload, address bar, Settings, default on, start-up warm-up),
 *     the tab strip redraws only changed tabs
 *
 * Run: node tests/p15-speed.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdBlockerService = require('../src/services/adblocker');
const filterLists = require('../src/services/filterLists');
const { matchesPattern } = require('../src/services/webRequestHub');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; } catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const SRC = path.join(__dirname, '..', 'src');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth-p15-'));

function storage() {
  const settings = { adBlockerEnabled: true, adBlockerAllowlist: [], adBlockerCustomFilters: '' };
  return { getSettings: () => settings, updateSettings: (d) => Object.assign(settings, d) };
}
/** Lists of `rules` network rules each (one list blocks ads.example.com). */
function listFetch(rules = 2000) {
  return async (url) => {
    if (/resources\.json$/.test(url)) return { ok: false, status: 404, text: async () => '' };
    let text = '! Title: test list\n||ads.example.com^\n##.ad-banner\n';
    for (let i = 0; i < rules; i++) text += `||tracker${i}-${url.length}.example.net^$third-party\n##.ad-slot-${i}\n`;
    return { ok: true, status: 200, text: async () => text };
  };
}
const blocks = (blocker, url) => {
  const { Request } = require('@ghostery/adblocker-electron');
  return Boolean(blocker.match(Request.fromRawDetails({ url, sourceUrl: 'https://news.example.org/', type: 'script' })).match);
};

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Speed: background engine, hub patterns, wiring');
  console.log('══════════════════════════════════════════════════════\n');

  console.log('📋 The ad-block engine is built beside the browser');
  await test('built in a worker thread: it blocks, the worker wrote the engine file, the next start reads it', async () => {
    const cacheFile = path.join(TMP, 'w', 'engine.bin');
    const ab = new AdBlockerService(storage(), { cacheFile, fetch: listFetch(300) });
    const built = await ab._buildEngine();
    assert(built.changed && ab.lastBuild.where === 'worker', 'where: ' + JSON.stringify(ab.lastBuild));
    assert(blocks(built.blocker, 'https://ads.example.com/a.js'), 'blocks the listed host');
    assert(!blocks(built.blocker, 'https://cdn.example.org/app.js'), 'not other hosts');
    assert(built.meta.networkRules > 300 && built.meta.cosmeticRules > 300, 'counted: ' + built.meta.networkRules);
    assert(fs.existsSync(cacheFile) && !fs.existsSync(cacheFile + '.tmp'), 'engine file written');
    const again = new AdBlockerService(storage(), { cacheFile, fetch: listFetch(300) });
    const kept = again._readEngineCache();
    assert(kept && kept.meta.signature === built.meta.signature, 'meta matches the engine file');
    assert(blocks(kept.blocker, 'https://ads.example.com/a.js'), 'the kept engine blocks too');
    assert(ab.getStatus().builtIn === 'worker');
  });

  await test('the browser\'s thread keeps running while big lists are parsed', async () => {
    const ab = new AdBlockerService(storage(), { cacheFile: path.join(TMP, 'big', 'engine.bin'), fetch: listFetch(6000) });
    let last = Date.now(); let worst = 0;
    const tick = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last); last = n; }, 10);
    const t = Date.now();
    await ab._collectLists();                                  // the downloads first (both runs read the same lists)
    const before = Date.now();
    worst = 0; last = before;
    await ab._buildEngine();
    const took = Date.now() - before;
    clearInterval(tick);
    const inline = new AdBlockerService(storage(), { buildInWorker: false, cacheFile: path.join(TMP, 'big2', 'engine.bin'), fetch: listFetch(6000) });
    const s = Date.now();
    await inline._buildEngine();
    const inlineMs = Date.now() - s;
    console.log(`         (worker build ${took} ms, longest pause ${worst} ms; on this thread ${inlineMs} ms; lists ${before - t} ms)`);
    assert(ab.lastBuild.where === 'worker' && inline.lastBuild.where === 'main');
    // the reading back of the finished engine is the only part on this thread: well under the full build
    if (inlineMs > 600) assert(worst < inlineMs * 0.6, `paused ${worst} ms of a ${inlineMs} ms build`);
  });

  await test('without the worker the engine is built here, as before', async () => {
    const ab = new AdBlockerService(storage(), { buildInWorker: false, cacheFile: path.join(TMP, 'm', 'engine.bin'), fetch: listFetch(100) });
    const built = await ab._buildEngine();
    assert(ab.lastBuild.where === 'main' && blocks(built.blocker, 'https://ads.example.com/a.js'));
    assert(fs.existsSync(path.join(TMP, 'm', 'engine.bin')));
  });

  await test('a worker that fails: built here instead, nothing lost', async () => {
    const ab = new AdBlockerService(storage(), { cacheFile: path.join(TMP, 'f', 'engine.bin'), fetch: listFetch(100) });
    ab._buildInBackground = () => Promise.reject(new Error('no worker here'));
    const built = await ab._buildEngine();
    assert(ab.lastBuild.where === 'main' && blocks(built.blocker, 'https://ads.example.com/a.js'));
  });

  console.log('\n📋 Request hub patterns');
  await test('patterns worked out once still match as before', async () => {
    const cases = [
      ['<all_urls>', 'https://a.com/x', true],
      ['*://*.google.com/*', 'https://accounts.google.com/signin?x=1', true],
      ['*://*.google.com/*', 'https://google.com/', true],
      ['*://*.google.com/*', 'https://notgoogle.com/', false],
      ['https://x.com/path*', 'https://x.com/path/a?b', true],
      ['https://x.com/path*', 'http://x.com/path', false],
      ['https://x.com/a.b', 'https://x.com/aXb', false],
      ['*://*/*', 'file:///etc/passwd', false],
      ['not a pattern', 'https://a.com/', false]
    ];
    for (let round = 0; round < 2; round++) {
      for (const [p, u, want] of cases) assert(matchesPattern(p, u) === want, `${p} ${u} → ${!want}`);
    }
  });

  console.log('\n📋 Wiring');
  await test('connect ahead while typing, and the tab strip redraws only what changed', async () => {
    const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
    const tabs = read('browser/tabs.js');
    assert(/preconnectFor\(input, isIncognito = false\)/.test(tabs) && /\.preconnect\(\{ url: origin, numSockets: 1 \}\)/.test(tabs));
    assert(/preconnectWhileTyping === false\) return ''/.test(tabs), 'can be switched off');
    assert(/\^\(javascript\|data\|vbscript\|file\|mtc\|about\):/.test(tabs), 'only web addresses');
    assert(read('browser/ipc.js').includes("ipcMain.handle('omnibox:preconnect', secureHandlerRaw("));
    assert(/preconnect:\s+\(text\)\s+=> ipcRenderer\.invoke\('omnibox:preconnect', text\)/.test(read('preload-internal.js')));
    const app = read('renderer/app.js');
    assert(/omniboxInput\.addEventListener\('input'[\s\S]{0,300}api\.preconnect\(omniboxInput\.value\)/.test(app), 'address bar asks');
    assert(/const kept = drawnTabs\.get\(tab\.id\);/.test(app) && !/tabsStrip\.innerHTML = ''/.test(app), 'strip reuses tabs');
    assert(/preconnectFor\(this\._getSearchUrl\('a'\)\)/.test(read('main.js')), 'search engine warmed up at start');
    assert(read('pages/settings.html').includes('id="toggle-preconnect"') && /preconnectWhileTyping: togglePreconnect\.checked/.test(read('pages/settings.js')));
    assert(/preconnectWhileTyping:\s+true/.test(read('services/storage.js')), 'on by default');
    assert(fs.existsSync(path.join(SRC, 'services', 'adblockWorker.js')));
  });

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\n  p15-speed: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
