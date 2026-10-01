#!/usr/bin/env node
/**
 * TEST RUNNER — tests/run-all.js
 *
 *   npm test                    unit tests (plain Node, Electron is mocked)          ~20 s
 *   npm run test:e2e            end-to-end tests against the real app (Playwright)    ~3 min
 *   npm run test:e2e:packaged   same security/UI scenarios against an electron-builder --dir build
 *   npm run test:all            both
 *
 * Options: --unit  --e2e  --packaged  --no-build  --grep=<text>  --list
 *
 * Linux needs a display for the E2E tests: if none is set the runner re-launches itself under xvfb-run.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const grep = (argv.find((a) => a.startsWith('--grep=')) || '').slice(7).toLowerCase();

const wantUnit = has('--unit') || has('--all') || (!has('--e2e') && !has('--packaged'));
const wantE2e = has('--e2e') || has('--all') || has('--packaged');
const packaged = has('--packaged');

// Electron-run scripts that talk to live services (kept for manual use, not part of the automated suite)
const UNIT_EXCLUDE = new Set(['google-login-verification.test.js']);
// E2E suites that make sense against a packaged build (05 drives the raw Electron binary with a fixture app)
// the one fuse the test build turns back on (see the build step below)
const TEST_BUILD_FUSE_OVERRIDE = 'true';
const PACKAGED_E2E = /^(0[1-46789]|1[01])-/;

const unitTests = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && !UNIT_EXCLUDE.has(f)).sort();
const e2eTests = fs.readdirSync(path.join(__dirname, 'e2e')).filter((f) => f.endsWith('.e2e.js')).sort()
  .filter((f) => !packaged || PACKAGED_E2E.test(f));

const selected = (list) => list.filter((f) => !grep || f.toLowerCase().includes(grep));

if (has('--list')) {
  console.log('unit:\n  ' + selected(unitTests).join('\n  '));
  console.log('e2e:\n  ' + selected(e2eTests).join('\n  '));
  process.exit(0);
}

// ─── Display (Linux) ─────────────────────────────────────────────────────────

if (wantE2e && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.SHMMOTH_RUNNER_XVFB) {
  const which = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' });
  if (which.status !== 0) {
    console.error('No display available. Install xvfb (e.g. `sudo apt-get install xvfb`) or run with a desktop session.');
    process.exit(2);
  }
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1366x850x24', process.execPath, __filename, ...argv],
    { stdio: 'inherit', env: { ...process.env, SHMMOTH_RUNNER_XVFB: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}

// ─── Running ─────────────────────────────────────────────────────────────────

function summarise(output) {
  const lines = output.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].replace(/\x1b\[[0-9;]*m/g, '');
    let m = /(\d+) passed, (\d+) failed(?:, (\d+) skipped)?/.exec(l);
    if (m) return `${m[1]} passed, ${m[2]} failed${m[3] ? `, ${m[3]} skipped` : ''}`;
    m = /Passed: (\d+) \/ (\d+)/i.exec(l);
    if (m) return `${m[1]} / ${m[2]} passed`;
  }
  return '';
}

function runNode(file, { env = {}, timeout, stream }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => { out += d; if (stream) process.stdout.write(d); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { out += '\n[runner] timed out, killing\n'; child.kill('SIGKILL'); }, timeout);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - started }); });
  });
}

function packagedExecutable() {
  if (process.env.APP_EXE) return process.env.APP_EXE;
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const product = (pkg.build && pkg.build.productName) || pkg.name;
  if (process.platform === 'win32') return path.join(ROOT, 'dist', 'win-unpacked', `${product}.exe`);
  if (process.platform === 'darwin') return path.join(ROOT, 'dist', 'mac', `${product}.app`, 'Contents', 'MacOS', product);
  return path.join(ROOT, 'dist', 'linux-unpacked', pkg.name);
}

async function main() {
  const results = [];

  if (wantUnit) {
    console.log(`\n▶ Unit tests (${selected(unitTests).length})\n`);
    for (const f of selected(unitTests)) {
      const r = await runNode(path.join('tests', f), { timeout: 180000, stream: false });
      results.push({ kind: 'unit', name: f, ok: r.code === 0, ms: r.ms, summary: summarise(r.out), out: r.out });
      console.log(`${r.code === 0 ? '✅' : '❌'} ${f.padEnd(52)} ${summarise(r.out)}`);
    }
  }

  if (wantE2e) {
    const env = {};
    if (packaged) {
      if (!process.env.APP_EXE && !has('--no-build')) {
        console.log('\n▶ Building an unpacked app with electron-builder --dir …\n');
        // Playwright can only attach to an Electron binary whose enableNodeCliInspectArguments fuse is on; every other
        // production fuse stays as configured in package.json and is verified below.
        const b = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
          ['electron-builder', '--dir', '--publish', 'never', `-c.electronFuses.enableNodeCliInspectArguments=${TEST_BUILD_FUSE_OVERRIDE}`],
          { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
        if (b.status !== 0) { console.error('electron-builder failed'); process.exit(1); }
      }
      env.APP_EXE = packagedExecutable();
      if (!fs.existsSync(env.APP_EXE)) { console.error(`Packaged app not found: ${env.APP_EXE}`); process.exit(1); }
      console.log(`Packaged app: ${env.APP_EXE}`);
      const fuses = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-fuses.js'), env.APP_EXE, '--ignore=enableNodeCliInspectArguments'], { cwd: ROOT, stdio: 'inherit' });
      if (fuses.status !== 0) { console.error('The packaged app does not carry the configured Electron fuses'); process.exit(1); }
    }
    console.log(`\n▶ End-to-end tests (${selected(e2eTests).length})${packaged ? ' — packaged build' : ''}\n`);
    for (const f of selected(e2eTests)) {
      const r = await runNode(path.join('tests', 'e2e', f), { env, timeout: 420000, stream: true });
      results.push({ kind: 'e2e', name: f, ok: r.code === 0, ms: r.ms, summary: summarise(r.out), out: r.out });
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('══════════════════════════════════════════════════════');
  for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} [${r.kind}] ${r.name.padEnd(46)} ${r.summary.padEnd(28)} ${(r.ms / 1000).toFixed(1)}s`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} test files passed${failed.length ? ` — FAILED: ${failed.map((r) => r.name).join(', ')}` : ''}\n`);

  for (const r of failed.filter((x) => x.kind === 'unit')) {
    console.log(`──── ${r.name} (last output) ────\n${r.out.split('\n').slice(-25).join('\n')}\n`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
