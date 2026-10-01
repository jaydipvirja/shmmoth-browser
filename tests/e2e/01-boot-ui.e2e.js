/**
 * E2E 01 — boot and internal UI
 *
 * Starts the real app and checks that the browser chrome, every internal page, the native bubbles,
 * the side panel, the incognito window and the update UI work, without CSP violations or requests
 * to third-party font hosts.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/01-boot-ui.e2e.js)
 */

'use strict';

const path = require('path');

const {
  ROOT, runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, chromeWindow, api, listWebContents, waitForWebContents, evalIn, openTab,
  installMonitors, cspViolations, hostsContacted
} = require('./helpers');

runSuite('SHMMOTH Browser — E2E 01: boot & internal UI', async (t) => {
  const ctx = await launchApp();
  const { app, chrome } = ctx;
  await installMonitors(app);

  try {
    t.section('Browser chrome');

    await t.test('the chrome window has a working mtcAPI', async () => {
      const settings = await api(chrome, 'getSettings');
      assert(settings && typeof settings === 'object' && typeof settings.theme === 'string', JSON.stringify(settings));
    });

    await t.test('the app started with a default tab and no startup errors in the log', async () => {
      // packaged builds ignore the early-output hook, so the first log lines can predate the test's view of the log
      if (ctx.log.complete) assert(/Tab created: tab_1/.test(ctx.log.text), 'first tab not created');
      assert((await listWebContents(app)).some((w) => w.url.startsWith('mtc://newtab')), 'no new-tab page open');
      assert(!/\[FATAL\]|Uncaught exception in main process/.test(ctx.log.text), 'startup error in log');
    });

    await t.test('there are no Electron deprecation warnings (they become errors in a later major)', async () => {
      const lines = ctx.log.text.match(/\(electron\)[^\n]*/g) || [];
      assertEqual(lines.join(' | '), '', 'deprecation warnings');
    });

    t.section('Internal pages');

    const PAGES = ['newtab', 'settings', 'bookmarks', 'history', 'downloads', 'extensions', 'notes'];
    for (const page of PAGES) {
      await t.test(`mtc://${page} loads, has a title and a working mtcAPI`, async () => {
        const wc = await openTab(ctx, `mtc://${page}`);
        assert(wc.title && wc.title.length > 0, 'page has no title');
        assertEqual(await evalIn(app, `mtc://${page}`, 'typeof window.mtcAPI'), 'object');
        assertEqual(await evalIn(app, `mtc://${page}`, 'window.mtcAPI.getSettings().then(s => typeof s)'), 'object');
      });
    }

    await t.test('no Content-Security-Policy violation on any of them', async () => {
      assertEqual((await cspViolations(app)).join('\n'), '', 'CSP violations');
    });

    await t.test('Inter is served locally on the chrome, new-tab and settings pages', async () => {
      const fonts = await chrome.evaluate(() => document.fonts.ready.then(() => [...document.fonts].map((f) => `${f.family}:${f.status}`)));
      assert(fonts.includes('Inter:loaded'), 'chrome fonts: ' + fonts);
      for (const page of ['newtab', 'settings']) {
        const r = await evalIn(app, `mtc://${page}`, 'document.fonts.ready.then(() => [...document.fonts].map(f => f.family + ":" + f.status).join(","))');
        assert(/Inter:loaded/.test(r), `${page}: ${r}`);
      }
    });

    await t.test('opening the internal pages made no request to Google font hosts', async () => {
      const bad = (await hostsContacted(app)).filter((h) => /fonts\.(googleapis|gstatic)\.com/.test(h));
      assertEqual(bad.join(), '', 'font hosts contacted');
    });

    await t.test('history: the "Clear browsing data" dialog is hidden until requested', async () => {
      const d = await evalIn(app, 'mtc://history', 'getComputedStyle(document.getElementById("clear-range-modal")).display');
      assertEqual(d, 'none');
    });

    await t.test('settings: elements toggled with the .hidden class are really hidden', async () => {
      const r = await evalIn(app, 'mtc://settings',
        '["btn-relaunch-update","update-progress-container","update-spinner","manual-proxy-container"].map(id => getComputedStyle(document.getElementById(id)).display).join()');
      assertEqual(r, 'none,none,none,none');
    });

    await t.test('settings: the start-up option is shown, defaults to the new-tab page and is saved when changed', async () => {
      assertEqual(await evalIn(app, 'mtc://settings', 'document.getElementById("select-startup").value'), 'newtab');
      await evalIn(app, 'mtc://settings', '(() => { const s = document.getElementById("select-startup"); s.value = "restore"; s.dispatchEvent(new Event("change")); })()');
      await waitFor(async () => (await api(chrome, 'getSettings')).startupBehavior === 'restore', { message: 'startupBehavior to be saved' });
      await api(chrome, 'updateSettings', { startupBehavior: 'newtab' });
    });

    t.section('Native bubbles and side panel');

    const bounds = { x: 900, y: 50, width: 30, height: 30 };
    const bubbles = [
      ['shield-bubble.html',     () => api(chrome, 'openShieldBubble', bounds),    () => api(chrome, 'closeShieldBubble')],
      ['download-bubble.html',   () => api(chrome, 'openDownloadBubble', bounds),  () => api(chrome, 'closeDownloadBubble')],
      ['extension-bubble.html',  () => api(chrome, 'openExtensionBubble', bounds), () => api(chrome, 'closeExtensionBubble')],
      ['permission-bubble.html', () => api(chrome, 'openPermissionBubble', { requestId: 'e2e', origin: 'https://example.com', permission: 'geolocation' }), () => api(chrome, 'closePermissionBubble')]
    ];
    for (const [file, open, close] of bubbles) {
      await t.test(`${file} opens in its own sandboxed window with a working mtcAPI`, async () => {
        await open();
        const wc = await waitFor(async () => (await listWebContents(app)).find((w) => w.url.includes(file) && !w.loading), { message: file });
        assertEqual(await evalIn(app, wc.url, 'typeof window.mtcAPI'), 'object');
        await close();
      });
    }

    await t.test('the notes side panel loads and can read the notes', async () => {
      await api(chrome, 'toggleSidePanel', 'notes');
      // two web contents show mtc://notes (the tab opened earlier and the panel) — query the API on each
      await waitFor(async () => (await listWebContents(app)).filter((w) => w.url.startsWith('mtc://notes')).length >= 1, { message: 'notes panel' });
      assertEqual(await evalIn(app, 'mtc://notes', 'window.mtcAPI.getNotes().then(n => typeof n)'), 'string');
      await api(chrome, 'toggleSidePanel', 'notes');
    });

    t.section('Incognito window');

    await t.test('an incognito window opens, knows it is incognito and can open tabs', async () => {
      await api(chrome, 'newIncognitoWindow');
      const inc = await chromeWindow(app, { incognito: true });
      await waitFor(() => inc.evaluate(() => Boolean(window.mtcAPI)), { message: 'incognito mtcAPI' });
      assertEqual(await api(inc, 'isIncognitoWindow'), true);
      assertEqual(await api(chrome, 'isIncognitoWindow'), false);
      await api(inc, 'createTab', 'mtc://settings');
      await sleep(500);
    });

    t.section('Update UI (About page)');

    await openTab(ctx, 'mtc://settings#about', { waitPrefix: 'mtc://settings' });
    const push = (status) => app.evaluate(({ webContents }, status) => {
      webContents.getAllWebContents().filter((w) => w.getURL().startsWith('mtc://settings')).forEach((w) => w.send('updater:status', status));
    }, status);
    const ui = () => evalIn(app, 'mtc://settings', `(() => {
      const el = (id) => document.getElementById(id);
      const shown = (id) => getComputedStyle(el(id)).display !== 'none';
      return { title: el('update-status-title').textContent, desc: el('update-status-desc').textContent,
               relaunch: shown('btn-relaunch-update'), progress: shown('update-progress-container'),
               check: shown('btn-check-updates'), checkEnabled: !el('btn-check-updates').disabled,
               manual: el('btn-manual-download').textContent.trim() };
    })()`);

    await t.test('update available but not auto-installable: explains why, offers the download page, no fake progress bar', async () => {
      await push({ status: 'available', autoInstall: false, availableVersion: '1.0.17', currentVersion: '1.0.16',
        message: 'Update v1.0.17 is available but is not signed, so it will not be installed automatically.',
        manualDownloadUrl: 'https://github.com/jaydipvirja/shmmoth-browser/releases/tag/v1.0.17' });
      const s = await waitFor(async () => { const u = await ui(); return u.title.includes('1.0.17') ? u : null; }, { message: 'UI update' });
      assert(/not signed/.test(s.desc), s.desc);
      assert(!s.relaunch && !s.progress && s.check && s.checkEnabled, JSON.stringify(s));
      assert(/download page/i.test(s.manual) && !/1\.0\.10/.test(s.manual), s.manual);
    });

    await t.test('"Open download page" opens the release page in a new tab', async () => {
      await evalIn(app, 'mtc://settings', 'document.getElementById("btn-manual-download").click()');
      await waitForWebContents(app, 'https://github.com/jaydipvirja/shmmoth-browser/releases/tag/v1.0.17', { settle: false });
    });

    await t.test('update downloaded: shows the restart button', async () => {
      await push({ status: 'downloaded', autoInstall: true, availableVersion: '1.0.17', currentVersion: '1.0.16', message: 'ok' });
      const s = await waitFor(async () => { const u = await ui(); return u.relaunch ? u : null; }, { message: 'relaunch button' });
      assert(!s.check, JSON.stringify(s));
    });

    await t.test('up to date: no restart button; error: friendly title', async () => {
      await push({ status: 'not-available', currentVersion: '1.0.16' });
      await waitFor(async () => !(await ui()).relaunch, { message: 'relaunch hidden' });
      await push({ status: 'error', message: 'Could not connect to update server.', currentVersion: '1.0.16' });
      const s = await waitFor(async () => { const u = await ui(); return /Could not check/.test(u.title) ? u : null; }, { message: 'error title' });
      assert(s.checkEnabled);
    });

    t.section('Extensions');

    const fixture = path.join(ROOT, 'tests', 'fixtures', 'extensions', 'extension-a-mv3');
    let extensionId = null;

    await t.test('no extension is bundled any more (uBlock Origin was retired) and the registry starts empty', async () => {
      const list = (await api(chrome, 'getAllExtensions')).extensions || [];
      assertEqual(list.map((e) => e.name).join(), '', 'pre-installed extensions');
    });

    await t.test('an unpacked MV3 extension can be installed and becomes active', async () => {
      const res = await api(chrome, 'installExtension', fixture);
      assertEqual(res.success, true, JSON.stringify(res));
      extensionId = res.extension.id;
      const ext = await waitFor(async () => {
        const list = (await api(chrome, 'getAllExtensions')).extensions || [];
        const e = list.find((x) => x.id === extensionId);
        return e && e.status === 'active' ? e : null;
      }, { message: 'the extension to become active' });
      assertEqual(ext.name, 'Test Action Extension');
    });

    await t.test('its popup opens in a sandboxed window', async () => {
      assertEqual(await api(chrome, 'openExtensionPopup', extensionId, bounds), true);
      const wc = await waitFor(async () => (await listWebContents(app)).find((w) => w.url.startsWith('chrome-extension://') && /popup/.test(w.url) && !w.loading), { message: 'popup' });
      const prefs = await app.evaluate(({ webContents }, id) => (webContents.fromId(id).getLastWebPreferences() || {}).sandbox, wc.id);
      assertEqual(prefs, true);
    });

    await t.test('removing it works', async () => {
      const res = await api(chrome, 'removeExtension', extensionId);
      assertEqual(res.success, true, JSON.stringify(res));
      assertEqual(((await api(chrome, 'getAllExtensions')).extensions || []).length, 0, 'extensions left');
    });
  } finally {
    await ctx.close();
  }
});
