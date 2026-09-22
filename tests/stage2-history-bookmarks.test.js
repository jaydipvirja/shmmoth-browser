/**
 * SHMMOTH BROWSER — STAGE 2 VERIFICATION TESTS
 * Tests for History and Bookmarks
 *
 * Run with: node tests/stage2-history-bookmarks.test.js
 */

'use strict';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
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

// Patch electron app.getPath for isolated testing
const os = require('os');
const path = require('path');
const fs = require('fs');

const Module = require('module');
const origLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'electron') {
    return {
      app: { getPath: () => os.tmpdir() }
    };
  }
  return origLoad.call(this, request, ...args);
};

const StorageService = require('../src/services/storage');

console.log('\n══════════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — Stage 2 (History & Bookmarks) Tests   ');
console.log('══════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
console.log('📋 1. History System Tests');
// ────────────────────────────────────────────────────────────────────────────

test('addHistory creates record with visitCount: 1 and visitTime', () => {
  const storage = new StorageService();
  storage.data.history = [];

  storage.addHistory({ title: 'GitHub', url: 'https://github.com', favicon: 'https://github.com/fav.png' });

  const history = storage.getHistory();
  assert(history.length === 1, `Expected 1 item, got ${history.length}`);
  assert(history[0].url === 'https://github.com');
  assert(history[0].title === 'GitHub');
  assert(history[0].visitCount === 1, `Expected visitCount: 1, got ${history[0].visitCount}`);
  assert(typeof history[0].visitTime === 'number');
});

test('addHistory increments visitCount and moves existing item to top on revisit', () => {
  const storage = new StorageService();
  storage.data.history = [];

  storage.addHistory({ title: 'Page A', url: 'https://a.com' });
  storage.addHistory({ title: 'Page B', url: 'https://b.com' });
  storage.addHistory({ title: 'Page A Revisited', url: 'https://a.com' });

  const history = storage.getHistory();
  assert(history.length === 2, `Expected 2 unique URLs in history, got ${history.length}`);
  assert(history[0].url === 'https://a.com', 'Revisited URL should be brought to top');
  assert(history[0].visitCount === 2, `Expected visitCount 2, got ${history[0].visitCount}`);
  assert(history[0].title === 'Page A Revisited');
});

test('addHistory ignores mtc:// internal and about: URLs', () => {
  const storage = new StorageService();
  storage.data.history = [];

  storage.addHistory({ title: 'New Tab', url: 'mtc://newtab' });
  storage.addHistory({ title: 'Settings', url: 'mtc://settings' });
  storage.addHistory({ title: 'Blank', url: 'about:blank' });

  assert(storage.getHistory().length === 0, 'Internal pages should not be recorded in history');
});

test('getHistory with search query filters title and URL', () => {
  const storage = new StorageService();
  storage.data.history = [
    { id: '1', title: 'Rust Programming Language', url: 'https://rust-lang.org', visitTime: Date.now(), visitCount: 1 },
    { id: '2', title: 'Python Docs', url: 'https://docs.python.org', visitTime: Date.now(), visitCount: 1 },
    { id: '3', title: 'Learn TypeScript', url: 'https://typescriptlang.org', visitTime: Date.now(), visitCount: 1 }
  ];

  const rustResults = storage.getHistory('rust');
  assert(rustResults.length === 1 && rustResults[0].title.includes('Rust'));

  const docResults = storage.getHistory('docs');
  assert(docResults.length === 1 && docResults[0].url.includes('docs.python'));

  const allResults = storage.getHistory('');
  assert(allResults.length === 3);
});

test('deleteHistoryItem and deleteHistoryItems remove records', () => {
  const storage = new StorageService();
  storage.data.history = [
    { id: 'h1', url: 'https://1.com' },
    { id: 'h2', url: 'https://2.com' },
    { id: 'h3', url: 'https://3.com' },
    { id: 'h4', url: 'https://4.com' }
  ];

  storage.deleteHistoryItem('h1');
  assert(storage.getHistory().length === 3);
  assert(!storage.getHistory().some(h => h.id === 'h1'));

  storage.deleteHistoryItems(['h2', 'h3']);
  assert(storage.getHistory().length === 1);
  assert(storage.getHistory()[0].id === 'h4');
});

test('clearHistoryByRange filters by time cutoff correctly', () => {
  const storage = new StorageService();
  const now = Date.now();

  storage.data.history = [
    { id: 'recent_10m', url: 'https://recent.com', visitTime: now - (10 * 60 * 1000) },      // 10 mins ago
    { id: 'old_3h',     url: 'https://3h.com',     visitTime: now - (3 * 3600 * 1000) },      // 3 hours ago
    { id: 'old_2d',     url: 'https://2d.com',     visitTime: now - (2 * 86400 * 1000) },     // 2 days ago
    { id: 'old_10d',    url: 'https://10d.com',    visitTime: now - (10 * 86400 * 1000) }     // 10 days ago
  ];

  // Clear last hour: only recent_10m should be deleted, others remain
  storage.clearHistoryByRange('hour');
  let history = storage.getHistory();
  assert(history.length === 3);
  assert(!history.some(h => h.id === 'recent_10m'));
  assert(history.some(h => h.id === 'old_3h'));

  // Clear last 24h (day): old_3h should be deleted, 2d and 10d remain
  storage.clearHistoryByRange('day');
  history = storage.getHistory();
  assert(history.length === 2);
  assert(!history.some(h => h.id === 'old_3h'));

  // Clear all
  storage.clearHistoryByRange('all');
  assert(storage.getHistory().length === 0);
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n📋 2. Bookmarks System Tests');
// ────────────────────────────────────────────────────────────────────────────

test('addBookmark saves bookmark with folder, createdAt, updatedAt', () => {
  const storage = new StorageService();
  storage.data.bookmarks = [];

  storage.addBookmark({ title: 'Example', url: 'https://example.com', folder: 'Bookmarks Bar' });

  const bms = storage.getBookmarks();
  assert(bms.length === 1);
  assert(bms[0].title === 'Example');
  assert(bms[0].folder === 'Bookmarks Bar');
  assert(typeof bms[0].createdAt === 'number');
  assert(typeof bms[0].updatedAt === 'number');
});

test('Folder management: addBookmarkFolder and removeBookmarkFolder', () => {
  const storage = new StorageService();
  storage.data.bookmarkFolders = ['Bookmarks Bar', 'Other Bookmarks'];
  storage.data.bookmarks = [];

  // Add custom folder
  storage.addBookmarkFolder('Work');
  assert(storage.getBookmarkFolders().includes('Work'));

  // Add bookmark into Work folder
  storage.addBookmark({ title: 'Company Jira', url: 'https://jira.company.com', folder: 'Work' });

  // Delete Work folder: bookmarks inside must be moved to 'Other Bookmarks'
  storage.removeBookmarkFolder('Work');
  assert(!storage.getBookmarkFolders().includes('Work'));

  const jiraBm = storage.getBookmarks().find(b => b.url === 'https://jira.company.com');
  assert(jiraBm && jiraBm.folder === 'Other Bookmarks', 'Bookmark should be moved to Other Bookmarks');

  // Protected folders cannot be removed
  storage.removeBookmarkFolder('Bookmarks Bar');
  assert(storage.getBookmarkFolders().includes('Bookmarks Bar'), 'Bookmarks Bar is protected');
});

test('editBookmark updates title, url, and folder', () => {
  const storage = new StorageService();
  storage.data.bookmarks = [
    { id: 'bm_test', title: 'Old Title', url: 'https://old.com', folder: 'Bookmarks Bar', createdAt: 100, updatedAt: 100 }
  ];

  const updated = storage.editBookmark('bm_test', { title: 'New Title', url: 'https://new.com', folder: 'Other Bookmarks' });
  assert(updated !== null);
  assert(updated.title === 'New Title');
  assert(updated.url === 'https://new.com');
  assert(updated.folder === 'Other Bookmarks');
  assert(updated.updatedAt > 100);
});

test('searchBookmarks searches title, url, and folder', () => {
  const storage = new StorageService();
  storage.data.bookmarks = [
    { id: '1', title: 'Stripe Dashboard', url: 'https://dashboard.stripe.com', folder: 'Finance' },
    { id: '2', title: 'Vercel Analytics', url: 'https://vercel.com',           folder: 'DevOps' },
    { id: '3', title: 'Hacker News',      url: 'https://news.ycombinator.com', folder: 'Reading' }
  ];

  assert(storage.searchBookmarks('stripe').length === 1);
  assert(storage.searchBookmarks('ycombinator').length === 1);
  assert(storage.searchBookmarks('Finance').length === 1);
  assert(storage.searchBookmarks('nonexistent').length === 0);
});

test('removeBookmark removes by ID or by URL', () => {
  const storage = new StorageService();
  storage.data.bookmarks = [
    { id: 'bm_1', url: 'https://1.com' },
    { id: 'bm_2', url: 'https://2.com' }
  ];

  storage.removeBookmark('bm_1');
  assert(storage.getBookmarks().length === 1);

  storage.removeBookmark('https://2.com');
  assert(storage.getBookmarks().length === 0);
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n📋 3. Preload Stage 2 Surface Verification');
// ────────────────────────────────────────────────────────────────────────────

test('preload-internal.js defines all Stage 2 History and Bookmarks methods', () => {
  const content = fs.readFileSync(require.resolve('../src/preload-internal.js'), 'utf-8');

  const requiredMethods = [
    'getBookmarks',
    'getBookmarkFolders',
    'addBookmarkFolder',
    'removeBookmarkFolder',
    'addBookmark',
    'editBookmark',
    'moveBookmark',
    'removeBookmark',
    'searchBookmarks',
    'getHistory',
    'clearHistory',
    'clearHistoryByRange',
    'deleteHistoryItem',
    'deleteHistoryItems'
  ];

  for (const method of requiredMethods) {
    assert(content.includes(method), `preload-internal.js missing Stage 2 method: ${method}`);
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  Stage 2 Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
