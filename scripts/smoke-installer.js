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
 * Passes when: the app is installed with its asar, carries the production Electron fuses, starts with a throw-away
 * profile, writes its start-up session (so the window and the first tab came up) and is still running seconds later.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
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
  log('▶ first start');
  const child = spawn(exe, flags, { stdio: 'ignore', windowsHide: false });
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

  // 3. and it keeps running
  await sleep(6000);
  if (exited) fail(`the app quit by itself after start-up (code ${exited.code}, signal ${exited.signal})`);
  log('✔ still running after 6 s');
  killTree(child);
  await sleep(1500);

  // 4. uninstall (a problem here is reported, not fatal)
  if (installDir) {
    const un = fs.readdirSync(installDir).find((f) => /^uninstall.*\.exe$/i.test(f));
    if (!un) {
      console.warn('⚠ no uninstaller found in the install folder');
    } else {
      const r = spawnSync(path.join(installDir, un), ['/S', `_?=${installDir}`], { windowsHide: true, timeout: 3 * 60 * 1000 });
      console.log(r.status === 0 ? '✔ uninstalled' : `⚠ the uninstaller returned ${r.status}`);
    }
  }
  fs.rmSync(profile, { recursive: true, force: true });
  log('\n✔ Installer smoke test passed\n');
}

main().catch((err) => { if (!process.exitCode) { console.error(err); process.exitCode = 1; } });
