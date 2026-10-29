/**
 * E2E 32 — speed (1.5.6), in the real browser
 *
 *   - typing an address connects to the site before Enter (a connection, no request); Enter then uses it; with
 *     "Open pages faster" off nothing connects ahead
 *   - the tab strip keeps the elements of tabs that did not change (one tab's new title redraws that tab only), and
 *     closing a tab in the middle leaves the others in order
 *   - the ad-block engine is built in the background (a worker thread — also from inside the packaged app)
 *
 * Run: npm run test:e2e   (or: node tests/e2e/32-speed.e2e.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { runSuite, assert, assertEqual, launchApp, api, tmpDir, startServer, sleep, waitFor, waitForWebContents } = require('./helpers');
const filterLists = require('../../src/services/filterLists');

runSuite('SHMMOTH Browser — E2E 32: speed', async (t) => {
  let conns = 0; let reqs = 0; let firstSocketBorn = 0;
  const site = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<title>${req.url.includes('two') ? 'two' : 'page'}</title><p>hello`);
  });
  site.server.on('connection', (socket) => { conns++; socket.bornAt = Date.now(); });
  site.server.on('request', (req) => { if (!reqs++) firstSocketBorn = req.socket.bornAt; });
  const typed = (ctx, text) => ctx.chrome.click('#omnibox-input').then(() => ctx.chrome.keyboard.type(text, { delay: 15 }));

  try {
    await t.test('typing an address connects ahead; Enter uses that connection', async () => {
      const ctx = await launchApp({});
      try {
        conns = 0; reqs = 0;
        await typed(ctx, `localhost:${site.port}/typed`);
        await waitFor(() => conns > 0, { message: 'a connection before Enter', timeout: 5000 });
        assertEqual(reqs, 0, 'nothing requested before Enter');
        const enterAt = Date.now();
        await ctx.chrome.keyboard.press('Enter');
        await waitForWebContents(ctx.app, `http://localhost:${site.port}/typed`);
        assert(reqs >= 1, 'the page was asked for');
        assert(firstSocketBorn && firstSocketBorn < enterAt, 'the page came over the connection opened ahead');
      } finally { await ctx.close(); }
    });

    await t.test('"Open pages faster" off: nothing connects before Enter', async () => {
      const ctx = await launchApp({});
      try {
        await api(ctx.chrome, 'updateSettings', { preconnectWhileTyping: false });
        conns = 0; reqs = 0;
        await typed(ctx, `localhost:${site.port}/off`);
        await sleep(1200);
        assertEqual(conns, 0, 'no connection while typing');
      } finally { await ctx.close(); }
    });

    await t.test('the tab strip redraws only the tab that changed, and keeps the order when one closes', async () => {
      const ctx = await launchApp({});
      try {
        for (const p of ['/one', '/two', '/three']) {
          await api(ctx.chrome, 'createTab', site.url + p);
          await waitForWebContents(ctx.app, site.url + p);
        }
        await waitFor(() => ctx.chrome.evaluate(() => document.querySelectorAll('.browser-tab').length === 4), { message: 'four tabs' });
        // mark every drawn tab element; a redraw would replace the element and lose the mark
        await ctx.chrome.evaluate(() => document.querySelectorAll('.browser-tab').forEach((el) => { el.__mark = el.dataset.tabId; }));
        await waitFor(() => ctx.chrome.evaluate(() => [...document.querySelectorAll('.browser-tab .tab-title')].some((e) => e.textContent === 'two')), { message: 'title two' });
        // tab "two" gets a new title; the others stay the very same elements
        await ctx.app.evaluate(({ webContents }, u) => webContents.getAllWebContents().find((w) => w.getURL() === u).executeJavaScript('document.title = "renamed"'), site.url + '/two');
        await waitFor(() => ctx.chrome.evaluate(() => [...document.querySelectorAll('.browser-tab .tab-title')].some((e) => e.textContent === 'renamed')), { message: 'renamed' });
        const marks = await ctx.chrome.evaluate(() => [...document.querySelectorAll('.browser-tab')].map((el) => [el.querySelector('.tab-title').textContent, Boolean(el.__mark)]));
        for (const [title, kept] of marks) assertEqual(kept, title !== 'renamed', `tab "${title}" ${kept ? 'kept' : 'redrawn'}`);
        // close the renamed tab (in the middle)
        const id = await ctx.chrome.evaluate(() => [...document.querySelectorAll('.browser-tab')].find((el) => el.querySelector('.tab-title').textContent === 'renamed').dataset.tabId);
        await api(ctx.chrome, 'closeTab', id);
        await waitFor(() => ctx.chrome.evaluate(() => document.querySelectorAll('.browser-tab').length === 3), { message: 'three tabs' });
        const order = await ctx.chrome.evaluate(() => [...document.querySelectorAll('.browser-tab')].map((el) => [el.dataset.tabId, Number(el.dataset.index)]));
        const want = await ctx.chrome.evaluate(() => currentTabs.map((t, i) => [t.id, i]));
        assertEqual(JSON.stringify(order), JSON.stringify(want), 'strip order');
      } finally { await ctx.close(); }
    });

    await t.test('the ad-block engine is built in the background', async () => {
      // kept copies of every list (fresh): the engine is built from them at start, no download needed
      const ud = tmpDir('shmmoth-e2e-speed-');
      const dir = path.join(ud, 'adblock-engine-2-lists');
      fs.mkdirSync(dir, { recursive: true });
      for (const l of filterLists.LISTS) {
        let text = `! Title: ${l.id}\n||ads-${l.id}.example^\n`;
        for (let i = 0; i < 50; i++) text += `||t${i}-${l.id}.example^$third-party\n`;
        fs.writeFileSync(path.join(dir, l.id + '.txt'), text);
        fs.writeFileSync(path.join(dir, l.id + '.json'), JSON.stringify({ fetchedAt: Date.now(), url: 'test' }));
      }
      const ctx = await launchApp({ userData: ud });
      try {
        const status = await waitFor(async () => {
          const s = await api(ctx.chrome, 'getAdBlockerStatus');
          return s && s.engine === 'full' && s.builtIn ? s : null;
        }, { message: 'the full engine', timeout: 30000 });
        assertEqual(status.builtIn, 'worker', 'where the engine was built');
        assert(status.networkRules > 50, 'rules: ' + status.networkRules);
        assert(fs.existsSync(path.join(ud, 'adblock-engine-2.bin')), 'engine file written');
      } finally { await ctx.close(); }
    });
  } finally { site.close(); }
});
