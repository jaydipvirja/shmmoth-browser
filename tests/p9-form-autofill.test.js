/**
 * SHMMOTH BROWSER — form autofill (filling a saved address profile into a web form) and saving script sign-ins
 *
 * Until 1.4.7 the profiles of Settings → Autofill were saved but never filled in, and passwords were only offered for
 * saving on a real form submit. The behaviour inside a page is covered by tests/e2e/27-form-autofill.e2e.js; this file
 * checks the rules with fakes:
 *   - when the feature may touch a page (http/https, not private, switched on, a profile exists),
 *   - a page cannot fake the "show the list" message, the list only offers profiles that have the asked value,
 *   - a profile is handed to the page only after the user's click on the chooser window, for the same page,
 *   - the wiring (main.js, tabs, windows, trusted pages, preload) and the sign-in capture.
 *
 * Run: node tests/p9-form-autofill.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { FormAutofill, eligibleOrigin, buildPageScript, valueFor, fillValues, MSG_PREFIX, ISOLATED_WORLD_ID } = require('../src/services/formAutofill');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(a === b, `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const PROFILES = [
  { id: 'p1', name: 'Asha Patel', email: 'asha@example.com', phone: '98765', address: '12 Lake Road', city: 'Ahmedabad', state: 'Gujarat', country: 'India', postalCode: '380001' },
  { id: 'p2', name: 'Work', email: '', phone: '', address: '1 Office Park', city: 'Pune', state: '', country: '', postalCode: '' }
];

class FakeWc {
  constructor(id, url) { this.id = id; this.url = url; this.destroyed = false; this.calls = []; this.result = { ok: true, filled: 5 }; }
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
  getZoomFactor() { return 1; }
  async executeJavaScriptInIsolatedWorld(world, scripts) {
    this.calls.push({ world, code: scripts[0].code });
    if (/__shmmothFormFill\.fill/.test(scripts[0].code)) return this.result;
    return undefined;
  }
}
class FakeBubble {
  constructor() { this.destroyed = false; this.shown = false; this.handlers = {}; this.webContents = { fake: 'bubble-wc' }; }
  isDestroyed() { return this.destroyed; }
  getBounds() { return { x: 0, y: 0, width: 1, height: 1 }; }
  once(ev, fn) { this.handlers[ev] = fn; }
  showInactive() { this.shown = true; }
  close() { if (!this.destroyed) { this.destroyed = true; if (this.handlers.closed) this.handlers.closed(); } }
}

function setup({ url = 'https://shop.example.com/checkout', incognito = false, enabled = true, profiles = PROFILES } = {}) {
  const service = {
    isAutofillEnabled: () => state.enabled,
    getProfiles: () => profiles.map((p) => ({ ...p })),
    getProfileById: (id) => profiles.find((p) => p.id === id) || null
  };
  const wc = new FakeWc(7, url);
  const tab = { id: 'tab_1', isIncognito: incognito, view: { webContents: wc, getBounds: () => ({ x: 0, y: 100, width: 1000, height: 600 }) } };
  const parent = { isDestroyed: () => false, getContentBounds: () => ({ x: 50, y: 40, width: 1000, height: 700 }) };
  const state = { enabled, bubbles: [], clock: 0 };
  const app = new FormAutofill({
    service,
    getTab: (id) => (id === 'tab_1' ? tab : undefined),
    isActiveTab: () => true,
    getParentWindow: () => parent,
    createBubble: (opts) => { const b = new FakeBubble(); b.opts = opts; state.bubbles.push(b); return b; },
    log: { info() {}, warn() {} },
    now: () => (state.clock += 1000)          // every message a second apart: none is dropped as a flood
  });
  return { app, wc, tab, state };
}
const show = (ctx, kind) => {
  const prefix = ctx.app.pages.get('tab_1').prefix;
  return ctx.app.handleConsoleMessage('tab_1', prefix + JSON.stringify({ t: 'show', k: kind, l: 10, tp: 10, w: 200, h: 30 }));
};

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — form autofill');
  console.log('══════════════════════════════════════════════════════\n');

  await test('http and https pages only; first and last name come from the full name', () => {
    eq(eligibleOrigin('https://shop.example.com/x'), 'https://shop.example.com');
    eq(eligibleOrigin('http://shop.example.com/x'), 'http://shop.example.com');
    eq(eligibleOrigin('file:///C:/x.html'), null);
    eq(eligibleOrigin('mtc://settings'), null);
    eq(valueFor(PROFILES[0], 'given'), 'Asha');
    eq(valueFor(PROFILES[0], 'family'), 'Patel');
    eq(valueFor({ name: 'Madonna' }, 'family'), '');
    eq(fillValues(PROFILES[0]).postalCode, '380001');
    assert(Object.values(fillValues({ name: 1, email: {} })).every((v) => typeof v === 'string'), 'strings only');
  });

  await test('the page script is valid JavaScript, runs in its own isolated world, writes nothing until fill()', () => {
    const src = buildPageScript(MSG_PREFIX + 'abc:');
    new Function(src);                                       // eslint-disable-line no-new-func
    eq(ISOLATED_WORLD_ID, 4243, 'its own world, next to password autofill\'s 4242');
    assert(/if \(!e\.isTrusted\) return;/.test(src), 'only real user input opens the list');
    assert(/pass\|search\|query\|captcha\|otp/.test(src) && /cc-\|one-time-code\|password/.test(src), 'never passwords, search, cards, one-time codes');
  });

  await test('not attached in private windows, when switched off, without profiles, or on non-web pages', () => {
    eq(setup({ incognito: true }).app.attach(setup().wc, 'tab_1', { isIncognito: true }), false);
    const off = setup({ enabled: false });
    eq(off.app.attach(off.wc, 'tab_1', off.tab), false);
    const none = setup({ profiles: [] });
    eq(none.app.attach(none.wc, 'tab_1', none.tab), false);
    const file = setup({ url: 'file:///x.html' });
    eq(file.app.attach(file.wc, 'tab_1', file.tab), false);
    const ok = setup();
    eq(ok.app.attach(ok.wc, 'tab_1', ok.tab), true);
    eq(ok.wc.calls[0].world, ISOLATED_WORLD_ID);
  });

  await test('a message without the page\'s secret prefix opens nothing; an unknown field kind opens nothing', () => {
    const ctx = setup();
    ctx.app.attach(ctx.wc, 'tab_1', ctx.tab);
    eq(ctx.app.handleConsoleMessage('tab_1', MSG_PREFIX + 'guess:' + JSON.stringify({ t: 'show', k: 'email', l: 1, tp: 1, w: 1, h: 1 })), true);
    eq(ctx.state.bubbles.length, 0);
    show(ctx, 'password');
    eq(ctx.state.bubbles.length, 0, 'not a known kind');
    eq(ctx.app.handleConsoleMessage('tab_1', 'hello'), false, 'other messages are left to others');
  });

  await test('the list offers only profiles that have a value for the field; it carries no full profile', () => {
    const ctx = setup();
    ctx.app.attach(ctx.wc, 'tab_1', ctx.tab);
    show(ctx, 'email');
    const bubble = ctx.state.bubbles[0];
    const chooser = ctx.app.getChooser(bubble.webContents);
    eq(chooser.profiles.length, 1, 'the "Work" profile has no email');
    eq(chooser.profiles[0].title, 'Asha Patel');
    eq(chooser.profiles[0].detail, 'asha@example.com');
    assert(!JSON.stringify(chooser).includes('380001'), 'no other values in the list');
    eq(ctx.app.getChooser({ other: true }), null, 'only the chooser window may ask');
    ctx.app.dismiss();
    show(ctx, 'city');
    eq(ctx.app.getChooser(ctx.state.bubbles[1].webContents).profiles.length, 2);
  });

  await test('the profile reaches the page only after a click on the chooser, and only while the page is the same', async () => {
    const ctx = setup();
    ctx.app.attach(ctx.wc, 'tab_1', ctx.tab);
    show(ctx, 'name');
    const bubble = ctx.state.bubbles[0];
    const { promptId } = ctx.app.getChooser(bubble.webContents);
    eq(ctx.wc.calls.filter((c) => /fill\(/.test(c.code)).length, 0, 'nothing handed over before the click');
    eq((await ctx.app.choose(promptId, 'p1', { other: true })).success, false, 'a click from elsewhere');
    // the page moved on meanwhile
    show(ctx, 'name');
    const b2 = ctx.state.bubbles[ctx.state.bubbles.length - 1];
    const c2 = ctx.app.getChooser(b2.webContents);
    ctx.wc.url = 'https://evil.example.net/';
    eq((await ctx.app.choose(c2.promptId, 'p1', b2.webContents)).success, false, 'other site');
    ctx.wc.url = 'https://shop.example.com/checkout';
    show(ctx, 'name');
    const b3 = ctx.state.bubbles[ctx.state.bubbles.length - 1];
    const c3 = ctx.app.getChooser(b3.webContents);
    const r = await ctx.app.choose(c3.promptId, 'p1', b3.webContents);
    eq(r.success, true, JSON.stringify(r));
    const call = ctx.wc.calls.find((c) => /__shmmothFormFill\.fill/.test(c.code));
    assert(call && call.world === ISOLATED_WORLD_ID && call.code.includes('"https://shop.example.com"') && call.code.includes('380001'), 'filled in the isolated world, for this origin');
    eq(ctx.app.isChooserOpen(), false, 'closed after the choice');
  });

  await test('wired into the browser: main.js, tabs, windows, IPC, preload, trusted pages', () => {
    const main = read('src', 'main.js');
    assert(/this\.formAutofill = new FormAutofill\(\{[\s\S]*service: this\.autofillService/.test(main));
    assert(/createPasswordAutofillBubble\(opts, 'form-autofill-bubble\.html'\)/.test(main));
    const tabs = read('src', 'browser', 'tabs.js');
    assert(/this\.formAutofill\.attach\(wc, tabId, tabData\)/.test(tabs) && /browserApp\.formAutofill\.handleConsoleMessage\(tabId, message\)/.test(tabs));
    assert((tabs.match(/this\.formAutofill\.(forgetTab|dismiss)/g) || []).length >= 3, 'forgotten on navigation / tab close / switch');
    assert(/formAutofill:choose/.test(read('src', 'browser', 'ipc.js')));
    assert(/chooseFormAutofill:/.test(read('src', 'preload-internal.js')) && read('src', 'preload-internal.js').includes("'/pages/form-autofill-bubble.html'"));
    assert(read('src', 'security', 'trustedPages.js').includes("'form-autofill-bubble.html'"));
    const html = read('src', 'pages', 'form-autofill-bubble.html');
    assert(!/innerHTML/.test(html), 'the list is built with DOM calls');
    assert(/default-src 'none'/.test(html), 'tight policy');
  });

  await test('sign-ins are noticed on a sign-in button click and on Enter too, not on "show password"; a two-step sign-in keeps its user name', () => {
    const pw = read('src', 'browser', 'passwords.js');
    assert(/addEventListener\('keydown'[\s\S]*e\.key !== 'Enter'/.test(pw), 'Enter');
    assert(/addEventListener\('click'[\s\S]*isSignInButton\(button\)/.test(pw), 'button click');
    assert(/show\|hide\|eye\|reveal\|forgot/.test(pw), '"show password" and "forgot" buttons are not a sign-in');
    assert(/__SHMMOTH_LOGIN_USER__/.test(pw), 'first step of a two-step sign-in');
    const tabs = read('src', 'browser', 'tabs.js');
    assert(/tabData\.lastLoginUser = \{ origin:/.test(tabs) && /remembered\.origin === origin && Date\.now\(\) - remembered\.at < 10 \* 60 \* 1000/.test(tabs), 'used only for the same site, for 10 minutes');
  });

  console.log(`\n  p9-form-autofill: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
