/**
 * SHMMOTH BROWSER — privacy shield (1.5.0) and the shared request hub
 *
 * Checked here with fakes; tests/e2e/28-privacy.e2e.js checks the same in the real browser:
 *   - the request hub: the code that already used session.webRequest keeps its one listener per event (a new one
 *     replaces it, its URL filter is honoured), and named handlers run alongside it
 *   - sites: registrable domains, sites of one owner, local addresses
 *   - link tracking protection, cross-site cookies, Global Privacy Control, referrer trimming, HTTPS-Only and its way out
 *
 * Run: node tests/p10-privacy.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const hub = require('../src/services/webRequestHub');
const { PrivacyShield, siteOf, sameParty, isLocalHost, stripTrackingParams } = require('../src/services/privacyShield');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

/** A session whose webRequest behaves like Electron's: one listener per event, the newest wins. */
function fakeSession() {
  const registered = {};
  const webRequest = {};
  for (const ev of hub.EVENTS) {
    webRequest[ev] = (...args) => { const l = args.length >= 2 ? args[1] : args[0]; registered[ev] = typeof l === 'function' ? l : null; };
  }
  const fire = (ev, details) => new Promise((resolve) => (registered[ev] ? registered[ev](details, resolve) : resolve('no listener')));
  return { webRequest, fire, registered };
}
const wc = (url, id = 1) => ({ id, getURL: () => url, isDestroyed: () => false });

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — privacy shield');
console.log('══════════════════════════════════════════════════════\n');

(async () => {
  console.log('📋 The request hub');

  await (async () => {
    const s = fakeSession();
    const h = hub.install(s);
    eq(hub.install(s) === h, true, 'installed once');
    // the ad blocker registers, then registers again (the newest replaces the older, as in Electron)
    s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => cb({ cancel: d.url.includes('ads') }));
    s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => cb({ cancel: d.url.includes('tracker') }));
    let r = await s.fire('onBeforeRequest', { url: 'https://ads.example/x' });
    test('a legacy listener is replaced by the next one, as Electron does', () => eq(r, { cancel: false }));
    r = await s.fire('onBeforeRequest', { url: 'https://tracker.example/x' });
    test('…and the newest one is the one that runs', () => eq(r, { cancel: true }));

    h.add('onBeforeRequest', 'privacy', (d) => (d.url.startsWith('http://') ? { redirectURL: d.url.replace('http:', 'https:') } : null));
    r = await s.fire('onBeforeRequest', { url: 'http://example.com/' });
    test('a named handler that redirects decides before the legacy listener', () => eq(r, { redirectURL: 'https://example.com/' }));
    r = await s.fire('onBeforeRequest', { url: 'https://tracker.example/y' });
    test('without a decision of its own, the legacy listener still blocks', () => eq(r, { cancel: true }));

    // sign-in rules: only for Google addresses, and they change the User-Agent
    s.webRequest.onBeforeSendHeaders({ urls: ['https://*.google.com/*'] }, (d, cb) => cb({ requestHeaders: { ...d.requestHeaders, 'User-Agent': 'signin' } }));
    h.add('onBeforeSendHeaders', 'privacy', (d) => ({ requestHeaders: { ...d.requestHeaders, 'Sec-GPC': '1' } }));
    r = await s.fire('onBeforeSendHeaders', { url: 'https://accounts.google.com/x', requestHeaders: { A: 'a' } });
    test('request headers go through the named handler AND the legacy listener', () => eq(r, { requestHeaders: { A: 'a', 'Sec-GPC': '1', 'User-Agent': 'signin' } }));
    r = await s.fire('onBeforeSendHeaders', { url: 'https://example.com/x', requestHeaders: { A: 'a' } });
    test('the legacy listener\'s URL filter is honoured (not called for other sites)', () => eq(r, { requestHeaders: { A: 'a', 'Sec-GPC': '1' } }));

    s.webRequest.onHeadersReceived((d, cb) => cb({}));      // a legacy listener that changes nothing
    h.add('onHeadersReceived', 'privacy', (d) => ({ responseHeaders: { kept: ['1'] } }));
    r = await s.fire('onHeadersReceived', { url: 'https://x.example/', responseHeaders: { 'Set-Cookie': ['a=1'], kept: ['1'] } });
    test('a legacy listener that answers {} does not undo the named handler\'s change', () => eq(r, { responseHeaders: { kept: ['1'] } }));

    s.webRequest.onBeforeRequest(null);
    h.remove('onBeforeRequest', 'privacy');
    test('removing every listener removes the session\'s own one', () => eq(s.registered.onBeforeRequest, null));

    h.add('onBeforeSendHeaders', 'broken', () => { throw new Error('boom'); });
    r = await s.fire('onBeforeSendHeaders', { url: 'https://example.com/', requestHeaders: {} });
    test('a broken handler never stops a request', () => eq(r, { requestHeaders: { 'Sec-GPC': '1' } }));

    test('match patterns as Chrome reads them', () => {
      assert(hub.matchesPattern('https://*.google.com/*', 'https://accounts.google.com/x?y=1'));
      assert(hub.matchesPattern('https://*.google.com/*', 'https://google.com/'));
      assert(!hub.matchesPattern('https://*.google.com/*', 'https://evilgoogle.com/'));
      assert(!hub.matchesPattern('https://*.google.com/*', 'http://www.google.com/'));
      assert(hub.matchesPattern('*://*/*', 'http://a.b/'));
      assert(hub.matchesPattern('<all_urls>', 'mtc://settings'));
    });
  })();

  console.log('\n📋 Sites');
  test('registrable domains, sites of one owner, local addresses', () => {
    eq(siteOf('www.example.co.uk'), 'example.co.uk');
    eq(siteOf('shop.flipkart.com'), 'flipkart.com');
    eq(siteOf('user.github.io'), 'user.github.io', 'private suffixes are separate sites');
    eq(siteOf('192.168.1.1'), '192.168.1.1');
    assert(sameParty('google.com', 'youtube.com') && sameParty('live.com', 'microsoft.com') && !sameParty('google.com', 'facebook.com'));
    for (const h of ['localhost', '192.168.0.1', '10.0.0.5', 'router', 'nas.local', 'printer.lan', '[::1]', 'news-site.test', 'a.example']) assert(isLocalHost(h), h);
    for (const h of ['example.com', 'neverssl.com']) assert(!isLocalHost(h), h);
  });

  console.log('\n📋 Link tracking protection');
  test('click identifiers go, everything else stays', () => {
    eq(stripTrackingParams('https://shop.example/item?id=42&utm_source=fb&utm_medium=cpc&fbclid=AbC#top'), 'https://shop.example/item?id=42#top');
    eq(stripTrackingParams('https://example.com/?gclid=1'), 'https://example.com/');
    eq(stripTrackingParams('https://example.com/?q=utm_source'), null, 'a value that looks like one');
    eq(stripTrackingParams('https://www.youtube.com/watch?v=abc&si=XYZ'), 'https://www.youtube.com/watch?v=abc');
    eq(stripTrackingParams('https://example.com/?si=keep'), null, '"si" is only removed where it is a share tracker');
    eq(stripTrackingParams('https://www.instagram.com/p/x/?igsh=abc'), 'https://www.instagram.com/p/x/');
  });

  console.log('\n📋 The shield');
  const settings = {};
  const shield = new PrivacyShield({ getSettings: () => settings, updateSettings: (d) => Object.assign(settings, d), now: () => clock });
  let clock = 1000;

  test('a page address with tracking is asked for without it (GET, top frame only)', () => {
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'https://a.example/?utm_source=x', webContents: wc('') }, 'default'), { redirectURL: 'https://a.example/' });
    eq(shield.onBeforeRequest({ resourceType: 'image', method: 'GET', url: 'https://a.example/i.png?utm_source=x', webContents: wc('') }, 'default'), null);
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'POST', url: 'https://a.example/?utm_source=x', webContents: wc('') }, 'default'), null);
  });

  test('cross-site requests neither send nor receive cookies; the page\'s own site and its owner\'s sites do', () => {
    const page = wc('https://news.example.com/article');
    const third = shield.onBeforeSendHeaders({ resourceType: 'script', url: 'https://tracker.net/t.js', webContents: page, requestHeaders: { Cookie: 'id=1' } });
    assert(third && !('Cookie' in third.requestHeaders), 'cookie sent to a tracker');
    const own = shield.onBeforeSendHeaders({ resourceType: 'script', url: 'https://static.example.com/a.js', webContents: page, requestHeaders: { Cookie: 'id=1' } });
    assert(own.requestHeaders.Cookie === 'id=1', 'cookie to the page\'s own site');
    const yt = shield.onBeforeSendHeaders({ resourceType: 'subFrame', url: 'https://accounts.google.com/x', webContents: wc('https://www.youtube.com/'), requestHeaders: { Cookie: 'SID=1' } });
    assert(yt.requestHeaders.Cookie === 'SID=1', 'google.com inside youtube.com keeps its sign-in');
    eq(shield.onHeadersReceived({ resourceType: 'script', url: 'https://tracker.net/t.js', webContents: page, responseHeaders: { 'set-cookie': ['id=2'], 'content-type': ['js'] } }), { responseHeaders: { 'content-type': ['js'] } });
    eq(shield.onHeadersReceived({ resourceType: 'mainFrame', url: 'https://tracker.net/', webContents: page, responseHeaders: { 'set-cookie': ['id=2'] } }), null, 'a page you open yourself is first-party');
    eq(shield.onHeadersReceived({ resourceType: 'other', url: 'https://tracker.net/file.zip', webContents: undefined, responseHeaders: { 'set-cookie': ['id=2'] } }), null, 'downloads and the fast engine are not pages');
  });

  test('allowing a site from the shield lets its embedded sites use cookies again; switched off: allowed everywhere', () => {
    shield.setCrossSiteCookiesAllowed('example.com', true);
    const r = shield.onBeforeSendHeaders({ resourceType: 'subFrame', url: 'https://pay.gateway.in/otp', webContents: wc('https://shop.example.com/checkout'), requestHeaders: { Cookie: 's=1' } });
    assert(r.requestHeaders.Cookie === 's=1');
    shield.setCrossSiteCookiesAllowed('example.com', false);
    eq(settings.privacyCookieAllowSites, []);
    settings.privacyBlockThirdPartyCookies = false;
    const off = shield.onBeforeSendHeaders({ resourceType: 'script', url: 'https://tracker.net/t.js', webContents: wc('https://a.example/'), requestHeaders: { Cookie: 'id=1' } });
    assert(off.requestHeaders.Cookie === 'id=1');
    settings.privacyBlockThirdPartyCookies = true;
  });

  test('every request says Sec-GPC: 1 (unless switched off)', () => {
    const r = shield.onBeforeSendHeaders({ resourceType: 'mainFrame', url: 'https://a.example/', webContents: wc(''), requestHeaders: {} });
    eq(r.requestHeaders['Sec-GPC'], '1');
    settings.privacyGpc = false;
    eq(shield.onBeforeSendHeaders({ resourceType: 'mainFrame', url: 'https://a.example/', webContents: wc(''), requestHeaders: {} }), null);
    settings.privacyGpc = true;
  });

  test('another site only learns the site a request comes from, never the page', () => {
    const r = shield.onBeforeSendHeaders({ resourceType: 'image', url: 'https://cdn.other.net/p.png', webContents: wc('https://a.example/secret/page'), requestHeaders: { Referer: 'https://a.example/secret/page?q=1' } });
    eq(r.requestHeaders.Referer, 'https://a.example/');
    const same = shield.onBeforeSendHeaders({ resourceType: 'image', url: 'https://img.a.example/p.png', webContents: wc('https://a.example/x'), requestHeaders: { Referer: 'https://a.example/x' } });
    eq(same.requestHeaders.Referer, 'https://a.example/x', 'the same site keeps the full page');
  });

  test('HTTPS-Only: http pages are asked for over https; local addresses are not', () => {
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://example.org/a?b=1', webContents: wc('', 7) }, 'default'), { redirectURL: 'https://example.org/a?b=1' });
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://192.168.1.1/', webContents: wc('', 7) }, 'default'), null);
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://router/', webContents: wc('', 7) }, 'default'), null);
  });

  test('…a failed upgrade offers the http address; the error page\'s button lets exactly that through', () => {
    eq(shield.httpsFallbackFor(7, 'https://example.org/a?b=1', -102), 'http://example.org/a?b=1');
    eq(shield.httpsFallbackFor(7, 'https://example.org/a?b=1', -105), null, 'no such host: http fails as well');
    eq(shield.httpsFallbackFor(7, 'https://other.org/', -102), null, 'another site');
    const errPage = wc('mtc://error?code=-102&name=ERR_CONNECTION_REFUSED&https=1&url=' + encodeURIComponent('http://example.org/a?b=1'), 7);
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://example.org/a?b=1', webContents: errPage }, 'default'), null);
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://example.org/other', webContents: wc('', 8) }, 'default'), null, 'remembered for the site');
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://example.org/other', webContents: wc('', 8) }, 'incognito') !== null, true, 'not for the private window');
    // a page cannot fake it: the button only counts on the browser's own error page
    const fake = wc('https://evil.example/?https=1&url=' + encodeURIComponent('http://bank-site.com/'), 9);
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://bank-site.com/', webContents: fake }, 'default'), { redirectURL: 'https://bank-site.com/' });
  });

  test('…a site that sends https back to http is not upgraded in a loop', () => {
    const tab = wc('', 11);
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://loop-site.com/', webContents: tab }, 'default'), { redirectURL: 'https://loop-site.com/' });
    clock += 500;
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://loop-site.com/home', webContents: tab }, 'default'), null);
    // a site whose https page did open: a later http link to it is upgraded, not taken for a downgrade
    const tab2 = wc('', 12);
    shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://good-site.com/', webContents: tab2 }, 'default');
    shield.noteNavigation(12, 'https://good-site.com/');
    clock += 500;
    eq(shield.onBeforeRequest({ resourceType: 'mainFrame', method: 'GET', url: 'http://good-site.com/page', webContents: tab2 }, 'default'), { redirectURL: 'https://good-site.com/page' });
  });

  console.log('\n📋 Wiring');
  test('main.js installs the hub before the sign-in rules and the ad blocker; GPC preload; settings; shield; error page', () => {
    const main = read('src', 'main.js');
    const i = main.indexOf("webRequestHub.install(session.defaultSession)");
    assert(i > 0 && i < main.indexOf('this.setupSignInClientHints(session.defaultSession)') && i < main.indexOf('this.adBlocker.setupFilter(session.defaultSession)'));
    assert(main.includes("webRequestHub.install(session.fromPartition('incognito')), 'incognito')"));
    assert(/registerPreloadScript\(\{ type: 'frame', filePath: path\.join\(SRC_DIR, 'preload-privacy\.js'\) \}\)/.test(read('src', 'browser', 'network.js')));
    assert(/globalPrivacyControl/.test(read('src', 'preload-privacy.js')));
    const storage = read('src', 'services', 'storage.js');
    for (const k of ['privacyBlockThirdPartyCookies', 'privacyStripTrackingParams', 'privacyGpc', 'privacyHttpsOnly']) assert(new RegExp(k + ':\\s+true').test(storage), k);
    const html = read('src', 'pages', 'settings.html');
    for (const id of ['toggle-privacy-cookies', 'toggle-privacy-params', 'toggle-privacy-gpc', 'toggle-privacy-https', 'privacy-cookie-sites']) assert(html.includes(`id="${id}"`), id);
    assert(read('src', 'pages', 'shield-bubble.html').includes('id="toggle-cookies"'));
    assert(/privacyShield\.httpsFallbackFor\(wc\.id, validatedURL, errorCode\)/.test(read('src', 'browser', 'tabs.js')));
    assert(/params\.get\('https'\) === '1'/.test(read('src', 'pages', 'error.js')));
  });

  console.log(`\n  p10-privacy: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
