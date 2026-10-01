/**
 * E2E 07 — single instance and command-line URLs
 *
 * A second launch on the same profile (double-clicked shortcut, `shmmoth.exe https://…`, default-browser link) must
 * hand over to the running browser and exit, instead of starting a second process that fights over the data files.
 * Only web addresses from the command line are opened — never files or internal pages.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/07-single-instance.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, runSecondInstance, listWebContents, waitForWebContents, startServer
} = require('./helpers');

runSuite('SHMMOTH Browser — E2E 07: single instance & command-line URLs', async (t) => {
  const hits = [];
  const site = await startServer((req, res) => {
    hits.push(req.url);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>page ${req.url}</title>hello`);
  });

  try {
    t.section('A URL on the command line of the first launch');

    await t.test('opens as the first tab instead of the new-tab page', async () => {
      const ctx = await launchApp({ args: [`${site.url}/first-launch`], firstTabPrefix: `${site.url}/first-launch` });
      try {
        await waitFor(() => hits.includes('/first-launch'), { message: 'the first-launch page to be requested' });
        const urls = (await listWebContents(ctx.app)).map((w) => w.url);
        assert(!urls.some((u) => u.startsWith('mtc://newtab')), 'a new-tab page was opened as well: ' + urls.join(' | '));
      } finally { await ctx.close(); }
    });

    t.section('A second launch on the same profile');

    const ctx = await launchApp();
    try {
      const chromeWindows = () => ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('renderer/index.html')).length);

      await t.test('hands its URL to the running browser, opens it in a new tab and exits', async () => {
        const r = await runSecondInstance(ctx, [`${site.url}/from-second`]);
        assertEqual(r.code, 0, 'exit code of the second instance');
        await waitForWebContents(ctx.app, `${site.url}/from-second`);
        assert(hits.includes('/from-second'), 'the page was never requested');
      });

      await t.test('does not create a second browser window', async () => {
        assertEqual(await chromeWindows(), 1, 'browser windows');
      });

      await t.test('without a URL it just exits (the running window is brought to the front)', async () => {
        const r = await runSecondInstance(ctx, []);
        assertEqual(r.code, 0);
        assertEqual(await chromeWindows(), 1, 'browser windows');
      });

      await t.test('only web addresses are accepted from the command line (no files, no internal pages, no scripts)', async () => {
        const before = (await listWebContents(ctx.app)).length;
        // what the running browser does with the arguments a second launch hands over (same code path as a real second launch)
        await ctx.app.evaluate(({ app }, argv) => { app.emit('second-instance', {}, argv); },
          ['shmmoth', 'file:///etc/hostname', 'mtc://settings', 'javascript:window.__x=1', 'data:text/html,x', `${site.url}/after-bad-ones`]);
        await waitForWebContents(ctx.app, `${site.url}/after-bad-ones`);
        const urls = (await listWebContents(ctx.app)).map((w) => w.url);
        assert(!urls.some((u) => u.startsWith('file:///etc')) && !urls.some((u) => u.startsWith('mtc://settings')) && !urls.some((u) => u.startsWith('data:')),
          'a refused address was opened: ' + urls.join(' | '));
        assertEqual(urls.length, before + 1, 'exactly one new web contents (the good URL)');
      });

      await t.test('real second launches carrying refused addresses open nothing (the OS may refuse some of them outright; only the outcome matters)', async () => {
        const before = (await listWebContents(ctx.app)).length;
        const codes = [];
        for (const bad of ['file:///etc/hostname', 'mtc://settings', 'javascript:window.__x=1']) {
          const r = await runSecondInstance(ctx, [bad]);
          codes.push(`${bad.split(':')[0]}=${r.code}`);
        }
        console.log(`         exit codes: ${codes.join(' ')}`);
        await sleep(500);
        assertEqual((await listWebContents(ctx.app)).length, before, 'web contents after the refused launches');
      });

      await t.test('the profile still works afterwards', async () => {
        const s = await ctx.chrome.evaluate(() => window.mtcAPI.getSettings().then((x) => typeof x));
        assertEqual(s, 'object');
      });
    } finally { await ctx.close(); }
  } finally {
    await site.close();
  }
});
