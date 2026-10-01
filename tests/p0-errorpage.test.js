/**
 * P0 — error pages (mtc://error) and the mtc:// handler in incognito.
 * Run: node tests/p0-errorpage.test.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

const SRC = path.join(__dirname, '..', 'src');
const { shouldShowErrorPage, buildErrorPageUrl, displayUrl, MAX_URL } = require('../src/utils/errorPage');
const { buildSnapshot } = require('../src/services/sessionStore');
const mainJs  = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
const pageJs  = fs.readFileSync(path.join(SRC, 'pages', 'error.js'), 'utf8');
const pageHtml = fs.readFileSync(path.join(SRC, 'pages', 'error.html'), 'utf8');

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — P0 Error Page Tests                ');
console.log('══════════════════════════════════════════════════════\n');

console.log('📋 1. When an error page is shown');
const web = 'https://example.com/a';
test('main-frame failures of web addresses get the page', () => {
  for (const errorCode of [-105, -106, -102, -118, -101, -109, -130, -20, -200, -201, -202, -310, -324, -2, -6]) {
    assert(shouldShowErrorPage({ errorCode, validatedURL: web, isMainFrame: true }), String(errorCode));
  }
  assert(shouldShowErrorPage({ errorCode: -105, validatedURL: 'http://localhost:3000/', isMainFrame: true }));
});
test('ERR_ABORTED (-3: navigated away, Stop, or turned into a download) is not an error', () => {
  assert(!shouldShowErrorPage({ errorCode: -3, validatedURL: web, isMainFrame: true }));
});
test('sub-frames (ads, iframes, images) never replace the page', () => {
  assert(!shouldShowErrorPage({ errorCode: -105, validatedURL: web, isMainFrame: false }));
});
test('only http(s) addresses: no loops for mtc://, no page for file:, data:, chrome-error:, junk', () => {
  for (const validatedURL of ['mtc://error?code=-105', 'mtc://settings', 'file:///x.html', 'data:text/html,x', 'chrome-error://chromewebdata/', 'javascript:1', '', undefined, null, 5]) {
    assert(!shouldShowErrorPage({ errorCode: -105, validatedURL, isMainFrame: true }), String(validatedURL));
  }
});
test('non-error codes and malformed input never throw and never show the page', () => {
  for (const e of [{ errorCode: 0, validatedURL: web, isMainFrame: true }, { errorCode: 200, validatedURL: web, isMainFrame: true }, { errorCode: '-105', validatedURL: web, isMainFrame: true }, {}, undefined]) {
    assert(!shouldShowErrorPage(e));
  }
});

console.log('\n📋 2. The error page address');
test('code, sanitised name and the failed address are encoded in the query', () => {
  const u = new URL(buildErrorPageUrl(-105, 'net::ERR_NAME_NOT_RESOLVED', 'https://a.example/p?x=1&y=<b>'));
  assert(u.protocol === 'mtc:' && u.hostname === 'error');
  assert(u.searchParams.get('code') === '-105' && u.searchParams.get('name') === 'ERR_NAME_NOT_RESOLVED');
  assert(u.searchParams.get('url') === 'https://a.example/p?x=1&y=<b>', 'the address must survive the round trip');
});
test('the error name cannot carry markup or be unbounded; the address is capped', () => {
  const u = new URL(buildErrorPageUrl(-1, '<img src=x onerror=1>' + 'A'.repeat(500), 'https://e.example/' + 'z'.repeat(5000)));
  assert(!/[<>"'=\s]/.test(u.searchParams.get('name')) && u.searchParams.get('name').length <= 64);
  assert(u.searchParams.get('url').length === MAX_URL);
});
test('a tab showing the error page is displayed (address bar, history, session, Ctrl+Shift+T) as the address that failed', () => {
  assert(displayUrl({ url: 'mtc://error/?code=-105', failedUrl: 'https://a.example/' }) === 'https://a.example/');
  assert(displayUrl({ url: 'https://ok.example/', failedUrl: 'https://stale.example/' }) === 'https://ok.example/', 'a stale failedUrl must not override a real page');
  assert(displayUrl({ url: 'https://ok.example/', failedUrl: null }) === 'https://ok.example/');
  assert(displayUrl(null) === '' && displayUrl(undefined) === '');
  const snap = buildSnapshot({ t: { url: 'mtc://error/?code=-105&url=x', failedUrl: 'https://a.example/' } }, ['t'], 't');
  assert(snap.tabs.length === 1 && snap.tabs[0].url === 'https://a.example/', JSON.stringify(snap));
});

console.log('\n📋 3. The page (error.html / error.js)');
test('no inline script or handler (the mtc:// CSP forbids them) and no innerHTML / eval / document.write', () => {
  assert(!/<script(?![^>]*\ssrc=)/i.test(pageHtml), 'inline <script>');
  assert(!/\son[a-z]+\s*=/i.test(pageHtml), 'inline event handler attribute');
  assert(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(pageJs));
});
test('Try again is only wired for http(s) addresses', () => {
  assert(/failedUrl = \/\^https\?:\\\/\\\/\/i\.test\(rawUrl\) \? rawUrl : ''/.test(pageJs));
  assert(/if \(failedUrl\) \{\s*retry\.addEventListener/.test(pageJs));
});
test('plain-language messages exist for the common failures and for the whole certificate range', () => {
  for (const code of ['-105', '-106', '-102', '-118', '-101', '-130', '-20', '-310']) assert(pageJs.includes(`'${code}':`), code);
  assert(/c <= -200 && c > -300/.test(pageJs), 'certificate errors (-2xx)');
  assert(/does not offer a way to continue past this warning/.test(pageJs), 'no certificate bypass');
});

console.log('\n📋 4. Wiring');
test('did-fail-load passes isMainFrame and shows the page; the error page is not remembered as a good page or in history', () => {
  assert(/wc\.on\('did-fail-load', \(_, errorCode, errorDescription, validatedURL, isMainFrame\)/.test(mainJs));
  assert(/shouldShowErrorPage\(\{ errorCode, validatedURL, isMainFrame \}\)/.test(mainJs));
  assert(/!navUrl\.startsWith\('mtc:\/\/crash'\) && !isErrorPage/.test(mainJs));
  assert(/!tabData\.isIncognito && !isErrorPage/.test(mainJs));
});
test('address bar, navigation state and the warning icon use the failed address', () => {
  assert(/url:\s+displayUrl\(t\)/.test(mainJs) && /url:\s+displayUrl\(activeTab\)/.test(mainJs));
  assert(/hasError:/.test(mainJs));
  assert(/updateOmnibox\(activeTab\.url, activeTab\.hasError\)/.test(fs.readFileSync(path.join(SRC, 'renderer', 'app.js'), 'utf8')));
});
test('the mtc:// handler is registered for the incognito session too (internal pages were blank in incognito tabs)', () => {
  assert(/protocol\.handle\('mtc', handleMtc\);\s*session\.fromPartition\('incognito'\)\.protocol\.handle\('mtc', handleMtc\)/.test(mainJs));
});

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
