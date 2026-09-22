/**
 * AUTO-UPDATE MANAGER TEST SUITE — tests/update-manager.test.js
 *
 * Tests UpdateManager lifecycle, event handling, dev-mode safety,
 * progress calculations, and graceful error handling.
 */

'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const UpdateManager = require('../src/services/updateManager');

class MockAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = false;
    this.autoInstallOnAppQuit = false;
    this.logger = null;
    this.quitAndInstallCalled = false;
  }

  async checkForUpdates() {
    this.emit('checking-for-update');
    return null;
  }

  quitAndInstall(isSilent, isForceRunAfter) {
    this.quitAndInstallCalled = true;
    this.quitAndInstallArgs = { isSilent, isForceRunAfter };
    return true;
  }
}

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    testsFailed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    testsFailed++;
  }
}

async function runSuite() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Auto-Update Manager Test Suite        ');
  console.log('══════════════════════════════════════════════════════════\n');

  // Test 1: Initialization
  runTest('1. UpdateManager initializes with idle status and default version', () => {
    const mgr = new UpdateManager();
    const status = mgr.getStatus();
    assert.strictEqual(status.status, 'idle');
    assert.ok(status.currentVersion, 'currentVersion should be defined');
  });

  // Test 2: Checking event
  runTest('2. checking-for-update transitions state to checking', () => {
    const mock = new MockAutoUpdater();
    const mgr = new UpdateManager({ updater: mock });
    mgr.init();

    let emittedStatus = null;
    mgr.on('status-changed', (s) => { emittedStatus = s; });

    mock.emit('checking-for-update');
    assert.strictEqual(mgr.getStatus().status, 'checking');
    assert.strictEqual(emittedStatus.status, 'checking');
  });

  // Test 3: Update Available event
  runTest('3. update-available transitions state to available and captures version', () => {
    const mock = new MockAutoUpdater();
    const mgr = new UpdateManager({ updater: mock });
    mgr.init();

    mock.emit('update-available', { version: '1.2.0', releaseDate: '2026-09-22' });
    const status = mgr.getStatus();
    assert.strictEqual(status.status, 'available');
    assert.strictEqual(status.availableVersion, '1.2.0');
    assert.ok(status.message.includes('1.2.0'));
  });

  // Test 4: Download Progress event
  runTest('4. download-progress computes percentage, speed, and bytes transferred', () => {
    const mock = new MockAutoUpdater();
    const mgr = new UpdateManager({ updater: mock });
    mgr.init();

    mock.emit('download-progress', {
      percent: 45.8,
      transferred: 45800000,
      total: 100000000,
      bytesPerSecond: 5242880
    });

    const status = mgr.getStatus();
    assert.strictEqual(status.status, 'downloading');
    assert.strictEqual(status.percent, 46);
    assert.strictEqual(status.bytesPerSecond, 5242880);
  });

  // Test 5: Update Downloaded event
  runTest('5. update-downloaded sets status to downloaded and ready to install', () => {
    const mock = new MockAutoUpdater();
    const mgr = new UpdateManager({ updater: mock });
    mgr.init();

    mock.emit('update-downloaded', { version: '1.2.0' });
    const status = mgr.getStatus();
    assert.strictEqual(status.status, 'downloaded');
    assert.strictEqual(status.percent, 100);
    assert.strictEqual(status.availableVersion, '1.2.0');
  });

  // Test 6: Update Not Available event
  runTest('6. update-not-available updates lastChecked and confirms up to date', () => {
    const mock = new MockAutoUpdater();
    const mgr = new UpdateManager({ updater: mock });
    mgr.init();

    mock.emit('update-not-available');
    const status = mgr.getStatus();
    assert.strictEqual(status.status, 'not-available');
    assert.ok(status.lastChecked, 'lastChecked timestamp should be recorded');
  });

  // Test 7: Error handling
  runTest('7. error event sets status to error without crashing or throwing', () => {
    const mock = new MockAutoUpdater();
    const mgr = new UpdateManager({ updater: mock });
    mgr.init();

    mock.emit('error', new Error('Net::ERR_CONNECTION_REFUSED'));
    const status = mgr.getStatus();
    assert.strictEqual(status.status, 'error');
    assert.ok(status.error.includes('ERR_CONNECTION_REFUSED'));
  });

  // Test 8: quitAndInstall delegation
  runTest('8. quitAndInstall delegates directly to updater.quitAndInstall', () => {
    const mock = new MockAutoUpdater();
    const mgr = new UpdateManager({ updater: mock });
    mgr.init();

    const success = mgr.quitAndInstall();
    assert.strictEqual(success, true);
    assert.strictEqual(mock.quitAndInstallCalled, true);
    assert.strictEqual(mock.quitAndInstallArgs.isSilent, false);
    assert.strictEqual(mock.quitAndInstallArgs.isForceRunAfter, true);
  });

  // Test 9: Graceful handling in development / unpackaged environments
  await runAsyncTest('9. checkForUpdates returns gracefully in unpackaged dev mode', async () => {
    const mock = new MockAutoUpdater();
    const mgr = new UpdateManager({ updater: mock });
    // app is undefined in raw node unit test, so app.isPackaged is handled safely
    const res = await mgr.checkForUpdates();
    assert.ok(res, 'Should return status object');
  });

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Auto-Update Suite: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
