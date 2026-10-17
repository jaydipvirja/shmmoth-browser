/**
 * SHMMOTH as the default browser on Windows: the installer registers it, Settings shows the status and opens
 * Windows' Default apps page. Run: node tests/p6-default-browser.test.js
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
const db = require(path.join(ROOT, 'src', 'services', 'defaultBrowser.js'));

// a stand-in for reg.exe: answers from a table { 'KEY|value': data }
function fakeReg(table) {
  return (cmd, args, opts, cb) => {
    const key = `${args[1]}|${args[3]}`;
    if (!(key in table)) return cb(new Error('ERROR: The system was unable to find the specified registry key or value.'), '');
    cb(null, `\r\n${args[1]}\r\n    ${args[3]}    REG_SZ    ${table[key]}\r\n\r\n`);
  };
}
const APPS_HKCU = 'HKCU\\Software\\RegisteredApplications|SHMMOTH Browser';
const APPS_HKLM = 'HKLM\\Software\\RegisteredApplications|SHMMOTH Browser';
const CHOICE = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice|ProgId';
const CAPS = 'Software\\Clients\\StartMenuInternet\\SHMMOTH Browser\\Capabilities';

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — default browser');
  console.log('══════════════════════════════════════════════════════\n');

  await test('reads a value out of reg.exe output (names with spaces, any type)', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\RegisteredApplications\r\n    SHMMOTH Browser    REG_SZ    ' + CAPS + '\r\n    Other    REG_EXPAND_SZ    x\r\n';
    assert(db.parseRegValue(out, 'SHMMOTH Browser') === CAPS);
    assert(db.parseRegValue(out, 'shmmoth browser') === CAPS, 'value names are not case sensitive');
    assert(db.parseRegValue(out, 'Missing') === null && db.parseRegValue('', 'x') === null);
  });

  await test('status: default, registered only, machine-wide, not installed, not Windows', async () => {
    let s = await db.getStatus({ platform: 'win32', run: fakeReg({ [APPS_HKCU]: CAPS, [CHOICE]: 'SHMMOTHURL' }) });
    assert(s.supported && s.registered && s.scope === 'user' && s.isDefault, JSON.stringify(s));
    s = await db.getStatus({ platform: 'win32', run: fakeReg({ [APPS_HKCU]: CAPS, [CHOICE]: 'ChromeHTML' }) });
    assert(s.registered && !s.isDefault, JSON.stringify(s));
    s = await db.getStatus({ platform: 'win32', run: fakeReg({ [APPS_HKLM]: CAPS }) });
    assert(s.registered && s.scope === 'machine' && !s.isDefault, JSON.stringify(s));
    s = await db.getStatus({ platform: 'win32', run: fakeReg({}) });
    assert(s.supported && !s.registered && s.scope === null, JSON.stringify(s));
    let called = false;
    s = await db.getStatus({ platform: 'linux', run: () => { called = true; } });
    assert(!s.supported && !called, 'nothing is run off Windows');
  });

  await test("Windows' Default apps page opens at SHMMOTH's entry (user or machine installation)", () => {
    assert(db.settingsUrl('user') === 'ms-settings:defaultapps?registeredAppUser=SHMMOTH%20Browser');
    assert(db.settingsUrl('machine') === 'ms-settings:defaultapps?registeredAppMachine=SHMMOTH%20Browser');
  });

  await test('the installer registers a browser for http and https and removes it on uninstall', () => {
    const nsh = read('build', 'installer.nsh');
    assert(JSON.parse(read('package.json')).build.nsis.include === 'build/installer.nsh', 'package.json includes the script');
    for (const line of [
      'WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\\Capabilities\\URLAssociations" "http" "${SHMMOTH_PROGID}"',
      'WriteRegStr SHCTX "${SHMMOTH_CLIENT_KEY}\\Capabilities\\URLAssociations" "https" "${SHMMOTH_PROGID}"',
      'WriteRegStr SHCTX "Software\\RegisteredApplications" "${SHMMOTH_CLIENT}" "${SHMMOTH_CLIENT_KEY}\\Capabilities"',
      'DeleteRegKey SHCTX "${SHMMOTH_CLIENT_KEY}"',
      'DeleteRegValue SHCTX "Software\\RegisteredApplications" "${SHMMOTH_CLIENT}"',
      'DeleteRegKey SHCTX "Software\\Classes\\${SHMMOTH_PROGID}"'
    ]) assert(nsh.includes(line), 'missing: ' + line);
    assert(/!define SHMMOTH_PROGID "SHMMOTHURL"/.test(nsh) && db.PROG_ID === 'SHMMOTHURL', 'the same link handler name in the installer and the app');
    assert(/!define SHMMOTH_CLIENT "SHMMOTH Browser"/.test(nsh) && db.CLIENT === 'SHMMOTH Browser');
  });

  await test('a link reaches the browser after "--", so it can never be read as a command-line switch', () => {
    const nsh = read('build', 'installer.nsh');
    assert(nsh.includes(`shell\\open\\command" "" '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" -- "%1"'`), 'link command');
    const { urlsFromArgv } = require(path.join(ROOT, 'src', 'utils', 'launchArgs.js'));
    const urls = urlsFromArgv(['C:\\SHMMOTH Browser.exe', '--', 'https://example.com/a b']);
    assert(urls.length === 1 && urls[0] === 'https://example.com/a%20b', JSON.stringify(urls));
    assert(urlsFromArgv(['x.exe', '--', '--remote-debugging-port=9222', 'javascript:alert(1)', 'file:///C:/x']).length === 0, 'only http(s) links');
  });

  await test('the app only reads the status and opens a fixed Windows page; Settings shows it', () => {
    const ipc = read('src', 'browser', 'ipc.js');
    assert(/ipcMain\.handle\('defaultBrowser:status', secureHandlerRaw\(\(\) => defaultBrowser\.getStatus\(\)\)\)/.test(ipc));
    assert(/shell\.openExternal\(defaultBrowser\.settingsUrl\(status\.scope\)\)/.test(ipc) && /if \(!status\.supported \|\| !status\.registered\) return false;/.test(ipc));
    assert(!/execFile\([^)]*\$\{/.test(read('src', 'services', 'defaultBrowser.js')), 'reg.exe gets fixed arguments');
    assert(/getDefaultBrowserStatus/.test(read('src', 'preload-internal.js')) && /openDefaultBrowserSettings/.test(read('src', 'preload-internal.js')));
    const html = read('src', 'pages', 'settings.html');
    assert(/id="row-default-browser"/.test(html) && /id="btn-make-default" class="btn-primary hidden"/.test(html));
    assert(/window\.addEventListener\('focus', refreshDefaultBrowser\)/.test(read('src', 'pages', 'settings.js')), 'checks again after Windows Settings');
  });

  await test('CI builds and tries the installer on every change', () => {
    const ci = read('.github', 'workflows', 'ci.yml');
    assert(/installer-windows:[\s\S]*electron-builder --win nsis --x64 --publish never[\s\S]*smoke-installer\.js/.test(ci));
    const smoke = read('scripts', 'smoke-installer.js');
    assert(/checkRegistration\(exe\)/.test(smoke) && /\[\.\.\.flags, '--', link\]/.test(smoke) && /left the browser registration behind/.test(smoke));
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

main();
