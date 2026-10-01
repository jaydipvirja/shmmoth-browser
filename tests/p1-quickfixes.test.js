/**
 * P1 quick fixes: RAM Saver active tab, history titles + coalesced saves, program-type downloads.
 * Run: node tests/p1-quickfixes.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const Module = require('module');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_p1_'));
const SRC  = path.join(__dirname, '..', 'src');
const opened = [];
const shown = [];
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return {
      app: { getPath: (n) => path.join(ROOT, n), quit() {} },
      shell: { openPath: async (p) => { opened.push(p); return ''; }, showItemInFolder: (p) => shown.push(p) },
      dialog: {}
    };
  }
  return origLoad.call(this, request, ...args);
};

const StorageService  = require('../src/services/storage');
const DownloadManager = require('../src/services/downloadManager');
const RamSaverService = require('../src/services/ramSaver');
const mainJs = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');

function newStorage(tag) {
  const s = new StorageService();
  s.storagePath = path.join(ROOT, tag, 'mtc-data.json');
  s.data = s.load();
  return s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — P1 Quick-fix Tests                 ');
  console.log('══════════════════════════════════════════════════════\n');

  console.log('📋 1. RAM Saver never sleeps the tab in use');
  const sleeper = (extra = {}) => {
    const slept = [];
    const st = newStorage('ram' + Math.random());
    st.updateSettings({ ramSaverEnabled: true, ramSaverTimeoutMinutes: 1 });
    const old = Date.now() - 10 * 60 * 1000;
    const tabs = {
      a: { id: 'a', url: 'https://a.example/', lastActiveTime: old, isSleeping: false, view: null },
      b: { id: 'b', url: 'https://b.example/', lastActiveTime: old, isSleeping: false, view: null },
      c: { id: 'c', url: 'https://c.example/', lastActiveTime: old, isSleeping: false, view: null, isIncognito: true }
    };
    const rs = new RamSaverService(st, { tabs, notifyTabStatus: (id) => slept.push(id), ...extra });
    clearInterval(rs.timer);
    return { rs, slept };
  };
  await test('the active tab and the active incognito tab are skipped, idle ones sleep', async () => {
    const { rs, slept } = sleeper({ activeTabId: 'a', activeIncognitoTabId: 'c' });
    rs.checkTabs();
    assert(slept.join() === 'b', 'slept: ' + slept.join());
  });
  await test('main.js hands the saver live getters (a copied value was null forever)', async () => {
    assert(/get activeTabId\(\) \{ return browser\.activeTabId; \}/.test(mainJs) && /get activeIncognitoTabId\(\) \{ return browser\.activeIncognitoTabId; \}/.test(mainJs));
    assert(!/activeTabId: this\.activeTabId,\s*notifyTabStatus/.test(mainJs));
  });
  await test('a getter-based tab manager follows the user switching tabs', async () => {
    const state = { active: 'a' };
    const slept = [];
    const st = newStorage('ram-getter');
    st.updateSettings({ ramSaverEnabled: true, ramSaverTimeoutMinutes: 1 });
    const old = Date.now() - 10 * 60 * 1000;
    const tabs = { a: { lastActiveTime: old }, b: { lastActiveTime: old } };
    const manager = { tabs, get activeTabId() { return state.active; }, notifyTabStatus: (id) => slept.push(id) };   // (an object spread would copy the value)
    const rs = new RamSaverService(st, manager);
    clearInterval(rs.timer);
    rs.checkTabs(); assert(slept.join() === 'b', 'slept: ' + slept.join());
    slept.length = 0; for (const t of Object.values(tabs)) t.isSleeping = false;
    state.active = 'b'; rs.checkTabs();
    assert(slept.join() === 'a', 'slept: ' + slept.join());
  });

  console.log('\n📋 2. History titles and saves');
  await test('a new visit starts with its address as title and gets the real title when the page reports it', async () => {
    const st = newStorage('h1');
    st.addHistory({ title: '', url: 'https://news.example/article', favicon: '' });
    assert(st.getHistory()[0].title === 'https://news.example/article');
    assert(st.updateHistoryEntry('https://news.example/article', { title: 'Big story', favicon: 'https://news.example/f.ico' }) === true);
    const h = st.getHistory()[0];
    assert(h.title === 'Big story' && h.favicon === 'https://news.example/f.ico');
  });
  await test('revisiting a page does not overwrite its title with the previous page\'s title', async () => {
    const st = newStorage('h2');
    st.addHistory({ title: '', url: 'https://a.example/' }); st.updateHistoryEntry('https://a.example/', { title: 'Page A' });
    st.addHistory({ title: '', url: 'https://b.example/' }); st.updateHistoryEntry('https://b.example/', { title: 'Page B' });
    st.addHistory({ title: '', url: 'https://a.example/' });             // navigation event: tab still carries "Page B"
    const a = st.getHistory().find((x) => x.url === 'https://a.example/');
    assert(a.title === 'Page A' && a.visitCount === 2, JSON.stringify(a));
  });
  await test('unknown addresses, "New Tab", empty or oversized values are ignored', async () => {
    const st = newStorage('h3');
    st.addHistory({ title: '', url: 'https://x.example/' });
    assert(st.updateHistoryEntry('https://other.example/', { title: 'T' }) === false);
    assert(st.updateHistoryEntry('https://x.example/', { title: 'New Tab' }) === false);
    assert(st.updateHistoryEntry('https://x.example/', { title: '', favicon: 'h'.repeat(5000) }) === false);
    assert(st.updateHistoryEntry(null, { title: 'T' }) === false && st.updateHistoryEntry('https://x.example/') === false);
  });
  await test('history writes are coalesced: many page loads → one write; flush() writes at once', async () => {
    const st = newStorage('h4');
    st.storagePath = path.join(ROOT, 'h4', 'coalesce.json');
    for (let i = 0; i < 25; i++) st.addHistory({ title: '', url: `https://e.example/${i}` });
    assert(!fs.existsSync(st.storagePath), 'nothing should be written per page load');
    st.flush();
    const onDisk = JSON.parse(fs.readFileSync(st.storagePath, 'utf8'));
    assert(onDisk.history.length === 25, 'flush must write the pending history');
    assert(!st._saveTimer, 'timer cleared');
  });
  await test('the coalesced write happens on its own after the delay, and an explicit save() cancels the timer', async () => {
    const st = newStorage('h5');
    st.storagePath = path.join(ROOT, 'h5', 'auto.json');
    st.saveSoon(30); await sleep(150);
    assert(fs.existsSync(st.storagePath), 'timer should have saved');
    st.saveSoon(10_000); assert(st._saveTimer); st.save(); assert(!st._saveTimer, 'save() must clear a pending timer');
  });
  await test('wiring: titles come from page-title-updated, the navigation event passes none, quit flushes', async () => {
    assert(/updateHistoryEntry\(tabData\.url, \{ title \}\)/.test(mainJs));
    assert(/addHistory\(\{ title: '', url: navUrl, favicon: '' \}\)/.test(mainJs));
    assert(/_finalizeSession\(\) \{[\s\S]{0,200}this\.storage\.flush\(\)/.test(mainJs));
  });

  console.log('\n📋 3. Downloads that can run code');
  await test('program-type files are recognised, including double extensions and Windows trailing dots/spaces', async () => {
    for (const n of ['setup.exe', 'SETUP.EXE', 'a.msi', 'run.bat', 'x.cmd', 'x.js', 'x.vbs', 'x.ps1', 'x.hta', 'x.jar', 'x.lnk', 'x.reg', 'x.dll',
      'invoice.pdf.exe', 'setup.exe.', 'setup.exe ', 'setup.exe. .', 'C:\\Users\\me\\Downloads\\a.scr', '/home/me/run.sh', 'macro.docm', 'app.msix']) {
      assert(DownloadManager.isDangerousFile(n), n);
    }
  });
  await test('ordinary documents, media and archives are not flagged', async () => {
    for (const n of ['photo.jpg', 'a.pdf', 'song.mp3', 'film.mp4', 'a.zip', 'a.7z', 'notes.txt', 'data.csv', 'doc.docx', 'sheet.xlsx', 'page.html', 'noext', '', '.exe.txt', 'exe', 'direct.bin']) {
      assert(!DownloadManager.isDangerousFile(n), n);
    }
    assert(!DownloadManager.isDangerousFile(undefined) && !DownloadManager.isDangerousFile(null) && !DownloadManager.isDangerousFile(42));
  });

  const dir = fs.mkdtempSync(path.join(ROOT, 'dl_'));
  const withFile = (name, options) => {
    const dm = new DownloadManager(newStorage('dm' + Math.random()), options);
    const file = path.join(dir, name);
    fs.writeFileSync(file, 'x');
    dm.downloads.d1 = { id: 'd1', filename: name, savePath: file, state: 'completed' };
    return { dm, file };
  };
  await test('opening a program asks first: Cancel → not opened, shown in its folder', async () => {
    opened.length = 0; shown.length = 0;
    let asked = null;
    const { dm, file } = withFile('tool.exe', { confirmOpenDangerous: async (info) => { asked = info; return false; } });
    const r = await dm.openFile('d1');
    assert(asked && asked.filename === 'tool.exe', 'the user must be asked');
    assert(r.success === false && r.cancelled === true && r.dangerous === true, JSON.stringify(r));
    assert(opened.length === 0, 'the program must not be started');
    assert(shown[0] === file, 'the file is revealed in its folder instead');
  });
  await test('opening a program: "Open anyway" runs it', async () => {
    opened.length = 0;
    const { dm, file } = withFile('tool2.msi', { confirmOpenDangerous: async () => true });
    const r = await dm.openFile('d1');
    assert(r.success === true && opened[0] === file, JSON.stringify(r));
  });
  await test('no confirmation callback (or one that throws) → programs are never started', async () => {
    opened.length = 0;
    const a = withFile('x.bat', {}); assert((await a.dm.openFile('d1')).success === false);
    const b = withFile('y.js', { confirmOpenDangerous: async () => { throw new Error('dialog failed'); } }); assert((await b.dm.openFile('d1')).success === false);
    assert(opened.length === 0);
  });
  await test('ordinary files open without any question', async () => {
    opened.length = 0;
    let asked = false;
    const { dm, file } = withFile('holiday.jpg', { confirmOpenDangerous: async () => { asked = true; return false; } });
    const r = await dm.openFile('d1');
    assert(r.success === true && opened[0] === file && !asked);
  });
  await test('main.js asks with a dialog whose default button is Cancel', async () => {
    const block = mainJs.slice(mainJs.indexOf('confirmOpenDangerous: async'), mainJs.indexOf('promptSaveDialog: async'));
    assert(/buttons: \['Cancel', 'Open anyway'\]/.test(block) && /defaultId: 0/.test(block) && /cancelId: 0/.test(block), block.slice(0, 300));
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
})();
