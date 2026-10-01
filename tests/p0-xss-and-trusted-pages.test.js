/**
 * SHMMOTH BROWSER — P0 SECURITY REGRESSION TESTS
 *   1. HTML injection in privileged pages (safe-html.js, CSP, no inline handlers)
 *   2. Trusted-page model: only mtc:// and the exact app-shipped file:// documents
 *      may use the privileged API; arbitrary local files may not.
 *
 * Run with: node tests/p0-xss-and-trusted-pages.test.js
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// preload-internal.js / loggers require('electron'); keep these tests Electron-free
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return { app: { getPath: () => require('os').tmpdir() } };
  }
  return origLoad.call(this, request, ...args);
};

const SRC = path.join(__dirname, '..', 'src');
const { escapeHtml } = require('../src/pages/safe-html');
const trusted = require('../src/security/trustedPages');
const urlPolicy = require('../src/security/urlPolicy');
const ipcSecurity = require('../src/security/ipcSecurity');
const { MTC_PAGE_CSP } = require('../src/security/csp');

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — P0 XSS / Trusted-Page Tests        ');
console.log('══════════════════════════════════════════════════════\n');

// ═════════════════════════════════════════════════════════════════════════════
console.log('📋 1. escapeHtml (safe-html.js)');
// ═════════════════════════════════════════════════════════════════════════════

test('escapes all HTML-significant characters including quotes', () => {
  assert(escapeHtml('<a href="x">\'&`') === '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#96;', escapeHtml('<a href="x">\'&`'));
});

test('null / undefined become empty string, numbers are stringified', () => {
  assert(escapeHtml(null) === '' && escapeHtml(undefined) === '');
  assert(escapeHtml(0) === '0' && escapeHtml(42) === '42');
});

test('hostile page title cannot break out of a double-quoted attribute', () => {
  const title = 'Innocent" tabindex="0" autofocus onfocus="alert(1)" data-x="';
  const html = `<span class="history-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>`;
  // Parse the start tag's attributes: only class + title may exist (the hostile text must stay inside title's value).
  const startTag = html.match(/^<span([^>]*)>/)[1];
  const names = [];
  startTag.replace(/\s([a-zA-Z_:][-\w:.]*)(?:="[^"]*")?/g, (m, name) => { names.push(name); return m; });
  assert(names.join(',') === 'class,title', 'unexpected attributes ' + names.join(',') + ' in: ' + startTag);
});

test('hostile title cannot break out of a single-quoted attribute either', () => {
  const html = `<span title='${escapeHtml("x' onmouseover='alert(1)")}'>`;
  assert((html.match(/'/g) || []).length === 2, html);
});

test('hostile favicon URL (data: with quotes) cannot inject an attribute', () => {
  const favicon = 'data:image/svg+xml,x" onerror="alert(1)';
  const html = `<img src="${escapeHtml(favicon)}" data-fallback="🌐"/>`;
  assert((html.match(/"/g) || []).length === 4, html);
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 2. Source invariants for privileged pages');
// ═════════════════════════════════════════════════════════════════════════════

const pageJs   = fs.readdirSync(path.join(SRC, 'pages')).filter(f => f.endsWith('.js'));
const pageHtml = fs.readdirSync(path.join(SRC, 'pages')).filter(f => f.endsWith('.html'));
// Served through the mtc:// protocol (and therefore under the CSP header). Bubbles are loaded via file://.
const MTC_SERVED = ['newtab', 'settings', 'bookmarks', 'history', 'notes', 'downloads', 'extensions', 'crash'];

test('no page script / chrome script re-implements the quote-unsafe escapeHtml', () => {
  const files = pageJs.map(f => path.join(SRC, 'pages', f)).concat(path.join(SRC, 'renderer', 'app.js'));
  for (const f of files) {
    if (path.basename(f) === 'safe-html.js') continue;
    const src = fs.readFileSync(f, 'utf8');
    assert(!/div\.textContent\s*=\s*\w+;\s*return div\.innerHTML/.test(src),
      `${path.basename(f)} still uses the textContent→innerHTML escaper (does not escape quotes)`);
  }
});

test('no inline event-handler attributes in generated markup (CSP forbids them)', () => {
  const files = pageJs.map(f => path.join(SRC, 'pages', f)).concat(path.join(SRC, 'renderer', 'app.js'));
  for (const f of files) {
    if (path.basename(f) === 'safe-html.js') continue; // mentions handlers in its documentation comment
    const src = fs.readFileSync(f, 'utf8');
    const m = src.match(/\son(error|click|load|mouseover|focus|change|input)\s*=\s*["'`]/);
    assert(!m, `${path.basename(f)} contains an inline "${m && m[0].trim()}" handler`);
  }
});

test('mtc://-served pages contain no inline <script> blocks', () => {
  for (const page of MTC_SERVED) {
    const html = fs.readFileSync(path.join(SRC, 'pages', page + '.html'), 'utf8');
    assert(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), `${page}.html still has an inline <script>`);
    assert(!/\son[a-z]+\s*=\s*"/i.test(html), `${page}.html has an inline event-handler attribute`);
    assert(!/href\s*=\s*["']\s*javascript:/i.test(html), `${page}.html has a javascript: link`);
  }
});

test('every page that calls escapeHtml loads safe-html.js first', () => {
  const needs = {
    'history': 'history.js', 'bookmarks': 'bookmarks.js', 'downloads': 'downloads.js',
    'settings': 'settings.js', 'newtab': 'newtab.js'
  };
  for (const [page, js] of Object.entries(needs)) {
    const html = fs.readFileSync(path.join(SRC, 'pages', page + '.html'), 'utf8');
    const iSafe = html.indexOf('safe-html.js');
    const iJs   = html.indexOf(`src="${js}"`);
    assert(iSafe !== -1 && iJs !== -1 && iSafe < iJs, `${page}.html must load safe-html.js before ${js}`);
  }
  const idx = fs.readFileSync(path.join(SRC, 'renderer', 'index.html'), 'utf8');
  assert(idx.indexOf('safe-html.js') !== -1 && idx.indexOf('safe-html.js') < idx.indexOf('src="app.js"'),
    'renderer/index.html must load safe-html.js before app.js');
});

test('unescaped interpolation of page-controlled values is gone from newtab', () => {
  const src = fs.readFileSync(path.join(SRC, 'pages', 'newtab.js'), 'utf8');
  assert(!/\$\{item\.title\}/.test(src) && !/\$\{item\.icon \|\|/.test(src), 'newtab.js interpolates raw shortcut fields');
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 3. Content-Security-Policy');
// ═════════════════════════════════════════════════════════════════════════════

function directive(policy, name) {
  const part = policy.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ') || s === name);
  return part || '';
}

test('mtc:// CSP: scripts only from self, no unsafe-inline / unsafe-eval', () => {
  const script = directive(MTC_PAGE_CSP, 'script-src');
  assert(script === "script-src 'self'", `script-src was: ${script}`);
  assert(!/unsafe-eval/.test(MTC_PAGE_CSP));
  assert(directive(MTC_PAGE_CSP, 'object-src') === "object-src 'none'");
  assert(directive(MTC_PAGE_CSP, 'base-uri') === "base-uri 'none'");
  assert(directive(MTC_PAGE_CSP, 'default-src') === "default-src 'none'");
});

test('browser chrome <meta> CSP: scripts only from self', () => {
  const html = fs.readFileSync(path.join(SRC, 'renderer', 'index.html'), 'utf8');
  const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert(m, 'renderer/index.html has no CSP <meta>');
  assert(directive(m[1], 'script-src') === "script-src 'self'", 'script-src: ' + directive(m[1], 'script-src'));
  assert(!/unsafe-eval/.test(m[1]));
});

test('main.js sends the CSP header on mtc:// html responses', () => {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  assert(/Content-Security-Policy'\]\s*=\s*MTC_PAGE_CSP/.test(main));
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 4. trustedPages — which documents may use the privileged API');
// ═════════════════════════════════════════════════════════════════════════════

test('mtc:// pages are trusted', () => {
  assert(trusted.isTrustedInternalUrl('mtc://history'));
  assert(trusted.isTrustedInternalUrl('mtc://newtab/'));
});

test('the real chrome document is trusted, with or without query/hash', () => {
  assert(trusted.isTrustedInternalUrl(trusted.BROWSER_CHROME_URL));
  assert(trusted.isTrustedInternalUrl(trusted.BROWSER_CHROME_URL + '?incognito=true'));
  assert(trusted.isTrustedInternalUrl(trusted.BROWSER_CHROME_URL + '#x'));
});

test('every shipped trusted document exists on disk (guards against typos / renames)', () => {
  for (const parts of trusted.TRUSTED_FILES) {
    assert(fs.existsSync(path.join(SRC, ...parts)), `missing trusted file: ${parts.join('/')}`);
    assert(trusted.isTrustedInternalUrl(pathToFileURL(path.join(SRC, ...parts)).href), parts.join('/'));
  }
});

test('arbitrary local files are NOT trusted (downloaded html, temp, other dirs)', () => {
  for (const u of [
    'file:///C:/Users/me/Downloads/invoice.html',
    'file:///tmp/evil.html',
    pathToFileURL(path.join(SRC, 'pages', 'history.js')).href,          // real file, but not a trusted document
    pathToFileURL(path.join(SRC, 'renderer', 'app.js')).href,
    pathToFileURL(path.join(SRC, 'renderer', 'index.html.evil')).href,  // suffix trick
  ]) {
    assert(!trusted.isTrustedInternalUrl(u), 'should be untrusted: ' + u);
  }
});

test('path traversal into / out of the trusted set is not trusted', () => {
  const sneaky = 'file://' + pathToFileURL(path.join(SRC, 'renderer')).pathname + '/../../evil/renderer/index.html';
  assert(!trusted.isTrustedInternalUrl(sneaky), sneaky);
  assert(!trusted.isTrustedInternalUrl('file:///x/renderer/index.html'));
});

test('UNC / remote host file URLs are not trusted', () => {
  assert(!trusted.isTrustedInternalUrl('file://attacker.example/share/renderer/index.html'));
  assert(!trusted.isTrustedInternalUrl('file://192.168.1.5/share/src/renderer/index.html'));
  // note: file://localhost/<path> is, per the URL standard, the same local file as file:///<path>
});

test('non-file / junk inputs are not trusted', () => {
  for (const u of ['https://example.com', 'http://mtc', 'MTC://x', '', null, undefined, 42, 'mtc:/x', 'javascript:1']) {
    assert(!trusted.isTrustedInternalUrl(u), String(u));
  }
});

test('Windows semantics: case-insensitive drive/path, backslash-free URL, asar path', () => {
  const win = trusted.createTrustedPageChecker({
    srcRoot: 'C:\\Users\\Me\\AppData\\Local\\Programs\\SHMMOTH Browser\\resources\\app.asar\\src',
    platform: 'win32'
  });
  const base = 'file:///C:/Users/Me/AppData/Local/Programs/SHMMOTH%20Browser/resources/app.asar/src';
  assert(win.isTrustedInternalUrl(base + '/renderer/index.html?incognito=true'));
  assert(win.isTrustedInternalUrl(base.replace('C:', 'c:').replace('Users/Me', 'users/me') + '/renderer/index.html'), 'case-insensitive');
  assert(win.isTrustedInternalUrl(base + '/pages/password-bubble.html'));
  assert(!win.isTrustedInternalUrl('file:///C:/Users/Me/Downloads/renderer/index.html'));
  assert(!win.isTrustedInternalUrl('file://evil-host/share/SHMMOTH%20Browser/resources/app.asar/src/renderer/index.html'));
  assert(!win.isTrustedInternalUrl(base + '/pages/settings.html'), 'mtc pages are not served from file://');
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 5. IPC guard + URL policy enforce the model');
// ═════════════════════════════════════════════════════════════════════════════

test('IPC: calls from an attacker-controlled local file are rejected', () => {
  let threw = false;
  try { ipcSecurity.validateTrustedSender({ senderFrame: { url: 'file:///C:/Users/me/Downloads/evil.html' } }); }
  catch (e) { threw = e.code === 'UNTRUSTED_ORIGIN'; }
  assert(threw);
});

test('IPC: calls from the real chrome document are accepted', () => {
  ipcSecurity.validateTrustedSender({ senderFrame: { url: trusted.BROWSER_CHROME_URL + '?incognito=true' } });
});

test('navigation: web content cannot reach mtc:// or file://', () => {
  for (const to of ['mtc://settings', 'file:///C:/x.html', 'file://host/share/x.html']) {
    assert(!urlPolicy.checkNavigation('https://evil.example', to).allowed, to);
    assert(!urlPolicy.checkNavigation('http://127.0.0.1:8080/', to).allowed, to);
  }
});

test('navigation: browser chrome and internal pages may open mtc:// and local files', () => {
  assert(urlPolicy.checkNavigation(trusted.BROWSER_CHROME_URL, 'file:///C:/docs/a.pdf').allowed);
  assert(urlPolicy.checkNavigation(trusted.BROWSER_CHROME_URL, 'mtc://settings').allowed);
  assert(urlPolicy.checkNavigation('mtc://newtab', 'mtc://history').allowed);
});

test('navigation: a local document may link to a sibling local document, but never to mtc://', () => {
  assert(urlPolicy.checkNavigation('file:///C:/docs/a.html', 'file:///C:/docs/b.html').allowed);
  assert(!urlPolicy.checkNavigation('file:///C:/docs/a.html', 'mtc://settings').allowed);
});

test('popups: web content cannot window.open mtc:// pages or local files', () => {
  assert(urlPolicy.isPopupBlocked('mtc://settings', 'https://evil.example'));
  assert(urlPolicy.isPopupBlocked('file:///C:/x.html', 'https://evil.example'));
  assert(!urlPolicy.isPopupBlocked('https://example.com/', 'https://evil.example'));
  // internal opener (e.g. the notes side panel) is unaffected
  assert(!urlPolicy.isPopupBlocked('https://example.com/', 'mtc://notes'));
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 6. preload-internal.js only exposes the API to trusted locations (real preload code)');
// ═════════════════════════════════════════════════════════════════════════════

function runPreloadAt(location) {
  const exposed = [];
  const code = fs.readFileSync(path.join(SRC, 'preload-internal.js'), 'utf8');
  const electron = {
    contextBridge: { exposeInMainWorld: (name) => exposed.push(name) },
    ipcRenderer: { send() {}, invoke() {}, on() {} },
    webFrame: { executeJavaScriptInIsolatedWorld() {} }
  };
  const sandbox = {
    window: { location },
    require: (m) => (m === 'electron' ? electron : require(m)),
    console
  };
  vm.runInNewContext(code, sandbox, { filename: 'preload-internal.js' });
  return exposed;
}

const loc = (protocol, host, pathname) => ({ protocol, host, pathname });

test('exposed on mtc:// pages', () => {
  assert(runPreloadAt(loc('mtc:', 'history', '/')).includes('mtcAPI'));
});

test('exposed on the browser chrome document', () => {
  assert(runPreloadAt(loc('file:', '', '/opt/app/src/renderer/index.html')).includes('mtcAPI'));
  assert(runPreloadAt(loc('file:', '', '/C:/app/src/pages/password-bubble.html')).includes('shmmothAPI'));
});

test('NOT exposed on an arbitrary local file', () => {
  assert(runPreloadAt(loc('file:', '', '/C:/Users/me/Downloads/evil.html')).length === 0);
  assert(runPreloadAt(loc('file:', '', '/tmp/x/renderer/notindex.html')).length === 0);
});

test('NOT exposed on a UNC / remote-host file URL, even with a trusted-looking path', () => {
  assert(runPreloadAt(loc('file:', 'attacker.example', '/share/renderer/index.html')).length === 0);
});

test('NOT exposed on http(s)', () => {
  assert(runPreloadAt(loc('https:', 'evil.example', '/renderer/index.html')).length === 0);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
