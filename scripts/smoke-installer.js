#!/usr/bin/env node
/**
 * INSTALLER SMOKE TEST — scripts/smoke-installer.js
 *
 * Checks the thing users actually receive. The E2E suites drive a test build (one Electron fuse differs because
 * Playwright needs it); this installs the real installer and starts the real, production-fused app once.
 *
 *   node scripts/smoke-installer.js dist/SHMMOTH-Browser-Setup-1.1.0.exe     silent install → start → check → uninstall (Windows)
 *   node scripts/smoke-installer.js --exe path/to/SHMMOTH\ Browser.exe        skip the installer, test this binary (any OS)
 *
 * Passes when: the app is installed with its asar, carries the production Electron fuses, is registered with Windows
 * as a browser (build/installer.nsh), starts with a throw-away profile from a link the way Windows hands one over
 * ("exe" -- "<url>"), writes its start-up session with that link as its tab, is still running seconds later, and the
 * uninstaller removes the registration again.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const { compareFuses, readFuses } = require('./check-fuses');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);
function fail(msg) { console.error(`\n✖ ${msg}\n`); process.exitCode = 1; throw new Error(msg); }

function killTree(child) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch (_) { /* already gone */ }
}

// ─── Windows registration as a browser (build/installer.nsh) ────────────────
function regValue(key, value) {
  const args = value === null ? ['query', key, '/ve'] : ['query', key, '/v', value];
  const r = spawnSync('reg', args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const line = r.stdout.split(/\r?\n/).find((l) => /\sREG_[A-Z_]+\s/.test(l));
  return line ? line.replace(/^\s*.*?\s+REG_[A-Z_]+\s+/, '').trim() : '';
}

function checkRegistration(exe) {
  const caps = regValue('HKCU\\Software\\RegisteredApplications', 'SHMMOTH Browser');
  if (!caps || !/StartMenuInternet\\SHMMOTH Browser\\Capabilities$/.test(caps)) fail(`not registered as a browser (RegisteredApplications: ${caps})`);
  const https = regValue('HKCU\\' + caps + '\\URLAssociations', 'https');
  if (https !== 'SHMMOTHURL') fail(`https is not offered for SHMMOTH (URLAssociations\\https: ${https})`);
  const command = regValue('HKCU\\Software\\Classes\\SHMMOTHURL\\shell\\open\\command', null);
  // "<install dir>\SHMMOTH Browser.exe" -- "%1"  (the folder may be written as a short 8.3 path; compare the file)
  const m = /^"([^"]+)" -- "%1"$/.exec(command || '');
  if (!m || !fs.existsSync(m[1]) || fs.realpathSync(m[1]).toLowerCase() !== fs.realpathSync(exe).toLowerCase()) fail(`unexpected link command: ${command}`);
  log('✔ registered with Windows as a browser for http and https; links are passed after "--"');
  return command;
}

function install(installer, dir) {
  log(`▶ silent install → ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const r = spawnSync(installer, ['/S', `/D=${dir}`], { windowsHide: true, timeout: 5 * 60 * 1000 });
  if (r.error || r.status !== 0) fail(`the installer did not finish cleanly (status ${r.status}${r.error ? ', ' + r.error.message : ''})`);
  const exes = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.exe$/i.test(f) && !/uninstall/i.test(f)) : [];
  if (exes.length === 0) fail(`nothing was installed in ${dir}`);
  return { exe: path.join(dir, exes[0]), appDir: dir };
}

async function main() {
  const args = process.argv.slice(2);
  const exeFlag = args.indexOf('--exe');
  let exe; let installDir = null;
  if (exeFlag >= 0) {
    exe = path.resolve(args[exeFlag + 1] || '');
  } else {
    const installer = args.find((a) => !a.startsWith('--'));
    if (!installer) { console.error('usage: smoke-installer.js <installer.exe> | --exe <app binary>'); process.exit(2); }
    if (process.platform !== 'win32') { console.error('Installing the NSIS installer needs Windows; use --exe on other systems.'); process.exit(2); }
    installDir = path.join(os.tmpdir(), 'shmmoth-smoke-install');
    exe = install(path.resolve(installer), installDir).exe;
  }
  if (!fs.existsSync(exe)) fail(`not found: ${exe}`);
  log(`  app: ${exe}`);

  // 1. the shipped app is packed and fused as configured
  const resources = path.join(path.dirname(exe), 'resources');
  if (!fs.existsSync(path.join(resources, 'app.asar'))) fail(`resources/app.asar is missing next to ${exe}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const fuses = compareFuses((pkg.build && pkg.build.electronFuses) || {}, await readFuses(exe));
  if (!fuses.ok) fail('Electron fuses differ from package.json:\n  ' + fuses.problems.join('\n  '));
  log(`✔ app.asar present, ${fuses.checked.length} production fuses set`);

  // 2. it starts with a throw-away profile and brings up its first tab
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth-smoke-profile-'));
  const flags = [`--user-data-dir=${profile}`, '--disable-gpu'];
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) flags.push('--no-sandbox');
  if (installDir) checkRegistration(exe);

  // started the way Windows opens a link: the address after "--" (a local page, nothing leaves the machine)
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>smoke</title>ok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const link = `http://127.0.0.1:${server.address().port}/from-a-link`;
  log('▶ first start, from a link');
  const child = spawn(exe, [...flags, '--', link], { stdio: 'ignore', windowsHide: false });
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });

  const sessionFile = path.join(profile, 'shmmoth-session.json');
  const started = Date.now();
  let session = null;
  while (Date.now() - started < 60000) {
    if (exited) fail(`the app exited during start-up (code ${exited.code}, signal ${exited.signal})`);
    try {
      const s = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      if (Array.isArray(s.tabs) && s.tabs.length >= 1) { session = s; break; }
    } catch (_) { /* not written yet */ }
    await sleep(500);
  }
  if (!session) { killTree(child); fail('no start-up session was written within 60 s (the window / first tab did not come up)'); }
  log(`✔ started in ${((Date.now() - started) / 1000).toFixed(1)} s, first tab: ${session.tabs[0].url}`);
  if (!session.tabs.some((t) => t.url === link)) { killTree(child); fail(`the link did not open in a tab (tabs: ${session.tabs.map((t) => t.url).join(', ')})`); }
  log('✔ the link opened in a tab');

  // 3. and it keeps running
  await sleep(6000);
  if (exited) fail(`the app quit by itself after start-up (code ${exited.code}, signal ${exited.signal})`);
  log('✔ still running after 6 s');
  killTree(child);
  server.close();
  await sleep(1500);

  // 4. uninstall (a problem here is reported, not fatal)
  if (installDir) {
    const un = fs.readdirSync(installDir).find((f) => /^uninstall.*\.exe$/i.test(f));
    if (!un) {
      console.warn('⚠ no uninstaller found in the install folder');
    } else {
      const r = spawnSync(path.join(installDir, un), ['/S', `_?=${installDir}`], { windowsHide: true, timeout: 3 * 60 * 1000 });
      console.log(r.status === 0 ? '✔ uninstalled' : `⚠ the uninstaller returned ${r.status}`);
      if (regValue('HKCU\\Software\\RegisteredApplications', 'SHMMOTH Browser') !== null) fail('the uninstaller left the browser registration behind');
      if (regValue('HKCU\\Software\\Classes\\SHMMOTHURL\\shell\\open\\command', null) !== null) fail('the uninstaller left the link handler behind');
      log('✔ browser registration removed');
    }
  }
  fs.rmSync(profile, { recursive: true, force: true });
  log('\n✔ Installer smoke test passed\n');
}

main().catch((err) => { if (!process.exitCode) { console.error(err); process.exitCode = 1; } });
