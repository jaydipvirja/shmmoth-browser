/**
 * P14 — Privacy phase 3 (1.5.6): clear on exit, kept sites, tracker cookie cleanup
 *
 *   - clear on exit clears only what is ticked; with nothing ticked nothing happens; cookies of the kept sites (and of
 *     their company's other sites: accounts.google.com, gstatic.com …) stay; a cut-off run is finished at the next start
 *   - tracker cleanup: trackers you have not used for 7 days lose cookies and site data; sites you used (or a site of
 *     the same company), kept sites, sites with tracking protection off and sites open in a tab are never touched; off
 *     in Settings → nothing
 *   - interactions: one note per site per minute, kept on disk, forgotten after 90 days
 *   - the wiring: main.js, tabs.js, IPC, preload, Settings, the shield, defaults
 *
 * Run: node tests/p14-privacy-cleaner.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PrivacyCleaner, TRACKER_IDLE_MS } = require('../src/services/privacyCleaner');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; } catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const SRC = path.join(__dirname, '..', 'src');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth-p14-'));
const DAY = 24 * 3600 * 1000;

/** A session with cookies, and a record of what was cleared. */
function fakeSession(domains) {
  const jar = domains.map((d, i) => ({ domain: d, name: 'c' + i, path: '/', secure: true }));
  const calls = [];
  return {
    jar, calls,
    cookies: {
      get: async () => jar.slice(),
      remove: async (url, name) => { const i = jar.findIndex((c) => c.name === name); if (i >= 0) jar.splice(i, 1); calls.push(['remove', url]); },
      flushStore: async () => calls.push(['flush'])
    },
    clearStorageData: async (o) => calls.push(['storage', o.origin || 'all', (o.storages || []).join(',')]),
    clearCache: async () => calls.push(['cache'])
  };
}
function fakeStorage(settings) {
  const data = { settings: Object.assign({ clearOnExit: {}, clearOnExitKeepSites: ['google.com', 'youtube.com'], trackerCookieCleanup: true }, settings), values: {}, historyCleared: 0 };
  return {
    data,
    getSettings: () => data.settings,
    get: (k, d) => (k in data.values ? data.values[k] : d),
    set: (k, v) => { data.values[k] = v; },
    clearHistory: () => { data.historyCleared++; return true; }
  };
}
const sitesLeft = (sess) => [...new Set(sess.jar.map((c) => c.domain.replace(/^\./, '')))].sort();

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Privacy phase 3: clear on exit, tracker cleanup');
  console.log('══════════════════════════════════════════════════════\n');

  console.log('📋 Clear on exit');
  await test('nothing ticked (the default): nothing is cleared', async () => {
    const sess = fakeSession(['.example.com']);
    const storage = fakeStorage({});
    const c = new PrivacyCleaner({ getSession: () => sess, storage });
    eq(await c.clearOnExit(), { cleared: false });
    eq(sess.calls, []); eq(storage.data.historyCleared, 0);
  });

  await test('cookies ticked: every site loses them except the kept ones and their company\'s sites', async () => {
    const sess = fakeSession(['.example.com', 'shop.example.org', '.google.com', 'accounts.google.com', '.youtube.com', '.gstatic.com', '.doubleclick.net', '.mybank.in']);
    const storage = fakeStorage({ clearOnExit: { cookies: true }, clearOnExitKeepSites: ['google.com', 'youtube.com', 'mybank.in'] });
    let downloadsCleared = 0;
    const c = new PrivacyCleaner({ getSession: () => sess, storage, getDownloads: () => ({ clearCompleted: () => { downloadsCleared++; return 1; } }) });
    await c.clearOnExit();
    eq(sitesLeft(sess), ['accounts.google.com', 'google.com', 'gstatic.com', 'mybank.in', 'youtube.com']);
    assert(sess.calls.some((x) => x[0] === 'storage' && x[1] === 'all' && /localstorage/.test(x[2])), 'site storage cleared');
    assert(!sess.calls.some((x) => x[0] === 'cache'), 'cache not ticked');
    eq(storage.data.historyCleared, 0); eq(downloadsCleared, 0);
    eq(storage.data.values.privacyClearPending, null, 'the pending flag is cleared when done');
  });

  await test('history, cache and the download list, each only when ticked', async () => {
    const sess = fakeSession(['.example.com']);
    const storage = fakeStorage({ clearOnExit: { history: true, cache: true, downloads: true } });
    let downloadsCleared = 0;
    const c = new PrivacyCleaner({ getSession: () => sess, storage, getDownloads: () => ({ clearCompleted: () => { downloadsCleared++; return 2; } }) });
    await c.clearOnExit();
    eq(storage.data.historyCleared, 1); eq(downloadsCleared, 1);
    assert(sess.calls.some((x) => x[0] === 'cache'));
    eq(sitesLeft(sess), ['example.com'], 'cookies not ticked: kept');
  });

  await test('a run cut off (the flag still set) is finished at the next start', async () => {
    const sess = fakeSession(['.example.com', '.google.com']);
    const storage = fakeStorage({});
    storage.data.values.privacyClearPending = { cookies: true };
    const c = new PrivacyCleaner({ getSession: () => sess, storage });
    await c.finishPendingAtStart();
    eq(sitesLeft(sess), ['google.com']);
    eq(storage.data.values.privacyClearPending, null);
    const again = await c.finishPendingAtStart();
    eq(again, { cleared: false }, 'nothing pending');
  });

  console.log('\n📋 Tracker cookie cleanup');
  const NOW = Date.parse('2026-10-26T12:00:00');
  const trackers = new Set(['doubleclick.net', 'tracker.com', 'facebook.com', 'youtube.com', 'adnet.io', 'openedtracker.com', 'relaxed.com']);
  const stats = { trackerSites: () => trackers };
  const domains = ['.doubleclick.net', '.tracker.com', '.facebook.com', 'm.facebook.com', '.youtube.com', '.adnet.io', '.openedtracker.com', '.relaxed.com', '.news.example', '.instagram.com'];

  await test('trackers not used for 7 days lose cookies and site data; used, kept, relaxed and open sites stay', async () => {
    const sess = fakeSession(domains);
    const storage = fakeStorage({ privacyCookieAllowSites: ['relaxed.com'] });
    const c = new PrivacyCleaner({ getSession: () => sess, storage, stats, now: () => NOW, openSites: () => ['openedtracker.com'] });
    c.interactions = { 'instagram.com': NOW - 2 * DAY, 'adnet.io': NOW - TRACKER_IDLE_MS - DAY };
    const removed = (await c.cleanTrackers()).sort();
    eq(removed, ['adnet.io', 'doubleclick.net', 'tracker.com'], 'removed');
    // facebook.com: a tracker, but instagram.com (same company) was used 2 days ago
    eq(sitesLeft(sess), ['facebook.com', 'instagram.com', 'm.facebook.com', 'news.example', 'openedtracker.com', 'relaxed.com', 'youtube.com']);
    assert(sess.calls.some((x) => x[0] === 'storage' && x[1] === 'https://tracker.com'), 'site data of the tracker cleared');
    assert(!sess.calls.some((x) => x[0] === 'storage' && x[1] === 'all'), 'nothing else cleared');
    eq(c.lastCleanup.sites.length, 3);
  });

  await test('switched off in Settings: nothing is touched', async () => {
    const sess = fakeSession(domains);
    const c = new PrivacyCleaner({ getSession: () => sess, storage: fakeStorage({ trackerCookieCleanup: false }), stats, now: () => NOW });
    eq(await c.cleanTrackers(), []);
    eq(sess.calls, []);
  });

  console.log('\n📋 Interactions');
  await test('one note per site per minute; kept on disk; forgotten after 90 days', async () => {
    let now = NOW;
    const file = path.join(TMP, 'interactions.json');
    const c = new PrivacyCleaner({ getSession: () => null, storage: fakeStorage({}), file, now: () => now });
    c.noteInteraction('https://www.example.com/a');
    const first = c.interactions['example.com'];
    now += 30 * 1000; c.noteInteraction('https://example.com/b');
    eq(c.interactions['example.com'], first, 'within a minute: not noted again');
    now += 60 * 1000; c.noteInteraction('https://example.com/c');
    eq(c.interactions['example.com'], now);
    c.noteInteraction('mtc://settings'); c.noteInteraction('not a url');
    eq(Object.keys(c.interactions), ['example.com']);
    c.interactions['old.com'] = now - 91 * DAY;
    c.flush();
    const back = new PrivacyCleaner({ getSession: () => null, storage: fakeStorage({}), file, now: () => now });
    eq(Object.keys(back.interactions), ['example.com'], 'kept, without the 90-day-old one');
  });

  console.log('\n📋 Wiring');
  await test('main.js, tabs.js, IPC, preload, Settings, the shield, defaults', async () => {
    const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
    const main = read('main.js');
    assert(main.indexOf('finishPendingAtStart()') > 0 && main.indexOf('finishPendingAtStart()') < main.indexOf('this.createMainWindow()'), 'finished before the first window');
    assert(/this\.privacyCleaner\.start\(\)/.test(main) && /privacyCleaner\.flush\(\)/.test(main));
    assert(/clearOnExit\(\)/.test(read('browser/session.js')));
    const tabs = read('browser/tabs.js');
    assert(/if \(!isIncognito\) \{\s*wc\.on\('input-event'/.test(tabs) && /noteInteraction\(wc\.getURL\(\)\)/.test(tabs), 'interactions noted, never in Incognito');
    const ipc = read('browser/ipc.js');
    for (const ch of ['privacy:setSiteKept', 'privacy:getCleaner', 'privacy:cleanTrackersNow']) assert(ipc.includes(`'${ch}'`), ch);
    const pre = read('preload-internal.js');
    for (const f of ['setPrivacySiteKept', 'getPrivacyCleaner', 'cleanTrackersNow']) assert(pre.includes(f), f);
    const html = read('pages/settings.html');
    for (const id of ['exit-clear-history', 'exit-clear-cookies', 'exit-clear-cache', 'exit-clear-downloads', 'keep-cookie-sites', 'keep-site-form', 'toggle-tracker-cleanup', 'btn-clean-trackers']) assert(html.includes(`id="${id}"`), id);
    const js = read('pages/settings.js');
    assert(!/innerHTML/.test(js.slice(js.indexOf('function renderKeepSites'), js.indexOf('for (const [id, key] of Object.entries(EXIT_CLEAR))'))), 'DOM calls only');
    const shield = read('pages/shield-bubble.html');
    assert(shield.includes('id="toggle-keep"') && /setPrivacySiteKept/.test(shield));
    assert(/const height = 462;/.test(read('browser/bubbles.js')));
    const storage = read('services/storage.js');
    assert(/clearOnExit:\s*\{ history: false, cookies: false, cache: false, downloads: false \}/.test(storage), 'clear on exit off by default');
    assert(/clearOnExitKeepSites:\s*\['google\.com', 'youtube\.com'\]/.test(storage) && /trackerCookieCleanup:\s*true/.test(storage));
  });

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\n  p14-privacy-cleaner: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
