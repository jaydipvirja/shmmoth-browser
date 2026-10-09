/**
 * SHMMOTH BROWSER — Google sign-in: how the browser presents itself on Google's sign-in pages (services/googleSignIn.js)
 *
 * Google refused the sign-in ("This browser or app may not be secure") because the browser disguised itself as Google
 * Chrome with replaced JavaScript functions and rewritten headers. Checked here:
 *   - the honest identities (no "Electron", the right operating system, the engine's own version)
 *   - which addresses count as Google's sign-in pages and as its refusal page (exact hosts, not "contains")
 *   - a refusal starts the sign-in again with the next identity, the one that works is kept, and after all of them were
 *     refused the user is told once (no loop); leaving the sign-in pages starts afresh
 *   - nothing in the browser disguises navigator.userAgentData or rewrites Sec-CH-UA any more
 * The real behaviour (a local "accounts.google.com") is covered by tests/e2e/19-google-signin.e2e.js.
 *
 * Run: node tests/p1-google-signin.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const GoogleSignIn = require('../src/services/googleSignIn');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(a === b, `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

const ENV = { platform: 'win32', chromeVersion: '152.0.7977.130', appVersion: '1.1.15' };
function memoryStorage(settings = {}) {
  const data = { ...settings };
  return { data, getSettings: () => data, updateSettings: (o) => Object.assign(data, o) };
}
const newSignIn = (settings) => new GoogleSignIn(Object.assign({ storage: memoryStorage(settings) }, ENV));

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Google sign-in identities');
  console.log('══════════════════════════════════════════════════════');

  console.log('\n📋 The identities');

  await test('"app": a Chromium browser that names itself, with the engine\'s full version and no "Electron"', () => {
    eq(GoogleSignIn.userAgentOf('app', ENV), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SHMMOTH/1.1.15 Chrome/152.0.7977.130 Safari/537.36');
  });

  await test('"chrome": the plain Chromium form (reduced version), "firefox": Firefox ESR', () => {
    eq(GoogleSignIn.userAgentOf('chrome', ENV), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
    eq(GoogleSignIn.userAgentOf('firefox', ENV), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0');
  });

  await test('the operating system part matches the real one (a Mac never claims Windows)', () => {
    assert(/\(Macintosh; Intel Mac OS X 10_15_7\)/.test(GoogleSignIn.userAgentOf('chrome', { ...ENV, platform: 'darwin' })));
    assert(/\(X11; Linux x86_64\)/.test(GoogleSignIn.userAgentOf('app', { ...ENV, platform: 'linux' })));
    assert(/\(Macintosh; Intel Mac OS X 10\.15; rv:/.test(GoogleSignIn.userAgentOf('firefox', { ...ENV, platform: 'darwin' })));
  });

  await test('no identity carries "Electron" or a doubtful version', () => {
    for (const id of GoogleSignIn.PROFILE_IDS) {
      for (const platform of ['win32', 'darwin', 'linux']) {
        const ua = GoogleSignIn.userAgentOf(id, { ...ENV, platform });
        assert(!/Electron/i.test(ua) && !/shmmoth-browser/i.test(ua), ua);
      }
    }
    assert(/SHMMOTH\/1\.1\.15 /.test(GoogleSignIn.userAgentOf('app', { ...ENV, appVersion: '1.1.15"; DROP' })) === false, 'odd characters are removed from the version');
  });

  console.log('\n📋 Which pages');

  await test('Google\'s sign-in pages are recognised by their exact host, over https only', () => {
    for (const u of ['https://accounts.google.com/ServiceLogin', 'https://accounts.google.com/v3/signin/identifier?x=1', 'https://accounts.youtube.com/accounts/CheckConnection', 'https://ACCOUNTS.GOOGLE.COM/']) assert(GoogleSignIn.isSignInUrl(u), u);
    for (const u of ['http://accounts.google.com/', 'https://www.google.com/?q=accounts.google.com', 'https://accounts.google.com.evil.example/', 'https://evil.example/accounts.google.com', 'https://myaccount.google.com/', 'mtc://settings', '', null, 5]) assert(!GoogleSignIn.isSignInUrl(u), String(u));
  });

  await test('the refusal page is recognised by its address', () => {
    for (const u of ['https://accounts.google.com/v3/signin/rejected?continue=x&rrk=46', 'https://accounts.google.com/signin/rejected?rrk=46', 'https://accounts.google.com/signin/v2/deniedsigninrejected']) assert(GoogleSignIn.isRefusalUrl(u), u);
    for (const u of ['https://accounts.google.com/v3/signin/identifier', 'https://accounts.google.com/v3/signin/challenge/pwd', 'https://evil.example/v3/signin/rejected', 'https://accounts.youtube.com/signin/rejected']) assert(!GoogleSignIn.isRefusalUrl(u), u);
  });

  await test('a sign-in starts again where it began: OAuth requests as they were, others at ServiceLogin with the same destination', () => {
    const oauth = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&redirect_uri=https%3A%2F%2Fsite.example%2Fcb&scope=email';
    eq(GoogleSignIn.restartUrl(oauth, 'https://accounts.google.com/v3/signin/rejected?x=1'), oauth);
    const r = new URL(GoogleSignIn.restartUrl('https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2F&service=mail&hl=gu&dsh=S123&ifkv=zz', 'https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fother.example%2F'));
    eq(r.origin + r.pathname, 'https://accounts.google.com/ServiceLogin');
    eq(r.searchParams.get('continue'), 'https://mail.google.com/', 'the destination of the first page wins');
    eq(r.searchParams.get('service'), 'mail'); eq(r.searchParams.get('hl'), 'gu');
    assert(!r.searchParams.has('dsh') && !r.searchParams.has('ifkv'), 'no stale session tokens');
    eq(new URL(GoogleSignIn.restartUrl('', 'https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fx.example%2F')).searchParams.get('continue'), 'https://x.example/', 'from the refusal page when the start is unknown');
  });

  console.log('\n📋 Refused → the next identity');

  await test('the sign-in pages get the identity in use, every other page the normal User-Agent', () => {
    const g = newSignIn();
    eq(g.currentProfile(), 'app');
    eq(g.userAgentFor('https://accounts.google.com/ServiceLogin', 'NORMAL'), GoogleSignIn.userAgentOf('app', ENV));
    eq(g.userAgentFor('https://www.youtube.com/', 'NORMAL'), 'NORMAL');
    eq(g.userAgentFor('https://mail.google.com/', 'NORMAL'), 'NORMAL', 'Gmail itself keeps the normal identity');
    eq(newSignIn({ googleSignInProfile: 'nonsense' }).currentProfile(), 'app', 'an unknown saved value');
  });

  await test('refused: the next identity is used and kept, and the sign-in starts again from its first page', () => {
    const g = newSignIn();
    const start = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2F';
    eq(g.noteNavigation(1, start).action, 'none');
    eq(g.noteNavigation(1, 'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.youtube.com%2F').action, 'none');
    const r1 = g.noteNavigation(1, 'https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fwww.youtube.com%2F');
    eq(r1.action, 'retry'); eq(r1.profile, 'chrome');
    eq(new URL(r1.url).searchParams.get('continue'), 'https://www.youtube.com/');
    eq(g.storage.data.googleSignInProfile, 'chrome', 'kept for next time');
    eq(g.userAgentFor(start, 'N'), GoogleSignIn.userAgentOf('chrome', ENV));
    const r2 = g.noteNavigation(1, 'https://accounts.google.com/v3/signin/rejected');
    eq(r2.action, 'retry'); eq(r2.profile, 'firefox');
    assert(g.hidesClientHints('https://accounts.google.com/v3/signin/identifier'), 'Firefox sends no client hints');
    assert(!g.hidesClientHints('https://www.google.com/'), '…but only on the sign-in pages');
  });

  await test('all refused in one sign-in: the user is told once, and nothing loops', () => {
    const g = newSignIn();
    g.noteNavigation(7, 'https://accounts.google.com/ServiceLogin');
    eq(g.noteNavigation(7, 'https://accounts.google.com/signin/rejected').action, 'retry');
    eq(g.noteNavigation(7, 'https://accounts.google.com/signin/rejected').action, 'retry');
    const last = g.noteNavigation(7, 'https://accounts.google.com/signin/rejected');
    eq(last.action, 'give-up'); eq(last.tried.sort().join(), 'app,chrome,firefox');
    eq(g.noteNavigation(7, 'https://accounts.google.com/signin/rejected').action, 'none', 'told once');
    eq(g.noteNavigation(7, 'https://accounts.google.com/signin/rejected', { refused: true }).action, 'none');
    g.resetFlow(7);
    g.noteNavigation(7, 'https://accounts.google.com/ServiceLogin');
    eq(g.noteNavigation(7, 'https://accounts.google.com/signin/rejected').action, 'retry', '"Try again" may go round once more');
  });

  await test('a refusal found in the page itself counts too; leaving the sign-in pages starts afresh; tabs are separate', () => {
    const g = newSignIn();
    g.noteNavigation(1, 'https://accounts.google.com/ServiceLogin');
    eq(g.noteNavigation(1, 'https://accounts.google.com/v3/signin/challenge/x', { refused: true }).profile, 'chrome');
    g.noteNavigation(1, 'https://www.google.com/');                       // signed in, or went elsewhere
    g.noteNavigation(1, 'https://accounts.google.com/ServiceLogin');
    eq(g.noteNavigation(1, 'https://accounts.google.com/signin/rejected').profile, 'app', 'a new sign-in starts from the kept identity ("chrome"), then goes round from the top');
    eq(g.noteNavigation(2, 'https://accounts.google.com/v3/signin/identifier', { refused: false }).action, 'none');
    eq(g.noteNavigation(2, 'https://accounts.google.com/signin/rejected').profile, 'chrome', 'another tab: its own round');
    eq(g.noteNavigation(3, 'https://www.google.com/', { refused: true }).action, 'none', 'never for other sites');
  });

  console.log('\n📋 Nothing is disguised any more');

  await test('no preload replaces navigator.userAgentData, no "Google Chrome" brand anywhere in the page scripts', () => {
    for (const f of ['preload-external.js', 'preload-internal.js', 'preload-gesture.js', 'preload-scriptlets.js']) {
      const src = read(f).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert(!/userAgentData/.test(src) && !/Google Chrome/.test(src) && !/getHighEntropyValues/.test(src), f + ' still disguises the browser');
    }
  });

  await test('main.js: no Sec-CH-UA rewritten, no "Google Chrome" claimed; only Firefox\'s missing client hints are removed', () => {
    const main = read('main.js');
    assert(!/headers\['sec-ch-ua/i.test(main), 'a client hint is still written');
    assert(!/"Google Chrome"/.test(main), '"Google Chrome" is still claimed');
    assert(!/GOOGLE_AUTH_UA/.test(main) && !/setupGoogleAuthHeaders/.test(main), 'the old fixed identity is still there');
    const m = main.slice(main.indexOf('  setupSignInClientHints(targetSession) {'), main.indexOf('  _userAgentFor(url) {'));
    assert(/hidesClientHints\(/.test(m) && /return callback\(\{\}\)/.test(m) && /delete headers\[name\]/.test(m), 'requests pass untouched unless the Firefox identity is shown');
    assert(/details\.resourceType === 'mainFrame' && GoogleSignIn\.isSignInUrl\(details\.url\)/.test(m), 'only page requests of the sign-in get its User-Agent');
    assert(!/will-redirect[^\n]*setUserAgent|will-redirect[^\n]*Ua\(/.test(main), 'never switch the User-Agent inside a redirect (it stalls the navigation)');
    assert(/view\.webContents\.setUserAgent\(this\._userAgentFor\(initialUrl\)\)/.test(main), 'tabs start with the right identity');
    assert(/this\._watchGoogleSignIn\(wc, /.test(main) && /this\._watchGoogleSignIn\(child, childWin\)/.test(main), 'tabs and sign-in windows are watched');
    assert(/answer\/\$\{GoogleSignIn\.REFUSAL_HELP_ANSWER\}/.test(main), 'the refusal page is also recognised by its help link');
  });

  await test('isGoogleAuthUrl (pop-up rules) uses the exact host check', () => {
    const main = read('main.js');
    assert(/function isGoogleAuthUrl\(url\) \{\s*return GoogleSignIn\.isSignInUrl\(url\);\s*\}/.test(main));
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

main();
