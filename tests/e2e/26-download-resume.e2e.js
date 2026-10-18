/**
 * E2E 26 — Resume a fast-engine download where it stopped (IDM-style), also after the browser was closed
 *
 *   - a big download is split over several connections; while it runs, which blocks are on the disk is saved
 *   - the browser is closed half-way: the part file stays, the card comes back as "interrupted" with Resume
 *   - Resume on the downloads page fetches only the missing blocks; the finished file is byte-for-byte right
 *
 * Run: npm run test:e2e   (or: node tests/e2e/26-download-resume.e2e.js)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  runSuite, assert, assertEqual, waitFor, tmpDir,
  launchApp, api, startServer, evalIn, waitForWebContents, NO_SYSTEM_PROXY_ENV
} = require('./helpers');

const SIZE = 16 * 1024 * 1024;
const PAYLOAD = crypto.randomBytes(SIZE);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

runSuite('SHMMOTH Browser — E2E 26: resume a download', async (t) => {
  let served = 0;
  // 256 KiB/s per connection, so the download is still running when the browser is closed
  const server = await startServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : SIZE - 1;
    res.writeHead(m ? 206 : 200, {
      'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', ETag: '"same"',
      'Content-Disposition': 'attachment; filename="resume.bin"', 'Content-Length': end - start + 1,
      ...(m ? { 'Content-Range': `bytes ${start}-${end}/${SIZE}` } : {})
    });
    if (end - start < 16) return res.end(PAYLOAD.subarray(start, end + 1));          // the proving request
    let sent = start;
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer);
      const part = PAYLOAD.subarray(sent, Math.min(end + 1, sent + 12800));
      sent += part.length;
      served += part.length;
      if (sent > end) { clearInterval(timer); res.end(part); } else res.write(part);
    }, 50);
    res.on('close', () => clearInterval(timer));
  });

  const userData = tmpDir();
  const downloadsDir = tmpDir('shmmoth-e2e-dl26-');
  let id = null;
  let doneBefore = 0;
  try {
    t.section('Closed half-way');
    {
      const ctx = await launchApp({ userData, env: NO_SYSTEM_PROXY_ENV });
      try {
        await t.test('the download runs on the fast engine and saves which blocks are on the disk', async () => {
          await api(ctx.chrome, 'updateSettings', { downloadPath: downloadsDir });
          await api(ctx.chrome, 'createTab', `${server.url}/resume`);
          const d = await waitFor(async () => {
            const x = (await api(ctx.chrome, 'getDownloads')).find((r) => r.url.includes('/resume'));
            return x && x.isTurbo && x.resume && x.resume.doneBytes >= 3 * 1024 * 1024 ? x : null;
          }, { timeout: 60000, message: 'a few blocks on the disk' });
          assertEqual(d.state, 'progressing');
          id = d.id;
        });
      } finally {
        await ctx.close();
      }
    }

    t.section('Opened again');
    {
      const ctx = await launchApp({ userData, env: NO_SYSTEM_PROXY_ENV });
      try {
        await t.test('the card is interrupted, keeps what was downloaded and offers Resume', async () => {
          const d = (await api(ctx.chrome, 'getDownloads')).find((r) => r.id === id);
          assertEqual(d.state, 'interrupted');
          assertEqual(d.resumable, true, 'resumable');
          assert(/Resume continues/.test(d.error), d.error);
          doneBefore = d.resume.doneBytes;
          assert(fs.existsSync(path.join(downloadsDir, 'resume.bin.shmmoth-part')), 'the part file is still there');
        });

        await t.test('Resume on the downloads page fetches only the missing blocks; the file is right', async () => {
          await api(ctx.chrome, 'createTab', 'mtc://downloads');
          await waitForWebContents(ctx.app, 'mtc://downloads');
          await waitFor(() => evalIn(ctx.app, 'mtc://downloads', `(() => {
            const b = document.querySelector('.btn-resume[data-id="${id}"]');
            if (!b) return null;
            b.click();
            return true;
          })()`), { message: 'the Resume button' });
          served = 0;
          const d = await waitFor(async () => {
            const x = (await api(ctx.chrome, 'getDownloads')).find((r) => r.id === id);
            return x && (x.state === 'completed' || (x.state === 'interrupted' && !x.resumable)) ? x : null;
          }, { timeout: 90000, message: 'the resumed download to finish' });
          assertEqual(d.state, 'completed', d.error || 'state');
          assertEqual(sha(fs.readFileSync(path.join(downloadsDir, 'resume.bin'))), sha(PAYLOAD), 'content of the file');
          assert(served <= SIZE - doneBefore + 2 * 1024 * 1024, `served ${served} again, ${doneBefore} were already there`);
          assert(!fs.existsSync(path.join(downloadsDir, 'resume.bin.shmmoth-part')), 'no part file left');
        });
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await server.close();
    fs.rmSync(downloadsDir, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
