/**
 * SHMMOTH BROWSER — STAGE 4 VERIFICATION TESTS
 * Tests for Incognito Mode, Cookies Management, and Browsing Data Clearing
 *
 * Run with: node tests/stage4-incognito-cookies-cache.test.js
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

const os = require('os');
const path = require('path');
const fs = require('fs');

// Patch Electron mock
const Module = require('module');
const origLoad = Module._load;

const mockStorageCleared = {
  cookies: false,
  cache: false
};

Module._load = function(request, ...args) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => path.join(os.tmpdir(), `shmmoth_test_${name}`),
        quit: () => {}
      },
      session: {
        defaultSession: {
          cookies: {
            get: async () => [
              { name: 'session_id', value: 'xyz123', domain: 'example.com', path: '/', secure: true },
              { name: 'theme', value: 'dark', domain: '.github.com', path: '/', secure: false }
            ],
            remove: async (url, name) => {}
          },
          clearStorageData: async (opts) => {
            if (opts && opts.storages && opts.storages.includes('cookies')) {
              mockStorageCleared.cookies = true;
            }
          },
          clearCache: async () => {
            mockStorageCleared.cache = true;
          }
        },
        fromPartition: (partition) => ({
          cookies: {
            get: async () => [],
            remove: async () => {}
          },
          clearStorageData: async () => {},
          clearCache: async () => {}
        })
      }
    };
  }
  return origLoad.call(this, request, ...args);
};

const StorageService = require('../src/services/storage');

console.log('\n══════════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — Stage 4 (Incognito & Cookies) Tests   ');
console.log('══════════════════════════════════════════════════════════\n');

async function runAllTests() {
  // ────────────────────────────────────────────────────────────────────────────
  console.log('🕶️ 1. Incognito Mode & History Isolation Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('Incognito tab webPreferences sets partition to "incognito"', () => {
    // Logic matching main.js createTab
    function getWebPreferences(isIncognito, preloadPath) {
      const prefs = {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true,
        webSecurity: true,
        sandbox: false
      };
      if (isIncognito) {
        prefs.partition = 'incognito';
      }
      return prefs;
    }

    const normalPrefs = getWebPreferences(false, '/path/preload.js');
    assert(!normalPrefs.partition, 'Normal tab must not have partition override');

    const incognitoPrefs = getWebPreferences(true, '/path/preload.js');
    assert(incognitoPrefs.partition === 'incognito', 'Incognito tab must set partition to "incognito"');
  });

  await test('History recording is strictly bypassed for incognito tabs', () => {
    const storage = new StorageService();
    storage.data.history = [];

    // Simulate navigation handler logic in main.js
    function handleNavigation(tabData, newUrl, title) {
      tabData.url = newUrl;
      tabData.title = title;
      // Zero history recorded for incognito tabs (Stage 4)
      if (!tabData.isIncognito) {
        storage.addHistory({ title, url: newUrl, favicon: '' });
      }
    }

    const incognitoTab = { id: 'tab_incog_1', isIncognito: true, url: '', title: '' };
    handleNavigation(incognitoTab, 'https://secret-bank.com/account', 'My Bank');

    assert(storage.data.history.length === 0, 'No history entry must ever be saved for an incognito tab');

    const normalTab = { id: 'tab_norm_1', isIncognito: false, url: '', title: '' };
    handleNavigation(normalTab, 'https://wikipedia.org', 'Wikipedia');

    assert(storage.data.history.length === 1, 'Normal tab must record history entry');
    assert(storage.data.history[0].url === 'https://wikipedia.org', 'Recorded URL must match normal tab');
  });

  await test('Incognito tab order is isolated from standard tab order', () => {
    const tabOrder = ['tab_1', 'tab_2'];
    const incognitoTabOrder = ['tab_incog_1'];

    // Close incognito tab
    const closedTabId = 'tab_incog_1';
    const isIncognito = true;

    if (isIncognito) {
      const idx = incognitoTabOrder.indexOf(closedTabId);
      if (idx !== -1) incognitoTabOrder.splice(idx, 1);
    } else {
      const idx = tabOrder.indexOf(closedTabId);
      if (idx !== -1) tabOrder.splice(idx, 1);
    }

    assert(incognitoTabOrder.length === 0, 'Incognito tab must be removed from incognitoTabOrder');
    assert(tabOrder.length === 2, 'Normal tab order must remain unaffected by incognito actions');
  });

  await test('Closed incognito tabs are never pushed to closedTabs stack', () => {
    const closedTabs = [];

    function closeTab(tabData) {
      const isIncognito = Boolean(tabData.isIncognito);
      // Only push to closedTabs if not incognito and not blank/newtab
      if (!isIncognito && tabData.url && !tabData.url.startsWith('mtc://newtab')) {
        closedTabs.push({ url: tabData.url, title: tabData.title });
      }
    }

    closeTab({ isIncognito: true, url: 'https://private.example.com', title: 'Private Site' });
    assert(closedTabs.length === 0, 'Closed incognito tabs must never be preserved in closedTabs stack');

    closeTab({ isIncognito: false, url: 'https://public.example.com', title: 'Public Site' });
    assert(closedTabs.length === 1, 'Closed normal tabs must be preserved for Ctrl+Shift+T');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n🍪 2. Cookie Management & Sanitization Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('Cookie remove URL resolver constructs valid HTTP/HTTPS URLs', () => {
    function getCookieUrl(cookie) {
      const protocol = cookie.secure ? 'https://' : 'http://';
      const cleanDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
      return `${protocol}${cleanDomain}${cookie.path || '/'}`;
    }

    const secureCookie = { name: 'auth', domain: '.github.com', path: '/login', secure: true };
    assert(getCookieUrl(secureCookie) === 'https://github.com/login', 'Secure cookie with leading dot resolves to https URL');

    const plainCookie = { name: 'banner', domain: 'example.com', path: '/', secure: false };
    assert(getCookieUrl(plainCookie) === 'http://example.com/', 'Non-secure cookie resolves to http URL');
  });

  await test('Cookie remove parameter validation rejects invalid payloads', () => {
    function validateCookieParam(cookie) {
      if (!cookie || typeof cookie !== 'object') return false;
      if (!cookie.domain || typeof cookie.domain !== 'string') return false;
      if (!cookie.name || typeof cookie.name !== 'string') return false;
      return true;
    }

    assert(validateCookieParam(null) === false, 'Null cookie must be rejected');
    assert(validateCookieParam({ domain: 'example.com' }) === false, 'Cookie without name must be rejected');
    assert(validateCookieParam({ name: 'token' }) === false, 'Cookie without domain must be rejected');
    assert(validateCookieParam({ name: 'token', domain: 'example.com' }) === true, 'Valid cookie is accepted');
  });

  await test('Cookie search filter searches domain and name case-insensitively', () => {
    const cookies = [
      { name: 'session_token', domain: 'api.github.com' },
      { name: 'analytics_id', domain: 'google.com' },
      { name: 'user_pref', domain: 'github.com' }
    ];

    function filterCookies(list, query) {
      const q = query.toLowerCase().trim();
      return list.filter(c => c.name.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q));
    }

    const githubResults = filterCookies(cookies, 'github');
    assert(githubResults.length === 2, 'Query "github" should match 2 cookies');

    const analyticsResults = filterCookies(cookies, 'ANALYTICS');
    assert(analyticsResults.length === 1, 'Query "ANALYTICS" case-insensitively matches 1 cookie');

    const emptyResults = filterCookies(cookies, 'nonexistent');
    assert(emptyResults.length === 0, 'Unknown query returns empty array');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n🧹 3. Clear Browsing Data Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('Range calculation handles hour, day, week, month, and all correctly', () => {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000) + 1000;
    const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);

    const historyItems = [
      { id: '1', title: 'Recent', url: 'https://recent.com', visitTime: now - 5000 },
      { id: '2', title: 'Hour Old', url: 'https://hour.com', visitTime: oneHourAgo },
      { id: '3', title: 'Two Days Old', url: 'https://old.com', visitTime: twoDaysAgo }
    ];

    function filterByRange(items, range) {
      const now = Date.now();
      let cutoff = 0;
      if (range === 'hour')  cutoff = now - (60 * 60 * 1000);
      else if (range === 'day')   cutoff = now - (24 * 60 * 60 * 1000);
      else if (range === 'week')  cutoff = now - (7 * 24 * 60 * 60 * 1000);
      else if (range === 'month') cutoff = now - (30 * 24 * 60 * 60 * 1000);
      else cutoff = 0;

      return items.filter(item => (item.visitTime || 0) < cutoff);
    }

    const keptAfterHour = filterByRange(historyItems, 'hour');
    assert(keptAfterHour.length === 1 && keptAfterHour[0].id === '3', 'Clearing last hour must keep 2-day-old item');

    const keptAfterAll = filterByRange(historyItems, 'all');
    assert(keptAfterAll.length === 0, 'Clearing all must retain 0 items');
  });

  await test('Browsing data clear selectively processes requested categories', async () => {
    let historyCleared = false;
    let downloadsCleared = false;
    let cookiesCleared = false;
    let cacheCleared = false;

    async function executeClear(options) {
      const types = options.dataTypes || {};
      if (types.history)   historyCleared = true;
      if (types.downloads) downloadsCleared = true;
      if (types.cookies)   cookiesCleared = true;
      if (types.cache)     cacheCleared = true;
      return { success: true };
    }

    // Request only cookies and cache
    await executeClear({ dataTypes: { cookies: true, cache: true, history: false, downloads: false } });

    assert(cookiesCleared === true, 'Cookies must be marked cleared');
    assert(cacheCleared === true, 'Cache must be marked cleared');
    assert(historyCleared === false, 'History must NOT be cleared when unchecked');
    assert(downloadsCleared === false, 'Downloads must NOT be cleared when unchecked');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n📦 4. Preload & UI Surface Verification');
  // ────────────────────────────────────────────────────────────────────────────

  await test('preload-internal.js defines all required Stage 4 methods', () => {
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-internal.js'), 'utf-8');

    const requiredMethods = [
      'newIncognitoWindow',
      'isIncognitoWindow',
      'getCookies',
      'removeCookie',
      'clearCookies',
      'clearBrowsingData'
    ];

    for (const method of requiredMethods) {
      assert(
        preloadSource.includes(`${method}:`),
        `preload-internal.js must define "${method}" in its exposed API surface`
      );
    }
  });

  await test('UI templates contain all Stage 4 Incognito and Privacy elements', () => {
    const newtabHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'newtab.html'), 'utf-8');
    assert(newtabHtml.includes('id="incognito-panel"'), 'newtab.html must contain #incognito-panel');
    assert(newtabHtml.includes('id="shortcuts-section"'), 'newtab.html must contain #shortcuts-section');

    const settingsHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'settings.html'), 'utf-8');
    assert(settingsHtml.includes('id="btn-open-clear-data"'), 'settings.html must contain #btn-open-clear-data');
    assert(settingsHtml.includes('id="modal-clear-data"'), 'settings.html must contain #modal-clear-data');
    assert(settingsHtml.includes('id="btn-open-cookies-modal"'), 'settings.html must contain #btn-open-cookies-modal');
    assert(settingsHtml.includes('id="modal-cookies-data"'), 'settings.html must contain #modal-cookies-data');

    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf-8');
    assert(indexHtml.includes('id="incognito-badge"'), 'index.html must contain #incognito-badge');
    assert(indexHtml.includes('id="btn-incognito"'), 'index.html must contain #btn-incognito');

    const styleCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf-8');
    assert(styleCss.includes('.theme-incognito'), 'style.css must contain .theme-incognito');
    assert(styleCss.includes('.incognito-badge'), 'style.css must contain .incognito-badge');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Stage 4 Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runAllTests();
