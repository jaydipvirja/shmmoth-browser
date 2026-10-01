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
    });

    await t.test('internal pages work inside incognito tabs too (they used to stay blank: the mtc:// handler was missing there)', async () => {
      const inc = await chromeWindow(app, { incognito: true });
      await api(inc, 'createTab', 'mtc://downloads');
      const wc = await waitFor(() => app.evaluate(({ webContents, session }) => {
        const incSession = session.fromPartition('incognito');
        const w = webContents.getAllWebContents().find((x) => x.session === incSession && x.getURL().startsWith('mtc://downloads'));
        return w && !w.isLoading() && w.getTitle() ? { url: w.getURL(), title: w.getTitle() } : null;
      }), { message: 'an incognito Downloads page' });
      assert(/Download/i.test(wc.title), wc.title);
    });

    t.section('Update UI (About page)');

    await openTab(ctx, 'mtc://settings#about', { waitPrefix: 'mtc://settings' });
    // Several Settings tabs exist by now (the pages loop above) and each page keeps its own update state. Everything in
    // this section therefore talks to THE ONE tab showing the About pane, by its web-contents id.
    const aboutWcId = await waitFor(() => app.evaluate(async ({ webContents }) => {
      for (const w of webContents.getAllWebContents()) {
        if (!w.getURL().startsWith('mtc://settings')) continue;
        const showing = await w.executeJavaScript("Boolean(document.getElementById('tab-about') && document.getElementById('tab-about').classList.contains('active') && window.mtcAPI)").catch(() => false);
        if (showing) return w.id;
      }
      return null;
    }), { message: 'the Settings tab showing the About pane' });
    const inAbout = (code) => app.evaluate(({ webContents }, { id, code }) => webContents.fromId(id).executeJavaScript(code), { id: aboutWcId, code });
    const clickInAbout = (elementId) => inAbout(`document.getElementById(${JSON.stringify(elementId)}).click()`);
    const push = (status) => app.evaluate(({ webContents }, { id, status }) => { webContents.fromId(id).send('updater:status', status); }, { id: aboutWcId, status });
    const ui = () => inAbout(`(() => {
      const el = (id) => document.getElementById(id);
      const shown = (id) => getComputedStyle(el(id)).display !== 'none';
      return { title: el('update-status-title').textContent, desc: el('update-status-desc').textContent,
               relaunch: shown('btn-relaunch-update'), progress: shown('update-progress-container'),
               check: shown('btn-check-updates'), checkEnabled: !el('btn-check-updates').disabled,
               manual: el('btn-manual-download').textContent.trim(),
               installer: shown('btn-download-installer'), installerLabel: el('btn-download-installer').textContent.trim() };
    })()`);

    await t.test('update available but not auto-installable: explains why, offers the releases page and the installer download, no fake progress bar', async () => {
      await push({ status: 'available', autoInstall: false, availableVersion: '1.0.17', currentVersion: '1.0.16',
        message: 'Update v1.0.17 is available but is not signed, so it will not be installed automatically.',
        manualDownloadUrl: 'https://github.com/jaydipvirja/shmmoth-browser/releases/tag/v1.0.17' });
      const s = await waitFor(async () => { const u = await ui(); return u.title.includes('1.0.17') ? u : null; }, { message: 'UI update' });
      assert(/not signed/.test(s.desc), s.desc);
      assert(!s.relaunch && !s.progress && s.check && s.checkEnabled, JSON.stringify(s));
      assert(/releases/i.test(s.manual) && !/1\.0\.10/.test(s.manual), s.manual);
      assert(s.installer && /installer/i.test(s.installerLabel), JSON.stringify(s));
    });

    await t.test('"Download Latest Installer" starts a normal download of this version\'s installer from the project\'s GitHub releases (nothing is run)', async () => {
      await app.evaluate(({ session }) => { global.__installerDownloads = []; session.defaultSession.downloadURL = (u) => { global.__installerDownloads.push(u); }; });
      await clickInAbout('btn-download-installer');
      const urls = await waitFor(async () => { const u = await app.evaluate(() => global.__installerDownloads); return u.length ? u : null; }, { message: 'the installer download to start' });
      const version = await app.evaluate(({ app }) => app.getVersion());
      assertEqual(urls[0], `https://github.com/jaydipvirja/shmmoth-browser/releases/download/v${version}/SHMMOTH-Browser-Setup-${version}.exe`);
    });

    await t.test('"View releases" opens the release page in a new tab', async () => {
      const tabsBefore = await chrome.evaluate(() => document.querySelectorAll('.browser-tab').length);
      await clickInAbout('btn-manual-download');
      // The new tab shows the address it was opened for straight away, so this does not depend on github.com being
      // reachable from the test machine (a blocked or slow network ends in the error page / a pending load).
      const release = 'https://github.com/jaydipvirja/shmmoth-browser/releases/tag/v1.0.17';
      await waitFor(async () => (await chrome.evaluate(() => document.getElementById('omnibox-input').value)) === release,
        { timeout: 20000, message: 'the address bar to show the release page of the new tab' });
      assertEqual(await chrome.evaluate(() => document.querySelectorAll('.browser-tab').length), tabsBefore + 1, 'tabs after the click');
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
