/**
 * P13 — Fix link, sleep / wake, data limits (1.5.5, after Plexo)
 *
 *   - Fix link: a download whose link expired (the server answers 403 from some point on) continues from the blocks it
 *     has with a new link to the same file — only what was missing is fetched again, and the file is exact; a link to a
 *     file of another size is refused and nothing changes
 *   - after the computer wakes up, the downloads the sleep cut off continue by themselves (and only those)
 *   - data limits: every network's use is counted per day / week / month and kept between runs; a download pauses when
 *     its network used up its data (saying why), and continues once the limit is raised; a reset starts the count again
 *   - the normal route is counted on the computer's only network, so a single-network PC gets its limits too
 *   - the wiring: IPC, preload, Settings, the downloads page, sleep / wake in main.js
 *
 * Run: node tests/p13-fix-link-data-limits.test.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; } catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout, message) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting for ' + message); await sleep(25); }
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SRC = path.join(__dirname, '..', 'src');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth-p13-'));

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { getPath: (n) => path.join(base, n), quit() {} }, shell: { openPath: async () => '', showItemInFolder() {} }, dialog: {} };
  return origLoad.call(this, request, ...rest);
};
fs.mkdirSync(path.join(base, 'userData'), { recursive: true });
const DownloadManager = require('../src/services/downloadManager');
const { SpeedLimiter } = require('../src/services/speedLimiter');
const TurboDownloadEngine = require('../src/services/turboDownloadEngine');

/** A range server for `files` ({ path: Buffer }); `deny(path, start)` → true answers 403 (an expired link). */
function serve(files, { deny = () => false, rate = 0 } = {}) {
  const served = [];
  const sent = {};
  const server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    const body = files[p];
    if (!body) { res.writeHead(404); return res.end(); }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
    if (deny(p, start)) { res.writeHead(403); return res.end(); }
    if (!(m && start === 0 && end === 0)) served.push({ p, start, end });
    res.writeHead(m ? 206 : 200, { 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(m ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}) });
    if (req.method === 'HEAD') return res.end();
    const count = (n) => { if (!(m && start === 0 && end === 0)) sent[p] = (sent[p] || 0) + n; };
    if (!rate) { count(end - start + 1); return res.end(body.subarray(start, end + 1)); }
    let pos = start;
    const pump = () => { if (res.destroyed) return; if (pos > end) return res.end(); const n = Math.min(65536, end - pos + 1); count(n); res.write(body.subarray(pos, pos + n)); pos += n; setTimeout(pump, Math.round(65536 / rate * 1000)); };
    pump();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, served, sent, close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) })));
}
const makeStorage = (settings = {}) => {
  const data = { downloads: [], settings: Object.assign({ askWhereToSave: false }, settings) };
  return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; }, getSettings: () => data.settings, updateSettings: (u) => Object.assign(data.settings, u), data };
};
function newManager(storage) {
  const m = new DownloadManager(storage, {});
  Object.assign(m.turboEngine.limits, { socketTimeoutMs: 400, startStallMs: 900, stallMs: 1500, retryBaseMs: 40, retryMaxMs: 150 });
  m.turboEngine.minTurboSize = 1024;
  m.getTurboThreads = () => 4;
  return m;
}

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Fix link, sleep / wake, data limits');
  console.log('══════════════════════════════════════════════════════\n');

  const SIZE = 12 * 1024 * 1024;
  const payload = crypto.randomBytes(SIZE);

  console.log('📋 Fix link');
  await test('an expired link: the download stops with its part kept; a new link to the same file finishes it, fetching only what was missing', async () => {
    let expired = false;
    const srv = await serve({ '/old.bin': payload, '/new.bin': payload }, { deny: (p, start) => p === '/old.bin' && (expired || start >= 6 * 1024 * 1024), rate: 8 * 1024 * 1024 });
    try {
      const m = newManager(makeStorage());
      const savePath = path.join(base, 'fix.bin');
      const rec = await m.startTurboDownload({ url: `${srv.url}/old.bin`, savePath, totalBytes: SIZE, threads: 4, multiSource: false });
      setTimeout(() => { expired = true; }, 900);
      const cut = await until(() => (m.downloads[rec.id].state === 'interrupted' ? m.downloads[rec.id] : null), 15000, 'the expired link to stop it');
      assert(cut.resumable && cut.resume.doneBytes > 0, 'part kept: ' + JSON.stringify({ r: cut.resumable, e: cut.error }));
      const had = cut.resume.doneBytes;
      const blockSize = cut.resume.blockSize;

      const wrong = await serve({ '/other.bin': crypto.randomBytes(SIZE - 1) });
      const refused = await m.replaceLink(rec.id, `${wrong.url}/other.bin`);
      await wrong.close();
      assert(!refused.success && /different file/.test(refused.error), JSON.stringify(refused));
      eq(m.downloads[rec.id].url, `${srv.url}/old.bin`, 'a refused link changes nothing');
      eq((await m.replaceLink(rec.id, 'ftp://x/y')).success, false, 'only http(s)');

      const res = await m.replaceLink(rec.id, `${srv.url}/new.bin`);
      assert(res.success, JSON.stringify(res));
      await until(() => m.downloads[rec.id].state === 'completed', 15000, 'the download with the new link');
      eq(sha(fs.readFileSync(savePath)), sha(payload), 'the file is exact');
      const again = srv.sent['/new.bin'] || 0;
      assert(again <= SIZE - had + 2 * blockSize, `fetched ${again} again although ${had} were there`);
      eq(m.downloads[rec.id].url, `${srv.url}/new.bin`);
    } finally { await srv.close(); }
  });

  console.log('\n📋 Sleep / wake');
  await test('after waking up, the downloads the sleep cut off continue; older ones and other states are left alone', async () => {
    const m = newManager(makeStorage());
    const now = Date.now();
    m.downloads = {
      cut: { id: 'cut', isTurbo: true, state: 'interrupted', resumable: true, endedAt: now - 5000 },
      old: { id: 'old', isTurbo: true, state: 'interrupted', resumable: true, endedAt: now - 3600 * 1000 },
      lost: { id: 'lost', isTurbo: true, state: 'interrupted', resumable: false, endedAt: now - 1000 },
      paused: { id: 'paused', isTurbo: true, state: 'paused', resumable: true, endedAt: now }
    };
    let checkpointed = 0;
    m.checkpointAll = () => { checkpointed++; };
    m.onSystemSuspend();
    eq(checkpointed, 1, 'progress saved before sleeping');
    const tried = [];
    m.resumeInterrupted = async (id) => { tried.push(id); m.downloads[id].state = 'progressing'; return true; };
    m.onSystemResume({ delays: [20, 40] });
    await sleep(150);
    eq(tried, ['cut']);
  });

  console.log('\n📋 Data limits');
  await test('use is counted per day, week and month, kept between runs, and a new period starts at zero', async () => {
    let now = Date.parse('2026-10-25T10:00:00');
    let saved = null;
    const store = { load: () => saved, save: (d) => { saved = JSON.parse(JSON.stringify(d)); } };
    const l = new SpeedLimiter({ now: () => now, store });
    l.configure({ downloadDataLimits: { 'Wi-Fi': { bytes: 1000, period: 'day' } } });
    l.take('Wi-Fi', 600);
    eq(l.used(), { 'Wi-Fi': 600 });
    assert(!l.limitReached('Wi-Fi'));
    l.save();
    const l2 = new SpeedLimiter({ now: () => now, store });
    l2.configure({ downloadDataLimits: { 'Wi-Fi': { bytes: 1000, period: 'day' } } });
    l2.take('Wi-Fi', 400);
    assert(l2.limitReached('Wi-Fi'), 'kept between runs: 600 + 400 reaches 1000');
    now = Date.parse('2026-10-26T00:05:00');
    assert(!l2.limitReached('Wi-Fi'), 'a new day');
    l2.configure({ downloadDataLimits: { 'Wi-Fi': { bytes: 1500, period: 'month' } } });
    eq(l2.used(), { 'Wi-Fi': 1000 }, 'the month still counts both days');
    l2.resetUsage('Wi-Fi');
    eq(l2.used(), { 'Wi-Fi': 0 });
  });

  await test('the normal route counts on the computer\'s only network; with several, only on the one a download uses', async () => {
    let only = 'Wi-Fi';
    const l = new SpeedLimiter({ defaultNetwork: () => only });
    l.configure({ downloadNetworkLimits: { 'Wi-Fi': 1000 } });
    l.take('', 100);
    eq(l.used(), { 'Wi-Fi': 100 });
    assert(l.take('', 2000) > 0, 'the per-network speed limit applies to a normal download too');
    only = '';
    l.take('', 500);
    eq(l.used(), { 'Wi-Fi': 2100 }, 'unknown network: not counted');
  });

  await test('a download pauses when its network used up its data, says why, and continues when the limit is raised', async () => {
    const srv = await serve({ '/big.bin': payload }, { rate: 6 * 1024 * 1024 });
    try {
      const storage = makeStorage({ downloadDataLimits: { net0: { bytes: 3 * 1024 * 1024, period: 'month' } } });
      const m = newManager(storage);
      m._defaultNetworkName = () => 'net0';
      m.applySpeedSettings();
      const savePath = path.join(base, 'limited.bin');
      const rec = await m.startTurboDownload({ url: `${srv.url}/big.bin`, savePath, totalBytes: SIZE, threads: 4, multiSource: false });
      const paused = await until(() => (m.downloads[rec.id].state === 'paused' && m.downloads[rec.id].pauseReason ? m.downloads[rec.id] : null), 15000, 'the data limit pause');
      assert(/data limit of net0/.test(paused.pauseReason), paused.pauseReason);
      const used = m.getDataUsage().used.net0;
      assert(used >= 3 * 1024 * 1024 && used < 3 * 1024 * 1024 + 4 * 2 * 1024 * 1024, 'used ' + used);
      assert(paused.received < SIZE, 'not finished');
      storage.updateSettings({ downloadDataLimits: { net0: { bytes: 100 * 1024 * 1024, period: 'month' } } });
      m.applySpeedSettings();
      eq(m.resumeDownload(rec.id), true, 'Resume');
      await until(() => m.downloads[rec.id].state === 'completed', 20000, 'the rest of the download');
      eq(sha(fs.readFileSync(savePath)), sha(payload), 'the file is exact');
      assert(!m.downloads[rec.id].pauseReason, 'the reason is gone');
    } finally { await srv.close(); }
  });

  await test('a network over its limit while another is not: a split download drops it and goes on', async () => {
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, multiSource: false });
    const l = new SpeedLimiter();
    l.configure({ downloadDataLimits: { hotspot: { bytes: 1, period: 'day' } } });
    l.take('hotspot', 10);
    engine.limiter = l;
    const a = { name: 'hotspot', address: '10.0.0.2', failed: false }; const b = { name: 'Wi-Fi', address: '10.0.0.3', failed: false };
    const task = { id: 't', state: 'progressing', interfaces: [a, b], workers: [{ id: 0, iface: a }, { id: 1, iface: b }], isMultiSource: true };
    let pausedIt = false; engine.pause = () => { pausedIt = true; };
    eq(engine._dataLimitHit(task, 'hotspot'), false, 'reads on');
    assert(a.failed && a.dataLimit && !pausedIt, 'hotspot dropped, no pause');
    eq(task.workers[0].iface, b, 'its connections moved to Wi-Fi');
  });

  console.log('\n📋 Wiring');
  await test('IPC, preload, Settings, downloads page, sleep / wake, save on quit', async () => {
    const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
    const ipc = read('browser/ipc.js');
    for (const ch of ['download:replaceLink', 'download:getDataUsage', 'download:resetDataUsage']) assert(ipc.includes(`'${ch}'`), ch);
    assert(/'downloadDataLimits'\]/.test(ipc), 'settings change re-applies data limits');
    const pre = read('preload-internal.js');
    for (const f of ['replaceDownloadLink', 'getDataUsage', 'resetDataUsage']) assert(pre.includes(f), f);
    const settings = read('pages/settings.js');
    assert(/DATA_LIMIT_CHOICES/.test(settings) && /downloadDataLimits/.test(settings) && /resetDataUsage/.test(settings));
    const dl = read('pages/downloads.js');
    assert(/btn-fix-link/.test(dl) && /replaceDownloadLink/.test(dl) && /pauseReason/.test(dl));
    assert(!/innerHTML/.test(dl.slice(dl.indexOf("const fixBtn"), dl.indexOf('if (retryBtn)'))), 'the form is built with DOM calls');
    const main = read('main.js');
    assert(/powerMonitor\.on\('suspend'/.test(main) && /powerMonitor\.on\('resume'/.test(main) && /speedLimiter\.save\(\)/.test(main));
    assert(/downloadDataLimits:\s*\{\}/.test(read('services/storage.js')));
  });

  try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\n  p13-fix-link-data-limits: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
