/**
 * E2E 02 — security model
 *
 * Each test replays an attack against the real app and checks it does not work:
 *   - hostile page <title> injected into the privileged history page (stored XSS)
 *   - web page opening mtc:// pages; local file:// documents receiving the browser API
 *   - CSP as the second line of defence; renderer sandbox; page environment; UA/Client-Hints consistency
 *   - login-form capture still works (and cannot be abused by plain pages)
 *
 * Run: npm run test:e2e   (or: node tests/e2e/02-security.e2e.js)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, chromeWindow, api, tmpDir, listWebContents, waitForWebContents, evalIn, openTab,
  installMonitors, cspViolations, startServer
} = require('./helpers');

// The payload only changes document.title / sets a flag — it never does anything harmful.
const HOSTILE_TITLE = 'Innocent page" tabindex="0" autofocus onfocus="document.title=\'XSS_API:\'+typeof window.mtcAPI" data-x="';

runSuite('SHMMOTH Browser — E2E 02: security', async (t) => {
  const site = await startServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/evil')) {
      res.end(`<!doctype html><title>${HOSTILE_TITLE.replace(/"/g, '&quot;')}</title><body>evil</body>`);
    } else if (req.url.startsWith('/login')) {
      res.end('<!doctype html><title>login</title><form id="f" onsubmit="return false"><input name="email" value="me@example.com"><input type="password" name="pw" value="not-a-real-password"></form>');
    } else {
      res.end('<!doctype html><title>Plain page</title><body>hello</body>');
    }
  });

  const localDir = tmpDir('shmmoth-e2e-local-');
  const localFile = path.join(localDir, 'attacker.html');
  fs.writeFileSync(localFile, '<!doctype html><title>pending</title><script>setTimeout(() => { document.title = "FILE_API:" + typeof window.mtcAPI; }, 200);</script>');

  const ctx = await launchApp();
  const { app, chrome } = ctx;
  await installMonitors(app);

  try {
    t.section('Stored XSS through page titles (history page)');

    await t.test('a hostile <title> is shown as inert text and runs nothing in the privileged history page', async () => {
      await openTab(ctx, `${site.url}/evil`);
      await api(chrome, 'navigateCurrentTab', `${site.url}/next`);
      await waitForWebContents(app, `${site.url}/next`);
      await openTab(ctx, 'mtc://history');
      await sleep(800); // an injected autofocus handler would have fired by now
      const r = await evalIn(app, 'mtc://history', `(() => ({
        title: document.title,
        injected: document.querySelectorAll('[onfocus], [data-x], [autofocus]').length,
        shown: Array.from(document.querySelectorAll('.history-title')).some(e => e.textContent.includes('onfocus='))
      }))()`);
      assert(!r.title.startsWith('XSS_API:'), 'script ran with the browser API: ' + r.title);
      assertEqual(r.injected, 0, 'injected attributes');
      assert(r.shown, 'the hostile title should be displayed as text');
    });

    t.section('Web content cannot reach privileged pages');

    await t.test('window.open("mtc://settings") from a web page opens nothing', async () => {
      await openTab(ctx, `${site.url}/plain`);
      const count = async () => (await listWebContents(app)).filter((w) => w.url.startsWith('mtc://settings')).length;
      const before = await count();
      await evalIn(app, `${site.url}/plain`, 'window.open("mtc://settings")', { gesture: true });
      await sleep(1500);
      assertEqual(await count(), before, 'mtc://settings tabs');
    });

    await t.test('a local file typed into the omnibox is shown but gets NO browser API', async () => {
      await api(chrome, 'createTab', 'mtc://newtab');            // a tab that started with the internal preload
      await waitForWebContents(app, 'mtc://newtab');
      await api(chrome, 'navigateCurrentTab', pathToFileURL(localFile).href);
      const wc = await waitFor(async () => (await listWebContents(app)).find((w) => w.url.startsWith('file:') && w.title.startsWith('FILE_API:')), { message: 'the local file to report' });
      assertEqual(wc.title, 'FILE_API:undefined');
    });

    await t.test('web pages see no mtcAPI, require, process or Buffer', async () => {
      const r = await evalIn(app, `${site.url}/plain`, '[typeof window.mtcAPI, typeof window.shmmothAPI, typeof require, typeof process, typeof Buffer].join()');
      assertEqual(r, 'undefined,undefined,undefined,undefined,undefined');
    });

    t.section('Content-Security-Policy (second line of defence)');

    await t.test('inline event handlers are refused in the browser chrome and in mtc:// pages', async () => {
      const probe = `document.body.insertAdjacentHTML('beforeend', '<img src="x:bad" onerror="window.__inlineRan=true">'); new Promise(r => setTimeout(() => r(window.__inlineRan === true), 400))`;
      assertEqual(await chrome.evaluate(probe), false, 'chrome window ran an inline handler');
      assertEqual(await evalIn(app, 'mtc://history', probe), false, 'mtc:// page ran an inline handler');
      // console messages reach the main process asynchronously (noticeably slower on a busy Windows runner)
      const reported = await waitFor(async () => {
        const v = (await cspViolations(app)).filter((m) => /inline event handler/i.test(m));
        return v.length >= 2 ? v : null;
      }, { timeout: 10000, message: 'the CSP to report the blocked handlers of both pages' }).catch(async (err) => {
        throw new Error(`${err.message}; saw: ${JSON.stringify(await cspViolations(app))}`);
      });
      assert(reported.length >= 2, 'the CSP should have reported the blocked handlers');
    });

    t.section('Renderer sandbox and isolation');

    await t.test('every window and view is sandboxed, context-isolated and without Node integration', async () => {
      await api(chrome, 'toggleSidePanel', 'notes');
      await api(chrome, 'newIncognitoWindow');
      const inc = await chromeWindow(app, { incognito: true });
      await waitFor(() => inc.evaluate(() => Boolean(window.mtcAPI)), { message: 'incognito chrome' });
      await api(inc, 'createTab', `${site.url}/plain`);
      await sleep(1000);
      const rows = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((wc) => {
        const p = wc.getLastWebPreferences() || {};
        return { url: wc.getURL().replace(/^file:.*\//, 'file:…/').slice(0, 60), sandbox: p.sandbox, ci: p.contextIsolation, ni: p.nodeIntegration };
      }));
      const ours = rows.filter((r) => !r.url.startsWith('chrome-extension://') && !r.url.startsWith('devtools://'));
      assert(ours.length >= 5, 'expected several web contents, got ' + ours.length);
      const bad = ours.filter((r) => r.sandbox !== true || r.ci !== true || r.ni === true);
      assertEqual(JSON.stringify(bad), '[]', 'unprotected web contents');
    });

    t.section('Browser identity');

    await t.test('navigator.userAgent and userAgentData match the running Chromium (no Electron token, no stale version, nothing disguised)', async () => {
      const major = await app.evaluate(() => process.versions.chrome.split('.')[0]);
      const r = await evalIn(app, `${site.url}/plain`, `({ ua: navigator.userAgent, brands: navigator.userAgentData.brands.map(b => b.brand + "/" + b.version),
        nativeBrands: /\\[native code\\]/.test(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator.userAgentData), 'brands').get.toString()),
        nativeHigh: /\\[native code\\]/.test(navigator.userAgentData.getHighEntropyValues.toString()) })`);
      assert(!/Electron\//.test(r.ua) && !/mtc-browser|shmmoth/i.test(r.ua), r.ua);
      assert(r.ua.includes(`Chrome/${major}.`), `UA ${r.ua} should carry Chrome/${major}`);
      // the engine's own brands: a page script that claimed "Google Chrome" is what got the Google sign-in refused
      assert(r.brands.includes(`Chromium/${major}`) && !r.brands.some((b) => /Google Chrome/.test(b)), r.brands.join());
      assert(r.nativeBrands && r.nativeHigh, 'navigator.userAgentData was replaced by a page script');
    });

    t.section('Password capture');

    await t.test('submitting a login form is captured by the browser (save prompt, or a clear refusal without OS encryption)', async () => {
      await openTab(ctx, `${site.url}/login`);
      await evalIn(app, `${site.url}/login`, 'document.getElementById("f").requestSubmit()', { gesture: true });
      await waitFor(async () => /Password save prompts disabled/.test(ctx.log.text)
        || (await listWebContents(app)).some((w) => w.url.includes('password-bubble.html')),
        { timeout: 10000, message: 'the capture to reach the password manager' });
    });

    await t.test('no deprecation warnings were printed during all of this', async () => {
      assertEqual((ctx.log.text.match(/\(electron\)[^\n]*/g) || []).join(' | '), '');
    });
  } finally {
    await ctx.close();
    await site.close();
    fs.rmSync(localDir, { recursive: true, force: true });
  }
});
