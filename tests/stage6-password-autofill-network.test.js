/**
 * SHMMOTH BROWSER — STAGE 6 VERIFICATION TESTS
 * Tests for Secure Password Manager, Form Autofill, and Network/Proxy Configuration
 *
 * Run with: node tests/stage6-password-autofill-network.test.js
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
        getPath: (name) => path.join(os.tmpdir(), `shmmoth_test_stage6_${name}`),
        quit: () => {}
      },
      safeStorage: {
        isEncryptionAvailable: () => false // tests fallback encryption
      }
    };
  }
  return origLoad.call(this, request, ...args);
};

const { PasswordVault }   = require('../src/services/passwordVault');
const { AutofillService } = require('../src/services/autofillService');
const { ProxyManager }    = require('../src/services/proxyManager');

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — Stage 6 Password, Autofill & Proxy Tests  ');
console.log('══════════════════════════════════════════════════════════════\n');

async function runAllTests() {
  const tmpDir = path.join(os.tmpdir(), `shmmoth_test_stage6_${Date.now()}`);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const vaultPath    = path.join(tmpDir, 'test-vault.json');
  const autofillPath = path.join(tmpDir, 'test-autofill.json');
  const proxyPath    = path.join(tmpDir, 'test-proxy.json');

  // ────────────────────────────────────────────────────────────────────────────
  console.log('🔑 1. Password Vault Encryption & Security Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('PasswordVault encrypts and decrypts passwords faithfully', () => {
    const vault = new PasswordVault(vaultPath);
    const plaintext = 'SecretP@ssw0rd!2026';
    const ciphertext = vault.encryptPassword(plaintext);

    assert(typeof ciphertext === 'string', 'Ciphertext must be a string');
    assert(ciphertext !== plaintext, 'Ciphertext must never equal plaintext');
    assert(!ciphertext.includes(plaintext), 'Ciphertext must not contain plaintext substring');

    const decrypted = vault.decryptPassword(ciphertext);
    assert(decrypted === plaintext, `Decrypted password '${decrypted}' must match original '${plaintext}'`);
  });

  await test('PasswordVault never persists plaintext passwords to disk', () => {
    const vault = new PasswordVault(vaultPath);
    const plain = 'SuperSecretUserPassword123#';
    vault.saveCredential({
      origin: 'https://bank.example.com',
      username: 'alice_vault',
      password: plain
    });

    assert(fs.existsSync(vaultPath), 'Vault JSON file must exist on disk');
    const diskContent = fs.readFileSync(vaultPath, 'utf8');

    assert(!diskContent.includes(plain), 'Disk file MUST NEVER contain plaintext password');
    assert(diskContent.includes('alice_vault'), 'Disk file should contain username');
    assert(diskContent.includes('https://bank.example.com'), 'Disk file should contain origin');
  });

  await test('PasswordVault CRUD operations & Redaction', () => {
    const vault = new PasswordVault(vaultPath);

    // 1. Save
    const cred = vault.saveCredential({
      origin: 'https://github.com',
      username: 'dev_user',
      password: 'DevPassword!456'
    });
    assert(cred.id, 'Credential must have an id');
    assert(cred.encryptedPassword, 'Credential must store encryptedPassword');
    assert(!cred.password, 'Credential record must not expose plain password property');

    // 2. Query for origin
    const matching = vault.getCredentialsForOrigin('https://github.com');
    assert(matching.length === 1, 'Should find 1 matching credential for origin');
    assert(matching[0].username === 'dev_user', 'Username must match');
    assert(matching[0].encryptedPassword === undefined, 'Public origin query must redact encryptedPassword');

    // 3. Query all metadata
    const all = vault.getAllCredentialsMetadata();
    assert(all.length >= 2, 'Should have at least 2 credentials in vault');
    all.forEach(item => {
      assert(item.id && item.origin && item.username, 'Metadata must have id, origin, username');
      assert(!item.password && !item.encryptedPassword, 'Metadata must never leak passwords');
    });

    // 4. Update
    const updated = vault.updateCredential(cred.id, { username: 'dev_user_updated' });
    assert(updated.username === 'dev_user_updated', 'Username should be updated');

    // 5. Authorized Decrypt
    const plain = vault.decryptForAuthorizedUse(cred.id);
    assert(plain === 'DevPassword!456', 'Authorized decrypt must recover original plaintext');

    // 6. Delete
    const deleted = vault.deleteCredential(cred.id);
    assert(deleted === true, 'Delete should succeed');
    assert(vault.getCredentialsForOrigin('https://github.com').length === 0, 'Origin query should now be empty');
  });

  await test('PasswordVault Never-Save Origins List', () => {
    const vault = new PasswordVault(vaultPath);
    assert(!vault.isNeverSaveOrigin('https://internal.corp'), 'Initially should not be in never save list');

    vault.neverSaveOrigin('https://internal.corp');
    assert(vault.isNeverSaveOrigin('https://internal.corp') === true, 'Should now be recognized in never save list');

    // Verify persistence across reload
    const reloaded = new PasswordVault(vaultPath);
    assert(reloaded.isNeverSaveOrigin('https://internal.corp') === true, 'Never-save list must persist to disk');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n📝 2. Form Autofill Service Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('AutofillService profile CRUD operations', () => {
    const autofill = new AutofillService(autofillPath);

    // 1. Save Profile
    const profile = autofill.saveProfile({
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+1 555-0199',
      address: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'IL',
      country: 'USA',
      postalCode: '62704'
    });

    assert(profile.id, 'Profile must have an ID');
    assert(profile.name === 'John Doe', 'Profile name must match');

    // 2. Query Profiles
    const list = autofill.getProfiles();
    assert(list.length === 1, 'Should have 1 profile');

    // 3. Update Profile
    const updated = autofill.updateProfile(profile.id, { name: 'Johnathon Doe' });
    assert(updated.name === 'Johnathon Doe', 'Profile name should be updated');

    // 4. Persistence across reload
    const reloaded = new AutofillService(autofillPath);
    const reloadedProfiles = reloaded.getProfiles();
    assert(reloadedProfiles.length === 1, 'Reloaded service must have 1 profile');
    assert(reloadedProfiles[0].name === 'Johnathon Doe', 'Persisted profile name must match');

    // 5. Delete Profile
    const deleted = autofill.deleteProfile(profile.id);
    assert(deleted === true, 'Profile delete should return true');
    assert(autofill.getProfiles().length === 0, 'Profiles should now be empty');
  });

  await test('AutofillService toggle & privacy-preserving field matching', () => {
    const autofill = new AutofillService(autofillPath);
    assert(autofill.isAutofillEnabled() === true, 'Autofill should be enabled by default');

    autofill.setAutofillEnabled(false);
    assert(autofill.isAutofillEnabled() === false, 'Autofill should now be disabled');

    // Re-enable and test privacy-preserving suggestions
    autofill.setAutofillEnabled(true);
    autofill.saveProfile({
      name: 'Jane Smith',
      email: 'jane.smith@example.org',
      city: 'Chicago'
    });

    // Request email suggestions: must only return matching emails, not the whole profile
    const emailSuggestions = autofill.getFieldSuggestions('email', 'jane');
    assert(emailSuggestions.length === 1, 'Should find 1 email suggestion');
    assert(emailSuggestions[0].value === 'jane.smith@example.org', 'Suggested value must be the email');
    assert(!emailSuggestions[0].city, 'Field suggestion must NOT leak unrelated fields like city');
    assert(!emailSuggestions[0].address, 'Field suggestion must NOT leak address');

    // When disabled, no suggestions are returned
    autofill.setAutofillEnabled(false);
    assert(autofill.getFieldSuggestions('email', 'jane').length === 0, 'Disabled autofill must return 0 suggestions');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n🌐 3. Network & Proxy Configuration Tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('ProxyManager configuration modes & validation', () => {
    const vault = new PasswordVault(vaultPath);
    const proxy = new ProxyManager(proxyPath, vault);

    // Default configuration
    const initial = proxy.getConfig();
    assert(initial.mode === 'system', 'Default mode should be system');

    // Set to direct
    proxy.setConfig({ mode: 'direct' });
    assert(proxy.getConfig().mode === 'direct', 'Mode should update to direct');

    // Validation for manual mode
    let caught = false;
    try {
      proxy.setConfig({ mode: 'manual', rules: { host: '' } });
    } catch (_) {
      caught = true;
    }
    assert(caught, 'Manual mode with empty host must throw error');

    // Valid manual configuration
    proxy.setConfig({
      mode: 'manual',
      rules: {
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        username: 'proxy_user',
        password: 'ProxySecretPassword99!',
        bypassRules: '<local>;localhost'
      }
    });

    const manualCfg = proxy.getConfig();
    assert(manualCfg.mode === 'manual', 'Mode should be manual');
    assert(manualCfg.rules.protocol === 'socks5', 'Protocol should be socks5');
    assert(manualCfg.rules.port === 1080, 'Port should be 1080');
    assert(manualCfg.rules.username === 'proxy_user', 'Username should match');
    assert(manualCfg.rules.encryptedPassword !== 'ProxySecretPassword99!', 'Proxy password must be encrypted');

    // Decrypt proxy password
    const decryptedPass = proxy.getDecryptedPassword();
    assert(decryptedPass === 'ProxySecretPassword99!', 'Decrypted proxy password must match');

    // Public config does not expose password
    const pub = proxy.getPublicConfig();
    assert(pub.rules.hasPassword === true, 'Public config should state hasPassword: true');
    assert(!pub.rules.password && !pub.rules.encryptedPassword, 'Public config must not leak password');
  });

  await test('ProxyManager builds correct Electron session configurations', () => {
    const proxy = new ProxyManager(proxyPath);

    // Direct mode
    proxy.setConfig({ mode: 'direct' });
    const directConf = proxy.buildElectronProxyConfig();
    assert(directConf.mode === 'direct', 'Direct mode config must have mode: direct');

    // System mode
    proxy.setConfig({ mode: 'system' });
    const sysConf = proxy.buildElectronProxyConfig();
    assert(sysConf.mode === 'system', 'System mode config must have mode: system');

    // Manual HTTP mode
    proxy.setConfig({
      mode: 'manual',
      rules: { protocol: 'http', host: 'proxy.company.com', port: 8080, bypassRules: '<local>' }
    });
    const httpConf = proxy.buildElectronProxyConfig();
    assert(httpConf.mode === 'fixed_servers', 'Manual mode must use fixed_servers');
    assert(httpConf.proxyRules === 'http://proxy.company.com:8080', 'HTTP proxy rule must format correctly');
    assert(httpConf.proxyBypassRules === '<local>', 'Bypass rules must match');

    // Manual SOCKS5 mode
    proxy.setConfig({
      mode: 'manual',
      rules: { protocol: 'socks5', host: 'socks.company.com', port: 1080 }
    });
    const socksConf = proxy.buildElectronProxyConfig();
    assert(socksConf.proxyRules === 'socks5://socks.company.com:1080', 'SOCKS5 rule must format correctly');
  });

  await test('ProxyManager testConnection & resetToSystem', async () => {
    const proxy = new ProxyManager(proxyPath);

    // Direct mode test connection
    proxy.setConfig({ mode: 'direct' });
    const directTest = await proxy.testConnection();
    assert(directTest.success === true, 'Direct mode testConnection should return success');

    // Reset to system
    const resetRes = await proxy.resetToSystem();
    assert(resetRes.mode === 'system', 'Reset must revert mode to system');
    assert(proxy.getConfig().mode === 'system', 'Stored config must be system');
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n🔒 4. Preload & Security Boundaries');
  // ────────────────────────────────────────────────────────────────────────────

  await test('preload-internal exposes Stage 6 APIs while preload-external does not', () => {
    const internalContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-internal.js'), 'utf8');
    const externalContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-external.js'), 'utf8');

    const stage6InternalApis = [
      'getAllPasswords',
      'getPasswordsForOrigin',
      'savePassword',
      'updatePassword',
      'deletePassword',
      'clearAllPasswords',
      'revealPassword',
      'respondPasswordSavePrompt',
      'onPasswordOfferSave',
      'getAutofillProfiles',
      'saveAutofillProfile',
      'updateAutofillProfile',
      'deleteAutofillProfile',
      'clearAllAutofillProfiles',
      'isAutofillEnabled',
      'setAutofillEnabled',
      'getProxyConfig',
      'saveProxyConfig',
      'testProxyConnection',
      'resetProxyConfig'
    ];

    stage6InternalApis.forEach(apiName => {
      assert(internalContent.includes(apiName), `preload-internal.js must expose ${apiName}`);
      assert(!externalContent.includes(apiName), `preload-external.js MUST NOT expose ${apiName}`);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n🎨 5. UI Elements & Integration Integrity');
  // ────────────────────────────────────────────────────────────────────────────

  await test('Browser chrome & settings UI contain Stage 6 elements', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    assert(indexHtml.includes('id="password-save-card"'), 'index.html must contain password-save-card');
    assert(indexHtml.includes('id="btn-password-save"'), 'index.html must contain btn-password-save');
    assert(indexHtml.includes('id="btn-password-never"'), 'index.html must contain btn-password-never');
    assert(indexHtml.includes('id="btn-password-notnow"'), 'index.html must contain btn-password-notnow');

    const settingsHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'settings.html'), 'utf8');
    assert(settingsHtml.includes('id="tab-passwords"'), 'settings.html must contain tab-passwords');
    assert(settingsHtml.includes('id="tab-autofill"'), 'settings.html must contain tab-autofill');
    assert(settingsHtml.includes('id="tab-network"'), 'settings.html must contain tab-network');
    assert(settingsHtml.includes('id="modal-password-edit"'), 'settings.html must contain modal-password-edit');
    assert(settingsHtml.includes('id="modal-autofill-edit"'), 'settings.html must contain modal-autofill-edit');
    assert(settingsHtml.includes('data-tab="passwords"'), 'settings.html must contain passwords nav link');
    assert(settingsHtml.includes('data-tab="autofill"'), 'settings.html must contain autofill nav link');
    assert(settingsHtml.includes('data-tab="network"'), 'settings.html must contain network nav link');

    const styleCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');
    assert(styleCss.includes('.password-save-card'), 'style.css must style password-save-card');

    const settingsCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'settings.css'), 'utf8');
    assert(settingsCss.includes('.passwords-toolbar'), 'settings.css must style passwords-toolbar');
    assert(settingsCss.includes('.autofill-card'), 'settings.css must style autofill-card');
    assert(settingsCss.includes('.proxy-endpoint-group'), 'settings.css must style proxy-endpoint-group');
  });

  // Clean up test tmpDir
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}

  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Stage 6 Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runAllTests();
