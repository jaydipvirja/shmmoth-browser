/**
 * SHMMOTH BROWSER — STAGE 7 EXTENSION SYSTEM TESTS (stage7-extensions.test.js)
 * Comprehensive automated verification covering all 19 Stage 7 requirements:
 *
 *   1. ExtensionManager initialization and empty registry
 *   2. Validate valid MV3 manifest
 *   3. Reject manifest missing required fields (name, version)
 *   4. Reject manifest with path traversal in background script
 *   5. Reject manifest with invalid manifest_version
 *   6. Load unpacked extension (Extension A)
 *   7. Extension metadata correctly parsed and stored
 *   8. Enable / disable extension lifecycle
 *   9. Extension persistence across restarts
 *  10. Permissions correctly parsed and categorized
 *  11. High-risk permissions flagged
 *  12. Reject extension requesting disallowed permissions
 *  13. Content script extension loads (Extension B)
 *  14. Extension uninstallation cleanly removes from registry
 *  15. Missing extension directory handled gracefully on startup
 *  16. Extension crash does not crash the browser (Extension D)
 *  17. Extensions cannot access internal mtcAPI / privileged channels
 *  18. Developer mode toggle state persistence
 *  19. Pinned extensions list management
 *
 * Run with: node tests/stage7-extensions.test.js
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

const testUserDataDir = path.join(os.tmpdir(), `shmmoth_test_stage7_${Date.now()}`);
fs.mkdirSync(testUserDataDir, { recursive: true });

Module._load = function (request, ...args) {
  if (request === 'electron') {
    return {
      app: {
        getPath: () => testUserDataDir,
        quit: () => {}
      },
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      }
    };
  }
  return origLoad.call(this, request, ...args);
};

const ExtensionManager = require('../src/services/extensionManager');

// Mock Electron Session for extension loading
class MockSession {
  constructor() {
    this.loadedExtensions = {};
  }

  async loadExtension(extPath, options = {}) {
    if (extPath.includes('extension-d-failing')) {
      throw new Error('Simulated extension service worker execution crash');
    }
    const manifestPath = path.join(extPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('manifest.json not found');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const id = path.basename(extPath).replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(32, 'a').slice(0, 32);
    const ext = {
      id,
      name: manifest.name,
      version: manifest.version,
      url: `chrome-extension://${id}/`,
      path: extPath,
      manifest
    };
    this.loadedExtensions[id] = ext;
    return ext;
  }

  async removeExtension(id) {
    delete this.loadedExtensions[id];
  }

  getAllExtensions() {
    return Object.values(this.loadedExtensions);
  }
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'extensions');
const EXT_A_DIR    = path.join(FIXTURES_DIR, 'extension-a-mv3');
const EXT_B_DIR    = path.join(FIXTURES_DIR, 'extension-b-permissions');
const EXT_C_DIR    = path.join(FIXTURES_DIR, 'extension-c-invalid');
const EXT_D_DIR    = path.join(FIXTURES_DIR, 'extension-d-failing');

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — Stage 7 Chromium Extension System Tests  ');
console.log('══════════════════════════════════════════════════════════════\n');

async function runAllTests() {
  const session = new MockSession();

  // ────────────────────────────────────────────────────────────────────────────
  console.log('🧩 1. ExtensionManager Core & Manifest Validation');
  // ────────────────────────────────────────────────────────────────────────────

  let manager;

  await test('1. ExtensionManager initialization and empty registry', () => {
    manager = new ExtensionManager(testUserDataDir);
    assert(manager !== null, 'ExtensionManager should instantiate');
    assert(typeof manager.extensions === 'object', 'Registry should be an object');
    assert(Object.keys(manager.extensions).length === 0, 'Initial registry should be empty');
    assert(manager.isDeveloperMode() === false, 'Developer mode should default to false');
  });

  await test('2. Validate valid MV3 manifest (Extension A)', () => {
    const val = manager.validateExtension(EXT_A_DIR);
    assert(val.valid === true, 'Validation should succeed for Extension A');
    assert(val.name === 'Test Action Extension', 'Extension name should match manifest');
    assert(val.version === '1.0.0', 'Version should match');
    assert(val.manifestVersion === 3, 'Manifest version should be 3');
    assert(val.isLegacyMV2 === false, 'Should not be flagged as legacy MV2');
    assert(val.id && val.id.length === 32, 'Deterministic extension ID should be 32 chars');
    assert(val.permissions.includes('storage'), 'Should declare storage permission');
    assert(val.permissions.includes('alarms'), 'Should declare alarms permission');
    assert(val.action && val.action.default_popup === 'popup.html', 'Action popup should be parsed');
  });

  await test('3. Reject manifest missing required fields (name, version)', () => {
    // Missing version (Extension C)
    let threw = false;
    try {
      manager.validateExtension(EXT_C_DIR);
    } catch (err) {
      threw = true;
      assert(err.message.includes('Manifest missing required field: version'), `Unexpected error: ${err.message}`);
    }
    assert(threw, 'Should throw for missing version');

    // Missing name
    const tempDir = path.join(os.tmpdir(), `shmmoth_temp_noname_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify({ version: '1.0.0', manifest_version: 3 }));
    threw = false;
    try {
      manager.validateExtension(tempDir);
    } catch (err) {
      threw = true;
      assert(err.message.includes('Manifest missing required field: name'), `Unexpected error: ${err.message}`);
    }
    assert(threw, 'Should throw for missing name');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await test('4. Reject manifest with path traversal in background script', () => {
    const tempDir = path.join(os.tmpdir(), `shmmoth_temp_traversal_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify({
      name: 'Malicious Traversal Extension',
      version: '1.0.0',
      manifest_version: 3,
      background: { service_worker: '../../evil.js' }
    }));

    let threw = false;
    try {
      manager.validateExtension(tempDir);
    } catch (err) {
      threw = true;
      assert(err.message.includes('Security error: Path traversal detected'), `Unexpected error: ${err.message}`);
    }
    assert(threw, 'Should reject path traversal sequence in background script');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await test('5. Reject manifest with invalid manifest_version', () => {
    const tempDir = path.join(os.tmpdir(), `shmmoth_temp_mv_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify({
      name: 'Unsupported MV Extension',
      version: '1.0.0',
      manifest_version: 99
    }));

    let threw = false;
    try {
      manager.validateExtension(tempDir);
    } catch (err) {
      threw = true;
      assert(err.message.includes('Unsupported manifest_version: 99'), `Unexpected error: ${err.message}`);
    }
    assert(threw, 'Should reject unsupported manifest version');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('📦 2. Lifecycle, Loading & Persistence');
  // ────────────────────────────────────────────────────────────────────────────

  let extARecord;

  await test('6. Load unpacked extension (Extension A)', async () => {
    extARecord = await manager.installUnpacked(EXT_A_DIR, { enabled: true });
    assert(extARecord !== null, 'Extension A should install successfully');
    assert(extARecord.name === 'Test Action Extension', 'Name should match');

    const loaded = await manager.loadIntoSession(session, extARecord.id);
    assert(loaded !== null, 'Should load into mock session');
    assert(extARecord.status === 'active', 'Status should be active');
    assert(session.getAllExtensions().length === 1, 'Mock session should have 1 active extension');
  });

  await test('7. Extension metadata correctly parsed and stored', () => {
    const details = manager.getExtensionDetails(extARecord.id);
    assert(details !== null, 'Should retrieve extension details');
    assert(details.id === extARecord.id, 'ID should match');
    assert(details.version === '1.0.0', 'Version should match');
    assert(details.path === path.resolve(EXT_A_DIR), 'Path should be resolved');
    assert(details.action && details.action.default_popup === 'popup.html', 'Action popup should match');
    assert(details.sizeBytes >= 0, 'Size in bytes should be calculated');
  });

  await test('8. Enable / disable extension lifecycle', async () => {
    // Disable
    await manager.disableExtension(extARecord.id, session);
    assert(extARecord.enabled === false, 'Extension should be marked disabled');
    assert(extARecord.status === 'disabled', 'Status should be disabled');
    assert(session.getAllExtensions().length === 0, 'Extension should be removed from session');

    // Re-enable
    await manager.enableExtension(extARecord.id, session);
    assert(extARecord.enabled === true, 'Extension should be marked enabled');
    assert(extARecord.status === 'active', 'Status should be active');
    assert(session.getAllExtensions().length === 1, 'Extension should be re-loaded into session');
  });

  await test('9. Extension persistence across restarts', () => {
    // Instantiate new ExtensionManager reading from the same directory
    const newManager = new ExtensionManager(testUserDataDir);
    assert(Object.keys(newManager.extensions).length >= 1, 'New manager instance should load persisted extensions');
    const persisted = newManager.extensions[extARecord.id];
    assert(persisted !== null && persisted !== undefined, 'Extension A should exist in persisted registry');
    assert(persisted.name === 'Test Action Extension', 'Persisted name should match');
    assert(persisted.enabled === true, 'Persisted enabled state should match');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('🔒 3. Permissions, Content Scripts & Security');
  // ────────────────────────────────────────────────────────────────────────────

  let extBRecord;

  await test('10. Permissions correctly parsed and categorized (Extension B)', () => {
    const val = manager.validateExtension(EXT_B_DIR);
    assert(val.valid === true, 'Extension B should validate');
    assert(val.permissions.includes('cookies'), 'Should parse cookies');
    assert(val.permissions.includes('webRequest'), 'Should parse webRequest');
    assert(val.permissions.includes('tabs'), 'Should parse tabs');
    assert(val.hostPermissions.includes('<all_urls>'), 'Should parse <all_urls>');
    assert(val.hostPermissions.includes('https://*.example.com/*'), 'Should parse specific host permission');
  });

  await test('11. High-risk permissions flagged', () => {
    const val = manager.validateExtension(EXT_B_DIR);
    assert(Array.isArray(val.highRiskPermissions), 'High risk list should be an array');
    const highRiskNames = val.highRiskPermissions.map(p => p.name);
    assert(highRiskNames.includes('cookies'), 'cookies should be flagged high risk');
    assert(highRiskNames.includes('webRequest'), 'webRequest should be flagged high risk');
    assert(highRiskNames.includes('tabs'), 'tabs should be flagged high risk');
    assert(highRiskNames.includes('<all_urls>'), '<all_urls> should be flagged high risk');
  });

  await test('12. Reject extension requesting disallowed permissions', () => {
    const tempDir = path.join(os.tmpdir(), `shmmoth_temp_disallowed_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify({
      name: 'Disallowed Perm Extension',
      version: '1.0.0',
      manifest_version: 3,
      permissions: ['nativeMessaging']
    }));

    let threw = false;
    try {
      manager.validateExtension(tempDir);
    } catch (err) {
      threw = true;
      assert(err.message.includes('Disallowed permission requested: nativeMessaging'), `Unexpected error: ${err.message}`);
    }
    assert(threw, 'Should reject nativeMessaging');

    // Test debugger permission without dev mode
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify({
      name: 'Debugger Perm Extension',
      version: '1.0.0',
      manifest_version: 3,
      permissions: ['debugger']
    }));
    threw = false;
    try {
      manager.setDeveloperMode(false);
      manager.validateExtension(tempDir);
    } catch (err) {
      threw = true;
      assert(err.message.includes('Developer Mode'), `Unexpected error: ${err.message}`);
    }
    assert(threw, 'Should reject debugger when developer mode is off');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await test('13. Content script extension loads (Extension B)', async () => {
    extBRecord = await manager.installUnpacked(EXT_B_DIR, { enabled: true });
    assert(extBRecord !== null, 'Extension B should install');
    const loaded = await manager.loadIntoSession(session, extBRecord.id);
    assert(loaded !== null, 'Extension B should load into session');
  });

  await test('14. Extension uninstallation cleanly removes from registry', async () => {
    await manager.removeExtension(extBRecord.id, session);
    assert(manager.extensions[extBRecord.id] === undefined, 'Extension B should be deleted from manager');
    const details = manager.getExtensionDetails(extBRecord.id);
    assert(details === null, 'Details should return null for removed extension');

    // Confirm registry persistence on disk reflects deletion
    const raw = fs.readFileSync(path.join(testUserDataDir, 'shmmoth-extensions.json'), 'utf8');
    const saved = JSON.parse(raw);
    assert(saved.extensions[extBRecord.id] === undefined, 'Saved registry on disk should not contain removed extension');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('💥 4. Resilience, Crash Isolation & Preload Security');
  // ────────────────────────────────────────────────────────────────────────────

  await test('15. Missing extension directory handled gracefully on startup', async () => {
    const fakeId = 'missingext1234567890abcdef123456';
    manager.extensions[fakeId] = {
      id: fakeId,
      name: 'Missing Extension',
      version: '1.0.0',
      path: path.join(os.tmpdir(), 'non_existent_folder_abc_123'),
      enabled: true,
      errors: []
    };

    const res = await manager.loadIntoSession(session, fakeId);
    assert(res === null, 'Should return null for missing directory');
    assert(manager.extensions[fakeId].status === 'missing', 'Status should be marked as missing');
    delete manager.extensions[fakeId];
  });

  await test('16. Extension crash does not crash the browser (Extension D)', async () => {
    const extDRecord = await manager.installUnpacked(EXT_D_DIR, { enabled: true });
    assert(extDRecord !== null, 'Extension D should install');

    // Attempt to load failing extension
    const loaded = await manager.loadIntoSession(session, extDRecord.id);
    assert(loaded === null, 'Loading failing extension should fail gracefully');
    assert(extDRecord.status === 'error', 'Status should be error');
    assert(Array.isArray(extDRecord.errors) && extDRecord.errors.length > 0, 'Error should be recorded');
    assert(extDRecord.errors[0].message.includes('Simulated extension service worker execution crash'), 'Error message should be logged');

    // Clear errors test
    manager.clearErrors(extDRecord.id);
    assert(extDRecord.errors.length === 0, 'Errors should be cleared');
  });

  await test('17. Extensions cannot access internal mtcAPI / privileged channels', () => {
    const preloadExt = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-external.js'), 'utf8');
    assert(!preloadExt.includes("exposeInMainWorld('mtcAPI'"), 'preload-external.js must never expose mtcAPI');
    assert(!preloadExt.includes("exposeInMainWorld('shmmothAPI'"), 'preload-external.js must never expose shmmothAPI');
    assert(!preloadExt.includes('ipcRenderer'), 'preload-external.js must never import or expose ipcRenderer');

    const extensionApis = [
      'getAllExtensions',
      'installExtension',
      'enableExtension',
      'disableExtension',
      'removeExtension',
      'reloadExtension',
      'setExtensionPinned',
      'openExtensionPopup'
    ];

    const preloadInt = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-internal.js'), 'utf8');
    extensionApis.forEach(apiName => {
      assert(preloadInt.includes(apiName), `preload-internal must expose ${apiName}`);
      assert(!preloadExt.includes(apiName), `preload-external MUST NOT expose ${apiName}`);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('⚙️ 5. Developer Mode & Toolbar Pin Management');
  // ────────────────────────────────────────────────────────────────────────────

  await test('18. Developer mode toggle state persistence', () => {
    manager.setDeveloperMode(true);
    assert(manager.isDeveloperMode() === true, 'Developer mode should be true');

    const loadedAgain = new ExtensionManager(testUserDataDir);
    assert(loadedAgain.isDeveloperMode() === true, 'Developer mode should persist across restarts');

    manager.setDeveloperMode(false);
    assert(manager.isDeveloperMode() === false, 'Developer mode should toggle off');
  });

  await test('19. Pinned extensions list management', () => {
    assert(extARecord.pinned === false, 'Extension should start unpinned');

    manager.setPinned(extARecord.id, true);
    assert(manager.extensions[extARecord.id].pinned === true, 'Should mark as pinned');

    const summary = manager.getAllExtensions().find(e => e.id === extARecord.id);
    assert(summary && summary.pinned === true, 'Summary should reflect pinned status');

    manager.setPinned(extARecord.id, false);
    assert(manager.extensions[extARecord.id].pinned === false, 'Should unpin');
  });

  // Cleanup test directory
  try {
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Stage 7 Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Test run failed fatally:', err);
  process.exit(1);
});
