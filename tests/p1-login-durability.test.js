/**
 * SHMMOTH BROWSER — logins must survive the browser being ended
 *
 * Chromium writes cookies to disk in batches (about every 30 s). Ended the hard way (the update installer closes the
 * browser, Task Manager, a crash) the last batch is lost, and Google — which renews its session cookies every few
 * minutes and refuses the old ones — signs the user out after the restart. (Measured: a cookie set 3–10 s before a kill
 * was gone in 6 of 6 runs.)
 *
 * The real-app behaviour is covered by tests/e2e/14-login-durability.e2e.js; this file checks the pieces that cannot be
 * driven from there: the update path and the wiring in main.js.
 *
 * Run: node tests/p1-login-durability.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(a === b, `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_login_'));
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return { app: { getVersion: () => '1.0.0', getPath: () => tmp, quit() {} }, shell: { openPath: async () => '' }, net: {} };
  }
  return origLoad.call(this, request, ...rest);
};
const { UpdateManager } = (() => { const m = require('../src/services/updateManager'); return { UpdateManager: m.UpdateManager || m }; })();

function verifiedFile(content = 'installer') {
  const file = path.join(tmp, `setup-${Math.random().toString(36).slice(2)}.exe`);
  fs.writeFileSync(file, content);
  const buf = fs.readFileSync(file);
  return { path: file, version: '9.9.9', assetName: 'x.exe', sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
}

async function main() {
  console.log('\n── The update path: cookies are written before the installer starts ──');

  await test('the browser prepares (writes cookies/storage to disk) BEFORE the installer is launched', async () => {
    const order = [];
    const um = new UpdateManager({
      prepareToQuit: async () => { await new Promise((r) => setTimeout(r, 30)); order.push('prepare'); },
      launcher: async () => { order.push('launch'); return ''; },
      quitApp: () => order.push('quit')
    });
    um.verifiedUpdate = verifiedFile();
    eq(await um._installVerified(), true);
    eq(order.slice(0, 2).join(), 'prepare,launch');
  });

  await test('…and a failing or very slow preparation never blocks the update', async () => {
    const order = [];
    const um = new UpdateManager({
      prepareToQuit: async () => { throw new Error('disk full'); },
      launcher: async () => { order.push('launch'); return ''; },
      quitApp: () => {}
    });
    um.verifiedUpdate = verifiedFile();
    eq(await um._installVerified(), true);
    eq(order.join(), 'launch');
  });

  console.log('\n── main.js ──');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  await test('quitting writes cookies and page storage first, then really quits (with a time limit)', async () => {
    const block = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf('this.setupLoginDurability()'));
    assert(block.includes('event.preventDefault()') && block.includes("flushBrowserData('quit')"), 'before-quit must flush');
    assert(/setTimeout\(resolve, 3000\)/.test(block), 'the flush must have a time limit, a quit must never hang');
    assert(block.includes('app.quit()') && block.includes('_dataFlushed'), 'it quits again afterwards and does not loop');
  });

  await test('Google authentication uses one stable desktop browser identity', async () => {
    assert(/const GOOGLE_AUTH_UA = DESKTOP_UA_FALLBACK;/.test(main), 'Google auth UA must match the desktop fallback');
    const headersBlock = main.slice(main.indexOf('setupGoogleAuthHeaders(targetSession)'), main.indexOf('// ─── Content Permissions', main.indexOf('setupGoogleAuthHeaders(targetSession)')));
    assert(!/sec-ch-ua-mobile.*\?1/.test(headersBlock), 'Google headers must not switch to mobile');
    assert(!/Android/.test(headersBlock), 'Google headers must not switch to Android');
    assert(/headers\['User-Agent'\] = ua;/.test(headersBlock), 'Google service requests use the same clean UA');
  });

  await test('cookie changes are written shortly after they happen, for the normal profile only', async () => {
    const body = main.slice(main.indexOf('setupLoginDurability() {'), main.indexOf('async logLoginHealth'));
    assert(body.includes("session.defaultSession.cookies.on('changed'"), 'watches cookie changes');
    assert(!/fromPartition/.test(body), 'incognito stays in memory');
    const flush = main.slice(main.indexOf('async flushBrowserData'), main.indexOf('setupLoginDurability() {'));
    assert(flush.includes('cookies.flushStore()') && flush.includes('flushStorageData()'), 'cookies and page storage are flushed');
  });

  await test('the update manager is given the flush', async () => {
    assert(/new UpdateManager\(\{[\s\S]*?prepareToQuit:[\s\S]*?flushBrowserData\('quit'\)/.test(main), 'prepareToQuit wired in main.js');
  });

  await test('the log never contains cookie values (only names and counts)', async () => {
    const body = main.slice(main.indexOf('async logLoginHealth'), main.indexOf('_finalizeSession() {'));
    assert(!/\.value/.test(body), 'cookie values must not be logged');
  });

  console.log(`\n  p1-login-durability: ${passed} passed, ${failed} failed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
