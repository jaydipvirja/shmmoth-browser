/**
 * E2E 16 — the ad blocker beyond blocked requests: hiding ad slots, uBlock scriptlets, "My filters", pop-ups
 *
 * The ad blocker only cancelled requests; ad slots stayed as empty boxes, the pop-up / anti-adblock scripts of video and
 * download sites ran untouched, and every window.open() (also from an ad network) became a new tab. Real app, real pages:
 *   - an element that a filter list hides is hidden, a neighbouring one is not; off / paused for the site → shown again
 *   - a uBlock scriptlet rule (`##+js(set-constant, …)`) runs in the page
 *   - a request the lists block never reaches the server
 *   - Settings → My filters hides what the user asks for, and removing the line brings it back
 *   - pop-ups: a real click on a link / button still opens a tab; a window.open() out of a timer, one aimed at an ad address
 *     and one from a paused site / with the switch off behave as documented
 *   - the status the Settings page shows; the secure-DNS test returns a verdict
 *
 * No internet is needed: the lists are seeded into the profile as if they had just been downloaded (fresh copies are used
 * as they are), so the test sees exactly the engine the user gets, without depending on today's EasyList.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/16-adblock-engine.e2e.js)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  runSuite, assert, assertEqual, waitFor, sleep, tmpDir,
  launchApp, api, listWebContents, waitForWebContents, evalIn, startServer
} = require('./helpers');
const { LISTS } = require('../../src/services/filterLists');

const AD_POPUP_HOST = 'http://ads.test-adnet.example/pop';

runSuite('SHMMOTH Browser — E2E 16: ad blocker engine & pop-ups', async (t) => {
  const hits = [];
  const site = await startServer((req, res) => {
    hits.push(req.url);
    const p = req.url.split('?')[0];
    const html = (title, body) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>${title}</title><body style="margin:20px">${body}</body>`); };
    if (p === '/ads/banner.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end('window.__adScript = true;'); }
    if (p === '/page') {
      return html('page', `
        <div id="adbox" class="ad-banner" style="width:120px;height:40px;background:#c00">AD</div>
        <div id="mine" class="my-annoyance" style="width:120px;height:40px;background:#06c">MINE</div>
        <p id="keep">article text</p>
        <script src="/ads/banner.js"></script>
        <script>window.adsEnabled = true;</script>`);
    }
    if (p === '/popup-click') {
      return html('popup click', `
        <a id="link" href="/popup-target?from=link" target="_blank" style="display:block;width:200px;height:40px">open link</a>
        <button id="open" style="display:block;width:200px;height:40px" onclick="window.open('/popup-target?from=button')">open</button>
        <button id="openad" style="display:block;width:200px;height:40px" onclick="window.open('${AD_POPUP_HOST}?x=1')">open ad</button>`);
    }
    if (p === '/popup-timer') {
      return html('popup timer', `<p>nothing to click</p><script>setTimeout(function () { window.open('/popup-target?from=timer'); }, 400);</script>`);
    }
    return html('target', 'target page');
  });

  // The lists, as if downloaded a moment ago
  const userData = tmpDir();
  const listsDir = path.join(userData, 'adblock-engine-2-lists');
  fs.mkdirSync(listsDir, { recursive: true });
  const seed = (id, text) => {
    fs.writeFileSync(path.join(listsDir, id + '.txt'), text);
    fs.writeFileSync(path.join(listsDir, id + '.json'), JSON.stringify({ fetchedAt: Date.now(), url: 'seeded by the test' }));
  };
  for (const l of LISTS) seed(l.id, '! empty seed\n');
  seed('easylist', [
    '[Adblock Plus 2.0]', '! Title: E2E list',
    '##.ad-banner',
    '/ads/banner.js',
    '||ads.test-adnet.example^',
    '127.0.0.1##+js(set-constant, adsEnabled, false)'
  ].join('\n') + '\n');
  seed('resources', fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ublock-resources-min.json'), 'utf8'));

  const ctx = await launchApp({ userData });
  const { app } = ctx;

  const open = async (p) => { await api(ctx.chrome, 'createTab', site.url + p); await waitForWebContents(app, site.url + p); await sleep(700); return site.url + p; };
  const clickIn = (url, selector) => app.evaluate(async ({ webContents }, { url, selector }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
    const r = await wc.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    wc.focus();
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  }, { url, selector });
  const display = (url, id) => evalIn(app, url, `getComputedStyle(document.getElementById(${JSON.stringify(id)})).display`);
  const tabsAt = async (prefix) => (await listWebContents(app)).filter((w) => w.url.startsWith(prefix)).length;
  const popups = (from) => tabsAt(`${site.url}/popup-target?from=${from}`);

  try {
    t.section('The engine');

    await t.test('the status says the real engine is in force, with rules, scriptlets and no failed list', async () => {
      const st = await waitFor(async () => { const s = await api(ctx.chrome, 'getAdBlockerStatus'); return s && s.engine === 'full' ? s : null; }, { message: 'the engine to be ready', timeout: 30000 });
      assert(st.networkRules >= 2 && st.cosmeticRules >= 2, JSON.stringify(st));
      assertEqual(st.scriptlets, true, 'scriptlets');
      assertEqual(st.listsLoaded, st.listsTotal, 'lists loaded');
      assert(st.lists.every((l) => l.ok), 'a list is reported as failed: ' + JSON.stringify(st.lists.filter((l) => !l.ok)));
    });

    t.section('Hiding, scripts and blocked requests');

    await t.test('an ad slot that a list hides is hidden, its neighbours are not, the blocked script never reaches the server and the scriptlet ran', async () => {
      hits.length = 0;
      const url = await open('/page');
      await waitFor(async () => (await display(url, 'adbox')) === 'none', { message: 'the ad slot to be hidden' });
      assertEqual(await display(url, 'keep'), 'block', 'the article text must stay');
      assertEqual(await display(url, 'mine'), 'block', 'no rule for this one yet');
      assert(!hits.includes('/ads/banner.js'), 'the blocked script reached the server');
      assertEqual(await evalIn(app, url, 'window.__adScript === true'), false, 'the blocked script ran');
      assertEqual(await evalIn(app, url, 'window.adsEnabled'), false, 'the scriptlet should have set adsEnabled to false');
    });

    await t.test('with the blocker paused for the site, nothing is hidden or blocked there', async () => {
      await api(ctx.chrome, 'updateSettings', { adBlockerAllowlist: ['127.0.0.1'] });
      hits.length = 0;
      const url = await open('/page?paused');
      await sleep(800);
      assertEqual(await display(url, 'adbox'), 'block', 'hidden although paused');
      assertEqual(await evalIn(app, url, 'window.adsEnabled'), true, 'scriptlet ran although paused');
      assert(hits.includes('/ads/banner.js'), 'the script was blocked although paused');
      await api(ctx.chrome, 'updateSettings', { adBlockerAllowlist: [] });
    });

    await t.test('with the blocker off nothing is hidden, and it hides again when switched back on', async () => {
      await api(ctx.chrome, 'updateSettings', { adBlockerEnabled: false });
      let url = await open('/page?off');
      await sleep(800);
      assertEqual(await display(url, 'adbox'), 'block', 'hidden although the blocker is off');
      await api(ctx.chrome, 'updateSettings', { adBlockerEnabled: true });
      url = await open('/page?on-again');
      await waitFor(async () => (await display(url, 'adbox')) === 'none', { message: 'hiding to work again after switching on' });
    });

    await t.test('My filters: a line hides what the user asks for at once, and removing it brings the element back', async () => {
      await api(ctx.chrome, 'updateSettings', { adBlockerCustomFilters: '! my rules\n127.0.0.1##.my-annoyance\n' });
      let url = await open('/page?custom');
      await waitFor(async () => (await display(url, 'mine')) === 'none', { message: 'the user\'s own rule to hide the element' });
      assertEqual((await api(ctx.chrome, 'getAdBlockerStatus')).customRules, 2, 'rules counted');
      await api(ctx.chrome, 'updateSettings', { adBlockerCustomFilters: '' });
      url = await open('/page?custom-removed');
      await waitFor(async () => (await display(url, 'adbox')) === 'none', { message: 'the lists to keep working' });
      assertEqual(await display(url, 'mine'), 'block', 'the removed rule must not hide the element any more');
    });

    t.section('Pop-ups');

    await t.test('a real click on a link or a button still opens a tab', async () => {
      const url = await open('/popup-click');
      await clickIn(url, '#link');
      await waitFor(async () => (await popups('link')) === 1, { message: 'the tab of the clicked link' });
      const url2 = await open('/popup-click?again');
      await clickIn(url2, '#open');
      await waitFor(async () => (await popups('button')) === 1, { message: 'the tab opened by the clicked button' });
    });

    await t.test('a window.open() to an ad address is refused even though the user clicked', async () => {
      const url = await open('/popup-click?ad');
      const before = (await listWebContents(app)).length;
      await clickIn(url, '#openad');
      await sleep(1200);
      const after = await listWebContents(app);
      assertEqual(after.length, before, 'a tab was opened');
      assert(!after.some((w) => w.url.includes('ads.test-adnet.example')), 'a tab went to the ad address');
    });

    await t.test('a window.open() that nobody clicked for (a timer) is refused', async () => {
      await open('/popup-timer');
      await sleep(1500);
      assertEqual(await popups('timer'), 0, 'a pop-up opened out of nowhere');
    });

    await t.test('paused for the site, or with the switch off, the same timer pop-up is let through', async () => {
      await api(ctx.chrome, 'updateSettings', { adBlockerAllowlist: ['127.0.0.1'] });
      await open('/popup-timer?paused');
      await waitFor(async () => (await popups('timer')) >= 1, { message: 'the pop-up of a paused site', timeout: 8000 });
      await api(ctx.chrome, 'updateSettings', { adBlockerAllowlist: [], popupBlockerEnabled: false });
      const before = await popups('timer');
      await open('/popup-timer?switch-off');
      await waitFor(async () => (await popups('timer')) > before, { message: 'the pop-up with the switch off', timeout: 8000 });
      await api(ctx.chrome, 'updateSettings', { popupBlockerEnabled: true });
    });

    t.section('Secure DNS test');

    await t.test('the secure-DNS test returns a verdict and a plain explanation', async () => {
      const r = await api(ctx.chrome, 'testSecureDns');
      assert(['working', 'not-filtering', 'broken', 'proxy', 'off', 'encrypted'].includes(r.verdict), JSON.stringify(r));
      assert(typeof r.message === 'string' && r.message.length > 20, 'message');
      assert(r.details && typeof r.details.adDomainSecure === 'string', 'details');
    });

    await t.test('no errors from the ad blocker in the log', async () => {
      const text = ctx.log.text;
      assert(!/Could not register the element-hiding script|Could not apply the custom ad-block filters|Attempted to register a second handler/.test(text), (text.match(/(Could not (register|apply)[^\n]*|Attempted to register[^\n]*)/) || [''])[0]);
      assertEqual((text.match(/\(electron\)[^\n]*/g) || []).join(' | '), '');
    });
  } finally {
    await ctx.close();
    await site.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
