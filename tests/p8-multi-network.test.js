/**
 * Multi-network downloads (1.4.5): the setup check of Settings → Downloads, and the wiring of the engine's note.
 * (The engine itself: tests/turbo-download-engine.test.js 7–9.) Run: node tests/p8-multi-network.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const check = require('../src/services/multiNetworkCheck');

const wifi = { name: 'Wi-Fi', address: '192.168.1.20', isVirtual: false, isOnline: true };
const usb = { name: 'Ethernet 3', address: '192.168.42.7', isVirtual: false, isOnline: true };
const vpn = { name: 'WireGuard Tunnel', address: '10.6.0.2', isVirtual: true, isOnline: true };
const byId = (r, id) => r.checks.find((c) => c.id === id);

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — multi-network downloads');
  console.log('══════════════════════════════════════════════════════\n');

  await test('two working connections, nothing in the way, Windows keeps both: all green', () => {
    const r = check.evaluate({ interfaces: [wifi, usb], platform: 'win32', policy: 0 });
    assert(r.verdict === 'ok', JSON.stringify(r));
    assert(/2 internet connections/.test(byId(r, 'networks').title) && /Wi-Fi \(192\.168\.1\.20\)/.test(byId(r, 'networks').detail));
  });

  await test('one connection: says so, and how to add the second (cable or USB tethering)', () => {
    const r = check.evaluate({ interfaces: [wifi, { ...usb, isOnline: false }], platform: 'win32', policy: 0 });
    const n = byId(r, 'networks');
    assert(r.verdict === 'fail' && n.status === 'fail' && /Only one/.test(n.title), JSON.stringify(n));
    assert(/USB tethering/.test(n.detail) && /without internet: Ethernet 3/.test(n.detail), n.detail);
  });

  await test('VPN, proxy and the switches in Settings are named', () => {
    const r = check.evaluate({ interfaces: [wifi, usb, vpn], platform: 'linux', proxyActive: true, multiOn: false });
    assert(byId(r, 'vpn').status === 'warn' && /WireGuard/.test(byId(r, 'vpn').detail));
    assert(byId(r, 'proxy').status === 'fail' && byId(r, 'settings').status === 'fail');
    assert(!byId(r, 'windows'), 'the Windows policy is only checked on Windows');
  });

  await test('the Windows policy: 0 fine, 3 blocks Wi-Fi with a cable, not set = may drop one; the fix is one command', () => {
    assert(byId(check.evaluate({ interfaces: [wifi, usb], platform: 'win32', policy: 0 }), 'windows').status === 'ok');
    const three = byId(check.evaluate({ interfaces: [wifi, usb], platform: 'win32', policy: 3 }), 'windows');
    assert(three.status === 'fail' && /Prevent Wi-Fi when on Ethernet/.test(three.detail));
    const unset = byId(check.evaluate({ interfaces: [wifi, usb], platform: 'win32', policy: null }), 'windows');
    assert(unset.status === 'warn' && unset.detail.includes(check.POLICY_FIX));
    assert(check.POLICY_FIX === 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WcmSvc\\GroupPolicy" /v fMinimizeConnections /t REG_DWORD /d 0 /f');
  });

  await test('reading the policy: reg.exe with fixed arguments, the DWORD parsed, missing = null, never off Windows', async () => {
    let args = null;
    const run = (cmd, a, o, cb) => { args = [cmd, ...a]; cb(null, '\r\nHKEY_LOCAL_MACHINE\\...\\GroupPolicy\r\n    fMinimizeConnections    REG_DWORD    0x3\r\n'); };
    assert(await check.readMinimizePolicy({ platform: 'win32', run }) === 3);
    assert(JSON.stringify(args) === JSON.stringify(['reg', 'query', check.POLICY_KEY, '/v', 'fMinimizeConnections']));
    assert(await check.readMinimizePolicy({ platform: 'win32', run: (c, a, o, cb) => cb(new Error('not found'), '') }) === null);
    let called = false;
    assert(await check.readMinimizePolicy({ platform: 'linux', run: () => { called = true; } }) === null && !called);
  });

  await test('wired up: the engine tries Node when Chromium won the probe, the note reaches the Downloads page, Settings has the check', () => {
    const engine = read('src', 'services', 'turboDownloadEngine.js');
    assert(/} else if \(transport === 'chromium'\) \{\s*\n\s*const viaNode = await this\._probeOnce\(finalUrl, headers, \{ transport: 'node'/.test(engine));
    assert(/record\.networkNote = prog\.networkNote \|\| '';/.test(read('src', 'services', 'downloadManager.js')));
    assert(/NETWORK_NOTES\[record\.networkNote\]/.test(read('src', 'pages', 'downloads.js')));
    assert(/ipcMain\.handle\('download:multiNetworkCheck'/.test(read('src', 'browser', 'ipc.js')) && /checkMultiNetwork/.test(read('src', 'preload-internal.js')));
    assert(/id="btn-multi-check"/.test(read('src', 'pages', 'settings.html')) && !/innerHTML/.test(read('src', 'pages', 'settings.js').slice(read('src', 'pages', 'settings.js').indexOf('CHECK_ICONS'), read('src', 'pages', 'settings.js').indexOf('// Windows 11 Mica'))), 'results built with textContent');
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

main();
