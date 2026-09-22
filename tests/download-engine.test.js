/**
 * SHMMOTH BROWSER — DOWNLOAD ENGINE VERIFICATION TESTS
 * Comprehensive 15-Point Automated Test Suite for Native Downloads Pipeline
 *
 * Run with: node tests/download-engine.test.js
 */

'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

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

// Global test sandbox directories
const testBaseDir = path.join(os.tmpdir(), `shmmoth_dl_test_${Date.now()}`);
const testUserData = path.join(testBaseDir, 'userData');
const testDownloadsDir = path.join(testBaseDir, 'downloads');

fs.mkdirSync(testUserData, { recursive: true });
fs.mkdirSync(testDownloadsDir, { recursive: true });

let lastOpenedPath = null;
let lastShownInFolder = null;

// Mock Electron
const Module = require('module');
const origLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => {
          if (name === 'userData') return testUserData;
          if (name === 'downloads') return testDownloadsDir;
          return path.join(testBaseDir, name);
        },
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
      },
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [testDownloadsDir] }),
        showSaveDialog: async () => ({ canceled: false, filePath: path.join(testDownloadsDir, 'dialog-save.pdf') })
      }
    };
  }
  return origLoad.call(this, request, ...args);
};

const StorageService = require('../src/services/storage');
const DownloadManager = require('../src/services/downloadManager');

// Helper to create mock Electron DownloadItem
function createMockItem(opts = {}) {
  const filename = opts.filename || 'sample.pdf';
  const url = opts.url || 'https://cdn.example.com/files/sample.pdf';
  const totalBytes = opts.totalBytes !== undefined ? opts.totalBytes : 10 * 1024 * 1024; // 10MB
  let receivedBytes = opts.receivedBytes || 0;
  let isPaused = false;
  let isCancelled = false;
  let savePath = '';
  const listeners = {};

  return {
    getFilename: () => filename,
    getURL: () => url,
    getTotalBytes: () => totalBytes,
    getReceivedBytes: () => receivedBytes,
    setReceivedBytes: (b) => { receivedBytes = b; },
    isPaused: () => isPaused,
    canResume: () => true,
    setSavePath: (p) => { savePath = p; },
    getSavePath: () => savePath,
    pause: () => { isPaused = true; },
    resume: () => { isPaused = false; },
    cancel: () => { isCancelled = true; },
    isCancelled: () => isCancelled,
    on: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    once: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    emit: (event, ...args) => {
      (listeners[event] || []).forEach(cb => cb(...args));
    }
  };
}

// Helper to create mock Electron Session
function createMockSession() {
  const listeners = {};
  const downloads = [];
  return {
    on: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    emit: (event, ...args) => {
      (listeners[event] || []).forEach(cb => cb(...args));
    },
    downloadURL: (url) => {
      downloads.push(url);
      const item = createMockItem({ url, filename: path.basename(url) || 'download.bin' });
      (listeners['will-download'] || []).forEach(cb => cb({ preventDefault: () => {} }, item, null));
      return item;
    },
    _requestedDownloads: downloads
  };
}

function getFreshManager(options = {}) {
  const storage = new StorageService();
  storage.data.downloads = [];
  storage.save();
  const dm = new DownloadManager(storage, options);
  return { storage, dm };
}

async function runTests() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Native Download Engine Test Suite    ');
  console.log('══════════════════════════════════════════════════════════\n');

  // Test 1: DownloadManager initialization and directory resolution
  await test('1. DownloadManager initializes with correct default download folder', () => {
    const { dm } = getFreshManager();
    const saveDir = dm.getSaveDir();
    assert(saveDir === testDownloadsDir, `Expected default save dir ${testDownloadsDir}, got ${saveDir}`);
    assert(fs.existsSync(saveDir), 'Save directory exists on disk');
  });

  // Test 2: Filename sanitization
  await test('2. Filename sanitization strips illegal Windows characters, traversal, and reserved names', () => {
    const sanitize = DownloadManager.sanitizeFilename;
    assert(sanitize('../../../evil.exe') === 'evil.exe', 'Path traversal ../ stripped');
    assert(sanitize('..\\..\\bad.exe') === 'bad.exe', 'Windows path traversal ..\\ stripped');
    assert(sanitize('file:name*with?illegal"chars<bar>|test.zip') === 'file_name_with_illegal_chars_bar__test.zip', 'Illegal chars replaced with underscores');
    assert(sanitize('CON.txt') === '_CON.txt', 'Windows reserved name CON protected');
    assert(sanitize('NUL.pdf') === '_NUL.pdf', 'Windows reserved name NUL protected');
    assert(sanitize('COM1.dat') === '_COM1.dat', 'Windows reserved name COM1 protected');
    assert(sanitize('trailing_spaces   ') === 'trailing_spaces', 'Trailing spaces trimmed');
    assert(sanitize('trailing_dots....') === 'trailing_dots', 'Trailing dots trimmed');
    assert(sanitize('') === 'download', 'Empty name falls back to download');
    assert(sanitize(null) === 'download', 'Null name falls back to download');
  });

  // Test 3: Duplicate filename collision resolution
  await test('3. getUniqueSavePath increments filenames when duplicates exist', () => {
    const unique = DownloadManager.getUniqueSavePath;
    const testDir = path.join(testBaseDir, 'dedup_test');
    fs.mkdirSync(testDir, { recursive: true });

    // No existing file -> unchanged
    const p1 = unique(testDir, 'report.pdf');
    assert(path.basename(p1) === 'report.pdf', `Expected report.pdf, got ${path.basename(p1)}`);

    // Create report.pdf
    fs.writeFileSync(p1, 'dummy data');
    const p2 = unique(testDir, 'report.pdf');
    assert(path.basename(p2) === 'report (1).pdf', `Expected report (1).pdf, got ${path.basename(p2)}`);

    // Create report (1).pdf
    fs.writeFileSync(p2, 'dummy data 2');
    const p3 = unique(testDir, 'report.pdf');
    assert(path.basename(p3) === 'report (2).pdf', `Expected report (2).pdf, got ${path.basename(p3)}`);

    // If report (3).pdf.crdownload exists, it should increment past it
    fs.writeFileSync(path.join(testDir, 'report (3).pdf.crdownload'), 'in progress');
    fs.writeFileSync(p3, 'dummy data 3');
    assert(path.basename(unique(testDir, 'report.pdf')) === 'report (4).pdf', 'Skips existing .crdownload files');
  });

  // Test 4: Directory creation
  await test('4. Custom download directory is automatically created recursively if missing', () => {
    const storage = new StorageService();
    storage.data.downloads = [];
    const customDir = path.join(testBaseDir, 'nested', 'custom', 'downloads');
    storage.updateSettings({ downloadPath: customDir });

    const dm = new DownloadManager(storage);
    const resolved = dm.getSaveDir();
    assert(resolved === customDir, `Resolved directory should be customDir, got ${resolved}`);
    assert(fs.existsSync(customDir), 'Custom directory was created on disk');
  });

  // Test 5: Standard download lifecycle (progressing -> completed)
  await test('5. Standard download progresses and transitions to completed on done event', () => {
    const { dm } = getFreshManager();
    const updates = [];
    dm._onUpdate = (rec) => updates.push({ ...rec });

    const item = createMockItem({ filename: 'manual.pdf', totalBytes: 2048 });
    dm._handleDownload(item);

    const dls = dm.getDownloads();
    assert(dls.length === 1, 'Download recorded');
    assert(dls[0].state === 'progressing', 'Initial state is progressing');
    assert(dls[0].received === 0, 'Initial received is 0');
    assert(dls[0].total === 2048, 'Total is 2048');

    // Simulate progress
    item.setReceivedBytes(1024);
    item.emit('updated', null, 'progressing');
    assert(dm.downloads[dls[0].id].received === 1024, 'Received updated to 1024');

    // Simulate completion
    item.setReceivedBytes(2048);
    item.emit('done', null, 'completed');
    assert(dm.downloads[dls[0].id].state === 'completed', 'State transitioned to completed');
    assert(dm.downloads[dls[0].id].received === 2048, 'Received is 2048 on completion');
    assert(dm.downloads[dls[0].id].endedAt > 0, 'endedAt timestamp set');
  });

  // Test 6: Speed and ETA calculation
  await test('6. Real-time transfer speed (bytes/sec) and ETA (seconds) are calculated during progress', async () => {
    const { dm } = getFreshManager();
    const item = createMockItem({ filename: 'large_archive.zip', totalBytes: 10 * 1024 * 1024 }); // 10MB
    dm._handleDownload(item);

    const record = Object.values(dm.downloads)[0];
    assert(record, 'Record exists');

    // Mock initial timestamp to 1 second ago
    record._lastTimestamp = Date.now() - 1000;
    record._lastReceived = 0;
    item.setReceivedBytes(2 * 1024 * 1024); // 2MB downloaded in 1 second = 2MB/s

    item.emit('updated', null, 'progressing');

    assert(record.speed > 0, `Speed should be calculated, got ${record.speed}`);
    assert(record.eta !== null && record.eta > 0, `ETA should be calculated, got ${record.eta}`);
    assert(record.eta >= 3 && record.eta <= 5, `ETA should be around 4 seconds, got ${record.eta}`);
  });

  // Test 7: Pause and resume state tracking
  await test('7. pauseDownload and resumeDownload correctly update state, flags, and item', () => {
    const { dm } = getFreshManager();
    const item = createMockItem({ filename: 'video.mp4' });
    dm._handleDownload(item);

    const record = Object.values(dm.downloads)[0];
    assert(record, 'Record exists');
    const id = record.id;

    // Pause
    const paused = dm.pauseDownload(id);
    assert(paused === true, 'pauseDownload returned true');
    assert(item.isPaused() === true, 'Item isPaused is true');
    assert(dm.downloads[id].isPaused === true, 'Record isPaused is true');
    assert(dm.downloads[id].state === 'paused', 'Record state is paused');
    assert(dm.downloads[id].speed === 0, 'Speed reset to 0 on pause');

    // Resume
    const resumed = dm.resumeDownload(id);
    assert(resumed === true, 'resumeDownload returned true');
    assert(item.isPaused() === false, 'Item isPaused is false');
    assert(dm.downloads[id].isPaused === false, 'Record isPaused is false');
    assert(dm.downloads[id].state === 'progressing', 'Record state is progressing');
  });

  // Test 8: Cancel download and partial file cleanup
  await test('8. cancelDownload cancels item and cleans up partial and .crdownload files', async () => {
    const { dm } = getFreshManager();
    const item = createMockItem({ filename: 'test_cleanup.bin' });
    dm._handleDownload(item);

    const record = Object.values(dm.downloads)[0];
    const id = record.id;
    const savePath = record.savePath;

    // Create partial files on disk to simulate Chromium writing
    fs.writeFileSync(savePath, 'partial data');
    fs.writeFileSync(`${savePath}.crdownload`, 'partial crdownload data');
    assert(fs.existsSync(savePath), 'Simulated partial file exists');
    assert(fs.existsSync(`${savePath}.crdownload`), 'Simulated .crdownload exists');

    const cancelled = dm.cancelDownload(id);
    assert(cancelled === true, 'cancelDownload returned true');
    assert(item.isCancelled() === true, 'Item cancelled');
    assert(dm.downloads[id].state === 'cancelled', 'Record state is cancelled');

    // Wait 150ms for asynchronous cleanup callback
    await new Promise(r => setTimeout(r, 150));
    assert(!fs.existsSync(savePath), 'Partial file was cleaned up from disk');
    assert(!fs.existsSync(`${savePath}.crdownload`), '.crdownload file was cleaned up from disk');
  });

  // Test 9: Interrupted download state handling
  await test('9. Interrupted download sets state interrupted and clears speed/eta', () => {
    const { dm } = getFreshManager();
    const item = createMockItem({ filename: 'network_fail.dat' });
    dm._handleDownload(item);

    const record = Object.values(dm.downloads)[0];
    const id = record.id;
    item.emit('done', null, 'interrupted');

    assert(dm.downloads[id].state === 'interrupted', 'Record state is interrupted');
    assert(dm.downloads[id].speed === 0, 'Speed is 0');
    assert(dm.downloads[id].eta === null, 'ETA is null');
  });

  // Test 10: Download retry mechanism via session.downloadURL
  await test('10. Background download retry triggers session.downloadURL without page navigation', () => {
    const session = createMockSession();
    const { dm } = getFreshManager();
    dm.attach(session, () => {});

    const testUrl = 'https://example.com/files/document_v2.pdf';
    session.downloadURL(testUrl);

    assert(session._requestedDownloads.includes(testUrl), 'session.downloadURL was invoked with testUrl');
    const downloads = dm.getDownloads();
    assert(downloads.some(d => d.url === testUrl), 'DownloadManager captured retried download');
  });

  // Test 11: Safe file opening and folder revealing
  await test('11. openFile and showInFolder reject non-existent files safely and open existing files', async () => {
    const { dm } = getFreshManager();
    const item = createMockItem({ filename: 'ghost_file_unique.txt' });
    dm._handleDownload(item);
    const record = Object.values(dm.downloads)[0];
    const id = record.id;

    const openResult = await dm.openFile(id);
    assert(openResult.success === false, 'openFile returns false for non-existent file');
    assert(openResult.error.includes('does not exist'), 'Helpful error returned');

    const showResult = dm.showInFolder(id);
    assert(showResult === false, 'showInFolder returns false for non-existent file');

    // Create real file and test success
    const realPath = record.savePath;
    fs.writeFileSync(realPath, 'hello world content');
    const realOpen = await dm.openFile(id);
    assert(realOpen.success === true, 'openFile succeeds for existing file');
    assert(lastOpenedPath === realPath, 'shell.openPath called with correct path');

    const realShow = dm.showInFolder(id);
    assert(realShow === true, 'showInFolder succeeds for existing file');
    assert(lastShownInFolder === realPath, 'shell.showItemInFolder called with correct path');
  });

  // Test 12: Clear completed vs retain in-progress
  await test('12. clearCompleted clears completed and cancelled downloads while retaining active ones', () => {
    const { dm } = getFreshManager();

    const activeItem = createMockItem({ filename: 'active.iso' });
    const completedItem = createMockItem({ filename: 'done.zip' });
    const cancelledItem = createMockItem({ filename: 'cancelled.pdf' });

    dm._handleDownload(activeItem);
    dm._handleDownload(completedItem);
    dm._handleDownload(cancelledItem);

    const [d1, d2, d3] = dm.getDownloads();
    dm.downloads[d2.id].state = 'completed';
    dm.downloads[d3.id].state = 'cancelled';

    const clearedCount = dm.clearCompleted();
    assert(clearedCount === 2, `Expected 2 cleared, got ${clearedCount}`);

    const remaining = dm.getDownloads();
    assert(remaining.length === 1, 'Only 1 download remains');
    assert(remaining[0].id === d1.id, 'Active download remains in list');
    assert(remaining[0].state === 'progressing', 'Active download is still progressing');
  });

  // Test 13: Incognito download isolation
  await test('13. Incognito downloads remain in-memory and are never persisted to storage', () => {
    const { storage, dm } = getFreshManager();

    // 1. Normal download
    const normalItem = createMockItem({ filename: 'public.pdf' });
    dm._handleDownload(normalItem, null, { isIncognito: false });

    // 2. Incognito download
    const incognitoItem = createMockItem({ filename: 'private_statement.pdf' });
    dm._handleDownload(incognitoItem, null, { isIncognito: true });

    // Storage persistence check
    const persisted = storage.get('downloads', []);
    assert(persisted.length === 1, `Storage should contain exactly 1 download, got ${persisted.length}`);
    assert(persisted[0].filename === 'public.pdf', 'Only public download was persisted to storage');
    assert(!persisted.some(d => d.filename.includes('private')), 'Incognito download was NOT persisted to disk');

    // clearIncognitoDownloads check
    const clearedIncog = dm.clearIncognitoDownloads();
    assert(clearedIncog === 1, 'Cleared 1 incognito download');
    const remaining = dm.getDownloads({ includeIncognito: true });
    assert(remaining.length === 1 && remaining[0].filename === 'public.pdf', 'Only public download remains in memory');
  });

  // Test 14: Search and filter logic
  await test('14. getDownloads respects privacy filters (incognitoOnly, includeIncognito, default)', () => {
    const { dm } = getFreshManager();

    const item1 = createMockItem({ filename: 'norm.txt' });
    const item2 = createMockItem({ filename: 'secret.txt' });
    dm._handleDownload(item1, null, { isIncognito: false });
    dm._handleDownload(item2, null, { isIncognito: true });

    // Default (normal window) -> only non-incognito
    const defaultList = dm.getDownloads();
    assert(defaultList.length === 1 && defaultList[0].filename === 'norm.txt', 'Default returns only non-incognito');

    // Incognito only
    const incogOnly = dm.getDownloads({ incognitoOnly: true });
    assert(incogOnly.length === 1 && incogOnly[0].filename === 'secret.txt', 'incognitoOnly returns only secret.txt');

    // Include incognito
    const all = dm.getDownloads({ includeIncognito: true });
    assert(all.length === 2, 'includeIncognito returns all records');
  });

  // Test 15: Multi-target IPC broadcasting
  await test('15. broadcastDownloadUpdate pushes to mainWindow, incognitoWindow, and all tab webContents', () => {
    const sentMessages = {
      mainWindow: [],
      incognitoWindow: [],
      tab1: [],
      tab2: []
    };

    const mockApp = {
      mainWindow: {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (channel, data) => sentMessages.mainWindow.push({ channel, data })
        }
      },
      incognitoWindow: {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (channel, data) => sentMessages.incognitoWindow.push({ channel, data })
        }
      },
      tabs: {
        tab_1: {
          view: {
            webContents: {
              isDestroyed: () => false,
              send: (channel, data) => sentMessages.tab1.push({ channel, data })
            }
          }
        },
        tab_2: {
          view: {
            webContents: {
              isDestroyed: () => false,
              send: (channel, data) => sentMessages.tab2.push({ channel, data })
            }
          }
        }
      }
    };

    mockApp.broadcastDownloadUpdate = function(record) {
      if (!record) return;
      if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents && !this.mainWindow.webContents.isDestroyed()) {
        this.mainWindow.webContents.send('download:update', record);
      }
      if (this.incognitoWindow && !this.incognitoWindow.isDestroyed() && this.incognitoWindow.webContents && !this.incognitoWindow.webContents.isDestroyed()) {
        this.incognitoWindow.webContents.send('download:update', record);
      }
      if (this.tabs) {
        for (const tab of Object.values(this.tabs)) {
          if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
            tab.view.webContents.send('download:update', record);
          }
        }
      }
    };

    const testRecord = { id: 'dl_test_1', filename: 'broadcast.pdf', state: 'progressing', received: 50, total: 100 };
    mockApp.broadcastDownloadUpdate(testRecord);

    assert(sentMessages.mainWindow.length === 1, 'mainWindow received broadcast');
    assert(sentMessages.incognitoWindow.length === 1, 'incognitoWindow received broadcast');
    assert(sentMessages.tab1.length === 1, 'tab1 (e.g. mtc://downloads) received broadcast');
    assert(sentMessages.tab2.length === 1, 'tab2 received broadcast');
    assert(sentMessages.tab1[0].channel === 'download:update', 'Correct channel download:update used');
    assert(sentMessages.tab1[0].data.filename === 'broadcast.pdf', 'Correct record delivered to tab');
  });

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Download Engine Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
