/**
 * SHMMOTH BROWSER — Turbo engine and multi-network (bonding) behaviour
 *
 * What the old engine did wrong, and what these tests pin down:
 *   - it cut the file into equal parts, one per connection / per network: with a fast and a slow network the
 *     download lasted as long as the slow one needed for ITS half, and a single stuck connection held the end up
 *   - the second network was "tested" with a TCP connection to port 53 (blocked on many mobile networks) and virtual
 *     adapters (WSL, VMs, VPNs) counted as extra sources although they use the same uplink
 *   - a server that allows only a few connections made the other workers retry for ever
 *
 * The "networks" here are loopback addresses (127.0.0.1 = fast link, 127.0.0.2 = slow link): binding a connection to
 * a source address is exactly what the engine does with a real network card.
 *
 * Run: node tests/p1-turbo-bonding.test.js
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const TurboDownloadEngine = require('../src/services/turboDownloadEngine');

let passed = 0;
let failed = 0;
let skipped = 0;
async function test(name, fn, { skip } = {}) {
  if (skip) { console.log(`  ⏭  SKIP: ${name} (${skip})`); skipped++; return; }
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(a === b, `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const base = path.join(os.tmpdir(), `shmmoth_bonding_${Date.now()}`);
fs.mkdirSync(base, { recursive: true });

function listen(handler, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    const sockets = new Set();
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    server.listen(0, host, () => resolve({
      server, port: server.address().port,
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(r); })
    }));
  });
}

const rangeOf = (req, size) => {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  return m ? { start: Number(m[1]), end: m[2] ? Number(m[2]) : size - 1 } : null;
};

/** Answers a range request; `ratePerSec` (bytes) throttles it, `onBytes(n)` counts what was really sent. */
function serveRange(req, res, payload, r, { ratePerSec = 0, onBytes = () => {} } = {}) {
  const chunk = payload.subarray(r.start, r.end + 1);
  res.writeHead(206, { 'Content-Range': `bytes ${r.start}-${r.end}/${payload.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': chunk.length });
  if (!ratePerSec) { onBytes(chunk.length); return res.end(chunk); }
  const piece = Math.max(1024, Math.floor(ratePerSec / 20));          // 20 pieces a second
  let sent = 0;
  const timer = setInterval(() => {
    if (res.destroyed || res.writableEnded) return clearInterval(timer);
    const part = chunk.subarray(sent, sent + piece);
    sent += part.length;
    onBytes(part.length);
    if (sent >= chunk.length) { clearInterval(timer); res.end(part); } else res.write(part);
  }, 50);
  res.on('close', () => clearInterval(timer));
}

function run(engine, opts) {
  return new Promise((resolve, reject) => {
    engine.once('completed', (d) => resolve({ ok: true, ...d }));
    engine.once('error', (d) => resolve({ ok: false, ...d }));
    engine.start(opts).catch(reject);
  });
}

const LOOPBACK_ALIASES = process.platform === 'darwin' ? 'macOS has no 127.0.0.2 by default' : null;

async function main() {
  console.log('\n── Multi-network: the work follows the speed of each network ──');

  await test('a fast and a slow network: the fast one does most of the work and the download is not held up by the slow one', async () => {
    const payload = crypto.randomBytes(12 * 1024 * 1024);
    const served = { '127.0.0.1': 0, '127.0.0.2': 0 };
    const srv = await listen((req, res) => {
      const from = req.socket.remoteAddress.replace('::ffff:', '');
      const r = rangeOf(req, payload.length) || { start: 0, end: payload.length - 1 };
      serveRange(req, res, payload, r, { ratePerSec: from === '127.0.0.2' ? 300 * 1024 : 4 * 1024 * 1024, onBytes: (n) => { served[from] = (served[from] || 0) + n; } });
    });
    const savePath = path.join(base, 'bonded.bin');
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 4, blockBytes: 1024 * 1024 });
    let lastProgress = null;
    engine.on('progress', (p) => { lastProgress = p; });
    const t0 = Date.now();
    const r = await run(engine, {
      id: 'bond1', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 4, multiSource: true,
      interfaces: [{ name: 'fast', address: '127.0.0.1' }, { name: 'slow', address: '127.0.0.2' }]
    });
    const elapsed = Date.now() - t0;
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    eq(r.isMultiSource, true, 'reported as multi-network');
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
    assert(served['127.0.0.2'] > 0, 'the slow network must take part');
    assert(served['127.0.0.1'] > 3 * served['127.0.0.2'], `fast ${served['127.0.0.1']} B vs slow ${served['127.0.0.2']} B: the fast network should have carried most of the file`);
    // an equal split would need 6 MiB / 300 KiB/s = 20 s
    assert(elapsed < 6000, `took ${elapsed} ms: the slow network held the download up`);
    const names = lastProgress.interfaces.map((i) => i.name).sort().join();
    eq(names, 'fast,slow', 'both networks are reported');
    const byName = Object.fromEntries(lastProgress.interfaces.map((i) => [i.name, i.received]));
    assert(byName.fast > byName.slow, 'per-network byte counts');
  }, { skip: LOOPBACK_ALIASES });

  await test('a network that cannot reach the server is left out (the download uses the normal route)', async () => {
    const payload = crypto.randomBytes(3 * 1024 * 1024);
    const srv = await listen((req, res) => {
      const r = rangeOf(req, payload.length) || { start: 0, end: payload.length - 1 };
      serveRange(req, res, payload, r);
    });
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 4 });
    // 10.255.255.254 is not an address of this computer: a connection cannot even be bound to it
    const picked = await engine._selectInterfaces({ interfaces: [{ name: 'ok', address: '127.0.0.1' }, { name: 'dead', address: '10.255.255.254' }] }, `${srv.url}/f.bin`);
    eq(picked.length, 0, 'one working network is not bonding');
    const savePath = path.join(base, 'oneway.bin');
    const r = await run(engine, { id: 'bond2', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 4, multiSource: true, interfaces: [{ name: 'ok', address: '127.0.0.1' }, { name: 'dead', address: '10.255.255.254' }] });
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    eq(r.isMultiSource, false);
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('both networks working: both are used; a single network, or none requested, is never "bonding"', async () => {
    const srv = await listen((req, res) => { res.writeHead(206, { 'Content-Range': 'bytes 0-0/10', 'Content-Length': 1 }); res.end('x'); });
    const engine = new TurboDownloadEngine({ minTurboSize: 1024 });
    const two = await engine._selectInterfaces({ interfaces: [{ name: 'a', address: '127.0.0.1' }, { name: 'b', address: '127.0.0.2' }] }, `${srv.url}/f`);
    eq(two.map((i) => i.name).join(), LOOPBACK_ALIASES ? 'a' : 'a,b', 'both reachable') ;
    const one = await engine._selectInterfaces({ interfaces: [{ name: 'a', address: '127.0.0.1' }] }, `${srv.url}/f`);
    eq(one.length, 0, 'a single network');
    await srv.close();
  }, { skip: LOOPBACK_ALIASES });

  await test('a network that drops out: its connections move to a working network (or the normal route)', async () => {
    const engine = new TurboDownloadEngine({});
    const a = { name: 'a', address: '10.0.0.2', failed: false, failures: 0, receivedBytes: 0 };
    const b = { name: 'b', address: '192.168.1.5', failed: false, failures: 0, receivedBytes: 0 };
    const task = { interfaces: [a, b], isMultiSource: true, workers: [{ id: 0, iface: a }, { id: 1, iface: b }, { id: 2, iface: a }, { id: 3, iface: b }] };
    engine._failInterface(task, a);
    eq(a.failed, true);
    assert(task.workers.every((w) => w.iface === b), 'every worker is on the working network');
    eq(task.isMultiSource, false, 'one network left = no bonding');
    engine._failInterface(task, b);
    assert(task.workers.every((w) => w.iface === null), 'with no network left the normal route is used');
  });

  await test('a refused bind (EADDRNOTAVAIL) drops the network at once, an ordinary failure only after repeating', async () => {
    const engine = new TurboDownloadEngine({ retryBaseMs: 10 });
    const a = { name: 'a', address: '10.0.0.2', failed: false, failures: 0, receivedBytes: 0 };
    const b = { name: 'b', address: '192.168.1.5', failed: false, failures: 0, receivedBytes: 0 };
    const block = { index: 0, done: false, fetchers: new Set(), received: 0 };
    const mk = () => ({ state: 'progressing', isPaused: false, receivedBytes: 5, interfaces: [a, b], isMultiSource: true, blocks: new Map([[0, block]]), requeue: [], workers: [] });
    const t1 = mk(); const w1 = { id: 0, iface: a, failures: 0, dead: false, timer: null }; t1.workers = [w1, { id: 1, iface: b, dead: false, failures: 0 }];
    engine._onWorkerError(t1, w1, block, Object.assign(new Error('bind failed'), { code: 'EADDRNOTAVAIL', phase: 'connect' }));
    eq(a.failed, true, 'dropped at once');
    clearTimeout(w1.timer);
    a.failed = false; a.failures = 0;
    const t2 = mk(); const w2 = { id: 0, iface: a, failures: 0, dead: false, timer: null }; t2.workers = [w2, { id: 1, iface: b, dead: false, failures: 0 }];
    engine._onWorkerError(t2, w2, block, Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', phase: 'connect' }));
    eq(a.failed, false, 'one timeout is not enough');
    clearTimeout(w2.timer);
    engine._onWorkerError(t2, w2, block, Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', phase: 'connect' }));
    eq(a.failed, true, 'repeated');
    clearTimeout(w2.timer);
  });

  console.log('\n── Turbo: no connection can hold the download up ──');

  await test('a connection that hangs on one block: another connection repeats that block (no wait for the socket timeout)', async () => {
    const payload = crypto.randomBytes(6 * 1024 * 1024);
    let first = true;
    const srv = await listen((req, res) => {
      const r = rangeOf(req, payload.length);
      if (r && r.start === 0 && first) { first = false; res.writeHead(206, { 'Content-Range': `bytes 0-${r.end}/${payload.length}`, 'Content-Length': r.end + 1 }); res.write(payload.subarray(0, 1000)); return; }  // …and then silence
      serveRange(req, res, payload, r || { start: 0, end: payload.length - 1 });
    });
    const savePath = path.join(base, 'hang.bin');
    // default socket timeout (20 s): only the end game can finish this quickly
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 4, blockBytes: 1024 * 1024 });
    const t0 = Date.now();
    const r = await run(engine, { id: 'hang', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 4, multiSource: false });
    const elapsed = Date.now() - t0;
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
    assert(elapsed < 6000, `took ${elapsed} ms`);
  });

  await test('a server that allows only 2 connections at a time: the others give up, the download completes with what the server allows', async () => {
    const payload = crypto.randomBytes(8 * 1024 * 1024);
    let active = 0;
    const srv = await listen((req, res) => {
      const r = rangeOf(req, payload.length) || { start: 0, end: payload.length - 1 };
      if (active >= 2) { res.writeHead(429); return res.end('busy'); }
      active++;
      res.on('close', () => { active--; });
      serveRange(req, res, payload, r, { ratePerSec: 4 * 1024 * 1024 });
    });
    const savePath = path.join(base, 'limited.bin');
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 8, blockBytes: 1024 * 1024, retryBaseMs: 30, retryMaxMs: 120, startStallMs: 8000 });
    const r = await run(engine, { id: 'limited', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 8, multiSource: false });
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('the file is written near its front, block by block (no far-away writes that make the disk zero-fill gigabytes first)', async () => {
    const payload = crypto.randomBytes(24 * 1024 * 1024);
    const srv = await listen((req, res) => serveRange(req, res, payload, rangeOf(req, payload.length) || { start: 0, end: payload.length - 1 }, { ratePerSec: 0 }));
    const savePath = path.join(base, 'order.bin');
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 8, blockBytes: 1024 * 1024 });
    const startsSeen = [];
    const realWrite = fs.write;
    const realWriteSync = fs.writeSync;
    fs.write = function (fd, buf, off, len, pos, cb) { startsSeen.push([pos, len]); return realWrite.call(this, fd, buf, off, len, pos, cb); };
    fs.writeSync = function (fd, buf, off, len, pos) { startsSeen.push([pos, len]); return realWriteSync.call(this, fd, buf, off, len, pos); };
    let r;
    try {
      r = await run(engine, { id: 'order', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 8, multiSource: false });
    } finally { fs.write = realWrite; fs.writeSync = realWriteSync; }
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    // How far ahead of the part of the file that is already complete (from byte 0 on) was each write?
    const done = [];                                   // merged [start, end) ranges that were written so far
    let maxAhead = 0;
    const front = () => (done.length && done[0][0] === 0 ? done[0][1] : 0);
    for (const [pos, len] of startsSeen) {
      maxAhead = Math.max(maxAhead, pos - front());
      done.push([pos, pos + len]);
      done.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i + 1 < done.length;) {
        if (done[i + 1][0] <= done[i][1]) { done[i][1] = Math.max(done[i][1], done[i + 1][1]); done.splice(i + 1, 1); } else i++;
      }
    }
    // 8 connections with 1 MiB blocks: the writes stay within the blocks being fetched (about 8 MiB, a little more
    // while one block lags) — the old equal parts started the last connection 21 MiB into the file (17 MiB measured)
    assert(maxAhead <= 14 * 1024 * 1024, `a write landed ${maxAhead} bytes ahead of the complete part of the file`);
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('progress: at most 32 bars, they add up to the file, and every byte is counted once', async () => {
    const payload = crypto.randomBytes(10 * 1024 * 1024);
    const srv = await listen((req, res) => serveRange(req, res, payload, rangeOf(req, payload.length) || { start: 0, end: payload.length - 1 }, { ratePerSec: 20 * 1024 * 1024 }));
    const savePath = path.join(base, 'bars.bin');
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 6, blockBytes: 256 * 1024 });
    let maxBars = 0; let lastReceived = 0; let monotonic = true; let overshoot = false;
    engine.on('progress', (p) => {
      maxBars = Math.max(maxBars, p.segments.length);
      if (p.received < lastReceived) monotonic = false;
      lastReceived = p.received;
      if (p.received > p.total) overshoot = true;
    });
    const r = await run(engine, { id: 'bars', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 6, multiSource: false });
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    eq(r.received, payload.length, 'received');
    assert(maxBars <= 32 && maxBars >= 2, 'bars: ' + maxBars);
    assert(monotonic, 'progress must never go backwards');
    assert(!overshoot, 'received must never exceed the total');
  });

  await test('pause keeps every byte: resuming continues exactly where it stopped (no block is lost)', async () => {
    const payload = crypto.randomBytes(8 * 1024 * 1024);
    const srv = await listen((req, res) => serveRange(req, res, payload, rangeOf(req, payload.length) || { start: 0, end: payload.length - 1 }, { ratePerSec: 2 * 1024 * 1024 }));
    const savePath = path.join(base, 'pause.bin');
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 4, blockBytes: 512 * 1024 });
    const done = new Promise((resolve) => { engine.once('completed', resolve); engine.once('error', (e) => resolve({ error: e.error })); });
    await engine.start({ id: 'pause', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 4, multiSource: false });
    await sleep(700);
    eq(engine.pause('pause'), true);
    const atPause = engine.activeTasks.get('pause').receivedBytes;
    assert(atPause > 0 && atPause < payload.length, 'paused in the middle: ' + atPause);
    await sleep(300);
    eq(engine.resume('pause'), true);
    const r = await done;
    await srv.close();
    assert(!r.error, r.error);
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('the file is written under a temporary name and only takes its final name when complete (a late delete of the old placeholder cannot take it away)', async () => {
    const payload = crypto.randomBytes(6 * 1024 * 1024);
    const srv = await listen((req, res) => serveRange(req, res, payload, rangeOf(req, payload.length) || { start: 0, end: payload.length - 1 }, { ratePerSec: 3 * 1024 * 1024 }));
    const savePath = path.join(base, 'placeholder.bin');
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 4, blockBytes: 512 * 1024 });
    const done = new Promise((resolve) => { engine.once('completed', resolve); engine.once('error', (e) => resolve({ error: e.error })); });
    await engine.start({ id: 'placeholder', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 4, multiSource: false });
    await sleep(250);
    eq(fs.existsSync(savePath), false, 'the final name must not exist while downloading');
    assert(fs.existsSync(savePath + '.shmmoth-part'), 'the part file is being written');
    // the browser\'s cancelled download of the same name deleting its placeholder "late"
    fs.writeFileSync(savePath, 'placeholder'); await sleep(100); fs.unlinkSync(savePath);
    const r = await done;
    await srv.close();
    assert(!r.error, r.error);
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content under the final name');
    eq(fs.existsSync(savePath + '.shmmoth-part'), false, 'no part file left');
  });

  await test('a failed or cancelled download leaves neither the final file nor the part file', async () => {
    const srv = await listen((req, res) => { res.writeHead(403); res.end(); });
    const savePath = path.join(base, 'gone.bin');
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 2 });
    const r = await run(engine, { id: 'gone', url: `${srv.url}/f.bin`, savePath, totalBytes: 4 * 1024 * 1024, threads: 2, multiSource: false });
    await srv.close();
    eq(r.ok, false);
    eq(fs.existsSync(savePath), false); eq(fs.existsSync(savePath + '.shmmoth-part'), false);
  });

  console.log('\n── Two ways of asking: the browser\'s own network stack, and a direct connection ──');

  /** A stand-in for Electron\'s `net` (Chromium\'s stack): same interface, built on http; its requests carry x-via: chromium. */
  function fakeNet() {
    return {
      request(opts) {
        const handlers = {}; const headers = {}; let req = null;
        const api = {
          setHeader(k, v) { if (/^referer$/i.test(k)) throw new Error('net::ERR_BLOCKED_BY_CLIENT'); headers[k] = v; },
          on(ev, fn) { handlers[ev] = fn; return api; },
          abort() { if (req) req.destroy(); },
          end() {
            const u = new URL(opts.url);
            req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { ...headers, 'x-via': 'chromium' } }, (res) => { if (handlers.response) handlers.response(res); });
            req.on('error', (e) => { if (handlers.error) handlers.error(new Error('net::ERR_CONNECTION_RESET')); });
            req.end();
          }
        };
        return api;
      }
    };
  }

  /** A server that honours ranges only for the requests it likes (`allow(req)`), and sends the whole file to the others. */
  async function pickyServer(payload, allow) {
    const seenVia = [];
    const srv = await listen((req, res) => {
      seenVia.push(req.headers['x-via'] || 'node');
      const r = rangeOf(req, payload.length);
      if (r && allow(req)) return serveRange(req, res, payload, r);
      res.writeHead(200, { 'Content-Length': payload.length }); res.end(payload);
    });
    srv.seenVia = seenVia;
    return srv;
  }

  await test('a server that only gives parts to the browser\'s own stack: that way is chosen, and the download is split', async () => {
    const payload = crypto.randomBytes(5 * 1024 * 1024);
    const srv = await pickyServer(payload, (req) => req.headers['x-via'] === 'chromium');
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 4, blockBytes: 512 * 1024, net: fakeNet() });
    const probe = await engine.probe(`${srv.url}/f.bin`, { Referer: 'https://page.test/' });
    eq(probe.acceptsRanges, true); eq(probe.transport, 'chromium'); eq(probe.totalBytes, payload.length);
    const savePath = path.join(base, 'picky.bin');
    const r = await run(engine, { id: 'picky', url: `${srv.url}/f.bin`, savePath, probe, threads: 4, multiSource: false });
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    eq(r.isTurbo, true, 'split into parts');
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
    assert(srv.seenVia.filter((v) => v === 'node').length === 0, 'no request may have gone the direct way');
  });

  await test('a server that only gives parts to a direct request with the right Referer: the direct way is used after the browser\'s stack got the whole file', async () => {
    const payload = crypto.randomBytes(4 * 1024 * 1024);
    const srv = await pickyServer(payload, (req) => req.headers.referer === 'https://page.test/get');
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 4, blockBytes: 512 * 1024, net: fakeNet() });
    const probe = await engine.probe(`${srv.url}/f.bin`, { Referer: 'https://page.test/get' });
    eq(probe.acceptsRanges, true); eq(probe.transport, 'node');
    assert(probe.attempts.some((a) => a.transport === 'chromium' && a.status === 200), 'the browser\'s stack was tried first and got the whole file: ' + JSON.stringify(probe.attempts));
    const savePath = path.join(base, 'picky2.bin');
    const r = await run(engine, { id: 'picky2', url: `${srv.url}/f.bin`, savePath, probe, headers: { Referer: 'https://page.test/get' }, threads: 4, multiSource: false });
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`); eq(r.isTurbo, true);
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('when neither way gets a part, the answer says what each got (and the form "from byte 0" was tried too)', async () => {
    const payload = crypto.randomBytes(2 * 1024 * 1024);
    const srv = await pickyServer(payload, () => false);
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, net: fakeNet() });
    const probe = await engine.probe(`${srv.url}/f.bin`, {});
    await srv.close();
    eq(probe.acceptsRanges, false);
    const ways = probe.attempts.map((a) => `${a.transport}:${a.range}:${a.status}`).join(' ');
    eq(ways, 'chromium:bytes=0-0:200 chromium:bytes=0-:200 node:bytes=0-0:200');
  });

  await test('without a proxy-blind direct connection allowed (a proxy is in use) only the browser\'s stack is asked', async () => {
    const payload = crypto.randomBytes(2 * 1024 * 1024);
    const srv = await pickyServer(payload, () => false);
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, net: fakeNet() });
    const probe = await engine.probe(`${srv.url}/f.bin`, {}, { allowNode: false });
    await srv.close();
    assert(probe.attempts.every((a) => a.transport === 'chromium'), JSON.stringify(probe.attempts));
    assert(!srv.seenVia.includes('node'), 'no direct request may leave when a proxy is in use');
  });

  await test('Chromium\'s error names become the usual codes: a bad certificate or unknown host fails at once, a reset is retried', async () => {
    const engine = new TurboDownloadEngine({ minTurboSize: 1024, net: {
      request() {
        const h = {}; const api = { setHeader() {}, on(ev, fn) { h[ev] = fn; return api; }, abort() {}, end() { setImmediate(() => h.error(new Error('net::ERR_CERT_AUTHORITY_INVALID'))); } };
        return api;
      }
    } });
    const probe = await engine.probe('https://x.test/f', {}, { allowNode: false });
    assert(/ERR_CERT_AUTHORITY_INVALID/.test(probe.attempts[0].error || ''), JSON.stringify(probe.attempts));
    const mapped = (name) => TurboDownloadEngine._mapNetError(new Error('net::' + name));
    eq(mapped('ERR_CERT_COMMON_NAME_INVALID').code, 'ERR_TLS_CERT'); eq(mapped('ERR_NAME_NOT_RESOLVED').code, 'ENOTFOUND');
    eq(mapped('ERR_CONNECTION_RESET').code, 'ECONNRESET'); eq(mapped('ERR_CONNECTION_REFUSED').code, 'ECONNREFUSED');
  });

  await test('virtual adapters (WSL, VMs, VPNs, containers) are recognised so they never count as extra networks', async () => {
    const real = os.networkInterfaces;
    os.networkInterfaces = () => ({
      'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false }],
      'Ethernet 2': [{ family: 'IPv4', address: '192.168.43.5', netmask: '255.255.255.0', internal: false }],
      'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', netmask: '255.255.240.0', internal: false }],
      'VirtualBox Host-Only Network': [{ family: 'IPv4', address: '192.168.56.1', netmask: '255.255.255.0', internal: false }],
      'Tailscale': [{ family: 'IPv4', address: '100.64.0.9', netmask: '255.192.0.0', internal: false }],
      'docker0': [{ family: 'IPv4', address: '172.17.0.1', netmask: '255.255.0.0', internal: false }],
      'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }]
    });
    try {
      const list = TurboDownloadEngine.getAvailableNetworkInterfaces();
      const physical = list.filter((i) => !i.isVirtual).map((i) => i.name).sort().join();
      eq(physical, 'Ethernet 2,Wi-Fi', 'only the real networks');
      eq(list.filter((i) => i.isVirtual).length, 4, 'the rest is virtual');
    } finally { os.networkInterfaces = real; }
  });

  await test('"is this network online?" uses a port that mobile and public networks leave open (443), not 53', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'turboDownloadEngine.js'), 'utf8');
    const body = src.slice(src.indexOf('static async checkInterfaceOnline'), src.indexOf('static async getAvailableNetworkInterfacesAsync'));
    assert(/443/.test(body) && !/\b53\b/.test(body), 'checkInterfaceOnline must test port 443');
  });

  console.log(`\n  p1-turbo-bonding: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
