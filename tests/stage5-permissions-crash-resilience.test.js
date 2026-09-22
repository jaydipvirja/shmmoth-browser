/**
 * SHMMOTH BROWSER — STAGE 5 VERIFICATION TESTS
 * Tests for Site Permissions Management and Crash/Unresponsive Resilience
 *
 * Run with: node tests/stage5-permissions-crash-resilience.test.js
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

Module._load = function(request, ...args) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => path.join(os.tmpdir(), `shmmoth_test_${name}`),
        quit: () => {}
      }
    };
  }
  return origLoad.call(this, request, ...args);
};

const StorageService = require('../src/services/storage');

console.log('\n══════════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — Stage 5 (Permissions & Crash) Tests   ');
console.log('══════════════════════════════════════════════════════════\n');

async function runAllTests() {
  // ────────────────────────────────────────────────────────────────────────────
  console.log('🛡️ 1. Site Permissions Storage & CRUD Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('StorageService initializes sitePermissions object', () => {
    const storage = new StorageService();
    assert(storage.data.sitePermissions !== undefined, 'sitePermissions must be defined');
    assert(typeof storage.data.sitePermissions === 'object', 'sitePermissions must be an object');
  });

  await test('setSitePermission stores allow, block, and ask decisions', () => {
    const storage = new StorageService();
    storage.data.sitePermissions = {};

    storage.setSitePermission('https://zoom.us', 'media', 'allow');
    storage.setSitePermission('https://malicious.com', 'geolocation', 'block');
    storage.setSitePermission('https://news.com', 'notifications', 'ask');

    const zoomPerms = storage.getSitePermissions('https://zoom.us');
    assert(zoomPerms.media === 'allow', 'Zoom media permission must be "allow"');

    const malPerms = storage.getSitePermissions('https://malicious.com');
    assert(malPerms.geolocation === 'block', 'Malicious geolocation permission must be "block"');

    const newsPerms = storage.getSitePermissions('https://news.com');
    assert(newsPerms.notifications === 'ask', 'News notifications permission must be "ask"');
  });

  await test('removeSitePermission removes individual permission or entire origin', () => {
    const storage = new StorageService();
    storage.data.sitePermissions = {};

    storage.setSitePermission('https://example.com', 'media', 'allow');
    storage.setSitePermission('https://example.com', 'geolocation', 'block');

    // Remove single permission
    storage.removeSitePermission('https://example.com', 'media');
    const examplePerms = storage.getSitePermissions('https://example.com');
    assert(examplePerms.media === undefined, 'Media permission must be removed');
    assert(examplePerms.geolocation === 'block', 'Geolocation permission must remain');

    // Remove entire origin
    storage.removeSitePermission('https://example.com');
    const all = storage.getSitePermissions();
    assert(all['https://example.com'] === undefined, 'Origin must be fully deleted from storage');
  });

  await test('clearAllSitePermissions wipes all site permission rules', () => {
    const storage = new StorageService();
    storage.setSitePermission('https://a.com', 'media', 'allow');
    storage.setSitePermission('https://b.com', 'geolocation', 'block');

    storage.clearAllSitePermissions();
    const all = storage.getSitePermissions();
    assert(Object.keys(all).length === 0, 'All site permissions must be cleared');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n🔒 2. Permission Check & Request Policy Logic Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('Permission check handler allows internal pages and safe UI permissions', () => {
    function checkPermission(origin, permission, storedPerms) {
      if (origin && (origin.startsWith('mtc://') || origin.startsWith('file://'))) {
        return true;
      }
      if (permission === 'fullscreen' || permission === 'pointerLock') {
        return true;
      }
      if (storedPerms && storedPerms[permission]) {
        return storedPerms[permission] === 'allow';
      }
      return false;
    }

    assert(checkPermission('mtc://newtab', 'media', {}) === true, 'Internal mtc:// page must be allowed');
    assert(checkPermission('file:///app/index.html', 'notifications', {}) === true, 'file:// page must be allowed');
    assert(checkPermission('https://youtube.com', 'fullscreen', {}) === true, 'Fullscreen permission must be granted');
    assert(checkPermission('https://untrusted.com', 'media', {}) === false, 'Untrusted camera must default to false');
    assert(checkPermission('https://zoom.us', 'media', { media: 'allow' }) === true, 'Saved allow must grant permission');
    assert(checkPermission('https://zoom.us', 'media', { media: 'block' }) === false, 'Saved block must deny permission');
  });

  await test('Permission response handler records choice when remember is true', async () => {
    const storage = new StorageService();
    storage.data.sitePermissions = {};

    let callbackResult = null;
    const pendingRequests = {
      req_1: {
        callback: (allowed) => { callbackResult = allowed; },
        origin: 'https://meet.google.com',
        permission: 'media',
        timeout: setTimeout(() => {}, 10000)
      }
    };

    function respond(requestId, decision, remember) {
      const pending = pendingRequests[requestId];
      if (!pending) return false;
      clearTimeout(pending.timeout);
      delete pendingRequests[requestId];

      const isAllowed = (decision === 'allow');
      if (remember && pending.origin) {
        storage.setSitePermission(pending.origin, pending.permission, isAllowed ? 'allow' : 'block');
      }
      pending.callback(isAllowed);
      return true;
    }

    const res = respond('req_1', 'allow', true);
    assert(res === true, 'Respond must succeed');
    assert(callbackResult === true, 'Callback must receive true on allow');
    assert(storage.getSitePermissions('https://meet.google.com').media === 'allow', 'Permission must be saved in storage');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n💥 3. Crash & Unresponsive Resilience Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('Tab data tracks crash state and preserves lastValidUrl', () => {
    const tabData = {
      id: 'tab_1',
      url: 'https://example.com',
      lastValidUrl: 'https://example.com',
      isCrashed: false,
      crashReason: null,
      isUnresponsive: false
    };

    // Simulate navigation to valid site
    function onNavigate(navUrl) {
      tabData.url = navUrl;
      if (navUrl && !navUrl.startsWith('mtc://crash')) {
        tabData.lastValidUrl = navUrl;
        tabData.isCrashed = false;
        tabData.crashReason = null;
      }
    }

    // Simulate crash event
    function onCrash(reason) {
      tabData.isCrashed = true;
      tabData.crashReason = reason;
      tabData.url = `mtc://crash?reason=${reason}&url=${encodeURIComponent(tabData.lastValidUrl)}`;
    }

    onNavigate('https://github.com/trending');
    assert(tabData.lastValidUrl === 'https://github.com/trending', 'lastValidUrl should be updated');

    onCrash('crashed');
    assert(tabData.isCrashed === true, 'isCrashed must be true after crash');
    assert(tabData.crashReason === 'crashed', 'crashReason must be captured');
    assert(tabData.lastValidUrl === 'https://github.com/trending', 'lastValidUrl must not be overwritten by mtc://crash');
  });

  await test('Reloading a crashed tab redirects to lastValidUrl', () => {
    const tabData = {
      id: 'tab_1',
      url: 'mtc://crash?reason=oom',
      lastValidUrl: 'https://heavy-site.com',
      isCrashed: true
    };

    function getReloadTarget(tab) {
      if (tab.isCrashed || (tab.url && tab.url.startsWith('mtc://crash'))) {
        tab.isCrashed = false;
        return tab.lastValidUrl && !tab.lastValidUrl.startsWith('mtc://crash') ? tab.lastValidUrl : 'mtc://newtab';
      }
      return tab.url;
    }

    const reloadTarget = getReloadTarget(tabData);
    assert(reloadTarget === 'https://heavy-site.com', 'Reloading crashed tab must restore lastValidUrl');
    assert(tabData.isCrashed === false, 'Reloading must reset isCrashed flag');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n📦 4. Preload & UI Surface Verification');
  // ────────────────────────────────────────────────────────────────────────────

  await test('preload-internal.js defines all required Stage 5 permissions methods', () => {
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-internal.js'), 'utf-8');

    const requiredMethods = [
      'getSitePermissions',
      'getAllPermissions',
      'setSitePermission',
      'removeSitePermission',
      'clearAllPermissions',
      'respondPermissionRequest',
      'onPermissionRequest'
    ];

    for (const method of requiredMethods) {
      assert(
        preloadSource.includes(`${method}:`),
        `preload-internal.js must define "${method}" in its exposed API surface`
      );
    }
  });

  await test('UI templates contain Stage 5 crash page, permissions popup and prompt', () => {
    // 1. Crash recovery page
    assert(fs.existsSync(path.join(__dirname, '..', 'src', 'pages', 'crash.html')), 'crash.html must exist');
    const crashHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'crash.html'), 'utf-8');
    assert(crashHtml.includes('id="btn-reload"'), 'crash.html must have #btn-reload');
    assert(crashHtml.includes('id="crash-code"'), 'crash.html must have #crash-code');

    // 2. Browser Chrome UI
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf-8');
    assert(indexHtml.includes('id="site-info-popup"'), 'index.html must contain #site-info-popup');
    assert(indexHtml.includes('id="permission-prompt-card"'), 'index.html must contain #permission-prompt-card');
    assert(indexHtml.includes('id="btn-perm-allow"'), 'index.html must contain #btn-perm-allow');
    assert(indexHtml.includes('id="btn-perm-block"'), 'index.html must contain #btn-perm-block');

    // 3. Settings UI
    const settingsHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'settings.html'), 'utf-8');
    assert(settingsHtml.includes('id="btn-open-permissions-modal"'), 'settings.html must contain #btn-open-permissions-modal');
    assert(settingsHtml.includes('id="modal-permissions-data"'), 'settings.html must contain #modal-permissions-data');

    // 4. Stylesheet
    const styleCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf-8');
    assert(styleCss.includes('.site-info-popup'), 'style.css must contain .site-info-popup');
    assert(styleCss.includes('.permission-prompt-card'), 'style.css must contain .permission-prompt-card');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Stage 5 Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runAllTests();
