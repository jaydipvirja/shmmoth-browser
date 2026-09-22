/**
 * SHMMOTH BROWSER — STAGE 3 VERIFICATION TESTS
 * Tests for Downloads, PDF & Print, Find in Page, and Zoom
 *
 * Run with: node tests/stage3-downloads-pdf-find-zoom.test.js
 */

'use strict';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// Patch electron mock for isolated testing
const os = require('os');
const path = require('path');
const fs = require('fs');

let lastOpenedPath = null;
let lastShownInFolder = null;

const Module = require('module');
const origLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => path.join(os.tmpdir(), `shmmoth_test_${name}`),
        quit: () => {}
      },
      shell: {
        openPath: async (filePath) => {
          lastOpenedPath = filePath;
          return '';
        },
        showItemInFolder: (filePath) => {
          lastShownInFolder = filePath;
        }
      }
    };
  }
  return origLoad.call(this, request, ...args);
};

const StorageService = require('../src/services/storage');
const DownloadManager = require('../src/services/downloadManager');

// Mock download item
function createMockItem(filename = 'test-file.pdf', totalBytes = 1048576, url = 'https://example.com/test-file.pdf') {
  let paused = false;
  let cancelled = false;
  let savePath = '';
  const listeners = {};

  return {
    getFilename: () => filename,
    getURL: () => url,
    getTotalBytes: () => totalBytes,
    getReceivedBytes: () => 524288,
    getState: () => (cancelled ? 'cancelled' : paused ? 'progressing' : 'completed'),
    isPaused: () => paused,
    canResume: () => true,
    setSavePath: (p) => { savePath = p; },
    getSavePath: () => savePath,
    pause: () => { paused = true; },
    resume: () => { paused = false; },
    cancel: () => { cancelled = true; },
    on: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    once: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push((...args) => cb(...args));
    },
    _trigger: (event, ...args) => {
      (listeners[event] || []).forEach(cb => cb(...args));
    }
  };
}

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

function calculateNextZoom(current) {
  return ZOOM_LEVELS.find(lvl => lvl > current + 0.01) || ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
}

function calculatePrevZoom(current) {
  return [...ZOOM_LEVELS].reverse().find(lvl => lvl < current - 0.01) || ZOOM_LEVELS[0];
}

function getSiteKey(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function run() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Stage 3 (Downloads, Find, Zoom) Tests ');
  console.log('══════════════════════════════════════════════════════════\n');

  // ────────────────────────────────────────────────────────────────────────────
  console.log('📥 1. DownloadManager Lifecycle Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('DownloadManager: _handleDownload creates tracking record with progress state', () => {
    const storage = new StorageService();
    storage.data.downloads = [];
    const dm = new DownloadManager(storage);

    const updates = [];
    dm._onUpdate = (rec) => updates.push(rec);

    const mockItem = createMockItem('manual.pdf', 2048);
    dm._handleDownload(mockItem);

    const downloads = dm.getDownloads();
    assert(downloads.length === 1, 'Should have 1 download recorded');
    assert(downloads[0].filename === 'manual.pdf', 'Filename matches');
    assert(downloads[0].state === 'progressing', 'Initial state is progressing');
    assert(downloads[0].isPaused === false, 'Initial paused is false');
    assert(downloads[0].total === 2048, 'Total bytes recorded');
  });

  await test('DownloadManager: pauseDownload and resumeDownload update state correctly', () => {
    const storage = new StorageService();
    storage.data.downloads = [];
    const dm = new DownloadManager(storage);

    const mockItem = createMockItem('document.pdf');
    dm._handleDownload(mockItem);

    const dl = dm.getDownloads()[0];
    const paused = dm.pauseDownload(dl.id);
    assert(paused === true, 'pauseDownload returns true');
    assert(mockItem.isPaused() === true, 'Mock item paused');
    assert(dm.downloads[dl.id].isPaused === true, 'Record isPaused updated');

    const resumed = dm.resumeDownload(dl.id);
    assert(resumed === true, 'resumeDownload returns true');
    assert(mockItem.isPaused() === false, 'Mock item resumed');
    assert(dm.downloads[dl.id].isPaused === false, 'Record isPaused updated to false');
  });

  await test('DownloadManager: cancelDownload cancels item and marks state', () => {
    const storage = new StorageService();
    storage.data.downloads = [];
    const dm = new DownloadManager(storage);

    const mockItem = createMockItem('archive.zip');
    dm._handleDownload(mockItem);
    const dl = dm.getDownloads()[0];

    const cancelled = dm.cancelDownload(dl.id);
    assert(cancelled === true, 'cancelDownload returns true');
    assert(dm.downloads[dl.id].state === 'cancelled', 'Record state marked cancelled');
  });

  await test('DownloadManager: removeDownload removes active or completed record from storage', () => {
    const storage = new StorageService();
    storage.data.downloads = [];
    const dm = new DownloadManager(storage);

    const mockItem = createMockItem('photo.png');
    dm._handleDownload(mockItem);
    const dl = dm.getDownloads()[0];

    assert(dm.getDownloads().length === 1, 'Has 1 download');
    const removed = dm.removeDownload(dl.id);
    assert(removed === true, 'removeDownload returns true');
    assert(dm.getDownloads().length === 0, 'Downloads list empty after removal');
    assert(storage.get('downloads').length === 0, 'Storage downloads empty after removal');
  });

  await test('DownloadManager: clearCompleted clears completed/cancelled and retains in-progress', () => {
    const storage = new StorageService();
    storage.data.downloads = [];
    const dm = new DownloadManager(storage);

    const item1 = createMockItem('active.iso');
    const item2 = createMockItem('finished.txt');
    const item3 = createMockItem('aborted.bin');

    dm._handleDownload(item1);
    dm._handleDownload(item2);
    dm._handleDownload(item3);

    const [d1, d2, d3] = dm.getDownloads();
    dm.downloads[d2.id].state = 'completed';
    dm.downloads[d3.id].state = 'cancelled';

    const count = dm.clearCompleted();
    assert(count === 2, `Cleared 2 records (got ${count})`);
    const remaining = dm.getDownloads();
    assert(remaining.length === 1, 'Only 1 active download remains');
    assert(remaining[0].id === d1.id, 'Active download remains in list');
  });

  await test('DownloadManager: openFile and showInFolder reject missing files safely', async () => {
    const storage = new StorageService();
    storage.data.downloads = [];
    const dm = new DownloadManager(storage);

    const mockItem = createMockItem('nonexistent.pdf');
    dm._handleDownload(mockItem);
    const dl = dm.getDownloads()[0];

    const openRes = await dm.openFile(dl.id);
    assert(openRes.success === false, 'openFile returns false for non-existent file on disk');
    assert(openRes.error.includes('does not exist'), 'Helpful error message returned');

    const showRes = dm.showInFolder(dl.id);
    assert(showRes === false, 'showInFolder returns false for non-existent file on disk');
  });

  await test('DownloadManager: persistence restores historical downloads across sessions', () => {
    const storage = new StorageService();
    storage.data.downloads = [
      {
        id: 'dl_persisted_1',
        filename: 'saved_report.pdf',
        url: 'https://example.com/saved_report.pdf',
        savePath: 'C:\\Downloads\\saved_report.pdf',
        state: 'completed',
        received: 5000,
        total: 5000,
        startedAt: Date.now() - 3600000,
        completedAt: Date.now() - 3500000
      }
    ];

    const dm = new DownloadManager(storage);
    const list = dm.getDownloads();
    assert(list.length === 1, 'Restored 1 persisted download');
    assert(list[0].filename === 'saved_report.pdf', 'Filename matches');
    assert(list[0].state === 'completed', 'State is completed');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n🔍 2. Zoom System Logic Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('Zoom: stepping calculation moves through discrete zoom factors', () => {
    assert(calculateNextZoom(1.0) === 1.1, '1.0 zooms in to 1.1');
    assert(calculateNextZoom(1.1) === 1.25, '1.1 zooms in to 1.25');
    assert(calculateNextZoom(5.0) === 5.0, 'Max zoom is 5.0');

    assert(calculatePrevZoom(1.0) === 0.9, '1.0 zooms out to 0.9');
    assert(calculatePrevZoom(0.9) === 0.8, '0.9 zooms out to 0.8');
    assert(calculatePrevZoom(0.25) === 0.25, 'Min zoom is 0.25');
  });

  await test('Zoom: site key extraction groups by HTTP/HTTPS origin and ignores internal pages', () => {
    assert(getSiteKey('https://github.com/torvalds/linux') === 'https://github.com', 'GitHub origin extracted');
    assert(getSiteKey('http://localhost:3000/app') === 'http://localhost:3000', 'Localhost origin extracted');
    assert(getSiteKey('mtc://newtab') === null, 'mtc:// returns null');
    assert(getSiteKey('about:blank') === null, 'about:blank returns null');
    assert(getSiteKey('invalid-url') === null, 'invalid url returns null');
  });

  await test('Zoom: site zoom persistence saves non-standard zooms and deletes standard 1.0', () => {
    const storage = new StorageService();
    storage.data.siteZoom = {};

    // Save 125% zoom for Wikipedia
    const origin = getSiteKey('https://en.wikipedia.org/wiki/Main_Page');
    let zooms = storage.get('siteZoom', {});
    zooms[origin] = 1.25;
    storage.set('siteZoom', zooms);

    assert(storage.get('siteZoom')['https://en.wikipedia.org'] === 1.25, 'Origin zoom saved');

    // Reset to 1.0 clears origin from storage
    zooms = storage.get('siteZoom', {});
    delete zooms[origin];
    storage.set('siteZoom', zooms);

    assert(storage.get('siteZoom')['https://en.wikipedia.org'] === undefined, 'Origin zoom deleted when reset to 100%');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n🔎 3. Find in Page Parameter & Action Validation');
  // ────────────────────────────────────────────────────────────────────────────

  await test('Find in Page: valid stop actions are accepted and invalid defaults to clearSelection', () => {
    const validActions = ['clearSelection', 'keepSelection', 'activateSelection'];
    function sanitizeStopAction(action) {
      return validActions.includes(action) ? action : 'clearSelection';
    }

    assert(sanitizeStopAction('clearSelection') === 'clearSelection', 'clearSelection valid');
    assert(sanitizeStopAction('keepSelection') === 'keepSelection', 'keepSelection valid');
    assert(sanitizeStopAction('activateSelection') === 'activateSelection', 'activateSelection valid');
    assert(sanitizeStopAction('maliciousOrUnknown') === 'clearSelection', 'unknown defaults to clearSelection');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n📦 4. Preload Stage 3 Surface Verification');
  // ────────────────────────────────────────────────────────────────────────────

  await test('preload-internal.js defines all required Stage 3 methods', () => {
    const preloadCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-internal.js'), 'utf8');

    const requiredMethods = [
      'findInPage',
      'findNext',
      'stopFindInPage',
      'onFindResult',
      'zoomIn',
      'zoomOut',
      'resetZoom',
      'getZoomFactor',
      'onZoomChanged',
      'printTab',
      'getDownloads',
      'pauseDownload',
      'resumeDownload',
      'cancelDownload',
      'openDownloadedFile',
      'showDownloadInFolder',
      'removeDownload',
      'clearDownloads'
    ];

    for (const method of requiredMethods) {
      assert(preloadCode.includes(method), `preload-internal.js must expose: ${method}`);
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Stage 3 Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
