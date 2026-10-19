/**
 * E2E 28 — privacy shield (1.5.0) in the real browser
 *
 * Two local sites: the page's own (127.0.0.1) and another one (localhost — a different site to Chromium).
 *   - cross-site cookies: the other site, embedded in the page, neither receives its cookie nor can set one; switched
 *     off (or allowed for the site from the shield) it does — and the page's own site keeps its cookies throughout
 *   - link tracking protection: utm_… / fbclid never reach the server, the address bar shows the clean address
 *   - Global Privacy Control: Sec-GPC: 1 on requests, navigator.globalPrivacyControl in the page
 *   - referrer: the other site learns only the page's site, even when the page asks to send the full address
 *   - HTTPS-Only: an http site (plain-http-site.com, mapped to this computer) is asked for over https; it has none, so the
 *     error page says so, and its button continues over http — remembered for the site
 *   - the ad blocker and the Google sign-in rules still work next to it (one request hub)
 *
 * Run: npm run test:e2e   (or: node tests/e2e/28-privacy.e2e.js)
 */
'use strict';

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, startServer, evalIn, waitForWebContents, listWebContents
} = require('./helpers');

runSuite('SHMMOTH Browser — E2E 28: privacy shield', async (t) => {
  const seen = [];              // every request the other site got: { path, cookie, referer, gpc }
  const ownSeen = [];           // the page's own site
  const other = await startServer((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie || '', referer: req.headers.referer || '', gpc: req.headers['sec-gpc'] || '' });
    if (req.url.startsWith('/set')) {
      res.writeHead(200, { 'Content-Type': 'image/gif', 'Set-Cookie': 'tracker=abc; Path=/; SameSite=None; Secure' });
      return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
    }
    res.writeHead(200, { 'Content-Type': 'image/gif' });
    res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
  });
  const otherBase = other.url.replace('127.0.0.1', 'localhost');
  const own = await startServer((req, res) => {
    ownSeen.push({ path: req.url, gpc: req.headers['sec-gpc'] || '', cookie: req.headers.cookie || '' });
    if (req.url.startsWith('/embed')) {
      // asks the browser to send its full address to everyone (unsafe-url): the shield trims it for other sites
      res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'own=1; Path=/' });
      return res.end(`<!doctype html><meta name="referrer" content="unsafe-url"><title>embed</title>
        <img id="i" src="${otherBase}/check?n=${encodeURIComponent(req.url)}">`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>own</title><p>own site</p>');
  });

  // plain-http-site.com: an http site that is not local (HTTPS-Only applies); ad.doubleclick.net: on the ad blocker's built-in list
  const ctx = await launchApp({ args: ['--host-resolver-rules=MAP plain-http-site.com 127.0.0.1, MAP ad.doubleclick.net 127.0.0.1'] });
  const { app, chrome } = ctx;
  const open = async (url, prefix = url) => {
    await api(chrome, 'createTab', url);
    await waitForWebContents(app, prefix);
    await waitFor(async () => (await listWebContents(app)).some((w) => w.url.startsWith(prefix) && !w.loading), { message: url + ' to load' });
    await sleep(300);
  };
  // the request the embed page `tag` (?a=1, ?b=1 …) made to the other site
  const checkOf = (tag) => seen.filter((s) => s.path === '/check?n=' + encodeURIComponent('/embed?' + tag)).slice(-1)[0];
  const embed = async (tag) => {
    await open(`${own.url}/embed?${tag}`);
    return waitFor(() => checkOf(tag) || null, { message: 'the embedded request of ' + tag });
  };

  try {
    t.section('Cross-site cookies');

    await t.test('the other site gets its cookie when visited itself (first party)', async () => {
      await open(`${otherBase}/set`);
      const cookies = await app.evaluate(({ session }) => session.defaultSession.cookies.get({ name: 'tracker' }));
      assertEqual(cookies.length, 1, 'the cookie was stored');
    });

    await t.test('embedded in another site it does not receive it; the page\'s own site keeps its cookie', async () => {
      assertEqual((await embed('a=1')).cookie, '', 'cookie sent to an embedded other site');
      await open(`${own.url}/embed?a=2`);
      const page = ownSeen.filter((s) => s.path === '/embed?a=2').slice(-1)[0];
      assert(page && page.cookie.includes('own=1'), 'the page\'s own cookie: ' + JSON.stringify(page));
    });

    await t.test('switched off in Settings it does (the switch really is the reason)', async () => {
      await api(chrome, 'updateSettings', { privacyBlockThirdPartyCookies: false });
      const r = await embed('b=1');
      assert(r.cookie.includes('tracker=abc'), 'with the switch off the cookie goes: ' + JSON.stringify(r));
      await api(chrome, 'updateSettings', { privacyBlockThirdPartyCookies: true });
    });

    await t.test('allowed for one site (as the shield does), only that site\'s embeds get cookies', async () => {
      await api(chrome, 'updateSettings', { privacyCookieAllowSites: ['127.0.0.1'] });
      const allowed = await embed('c=1');
      assert(allowed.cookie.includes('tracker=abc'), 'allowed site: ' + JSON.stringify(allowed));
      await api(chrome, 'updateSettings', { privacyCookieAllowSites: [] });
      assertEqual((await embed('c=2')).cookie, '', 'blocked again');
    });

    t.section('Referrer, Global Privacy Control');

    await t.test('the other site learns only the page\'s site, not the page (although the page asked for unsafe-url)', async () => {
      assertEqual(checkOf('c=2').referer, own.url + '/');
    });

    await t.test('every request says Sec-GPC: 1 and the page sees navigator.globalPrivacyControl', async () => {
      assertEqual(checkOf('c=2').gpc, '1');
      assertEqual(ownSeen.filter((s) => s.path.startsWith('/embed')).slice(-1)[0].gpc, '1');
      assertEqual(await evalIn(app, `${own.url}/embed?c=2`, 'navigator.globalPrivacyControl'), true);
    });

    t.section('Link tracking protection');

    await t.test('utm_… and fbclid never reach the server; the address bar shows the clean address', async () => {
      const before = ownSeen.length;
      await api(chrome, 'createTab', `${own.url}/article?id=7&utm_source=news&utm_medium=social&fbclid=XYZ`);
      await waitForWebContents(app, `${own.url}/article`);
      await waitFor(() => ownSeen.length > before && ownSeen.some((s) => s.path.startsWith('/article')), { message: 'the article request' });
      const paths = ownSeen.slice(before).map((s) => s.path).filter((p) => p.startsWith('/article'));
      assert(paths.every((p) => p === '/article?id=7'), 'the server saw: ' + paths.join(', '));
      const urls = (await listWebContents(app)).map((w) => w.url).filter((u) => u.includes('/article'));
      assert(urls.includes(`${own.url}/article?id=7`), urls.join(', '));
    });

    t.section('HTTPS-Only');

    await t.test('an http site is asked for over https; it has none, so the page says so and offers http', async () => {
      const plainUrl = `${own.url.replace('127.0.0.1', 'plain-http-site.com')}/home`;
      await api(chrome, 'createTab', plainUrl);
      await waitForWebContents(app, 'mtc://error');
      const shown = await waitFor(() => evalIn(app, 'mtc://error', `(() => { const b = document.getElementById('btn-retry'); return b && /not secure/.test(b.textContent) ? { title: document.getElementById('title').textContent, button: b.textContent } : null; })()`), { message: 'the "no secure connection" page' });
      assert(/does not offer a secure connection/.test(shown.title), shown.title);
      assert(!ownSeen.some((s) => s.path === '/home'), 'nothing went over http before the user agreed');
      await evalIn(app, 'mtc://error', "document.getElementById('btn-retry').click(), true");
      await waitFor(() => ownSeen.some((s) => s.path === '/home'), { message: 'the http page after "Continue"' });
      await waitFor(async () => (await listWebContents(app)).some((w) => w.url === plainUrl && !w.loading), { message: 'the http page in the tab' });
    });

    await t.test('…remembered for the site: the next http page there opens directly', async () => {
      const next = `${own.url.replace('127.0.0.1', 'plain-http-site.com')}/second`;
      await open(next);
      assert(ownSeen.some((s) => s.path === '/second'), 'the second page went over http without asking again');
    });

    await t.test('local addresses (this computer\'s IP, localhost) are never upgraded', async () => {
      // every request above to 127.0.0.1 and localhost went over plain http
      assert(ownSeen.length > 3 && seen.length > 3);
    });

    t.section('Next to the ad blocker and the sign-in rules');

    await t.test('the ad blocker still blocks (one request hub for everything)', async () => {
      // the page's own server answers for ad.doubleclick.net too: a request that got through would show up there
      const adUrl = own.url.replace('127.0.0.1', 'ad.doubleclick.net') + '/ad.gif';
      const before = ownSeen.length;
      await open(`${own.url}/plain`);
      await evalIn(app, `${own.url}/plain`, `(() => { const i = new Image(); i.src = ${JSON.stringify(adUrl)}; document.body.appendChild(i); return true; })()`);
      await sleep(1200);
      assert(!ownSeen.slice(before).some((s) => s.path === '/ad.gif'), 'the ad request reached the server');
    });

    await t.test('no errors from the shield in the log', async () => {
      assert(!/privacy|webRequestHub/i.test((ctx.log.text.match(/\[ERROR\][^\n]*/g) || []).join('\n')), (ctx.log.text.match(/\[ERROR\][^\n]*/g) || []).join('\n'));
    });
  } finally {
    await ctx.close();
    await own.close();
    await other.close();
  }
});
