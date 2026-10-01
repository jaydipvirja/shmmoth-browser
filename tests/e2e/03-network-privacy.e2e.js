/**
 * E2E 03 — network privacy (proxy, incognito, downloads, WebRTC)
 *
 * A local HTTP proxy is the ONLY way to reach http://private-site.test (the name does not resolve),
 * so a request that reaches the proxy is proof that the browser honoured the proxy setting, and a
 * request that fails proves it went around it.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/03-network-privacy.e2e.js)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, chromeWindow, api, tmpDir, listWebContents, waitForWebContents, evalIn,
  startServer, fileHandler, NO_SYSTEM_PROXY_ENV
} = require('./helpers');

runSuite('SHMMOTH Browser — E2E 03: network privacy', async (t) => {
  // "origin" server for the no-proxy Turbo test
  const origin = await startServer(fileHandler({ filename: 'direct.bin' }));

  // the proxy: records what it is asked for and answers for private-site.test itself
  const seen = [];
  const bigFile = fileHandler({ filename: 'proxied.bin' });
  const proxy = await startServer((req, res) => {
    seen.push(req.url.replace(/^http:\/\/private-site\.test(:\d+)?/, ''));
    if (req.url.includes('/file')) return bigFile(req, res);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>via-proxy</title>proxied');
  });
  proxy.server.on('connect', (req, sock) => sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));

  const downloadsDir = tmpDir('shmmoth-e2e-downloads-');
  // start without any inherited system-proxy variables so "no proxy" really means no proxy
  const ctx = await launchApp({ env: NO_SYSTEM_PROXY_ENV });
  const { app, chrome } = ctx;
  const proxied = (path0) => seen.some((u) => u.startsWith(path0));
  const downloads = async (page) => (await api(page, 'getDownloads'));
  const waitDownload = (page, name) => waitFor(async () => {
    const d = (await downloads(page)).find((x) => x.filename === name);
    return d && d.state === 'completed' ? d : null;
  }, { timeout: 30000, message: `download ${name} to complete` });

  try {
    await api(chrome, 'updateSettings', { downloadPath: downloadsDir });

    t.section('Without a proxy');

    const systemProxy = await app.evaluate(async ({ session }) => {
      const r = await session.defaultSession.resolveProxy('https://www.example.com/');   // same probe the app uses
      return r.split(';').some((h) => h.trim() && !/^DIRECT$/i.test(h.trim()));
    });
    if (systemProxy) {
      t.skip('a download is taken over by the Turbo engine and completes', 'this machine uses a system proxy');
    } else {
      await t.test('a download is taken over by the Turbo engine and completes', async () => {
        await api(chrome, 'createTab', `${origin.url}/direct`);
        const d = await waitDownload(chrome, 'direct.bin');
        assertEqual(Boolean(d.isTurbo), true, 'isTurbo');
        assertEqual(d.received, 3 * 1024 * 1024, 'bytes');
        assertEqual(fs.statSync(path.join(downloadsDir, 'direct.bin')).size, 3 * 1024 * 1024, 'file on disk');
      });
    }

    t.section('With a manual proxy');

    await t.test('saving a manual proxy succeeds', async () => {
      const res = await api(chrome, 'saveProxyConfig', { mode: 'manual', rules: { protocol: 'http', host: '127.0.0.1', port: proxy.port, bypassRules: '<local>' } });
      assertEqual(res.success, true, JSON.stringify(res));
    });

    await t.test('a normal tab goes through the proxy', async () => {
      await api(chrome, 'createTab', 'http://private-site.test:8080/normal-page');
      await waitFor(() => proxied('/normal-page'), { message: 'the proxy to see /normal-page' });
    });

    await t.test('an INCOGNITO tab goes through the proxy too (it used to bypass it)', async () => {
      await api(chrome, 'newIncognitoWindow');
      const inc = await chromeWindow(app, { incognito: true });
      await waitFor(() => inc.evaluate(() => Boolean(window.mtcAPI)), { message: 'incognito chrome' });
      ctx.incognito = inc;
      await api(inc, 'createTab', 'http://private-site.test:8080/incog-page');
      await waitFor(() => proxied('/incog-page'), { message: 'the proxy to see /incog-page' });
    });

    await t.test('every tab pointing at the proxied site has the WebRTC leak guard', async () => {
      const policies = await waitFor(async () => {
        const p = await app.evaluate(({ webContents }) => webContents.getAllWebContents()
          .filter((w) => /private-site\.test/.test(w.getURL())).map((w) => w.getWebRTCIPHandlingPolicy()));
        return p.length >= 2 ? p : null;
      }, { message: 'the normal and the incognito tab to show their URL' });
      assertEqual(policies.join(), policies.map(() => 'disable_non_proxied_udp').join());
    });

    await t.test('downloads use the native (proxy-aware) downloader and complete through the proxy', async () => {
      await api(chrome, 'createTab', 'http://private-site.test:8080/file-normal');
      const d = await waitDownload(chrome, 'proxied.bin');
      assertEqual(Boolean(d.isTurbo), false, 'isTurbo');
      assertEqual(d.received, 3 * 1024 * 1024, 'bytes');
      assert(proxied('/file-normal'), 'the proxy never saw the download');
    });

    await t.test('incognito downloads are proxied as well and stay incognito', async () => {
      await api(ctx.incognito, 'createTab', 'http://private-site.test:8080/file-incog');
      await waitFor(async () => (await downloads(ctx.incognito)).some((x) => x.isIncognito && x.state === 'completed'), { timeout: 30000, message: 'incognito download' });
      assert(proxied('/file-incog'), 'the proxy never saw the incognito download');
      const d = (await downloads(ctx.incognito)).find((x) => x.isIncognito);
      assertEqual(Boolean(d.isTurbo), false);
    });

    await t.test('resetting the proxy restores the default WebRTC policy', async () => {
      await api(chrome, 'resetProxyConfig');
      await waitFor(async () => {
        const policies = await app.evaluate(({ webContents }) => webContents.getAllWebContents()
          .filter((w) => /private-site\.test/.test(w.getURL())).map((w) => w.getWebRTCIPHandlingPolicy()));
        return policies.length > 0 && policies.every((p) => p === 'default');
      }, { message: 'policy back to default' });
      assertEqual((await api(chrome, 'getProxyConfig')).mode, 'system');
    });
  } finally {
    await ctx.close();
    await proxy.close();
    await origin.close();
    fs.rmSync(downloadsDir, { recursive: true, force: true });
  }
});
