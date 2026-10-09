/**
 * E2E 12 — right-click on videos and copying from web pages
 *
 * YouTube's right-click menu ("Copy video URL", "Copy video URL at current time", …), the Share dialog and every
 * "Copy" button on the web use navigator.clipboard.writeText(). The permission check used to answer "no", so all of them
 * failed with "Write permission denied". Also: the browser's own menu on a video had no video items at all.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/12-right-click-clipboard.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, listWebContents, waitForWebContents, evalIn, startServer
} = require('./helpers');

runSuite('SHMMOTH Browser — E2E 12: right-click on video & clipboard', async (t) => {
  const site = await startServer((req, res) => {
    if (req.url.startsWith('/media.webm')) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/youtube-like-overlay')) {
      // Regression case: a player-control layer completely covers the video at the right-click point.
      res.end(`<!doctype html><title>youtube-like overlay</title><body style="margin:0">
        <div id="player" style="position:relative;width:640px;height:360px;background:#123">
          <video id="v" width="640" height="360" style="display:block"></video>
          <div id="overlay" style="position:absolute;inset:0;background:rgba(0,0,0,.01);"></div>
        </div>
      </body>`);
    } else if (req.url.startsWith('/youtube-like')) {
      // like YouTube: the page shows its own menu and prevents the browser's one; its items copy to the clipboard
      res.end(`<!doctype html><title>youtube-like</title><body style="margin:0">
        <div id="player" class="html5-video-player" style="width:640px;height:360px;background:#123"><video id="v" width="640" height="360"></video></div>
        <script>
          window.__pageMenu = 0;
          document.getElementById('player').addEventListener('contextmenu', function (e) { e.preventDefault(); window.__pageMenu++; });
        </script></body>`);
    } else if (req.url.startsWith('/blob-video')) {
      res.end(`<!doctype html><title>blob video</title><body style="margin:0"><video id="v" width="640" height="360" controls></video>
        <script>document.getElementById('v').src = URL.createObjectURL(new Blob([new Uint8Array(16)], { type: 'video/webm' }));</script></body>`);
    } else if (req.url.startsWith('/video')) {
      res.end(`<!doctype html><title>video page</title><body style="margin:0"><video id="v" width="640" height="360" src="/media.webm" controls></video></body>`);
    } else {
      res.end('<!doctype html><title>clipboard page</title><body>copy me</body>');
    }
  });

  const ctx = await launchApp();
  const { app } = ctx;

  // Record every native menu the browser would show (and keep it so a test can "click" its items)
  await app.evaluate(({ Menu }) => {
    global.__menus = [];
    Menu.prototype.popup = function () { global.__menus.push(this); };
  });
  const lastLabels = () => app.evaluate(() => (global.__menus.length ? global.__menus[global.__menus.length - 1].items.map((i) => i.label || (i.type === 'separator' ? '—' : i.role)) : null));
  const menuCount = () => app.evaluate(() => global.__menus.length);
  const clickItem = (label) => app.evaluate((_, label) => {
    const item = global.__menus[global.__menus.length - 1].items.find((i) => i.label === label);
    if (!item) throw new Error('no menu item "' + label + '"');
    item.click();
  }, label);
  const rightClick = (url, x = 200, y = 150) => app.evaluate(({ webContents }, { url, x, y }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 });
  }, { url, x, y });
  const open = async (p) => { await api(ctx.chrome, 'createTab', site.url + p); await waitForWebContents(app, site.url + p); await sleep(400); return site.url + p; };

  try {
    t.section('Copying from a web page');

    await t.test('a page can write to the clipboard when the user clicks (Copy link / Copy video URL buttons)', async () => {
      const url = await open('/clipboard');
      await app.evaluate(({ clipboard }) => clipboard.writeText('before'));
      const outcome = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((w) => w.getURL().startsWith(url))
        .executeJavaScript("navigator.clipboard.writeText('COPIED-BY-THE-PAGE').then(() => 'ok', (e) => e.name + ': ' + e.message)", true), url);
      assertEqual(outcome, 'ok');
      assertEqual(await app.evaluate(({ clipboard }) => clipboard.readText()), 'COPIED-BY-THE-PAGE');
      assertEqual(await evalIn(app, url, "navigator.permissions.query({ name: 'clipboard-write' }).then((p) => p.state)"), 'granted');
    });

    await t.test('reading the clipboard is still not allowed without asking', async () => {
      const state = await evalIn(app, site.url + '/clipboard', "navigator.permissions.query({ name: 'clipboard-read' }).then((p) => p.state)");
      assert(state !== 'granted', 'clipboard-read must not be granted silently, got ' + state);
    });

    t.section('A page with its own right-click menu (YouTube)');

    await t.test('the page\'s menu opens on every right-click and the browser does not draw a second one on top', async () => {
      const url = await open('/youtube-like');
      const before = await menuCount();
      await rightClick(url); await sleep(300); await rightClick(url); await sleep(300);
      assertEqual(await evalIn(app, url, 'window.__pageMenu'), 2);
      assertEqual(await menuCount(), before, 'a native menu popped up over the page\'s own');
    });

    t.section('Right-click on a plain video (or YouTube\'s native menu, on the second right-click)');

    await t.test('a player overlay does not hide the real video from the browser menu', async () => {
      const url = await open('/youtube-like-overlay');
      const before = await menuCount();
      await rightClick(url, 220, 160);
      await waitFor(async () => (await menuCount()) > before, { message: 'a new native menu for an overlaid video' });
      const labels = await lastLabels();
      for (const want of ['Play', 'Mute', 'Loop', 'Show controls', 'Picture in picture']) {
        assert(labels.includes(want), `"${want}" missing for the overlaid video: ${labels.join(' | ')}`);
      }
    });

    await t.test('the browser\'s menu has the video items first, then the page items', async () => {
      const url = await open('/video');
      const before = await menuCount();
      await rightClick(url);
      await waitFor(async () => (await menuCount()) > before, { message: 'a new native menu' });
      const labels = await lastLabels();
      for (const want of ['Play', 'Mute', 'Loop', 'Show controls', 'Picture in picture', 'Save video as...', 'Copy video address', 'Open video in new tab', 'Back', 'Forward', 'Reload', 'Inspect']) {
        assert(labels.includes(want), `"${want}" missing in: ${labels.join(' | ')}`);
      }
      assert(labels.indexOf('Loop') < labels.indexOf('Back'), 'video items belong above the page items');
    });

    await t.test('Loop, Mute and Show controls act on the video under the cursor', async () => {
      const url = site.url + '/video';
      const state = () => evalIn(app, url, '(() => { const v = document.getElementById("v"); return { loop: v.loop, muted: v.muted, controls: v.controls }; })()');
      assertEqual(JSON.stringify(await state()), JSON.stringify({ loop: false, muted: false, controls: true }));
      await clickItem('Loop'); await clickItem('Mute'); await clickItem('Show controls');
      await waitFor(async () => { const s = await state(); return s.loop && s.muted && !s.controls; }, { message: 'the video to change' });
    });

    await t.test('"Copy video address" puts the source on the clipboard and "Open video in new tab" opens it', async () => {
      await app.evaluate(({ clipboard }) => clipboard.writeText('before'));
      await clickItem('Copy video address');
      assertEqual(await app.evaluate(({ clipboard }) => clipboard.readText()), `${site.url}/media.webm`);
      await clickItem('Open video in new tab');
      await waitFor(async () => (await listWebContents(app)).some((w) => w.url.startsWith(`${site.url}/media.webm`)), { message: 'the video tab' });
    });

    await t.test('"Save video as…" starts a normal download of the source address', async () => {
      await app.evaluate(({ session }) => { global.__saved = []; session.defaultSession.downloadURL = (u) => global.__saved.push(u); });
      await clickItem('Save video as...');
      assertEqual((await app.evaluate(() => global.__saved)).join(), `${site.url}/media.webm`);
    });

    await t.test('a blob: source (how YouTube plays) gets no Save / Copy address / Open items, but still Loop and the rest', async () => {
      const url = await open('/blob-video');
      const before = await menuCount();
      await rightClick(url);
      await waitFor(async () => (await menuCount()) > before, { message: 'a new native menu for the blob video' });
      const labels = await lastLabels();
      assert(labels.includes('Loop') && labels.includes('Mute'), labels.join(' | '));
      assert(!labels.some((l) => /Save video|Copy video address|Open video/.test(l)), 'offered a useless blob: address: ' + labels.join(' | '));
    });
  } finally {
    await ctx.close();
    await site.close();
  }
});
