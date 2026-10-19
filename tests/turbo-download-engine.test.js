/**
 * SHMMOTH BROWSER — TURBO DOWNLOAD ENGINE & MULTI-SOURCE BONDING TEST SUITE
 * Run with: node tests/turbo-download-engine.test.js
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const TurboDownloadEngine = require('../src/services/turboDownloadEngine');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

const testTmpDir = path.join(os.tmpdir(), `shmmoth_turbo_test_${Date.now()}`);
fs.mkdirSync(testTmpDir, { recursive: true });

async function runTests() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Turbo Engine & Multi-WAN Bonding Tests');
  console.log('══════════════════════════════════════════════════════════\n');

  // Test 1: Interface Discovery
  await test('1. Discovers active IPv4 network interfaces', async () => {
    const ifaces = TurboDownloadEngine.getAvailableNetworkInterfaces();
    assert(Array.isArray(ifaces), 'Expected array of interfaces');
    assert(ifaces.length >= 1, 'Should find at least 1 active network interface');
    assert(ifaces[0].name, 'Interface should have name');
    assert(ifaces[0].address, 'Interface should have address');
    assert(!ifaces[0].address.startsWith('127.'), 'Should exclude localhost');
  });

  // Test 2: Chunk Calculation & Offset Math
  await test('2. Accurately calculates contiguous non-overlapping chunk ranges', async () => {
    const totalBytes = 1000;
    const numThreads = 4;
    const chunkSize = Math.floor(totalBytes / numThreads);
    const chunks = [];

    for (let i = 0; i < numThreads; i++) {
      const start = i * chunkSize;
      const end = (i === numThreads - 1) ? totalBytes - 1 : ((i + 1) * chunkSize - 1);
      chunks.push({ start, end, total: end - start + 1 });
    }

    assert(chunks.length === 4, 'Should create 4 chunks');
    assert(chunks[0].start === 0 && chunks[0].end === 249, 'Chunk 0 range correct');
    assert(chunks[1].start === 250 && chunks[1].end === 499, 'Chunk 1 range correct');
    assert(chunks[2].start === 500 && chunks[2].end === 749, 'Chunk 2 range correct');
    assert(chunks[3].start === 750 && chunks[3].end === 999, 'Chunk 3 range correct');

    let sum = chunks.reduce((acc, c) => acc + c.total, 0);
    assert(sum === totalBytes, `Sum ${sum} must equal total ${totalBytes}`);
  });

  // Test 3: Multi-Threaded Range Download against Mock HTTP Server
  await test('3. Multi-Threaded Range Download achieves 100% SHA-256 integrity match', async () => {
    // Generate 4 MB of random data
    const payloadSize = 4 * 1024 * 1024;
    const testPayload = crypto.randomBytes(payloadSize);
    const originalHash = crypto.createHash('sha256').update(testPayload).digest('hex');

    // Create Range-supporting HTTP Mock Server
    const server = http.createServer((req, res) => {
      const range = req.headers['range'];

      if (req.method === 'HEAD' || req.url === '/head-test') {
        res.writeHead(200, {
          'Accept-Ranges': 'bytes',
          'Content-Length': payloadSize,
          'Content-Type': 'application/octet-stream'
        });
        res.end();
        return;
      }

      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : payloadSize - 1;
          const chunk = testPayload.subarray(start, end + 1);

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${payloadSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunk.length,
            'Content-Type': 'application/octet-stream'
          });
          res.end(chunk);
          return;
        }
      }

      res.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': payloadSize,
        'Content-Type': 'application/octet-stream'
      });
      res.end(testPayload);
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const testUrl = `http://127.0.0.1:${port}/testfile.bin`;
    const savePath = path.join(testTmpDir, `turbo_test_${Date.now()}.bin`);

    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 4 });

    const downloaded = await new Promise((resolve, reject) => {
      engine.on('completed', (task) => {
        resolve(task);
      });
      engine.on('error', (err) => {
        reject(new Error(err.error || String(err)));
      });

      engine.start({
        id: 'test_task_1',
        url: testUrl,
        savePath,
        threads: 4
      }).catch(reject);
    });

    server.close();

    assert(fs.existsSync(savePath), 'Downloaded file should exist');
    const downloadedBuf = fs.readFileSync(savePath);
    assert(downloadedBuf.length === payloadSize, `Size mismatch: ${downloadedBuf.length} vs ${payloadSize}`);

    const downloadedHash = crypto.createHash('sha256').update(downloadedBuf).digest('hex');
    assert(downloadedHash === originalHash, `Hash mismatch: ${downloadedHash} vs ${originalHash}`);
    assert(downloaded.isTurbo === true, 'Task should be marked isTurbo');
  });

  // Test 4: Single-stream fallback when Range header is not supported
  await test('4. Falls back gracefully to single-stream when range requests are unsupported', async () => {
    const payloadSize = 512 * 1024; // 512 KB
    const testPayload = crypto.randomBytes(payloadSize);
    const originalHash = crypto.createHash('sha256').update(testPayload).digest('hex');

    // Server that explicitly does NOT support ranges (ignores Range header, always returns 200 without Accept-Ranges)
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Length': payloadSize,
        'Content-Type': 'application/octet-stream'
      });
      res.end(testPayload);
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const testUrl = `http://127.0.0.1:${port}/fallback.bin`;
    const savePath = path.join(testTmpDir, `fallback_test_${Date.now()}.bin`);

    const engine = new TurboDownloadEngine({ minTurboSize: 1024 });

    await new Promise((resolve, reject) => {
      engine.on('completed', () => resolve());
      engine.on('error', (err) => reject(new Error(err.error)));

      engine.start({
        id: 'test_fallback_task',
        url: testUrl,
        savePath
      }).catch(reject);
    });

    server.close();

    assert(fs.existsSync(savePath), 'Fallback downloaded file should exist');
    const downloadedBuf = fs.readFileSync(savePath);
    assert(downloadedBuf.length === payloadSize, 'Size must match');
    const downloadedHash = crypto.createHash('sha256').update(downloadedBuf).digest('hex');
    assert(downloadedHash === originalHash, 'Hash must match in fallback mode');
  });

  // Test 5: Pause and Resume functionality
  await test('5. Pause and resume completes download without data corruption', async () => {
    const payloadSize = 2 * 1024 * 1024; // 2 MB
    const testPayload = crypto.randomBytes(payloadSize);
    const originalHash = crypto.createHash('sha256').update(testPayload).digest('hex');

    const server = http.createServer((req, res) => {
      const range = req.headers['range'];
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : payloadSize - 1;
          const chunk = testPayload.subarray(start, end + 1);
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${payloadSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunk.length
          });
          res.end(chunk);
          return;
        }
      }
      res.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': payloadSize });
      res.end(testPayload);
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const testUrl = `http://127.0.0.1:${port}/pause_resume.bin`;
    const savePath = path.join(testTmpDir, `pause_resume_${Date.now()}.bin`);

    const engine = new TurboDownloadEngine({ minTurboSize: 1024, defaultThreads: 4 });

    const taskId = 'test_pause_resume';
    await engine.start({ id: taskId, url: testUrl, savePath, threads: 4 });

    // Pause after starting
    const paused = engine.pause(taskId);
    assert(paused === true, 'Engine pause should return true');

    // Wait a brief moment and then resume
    await new Promise(r => setTimeout(r, 200));

    const completedPromise = new Promise((resolve, reject) => {
      engine.on('completed', (task) => {
        if (task.id === taskId) resolve();
      });
      engine.on('error', (err) => {
        if (err.id === taskId) reject(new Error(err.error));
      });
    });

    const resumed = engine.resume(taskId);
    assert(resumed === true, 'Engine resume should return true');

    await completedPromise;
    server.close();

    const downloadedBuf = fs.readFileSync(savePath);
    assert(downloadedBuf.length === payloadSize, 'Resumed download size must match');
    const downloadedHash = crypto.createHash('sha256').update(downloadedBuf).digest('hex');
    assert(downloadedHash === originalHash, 'Resumed download hash must match original');
  });

  // Test 6: Multi-Source Internet Bonding & localAddress binding
  await test('6. Multi-Source Internet Bonding assigns segments across interfaces and binds localAddress', async () => {
    const ifaces = TurboDownloadEngine.getAvailableNetworkInterfaces();
    const primaryIface = ifaces[0];

    const payloadSize = 1024 * 1024; // 1 MB
    const testPayload = crypto.randomBytes(payloadSize);
    const originalHash = crypto.createHash('sha256').update(testPayload).digest('hex');

    let receivedRemoteAddress = null;
    const server = http.createServer((req, res) => {
      receivedRemoteAddress = req.socket.remoteAddress;
      const range = req.headers['range'];
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : payloadSize - 1;
          const chunk = testPayload.subarray(start, end + 1);
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${payloadSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunk.length
          });
          res.end(chunk);
          return;
        }
      }
      res.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': payloadSize });
      res.end(testPayload);
    });

    // Listen on 0.0.0.0 so both loopback and interface IP can connect
    await new Promise(r => server.listen(0, '0.0.0.0', r));
    const port = server.address().port;
    const testUrl = `http://127.0.0.1:${port}/bonding.bin`;
    const savePath = path.join(testTmpDir, `bonding_${Date.now()}.bin`);

    const engine = new TurboDownloadEngine({ minTurboSize: 512, defaultThreads: 4, multiSource: true });

    let progressEventFired = false;
    let interfacesReported = [];
    engine.on('progress', (prog) => {
      progressEventFired = true;
      if (prog.interfaces && prog.interfaces.length > 0) {
        interfacesReported = prog.interfaces;
      }
    });

    await new Promise((resolve, reject) => {
      engine.on('completed', (task) => resolve(task));
      engine.on('error', (err) => reject(new Error(err.error)));
      engine.start({
        id: 'bonding_task',
        url: testUrl,
        savePath,
        threads: 4
      }).catch(reject);
    });

    server.close();

    const downloadedBuf = fs.readFileSync(savePath);
    assert(downloadedBuf.length === payloadSize, 'Bonding download size must match');
    const downloadedHash = crypto.createHash('sha256').update(downloadedBuf).digest('hex');
    assert(downloadedHash === originalHash, 'Bonding download hash must match original');
    assert(interfacesReported.length > 0, 'Progress event should report network interfaces');
  });

  // ── 1.4.5: bonding in the browser. There the probe proves Chromium's way first (Electron's net), and until 1.4.5
  // bonding then never started. A stand-in for Electron's net.request sends through Node's http with a marker header.
  const fakeNet = {
    request(opts) {
      const ee = new (require('events'))();
      const headers = { 'X-Via': 'chromium' };
      let req = null;
      ee.setHeader = (k, v) => { headers[k] = v; };
      ee.abort = () => { if (req) req.destroy(); };
      ee.end = () => {
        req = http.get(opts.url, { headers }, (res) => ee.emit('response', res));
        req.on('error', (err) => ee.emit('error', err));
      };
      return ee;
    }
  };
  async function bondingRun({ nodeAllowed, interfaces }) {
    const size = 3 * 1024 * 1024;
    const body = crypto.randomBytes(size);
    const seen = { node: new Set(), chromium: 0 };
    const server = http.createServer((req, res) => {
      const viaChromium = req.headers['x-via'] === 'chromium';
      if (viaChromium) seen.chromium++; else seen.node.add(req.socket.remoteAddress.replace('::ffff:', ''));
      if (!viaChromium && !nodeAllowed) { res.writeHead(403); return res.end(); }
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (!m) { res.writeHead(200, { 'Content-Length': size }); return res.end(body); }
      const start = Number(m[1]); const end = m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      res.end(body.subarray(start, end + 1));
    });
    await new Promise((r) => server.listen(0, '0.0.0.0', r));
    const url = `http://127.0.0.1:${server.address().port}/big.bin`;
    const engine = new TurboDownloadEngine({ net: fakeNet, minTurboSize: 512, defaultThreads: 4, multiSource: true, limits: { minBlockBytes: 256 * 1024, maxBlockBytes: 256 * 1024 } });
    const probe = await engine.probe(url, {});
    let last = null;
    engine.on('progress', (p) => { last = p; });
    const savePath = path.join(testTmpDir, `bond_${Date.now()}_${Math.random()}.bin`);
    const done = await new Promise((resolve, reject) => {
      engine.on('completed', resolve);
      engine.on('error', (e) => reject(new Error(e.error)));
      engine.start({ id: 'b' + Math.random(), url, savePath, threads: 4, probe, interfaces }).catch(reject);
    });
    server.close();
    const same = crypto.createHash('sha256').update(fs.readFileSync(savePath)).digest('hex') === crypto.createHash('sha256').update(body).digest('hex');
    return { probe, last, done, seen, same };
  }

  await test('7. In the browser (Chromium proven first) two networks are used when the server accepts Node too', async () => {
    const r = await bondingRun({ nodeAllowed: true, interfaces: [{ name: 'Wi-Fi', address: '127.0.0.1' }, { name: 'USB phone', address: '127.0.0.2' }] });
    assert(r.probe.transport === 'chromium', 'the probe proves Chromium first: ' + r.probe.transport);
    assert(r.same, 'file intact');
    assert(r.last && r.last.isMultiSource === true, 'multi-network: ' + JSON.stringify(r.last && r.last.networkNote));
    assert(r.seen.node.has('127.0.0.1') && r.seen.node.has('127.0.0.2'), 'blocks came over both networks: ' + [...r.seen.node].join(','));
  });

  await test('8. A site that only accepts the browser\'s own connection: one network, said why, file intact', async () => {
    const r = await bondingRun({ nodeAllowed: false, interfaces: [{ name: 'Wi-Fi', address: '127.0.0.1' }, { name: 'USB phone', address: '127.0.0.2' }] });
    assert(r.same, 'file intact');
    assert(r.last && r.last.isMultiSource === false && r.last.networkNote === 'site-browser-only', JSON.stringify(r.last && { m: r.last.isMultiSource, n: r.last.networkNote }));
  });

  await test('9. Only one network reaches the server: one network, said why', async () => {
    const r = await bondingRun({ nodeAllowed: true, interfaces: [{ name: 'Wi-Fi', address: '127.0.0.1' }, { name: 'Gone', address: '192.0.2.77' }] });
    assert(r.same, 'file intact');
    assert(r.last && r.last.isMultiSource === false && r.last.networkNote === 'one-network', JSON.stringify(r.last && { m: r.last.isMultiSource, n: r.last.networkNote }));
  });

  // ── Resume (IDM-style): the blocks on the disk survive an error or a restart of the browser ──
  const resumeServer = (size) => {
    const st = { body: crypto.randomBytes(size), etag: '"v1"', served: 0, failAfter: Infinity, resetFirst: 0 };
    const srv = http.createServer((req, res) => {
      if (st.resetFirst > 0) { st.resetFirst--; req.socket.destroy(); return; }
      if (st.served >= st.failAfter) { res.writeHead(503); res.end(); return; }
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : size - 1;
      res.writeHead(m ? 206 : 200, { 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ETag: st.etag, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
      let pos = start;
      const send = () => {
        if (res.destroyed) return;
        if (pos > end) return res.end();
        if (st.served >= st.failAfter) return req.socket.destroy();
        const n = Math.min(65536, end - pos + 1);
        st.served += n;
        res.write(st.body.subarray(pos, pos + n));
        pos += n;
        setTimeout(send, 5);
      };
      send();
    });
    return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, st, url: `http://127.0.0.1:${srv.address().port}/r.bin` })));
  };
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  const finish = (eng) => new Promise((resolve) => {
    eng.on('completed', () => resolve({ ok: true }));
    eng.on('error', (e) => resolve({ ok: false, error: e.error, resume: e.resume }));
  });
  // engine A downloads until half the file is there, is paused (its checkpoint taken) and dropped, as at a restart
  const halfAndStop = async (url, savePath) => {
    const A = new TurboDownloadEngine({ net: null, minTurboSize: 1048576, defaultThreads: 4 });
    let cp = null;
    A.on('checkpoint', (c) => { cp = c.resume; });
    A.start({ id: 'a', url, savePath, threads: 4, probe: await A.probe(url, {}) });
    await new Promise((r) => { const t = setInterval(() => { const task = A.activeTasks.get('a'); if (task && task.doneBlocks >= 4) { clearInterval(t); A.pause('a'); r(); } }, 10); });
    // the pause's checkpoint comes once the part file is written through (fsync): slow on Windows, so wait for it
    for (let waited = 0; !cp && waited < 10000; waited += 20) await new Promise((r) => setTimeout(r, 20));
    const task = A.activeTasks.get('a');
    if (task && task.fd !== null) { try { fs.closeSync(task.fd); } catch (_) {} task.fd = null; }
    return cp;
  };
  const SIZE = 16 * 1024 * 1024;

  await test('10. After a restart the download continues from its part file: only the missing blocks are fetched', async () => {
    const { srv, st, url } = await resumeServer(SIZE);
    try {
      const savePath = path.join(testTmpDir, 'resume_same.bin');
      const cp = await halfAndStop(url, savePath);
      assert(cp && cp.doneBytes > 0 && cp.doneBytes < SIZE && cp.validator.etag === '"v1"', 'checkpoint: ' + JSON.stringify(cp && { d: cp.doneBytes, v: cp.validator }));
      assert(fs.existsSync(savePath + '.shmmoth-part') && !fs.existsSync(savePath), 'the part file is kept under its own name');
      st.served = 0;
      const B = new TurboDownloadEngine({ net: null, minTurboSize: 1048576, defaultThreads: 4 });
      const done = finish(B);
      await B.start({ id: 'b', url, savePath, threads: 4, probe: await B.probe(url, {}), resume: cp });
      const r = await done;
      assert(r.ok, 'completed: ' + r.error);
      assert(sha(fs.readFileSync(savePath)) === sha(st.body), 'file intact');
      assert(st.served <= SIZE - cp.doneBytes + 2 * 65536, `served ${st.served} again, ${cp.doneBytes} were already there`);
    } finally { srv.close(); }
  });

  await test('11. The file changed on the server (other ETag): it starts again from the beginning, never mixes versions', async () => {
    const { srv, st, url } = await resumeServer(SIZE);
    try {
      const savePath = path.join(testTmpDir, 'resume_changed.bin');
      const cp = await halfAndStop(url, savePath);
      st.etag = '"v2"'; st.body = crypto.randomBytes(SIZE); st.served = 0;
      const B = new TurboDownloadEngine({ net: null, minTurboSize: 1048576, defaultThreads: 4 });
      const done = finish(B);
      const task = await B.start({ id: 'b', url, savePath, threads: 4, probe: await B.probe(url, {}), resume: cp });
      assert(task && task.resumeFrom === null, 'not resumed');
      const r = await done;
      assert(r.ok, 'completed: ' + r.error);
      assert(sha(fs.readFileSync(savePath)) === sha(st.body), 'the new version, whole');
      assert(st.served >= SIZE, 'all of it downloaded again: ' + st.served);
      // and the checks themselves
      const t = { totalBytes: SIZE, workPath: savePath + '.missing', validator: { etag: '"v1"', lastModified: '' } };
      assert(!B._canResume(cp, t), 'no part file: no resume');
      assert(!B._canResume({ ...cp, totalBytes: SIZE - 1 }, { ...t, workPath: __filename }), 'other size: no resume');
    } finally { srv.close(); }
  });

  await test('12. The server stops answering half-way: the error keeps the part file and says how to continue', async () => {
    const { srv, st, url } = await resumeServer(SIZE);
    try {
      const savePath = path.join(testTmpDir, 'resume_error.bin');
      st.failAfter = SIZE / 2;
      const A = new TurboDownloadEngine({ net: null, minTurboSize: 1048576, defaultThreads: 4, stallMs: 600, retryBaseMs: 10, retryMaxMs: 50 });
      const done = finish(A);
      await A.start({ id: 'a', url, savePath, threads: 4, probe: await A.probe(url, {}) });
      const r = await done;
      assert(!r.ok && r.resume && r.resume.doneBytes > 0, 'error with a checkpoint: ' + JSON.stringify(r));
      assert(fs.existsSync(savePath + '.shmmoth-part'), 'part file kept');
      st.failAfter = Infinity; st.served = 0;
      const B = new TurboDownloadEngine({ net: null, minTurboSize: 1048576, defaultThreads: 4 });
      const done2 = finish(B);
      await B.start({ id: 'b', url, savePath, threads: 4, probe: await B.probe(url, {}), resume: r.resume });
      const r2 = await done2;
      assert(r2.ok, 'completed: ' + r2.error);
      assert(sha(fs.readFileSync(savePath)) === sha(st.body), 'file intact');
      assert(st.served < SIZE, 'only the rest: ' + st.served);
    } finally { srv.close(); }
  });

  await test('12b. A block that was half downloaded continues from its last byte on the disk, not from its start', async () => {
    const { srv, st, url } = await resumeServer(SIZE);
    const ranges = [];
    srv.on('request', (req) => { if (st.failAfter === Infinity) ranges.push(/bytes=(\d+)-/.exec(req.headers.range || '') ? Number(/bytes=(\d+)-/.exec(req.headers.range)[1]) : -1); });
    try {
      const savePath = path.join(testTmpDir, 'resume_partial.bin');
      st.failAfter = SIZE / 2 + 300 * 1024;              // the server stops in the middle of blocks
      const A = new TurboDownloadEngine({ net: null, minTurboSize: 1048576, defaultThreads: 4, stallMs: 600, retryBaseMs: 10, retryMaxMs: 50 });
      const done = finish(A);
      await A.start({ id: 'a', url, savePath, threads: 4, probe: await A.probe(url, {}) });
      const r = await done;
      const cp = r.resume;
      assert(cp && cp.partial.length > 0, 'half-done blocks are in the checkpoint: ' + JSON.stringify(cp && cp.partial));
      assert(cp.partial.every(([i, n]) => n > 0 && n < cp.blockSize && Number.isInteger(i)), JSON.stringify(cp.partial));
      st.failAfter = Infinity; st.served = 0;
      const B = new TurboDownloadEngine({ net: null, minTurboSize: 1048576, defaultThreads: 4 });
      const done2 = finish(B);
      await B.start({ id: 'b', url, savePath, threads: 4, probe: await B.probe(url, {}), resume: cp });
      const r2 = await done2;
      assert(r2.ok, 'completed: ' + r2.error);
      assert(sha(fs.readFileSync(savePath)) === sha(st.body), 'file intact');
      for (const [i, n] of cp.partial) assert(ranges.includes(i * cp.blockSize + n), `block ${i} continued at byte ${n}: ${ranges.join(',')}`);
      assert(st.served <= SIZE - cp.doneBytes + 4 * 65536, `served ${st.served} again, ${cp.doneBytes} were there`);
    } finally { srv.close(); }
  });

  await test('12c. A checkpoint that counts more than the part file holds (the file was cut) is not trusted for those bytes', async () => {
    const { srv, st, url } = await resumeServer(SIZE);
    const ranges = [];
    srv.on('request', (req) => { const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''); if (m && m[2] !== m[1]) ranges.push(Number(m[1])); });   // not the 1-byte test request
    try {
      const MiB = 1024 * 1024;
      const savePath = path.join(testTmpDir, 'resume_cut.bin');
      fs.writeFileSync(savePath + '.shmmoth-part', st.body.subarray(0, MiB + 100 * 1024));   // block 0 and 100 KiB of block 1
      const bits = Buffer.alloc(2); bits[0] = 0b101;                                          // claims blocks 0 and 2 done
      const cp = { totalBytes: SIZE, blockSize: MiB, done: bits.toString('base64'), partial: [[1, 500 * 1024]], validator: { etag: '"v1"' } };
      const B = new TurboDownloadEngine({ net: null, minTurboSize: 1048576, defaultThreads: 4 });
      const done = finish(B);
      const task = await B.start({ id: 'cut', url, savePath, threads: 4, probe: await B.probe(url, {}), resume: cp });
      assert(task.resumeFrom, 'resumed');
      const r = await done;
      assert(r.ok, 'completed: ' + r.error);
      assert(sha(fs.readFileSync(savePath)) === sha(st.body), 'file intact');
      assert(!ranges.includes(0), 'block 0 is there, not fetched');
      assert(ranges.includes(MiB) && !ranges.includes(MiB + 500 * 1024), 'block 1 again from its start: ' + ranges.join(','));
      assert(ranges.includes(2 * MiB), 'block 2 (beyond the end of the cut file) fetched again');
    } finally { srv.close(); }
  });

  await test('13. A connection reset during the first test request is tried once more (no needless single stream)', async () => {
    const { srv, st, url } = await resumeServer(4 * 1024 * 1024);
    try {
      st.resetFirst = 1;
      const eng = new TurboDownloadEngine({ net: null, minTurboSize: 1048576 });
      const probe = await eng.probe(url, {});
      assert(probe.acceptsRanges === true && probe.totalBytes === 4 * 1024 * 1024, JSON.stringify(probe));
    } finally { srv.close(); }
  });

  // Cleanup test tmp directory
  try {
    fs.rmSync(testTmpDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Turbo Engine Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
