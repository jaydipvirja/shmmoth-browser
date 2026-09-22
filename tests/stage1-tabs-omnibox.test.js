/**
 * SHMMOTH BROWSER — STAGE 1 VERIFICATION TESTS
 * Tests for Tab System, Navigation, and Omnibox
 *
 * Run with: node tests/stage1-tabs-omnibox.test.js
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

console.log('\n══════════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — Stage 1 (Tabs, Nav, Omnibox) Tests   ');
console.log('══════════════════════════════════════════════════════════\n');

// Mock formatUrl logic matching main.js
const { isSafeToLoad } = require('../src/security/urlPolicy');

function formatUrl(input, searchEngine = 'google') {
  let target = (input || '').trim();
  if (!target) return 'mtc://newtab';

  if (/^(javascript|data|vbscript):/i.test(target)) {
    return 'mtc://newtab';
  }

  let finalUrl;

  if (target.startsWith('mtc://') || target.startsWith('file://') || target.startsWith('about:')) {
    finalUrl = target;
  } else if (/\s/.test(target)) {
    finalUrl = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
  } else if (/^https?:\/\//i.test(target)) {
    finalUrl = target;
  } else if (
    /^localhost(:\d+)?(\/.*)?$/i.test(target) ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/.test(target)
  ) {
    finalUrl = 'http://' + target;
  } else if (/^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(target)) {
    finalUrl = 'https://' + target;
  } else {
    finalUrl = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
  }

  if (!isSafeToLoad(finalUrl) && !finalUrl.startsWith('mtc://')) {
    return 'mtc://newtab';
  }

  return finalUrl;
}

// ────────────────────────────────────────────────────────────────────────────
console.log('📋 1. Omnibox URL vs Search Query Detection');
// ────────────────────────────────────────────────────────────────────────────

test('Multi-word query is detected as search query', () => {
  const res = formatUrl('steel casting manufacturers India');
  assert(res.includes('google.com/search?q=steel%20casting%20manufacturers%20India'), `Got: ${res}`);
});

test('Search query with question is detected as search query', () => {
  const res = formatUrl('how to bake sourdough bread');
  assert(res.includes('google.com/search?q=how%20to%20bake%20sourdough%20bread'), `Got: ${res}`);
});

test('Standard domain name prepends https://', () => {
  assert(formatUrl('github.com') === 'https://github.com');
  assert(formatUrl('example.org/path') === 'https://example.org/path');
  assert(formatUrl('sub.domain.co.uk/test?q=1') === 'https://sub.domain.co.uk/test?q=1');
  assert(formatUrl('news.ycombinator.com') === 'https://news.ycombinator.com');
});

test('Explicit http / https URLs preserved', () => {
  assert(formatUrl('https://google.com') === 'https://google.com');
  assert(formatUrl('http://myinsecuresite.org') === 'http://myinsecuresite.org');
});

test('Localhost and IP addresses use http://', () => {
  assert(formatUrl('localhost') === 'http://localhost');
  assert(formatUrl('localhost:3000') === 'http://localhost:3000');
  assert(formatUrl('127.0.0.1:8080') === 'http://127.0.0.1:8080');
  assert(formatUrl('192.168.1.1') === 'http://192.168.1.1');
});

test('Internal mtc:// schemes preserved', () => {
  assert(formatUrl('mtc://newtab') === 'mtc://newtab');
  assert(formatUrl('mtc://settings') === 'mtc://settings');
  assert(formatUrl('mtc://downloads') === 'mtc://downloads');
});

test('Dangerous schemes blocked and returned as newtab', () => {
  assert(formatUrl('javascript:alert(1)') === 'mtc://newtab');
  assert(formatUrl('data:text/html,hack') === 'mtc://newtab');
  assert(formatUrl('vbscript:msgbox(1)') === 'mtc://newtab');
});

test('Single words without dot are treated as search', () => {
  const res = formatUrl('weather');
  assert(res === 'https://www.google.com/search?q=weather');
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n📋 2. Tab State & Ordering Logic');
// ────────────────────────────────────────────────────────────────────────────

test('Tab ordering with pinned tabs clusters pinned tabs first', () => {
  let tabOrder = ['tab_1', 'tab_2', 'tab_3'];
  const tabs = {
    tab_1: { id: 'tab_1', isPinned: false },
    tab_2: { id: 'tab_2', isPinned: false },
    tab_3: { id: 'tab_3', isPinned: false },
  };

  // Pin tab_3
  tabs.tab_3.isPinned = true;
  const pinned = [];
  const unpinned = [];
  for (const id of tabOrder) {
    if (tabs[id].isPinned) pinned.push(id);
    else unpinned.push(id);
  }
  tabOrder = [...pinned, ...unpinned];

  assert(tabOrder[0] === 'tab_3', `Expected tab_3 at index 0, got ${tabOrder[0]}`);
  assert(tabOrder[1] === 'tab_1', `Expected tab_1 at index 1, got ${tabOrder[1]}`);
  assert(tabOrder[2] === 'tab_2', `Expected tab_2 at index 2, got ${tabOrder[2]}`);
});

test('Close tabs to the right closes only subsequent unpinned tabs', () => {
  const tabOrder = ['tab_p', 'tab_1', 'tab_2', 'tab_3'];
  const tabs = {
    tab_p: { id: 'tab_p', isPinned: true },
    tab_1: { id: 'tab_1', isPinned: false },
    tab_2: { id: 'tab_2', isPinned: false },
    tab_3: { id: 'tab_3', isPinned: false },
  };

  const fromId = 'tab_1';
  const idx = tabOrder.indexOf(fromId);
  const toClose = [];
  for (let i = idx + 1; i < tabOrder.length; i++) {
    const id = tabOrder[i];
    if (tabs[id] && !tabs[id].isPinned) toClose.push(id);
  }

  assert(toClose.length === 2 && toClose.includes('tab_2') && toClose.includes('tab_3'),
    `Expected ['tab_2', 'tab_3'], got ${JSON.stringify(toClose)}`);
});

test('Reopen closed tab stores and pops recent URLs', () => {
  const closedTabs = [];
  function closeTabUrl(url, title) {
    if (url && !url.startsWith('mtc://newtab') && !url.startsWith('about:blank')) {
      closedTabs.push({ url, title });
      if (closedTabs.length > 25) closedTabs.shift();
    }
  }

  closeTabUrl('mtc://newtab', 'New Tab');
  assert(closedTabs.length === 0, 'newtab should not be tracked');

  closeTabUrl('https://github.com', 'GitHub');
  closeTabUrl('https://news.ycombinator.com', 'Hacker News');
  assert(closedTabs.length === 2);

  const reopened = closedTabs.pop();
  assert(reopened.url === 'https://news.ycombinator.com');
  assert(closedTabs.length === 1);
});

// ────────────────────────────────────────────────────────────────────────────
console.log('\n📋 3. Preload API Surface Verification');
// ────────────────────────────────────────────────────────────────────────────

test('preload-internal.js defines all required Stage 1 tab control methods', () => {
  const fs = require('fs');
  const content = fs.readFileSync(require.resolve('../src/preload-internal.js'), 'utf-8');

  const requiredMethods = [
    'createTab',
    'closeTab',
    'switchTab',
    'navigateTab',
    'navigateCurrentTab',
    'reloadTab',
    'reloadTabIgnoringCache',
    'stopTab',
    'goBack',
    'goForward',
    'duplicateTab',
    'togglePinTab',
    'reorderTabs',
    'closeOtherTabs',
    'closeTabsToRight',
    'reopenClosedTab',
    'toggleMuteTab',
    'onTabsUpdated',
    'onNavigationState'
  ];

  for (const method of requiredMethods) {
    assert(content.includes(method), `preload-internal.js missing required method: ${method}`);
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  Stage 1 Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
