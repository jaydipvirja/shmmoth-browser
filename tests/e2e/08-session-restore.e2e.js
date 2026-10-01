/**
 * E2E 08 — session restore ("Continue where I left off")
 *
 * Opens tabs, ends the app (normally and with SIGKILL), starts it again on the same profile and checks which tabs
 * come back: normal tabs only, pinned state kept, only the selected one loaded until the others are opened.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/08-session-restore.e2e.js)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, chromeWindow, api, tmpDir, startServer
} = require('./helpers');

const SESSION = 'shmmoth-session.json';

runSuite('SHMMOTH Browser — E2E 08: session restore', async (t) => {
  const hits = [];
  const site = await startServer((req, res) => {
    if (!req.url.endsWith('favicon.ico')) hits.push(req.url);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>page ${req.url}</title>hello ${req.url}`);
  });
  const hit = (p) => hits.includes(p);

  const strip = (ctx) => ctx.chrome.evaluate(() => [...document.querySelectorAll('.browser-tab')].map((e) => ({
    id: e.dataset.tabId, title: e.title, active: e.classList.contains('active'), pinned: e.classList.contains('pinned')
  })));
  const tabByTitle = async (ctx, title) => {
    const tab = (await strip(ctx)).find((x) => x.title === title);
    assert(tab, `no tab titled "${title}" in ${JSON.stringify(await strip(ctx))}`);
    return tab;
  };
  const readSession = (userData) => { try { return JSON.parse(fs.readFileSync(path.join(userData, SESSION), 'utf8')); } catch (_) { return null; } };
  const waitSession = (userData, pred, message) => waitFor(() => { const s = readSession(userData); return s && pred(s) ? s : null; }, { timeout: 15000, message });
  const urls = (s) => s.tabs.map((x) => x.url.replace(site.url, ''));

  /** A profile with "Continue where I left off" on, and the given pages open. Returns the running app. */
  async function openSession(userData, pages, { restore = true } = {}) {
    const ctx = await launchApp({ userData });
    if (restore) await api(ctx.chrome, 'updateSettings', { startupBehavior: 'restore' });
    for (const p of pages) {
      await api(ctx.chrome, 'createTab', `${site.url}${p}`);
      await waitFor(async () => (await strip(ctx)).some((x) => x.title === `page ${p}`), { message: `tab ${p}` });
    }
    return ctx;
  }

  try {
    t.section('Continue where I left off — normal exit');

    const ud = tmpDir('shmmoth-e2e-session-');
    await t.test('the open tabs are written to disk as they change (normal tabs only, never incognito)', async () => {
      const ctx = await openSession(ud, ['/a', '/b', '/c']);
      try {
        await api(ctx.chrome, 'togglePinTab', (await tabByTitle(ctx, 'page /a')).id);
        await api(ctx.chrome, 'newIncognitoWindow');
        const inc = await chromeWindow(ctx.app, { incognito: true });
        await waitFor(() => inc.evaluate(() => Boolean(window.mtcAPI)), { message: 'incognito chrome' });
        await api(inc, 'createTab', `${site.url}/secret`);
        await waitFor(() => hit('/secret'), { message: 'the incognito page to load' });
        await api(ctx.chrome, 'switchTab', (await tabByTitle(ctx, 'page /b')).id);
        const s = await waitSession(ud, (x) => x.tabs.length >= 4 && x.tabs[x.active].url.endsWith('/b') && x.tabs[0].pinned, 'the session file to list a, b, c with /b active and /a pinned');
        assert(urls(s).includes('/a') && urls(s).includes('/c'), urls(s).join());
        assert(!JSON.stringify(s).includes('secret'), 'the incognito tab was written to the session file');
      } finally { await ctx.close(); }
    });

    await t.test('after a restart the tabs are back: order, titles, pinned state and the selected tab; incognito is gone', async () => {
      hits.length = 0;
      const ctx = await launchApp({ userData: ud, firstTabPrefix: `${site.url}/b` });
      try {
        const tabs = await strip(ctx);
        const titles = tabs.map((x) => x.title);
        for (const p of ['/a', '/b', '/c']) assert(titles.includes(`page ${p}`), `tab ${p} missing: ${titles.join(' | ')}`);
        assert(!titles.some((x) => /secret/.test(x)), 'an incognito page came back');
        assertEqual(tabs.find((x) => x.active).title, 'page /b', 'selected tab');
        assertEqual(tabs.find((x) => x.title === 'page /a').pinned, true, 'pinned');
        assertEqual(tabs[0].title, 'page /a', 'a pinned tab stays first');
      } finally { await ctx.close(); }
    });

    await t.test('only the selected tab loads at start-up; the others load when they are first opened', async () => {
      hits.length = 0;
      const ctx = await launchApp({ userData: ud, firstTabPrefix: `${site.url}/b` });
      try {
        await waitFor(() => hit('/b'), { message: 'the selected tab to load' });
        await sleep(1500);
        assert(!hit('/a') && !hit('/c'), `background tabs were loaded at start-up: ${hits.join(' ')}`);
        await api(ctx.chrome, 'switchTab', (await tabByTitle(ctx, 'page /c')).id);
        await waitFor(() => hit('/c'), { message: '/c to load after being selected' });
        assert(!hit('/a'), '/a loaded without being opened');
      } finally { await ctx.close(); }
    });

    t.section('Crash');

    await t.test('after a crash (process killed) the last tabs come back', async () => {
      const crashed = tmpDir('shmmoth-e2e-session-');
      const ctx = await openSession(crashed, ['/k1', '/k2']);
      await waitSession(crashed, (x) => urls(x).includes('/k1') && urls(x).includes('/k2'), 'the session file to list k1 and k2');
      ctx.app.process().kill('SIGKILL');
      await sleep(500);
      await ctx.close();
      const again = await launchApp({ userData: crashed, firstTabPrefix: `${site.url}/k2` });
      try {
        const titles = (await strip(again)).map((x) => x.title);
        assert(titles.includes('page /k1') && titles.includes('page /k2'), titles.join(' | '));
      } finally { await again.close(); }
    });

    t.section('Command line and defaults');

    await t.test('a URL from the command line is opened in addition to the restored tabs, and is the selected one', async () => {
      const ctx = await launchApp({ userData: ud, args: [`${site.url}/from-cli`], firstTabPrefix: `${site.url}/from-cli` });
      try {
        // the title of a page that was just opened arrives a moment after its address
        const tabs = await waitFor(async () => { const t2 = await strip(ctx); const a = t2.find((x) => x.active); return a && a.title === 'page /from-cli' ? t2 : null; },
          { message: 'the command-line page to be the selected tab' });
        assert(tabs.some((x) => x.title === 'page /a') && tabs.some((x) => x.title === 'page /c'), 'restored tabs missing');
      } finally { await ctx.close(); }
    });

    await t.test('with the default setting ("open the new tab page") nothing is restored', async () => {
      const plain = tmpDir('shmmoth-e2e-session-');
      const first = await openSession(plain, ['/x'], { restore: false });
      await waitSession(plain, (x) => urls(x).includes('/x'), 'the session file');            // it is still written, just not used
      await first.close();
      hits.length = 0;
      const ctx = await launchApp({ userData: plain });
      try {
        const tabs = await strip(ctx);
        assertEqual(tabs.length, 1, 'tabs after start-up: ' + tabs.map((x) => x.title).join(' | '));
        await sleep(500);
        assert(!hit('/x'), 'the old page was loaded');
      } finally { await ctx.close(); }
    });

    t.section('Damaged session file');

    await t.test('start-up still works, the damaged file is kept aside, and the next session is saved normally', async () => {
      const bad = tmpDir('shmmoth-e2e-session-');
      const first = await openSession(bad, ['/d1']);
      await waitSession(bad, (x) => urls(x).includes('/d1'), 'the session file');
      await first.close();
      for (const f of fs.readdirSync(bad)) if (f.startsWith(SESSION + '.bak')) fs.rmSync(path.join(bad, f));
      fs.writeFileSync(path.join(bad, SESSION), '{"version":1,"tabs":[{"url":"https://exa');
      const ctx = await launchApp({ userData: bad });
      try {
        assertEqual((await strip(ctx)).length, 1, 'a fresh new-tab page is expected');
        assert(fs.readdirSync(bad).some((n) => n.startsWith(SESSION + '.corrupt-')), 'the damaged file must be preserved');
        await api(ctx.chrome, 'createTab', `${site.url}/d2`);
        await waitSession(bad, (x) => urls(x).includes('/d2'), 'a valid session file again');
      } finally { await ctx.close(); }
    });
  } finally {
    await site.close();
  }
});
