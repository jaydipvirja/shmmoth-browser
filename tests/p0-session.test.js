/**
 * P0 — session restore ("Continue where I left off").
 * Run: node tests/p0-session.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

const { SessionStore, buildSnapshot, sanitizeSnapshot, isRestorableUrl, MAX_TABS } = require('../src/services/sessionStore');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_session_'));

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — P0 Session Restore Tests           ');
console.log('══════════════════════════════════════════════════════\n');

console.log('📋 1. What may be restored');
test('web pages and known internal pages are restorable', () => {
  for (const u of ['https://example.com/a?b=1#c', 'http://localhost:3000/', 'mtc://newtab', 'mtc://settings#about', 'mtc://history']) assert(isRestorableUrl(u), u);
});
test('files, scripts, data URLs, crash pages, unknown internal pages and junk are not', () => {
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'mtc://crash?x=1', 'mtc://evil', 'chrome-extension://abc/popup.html',
    'about:blank', 'view-source:https://example.com', '', 'not a url', null, undefined, 42, {}, 'https://' + 'a'.repeat(5000)]) {
    assert(!isRestorableUrl(u), String(u).slice(0, 40));
  }
});

console.log('\n📋 2. Taking a snapshot');
test('keeps order, titles, pin state and the active tab; ignores incognito and unrestorable tabs', () => {
  const tabs = {
    t1: { url: 'https://a.example/', title: 'A', favicon: 'https://a.example/f.ico', isPinned: true },
    t2: { url: 'file:///secret.txt', title: 'File' },
    t3: { url: 'https://b.example/', title: 'B', isPinned: false },
    t4: { url: 'https://private.example/', title: 'Private', isIncognito: true },
    t5: { url: 'mtc://crash?why=1', title: 'Crashed' },
    t6: { url: 'https://c.example/', title: 'C' }
  };
  const s = buildSnapshot(tabs, ['t1', 't2', 't3', 't4', 't5', 't6'], 't3');
  assert(s.tabs.map((t) => t.url).join() === 'https://a.example/,https://b.example/,https://c.example/', JSON.stringify(s.tabs));
  assert(s.active === 1 && s.tabs[0].pinned === true && s.tabs[0].favicon === 'https://a.example/f.ico');
  assert(!JSON.stringify(s).includes('private.example'), 'incognito tab leaked into the session file');
});
test('a restored tab that never loaded is saved under its original address', () => {
  const s = buildSnapshot({ t1: { url: 'https://stale.example/', pendingLoadUrl: 'https://real.example/' } }, ['t1'], 't1');
  assert(s.tabs[0].url === 'https://real.example/');
});
test('titles and icons are bounded; data: and oversized icons are dropped', () => {
  const s = buildSnapshot({ a: { url: 'https://a.example/', title: 'x'.repeat(1000), favicon: 'data:image/png;base64,AAAA' }, b: { url: 'https://b.example/', favicon: 'https://b.example/' + 'i'.repeat(3000) } }, ['a', 'b'], 'a');
  assert(s.tabs[0].title.length === 200 && s.tabs[0].favicon === '' && s.tabs[1].favicon === '');
});
test('at most MAX_TABS tabs; the active index falls back to the last tab when the active one is not saved', () => {
  const tabs = {}; const order = [];
  for (let i = 0; i < MAX_TABS + 20; i++) { tabs['t' + i] = { url: `https://e.example/${i}` }; order.push('t' + i); }
  const s = buildSnapshot(tabs, order, 'nope');
  assert(s.tabs.length === MAX_TABS && s.active === MAX_TABS - 1);
});

console.log('\n📋 3. Reading it back');
test('a valid snapshot round-trips; unknown or hostile entries are dropped on the way in', () => {
  const raw = { version: 1, savedAt: 1, active: 2, tabs: [
    { url: 'https://a.example/', title: 'A', pinned: true },
    { url: 'javascript:alert(1)' }, { url: 'file:///x' }, 'string', null, { title: 'no url' },
    { url: 'mtc://settings', title: 'S', favicon: 'javascript:1' }
  ] };
  const s = sanitizeSnapshot(raw);
  assert(s.tabs.length === 2 && s.tabs[1].favicon === '' && s.tabs[0].pinned === true, JSON.stringify(s));
  assert(s.active === 1, 'active index must be clamped to the remaining tabs, got ' + s.active);
});
test('wrong version, wrong shape or nothing restorable → null', () => {
  for (const raw of [null, [], 'x', { version: 2, tabs: [{ url: 'https://a.example/' }] }, { version: 1 }, { version: 1, tabs: [] }, { version: 1, tabs: [{ url: 'file:///x' }] }]) {
    assert(sanitizeSnapshot(raw) === null, JSON.stringify(raw));
  }
});

console.log('\n📋 4. The file');
test('save → load round trip; an unchanged snapshot is not rewritten', () => {
  const dir = tmp(); const store = new SessionStore(dir);
  const snap = buildSnapshot({ a: { url: 'https://a.example/', title: 'A' } }, ['a'], 'a');
  assert(store.save(snap) === true);
  const mtime = fs.statSync(store.filePath).mtimeMs;
  assert(store.save({ ...snap, savedAt: snap.savedAt + 5 }) === false, 'identical tabs must not be rewritten');
  assert(fs.statSync(store.filePath).mtimeMs === mtime);
  assert(new SessionStore(dir).load().tabs[0].url === 'https://a.example/');
});
test('no file → null', () => assert(new SessionStore(tmp()).load() === null));
test('a damaged file is kept aside, load() returns null instead of throwing, and the next save works', () => {
  const dir = tmp(); const store = new SessionStore(dir);
  fs.writeFileSync(store.filePath, '{"version":1,"tabs":[{"url":"https://a.exa');
  assert(store.load() === null);
  assert(fs.readdirSync(dir).some((n) => n.startsWith('shmmoth-session.json.corrupt-')), 'damaged copy must be preserved');
  assert(store.save(buildSnapshot({ a: { url: 'https://ok.example/' } }, ['a'], 'a')) === true);
  assert(store.load().tabs[0].url === 'https://ok.example/');
});
test('a crash in the middle of a write leaves the previous snapshot (restored from the .bak)', () => {
  const dir = tmp(); const store = new SessionStore(dir);
  store.save(buildSnapshot({ a: { url: 'https://first.example/' } }, ['a'], 'a'));
  store.save(buildSnapshot({ a: { url: 'https://second.example/' } }, ['a'], 'a'));
  fs.writeFileSync(store.filePath, fs.readFileSync(store.filePath, 'utf8').slice(0, 20));       // torn write
  const back = new SessionStore(dir).load();
  assert(back && back.tabs[0].url === 'https://first.example/', JSON.stringify(back));
});
test('a failing disk never throws out of save()', () => {
  const store = new SessionStore(path.join(tmp(), 'does', 'not', 'exist'));
  store.filePath = path.join(tmp(), 'x'); fs.mkdirSync(store.filePath);       // a directory where the file should be
  assert(store.save(buildSnapshot({ a: { url: 'https://a.example/' } }, ['a'], 'a')) === false);
});

console.log('\n📋 5. Wiring in main.js / settings');
test('the default start-up behaviour is the new-tab page (no change for existing users)', () => {
  assert(/startupBehavior:\s+'newtab'/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'storage.js'), 'utf8')));
});
test('the session is written on tab changes (normal tabs only) and frozen when the window closes / the app quits', () => {
  assert(/broadcastTabsUpdate\(isIncognito = false\) \{\s*if \(!isIncognito\) this\._scheduleSessionSave\(\);/.test(mainJs));
  assert(/this\.mainWindow\.on\('close',\s+\(\) => this\._finalizeSession\(\)\)/.test(mainJs));
  // the quit handler freezes the session first and then writes cookies to disk before really quitting (see p1-login-durability)
  assert(/app\.on\('before-quit', \(event\) => \{\s*this\._finalizeSession\(\);/.test(mainJs));
  assert(/_finalizeSession\(\) \{\s*this\._saveSessionNow\(\);\s*this\._sessionReady = false;/.test(mainJs));
});
test('nothing is saved before the start-up tabs exist (the half-built tab list must not overwrite the saved session)', () => {
  assert(/_scheduleSessionSave\(\) \{\s*if \(!this\._sessionReady/.test(mainJs));
  assert(/this\._sessionReady = true;\s*this\._saveSessionNow\(\);/.test(mainJs));
});
test('restore only happens when the setting says so, and only the selected tab is loaded at once', () => {
  assert(/startupBehavior === 'restore'/.test(mainJs));
  assert(/background: i !== saved\.active, deferLoad: i !== saved\.active/.test(mainJs));
  assert(/if \(!tabData\.pendingLoadUrl\) wc\.loadURL\(initialUrl\)/.test(mainJs));
  assert(/this\._loadPendingUrl\(currentTab\);/.test(mainJs), 'selecting a restored tab must load it');
});
test('the page context-menu "Reload" calls a method that exists', () => {
  assert(/\n  reloadTab\(tabId\) \{/.test(mainJs));
});

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
