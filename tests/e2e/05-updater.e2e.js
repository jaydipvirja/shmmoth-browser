/**
 * E2E 05 — updater through Electron's real network stack
 *
 * Runs the real UpdateManager inside an Electron main process (fixtures/updater-app) against a fake GitHub
 * and checks that only a correctly signed release is ever installed, and that update traffic honours the proxy.
 * (The unit tests in tests/p0-updater.test.js cover the same logic with an in-memory fetcher.)
 *
 * Run: npm run test:e2e   (or: node tests/e2e/05-updater.e2e.js)
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { runSuite, assert, assertEqual, tmpDir, needsNoSandbox, ROOT } = require('./helpers');

function runFixture() {
  const dir = tmpDir('shmmoth-e2e-upd-');
  const resultFile = path.join(dir, 'result.json');
  const args = [path.join(__dirname, 'fixtures', 'updater-app'), '--disable-gpu'];
  if (needsNoSandbox()) args.push('--no-sandbox');
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron'), args, {
      cwd: ROOT,
      env: { ...process.env, E2E_RESULT_FILE: resultFile, HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('updater fixture timed out\n' + out.slice(-1500))); }, 150000);
    child.on('exit', () => {
      clearTimeout(timer);
      if (!fs.existsSync(resultFile)) return reject(new Error('fixture produced no result\n' + out.slice(-1500)));
      resolve(JSON.parse(fs.readFileSync(resultFile, 'utf8')));
    });
    child.on('error', reject);
  });
}

runSuite('SHMMOTH Browser — E2E 05: updater (real Electron network stack)', async (t) => {
  const r = await runFixture();
  assert(!r.fatal, 'fixture crashed: ' + r.fatal);

  t.section('Release handling');

  await t.test('a correctly signed release is downloaded (302 redirect, 5 MB stream), verified and launched', async () => {
    assertEqual(r.good.status, 'downloaded', r.good.message);
    assertEqual(r.good.verified, true);
    assertEqual(r.good.bytesOnDisk, 5 * 1024 * 1024 + 123);
    assertEqual(r.good.installCall, true);
    assertEqual(r.good.launched, 1);
  });

  await t.test('installer replaced by malware (GitHub digest updated to match) is rejected and deleted', async () => {
    assertEqual(r.malware.status, 'error');
    assert(/invalid signature/i.test(r.malware.message), r.malware.message);
    assertEqual(r.malware.launched, 0);
    assertEqual(r.malware.filesLeft.join(), '', 'files left behind');
  });

  await t.test('a release signed with an attacker key is rejected and deleted', async () => {
    assertEqual(r.attackerKey.status, 'error');
    assert(/invalid signature/i.test(r.attackerKey.message), r.attackerKey.message);
    assertEqual(r.attackerKey.launched, 0);
    assertEqual(r.attackerKey.filesLeft.join(), '');
  });

  await t.test('a redirect to a host outside the allow-list is refused (checked on the real redirect event)', async () => {
    assertEqual(r.badRedirect.status, 'error');
    assert(/untrusted host/i.test(r.badRedirect.message), r.badRedirect.message);
    assertEqual(r.badRedirect.launched, 0);
  });

  t.section('Proxy');

  await t.test('a release reachable ONLY through the configured proxy is fetched through it', async () => {
    assertEqual(r.viaProxy.status, 'downloaded', r.viaProxy.message);
    assertEqual(r.viaProxy.proxySawApi, true, 'proxy saw the API call');
    assertEqual(r.viaProxy.proxySawDownload, true, 'proxy saw the installer download');
  });
});
