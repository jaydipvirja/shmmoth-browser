/**
 * E2E 10 — everyday quality: history titles and program-type downloads
 *
 *   - history shows the title of the page that was visited (it used to store the PREVIOUS page's title)
 *   - opening a downloaded program (.exe, .msi, …) asks first; Cancel does not start it
 *
 * Run: npm run test:e2e   (or: node tests/e2e/10-quality.e2e.js)
 */

'use strict';

const fs   = require('fs');

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, tmpDir, listWebContents, waitForWebContents,
  startServer, fileHandler, NO_SYSTEM_PROXY_ENV
} = require('./helpers');

runSuite('SHMMOTH Browser — E2E 10: history titles & program downloads', async (t) => {
  const site = await startServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const name = decodeURIComponent(req.url.slice(1)) || 'home';
    res.end(`<!doctype html><title>Title of ${name}</title>body of ${name}`);
  });
  const origin = await startServer(fileHandler({ size: 64 * 1024, filename: 'setup.exe' }));
  const downloadsDir = tmpDir('shmmoth-e2e-quality-dl-');
  const ctx = await launchApp({ env: NO_SYSTEM_PROXY_ENV });
  const { app, chrome } = ctx;
  await api(chrome, 'updateSettings', { downloadPath: downloadsDir });

  const entry = async (url) => (await api(chrome, 'getHistory')).find((h) => h.url === url);

  try {
    t.section('History titles');

    await t.test('a visited page is listed under its own title', async () => {
      await api(chrome, 'createTab', `${site.url}/alpha`);
      await waitFor(async () => (await entry(`${site.url}/alpha`) || {}).title === 'Title of alpha', { message: 'history title of /alpha' });
    });

    await t.test('after moving on to another page in the same tab, each page keeps its own title (no stale title carried over)', async () => {
      await api(chrome, 'navigateCurrentTab', `${site.url}/beta`);
      await waitFor(async () => (await entry(`${site.url}/beta`) || {}).title === 'Title of beta', { message: 'history title of /beta' });
      await api(chrome, 'navigateCurrentTab', `${site.url}/alpha`);
      await waitForWebContents(app, `${site.url}/alpha`);
      await sleep(600);
      assertEqual((await entry(`${site.url}/alpha`)).title, 'Title of alpha');
      assertEqual((await entry(`${site.url}/beta`)).title, 'Title of beta');
    });

    t.section('Program-type downloads');

    // stub the native dialog and shell in the main process; remember what they were asked
    await app.evaluate(({ dialog, shell }) => {
      global.__asked = []; global.__opened = []; global.__answer = 0;
      dialog.showMessageBox = async (...args) => { global.__asked.push(JSON.stringify(args[args.length - 1])); return { response: global.__answer }; };
      shell.openPath = async (p) => { global.__opened.push(p); return ''; };
      shell.showItemInFolder = () => {};
    });

    await t.test('the download completes and opening it asks first; Cancel → the program is not started', async () => {
      await api(chrome, 'createTab', `${origin.url}/get`);
      const d = await waitFor(async () => (await api(chrome, 'getDownloads')).find((x) => x.filename === 'setup.exe' && x.state === 'completed'), { timeout: 30000, message: 'setup.exe download' });
      const res = await api(chrome, 'openDownloadedFile', d.id);
      assertEqual(res.success, false, JSON.stringify(res));
      assertEqual(res.dangerous, true);
      const [asked, opened] = await app.evaluate(() => [global.__asked, global.__opened]);
      assertEqual(asked.length, 1, 'the user must be asked exactly once');
      assert(/Open anyway/.test(asked[0]) && /setup\.exe/.test(asked[0]), asked[0]);
      assertEqual(opened.length, 0, 'the program was started without consent');
    });

    await t.test('"Open anyway" opens it', async () => {
      await app.evaluate(() => { global.__answer = 1; });
      const d = (await api(chrome, 'getDownloads')).find((x) => x.filename === 'setup.exe');
      const res = await api(chrome, 'openDownloadedFile', d.id);
      assertEqual(res.success, true, JSON.stringify(res));
      assertEqual((await app.evaluate(() => global.__opened)).length, 1);
    });
  } finally {
    await ctx.close();
    await site.close();
    await origin.close();
    fs.rmSync(downloadsDir, { recursive: true, force: true });
  }
});
