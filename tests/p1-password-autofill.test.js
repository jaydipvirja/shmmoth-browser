/**
 * SHMMOTH BROWSER — password autofill (filling a saved login into a sign-in form)
 *
 * Until 1.1.6 the browser could save passwords but never filled them back in. The real behaviour inside a web page is
 * covered by tests/e2e/15-password-autofill.e2e.js; this file checks the rules around it with fakes:
 *   - when the feature may touch a page at all (https / localhost, not private, saved login exists, switched on),
 *   - that a page cannot fake the "show the list" message,
 *   - that the chooser only ever carries user names, and a password is decrypted only after the user's own click on the
 *     chooser window and only for the page that is still on the same site,
 *   - the wiring in main.js, the trusted-page lists and the settings.
 *
 * Run: node tests/p1-password-autofill.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(a === b, `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_pwfill_'));
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return { app: { getPath: () => tmp, quit() {} }, safeStorage: { isEncryptionAvailable: () => false } };
  }
  return origLoad.call(this, request, ...rest);
};

const { PasswordAutofill, eligibleOrigin, buildPageScript, placeChooser, MSG_PREFIX, ISOLATED_WORLD_ID } = require('../src/services/passwordAutofill');
const { PasswordVault } = require('../src/services/passwordVault');

const SECRET = 'S3cret-pass-word!';
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// ─── fakes ───────────────────────────────────────────────────────────────────

class FakeWc {
  constructor(id, url) { this.id = id; this.url = url; this.destroyed = false; this.calls = []; this.result = { ok: true, user: true, password: true }; }
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
  getZoomFactor() { return 1; }
  async executeJavaScriptInIsolatedWorld(world, scripts) {
    this.calls.push({ world, code: scripts[0].code });
    if (/__shmmothPwFill\.fill/.test(scripts[0].code)) return this.result;
    return undefined;
  }
}
class FakeBubble {
  constructor() { this.destroyed = false; this.shown = false; this.handlers = {}; this.webContents = { fake: 'bubble-wc' }; this.bounds = { x: 100, y: 100, width: 200, height: 100 }; }
  isDestroyed() { return this.destroyed; }
  getBounds() { return this.bounds; }
  once(ev, fn) { this.handlers[ev] = fn; }
  showInactive() { this.shown = true; }
  close() { if (!this.destroyed) { this.destroyed = true; if (this.handlers.closed) this.handlers.closed(); } }
}

function setup({ url = 'https://example.com/login', incognito = false, enabled = true, creds = [{ username: 'alice', password: SECRET }, { username: 'bob', password: 'x-bob' }], encrypt = true } = {}) {
  const vault = new PasswordVault(path.join(tmp, `v_${Math.random().toString(36).slice(2)}.json`), { allowInsecureFallback: true });
  const origin = new URL(url).origin;
  for (const c of creds) vault.saveCredential({ origin, username: c.username, password: c.password });
  const decrypted = [];
  const realDecrypt = vault.decryptForAuthorizedUse.bind(vault);
  vault.decryptForAuthorizedUse = (id) => { decrypted.push(id); return realDecrypt(id); };
  if (!encrypt) vault.canEncrypt = () => false;

  const wc = new FakeWc(7, url);
  const tab = { id: 'tab_1', isIncognito: incognito, view: { webContents: wc, getBounds: () => ({ x: 0, y: 100, width: 1000, height: 600 }) } };
  const parent = { isDestroyed: () => false, getContentBounds: () => ({ x: 50, y: 40, width: 1000, height: 700 }) };
  const state = { enabled, active: true, cursor: { x: -1, y: -1 }, bubbles: [] };
  const app = new PasswordAutofill({
    vault,
    isEnabled: () => state.enabled,
    getTab: (id) => (id === 'tab_1' ? tab : undefined),
    isActiveTab: () => state.active,
    getParentWindow: () => parent,
    createBubble: (opts) => { const b = new FakeBubble(); b.opts = opts; state.bubbles.push(b); return b; },
    getCursor: () => state.cursor,
    log: { info() {}, warn() {} },
  });
  return { app, vault, wc, tab, state, decrypted, origin };
}

const showMsg = (prefix, extra = {}) => prefix + JSON.stringify({ t: 'show', l: 100, tp: 50, w: 300, h: 30, vw: 1000, vh: 600, ...extra });
const prefixOf = (ctx) => ctx.app.pages.get('tab_1').prefix;

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — password autofill');
  console.log('══════════════════════════════════════════════════════');

  console.log('\n📋 Where it may work');

  await test('only https pages (and http on localhost) are eligible; the origin is what the login was saved for', () => {
    eq(eligibleOrigin('https://accounts.example.com/signin?x=1'), 'https://accounts.example.com');
    eq(eligibleOrigin('http://localhost:3000/login'), 'http://localhost:3000');
    eq(eligibleOrigin('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
    eq(eligibleOrigin('http://example.com/login'), null, 'plain http on the internet');
    eq(eligibleOrigin('http://localhost.evil.com/'), null, 'look-alike host');
    eq(eligibleOrigin('file:///C:/login.html'), null);
    eq(eligibleOrigin('mtc://settings'), null);
    eq(eligibleOrigin('javascript:alert(1)'), null);
    eq(eligibleOrigin(''), null);
    eq(eligibleOrigin(undefined), null);
  });

  await test('the page is only touched when a login is saved for exactly this site, the switch is on and the window is not private', () => {
    let c = setup();
    assert(c.app.attach(c.wc, 'tab_1', c.tab), 'normal case');
    eq(c.wc.calls.length, 1);
    eq(c.wc.calls[0].world, ISOLATED_WORLD_ID, 'runs in an isolated world, not in the page');

    c = setup({ incognito: true });
    assert(!c.app.attach(c.wc, 'tab_1', c.tab), 'private window');
    eq(c.wc.calls.length, 0);

    c = setup({ enabled: false });
    assert(!c.app.attach(c.wc, 'tab_1', c.tab), 'switched off in Settings');
    eq(c.wc.calls.length, 0);

    c = setup({ creds: [] });
    assert(!c.app.attach(c.wc, 'tab_1', c.tab), 'nothing saved for this site');
    eq(c.wc.calls.length, 0);

    c = setup({ encrypt: false });
    assert(!c.app.attach(c.wc, 'tab_1', c.tab), 'no OS encryption');

    c = setup({ url: 'http://example.com/login' });
    assert(!c.app.attach(c.wc, 'tab_1', c.tab), 'plain http');

    c = setup();
    c.wc.url = 'https://other.example.org/';   // a login saved for example.com is not offered on another site
    assert(!c.app.attach(c.wc, 'tab_1', c.tab), 'a different site');
  });

  await test('the injected script is valid JavaScript, carries the nonce and can write into forms only through fill()', () => {
    const code = buildPageScript(MSG_PREFIX + 'abc123:');
    new Function(code); // eslint-disable-line no-new-func
    assert(code.includes('__SHMMOTH_PWFILL__:abc123:'));
    assert(code.includes('state.fill = function'));
    assert(/location\.origin !== origin/.test(code), 'fill() re-checks the site inside the page');
    assert(/isTrusted/.test(code), 'synthetic events from the page are ignored');
    assert(/new-password/.test(code), 'sign-up / change-password fields are left alone');
    assert(!/submit\(|requestSubmit|\.click\(\)/.test(code), 'it never submits anything');
  });

  console.log('\n📋 The "show the list" message');

  await test('a message without the page\'s secret nonce is ignored (a web page cannot fake it)', () => {
    const c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    const real = prefixOf(c);
    assert(c.app.handleConsoleMessage('tab_1', MSG_PREFIX + 'f'.repeat(real.length - MSG_PREFIX.length - 1) + ':' + JSON.stringify({ t: 'show', l: 1, tp: 1, w: 100, h: 20 })), 'recognised as ours, so nobody else logs it');
    eq(c.state.bubbles.length, 0, 'wrong nonce → nothing opens');
    assert(c.app.handleConsoleMessage('tab_1', showMsg(real)));
    eq(c.state.bubbles.length, 1, 'right nonce → the list opens');
    assert(!c.app.handleConsoleMessage('tab_1', 'hello'), 'ordinary console output is not ours');
  });

  await test('it opens only for the active tab, on the same site, with sane numbers, and not in a flood', () => {
    let c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.state.active = false;
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    eq(c.state.bubbles.length, 0, 'background tab');

    c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.wc.url = 'https://evil.example.net/';
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    eq(c.state.bubbles.length, 0, 'the tab already moved to another site');

    c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c), { l: 'x' }));
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c), { w: null }));
    eq(c.state.bubbles.length, 0, 'garbage coordinates');

    c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    let now = 1000; c.app.now = () => now;
    for (let i = 0; i < 20; i++) c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    eq(c.state.bubbles.length, 1, '20 messages in the same instant → one window');
    now += 500;
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    eq(c.state.bubbles.length, 2, 'a later request replaces it');
    assert(c.state.bubbles[0].destroyed, 'the old window is gone');
  });

  await test('the list shows user names only — no password reaches the chooser window or the page before a click', () => {
    const c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    const bubble = c.state.bubbles[0];
    const shown = c.app.getChooser(bubble.webContents);
    eq(shown.accounts.map((a) => a.username).sort().join(','), 'alice,bob');
    assert(!JSON.stringify(shown).includes(SECRET) && !JSON.stringify(shown).includes('x-bob'), 'no password in the chooser data');
    eq(c.decrypted.length, 0, 'nothing was decrypted yet');
    assert(c.wc.calls.every((x) => !x.code.includes(SECRET)), 'nothing secret was sent to the page');
    eq(c.app.getChooser({ fake: 'some other window' }), null, 'only the chooser window itself can read the list');
  });

  await test('the chooser is placed under the field, flips above at the bottom edge and stays inside the page', () => {
    const base = { content: { x: 50, y: 40 }, view: { x: 0, y: 100, width: 1000, height: 600 }, zoom: 1, rows: 2 };
    let p = placeChooser({ ...base, rect: { l: 100, tp: 50, w: 300, h: 30 } });
    eq(p.x, 150); eq(p.y, 222, 'under the field');
    assert(p.y >= 40 + 100 + 50 + 30, 'below the field');
    p = placeChooser({ ...base, rect: { l: 100, tp: 560, w: 300, h: 30 } });
    assert(p.y + p.height <= 40 + 100 + 560, 'no room below → above the field');
    p = placeChooser({ ...base, rect: { l: 990, tp: 50, w: 300, h: 30 } });
    assert(p.x + p.width <= 50 + 1000, 'not outside the right edge');
    p = placeChooser({ ...base, rect: { l: -500, tp: 50, w: 300, h: 30 } });
    assert(p.x >= 50, 'not outside the left edge');
    p = placeChooser({ ...base, zoom: 2, rect: { l: 100, tp: 50, w: 100, h: 20 } });
    eq(p.x, 50 + 200, 'page zoom is applied');
  });

  console.log('\n📋 Filling in');

  await test('a click on an entry decrypts that one password and gives it to the page script, which re-checks the site', async () => {
    const c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    const bubble = c.state.bubbles[0];
    const chooser = c.app.getChooser(bubble.webContents);
    const alice = chooser.accounts.find((a) => a.username === 'alice');
    const res = await c.app.choose(chooser.promptId, alice.id, bubble.webContents);
    assert(res.success && res.filledUser && res.filledPassword, JSON.stringify(res));
    eq(c.decrypted.length, 1); eq(c.decrypted[0], alice.id, 'only the chosen password was decrypted');
    const call = c.wc.calls[c.wc.calls.length - 1];
    eq(call.world, ISOLATED_WORLD_ID);
    assert(call.code.includes(JSON.stringify(SECRET)) && call.code.includes('"alice"'), 'values are passed as JSON strings');
    assert(call.code.includes(JSON.stringify(c.origin)), 'the expected site travels with the call');
    assert(bubble.destroyed && !c.app.isChooserOpen(), 'the chooser closes');
  });

  await test('nothing is filled when the request is stale, forged, from the wrong window, or the site changed meanwhile', async () => {
    let c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    let bubble = c.state.bubbles[0];
    let chooser = c.app.getChooser(bubble.webContents);
    let id = chooser.accounts[0].id;

    let res = await c.app.choose(chooser.promptId, id, { fake: 'a web page or another window' });
    assert(!res.success, 'sender is not the chooser window');
    res = await c.app.choose('pwfill_999_nope', id, bubble.webContents);
    assert(!res.success, 'unknown prompt id');
    res = await c.app.choose(chooser.promptId, 'cred_not_in_the_list', bubble.webContents);
    assert(!res.success, 'a credential that was not offered');
    eq(c.decrypted.length, 0, 'none of that decrypted anything');
    assert(c.app.isChooserOpen(), 'and the chooser is still waiting for a real click');

    c.wc.url = 'https://evil.example.net/phish';              // the page navigated while the list was open
    res = await c.app.choose(chooser.promptId, id, bubble.webContents);
    assert(!res.success, 'site changed');
    eq(c.decrypted.length, 0, 'the password was never even decrypted for another site');
    assert(c.wc.calls.every((x) => !x.code.includes(SECRET)));

    c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    bubble = c.state.bubbles[0]; chooser = c.app.getChooser(bubble.webContents);
    c.wc.destroyed = true;
    res = await c.app.choose(chooser.promptId, chooser.accounts[0].id, bubble.webContents);
    assert(!res.success, 'tab gone');

    c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    bubble = c.state.bubbles[0]; chooser = c.app.getChooser(bubble.webContents);
    c.tab.isIncognito = true;
    res = await c.app.choose(chooser.promptId, chooser.accounts[0].id, bubble.webContents);
    assert(!res.success && c.decrypted.length === 0, 'tab became private');
  });

  await test('a page with no sign-in field reports that nothing was filled', async () => {
    const c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    const bubble = c.state.bubbles[0]; const chooser = c.app.getChooser(bubble.webContents);
    c.wc.result = { ok: false, reason: 'field' };
    const res = await c.app.choose(chooser.promptId, chooser.accounts[0].id, bubble.webContents);
    assert(!res.success && /field/i.test(res.error), JSON.stringify(res));
  });

  console.log('\n📋 Closing');

  await test('the list closes on navigation, tab close, Escape/typing in the field, and after 60 s; a click on the list itself does not close it', () => {
    let c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    c.app.forgetTab('tab_1');
    assert(c.state.bubbles[0].destroyed && !c.app.isChooserOpen(), 'navigation / tab closed');

    c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    c.app.handleConsoleMessage('tab_1', prefixOf(c) + JSON.stringify({ t: 'hide' }));
    assert(c.state.bubbles[0].destroyed, 'the page said the field lost focus / the user typed');

    c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    c.state.cursor = { x: 150, y: 130 };                       // the mouse is on the list: the field blurring must not close it
    c.app.handleConsoleMessage('tab_1', prefixOf(c) + JSON.stringify({ t: 'hide' }));
    assert(!c.state.bubbles[0].destroyed, 'mouse on the list → stays');

    c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c)));
    c.app.dismiss();
    assert(c.state.bubbles[0].destroyed && !c.app.isChooserOpen(), 'dismiss()');

    // 60 s: capture the timer the chooser sets and run it
    c = setup();
    c.app.attach(c.wc, 'tab_1', c.tab);
    const realSetTimeout = global.setTimeout;
    let scheduled = null;
    global.setTimeout = (fn, ms) => { scheduled = { fn, ms }; return { unref() {} }; };
    try { c.app.handleConsoleMessage('tab_1', showMsg(prefixOf(c))); } finally { global.setTimeout = realSetTimeout; }
    eq(scheduled && scheduled.ms, 60000, 'a forgotten list expires after 60 s');
    scheduled.fn();
    assert(c.state.bubbles[0].destroyed && !c.app.isChooserOpen(), 'expired');
  });

  console.log('\n📋 The vault');

  await test('a login that is already saved exactly as typed is not offered for saving again; a changed password is', () => {
    const v = new PasswordVault(path.join(tmp, 'v_match.json'), { allowInsecureFallback: true });
    v.saveCredential({ origin: 'https://example.com', username: 'alice', password: SECRET });
    assert(v.matchesSaved('https://example.com/login', 'alice', SECRET), 'same');
    assert(v.matchesSaved('https://example.com', ' alice ', SECRET), 'user name is trimmed like when saving');
    assert(!v.matchesSaved('https://example.com', 'alice', SECRET + '2'), 'new password → offer to update');
    assert(!v.matchesSaved('https://example.com', 'carol', SECRET), 'new user');
    assert(!v.matchesSaved('https://other.example.org', 'alice', SECRET), 'other site');
    assert(!v.matchesSaved('https://example.com', 'alice', ''), 'empty');
  });

  console.log('\n📋 Wiring');

  await test('main.js: attached after load, handled before the save-capture code, closed on navigation / tab switch / tab close / window move', () => {
    const main = read('src', 'main.js');
    assert(/this\.passwordAutofill\.attach\(wc, tabId, tabData\)/.test(main), 'attach on dom-ready');
    assert(/passwordAutofill\.handleConsoleMessage\(tabId, message\)\) return;/.test(main), 'console messages');
    assert(/!isInPlace && this\.passwordAutofill\) this\.passwordAutofill\.forgetTab\(tabId\)/.test(main), 'navigation');
    assert(/this\.closeDownloadBubble\(\);\s*\n\s*if \(this\.passwordAutofill\) this\.passwordAutofill\.dismiss\(\)/.test(main), 'tab switch');
    assert(/this\.passwordAutofill\.forgetTab\(tabId\);\s*\n\s*\n\s*const isIncognito = Boolean\(tabData\.isIncognito\)/.test(main), 'tab close');
    assert(/mainWindow\.on\('move'/.test(main) && /mainWindow\.on\('resize',\s+\(\) => \{ if \(this\.passwordAutofill\)/.test(main), 'window move / resize');
    assert(/focusable: false/.test(main.slice(main.indexOf('createPasswordAutofillBubble'))), 'the list never takes keyboard focus from the page');
    for (const ch of ['getChooser', 'choose', 'dismiss']) assert(main.includes(`'passwordAutofill:${ch}'`), ch);
    assert(/passwordAutofill\.getChooser\(event\.sender\)/.test(main) && /_fromBubble\(event\.sender\)/.test(main), 'IPC passes the sender so only the chooser window is accepted');
  });

  await test('the unsafe test key can only be switched on in an unpackaged run', () => {
    const main = read('src', 'main.js');
    assert(/allowInsecureFallback: !app\.isPackaged && process\.env\.SHMMOTH_E2E_INSECURE_VAULT === '1'/.test(main));
  });

  await test('the chooser page is a trusted internal page with its API, and the setting exists (default on)', () => {
    assert(read('src', 'security', 'trustedPages.js').includes("'autofill-bubble.html'"));
    assert(read('src', 'preload-internal.js').includes("'/pages/autofill-bubble.html'"));
    assert(/choosePasswordAutofill/.test(read('src', 'preload-internal.js')));
    assert(/passwordAutofillEnabled:\s*true/.test(read('src', 'services', 'storage.js')));
    assert(read('src', 'pages', 'settings.html').includes('id="toggle-password-autofill"'));
    assert(/passwordAutofillEnabled/.test(read('src', 'pages', 'settings.js')));
  });

  await test('the chooser page builds its list with textContent (a user name can contain markup)', () => {
    const html = read('src', 'pages', 'autofill-bubble.html');
    assert(!/innerHTML/.test(html), 'no innerHTML');
    assert(/name\.textContent = account\.username/.test(html));
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exit(failed > 0 ? 1 : 0);
}

main();
