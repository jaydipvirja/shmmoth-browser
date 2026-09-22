/**
 * STAGE 11: IDM TURBO INTERCEPTION & MULTI-WAN INTERNET BONDING TEST SUITE
 * tests/stage11-turbo-interception-bonding.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const TurboDownloadEngine = require('../src/services/turboDownloadEngine');
const DownloadManager = require('../src/services/downloadManager');

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, fn) {
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

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Stage 11 Turbo & Bonding Suite       ');
  console.log('══════════════════════════════════════════════════════════\n');

  // 1. Check checkInterfaceOnline method exists and works
  await runTest('1. TurboDownloadEngine has checkInterfaceOnline and getAvailableNetworkInterfacesAsync', async () => {
    assert(typeof TurboDownloadEngine.checkInterfaceOnline === 'function', 'Missing checkInterfaceOnline');
    assert(typeof TurboDownloadEngine.getAvailableNetworkInterfacesAsync === 'function', 'Missing getAvailableNetworkInterfacesAsync');
    const ifaces = await TurboDownloadEngine.getAvailableNetworkInterfacesAsync(1000);
    assert(Array.isArray(ifaces), 'Should return array of interfaces');
    assert(ifaces.length >= 1, 'Should find at least 1 interface');
    assert('isOnline' in ifaces[0], 'Each interface should have isOnline boolean property');
  });

  // 2. Test DownloadManager getNetworkInterfaces returns promises with isOnline
  await runTest('2. DownloadManager.getNetworkInterfaces returns enriched interface list', async () => {
    const dm = new DownloadManager();
    const ifaces = await dm.getNetworkInterfaces();
    assert(Array.isArray(ifaces), 'Should return array');
    assert(ifaces.length >= 1, 'Should have at least 1 interface');
  });

  // 3. Test _handleDownload delegates web downloads to Turbo
  await runTest('3. _handleDownload intercepts web downloads with webContents into startTurboDownload', async () => {
    const dm = new DownloadManager();
    let turboStarted = false;
    dm.startTurboDownload = (opts) => {
      turboStarted = true;
      assert(opts.url === 'https://example.com/largefile.zip');
      assert(opts.filename === 'largefile.zip');
      assert(opts.headers['Referer'] === 'https://example.com/download-page');
      return { id: 'test-123', state: 'progressing' };
    };

    let itemCancelled = false;
    const mockItem = {
      getURL: () => 'https://example.com/largefile.zip',
      getFilename: () => 'largefile.zip',
      getTotalBytes: () => 50000000,
      cancel: () => { itemCancelled = true; },
      setSavePath: () => {},
      on: () => {},
      once: () => {}
    };

    const mockWebContents = {
      getURL: () => 'https://example.com/download-page',
      session: {
        getUserAgent: () => 'Mozilla/5.0 Test',
        cookies: {
          get: async () => [{ name: 'session_token', value: 'xyz123' }]
        }
      }
    };

    await dm._handleDownload(mockItem, mockWebContents);
    assert(itemCancelled === true, 'Native item should be cancelled');
    assert(turboStarted === true, 'startTurboDownload should be invoked');
  });

  // 4. Test downloads.html contains styling for dot-amber and dot-green
  await runTest('4. downloads.html defines dot-green and dot-amber network status indicators', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'downloads.html'), 'utf8');
    assert(html.includes('.net-badge.dot-green::before'), 'Missing dot-green style');
    assert(html.includes('.net-badge.dot-amber::before'), 'Missing dot-amber style');
    assert(html.includes('.dl-segments-container'), 'Missing dl-segments-container');
    assert(html.includes('.dl-segment-slot'), 'Missing dl-segment-slot');
  });

  // 5. Test downloads.js renders online status text and badges
  await runTest('5. downloads.js refreshes network interfaces with online status badges', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'downloads.js'), 'utf8');
    assert(js.includes('refreshNetworkInterfaces'), 'Missing refreshNetworkInterfaces');
    assert(js.includes('onlineIfaces'), 'Should filter onlineIfaces');
    assert(js.includes('dot-amber'), 'Should have dot-amber fallback');
  });

  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`  Tests Passed: ${testsPassed} / ${testsPassed + testsFailed}`);
  if (testsFailed === 0) {
    console.log('  All Stage 11 Turbo & Bonding tests PASSED! ✨\n');
  } else {
    process.exit(1);
  }
})();
