/**
 * E2E 06 — ad blocking (Ghostery engine, with the built-in domain list as fallback)
 *
 * A local HTTP proxy is the only way to reach the fake ad host, so "the proxy never saw the request" proves the
 * ad blocker cancelled it, and "the proxy saw it" after switching the blocker off proves the page really asked.
 * The test works with and without internet access (without it the engine falls back to a short built-in list
 * that also contains doubleclick.net).
 *
 * Run: npm run test:e2e   (or: node tests/e2e/06-adblock.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor,
  launchApp, chromeWindow, api, listWebContents, startServer, NO_SYSTEM_PROXY_ENV
} = require('./helpers');

const AD_HOST = 'googleads.g.doubleclick.net';
const SITE = 'http://news-site.test:8080';

runSuite('SHMMOTH Browser — E2E 06: ad blocking', async (t) => {
  const seen = [];
  const proxy = await startServer((req, res) => {
    seen.push(req.url);
    res.setHeader('Cache-Control', 'no-store');
    if (req.url.includes(AD_HOST)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end('window.__adLoaded = true;');
    }
    if (req.url.includes('/app.js')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end('document.title = "app-ran:" + (window.__adLoaded ? "ad" : "noad");');
    }
    const n = encodeURIComponent(req.url.split('/page-')[1] || 'x');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>loading</title><body>article
<script src="http://${AD_HOST}/pagead/show_ads.js?n=${n}"></script>
<script src="${SITE}/app.js?n=${n}"></script></body>`);
  });
  proxy.server.on('connect', (req, sock) => sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));

  const ctx = await launchApp({ env: NO_SYSTEM_PROXY_ENV });
  const { app, chrome } = ctx;
  const adRequested = (n) => seen.some((u) => u.includes(AD_HOST) && u.includes(`n=${n}`));

  /** Opens the test page in `page`'s window and returns the title the page's own script produced. */
  async function visit(page, n) {
    await api(page, 'createTab', `${SITE}/page-${n}`);
    const wc = await waitFor(async () => (await listWebContents(app)).find((w) => w.url.includes(`/page-${n}`) && w.title.startsWith('app-ran:')),
      { timeout: 20000, message: `the page ${n} to run its script` });
    return wc.title;
  }

  try {
    const res = await api(chrome, 'saveProxyConfig', { mode: 'manual', rules: { protocol: 'http', host: '127.0.0.1', port: proxy.port, bypassRules: '<local>' } });
    assertEqual(res.success, true, JSON.stringify(res));
    await api(chrome, 'updateSettings', { adBlockerEnabled: true });
    await api(chrome, 'newIncognitoWindow');
    const incog = await chromeWindow(app, { incognito: true });
    await waitFor(() => incog.evaluate(() => Boolean(window.mtcAPI)), { message: 'incognito chrome' });

    t.section('Ad blocker on');

    await t.test('an ad script from a known ad host is blocked in a normal tab (the page itself still works)', async () => {
      assertEqual(await visit(chrome, 'on-normal'), 'app-ran:noad');
      assert(!adRequested('on-normal'), 'the ad request reached the network');
    });

    await t.test('and in an incognito tab', async () => {
      assertEqual(await visit(incog, 'on-incog'), 'app-ran:noad');
      assert(!adRequested('on-incog'), 'the ad request reached the network');
    });

    await t.test('the blocked requests are counted', async () => {
      const n = await waitFor(async () => { const c = await api(chrome, 'getAdsBlockedCount'); return c >= 2 ? c : null; }, { message: 'the counter to reach 2' });
      assert(n >= 2, String(n));
    });

    t.section('Ad blocker off');

    await t.test('switching it off lets the ad host through in both normal and incognito tabs', async () => {
      await api(chrome, 'updateSettings', { adBlockerEnabled: false });
      assertEqual(await visit(chrome, 'off-normal'), 'app-ran:ad');
      assertEqual(await visit(incog, 'off-incog'), 'app-ran:ad');
      assert(adRequested('off-normal') && adRequested('off-incog'), 'the ad host should have been contacted');
    });

    await t.test('switching it back on blocks again (existing sessions are re-armed)', async () => {
      await api(chrome, 'updateSettings', { adBlockerEnabled: true });
      assertEqual(await visit(chrome, 'again-normal'), 'app-ran:noad');
      assertEqual(await visit(incog, 'again-incog'), 'app-ran:noad');
      assert(!adRequested('again-normal') && !adRequested('again-incog'), 'the ad request reached the network');
    });
  } finally {
    await ctx.close();
    await proxy.close();
  }
});
