/**
 * E2E 13 — downloads that cannot get stuck
 *
 * A 13 GB download once sat at "0 B / 13.1 GB" for ever. The Turbo engine re-requests a file with byte ranges; some servers
 * refuse that (or never answer it) although the browser's own download was accepted. The download must then continue
 * with Chromium's own downloader instead of hanging or "completing" a file made of error pages.
 *
 *   - a server that refuses ranged requests: the same card ends up completed, with the right bytes
 *   - Retry (🔄) always uses the standard downloader and does not trip the duplicate protection
 *   - Cancel works on a card, the file is not left behind
 *   - the new-tab page names the Chromium version that really runs
 *
 * Run: npm run test:e2e   (or: node tests/e2e/13-downloads.e2e.js)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, tmpDir, startServer, evalIn, waitForWebContents, NO_SYSTEM_PROXY_ENV
} = require('./helpers');

const SIZE = 3 * 1024 * 1024;
const PAYLOAD = crypto.randomBytes(SIZE);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

runSuite('SHMMOTH Browser — E2E 13: downloads', async (t) => {
  const seen = [];                     // what the server was asked: { url, range }
  const server = await startServer((req, res) => {
    const range = req.headers.range || null;
    seen.push({ url: req.url, range });
    const send = (status, extra, body) => { res.writeHead(status, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="locked.bin"', ...extra }); res.end(body); };

    if (req.url.startsWith('/locked')) {
      // like a file host that only serves the browser's own plain request
      if (range) return send(403, {}, 'Forbidden');
      return send(200, { 'Content-Length': SIZE, 'Accept-Ranges': 'none' }, PAYLOAD);
    }
    const m = /bytes=(\d+)-(\d*)/.exec(range || '');
    if (req.url.startsWith('/open')) {
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : SIZE - 1;
      return send(m ? 206 : 200, { 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Disposition': 'attachment; filename="open.bin"', ...(m ? { 'Content-Range': `bytes ${start}-${end}/${SIZE}` } : {}) }, PAYLOAD.subarray(start, end + 1));
    }
    send(404, {}, 'nope');
  });

  const downloadsDir = tmpDir('shmmoth-e2e-dl13-');
  const ctx = await launchApp({ env: NO_SYSTEM_PROXY_ENV });
  const { app, chrome } = ctx;
  const list = () => api(chrome, 'getDownloads');
  const find = async (pred) => (await list()).find(pred);

  try {
    await api(chrome, 'updateSettings', { downloadPath: downloadsDir });

    t.section('A server that refuses the Turbo engine');

    await t.test('the download continues with the standard downloader and completes (same card, right bytes)', async () => {
      await api(chrome, 'createTab', `${server.url}/locked`);
      const d = await waitFor(async () => { const x = await find((r) => r.url.includes('/locked')); return x && x.state === 'completed' ? x : null; },
        { timeout: 60000, message: 'the download to complete after the hand-over' });
      assertEqual(Boolean(d.isTurbo), false, 'finished by the standard downloader');
      assertEqual(d.received, SIZE, 'bytes');
      const file = path.join(downloadsDir, d.filename);
      assertEqual(sha(fs.readFileSync(file)), sha(PAYLOAD), 'content of the file');
      assert(seen.some((s) => s.url.startsWith('/locked') && s.range), 'the Turbo engine should have tried (and been refused)');
      assertEqual((await list()).filter((r) => r.url.includes('/locked')).length, 1, 'one card for this download, not one per attempt');
    });

    await t.test('no cookies or request headers are exposed in the download records', async () => {
      const d = await find((r) => r.url.includes('/locked'));
      assert(d && !('headers' in d), 'records must not carry request headers');
    });

    t.section('Retry and cancel');

    await t.test('Retry downloads the file again with the standard downloader (and is not dropped as a duplicate)', async () => {
      const before = (await list()).filter((r) => r.url.includes('/open')).length;
      await api(chrome, 'createTab', `${server.url}/open`);
      await waitFor(async () => { const x = await find((r) => r.url.includes('/open') && r.state === 'completed'); return x; }, { timeout: 60000, message: 'the first download' });
      const res = await api(chrome, 'retryDownload', `${server.url}/open`);
      assertEqual(res.success, true, JSON.stringify(res));
      const all = await waitFor(async () => {
        const rows = (await list()).filter((r) => r.url.includes('/open') && r.state === 'completed');
        return rows.length >= before + 2 ? rows : null;
      }, { timeout: 60000, message: 'the retried download to complete' });
      const retried = all.find((r) => !r.isTurbo);
      assert(retried, 'the retry should have been done by the standard downloader');
      assertEqual(sha(fs.readFileSync(path.join(downloadsDir, retried.filename))), sha(PAYLOAD), 'content');
    });

    await t.test('Cancel on a running card stops it and leaves no file behind', async () => {
      // a link that is accepted but then trickles: the card stays "downloading"
      const slow = await startServer((req, res) => {
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
        const start = m ? Number(m[1]) : 0;
        res.writeHead(m ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Disposition': 'attachment; filename="slow.bin"', 'Content-Length': SIZE - start, ...(m ? { 'Content-Range': `bytes ${start}-${SIZE - 1}/${SIZE}` } : {}) });
        res.write(PAYLOAD.subarray(start, start + 1000));          // …and then nothing
      });
      try {
        await api(chrome, 'createTab', `${slow.url}/slow`);
        const card = await waitFor(async () => find((r) => r.url.includes('/slow') && (r.state === 'progressing' || r.state === 'paused')), { timeout: 30000, message: 'the slow download to be listed' });
        assertEqual(await api(chrome, 'cancelDownload', card.id), true, 'cancel result');
        await waitFor(async () => { const x = await find((r) => r.id === card.id); return x && x.state === 'cancelled'; }, { timeout: 15000, message: 'the card to be cancelled' });
        await sleep(1500);
        assertEqual(fs.existsSync(path.join(downloadsDir, card.filename)), false, 'partial file removed');
      } finally {
        await slow.close();
      }
    });

    t.section('New tab page');

    await t.test('names the Chromium version that really runs (it was a fixed "130")', async () => {
      await api(chrome, 'createTab', 'mtc://newtab');
      await waitForWebContents(app, 'mtc://newtab');
      const major = await app.evaluate(() => process.versions.chrome.split('.')[0]);
      const text = await waitFor(async () => {
        const v = await evalIn(app, 'mtc://newtab', 'document.getElementById("stat-engine") && document.getElementById("stat-engine").textContent');
        return v && /\d/.test(v) ? v : null;
      }, { message: 'the engine label' });
      assertEqual(text, `Engine: Chromium ${major}`);
    });
  } finally {
    await ctx.close();
    await server.close();
    fs.rmSync(downloadsDir, { recursive: true, force: true });
  }
});
