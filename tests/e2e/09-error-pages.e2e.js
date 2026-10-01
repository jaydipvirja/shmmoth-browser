/**
 * E2E 09 — error pages
 *
 * A page that cannot be loaded used to leave the tab blank. It now shows mtc://error with a plain explanation, keeps
 * the failed address in the address bar, and "Try again" / Reload really retry that address.
 * The "server" is a local port with nothing listening (connection refused), so no DNS or internet is involved.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/09-error-pages.e2e.js)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, chromeWindow, api, tmpDir, listWebContents, waitForWebContents, evalIn,
  startServer, fileHandler, NO_SYSTEM_PROXY_ENV
} = require('./helpers');

runSuite('SHMMOTH Browser — E2E 09: error pages', async (t) => {
  // a port that is closed right away: connecting to it is refused
  const probe = await startServer(() => {});
  const deadPort = probe.port;
  await probe.close();
  const dead = `http://127.0.0.1:${deadPort}`;

  const userData = tmpDir('shmmoth-e2e-errors-');
  const ctx = await launchApp({ userData, env: NO_SYSTEM_PROXY_ENV });
  const { app, chrome } = ctx;
  const downloadsDir = tmpDir('shmmoth-e2e-errors-dl-');
  await api(chrome, 'updateSettings', { startupBehavior: 'restore', downloadPath: downloadsDir });

  const omnibox = () => chrome.evaluate(() => ({ value: document.getElementById('omnibox-input').value, icon: document.getElementById('omnibox-security').textContent, hint: document.getElementById('omnibox-security').title }));
  const errorPage = (needle) => waitFor(async () => (await listWebContents(app)).find((w) => w.url.startsWith('mtc://error') && (!needle || decodeURIComponent(w.url).includes(needle)) && !w.loading),
    { timeout: 20000, message: `the error page for ${needle || 'a failed load'}` });
  const text = (prefix, id) => evalIn(app, prefix, `document.getElementById(${JSON.stringify(id)}).textContent`);

  try {
    t.section('A page that cannot be loaded');

    await t.test('shows the error page instead of a blank tab, with a plain explanation and the error code', async () => {
      await api(chrome, 'createTab', `${dead}/article?id=7`);
      const wc = await errorPage(`${dead}/article`);
      assertEqual(await text(wc.url, 'title'), 'Connection refused');
      assert(/ERR_CONNECTION_REFUSED \(-102\)/.test(await text(wc.url, 'code')), await text(wc.url, 'code'));
      assert((await text(wc.url, 'address')).includes(`127.0.0.1:${deadPort}`), 'the failed address should be shown');
      assertEqual(await evalIn(app, wc.url, 'getComputedStyle(document.getElementById("btn-retry")).display !== "none"'), true);
    });

    await t.test('the address bar keeps the failed address (with a warning icon, never a padlock)', async () => {
      const o = await waitFor(async () => { const x = await omnibox(); return x.value.startsWith(dead) ? x : null; }, { message: 'omnibox to show the failed address' });
      assertEqual(o.value, `${dead}/article?id=7`);
      assertEqual(o.icon, '⚠️');
      assertEqual(o.hint, 'This page could not be loaded');
    });

    await t.test('the error page itself is not added to the browsing history', async () => {
      const hist = await api(chrome, 'getHistory');
      assert(!hist.some((h) => /mtc:\/\/error/.test(h.url) || h.url.startsWith(dead)), JSON.stringify(hist.map((h) => h.url)));
    });

    await t.test('the open tab is saved in the session under the failed address, not under mtc://error', async () => {
      const session = await waitFor(() => { try { const s = JSON.parse(fs.readFileSync(path.join(userData, 'shmmoth-session.json'), 'utf8')); return s.tabs.some((x) => x.url.startsWith(dead)) ? s : null; } catch (_) { return null; } },
        { message: 'the session file to list the failed address' });
      assert(!JSON.stringify(session).includes('mtc://error'), 'the error page address was saved');
    });

    t.section('Trying again');

    const live = await startServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>recovered</title>back online'); });
    // the "site" comes back on the very port that was refusing connections
    await live.close();
    const revived = await new Promise((resolve) => {
      const http = require('http');
      const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>recovered</title>back online'); });
      server.listen(deadPort, '127.0.0.1', () => resolve(server));
    });

    await t.test('"Try again" loads the page once the site is back, and the error state is gone', async () => {
      const wc = (await listWebContents(app)).find((w) => w.url.startsWith('mtc://error'));
      await evalIn(app, wc.url, 'document.getElementById("btn-retry").click()');
      await waitForWebContents(app, `${dead}/article?id=7`);
      // (a plain-http page still shows a warning icon, but it says "Not Secure" rather than "could not be loaded")
      const o = await waitFor(async () => { const x = await omnibox(); return x.hint !== 'This page could not be loaded' ? x : null; }, { message: 'the load-failure hint to disappear' });
      assertEqual(o.value, `${dead}/article?id=7`);
      assert(!(await listWebContents(app)).some((w) => w.url.startsWith('mtc://error')), 'the error page is still open');
    });

    await t.test('Reload on an error tab retries the failed address', async () => {
      await new Promise((r) => revived.close(r));
      if (revived.closeAllConnections) revived.closeAllConnections();
      await api(chrome, 'createTab', `${dead}/second`);
      await errorPage(`${dead}/second`);
      const again = await new Promise((resolve) => {
        const http = require('http');
        const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>second ok</title>ok'); });
        server.listen(deadPort, '127.0.0.1', () => resolve(server));
      });
      try {
        await api(chrome, 'reloadTab');
        await waitForWebContents(app, `${dead}/second`);
        assert(!(await listWebContents(app)).some((w) => w.url.startsWith('mtc://error')), 'still on the error page after Reload');
      } finally { await new Promise((r) => again.close(r)); }
    });

    t.section('Things that are not errors, and hostile input');

    await t.test('a response that turns into a download (ERR_ABORTED) does not show an error page', async () => {
      const origin = await startServer(fileHandler({ filename: 'not-an-error.bin' }));
      try {
        await api(chrome, 'createTab', `${origin.url}/file`);
        await waitFor(async () => (await api(chrome, 'getDownloads')).some((d) => d.filename === 'not-an-error.bin'), { timeout: 30000, message: 'the download to start' })
          .catch(async (err) => { throw new Error(`${err.message}; downloads: ${JSON.stringify((await api(chrome, 'getDownloads')).map((d) => [d.filename, d.state]))}; tabs: ${(await listWebContents(app)).map((w) => w.url.slice(0, 70)).join(' | ')}`); });
        await sleep(800);
        const errs = (await listWebContents(app)).filter((w) => w.url.startsWith('mtc://error'));
        assertEqual(errs.length, 0, 'error pages after a download: ' + errs.map((e) => e.url).join(' | '));
      } finally { await origin.close(); }
    });

    await t.test('the failed address is shown as text only: markup in it is inert and a non-http address gets no "Try again"', async () => {
      const evil = '<img src=x onerror="document.title=\'PWNED\'">';
      await api(chrome, 'createTab', `mtc://error?code=-105&name=${encodeURIComponent(evil)}&url=${encodeURIComponent('http://example.test/' + evil)}`);
      const wc = await errorPage('example.test');
      await sleep(600);
      const r = await evalIn(app, wc.url, `({ imgs: document.querySelectorAll('.card img').length, title: document.title, code: document.getElementById('code').textContent })`);
      assertEqual(r.imgs, 0, 'injected <img>');
      assert(!/PWNED/.test(r.title), 'injected handler ran: ' + r.title);
      assert(!/[<>"]/.test(r.code), 'unsanitised error name: ' + r.code);

      await api(chrome, 'createTab', `mtc://error?code=-105&name=X&url=${encodeURIComponent('javascript:alert(1)')}`);
      await waitForWebContents(app, 'mtc://error/?code=-105&name=X');
      const hidden = await evalIn(app, 'mtc://error/?code=-105&name=X', 'getComputedStyle(document.getElementById("btn-retry")).display');
      assertEqual(hidden, 'none', 'Try again must not be offered for javascript: addresses');
    });

    t.section('Incognito');

    await t.test('an incognito tab gets the error page too', async () => {
      await api(chrome, 'newIncognitoWindow');
      const inc = await chromeWindow(app, { incognito: true });
      await waitFor(() => inc.evaluate(() => Boolean(window.mtcAPI)), { message: 'incognito chrome' });
      await api(inc, 'createTab', `${dead}/private`);
      await errorPage(`${dead}/private`);
    });
  } finally {
    await ctx.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(downloadsDir, { recursive: true, force: true });
  }
});
