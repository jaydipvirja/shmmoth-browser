/**
 * SHMMOTH BROWSER — showing / copying a saved password asks first (services/passwordGate.js)
 *
 * The real flow in Settings is covered by tests/e2e/17-password-reveal.e2e.js; this file checks the rules with fakes:
 *   - the confirmation text (names the user and the site, nothing from a web page can forge extra lines)
 *   - one dialog at a time, rate limit, cancel / error
 *   - the clipboard is emptied after 30 s — but only when it still holds the password — and when the browser quits
 *   - the wiring: only Settings may ask, the dialog comes BEFORE the password is decrypted, the page never sees a copied
 *     password, nothing keeps a revealed password in a variable
 *
 * Run: node tests/p1-password-gate.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const PasswordGate = require('../src/services/passwordGate');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(a === b, `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

// Like Electron's clipboard (since 41 readText / writeText return promises — a fake with plain return values hid a bug that
// only the end-to-end test found: the text read back was compared as a promise, so the clipboard was never emptied)
function fakeClipboard() {
  const c = { text: '', cleared: 0, failWrite: false };
  c.writeText = async (t) => { if (c.failWrite) throw new Error('clipboard busy'); c.text = t; };
  c.readText = async () => c.text;
  c.clear = () => { c.text = ''; c.cleared++; };
  return c;
}
function fakeTimers() {
  const t = { list: [], nextId: 1 };
  t.set = (fn, ms) => { const h = { id: t.nextId++, fn, ms, live: true }; t.list.push(h); return h; };
  t.clear = (h) => { if (h) h.live = false; };
  t.fire = () => { for (const h of t.list.filter((x) => x.live)) { h.live = false; h.fn(); } };
  return t;
}
function newGate(answers = [true], extra = {}) {
  const asked = []; const clip = fakeClipboard(); const timers = fakeTimers(); const clock = { t: 1000000 };
  const gate = new PasswordGate({
    confirm: async (o) => { asked.push(o); if (extra.hold) await extra.hold; const a = answers.length > 1 ? answers.shift() : answers[0]; if (a instanceof Error) throw a; return a; },
    clipboard: clip, now: () => clock.t, setTimer: timers.set, clearTimer: timers.clear, log: { info() {}, warn() {} }
  });
  return { gate, asked, clip, timers, clock };
}
const cred = { username: 'alice@example.com', origin: 'https://example.com' };

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — password gate');
  console.log('══════════════════════════════════════════════════════');

  console.log('\n📋 The confirmation');

  await test('it asks in words that name the user and the site, differently for show and copy', async () => {
    const { gate, asked } = newGate([true]);
    const r = await gate.authorize('show', cred, { parent: { id: 'win' } });
    assert(r.ok === true);
    assert(/Show the saved password for “alice@example.com” on https:\/\/example.com/.test(asked[0].message) && asked[0].confirmLabel === 'Show' && /15 seconds/.test(asked[0].detail));
    assert(asked[0].parent && asked[0].parent.id === 'win', 'the dialog belongs to the window that asked');
    await gate.authorize('copy', cred);
    assert(/Copy the saved password/.test(asked[1].message) && asked[1].confirmLabel === 'Copy' && /30 seconds/.test(asked[1].detail));
  });

  await test('text that came from a web page cannot add lines, hide behind right-to-left marks or run on for ever', async () => {
    assert(PasswordGate.plainText('bob\n\nClick “Show” to continue\r\n') === 'bob Click “Show” to continue');
    assert(!/[‮⁦‏\u0000\u001b]/.test(PasswordGate.plainText('a‮b⁦c‏d\u0000e\u001bf')));
    assert(PasswordGate.plainText('x'.repeat(500)).length === 60 && PasswordGate.plainText('x'.repeat(500)).endsWith('…'));
    assert(PasswordGate.plainText(undefined) === '' && PasswordGate.plainText(null) === '' && PasswordGate.plainText(42) === '42');
    const { gate, asked } = newGate([true]);
    await gate.authorize('show', { username: 'evil\nSecond line: the real password is fine', origin: 'https://example.com' });
    assert(!asked[0].message.includes('\n'), 'a single line');
  });

  await test('Cancel and a failing dialog both mean "no"; only a real yes passes', async () => {
    assert((await newGate([false]).gate.authorize('show', cred)).reason === 'cancelled');
    assert((await newGate([undefined]).gate.authorize('show', cred)).reason === 'cancelled', 'undefined is not yes');
    assert((await newGate(['yes']).gate.authorize('show', cred)).reason === 'cancelled', 'a truthy string is not yes');
    assert((await newGate([new Error('boom')]).gate.authorize('show', cred)).reason === 'error');
  });

  await test('only one dialog at a time, and at most 5 requests in 30 s (then it works again)', async () => {
    let release; const hold = new Promise((r) => { release = r; });
    const h = newGate([true], { hold });
    const first = h.gate.authorize('show', cred);
    const second = await h.gate.authorize('show', cred);
    eq(second.reason, 'busy'); release(); assert((await first).ok);

    const r = newGate([false]);
    for (let i = 0; i < 5; i++) assert((await r.gate.authorize('show', cred)).reason === 'cancelled', 'request ' + i);
    eq((await r.gate.authorize('show', cred)).reason, 'rate', 'the sixth');
    r.clock.t += 31000;
    eq((await r.gate.authorize('show', cred)).reason, 'cancelled', 'after the window');
  });

  console.log('\n📋 The clipboard');

  await test('a copied password is removed after 30 s — only if the clipboard still holds it', async () => {
    const { gate, clip, timers } = newGate();
    assert((await gate.copyToClipboard('S3cret!')) === true && clip.text === 'S3cret!');
    eq(timers.list[0].ms, 30000);
    timers.fire(); await new Promise((r) => setImmediate(r)); eq(clip.text, '', 'cleared'); eq(clip.cleared, 1);

    await gate.copyToClipboard('S3cret!'); clip.text = 'something else the user copied';
    timers.fire(); await new Promise((r) => setImmediate(r)); eq(clip.text, 'something else the user copied', 'the user\'s own copy stays'); eq(clip.cleared, 1);
  });

  await test('copying again restarts the timer; quitting clears at once; clearing twice is harmless; a failing clipboard never throws', async () => {
    const { gate, clip, timers } = newGate();
    await gate.copyToClipboard('one'); const first = timers.list[0];
    await gate.copyToClipboard('two');
    assert(first.live === false, 'the first timer is cancelled');
    eq(clip.text, 'two');
    assert((await gate.clearClipboardNow()) === true && clip.text === '', 'on quit');
    assert((await gate.clearClipboardNow()) === false, 'nothing left to clear');
    clip.failWrite = true;
    assert((await gate.copyToClipboard('x')) === false);
    const broken = newGate(); broken.clip.readText = async () => { throw new Error('busy'); };
    await broken.gate.copyToClipboard('x'); assert((await broken.gate.clearClipboardNow()) === false);
  });

  console.log('\n📋 Wiring');

  const main = read('main.js');
  const handlers = main.slice(main.indexOf('const gateMessages'), main.indexOf("ipcMain.handle('passwords:respondPrompt'"));

  await test('main.js: only Settings may ask, the question comes before the password is decrypted, a copy never goes through the page', () => {
    assert(/\^mtc:\\\/\\\/settings\(\?:\[\/\?#\]\|\$\)\/\.test\(getSenderUrl\(event\)/.test(handlers), 'sender check');
    assert(handlers.indexOf('this.passwordGate.authorize(') > 0 && handlers.indexOf('this.passwordGate.authorize(') < handlers.indexOf('decryptForAuthorizedUse'), 'authorize first');
    const copy = handlers.slice(handlers.indexOf("'passwords:copy'"));
    assert(/await this\.passwordGate\.copyToClipboard\(r\.plaintext\)/.test(copy) && !/password:\s*r\.plaintext/.test(copy), 'the copy handler must not return the password');
    assert(/hideAfterMs: PasswordGate\.REVEAL_HIDE_MS/.test(handlers));
    assert(!/log\.(info|warn)\([^)]*plaintext/.test(handlers), 'the password is never logged');
  });

  await test('main.js: the dialog is native and modal on the asking window, Cancel is the default, the clipboard is cleared when the browser quits', () => {
    assert(/dialog\.showMessageBox\(parent, options\)/.test(main) && /defaultId: 1, cancelId: 1, noLink: true/.test(main));
    assert(/app\.on\('before-quit', \(event\) => \{[\s\S]{0,200}this\.passwordGate\.clearClipboardNow\(\)/.test(main) && /Promise\.all\(\[this\.flushBrowserData\('quit'\), clipboardCleared\]\)/.test(main), 'clipboard cleared before quitting');
    assert(read('preload-internal.js').includes("'passwords:copy'"));
  });

  await test('Settings page: nothing keeps a revealed password in a variable, it hides after the time the browser names / when the page is left, copy asks the browser', () => {
    const js = read('pages', 'settings.js');
    const rows = js.slice(js.indexOf('function renderPasswords'), js.indexOf('btnEdit.addEventListener'));
    assert(!/revealedPlaintext/.test(js), 'no variable for the plain password');
    assert(/setTimeout\(hide, Number\(res\.hideAfterMs\) > 0/.test(rows) && /shownPasswordHiders\.add\(hide\)/.test(rows));
    assert(/visibilitychange/.test(js) && /addEventListener\('blur', hideAllShownPasswords\)/.test(js) && /addEventListener\('pagehide'/.test(js));
    assert(/hideAllShownPasswords\(\);\s*passwordsList\.innerHTML = ''/.test(js), 'a redraw hides everything');
    assert(/window\.mtcAPI\.copyPassword\(item\.id\)/.test(rows) && !/navigator\.clipboard\.writeText\(pass/.test(rows), 'copy goes through the browser');
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

main();
