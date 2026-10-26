/**
 * E2E 31 — clear on exit (privacy phase 3, 1.5.6), in the real browser
 *
 *   - with nothing ticked (the default) closing the browser keeps cookies and history
 *   - with "Cookies and site data" and "Browsing history" ticked, closing clears them — except the cookies of a site in
 *     "Keep cookies for"; the next start finds them gone
 *   - a run that was cut off (the flag left set) is finished at the next start, before any page opens
 *
 * Run: npm run test:e2e   (or: node tests/e2e/31-clear-on-exit.e2e.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { runSuite, assert, assertEqual, launchApp, api, tmpDir, startServer, waitFor, waitForWebContents } = require('./helpers');

const cookies = (app) => app.evaluate(({ session }) => session.defaultSession.cookies.get({}).then((l) => l.map((c) => `${c.domain}:${c.name}`).sort()));
const setCookie = (app, url, name) => app.evaluate(({ session }, c) => session.defaultSession.cookies.set({ url: c.url, name: c.name, value: 'v', expirationDate: Math.floor(Date.now() / 1000) + 86400 })
  .then(() => 'ok', (e) => String(e)), { url, name });

runSuite('SHMMOTH Browser — E2E 31: clear on exit', async (t) => {
  const site = await startServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>page</title><p>hello'); });
  const a = site.url;                                       // http://127.0.0.1:port
  const b = site.url.replace('127.0.0.1', 'localhost');     // another site
  try {
    await t.test('nothing ticked (the default): cookies and history survive closing', async () => {
      const ud = tmpDir('shmmoth-e2e-exit-off-');
      let ctx = await launchApp({ userData: ud });
      assertEqual(await setCookie(ctx.app, a + '/', 'keepme'), 'ok');
      await api(ctx.chrome, 'createTab', a + '/visited');
      await waitForWebContents(ctx.app, a + '/visited');
      await waitFor(async () => ((await api(ctx.chrome, 'getHistory', '')) || []).some((h) => String(h.url).includes('/visited')), { message: 'history entry' });
      await ctx.close();
      ctx = await launchApp({ userData: ud });
      try {
        assert((await cookies(ctx.app)).some((c) => c.endsWith(':keepme')), 'cookie lost');
        assert(((await api(ctx.chrome, 'getHistory', '')) || []).some((h) => String(h.url).includes('/visited')), 'history lost');
      } finally { await ctx.close(); }
    });

    await t.test('cookies and history ticked: cleared on closing, except the cookies of a kept site', async () => {
      const ud = tmpDir('shmmoth-e2e-exit-on-');
      let ctx = await launchApp({ userData: ud });
      await api(ctx.chrome, 'updateSettings', { clearOnExit: { history: true, cookies: true, cache: false, downloads: false }, clearOnExitKeepSites: ['localhost'] });
      assertEqual(await setCookie(ctx.app, a + '/', 'gone'), 'ok');
      assertEqual(await setCookie(ctx.app, b + '/', 'kept'), 'ok');
      await api(ctx.chrome, 'createTab', a + '/visited');
      await waitForWebContents(ctx.app, a + '/visited');
      await waitFor(async () => ((await api(ctx.chrome, 'getHistory', '')) || []).some((h) => String(h.url).includes('/visited')), { message: 'history entry' });
      await ctx.close();
      ctx = await launchApp({ userData: ud });
      try {
        const left = await cookies(ctx.app);
        assert(!left.some((c) => c.endsWith(':gone')), 'the 127.0.0.1 cookie survived: ' + left.join(', '));
        assert(left.some((c) => c.endsWith(':kept')), 'the kept site lost its cookie: ' + left.join(', '));
        assert(!((await api(ctx.chrome, 'getHistory', '')) || []).some((h) => String(h.url).includes('/visited')), 'history survived');
      } finally { await ctx.close(); }
    });

    await t.test('a clear that was cut off is finished at the next start', async () => {
      const ud = tmpDir('shmmoth-e2e-exit-cut-');
      let ctx = await launchApp({ userData: ud });
      assertEqual(await setCookie(ctx.app, a + '/', 'leftover'), 'ok');
      await api(ctx.chrome, 'updateSettings', { clearOnExitKeepSites: [] });     // (the profile's data file is written)
      await ctx.close();
      // as if the browser had died while clearing: the flag is set (in the profile's data file), nothing was cleared
      const file = path.join(ud, 'mtc-data.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.privacyClearPending = { cookies: true };
      fs.writeFileSync(file, JSON.stringify(data));
      ctx = await launchApp({ userData: ud });
      try {
        const left = await cookies(ctx.app);
        assert(!left.some((c) => c.endsWith(':leftover')), 'not finished at start: ' + left.join(', '));
      } finally { await ctx.close(); }
    });
  } finally { site.close(); }
});
