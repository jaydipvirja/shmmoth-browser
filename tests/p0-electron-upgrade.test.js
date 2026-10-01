/**
 * SHMMOTH BROWSER — ELECTRON UPGRADE COMPATIBILITY TESTS
 *
 * Guards the code changes that were needed (or are prudent) when moving from Electron 33 to a
 * current release, so they are not silently undone:
 *   - extensions go through `session.extensions.*` when it exists (old session.loadExtension is deprecated)
 *   - the console-message listener reads `event.message` and keeps its `this` binding
 *   - UA / Client-Hints versions follow the running Chromium instead of a hard-coded number
 *
 * Run with: node tests/p0-electron-upgrade.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

const SRC = path.join(__dirname, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_p0_upg_'));
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') return { app: { getPath: () => ROOT, quit() {} }, dialog: {} };
  return origLoad.call(this, request, ...args);
};
const ExtensionManager = require('../src/services/extensionManager');

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Electron Upgrade Compatibility     ');
  console.log('══════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('📋 1. Extensions API (session.extensions.*)');
  // ═══════════════════════════════════════════════════════════════════════════

  const EXT_DIR = path.join(__dirname, 'fixtures', 'extensions', 'extension-a-mv3');

  function fakeExtensionHost(calls, tag) {
    return {
      async loadExtension(p) { calls.push(tag + ':loadExtension'); return { id: 'a'.repeat(32), name: 'x', version: '1', path: p, manifest: {} }; },
      async removeExtension(id) { calls.push(tag + ':removeExtension'); },
      getAllExtensions() { return []; }
    };
  }

  await test('modern Electron: loadExtension/removeExtension go through session.extensions (the deprecated session methods are not used)', async () => {
    const calls = [];
    const session = Object.assign(fakeExtensionHost(calls, 'session'), { extensions: fakeExtensionHost(calls, 'extensions') });
    const mgr = new ExtensionManager(path.join(ROOT, 'u1'));
    const rec = await mgr.installUnpacked(EXT_DIR, { enabled: true });
    assert(await mgr.loadIntoSession(session, rec.id), 'extension should load');
    assert(await mgr.unloadFromSession(session, rec.id));
    assert(calls.join() === 'extensions:loadExtension,extensions:removeExtension', calls.join());
  });

  await test('older Electron / minimal fakes without session.extensions still work', async () => {
    const calls = [];
    const session = fakeExtensionHost(calls, 'session');
    const mgr = new ExtensionManager(path.join(ROOT, 'u2'));
    const rec = await mgr.installUnpacked(EXT_DIR, { enabled: true });
    assert(await mgr.loadIntoSession(session, rec.id));
    assert(await mgr.unloadFromSession(session, rec.id));
    assert(calls.join() === 'session:loadExtension,session:removeExtension', calls.join());
  });

  await test('no direct call to the deprecated session.loadExtension / removeExtension remains', async () => {
    for (const f of ['services/extensionManager.js', 'main.js']) {
      const code = stripComments(read(f));
      assert(!/sessionInstance\.(loadExtension|removeExtension)\(/.test(code), `${f} calls the deprecated session API directly`);
      assert(!/session\.(defaultSession\.)?(loadExtension|removeExtension)\(/.test(code), `${f} calls the deprecated session API directly`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 2. console-message listener (login capture)');
  // ═══════════════════════════════════════════════════════════════════════════

  const main = read('main.js');

  await test('listener reads the new details object (event.message), declares one parameter, and keeps the app binding', async () => {
    const m = /wc\.on\('console-message', function (\w+)\(([^)]*)\) \{([\s\S]*?)\n    \}\);/.exec(main);
    assert(m, 'console-message listener not found in the expected form');
    assert(!m[2].includes(','), 'declaring positional parameters triggers an Electron deprecation warning: ' + m[2]);
    assert(/event\.message/.test(m[3]), 'must read event.message');
    assert(/arguments\[2\]/.test(m[3]), 'must keep the legacy fallback for older runtimes');
    assert(!/\bthis\./.test(m[3]), '`this` inside a plain function is the WebContents, not the app (login capture silently broke once)');
    assert(/const browserApp = this;/.test(main) && /browserApp\.offerPasswordSave/.test(m[3]));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 3. User-Agent / Client Hints follow the running Chromium');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('no hard-coded Chrome/130 (or v="130") anywhere in the shipped code', async () => {
    for (const f of ['main.js', 'preload-internal.js', 'preload-external.js', 'services/turboDownloadEngine.js']) {
      const code = stripComments(read(f));
      assert(!/Chrome\/130/.test(code), `${f} still hard-codes Chrome/130`);
      assert(!/v="130"/.test(code), `${f} still hard-codes v="130"`);
    }
  });

  await test('main.js derives the Chrome major from process.versions.chrome and uses it for the UA and sec-ch-ua', async () => {
    assert(/CHROME_MAJOR\s*=\s*String\(\(process\.versions && process\.versions\.chrome\)/.test(main));
    assert(/GOOGLE_AUTH_UA\s*=\s*`[^`]*\$\{CHROME_REDUCED\}/.test(main));
    assert(/"Chromium";v="\$\{CHROME_MAJOR\}"/.test(main));
  });

  await test('preloads fall back to the runtime version (not a constant) when the UA has no Chrome token', async () => {
    for (const f of ['preload-internal.js', 'preload-external.js']) {
      const src = read(f);
      assert(/FALLBACK_CHROME_MAJOR/.test(src) && /process\.versions\.chrome/.test(src), f);
    }
  });

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
})();
