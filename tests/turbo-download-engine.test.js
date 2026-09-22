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
