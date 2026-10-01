/**
 * P0 — process hardening: Electron fuses, single instance, command-line URLs.
 * Run: node tests/p0-hardening.test.js
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

const ROOT = path.join(__dirname, '..');
const pkg  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const mainJs = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — P0 Process Hardening Tests         ');
console.log('══════════════════════════════════════════════════════\n');

console.log('📋 1. Electron fuses (package.json → build.electronFuses)');
{
  const fuses = (pkg.build && pkg.build.electronFuses) || {};

  test('ELECTRON_RUN_AS_NODE is disabled (the signed binary cannot be turned into a plain Node interpreter)', () => assert(fuses.runAsNode === false));
  test('NODE_OPTIONS / NODE_EXTRA_CA_CERTS are ignored', () => assert(fuses.enableNodeOptionsEnvironmentVariable === false));
  test('--inspect and friends are ignored (no debugger attach to a shipped build)', () => assert(fuses.enableNodeCliInspectArguments === false));
  test('the app is only loaded from app.asar and its integrity is validated', () => {
    assert(fuses.onlyLoadAppFromAsar === true && fuses.enableEmbeddedAsarIntegrityValidation === true);
  });
  test('nothing in the app depends on ELECTRON_RUN_AS_NODE (child_process.fork / utilityProcess)', () => {
    const offenders = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js') && /\bfork\(|ELECTRON_RUN_AS_NODE|utilityProcess/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(ROOT, p));
      }
    })(path.join(ROOT, 'src'));
    assert(offenders.length === 0, offenders.join());
  });
  test('the browser chrome still loads from file:// so grantFileProtocolExtraPrivileges must NOT be switched off (packaged build cannot load it otherwise)', () => {
    assert(!('grantFileProtocolExtraPrivileges' in fuses) || fuses.grantFileProtocolExtraPrivileges === true);
    assert(/loadFile\(path\.join\(__dirname, 'renderer', 'index\.html'\)\)/.test(mainJs));
  });
  test('the packaged-test runner only turns the inspect fuse back on', () => {
    const runner = fs.readFileSync(path.join(__dirname, 'run-all.js'), 'utf8');
    assert(/-c\.electronFuses\.enableNodeCliInspectArguments=/.test(runner));
    assert(/--ignore=enableNodeCliInspectArguments/.test(runner), 'the other fuses must be verified on the test build');
    assert(!/-c\.electronFuses\.(runAsNode|onlyLoadAppFromAsar|enableNodeOptionsEnvironmentVariable)/.test(runner));
  });

  const { compareFuses } = require('../scripts/check-fuses');
  test('check-fuses: matching binary passes, wrong or unknown fuses are reported, --ignore skips a fuse', () => {
    const want = { runAsNode: false, onlyLoadAppFromAsar: true, enableNodeCliInspectArguments: false };
    assert(compareFuses(want, { runAsNode: false, onlyLoadAppFromAsar: true, enableNodeCliInspectArguments: false }).ok);
    const bad = compareFuses(want, { runAsNode: true, onlyLoadAppFromAsar: true, enableNodeCliInspectArguments: true });
    assert(!bad.ok && bad.problems.length === 2 && /runAsNode/.test(bad.problems[0]));
    assert(compareFuses(want, { runAsNode: false, onlyLoadAppFromAsar: true, enableNodeCliInspectArguments: true }, { ignore: ['enableNodeCliInspectArguments'] }).ok);
    assert(!compareFuses({ somethingNew: true }, { runAsNode: false }).ok, 'unknown fuse must not pass silently');
  });
}

console.log('\n📋 2. Single instance');
{
  test('main.js takes the single-instance lock before init() and quits when it is not granted', () => {
    const lock = mainJs.indexOf('app.requestSingleInstanceLock()');
    const init = mainJs.indexOf('shmmothApp.init()');
    assert(lock > 0 && init > lock, 'lock must be requested before init()');
    assert(/if \(!app\.requestSingleInstanceLock\(\)\) \{[\s\S]{0,200}app\.quit\(\)/.test(mainJs));
  });
  test("a 'second-instance' handler is registered and only reads URLs through urlsFromArgv", () => {
    assert(/app\.on\('second-instance', \(_event, argv\) => shmmothApp\.handleSecondInstance\(argv\)\)/.test(mainJs));
    const handler = mainJs.slice(mainJs.indexOf('handleSecondInstance(argv) {'), mainJs.indexOf('// ─── Proxy / network privacy'));
    assert(/urlsFromArgv\(argv\)/.test(handler) && !/loadURL|loadFile|shell\./.test(handler));
  });
}

console.log('\n📋 3. Command-line URLs');
{
  const { urlsFromArgv, MAX_URLS } = require('../src/utils/launchArgs');

  test('web addresses are accepted, normalised and de-duplicated', () => {
    assert(urlsFromArgv(['x', 'https://example.com/a b', 'https://example.com/a%20b', 'http://[::1]:8080/']).join() === 'https://example.com/a%20b,http://[::1]:8080/');
  });
  test('flags, file paths, file:// and internal / script URLs are ignored', () => {
    const r = urlsFromArgv(['C:\\Program Files\\SHMMOTH\\shmmoth.exe', '.', '--user-data-dir=/x', '-r', 'file:///etc/passwd', 'mtc://settings',
      'javascript:alert(1)', 'data:text/html,<b>x</b>', 'chrome-extension://abc/popup.html', 'C:\\Users\\me\\page.html', '\\\\server\\share\\a.html', '/home/me/a.html']);
    assert(r.length === 0, r.join());
  });
  test('garbage input never throws', () => {
    assert(urlsFromArgv(undefined).length === 0 && urlsFromArgv([null, 5, {}, '']).length === 0);
  });
  test('the number and length of URLs is bounded', () => {
    const many = Array.from({ length: 50 }, (_, i) => `https://example.com/${i}`);
    assert(urlsFromArgv(many).length === MAX_URLS);
    assert(urlsFromArgv(['https://example.com/' + 'a'.repeat(9000)]).length === 0);
  });
}

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
