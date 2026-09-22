/**
 * MTC BROWSER — SECURITY TEST SUITE
 * Phase 1 verification tests
 *
 * Run with: node tests/security.test.js
 */

'use strict';

// ─── Test runner ─────────────────────────────────────────────────────────────

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

function assertThrows(fn, expectedCode) {
  let threw = false;
  let code = null;
  try { fn(); }
  catch (err) { threw = true; code = err.code; }
  if (!threw) throw new Error('Expected function to throw but it did not');
  if (expectedCode && code !== expectedCode) {
    throw new Error(`Expected error code ${expectedCode} but got ${code}`);
  }
}

// ─── Load modules ────────────────────────────────────────────────────────────

const path = require('path');

// Patch app.getPath to avoid needing full Electron for storage tests
const Module = require('module');
const origLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'electron') {
    return {
      app: { getPath: () => require('os').tmpdir() },
      contextBridge: { exposeInMainWorld: () => {} },
      ipcRenderer: {}
    };
  }
  return origLoad.call(this, request, ...args);
};

const ipcSecurity = require('../src/security/ipcSecurity');
const urlPolicy   = require('../src/security/urlPolicy');
const { Logger, redact } = require('../src/utils/logger');
const BrowserAction = require('../src/agent/BrowserAction');

// ─── Test Suite ───────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log('  MTC Browser — Phase 1 Security Tests   ');
console.log('══════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
console.log('📋 1. IPC Origin Validation');
// ────────────────────────────────────────────────────────────────────────────

test('Trusted origin: mtc:// is accepted', () => {
  const fakeEvent = { senderFrame: { url: 'mtc://newtab' } };
  ipcSecurity.validateTrustedSender(fakeEvent); // must not throw
});

test('Trusted origin: file:// is accepted', () => {
  const fakeEvent = { senderFrame: { url: 'file:///path/to/renderer/index.html' } };
  ipcSecurity.validateTrustedSender(fakeEvent);
});

test('Untrusted origin: https:// is rejected', () => {
  const fakeEvent = { senderFrame: { url: 'https://gemini.google.com' } };
  assertThrows(() => ipcSecurity.validateTrustedSender(fakeEvent), 'UNTRUSTED_ORIGIN');
});

test('Untrusted origin: http:// is rejected', () => {
  const fakeEvent = { senderFrame: { url: 'http://malicious.example.com' } };
  assertThrows(() => ipcSecurity.validateTrustedSender(fakeEvent), 'UNTRUSTED_ORIGIN');
});

test('Untrusted origin: null sender is rejected', () => {
  const fakeEvent = { senderFrame: null };
  assertThrows(() => ipcSecurity.validateTrustedSender(fakeEvent), 'UNTRUSTED_ORIGIN');
});

test('Untrusted origin: attacker spoofing mtc in subdomain is rejected', () => {
  const fakeEvent = { senderFrame: { url: 'https://mtc.evil.com' } };
  assertThrows(() => ipcSecurity.validateTrustedSender(fakeEvent), 'UNTRUSTED_ORIGIN');
});

test('isTrustedOrigin: returns correct values', () => {
  assert(ipcSecurity.isTrustedOrigin('mtc://newtab') === true);
  assert(ipcSecurity.isTrustedOrigin('file:///x') === true);
  assert(ipcSecurity.isTrustedOrigin('https://google.com') === false);
  assert(ipcSecurity.isTrustedOrigin('') === false);
  assert(ipcSecurity.isTrustedOrigin(null) === false);
});

test('validateUrl: rejects non-strings', () => {
  assertThrows(() => ipcSecurity.validateUrl(42), 'INVALID_URL_TYPE');
  assertThrows(() => ipcSecurity.validateUrl(null), 'INVALID_URL_TYPE');
});

test('validateUrl: rejects empty strings', () => {
  assertThrows(() => ipcSecurity.validateUrl('   '), 'EMPTY_URL');
});

test('validateUrl: rejects excessively long URLs', () => {
  assertThrows(() => ipcSecurity.validateUrl('https://x.com/' + 'a'.repeat(9000)), 'URL_TOO_LONG');
});

test('sanitizeString: trims and caps length', () => {
  const result = ipcSecurity.sanitizeString('  hello  ', 3, 'test');
  assert(result === 'hel', `Expected 'hel' but got '${result}'`);
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n📋 2. URL Policy');
// ────────────────────────────────────────────────────────────────────────────

test('classify: mtc:// → TRUSTED_INTERNAL', () => {
  assert(urlPolicy.classify('mtc://newtab') === urlPolicy.UrlCategory.TRUSTED_INTERNAL);
});

test('classify: file:// → TRUSTED_INTERNAL', () => {
  assert(urlPolicy.classify('file:///path') === urlPolicy.UrlCategory.TRUSTED_INTERNAL);
});

test('classify: https:// → UNKNOWN_EXTERNAL', () => {
  assert(urlPolicy.classify('https://google.com') === urlPolicy.UrlCategory.UNKNOWN_EXTERNAL);
});

test('classify: javascript: → DANGEROUS', () => {
  assert(urlPolicy.classify('javascript:alert(1)') === urlPolicy.UrlCategory.DANGEROUS);
  assert(urlPolicy.classify('JAVASCRIPT:void(0)') === urlPolicy.UrlCategory.DANGEROUS);
});

test('classify: data: → DANGEROUS', () => {
  assert(urlPolicy.classify('data:text/html,<h1>') === urlPolicy.UrlCategory.DANGEROUS);
});

test('classify: vbscript: → DANGEROUS', () => {
  assert(urlPolicy.classify('vbscript:msgbox(1)') === urlPolicy.UrlCategory.DANGEROUS);
});

test('isSafeToLoad: blocks dangerous URLs', () => {
  assert(urlPolicy.isSafeToLoad('javascript:alert(1)') === false);
  assert(urlPolicy.isSafeToLoad('data:text/html,x') === false);
  assert(urlPolicy.isSafeToLoad('https://safe.example.com') === true);
  assert(urlPolicy.isSafeToLoad('mtc://newtab') === true);
});

test('checkNavigation: external page cannot navigate to mtc://', () => {
  const result = urlPolicy.checkNavigation('https://evil.com', 'mtc://settings');
  assert(result.allowed === false, `Expected navigation to be blocked but got: ${result.reason}`);
});

test('checkNavigation: internal page can navigate to mtc://', () => {
  const result = urlPolicy.checkNavigation('mtc://newtab', 'mtc://settings');
  assert(result.allowed === true, `Expected navigation to be allowed but got: ${result.reason}`);
});

test('checkNavigation: file:// chrome can navigate to mtc://', () => {
  const result = urlPolicy.checkNavigation('file:///renderer/index.html', 'mtc://newtab');
  assert(result.allowed === true);
});

test('checkNavigation: blocks javascript: from anywhere', () => {
  const result = urlPolicy.checkNavigation('mtc://newtab', 'javascript:alert(1)');
  assert(result.allowed === false);
});

test('checkNavigation: allows external → external', () => {
  const result = urlPolicy.checkNavigation('https://google.com', 'https://youtube.com');
  assert(result.allowed === true);
});

test('isPopupBlocked: blocks dangerous popup URLs', () => {
  assert(urlPolicy.isPopupBlocked('javascript:void(0)') === true);
  assert(urlPolicy.isPopupBlocked('https://example.com') === false);
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n📋 3. Logger Redaction');
// ────────────────────────────────────────────────────────────────────────────

test('redact: strips password fields from objects', () => {
  const input  = { username: 'alice', password: 'hunter2', url: 'https://x.com' };
  const output = redact(input);
  assert(output.password === '[REDACTED]', `password not redacted: ${output.password}`);
  assert(output.username === 'alice');
  assert(output.url === 'https://x.com');
});

test('redact: strips token fields', () => {
  const output = redact({ access_token: 'abc123', data: 'ok' });
  assert(output.access_token === '[REDACTED]');
  assert(output.data === 'ok');
});

test('redact: strips api_key fields', () => {
  const output = redact({ apiKey: 'sk-xyz', model: 'gemini' });
  assert(output.apiKey === '[REDACTED]');
  assert(output.model === 'gemini');
});

test('redact: handles nested objects', () => {
  const output = redact({ auth: { token: 'secret', type: 'bearer' } });
  assert(output.auth.token === '[REDACTED]');
  assert(output.auth.type === 'bearer');
});

test('redact: handles arrays', () => {
  const output = redact([{ password: 'x' }, { name: 'bob' }]);
  assert(output[0].password === '[REDACTED]');
  assert(output[1].name === 'bob');
});

test('Logger: can create child loggers', () => {
  const logger = new Logger('TEST');
  const child  = logger.child('IPC');
  assert(child instanceof Logger);
  // No throw = pass
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n📋 4. BrowserAction Schema');
// ────────────────────────────────────────────────────────────────────────────

test('BrowserAction.validate: valid navigate action passes', () => {
  const result = BrowserAction.validate({
    action:     'navigate',
    tabId:      'tab_1',
    target:     'https://example.com',
    reason:     'User clicked a link',
    permission: 'browser.navigate',
  });
  assert(result.valid === true, `Expected valid but got errors: ${result.errors.join(', ')}`);
});

test('BrowserAction.validate: missing reason fails', () => {
  const result = BrowserAction.validate({
    action:     'navigate',
    tabId:      'tab_1',
    target:     'https://x.com',
    permission: 'browser.navigate',
  });
  assert(result.valid === false);
  assert(result.errors.some(e => e.includes('reason')));
});

test('BrowserAction.validate: wrong permission fails', () => {
  const result = BrowserAction.validate({
    action:     'click',
    tabId:      'tab_1',
    target:     '#btn',
    reason:     'Submit form',
    permission: 'browser.navigate', // wrong — should be browser.interaction
  });
  assert(result.valid === false);
  assert(result.errors.some(e => e.includes('permission')));
});

test('BrowserAction.validate: javascript: in target fails', () => {
  const result = BrowserAction.validate({
    action:     'navigate',
    tabId:      'tab_1',
    target:     'javascript:alert(1)',
    reason:     'Test injection',
    permission: 'browser.navigate',
  });
  assert(result.valid === false);
  assert(result.errors.some(e => e.includes('javascript')));
});

test('BrowserAction.validate: unknown action fails', () => {
  const result = BrowserAction.validate({ action: 'executeArbitraryCode', reason: 'x', permission: 'x' });
  assert(result.valid === false);
});

test('BrowserAction.create: throws on invalid action', () => {
  assertThrows(() => BrowserAction.create({ action: 'unknown' }));
});

test('BrowserAction.create: returns frozen object on valid action', () => {
  const action = BrowserAction.create({
    action:     'readPage',
    tabId:      'tab_1',
    reason:     'Observe page state',
    permission: 'browser.observe',
  });
  assert(Object.isFrozen(action), 'Action object should be frozen');
  assert(action.action === 'readPage');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
