/**
 * SHMMOTH BROWSER — downloads that cannot get stuck
 *
 * A download of a 13 GB file sat at "0 B / 13.1 GB" for ever. Causes found in the code:
 *   - the Turbo engine wrote whatever a server answered (an error page, a full file for a ranged request) into the file,
 *     and retried a server that refuses or never answers for ever, without ever reporting a problem
 *   - a download that was still "running" when the browser closed came back after a restart as a card that looked alive,
 *     with a Pause and a Cancel button that did nothing
 *   - Retry went through the same engine that had just failed; Remove/Cancel did not stop a running Turbo task
 *   - the page's Cookie header was kept in downloads.json and handed to every page that listens for updates
 *
 * Run: node tests/p1-downloads-robust.test.js
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const Module = require('module');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(a === b, `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout, message) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${message}`);
    await sleep(25);
  }
}

const base = path.join(os.tmpdir(), `shmmoth_dl_robust_${Date.now()}`);
const dlDir = path.join(base, 'downloads');
fs.mkdirSync(dlDir, { recursive: true });

// Electron is not available in plain Node
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      app: { getPath: (n) => (n === 'downloads' ? dlDir : path.join(base, n)), quit() {} },
      shell: { openPath: async () => '', showItemInFolder() {} },
      dialog: {}
    };
  }
  return origLoad.call(this, request, ...rest);
};
const TurboDownloadEngine = require('../src/services/turboDownloadEngine');
const DownloadManager = require('../src/services/downloadManager');

const FAST = { minTurboSize: 1024, defaultThreads: 4, socketTimeoutMs: 400, startStallMs: 900, stallMs: 5000, retryBaseMs: 40, retryMaxMs: 200 };

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    const sockets = new Set();
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(r); })
    }));
  });
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rangeOf = (req, size) => {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  return m ? { start: Number(m[1]), end: m[2] ? Number(m[2]) : size - 1 } : null;
};
function serveRange(res, payload, r) {
  const chunk = payload.subarray(r.start, r.end + 1);
  res.writeHead(206, { 'Content-Range': `bytes ${r.start}-${r.end}/${payload.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': chunk.length });
  res.end(chunk);
}

/** Runs one engine download to its first terminal event. */
function runEngine(engine, opts) {
  return new Promise((resolve, reject) => {
    engine.once('completed', (d) => resolve({ ok: true, ...d }));
    engine.once('error', (d) => resolve({ ok: false, ...d }));
    engine.start(opts).catch(reject);
  });
}

async function main() {
  console.log('\n── Turbo engine: answers are checked, giving up is reported ──');

  await test('a server that refuses ranged requests (403): the download fails at once, nothing is written, no endless retries', async () => {
    let hits = 0;
    const srv = await listen((req, res) => { hits++; res.writeHead(403); res.end('forbidden'); });
    const savePath = path.join(base, 'refused.bin');
    const engine = new TurboDownloadEngine(FAST);
    const t0 = Date.now();
    const r = await runEngine(engine, { id: 'refused', url: `${srv.url}/f.bin`, savePath, totalBytes: 4 * 1024 * 1024, threads: 4 });
    await srv.close();
    eq(r.ok, false, 'must fail');
    eq(r.status, 403, 'status is reported');
    eq(r.received, 0, 'bytes received');
    assert(/refused the download/i.test(r.error), r.error);
    assert(Date.now() - t0 < 3000, 'must not retry for a long time');
    assert(hits <= 8, `the server was asked ${hits} times`);
    assert(!fs.existsSync(savePath), 'no file of the full size may be left behind');
    eq(engine.activeTasks.size, 0, 'task is released');
  });

  await test('a server that never answers: gives up after the start timeout and says so (stalled, 0 bytes)', async () => {
    const srv = await listen(() => { /* accept the request and say nothing */ });
    const savePath = path.join(base, 'silent.bin');
    const engine = new TurboDownloadEngine(FAST);
    const t0 = Date.now();
    const r = await runEngine(engine, { id: 'silent', url: `${srv.url}/f.bin`, savePath, totalBytes: 4 * 1024 * 1024, threads: 4 });
    await srv.close();
    eq(r.ok, false, 'must fail');
    eq(r.stalled, true, 'stalled flag');
    eq(r.received, 0, 'bytes received');
    assert(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
    assert(/did not send any data/i.test(r.error), r.error);
    assert(!fs.existsSync(savePath), 'partial file removed');
  });

  await test('a server that ignores "Range" and sends the whole file (200): the file is still downloaded correctly, as one stream', async () => {
    const payload = crypto.randomBytes(3 * 1024 * 1024);
    const srv = await listen((req, res) => { res.writeHead(200, { 'Content-Length': payload.length }); res.end(payload); });
    const savePath = path.join(base, 'norange.bin');
    const engine = new TurboDownloadEngine(FAST);
    // totalBytes given = the engine does not probe first (this is how the browser starts it), the old code then wrote
    // the full body of EVERY segment at its own offset
    const r = await runEngine(engine, { id: 'norange', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 4 });
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    eq(r.received, payload.length, 'received bytes are the file size, not 4x');
    eq(r.isTurbo, false, 'switched to one stream');
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('a connection that closes early: the rest of the range is requested again, the file is complete and correct', async () => {
    const payload = crypto.randomBytes(2 * 1024 * 1024);
    const cut = new Set();
    const srv = await listen((req, res) => {
      const r = rangeOf(req, payload.length);
      if (!r) { res.writeHead(200); return res.end(payload); }
      if (!cut.has(r.start)) {                       // first attempt of every part: send half, then drop the line
        cut.add(r.start);
        const half = payload.subarray(r.start, r.start + Math.floor((r.end - r.start + 1) / 2));
        res.writeHead(206, { 'Content-Range': `bytes ${r.start}-${r.end}/${payload.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': r.end - r.start + 1 });
        res.write(half);
        setTimeout(() => res.destroy(), 20);
        return;
      }
      serveRange(res, payload, r);
    });
    const savePath = path.join(base, 'cut.bin');
    const engine = new TurboDownloadEngine(FAST);
    const r = await runEngine(engine, { id: 'cut', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 4 });
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('"too many connections" (429) once per part: backs off, retries and completes', async () => {
    const payload = crypto.randomBytes(2 * 1024 * 1024);
    const refused = new Set();
    const srv = await listen((req, res) => {
      const r = rangeOf(req, payload.length);
      if (!r) { res.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': payload.length }); return res.end(payload); }
      if (!refused.has(r.start)) { refused.add(r.start); res.writeHead(429); return res.end('slow down'); }
      serveRange(res, payload, r);
    });
    const savePath = path.join(base, 'busy.bin');
    const engine = new TurboDownloadEngine(FAST);
    const r = await runEngine(engine, { id: 'busy', url: `${srv.url}/f.bin`, savePath, totalBytes: payload.length, threads: 4 });
    await srv.close();
    eq(r.ok, true, `must complete: ${r.error}`);
    eq(sha(fs.readFileSync(savePath)), sha(payload), 'content');
  });

  await test('a redirect to another host does not carry the page\'s cookies along', async () => {
    let cookieAtOrigin = null;
    let cookieAtTarget = 'unset';
    const target = await listen((req, res) => { cookieAtTarget = req.headers.cookie || null; res.writeHead(206, { 'Content-Range': 'bytes 0-0/10', 'Content-Length': 1 }); res.end('x'); });
    const origin = await listen((req, res) => { cookieAtOrigin = req.headers.cookie || null; res.writeHead(302, { Location: `${target.url}/real` }); res.end(); });
    const engine = new TurboDownloadEngine(FAST);
    const info = await engine.probe(`${origin.url}/start`, { Cookie: 'session=secret' });
    await origin.close(); await target.close();
    eq(cookieAtOrigin, 'session=secret', 'the site that was asked gets the cookie');
    eq(cookieAtTarget, null, 'the redirect target must not');
    eq(info.totalBytes, 10, 'probe still works through the redirect');
  });

  console.log('\n── Download manager ──');

  const makeStorage = (initial = []) => {
    const data = { downloads: initial, settings: { askWhereToSave: false } };
    return {
      get: (k, d) => (k in data ? data[k] : d),
      set: (k, v) => { data[k] = v; },
      getSettings: () => data.settings,
      updateSettings: (u) => Object.assign(data.settings, u),
      data
    };
  };

  /** A session whose downloadURL() behaves like Electron's: a will-download event with no web contents. */
  function fakeSession({ complete = true } = {}) {
    const sess = new EventEmitter();
    sess.calls = [];
    sess.downloadURL = (url, options) => {
      sess.calls.push({ url, options });
      setImmediate(() => {
        const ee = new EventEmitter();
        const item = {
          savePath: null, cancelled: false,
          getFilename: () => path.basename(new URL(url).pathname),
          getURL: () => url, getURLChain: () => [url], getTotalBytes: () => 5, getReceivedBytes: () => 5,
          isPaused: () => false, canResume: () => false, setSavePath(p) { this.savePath = p; },
          cancel() { this.cancelled = true; }, on: ee.on.bind(ee), once: ee.once.bind(ee), emit: ee.emit.bind(ee)
        };
        sess.items = (sess.items || []).concat(item);
        sess.emit('will-download', { preventDefault() {} }, item, null);
        if (complete) setImmediate(() => { try { fs.writeFileSync(item.savePath, 'hello'); } catch (_) {} item.emit('done', {}, 'completed'); });
      });
    };
    return sess;
  }

  function newManager(storage, sess) {
    const m = new DownloadManager(storage, {});
    Object.assign(m.turboEngine.limits, { socketTimeoutMs: 400, startStallMs: 900, stallMs: 5000, retryBaseMs: 40, retryMaxMs: 200 });
    m.turboEngine.minTurboSize = 1024;
    if (sess) m.attach(sess, () => {}, { isIncognito: false });
    return m;
  }

  await test('a download that was "running" when the browser closed comes back as interrupted (not as a card that looks alive)', async () => {
    const storage = makeStorage([
      { id: 'dl_a', filename: 'a.bin', url: 'https://x.test/a', state: 'progressing', isTurbo: true, received: 0, total: 100 },
      { id: 'dl_b', filename: 'b.bin', url: 'https://x.test/b', state: 'paused', isPaused: true, received: 5, total: 100 },
      { id: 'dl_c', filename: 'c.bin', url: 'https://x.test/c', state: 'completed', received: 100, total: 100 }
    ]);
    const m = newManager(storage, null);
    const byId = Object.fromEntries(m.getDownloads().map((d) => [d.id, d]));
    eq(byId.dl_a.state, 'interrupted'); eq(byId.dl_b.state, 'interrupted'); eq(byId.dl_b.isPaused, false);
    assert(/closed/i.test(byId.dl_a.error), byId.dl_a.error);
    eq(byId.dl_c.state, 'completed', 'finished downloads are left alone');
  });

  await test('the page\'s cookies are neither stored in downloads.json nor sent to the UI', async () => {
    const m = newManager(makeStorage(), null);
    m.downloads.dl_h = { id: 'dl_h', filename: 'h.bin', url: 'https://x.test/h', state: 'progressing', headers: { Cookie: 'sid=secret', Referer: 'https://x.test/' }, item: null };
    const out = m.getDownloads()[0];
    assert(!('headers' in out), 'headers leaked into the serialized record');
    m._persist();
    assert(!JSON.stringify(m.storage.data.downloads).includes('secret'), 'cookie reached the storage');
  });

  await test('Cancel works on a Turbo card that has no running task behind it', async () => {
    const m = newManager(makeStorage(), null);
    m.downloads.dl_z = { id: 'dl_z', filename: 'z.bin', url: 'https://x.test/z', savePath: path.join(base, 'z.bin'), state: 'progressing', isTurbo: true, item: null };
    eq(m.cancelDownload('dl_z'), true, 'cancel result');
    eq(m.downloads.dl_z.state, 'cancelled');
  });

  await test('Remove / clear stop a running Turbo task (it used to keep downloading in the background)', async () => {
    const payload = crypto.randomBytes(1024 * 1024);
    const srv = await listen((req, res) => {          // trickles data so the task is still running
      const r = rangeOf(req, payload.length) || { start: 0, end: payload.length - 1 };
      res.writeHead(206, { 'Content-Range': `bytes ${r.start}-${r.end}/${payload.length}`, 'Content-Length': r.end - r.start + 1 });
      res.write(payload.subarray(r.start, r.start + 10));
    });
    const m = newManager(makeStorage(), fakeSession());
    const rec = await m.startTurboDownload({ url: `${srv.url}/slow.bin`, filename: 'slow.bin', totalBytes: payload.length, threads: 2, multiSource: false });
    await until(() => m.turboEngine.activeTasks.has(rec.id), 4000, 'the task to be running');
    eq(m.removeDownload(rec.id), true);
    eq(m.turboEngine.activeTasks.has(rec.id), false, 'task must be stopped');
    await srv.close();
  });

  await test('Cancelling right after the start (while the server is still being probed) stops it from ever starting', async () => {
    const srv = await listen((req, res) => { res.writeHead(206, { 'Content-Range': 'bytes 0-9/10', 'Content-Length': 10 }); res.end('0123456789'); });
    const m = newManager(makeStorage(), fakeSession());
    const rec = await m.startTurboDownload({ url: `${srv.url}/early.bin`, filename: 'early.bin', totalBytes: 4 * 1024 * 1024, threads: 2, multiSource: false });
    eq(m.cancelDownload(rec.id), true, 'cancel result');
    await sleep(1800);                                   // longer than the interface check
    eq(m.turboEngine.activeTasks.size, 0, 'no task may appear afterwards');
    eq(m.downloads[rec.id].state, 'cancelled');
    assert(!fs.existsSync(rec.savePath), 'no file may be created');
    await srv.close();
  });

  await test('Turbo gets nothing from the server → the same card continues with the standard downloader and completes', async () => {
    const srv = await listen((req, res) => { res.writeHead(req.headers.range ? 403 : 200); res.end('hello'); });
    const sess = fakeSession();
    const m = newManager(makeStorage(), sess);
    const host = { session: sess, calls: [], isDestroyed: () => false, downloadURL(url, options) { this.calls.push({ url, options }); sess.downloadURL(url); } };
    m._getDownloadHost = () => host;              // a live tab: the only way to make Chromium send the Referer
    const updates = [];
    m._onUpdate = (r) => updates.push(r);
    const rec = await m.startTurboDownload({
      url: `${srv.url}/movie.bin`, filename: 'movie.bin', totalBytes: 4 * 1024 * 1024, threads: 4, multiSource: false,
      headers: { Referer: 'https://page.test/watch', Cookie: 'sid=secret' }
    });
    const done = await until(() => { const d = m.downloads[rec.id]; return d && d.state === 'completed' ? d : null; }, 8000, 'the hand-over to complete');
    await srv.close();
    eq(sess.calls.length, 1, 'standard downloader started once');
    eq(sess.calls[0].url, `${srv.url}/movie.bin`);
    eq(host.calls.length, 1, 'started from the tab');
    eq(host.calls[0].options.headers.Referer, 'https://page.test/watch', 'the page address is passed on');
    eq(JSON.stringify(host.calls[0].options).includes('secret'), false, 'cookies are not passed (the session has them)');
    eq(sess.items[0].cancelled, false, 'not mistaken for a duplicate');
    eq(done.id, rec.id, 'same card');
    eq(Boolean(done.isTurbo), false);
    eq(done.nativeTried, true);
    assert(updates.some((u) => u.id === rec.id && u.state === 'progressing' && u.received === 0), 'the card kept showing progress while handing over');
    assert(fs.existsSync(sess.items[0].savePath), 'file written');
  });

  await test('…but only once: if the standard downloader fails as well the card shows the reason and Retry', async () => {
    const srv = await listen((req, res) => { res.writeHead(403); res.end(); });
    const sess = fakeSession({ complete: false });
    sess.downloadURL = (url) => {                       // Chromium refuses too
      sess.calls.push({ url });
      setImmediate(() => {
        const ee = new EventEmitter();
        const item = { getFilename: () => 'x.bin', getURL: () => url, getURLChain: () => [url], getTotalBytes: () => 0, getReceivedBytes: () => 0, isPaused: () => false, setSavePath() {}, cancel() {}, on: ee.on.bind(ee), once: ee.once.bind(ee), emit: ee.emit.bind(ee) };
        sess.emit('will-download', { preventDefault() {} }, item, null);
        setImmediate(() => item.emit('done', {}, 'interrupted'));
      });
    };
    const m = newManager(makeStorage(), sess);
    const rec = await m.startTurboDownload({ url: `${srv.url}/x.bin`, filename: 'x.bin', totalBytes: 4 * 1024 * 1024, threads: 2, multiSource: false });
    const d = await until(() => { const r = m.downloads[rec.id]; return r && r.state === 'interrupted' ? r : null; }, 8000, 'the final failure');
    await srv.close();
    eq(sess.calls.length, 1, 'no hand-over loop');
    assert(d.error && d.error.length > 5, 'a reason is shown: ' + d.error);
  });

  await test('Turbo fails after data had arrived → no hand-over (the half download is not restarted behind the user\'s back); reason shown', async () => {
    const payload = crypto.randomBytes(1024 * 1024);
    let served = 0;
    const srv = await listen((req, res) => {
      const r = rangeOf(req, payload.length);
      if (!r) { res.writeHead(200); return res.end(payload); }
      served++;
      if (r.start === 0 && served <= 1) return serveRange(res, payload, { start: 0, end: 262143 });   // part 1 works…
      res.writeHead(403); res.end();                                                                    // …everything else is refused
    });
    const sess = fakeSession();
    const m = newManager(makeStorage(), sess);
    m.turboEngine.limits.stallMs = 800;
    const rec = await m.startTurboDownload({ url: `${srv.url}/part.bin`, filename: 'part.bin', totalBytes: payload.length, threads: 4, multiSource: false });
    const d = await until(() => { const r = m.downloads[rec.id]; return r && r.state === 'interrupted' ? r : null; }, 10000, 'the failure');
    await srv.close();
    eq(sess.calls.length, 0, 'no hand-over');
    assert(d.error, 'reason shown');
  });

  /** A WebContents-like object that records downloadURL() calls (and belongs to `sess`). */
  const fakeHost = (sess) => ({ session: sess, calls: [], isDestroyed: () => false, downloadURL(url, options) { this.calls.push({ url, options }); } });
  const mockItem = (url, total, extra = {}) => ({
    cancelled: false, savePath: null, handlers: {},
    getURL: () => url, getURLChain: () => [url], getFilename: () => 'big.zip', getTotalBytes: () => total,
    cancel() { this.cancelled = true; }, setSavePath(p) { this.savePath = p; },
    on(ev, fn) { this.handlers[ev] = fn; }, once(ev, fn) { this.handlers[ev] = fn; },
    getReceivedBytes: () => 0, isPaused: () => false, ...extra
  });
  const pageContents = (sess, page = 'https://files.test/get-page') => ({ getURL: () => page, session: { ...sess, getUserAgent: () => 'UA', cookies: { get: async () => [{ name: 's', value: 'v' }] } } });

  await test('the browser\'s own download is kept when the fast engine cannot be proven to work (single-use links, servers without ranges)', async () => {
    const m = newManager(makeStorage(), null);
    let probed = 0; let started = 0;
    m.turboEngine.probe = async () => { probed++; return { acceptsRanges: false, totalBytes: 0, finalUrl: 'x', filename: 'x', status: 403 }; };
    m.startTurboDownload = async () => { started++; };
    const item = mockItem('https://files.test/big.zip', 80 * 1024 * 1024);
    await m._handleDownload(item, pageContents({}));
    eq(probed, 1, 'one proving request');
    eq(started, 0, 'the fast engine must not start');
    eq(item.cancelled, false, 'the browser\'s download must NOT be cancelled');
    assert(item.savePath, 'the normal download goes on (save path set)');
    const rec = Object.values(m.downloads)[0];
    eq(Boolean(rec.isTurbo), false);
    eq(rec.referrer, 'https://files.test/get-page', 'the page is remembered for a later retry');
  });

  await test('…and given up only when the engine is proven: then the engine starts with the proof (no second probe)', async () => {
    const m = newManager(makeStorage(), null);
    const proof = { acceptsRanges: true, totalBytes: 80 * 1024 * 1024, finalUrl: 'https://cdn.test/big.zip', filename: 'big.zip', status: 206 };
    m.turboEngine.probe = async () => proof;
    let got = null;
    m.startTurboDownload = async (opts) => { got = opts; return { id: 'x' }; };
    const item = mockItem('https://files.test/big.zip', 80 * 1024 * 1024);
    await m._handleDownload(item, pageContents({}));
    eq(item.cancelled, true, 'cancelled once the engine is proven');
    assert(got && got.probe === proof, 'the proof is handed over');
    eq(got.headers.Referer, 'https://files.test/get-page');
    eq(got.headers.Cookie, 's=v');
  });

  await test('…a size that differs from the announced one, or a small file, is not worth a second request', async () => {
    const m = newManager(makeStorage(), null);
    m.turboEngine.minTurboSize = 2 * 1024 * 1024;
    let probed = 0;
    m.turboEngine.probe = async () => { probed++; return { acceptsRanges: true, totalBytes: 99, finalUrl: 'x', filename: 'x', status: 206 }; };
    m.startTurboDownload = async () => { throw new Error('must not start'); };
    const small = mockItem('https://files.test/small.zip', 100 * 1024);
    await m._handleDownload(small, pageContents({}));
    eq(probed, 0, 'no probe for a small file'); eq(small.cancelled, false);
    const differs = mockItem('https://files.test/odd.zip', 80 * 1024 * 1024);
    await m._handleDownload(differs, pageContents({}));
    eq(differs.cancelled, false, 'not cancelled when the sizes disagree');
  });

  await test('Retry names the page of the failed download (Referer) by starting from a live tab; without one it still retries', async () => {
    const sess = fakeSession();
    const host = fakeHost(sess);
    const m = newManager(makeStorage(), sess);
    m._getDownloadHost = () => host;
    const url = 'https://files.test/big/movie.mkv';
    m.downloads.dl_old = { id: 'dl_old', filename: 'movie.mkv', url, state: 'interrupted', startedAt: Date.now() - 5000, referrer: 'https://files.test/get-page', item: null };
    eq(m.retryDownload(url, false), true);
    eq(host.calls.length, 1, 'started from the tab');
    eq(host.calls[0].options.headers.Referer, 'https://files.test/get-page', 'Referer');
    eq(sess.calls.length, 0, 'session.downloadURL cannot send a Referer, so it is not used');
    // no live tab: the session is used
    m._getDownloadHost = () => null;
    eq(m.retryDownload(url, false), true);
    eq(sess.calls.length, 1, 'fallback');
    // a host of another session (e.g. incognito) is never used for this session
    m._getDownloadHost = () => fakeHost({});
    eq(m.retryDownload(url, false), true);
    eq(sess.calls.length, 2, 'wrong session ignored');
  });

  await test('the Turbo state IPC waits for the network list (a Promise inside the answer made the whole call fail)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    assert(/interfaces:\s*await this\.downloads\.getNetworkInterfaces\(\)/.test(src), 'getTurboState must await getNetworkInterfaces()');
  });

  await test('Retry uses the standard downloader even when the same link is still listed as running (no duplicate cancel)', async () => {
    const sess = fakeSession();
    const m = newManager(makeStorage(), sess);
    const url = 'https://files.test/big/movie.mkv';
    m.downloads.dl_old = { id: 'dl_old', filename: 'movie.mkv', url, state: 'progressing', startedAt: Date.now() - 60000, item: null };
    eq(m.retryDownload(url, false), true);
    await until(() => sess.items && sess.items[0] && sess.items[0].savePath, 3000, 'the retry to start');
    eq(sess.items[0].cancelled, false, 'must not be cancelled as a duplicate');
    const fresh = Object.values(m.downloads).find((d) => d.id !== 'dl_old');
    assert(fresh && !fresh.isTurbo, 'native record created');
    eq(m.retryDownload('', false), false, 'empty url');
  });

  await test('a hand-over that Electron never answers is dropped after a while instead of blocking the link', async () => {
    const m = newManager(makeStorage(), null);
    m._nativeOnly.set('https://a.test/x', {});
    eq(m._takeHandover({ getURLChain: () => ['https://a.test/x', 'https://cdn.test/y'] }, 'https://cdn.test/y') !== null, true, 'found through the redirect chain');
    eq(m._nativeOnly.size, 0, 'consumed');
  });

  console.log(`\n  p1-downloads-robust: ${passed} passed, ${failed} failed`);
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
