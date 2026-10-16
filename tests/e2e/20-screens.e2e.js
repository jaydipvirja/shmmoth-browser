/**
 * E2E 20 — every screen, captured (the redesign's before/after record)
 *
 * Opens every screen of the browser in the dark and in the light theme and saves a picture of each:
 *   - the browser frame (tab strip, toolbar, bookmarks bar)
 *   - the internal pages: New Tab, Settings, History, Bookmarks, Downloads, Extensions, Notes, the error page, the
 *     crash page
 *   - the bubbles: ad blocker (shield), downloads, extensions, site permission
 * Each picture must show something (not a blank or single-colour surface), and no screen may break the Content
 * Security Policy. The pictures land in test-results/screens/<platform>/ (CI keeps them as a downloadable artifact), so
 * every redesign step can be compared with the one before. See docs/redesign-plan.md.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/20-screens.e2e.js)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT, runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, listWebContents, waitForWebContents, installMonitors, cspViolations
} = require('./helpers');

const OUT = process.env.SCREENSHOT_DIR || path.join(ROOT, 'test-results', 'screens', process.platform);
const WIDTH = 1280;
const HEIGHT = 800;

const PAGES = [
  ['newtab', 'mtc://newtab'],
  ['settings', 'mtc://settings'],
  ['history', 'mtc://history'],
  ['bookmarks', 'mtc://bookmarks'],
  ['downloads', 'mtc://downloads'],
  ['extensions', 'mtc://extensions'],
  ['notes', 'mtc://notes'],
  ['error', 'mtc://error?code=-105&name=ERR_NAME_NOT_RESOLVED&url=https%3A%2F%2Fexample.invalid%2F'],
  ['crash', 'mtc://crash?tabId=0&reason=crashed&url=https%3A%2F%2Fexample.com%2F']
];

runSuite('SHMMOTH Browser — E2E 20: every screen, captured', async (t) => {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await launchApp();
  const { app, chrome } = ctx;
  await installMonitors(app);
  const shots = [];

  // Saves a picture of the web contents whose address starts with `prefix`; returns how varied it is (distinct colours
  // among sampled pixels) so a blank surface is caught.
  const capture = async (prefix, name) => {
    const r = await app.evaluate(async ({ webContents }, { prefix }) => {
      // the newest one (a page opened again for the other theme, not the one from before)
      const wc = webContents.getAllWebContents().filter((w) => w.getURL().startsWith(prefix)).sort((a, b) => b.id - a.id)[0];
      if (!wc) throw new Error('no web contents at ' + prefix);
      const image = await wc.capturePage();
      const size = image.getSize();
      const png = image.toPNG().toString('base64');
      const bmp = image.toBitmap();
      const colours = new Set();
      const step = Math.max(4, Math.floor(bmp.length / 4 / 4000) * 4);
      for (let i = 0; i + 3 < bmp.length; i += step) colours.add(bmp.readUInt32LE(i));
      return { width: size.width, height: size.height, colours: colours.size, png };
    }, { prefix });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.png, 'base64'));
    delete r.png;
    shots.push({ name, ...r });
    return r;
  };
  const varied = (r, what) => {
    assert(r.width > 100 && r.height > 20, `${what}: ${r.width}×${r.height}`);
    assert(r.colours >= 3, `${what} looks blank (${r.colours} colours)`);
  };
  const setTheme = async (theme) => {
    await api(chrome, 'updateSettings', { theme });
    await waitFor(async () => (await api(chrome, 'getSettings')).theme === theme, { message: 'the theme to be saved' });
    await sleep(500);
  };

  try {
    await app.evaluate(({ BrowserWindow }, { w, h }) => {
      const win = BrowserWindow.getAllWindows().find((x) => /index\.html$/.test(x.webContents.getURL()));
      if (win) { if (win.isMaximized()) win.unmaximize(); win.setContentSize(w, h); }
    }, { w: WIDTH, h: HEIGHT });
    await sleep(500);

    for (const theme of ['dark', 'light']) {
      t.section(`${theme === 'dark' ? 'Dark' : 'Light'} theme`);
      await setTheme(theme);

      for (const [name, url] of PAGES) {
        await t.test(`${name}`, async () => {
          const tabId = await api(chrome, 'createTab', url);
          try {
            await waitForWebContents(app, url.split('?')[0]);
            await waitFor(async () => (await listWebContents(app)).some((w) => w.url.startsWith(url.split('?')[0]) && !w.loading), { message: name + ' to load' });
            await sleep(700);                                                  // fonts, first paint
            varied(await capture(url.split('?')[0], `${theme}-${name}`), name);
          } finally {
            if (typeof tabId === 'string') await api(chrome, 'closeTab', tabId).catch(() => {});
          }
        });
      }

      await t.test('browser frame (tabs, toolbar, bookmarks bar)', async () => {
        for (const url of ['https://example.com/', 'mtc://history']) await api(chrome, 'createTab', url).catch(() => {});
        await api(chrome, 'createTab', 'mtc://newtab');
        await sleep(800);
        varied(await capture(chrome.url().split('#')[0], `${theme}-frame`), 'frame');
      });

      const anchor = { x: WIDTH - 120, y: 50, width: 30, height: 30 };
      const bubbles = [
        ['shield', 'shield-bubble.html', () => api(chrome, 'openShieldBubble', anchor), () => api(chrome, 'closeShieldBubble')],
        ['downloads-bubble', 'download-bubble.html', () => api(chrome, 'openDownloadBubble', anchor), () => api(chrome, 'closeDownloadBubble')],
        ['extensions-bubble', 'extension-bubble.html', () => api(chrome, 'openExtensionBubble', anchor), () => api(chrome, 'closeExtensionBubble')],
        ['permission-bubble', 'permission-bubble.html', () => api(chrome, 'openPermissionBubble', { requestId: 'e2e', origin: 'https://example.com', permission: 'geolocation' }), () => api(chrome, 'closePermissionBubble')]
      ];
      for (const [name, file, open, close] of bubbles) {
        await t.test(`${name}`, async () => {
          await open();
          const wc = await waitFor(async () => (await listWebContents(app)).find((w) => w.url.includes(file) && !w.loading), { message: file });
          await sleep(600);
          try { varied(await capture(wc.url, `${theme}-${name}`), name); } finally { await close(); }
        });
      }
    }

    t.section('Overall');

    await t.test('no screen broke the Content Security Policy', async () => {
      assertEqual((await cspViolations(app)).join('\n'), '', 'CSP violations');
    });

    await t.test('the pictures and an overview page are saved', async () => {
      const rows = shots.map((s) => `<figure><img src="${s.name}.png" alt="${s.name}" loading="lazy"><figcaption>${s.name} — ${s.width}×${s.height}</figcaption></figure>`).join('\n');
      fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>SHMMOTH screens (${process.platform})</title>
<style>body{font:14px system-ui;margin:24px;background:#888}figure{display:inline-block;margin:0 16px 24px 0;vertical-align:top}img{max-width:640px;border:1px solid #444;display:block}figcaption{margin-top:6px}</style>
${rows}\n`);
      assertEqual(shots.length, 2 * (PAGES.length + 1 + 4), 'every screen in both themes');
      console.log(`         pictures: ${OUT}`);
    });
  } finally {
    try { await api(chrome, 'updateSettings', { theme: 'dark' }); } catch (_) { /* closing anyway */ }
    await ctx.close();
  }
});
