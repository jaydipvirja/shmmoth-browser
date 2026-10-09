/**
 * E2E 18 — YouTube: play / pause, ads and right-click
 *
 * On YouTube the video could not be paused (or played), and right-click did not work. Causes:
 *   - the browser's own YouTube ad script called play() every 100 ms while an anti-adblock notice was anywhere in the
 *     page, muted the video / set it to 16x / jumped to its end while an ad element was left over in the player, clicked
 *     every "#dismiss-button" of the page, and hid the anti-adblock dialog
 *   - uBlock's YouTube rules ran some time after the page had started, when the player had already read its settings
 *   - 1.1.13 opened the browser's menu from three places at once on a YouTube right-click
 *
 * The page is served as https://www.youtube.com (a local server; the browser runs with --host-resolver-rules and
 * --ignore-certificate-errors), so everything that only happens on YouTube really happens. It behaves like YouTube's
 * watch page where it matters: a strict CSP with nonces, a #movie_player with the player API (playVideo / pauseVideo /
 * mute / unMute / isMuted), a control layer over the <video> that toggles play / pause on click, its own right-click menu
 * on the first right-click on the player (the browser's on the second), the class "ad-showing" during an ad, and an
 * anti-adblock notice and ad elements left over in the page. The filter lists are seeded into the profile.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/18-youtube-playback.e2e.js)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  runSuite, assert, assertEqual, waitFor, sleep, tmpDir,
  launchApp, api, waitForWebContents, evalIn, NO_SYSTEM_PROXY_ENV
} = require('./helpers');
const { selfSignedCert } = require('./fixtures/self-signed-cert');
const { LISTS } = require('../../src/services/filterLists');

/** 120 s of silence as an 8 kHz 8-bit WAV: plays in any Chromium, has a duration, can be seeked and sped up. */
function silentWav(seconds = 120) {
  const rate = 8000; const n = rate * seconds;
  const b = Buffer.alloc(44 + n, 0x80);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}

const NONCE = 'e2e-yt-nonce';
const WATCH_PAGE = (adPlacementsAtStart) => `<!doctype html><html><head><title>YouTube</title>
<script nonce="${NONCE}">
  // the page's first script, like YouTube's inline ytInitialPlayerResponse: what it sees is what the player gets
  window.ytInitialPlayerResponse = { adPlacements: [{ ad: 1 }], videoDetails: { videoId: 'e2e' } };
  window.__adPlacementsAtStart = ${adPlacementsAtStart};
</script>
<style>
  body { margin: 0; font: 14px sans-serif }
  #movie_player { position: relative; width: 640px; height: 360px; background: #000 }
  #movie_player video { width: 640px; height: 360px; display: block }
  .ytp-chrome-bottom { position: absolute; inset: 0 }
  #page-text { position: absolute; top: 420px; left: 20px; width: 400px; height: 40px }
</style></head><body>
<div id="masthead-ad" style="width:300px;height:30px;background:#c00">masthead ad</div>
<div id="movie_player" class="html5-video-player">
  <div class="html5-video-container"><video class="html5-main-video" src="/media.wav" preload="auto"></video></div>
  <div class="ytp-chrome-bottom" id="controls"></div>
  <div class="ytp-ad-module"><div class="ytp-ad-text" style="display:none">Ad · 0:05</div></div>
</div>
<p id="page-text">Video title and description</p>
<button id="dismiss-button" style="position:absolute;top:480px;left:20px">Dismiss (a notification of the page)</button>
<button class="ytp-skip-ad-button" id="outside-skip" style="position:absolute;top:480px;left:300px">a skip button outside the player</button>
<tp-yt-paper-dialog id="enforcement" style="position:absolute;top:520px;left:20px;display:block">
  <ytd-enforcement-message-view-model><button id="enforcement-button">Allow YouTube ads</button></ytd-enforcement-message-view-model>
</tp-yt-paper-dialog>
<script nonce="${NONCE}">
  (function () {
    var p = document.getElementById('movie_player');
    var v = p.querySelector('video');
    window.__api = []; window.__pageMenu = 0; window.__clicked = { dismiss: 0, enforcement: 0, outsideSkip: 0, skip: 0 };
    p.playVideo = function () { window.__api.push('playVideo'); var r = v.play(); if (r && r.catch) r.catch(function () {}); };
    p.pauseVideo = function () { window.__api.push('pauseVideo'); v.pause(); };
    p.isMuted = function () { return v.muted; };
    p.mute = function () { window.__api.push('mute'); v.muted = true; };
    p.unMute = function () { window.__api.push('unMute'); v.muted = false; };
    // a click on the player toggles play / pause, like YouTube
    document.getElementById('controls').addEventListener('click', function () { if (v.paused) p.playVideo(); else p.pauseVideo(); });
    // YouTube's own menu: the first right-click on the player opens it (no browser menu), a second one while it is open
    // lets the browser's menu through
    var menuOpen = false;
    p.addEventListener('contextmenu', function (e) {
      if (menuOpen) { menuOpen = false; return; }
      e.preventDefault(); menuOpen = true; window.__pageMenu++;
    });
    document.addEventListener('mousedown', function (e) { if (e.button === 0) menuOpen = false; });
    document.getElementById('dismiss-button').addEventListener('click', function () { window.__clicked.dismiss++; });
    document.getElementById('enforcement-button').addEventListener('click', function () { window.__clicked.enforcement++; });
    document.getElementById('outside-skip').addEventListener('click', function () { window.__clicked.outsideSkip++; });
    // what YouTube does at the start and end of an ad (driven by the test)
    window.__startAd = function () {
      var b = document.createElement('button'); b.className = 'ytp-skip-ad-button'; b.textContent = 'Skip';
      b.addEventListener('click', function () { window.__clicked.skip++; });
      p.appendChild(b); p.classList.add('ad-showing');
    };
    window.__endAd = function () { p.classList.remove('ad-showing'); var b = p.querySelector('.ytp-skip-ad-button'); if (b) b.remove(); };
  })();
</script></body></html>`;

runSuite('SHMMOTH Browser — E2E 18: YouTube play / pause, ads, right-click', async (t) => {
  const wav = silentWav();
  const { key, cert } = selfSignedCert('www.youtube.com');
  const server = https.createServer({ key, cert }, (req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/media.wav') {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : wav.length - 1;
      res.writeHead(m ? 206 : 200, {
        'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        ...(m ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {})
      });
      return res.end(wav.subarray(start, end + 1));
    }
    if (p === '/watch') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // like YouTube: scripts only with the nonce, and Trusted Types
      res.setHeader('Content-Security-Policy', `script-src 'nonce-${NONCE}'; require-trusted-types-for 'script'`);
      return res.end(WATCH_PAGE('window.ytInitialPlayerResponse.adPlacements === undefined'));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `https://www.youtube.com:${port}`;

  // The lists, as if downloaded a moment ago: uBlock's real YouTube rule for the player's ad data
  const userData = tmpDir();
  const listsDir = path.join(userData, 'adblock-engine-2-lists');
  fs.mkdirSync(listsDir, { recursive: true });
  const seed = (id, text) => {
    fs.writeFileSync(path.join(listsDir, id + '.txt'), text);
    fs.writeFileSync(path.join(listsDir, id + '.json'), JSON.stringify({ fetchedAt: Date.now(), url: 'seeded by the test' }));
  };
  for (const l of LISTS) seed(l.id, '! empty seed\n');
  seed('easylist', ['[Adblock Plus 2.0]', '! Title: E2E list', '||ads.test-adnet.example^',
    'youtube.com##+js(set-constant, ytInitialPlayerResponse.adPlacements, undefined)'].join('\n') + '\n');
  seed('resources', fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ublock-resources-min.json'), 'utf8'));

  const ctx = await launchApp({
    userData,
    env: NO_SYSTEM_PROXY_ENV,
    args: ['--host-resolver-rules=MAP www.youtube.com 127.0.0.1', '--ignore-certificate-errors']
  });
  const { app } = ctx;

  // Record every native menu the browser would show
  await app.evaluate(({ Menu }) => {
    global.__menus = [];
    Menu.prototype.popup = function () { global.__menus.push(this); };
  });
  const menuCount = () => app.evaluate(() => global.__menus.length);
  const lastLabels = () => app.evaluate(() => global.__menus[global.__menus.length - 1].items.map((i) => i.label || (i.type === 'separator' ? '—' : i.role)));
  const clickItem = (label) => app.evaluate((_, label) => {
    const item = global.__menus[global.__menus.length - 1].items.find((i) => i.label === label);
    if (!item) throw new Error('no menu item "' + label + '"');
    item.click();
  }, label);
  const input = (url, events) => app.evaluate(({ webContents }, { url, events }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
    wc.focus();
    for (const e of events) wc.sendInputEvent(e);
  }, { url, events });
  const click = (url, x, y) => input(url, [
    { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }
  ]);
  const rightClick = (url, x, y, modifiers = []) => input(url, [
    { type: 'mouseDown', x, y, button: 'right', clickCount: 1, modifiers }, { type: 'mouseUp', x, y, button: 'right', clickCount: 1, modifiers }
  ]);
  const video = (url) => evalIn(app, url, `(() => { const v = document.querySelector('video'); return { paused: v.paused, muted: v.muted, rate: v.playbackRate, time: v.currentTime, duration: v.duration }; })()`);
  const open = async (p) => {
    const url = base + p;
    await api(ctx.chrome, 'createTab', url);
    await waitForWebContents(app, url);
    await waitFor(() => evalIn(app, url, 'document.readyState === "complete" && document.querySelector("video").readyState >= 1'), { message: 'the watch page and its video' });
    await sleep(700);                                                      // the browser's dom-ready work
    return url;
  };

  try {
    await waitFor(async () => { const s = await api(ctx.chrome, 'getAdBlockerStatus'); return s && s.engine === 'full'; }, { message: 'the ad-block engine', timeout: 30000 });

    t.section('uBlock\'s YouTube rules');

    await t.test('they run before the page\'s own first script (the player never sees the ad data), also with a strict CSP', async () => {
      const url = await open('/watch?v=rules');
      assertEqual(await evalIn(app, url, 'window.__adPlacementsAtStart'), true, 'the page saw adPlacements: the rule ran too late');
      assertEqual(await evalIn(app, url, 'window.ytInitialPlayerResponse.videoDetails.videoId'), 'e2e', 'the rest of the data must stay');
    });

    await t.test('with the blocker paused for YouTube they do not run', async () => {
      await api(ctx.chrome, 'updateSettings', { adBlockerAllowlist: ['youtube.com'] });
      try {
        const url = await open('/watch?v=paused');
        assertEqual(await evalIn(app, url, 'window.__adPlacementsAtStart'), false, 'the rule ran although paused');
      } finally {
        await api(ctx.chrome, 'updateSettings', { adBlockerAllowlist: [] });
      }
    });

    t.section('Play / pause');

    let watch;
    await t.test('a click on the player plays, the next click pauses — and it stays paused, with the sound and speed untouched', async () => {
      watch = await open('/watch?v=play');
      assertEqual((await video(watch)).paused, true, 'starts paused');
      await click(watch, 320, 180);
      await waitFor(async () => { const v = await video(watch); return !v.paused && v.time > 0.3; }, { message: 'the video to play' });
      await click(watch, 320, 180);
      await waitFor(async () => (await video(watch)).paused, { message: 'the video to pause' });
      const at = (await video(watch)).time;
      await sleep(2000);                                                   // the old script restarted it within 100 ms
      const v = await video(watch);
      assertEqual(v.paused, true, 'the video started again by itself');
      assertEqual(v.muted, false, 'muted by the browser');
      assertEqual(v.rate, 1, 'speed changed by the browser');
      assert(Math.abs(v.time - at) < 0.05 && v.time < v.duration - 1, `the position moved by itself: ${at} → ${v.time} of ${v.duration}`);
    });

    await t.test('nothing in the page is clicked by the browser: not the page\'s "Dismiss", not the anti-adblock notice, not a skip button outside the player', async () => {
      await click(watch, 320, 180);                                        // play again for a while
      await sleep(1500);
      assertEqual(JSON.stringify(await evalIn(app, watch, 'window.__clicked')), JSON.stringify({ dismiss: 0, enforcement: 0, outsideSkip: 0, skip: 0 }));
      const v = await video(watch);
      assert(!v.paused && !v.muted && v.rate === 1, 'the playing video was changed: ' + JSON.stringify(v));
    });

    await t.test('the anti-adblock notice is left visible (hiding it left its backdrop over the player); ad boxes outside the player are hidden', async () => {
      assertEqual(await evalIn(app, watch, 'getComputedStyle(document.getElementById("enforcement")).display'), 'block');
      await waitFor(async () => (await evalIn(app, watch, 'getComputedStyle(document.getElementById("masthead-ad")).display')) === 'none', { message: 'the masthead ad to be hidden' });
    });

    await t.test('during an ad (player class "ad-showing"): muted, fast, its skip button pressed; afterwards sound and the user\'s speed are back', async () => {
      await evalIn(app, watch, 'document.querySelector("video").playbackRate = 1.5');
      await evalIn(app, watch, 'window.__startAd()');
      await waitFor(async () => { const v = await video(watch); return v.muted && v.rate === 16; }, { message: 'the ad to be muted and sped up', timeout: 3000 });
      await waitFor(() => evalIn(app, watch, 'window.__clicked.skip >= 1'), { message: 'the skip button inside the player to be pressed', timeout: 3000 });
      await evalIn(app, watch, 'window.__endAd()');
      await waitFor(async () => { const v = await video(watch); return !v.muted && v.rate === 1.5; }, { message: 'sound and speed to come back', timeout: 3000 });
      const v = await video(watch);
      assert(!v.paused, 'the video must keep playing');
      assert(v.time < v.duration - 1, 'the video was jumped to its end');
      assertEqual(await evalIn(app, watch, 'window.__clicked.outsideSkip'), 0, 'a skip button outside the player was pressed');
    });

    t.section('Right-click');

    await t.test('on the video: the first right-click is YouTube\'s menu (no browser menu), the second opens exactly one browser menu with the video items', async () => {
      const url = await open('/watch?v=menu');
      const before = await menuCount();
      await rightClick(url, 320, 180);
      await waitFor(() => evalIn(app, url, 'window.__pageMenu === 1'), { message: 'YouTube\'s own menu' });
      await sleep(600);
      assertEqual(await menuCount(), before, 'a browser menu opened over YouTube\'s own');
      await rightClick(url, 320, 180);
      await waitFor(async () => (await menuCount()) > before, { message: 'the browser menu on the second right-click' });
      await sleep(800);
      assertEqual(await menuCount(), before + 1, 'more than one browser menu for one right-click');
      assertEqual(await evalIn(app, url, 'window.__pageMenu'), 1, 'YouTube\'s menu opened again');
      const labels = await lastLabels();
      for (const want of ['Play', 'Mute', 'Loop', 'Back', 'Reload', 'Inspect']) assert(labels.includes(want), `"${want}" missing: ${labels.join(' | ')}`);
    });

    await t.test('"Play" / "Pause" / "Mute" from the menu go through YouTube\'s player, and a paused video stays paused', async () => {
      const url = base + '/watch?v=menu';
      await clickItem('Play');
      await waitFor(async () => !(await video(url)).paused, { message: 'the video to play from the menu' });
      await rightClick(url, 320, 180); await sleep(300);                  // YouTube's menu
      const before = await menuCount();
      await rightClick(url, 320, 180);
      await waitFor(async () => (await menuCount()) > before, { message: 'the browser menu' });
      assert((await lastLabels()).includes('Pause'), 'the menu should offer "Pause" for a playing video');
      await clickItem('Pause');
      await waitFor(async () => (await video(url)).paused, { message: 'the video to pause from the menu' });
      await clickItem('Mute');
      await waitFor(async () => (await video(url)).muted, { message: 'the video to be muted from the menu' });
      await sleep(1500);
      assertEqual((await video(url)).paused, true, 'the video started again by itself');
      assertEqual(JSON.stringify(await evalIn(app, url, 'window.__api')), JSON.stringify(['playVideo', 'pauseVideo', 'mute']), 'through the player API');
    });

    await t.test('Shift + right-click on the video opens the browser menu at once; YouTube never sees it', async () => {
      const url = await open('/watch?v=shift');
      const before = await menuCount();
      await rightClick(url, 320, 180, ['shift']);
      await waitFor(async () => (await menuCount()) > before, { message: 'the browser menu on Shift + right-click' });
      await sleep(600);
      assertEqual(await menuCount(), before + 1, 'exactly one menu');
      assertEqual(await evalIn(app, url, 'window.__pageMenu'), 0, 'YouTube saw the Shift + right-click');
      assert((await lastLabels()).includes('Play'), 'the video items');
    });

    await t.test('outside the player every right-click opens exactly one browser menu', async () => {
      const url = base + '/watch?v=shift';
      const before = await menuCount();
      await rightClick(url, 60, 440);
      await waitFor(async () => (await menuCount()) === before + 1, { message: 'the first menu' });
      await rightClick(url, 60, 440);
      await waitFor(async () => (await menuCount()) === before + 2, { message: 'the second menu' });
      await sleep(800);
      assertEqual(await menuCount(), before + 2, 'a right-click opened more than one menu');
      const labels = await lastLabels();
      assert(!labels.includes('Play'), 'no video items away from the video: ' + labels.join(' | '));
    });

    await t.test('no errors in the log', async () => {
      const text = ctx.log.text;
      assert(!/Could not look up the scriptlets|Could not register the element-hiding script|called ipcRenderer\.sendSync\(\) with .* without listeners/.test(text),
        (text.match(/(Could not (look up|register)[^\n]*|called ipcRenderer\.sendSync[^\n]*)/) || [''])[0]);
    });
  } finally {
    await ctx.close();
    await new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
