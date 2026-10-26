/**
 * P12 — Auto streams and speed limits (1.5.4, after Plexo)
 *
 *   - the controller's rules, exactly (services/streamController.js): doubling while every stream gets data, a
 *     server's refusals cap a network and it recovers one stream a minute, a disk that cannot keep up halves the
 *     streams and they come back when it keeps up, nothing grows without waiting blocks
 *   - the speed limiter (services/speedLimiter.js): a token bucket, Slow mode stands in for the total, per network
 *   - the engine with a real local server: auto grows past its start, settles at what a server accepts and still
 *     finishes byte-exact, a fixed count stays fixed, and a speed limit really slows a download
 *   - the wiring: Settings, defaults, the download manager
 *
 * Run: node tests/p12-auto-streams.test.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { StreamController, DiskWatch, RECOVER_MS, DISK_RECOVER_MS } = require('../src/services/streamController');
const { SpeedLimiter, Bucket } = require('../src/services/speedLimiter');
const TurboDownloadEngine = require('../src/services/turboDownloadEngine');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; } catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const x = JSON.stringify(a); const y = JSON.stringify(b); if (x !== y) throw new Error(`${m || 'expected'}: ${y}, got ${x}`); }
const SRC = path.join(__dirname, '..', 'src');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth-p12-'));
const net = (o) => Object.assign({ id: 'a', streams: 4, answered: 4, refused: 0, served: 4 }, o);

/** A range server: each connection sends at most `rate` bytes/s; `maxConns` at once, the rest get 503. */
function rangeServer(payload, { rate = 4 * 1024 * 1024, maxConns = Infinity } = {}) {
  let active = 0; let peak = 0; let refused = 0;
  const server = http.createServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'Content-Length': payload.length, 'Accept-Ranges': 'bytes' }); return res.end(req.method === 'HEAD' ? undefined : payload); }
    if (active >= maxConns && req.headers.range !== 'bytes=0-0') { refused++; res.writeHead(503); return res.end(); }
    const start = Number(m[1]); const end = m[2] ? Math.min(Number(m[2]), payload.length - 1) : payload.length - 1;
    // a connection counts while it sends a part of the file (the engine's 1-byte probe does not), once
    const counted = !(start === 0 && end === 0);
    if (counted) { active++; peak = Math.max(peak, active); }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${payload.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
    let pos = start;
    const step = 64 * 1024; const every = Math.max(1, Math.round((step / rate) * 1000));
    let left = false;
    const done = () => { if (counted && !left) { left = true; active--; } };
    res.on('finish', done);
    res.on('close', done);
    const pump = () => {
      if (res.destroyed) return;
      if (pos > end) return res.end();
      const next = Math.min(end + 1, pos + step);
      res.write(payload.subarray(pos, next));
      pos = next;
      setTimeout(pump, every);
    };
    pump();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, url: `http://127.0.0.1:${server.address().port}/f.bin`,
    get peak() { return peak; }, get refused() { return refused; }
  })));
}

function download(engine, opts) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    engine.on('completed', (t) => { if (t.id === opts.id) resolve({ ms: Date.now() - t0 }); });
    engine.on('error', (e) => { if (e.id === opts.id) reject(new Error(e.error || 'error')); });
    engine.start(opts).catch(reject);
  });
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Auto streams & speed limits');
  console.log('══════════════════════════════════════════════════════\n');

  console.log('📋 The controller');
  await test('every stream got data: the network doubles, up to the limit and the waiting blocks', async () => {
    const c = new StreamController(16);
    eq(c.tick({ now: 0, networks: [net()], spareWork: 100 }), [{ kind: 'add', networkId: 'a', count: 4 }]);
    eq(c.tick({ now: 1, networks: [net({ streams: 12, answered: 12, served: 12 })], spareWork: 100 }), [{ kind: 'add', networkId: 'a', count: 4 }], 'capped at 16');
    eq(c.tick({ now: 2, networks: [net()], spareWork: 2 }), [{ kind: 'add', networkId: 'a', count: 2 }], 'only as many as blocks wait');
    eq(c.tick({ now: 3, networks: [net({ answered: 3 })], spareWork: 100 }), [], 'one stream has had no data yet');
  });

  await test('a server that refuses some streams while serving others caps the network; one more each minute', async () => {
    const c = new StreamController(16);
    eq(c.tick({ now: 0, networks: [net({ streams: 8, answered: 8, refused: 3, served: 5 })], spareWork: 100 }), [{ kind: 'retire', networkId: 'a', count: 3 }]);
    eq(c.limit('a'), 5);
    eq(c.tick({ now: 1000, networks: [net({ streams: 5, answered: 5, served: 5 })], spareWork: 100 }), [], 'no growth past the ceiling');
    eq(c.tick({ now: RECOVER_MS, networks: [net({ streams: 5, answered: 5, served: 5 })], spareWork: 100 }), [{ kind: 'add', networkId: 'a', count: 1 }]);
    eq(c.limit('a'), 6);
  });

  await test('refused while nothing comes in (busy server, dead link) does not cut the count', async () => {
    const c = new StreamController(16);
    eq(c.tick({ now: 0, networks: [net({ refused: 2, served: 0 })], spareWork: 100 }), []);
    eq(c.limit('a'), 16);
  });

  await test('a disk that cannot keep up halves the streams; when it keeps up again they come back', async () => {
    const c = new StreamController(16);
    const behind = { reading: 'behind', since: 0 };
    eq(c.tick({ now: 100, networks: [net({ streams: 16, answered: 16, served: 16 })], spareWork: 100, disk: behind }), [], 'patience first');
    eq(c.tick({ now: 600, networks: [net({ streams: 16, answered: 16, served: 16 })], spareWork: 100, disk: behind }), [{ kind: 'retire', networkId: 'a', count: 8 }]);
    const ok = { reading: 'keeping-up', since: 700 };
    eq(c.tick({ now: 700 + DISK_RECOVER_MS, networks: [net({ streams: 8, answered: 8, served: 8 })], spareWork: 100, disk: ok }), [{ kind: 'add', networkId: 'a', count: 8 }]);
  });

  await test('the disk watch: behind only while writes still land', async () => {
    const d = new DiskWatch();
    d.landed(1000); d.sample(1100, 4, 3); eq(d.reading, 'behind');
    d.sample(2000, 4, 3); eq(d.reading, 'unknown', 'nothing landed for a while: stopped, not slow');
    d.sample(2100, 4, 1); eq(d.reading, 'keeping-up');
  });

  console.log('\n📋 Speed limits');
  await test('a bucket: a second of credit at most, the debt is the wait', async () => {
    const b = new Bucket(1000, 0);
    eq(b.take(500, 0), 500, 'starts empty: 500 bytes = half a second');
    eq(Math.round(b.take(0, 10000)), 0, 'credit never above a second');
    eq(Math.round(b.take(1500, 10000)), 500);
  });

  await test('Slow mode stands in for the total; per-network limits apply to their network only', async () => {
    let now = 0;
    const l = new SpeedLimiter({ now: () => now });
    assert(!l.active);
    l.configure({ downloadSpeedLimit: 1000, downloadSlowMode: true, downloadSlowModeSpeed: 100, downloadNetworkLimits: { 'Wi-Fi': 50, bad: 'x' } });
    eq(Math.round(l.take('', 100)), 1000, 'slow mode 100 B/s: 100 bytes = 1 s');
    now = 10000;
    eq(Math.round(l.take('Wi-Fi', 100)), 1000, 'Wi-Fi 50 B/s: a second of credit (50), the other 50 bytes wait a second');
    l.configure({ downloadSpeedLimit: 0, downloadSlowMode: false, downloadNetworkLimits: {} });
    assert(!l.active && l.take('Wi-Fi', 1e9) === 0);
  });

  console.log('\n📋 The engine, with a real server');
  const payload = crypto.randomBytes(24 * 1024 * 1024);

  await test('auto: starts with 4 connections and grows while every one gets data; the file is exact', async () => {
    const s = await rangeServer(payload, { rate: 2 * 1024 * 1024 });
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, multiSource: false });
    const savePath = path.join(TMP, 'auto.bin');
    await download(engine, { id: 'auto', url: s.url, savePath, threads: 'auto', multiSource: false });
    s.server.close();
    assert(s.peak >= 12, 'never more than ' + s.peak + ' connections (a fixed 8 would reach 8)');
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('auto: a server that takes 3 connections at once — the extra ones stop, the download finishes exact', async () => {
    const s = await rangeServer(payload, { rate: 8 * 1024 * 1024, maxConns: 3 });
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, multiSource: false, retryBaseMs: 50, retryMaxMs: 200 });
    const savePath = path.join(TMP, 'capped.bin');
    await download(engine, { id: 'capped', url: s.url, savePath, threads: 'auto', multiSource: false });
    s.server.close();
    assert(s.peak <= 3, 'peak ' + s.peak);
    assert(s.refused < 60, 'kept knocking: ' + s.refused + ' refusals');
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('a fixed count stays fixed', async () => {
    const s = await rangeServer(payload, { rate: 4 * 1024 * 1024 });
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, multiSource: false });
    const savePath = path.join(TMP, 'fixed.bin');
    await download(engine, { id: 'fixed', url: s.url, savePath, threads: 4, multiSource: false });
    s.server.close();
    assert(s.peak <= 4, 'peak ' + s.peak);
    eq(sha(fs.readFileSync(savePath)), sha(payload));
  });

  await test('a speed limit slows the download down to it (6 MB at 2 MB/s ≈ 3 s), and the file is exact', async () => {
    const small = payload.subarray(0, 6 * 1024 * 1024);
    const s = await rangeServer(small, { rate: 64 * 1024 * 1024 });
    const limiter = new SpeedLimiter();
    limiter.configure({ downloadSpeedLimit: 2 * 1024 * 1024 });
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, multiSource: false, limiter });
    const savePath = path.join(TMP, 'limited.bin');
    const { ms } = await download(engine, { id: 'limited', url: s.url, savePath, threads: 'auto', multiSource: false });
    s.server.close();
    assert(ms >= 2300 && ms < 9000, 'took ' + ms + ' ms');
    eq(sha(fs.readFileSync(savePath)), sha(small));
  });

  console.log('\n📋 Wiring');
  await test('Settings: Auto is the default and first choice; speed limit, Slow mode and per-network limits are there', async () => {
    const html = fs.readFileSync(path.join(SRC, 'pages', 'settings.html'), 'utf8');
    assert(/<option value="auto" selected>Auto \(Recommended\)<\/option>/.test(html));
    for (const id of ['select-speed-limit', 'toggle-slow-mode', 'select-slow-speed', 'network-limits']) assert(html.includes(`id="${id}"`), id);
    const js = fs.readFileSync(path.join(SRC, 'pages', 'settings.js'), 'utf8');
    assert(/downloadSpeedLimit/.test(js) && /downloadSlowMode/.test(js) && /downloadNetworkLimits/.test(js));
    assert(!/innerHTML/.test(js.slice(js.indexOf('async function loadSpeedLimits'), js.indexOf('if (selectSpeedLimit)'))), 'network names go in with DOM calls');
  });

  await test('defaults, the manager and the settings hook', async () => {
    const storage = fs.readFileSync(path.join(SRC, 'services', 'storage.js'), 'utf8');
    assert(/downloadSpeedLimit:\s*0/.test(storage) && /downloadSlowMode:\s*false/.test(storage));
    const dm = fs.readFileSync(path.join(SRC, 'services', 'downloadManager.js'), 'utf8');
    assert(/limiter: this\.speedLimiter/.test(dm) && /: 'auto';/.test(dm) && /record\.autoStreams \? 'auto'/.test(dm));
    const ipc = fs.readFileSync(path.join(SRC, 'browser', 'ipc.js'), 'utf8');
    assert(/applySpeedSettings\(\)/.test(ipc));
  });

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\n  p12-auto-streams: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
