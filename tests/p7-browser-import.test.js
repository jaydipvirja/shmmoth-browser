/**
 * Import bookmarks and history from Chrome / Edge / Brave (services/browserImport.js).
 * Run: node tests/p7-browser-import.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { writeFakeProfile } = require('./helpers/fake-chromium-profile');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const imp = require(path.join(ROOT, 'src', 'services', 'browserImport.js'));

// the real Storage on a throw-away profile (Electron's app.getPath points at it)
let profileDir = os.tmpdir();
const realLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: { getPath: () => profileDir } } : realLoad.call(this, req, ...rest); };
const Storage = require(path.join(ROOT, 'src', 'services', 'storage.js'));
Module._load = realLoad;
const freshStorage = () => { profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-store-')); return new Storage(); };

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-home-'));
const env = { XDG_CONFIG_HOME: path.join(home, '.config'), LOCALAPPDATA: path.join(home, 'Local') };
const opts = { platform: 'linux', env, home };
const fake = writeFakeProfile(path.join(env.XDG_CONFIG_HOME, 'google-chrome'), { profileName: 'Jaydip' });

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — import from Chrome / Edge / Brave');
console.log('══════════════════════════════════════════════════════\n');

test('finds the browsers and their profiles where each system keeps them', () => {
  const found = imp.detect(opts);
  assert(found.length === 1 && found[0].id === 'chrome' && found[0].name === 'Google Chrome', JSON.stringify(found));
  const p = found[0].profiles[0];
  assert(p.dir === 'Default' && p.name === 'Jaydip' && p.hasBookmarks && p.hasHistory, JSON.stringify(p));
  const chrome = imp.BROWSERS.find((b) => b.id === 'chrome');
  assert(imp.userDataDir(chrome, { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\j\\AppData\\Local' }, home: 'C:\\Users\\j' }).replace(/\\/g, '/').endsWith('AppData/Local/Google/Chrome/User Data'));
  assert(imp.detect({ platform: 'linux', env: { XDG_CONFIG_HOME: path.join(home, 'nothing') }, home }).length === 0, 'nothing found when nothing is installed');
});

test('bookmarks: web addresses only, no duplicates, bookmarks bar first', () => {
  const list = imp.parseBookmarks(JSON.parse(fs.readFileSync(path.join(fake.dir, 'Bookmarks'), 'utf8')));
  assert(JSON.stringify(list.map((b) => b.url)) === JSON.stringify(fake.expectedBookmarks), JSON.stringify(list));
  assert(imp.parseBookmarks(null).length === 0 && imp.parseBookmarks({ roots: 5 }).length === 0, 'a damaged file gives nothing');
});

test('history: from a copy, read-only, newest first, visible web pages only, with their own visit time', () => {
  const before = fs.readFileSync(path.join(fake.dir, 'History'));
  const rows = imp.readHistory(path.join(fake.dir, 'History'));
  assert(JSON.stringify(rows.map((r) => r.url)) === JSON.stringify(fake.expectedHistory), JSON.stringify(rows));
  assert(Math.abs(rows[0].visitTime - fake.recentVisit) < 5 && rows[0].visitCount === 7, JSON.stringify(rows[0]));
  assert(before.equals(fs.readFileSync(path.join(fake.dir, 'History'))), "the other browser's file is not changed");
});

test('the import fills this browser once; a second import adds nothing twice', () => {
  const storage = freshStorage();
  const r = imp.runImport(storage, { browserId: 'chrome', profileDir: 'Default' }, opts);
  assert(r.bookmarks === 3 && r.history === 2 && r.folder === 'Imported from Google Chrome', JSON.stringify(r));
  const imported = storage.getBookmarks('Imported from Google Chrome').map((b) => b.url);
  assert(fake.expectedBookmarks.every((u) => imported.includes(u)), 'bookmarks in their own folder');
  assert(storage.getBookmarkFolders().includes('Imported from Google Chrome'));
  assert(storage.getHistory().some((h) => h.url === 'https://recent.example.com/' && h.visitCount === 7));
  const again = imp.runImport(storage, { browserId: 'chrome', profileDir: 'Default' }, opts);
  assert(again.bookmarks === 0 && again.history === 0, JSON.stringify(again));
});

test('only a browser and profile that were found can be imported (no paths from the page)', () => {
  const storage = freshStorage();
  for (const bad of [{ browserId: 'chrome', profileDir: '../../etc' }, { browserId: 'firefox', profileDir: 'Default' }, { browserId: 'edge', profileDir: 'Default' }]) {
    let threw = false;
    try { imp.runImport(storage, bad, opts); } catch (_) { threw = true; }
    assert(threw, 'refused: ' + JSON.stringify(bad));
  }
});

test('history stays at 2,000 entries, newest kept', () => {
  const storage = freshStorage();
  const rows = Array.from({ length: 2100 }, (_, i) => ({ url: `https://s${i}.example/`, title: 't', visitCount: 1, visitTime: 1000000 + i }));
  const kept = storage.importHistory(rows);
  const h = storage.getHistory();
  assert(kept === 2000 && h.length === 2000 && h[0].url === 'https://s2099.example/', `${kept} ${h.length} ${h[0].url}`);
});

test('wired up: IPC checks its input, Settings and the Welcome card offer it', () => {
  const ipc = read('src', 'browser', 'ipc.js');
  assert(/ipcMain\.handle\('import:detect', secureHandlerRaw\(\(\) => browserImport\.detect\(\)\)\)/.test(ipc));
  assert(/sanitizeString\(req\.browserId, 16, 'browserId'\)/.test(ipc) && /sanitizeString\(req\.profileDir, 64, 'profileDir'\)/.test(ipc));
  assert(/id="modal-import"/.test(read('src', 'pages', 'settings.html')) && /importFromBrowser\(\{ \.\.\.source, bookmarks, history \}\)/.test(read('src', 'pages', 'settings.js')));
  assert(/id="welcome-import"/.test(read('src', 'pages', 'newtab.html')) && /setupWelcomeImport\(api\)/.test(read('src', 'pages', 'newtab.js')));
  assert(!/password|cookie/i.test(read('src', 'services', 'browserImport.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'no passwords or cookies are read');
});

fs.rmSync(home, { recursive: true, force: true });
console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
