/**
 * E2E 19 — Google sign-in: nothing disguised, and a refusal is answered with the next identity
 *
 * Google refused to sign in the browser ("Couldn't sign you in — This browser or app may not be secure"). The browser
 * disguised itself as Google Chrome with page scripts that replaced navigator.userAgentData and with rewritten Sec-CH-UA
 * headers — exactly what Google's sign-in check is built to catch. Now pages see the engine's own values, only the
 * User-Agent of the sign-in pages is chosen (services/googleSignIn.js), and when Google shows its refusal page the
 * browser starts the sign-in again with the next identity.
 *
 * A local server answers as accounts.google.com / www.google.com / mail.google.com over HTTPS (--host-resolver-rules,
 * --ignore-certificate-errors, a certificate made in fixtures/self-signed-cert.js). Its sign-in pages behave like
 * Google's where it matters: ServiceLogin → identifier page → the form is posted → the server either refuses (redirect
 * to /v3/signin/rejected, or a page with Google's help link for this refusal) or sends the user on to `continue`.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/19-google-signin.e2e.js)
 */

'use strict';

const https = require('https');
const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, waitForWebContents, evalIn, NO_SYSTEM_PROXY_ENV
} = require('./helpers');
const { selfSignedCert } = require('./fixtures/self-signed-cert');

const HELP_LINK = 'https://support.google.com/accounts/answer/7675428?hl=en';

runSuite('SHMMOTH Browser — E2E 19: Google sign-in', async (t) => {
  const state = { refuse: 0, refusalKind: 'url', attempts: [], subresources: [], posts: 0 };
  const { key, cert } = selfSignedCert('accounts.google.com');
  const html = (res, body) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html><head><title>Google</title></head><body>${body}</body></html>`); };
  let port = 0;
  const server = https.createServer({ key, cert }, (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const u = new URL(req.url, `https://${host}:${port}`);
    const cont = u.searchParams.get('continue') || `https://www.google.com:${port}/after`;
    if (host === 'mail.google.com' && u.pathname === '/') {
      res.writeHead(302, { Location: `https://accounts.google.com:${port}/ServiceLogin?service=mail&continue=${encodeURIComponent(`https://mail.google.com:${port}/inbox`)}` });
      return res.end();
    }
    if (host !== 'accounts.google.com') return html(res, `<p id="where">${host}${u.pathname}</p>`);
    if (u.pathname === '/ServiceLogin') {
      state.attempts.push({ ua: req.headers['user-agent'] || '', chUa: req.headers['sec-ch-ua'] || '', continue: cont, service: u.searchParams.get('service') || '' });
      res.writeHead(302, { Location: `/v3/signin/identifier?flowName=GlifWebSignIn&continue=${encodeURIComponent(cont)}` });
      return res.end();
    }
    if (u.pathname === '/s.js' || u.pathname === '/frame') {
      state.subresources.push({ path: u.pathname, ua: req.headers['user-agent'] || '', chUa: req.headers['sec-ch-ua'], fetchDest: req.headers['sec-fetch-dest'] });
      if (u.pathname === '/s.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end('window.__scriptLoaded = true;'); }
      return html(res, '<p>frame</p>');
    }
    if (u.pathname === '/v3/signin/identifier') {
      return html(res, `
        <form id="f" method="post" action="/v3/signin/_/next?continue=${encodeURIComponent(cont)}"><input name="identifier" value="someone@example.com"><button>Next</button></form>
        <iframe id="fr" src="/frame"></iframe>
        <script src="/s.js?t=${Date.now()}"></script>
        <script>
          window.__info = new Promise(function (resolve) {
            var w = new Worker(URL.createObjectURL(new Blob(['postMessage(navigator.userAgentData ? navigator.userAgentData.brands.map(function (b) { return b.brand; }).join("|") : "none")'])));
            w.onmessage = function (e) {
              var fr = document.getElementById('fr');
              var go = function () {
                var d = navigator.userAgentData;
                var desc = d && Object.getOwnPropertyDescriptor(Object.getPrototypeOf(d), 'brands');
                resolve({
                  ua: navigator.userAgent,
                  brands: d ? d.brands.map(function (b) { return b.brand; }).join('|') : 'none',
                  frameBrands: fr.contentWindow.navigator.userAgentData ? fr.contentWindow.navigator.userAgentData.brands.map(function (b) { return b.brand; }).join('|') : 'none',
                  workerBrands: e.data,
                  nativeBrands: desc ? /\\[native code\\]/.test(desc.get.toString()) : null,
                  nativeHigh: d ? /\\[native code\\]/.test(d.getHighEntropyValues.toString()) : null
                });
              };
              if (fr.contentDocument && fr.contentDocument.readyState === 'complete') go(); else fr.onload = go;
            };
          });
        </script>`);
    }
    if (u.pathname === '/v3/signin/_/next' && req.method === 'POST') {
      state.posts++;
      req.resume();
      if (state.refuse > 0) {
        state.refuse--;
        const where = state.refusalKind === 'page' ? '/v3/signin/challenge/unknown' : '/v3/signin/rejected';
        res.writeHead(302, { Location: `${where}?rrk=46&continue=${encodeURIComponent(cont)}` });
        return res.end();
      }
      res.writeHead(302, { Location: cont });
      return res.end();
    }
    if (u.pathname === '/v3/signin/rejected' || u.pathname === '/v3/signin/challenge/unknown') {
      return html(res, `<h1>Couldn’t sign you in</h1><p>This browser or app may not be secure. <a href="${HELP_LINK}">Learn more</a></p><a href="/ServiceLogin?continue=${encodeURIComponent(cont)}">Try again</a>`);
    }
    return html(res, `<p>${u.pathname}</p>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  const A = `https://accounts.google.com:${port}`;
  const AFTER = `https://www.google.com:${port}/after`;

  const ctx = await launchApp({
    env: NO_SYSTEM_PROXY_ENV,
    args: [`--host-resolver-rules=MAP accounts.google.com 127.0.0.1, MAP www.google.com 127.0.0.1, MAP mail.google.com 127.0.0.1`, '--ignore-certificate-errors']
  });
  const { app } = ctx;
  await app.evaluate(({ dialog }) => {
    global.__dialogs = [];
    global.__dialogAnswer = 1;
    dialog.showMessageBox = async (...args) => { global.__dialogs.push(args.find((a) => a && a.message)); return { response: global.__dialogAnswer }; };
  });

  const engine = await app.evaluate(() => process.versions.chrome);
  const major = engine.split('.')[0];
  const appVersion = await app.evaluate(({ app: a }) => a.getVersion());
  const isApp = (ua) => ua.includes(`SHMMOTH/${appVersion} Chrome/${engine} `) && !/Electron/.test(ua);
  const isChrome = (ua) => ua.includes(`Chrome/${major}.0.0.0 Safari`) && !/SHMMOTH|Electron|Firefox/.test(ua);
  const isFirefox = (ua) => /Gecko\/20100101 Firefox\/\d+/.test(ua) && !/Chrome/.test(ua);
  const settings = () => api(ctx.chrome, 'getSettings');
  // every sign-in gets its own destination, so the pages of different tests can never be mixed up
  const after = (tag) => `${AFTER}?flow=${tag}`;
  const idPrefix = (cont) => `${A}/v3/signin/identifier?flowName=GlifWebSignIn&continue=${encodeURIComponent(cont)}`;
  const signInPage = (tag) => waitForWebContents(app, idPrefix(after(tag)));
  const submit = async (tag) => { await signInPage(tag); await evalIn(app, idPrefix(after(tag)), 'document.getElementById("f").submit()'); };
  const info = (tag) => evalIn(app, idPrefix(after(tag)), 'window.__info');
  const done = (tag) => waitForWebContents(app, after(tag));
  const wcUa = (prefix) => app.evaluate(({ webContents }, p) => { const w = webContents.getAllWebContents().find((x) => x.getURL().startsWith(p)); return w ? w.getUserAgent() : null; }, prefix);
  const start = async (tag) => { await api(ctx.chrome, 'createTab', `${A}/ServiceLogin?continue=${encodeURIComponent(after(tag))}`); await signInPage(tag); };

  try {
    t.section('Nothing disguised');

    await t.test('the sign-in page sees the engine\'s own values: the same brands in the page, a frame and a worker, native functions, no "Google Chrome"', async () => {
      await start('t1');
      const i = await info('t1');
      assert(isApp(i.ua), 'navigator.userAgent: ' + i.ua);
      assert(i.brands.includes('Chromium') && !i.brands.includes('Google Chrome'), 'brands: ' + i.brands);
      assertEqual(i.frameBrands, i.brands, 'a frame sees other brands than the page');
      assertEqual(i.workerBrands, i.brands, 'a worker sees other brands than the page');
      assertEqual(i.nativeBrands, true, 'navigator.userAgentData.brands was replaced by a script');
      assertEqual(i.nativeHigh, true, 'getHighEntropyValues was replaced by a script');
    });

    await t.test('the requests carry the same identity: User-Agent = navigator.userAgent, the engine\'s own client hints, Sec-Fetch headers', async () => {
      const i = await info('t1');
      assertEqual(state.attempts[0].ua, i.ua, 'the sign-in request\'s User-Agent');
      const s = state.subresources.filter((x) => x.path === '/s.js').pop();
      assertEqual(s.ua, i.ua, 'a script request\'s User-Agent');
      assert(typeof s.chUa === 'string' && s.chUa.includes('"Chromium"') && !s.chUa.includes('Google Chrome'), 'Sec-CH-UA: ' + s.chUa);
      for (const b of i.brands.split('|')) assert(s.chUa.includes(`"${b}"`), `the header lacks the brand "${b}" the page sees: ${s.chUa}`);
      assertEqual(s.fetchDest, 'script', 'Sec-Fetch-Dest');
    });

    t.section('Refused → the next identity');

    await t.test('refused: the sign-in starts again at its beginning with the next identity and the same destination; the one that works is kept', async () => {
      state.attempts.length = 0; state.refuse = 1; state.refusalKind = 'url';
      await submit('t1');
      await waitFor(() => state.attempts.length >= 1, { message: 'the sign-in to start again' });
      const again = state.attempts[0];
      assert(isChrome(again.ua), 'second identity: ' + again.ua);
      assertEqual(again.continue, after('t1'), 'the destination must stay');
      await waitFor(async () => isChrome((await info('t1')).ua), { message: 'the page to show the new identity' });
      assertEqual((await settings()).googleSignInProfile, 'chrome', 'kept for next time');
      await submit('t1');                                                      // accepted this time
      await done('t1');
      const ua = await evalIn(app, after('t1'), 'navigator.userAgent');
      assert(!/SHMMOTH|Firefox|Electron/.test(ua) && ua.includes(`Chrome/${major}.`), 'back on Google itself, the normal identity: ' + ua);
      assertEqual(state.attempts.length, 1, 'no further restarts');
    });

    await t.test('the Firefox identity sends no Chromium client hints from the sign-in pages, and the page and its requests agree', async () => {
      state.attempts.length = 0; state.subresources.length = 0; state.refuse = 1;
      await start('t4');                                                       // starts with the kept identity ("chrome")
      assert(isChrome(state.attempts[0].ua), 'the kept identity first: ' + state.attempts[0].ua);
      await submit('t4');
      await waitFor(() => state.attempts.length >= 2, { message: 'the restart' });
      assert(isApp(state.attempts[1].ua), 'then from the top of the list: ' + state.attempts[1].ua);
      state.refuse = 1;
      await waitFor(async () => isApp((await info('t4')).ua), { message: 'the page with the "app" identity' });
      await submit('t4');
      await waitFor(() => state.attempts.length >= 3, { message: 'the next restart' });
      assert(isFirefox(state.attempts[2].ua), 'third identity: ' + state.attempts[2].ua);
      await waitFor(async () => isFirefox((await info('t4')).ua), { message: 'the page with the Firefox identity' });
      const s = state.subresources.filter((x) => x.path === '/s.js').pop();
      assert(isFirefox(s.ua), 'script request UA: ' + s.ua);
      assertEqual(s.chUa, undefined, 'Firefox never sends Sec-CH-UA');
      assertEqual(s.fetchDest, 'script', 'the Sec-Fetch headers stay');
      await submit('t4');
      await done('t4');
      assertEqual((await settings()).googleSignInProfile, 'firefox');
    });

    await t.test('every identity refused in one sign-in: one plain message, no endless restarts', async () => {
      state.attempts.length = 0; state.refuse = 99; await app.evaluate(() => { global.__dialogs.length = 0; global.__dialogAnswer = 1; });
      await start('t5');
      await submit('t5');
      await waitFor(() => state.attempts.length >= 2, { message: 'restart 1' });
      await waitFor(async () => (await info('t5')).ua === state.attempts[1].ua, { message: 'the second page' });
      await submit('t5');
      await waitFor(() => state.attempts.length >= 3, { message: 'restart 2' });
      await waitFor(async () => (await info('t5')).ua === state.attempts[2].ua, { message: 'the third page' });
      await submit('t5');
      await waitFor(() => app.evaluate(() => global.__dialogs.length >= 1), { message: 'the message', timeout: 10000 });
      await sleep(3000);
      assertEqual(state.attempts.length, 3, 'one try per identity, then stop');
      const d = await app.evaluate(() => global.__dialogs);
      assertEqual(d.length, 1, 'told once');
      assert(/refused to sign in/.test(d[0].message) && /may not be secure/.test(d[0].detail) && d[0].buttons.includes('Try again'), JSON.stringify(d[0]));
    });

    await t.test('"Try again" in that message goes round once more', async () => {
      state.attempts.length = 0; state.refuse = 3;
      await app.evaluate(() => { global.__dialogs.length = 0; global.__dialogAnswer = 0; });
      await start('t6');
      await submit('t6');
      await waitFor(() => state.attempts.length >= 2, { message: 'restart 1' });
      await waitFor(async () => (await info('t6')).ua === state.attempts[1].ua, { message: 'the second page' });
      await submit('t6');
      await waitFor(() => state.attempts.length >= 3, { message: 'restart 2' });
      await waitFor(async () => (await info('t6')).ua === state.attempts[2].ua, { message: 'the third page' });
      await submit('t6');                                                      // refused with every identity → message → "Try again"
      await waitFor(() => state.attempts.length >= 4, { message: 'a new round after "Try again"', timeout: 10000 });
      assertEqual(await app.evaluate(() => global.__dialogs.length), 1, 'one message');
      await app.evaluate(() => { global.__dialogAnswer = 1; });
      await waitFor(async () => (await info('t6')).ua === state.attempts[3].ua, { message: 'the page of the new round' });
      await submit('t6');                                                      // accepted now
      await done('t6');
    });

    await t.test('a refusal page at another address is recognised by Google\'s help link (any language)', async () => {
      state.attempts.length = 0; state.refuse = 1; state.refusalKind = 'page';
      await start('t7');
      const first = state.attempts[0].ua;
      await submit('t7');
      await waitFor(() => state.attempts.length >= 2, { message: 'the restart after the refusal page', timeout: 10000 });
      assert(state.attempts[1].ua !== first, 'another identity: ' + state.attempts[1].ua);
      state.refusalKind = 'url';
      await waitFor(async () => (await info('t7')).ua === state.attempts[1].ua, { message: 'the new page' });
      await submit('t7');
      await done('t7');
    });

    t.section('Other pages');

    await t.test('arriving by a redirect (mail.google.com → sign-in): the sign-in page and its requests agree on the identity', async () => {
      state.attempts.length = 0; state.subresources.length = 0;
      const inbox = `https://mail.google.com:${port}/inbox`;
      await api(ctx.chrome, 'createTab', `https://mail.google.com:${port}/`);
      await waitForWebContents(app, idPrefix(inbox));
      const i = await evalIn(app, idPrefix(inbox), 'window.__info');
      const s = state.subresources.filter((x) => x.path === '/s.js').pop();
      assertEqual(s.ua, i.ua, 'script request vs page');
      assertEqual(state.attempts[0].service, 'mail');
      const kept = (await settings()).googleSignInProfile;
      const want = { app: isApp, chrome: isChrome, firefox: isFirefox }[kept];
      assert(want(i.ua), `the sign-in identity ("${kept}") also after a redirect: ${i.ua}`);
      assertEqual(state.attempts[0].ua, i.ua, 'the redirected sign-in request already carries it');
    });

    await t.test('pages outside the sign-in keep the normal identity', async () => {
      const ua = await wcUa(after('t1'));
      assert(ua && !/SHMMOTH|Firefox/.test(ua), 'normal pages keep the normal identity: ' + ua);
    });

    await t.test('no errors about the sign-in in the log', async () => {
      const text = ctx.log.text;
      assert(!/Could not show the Google sign-in notice/.test(text), (text.match(/Could not show[^\n]*/) || [''])[0]);
      assertEqual((text.match(/\(electron\)[^\n]*/g) || []).join(' | '), '');
    });
  } finally {
    await ctx.close();
    await new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); });
  }
});
