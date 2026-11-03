/**
 * P16 — Smoothness (1.5.7)
 *
 *   - background writes (writeJsonAtomicAsync): the file is replaced whole, a .bak is kept, no temporary files are
 *     left, many saves in a row coalesce into a few writes with the newest data last, and a synchronous write (the
 *     browser closing) always wins over one still on its way
 *   - the main thread is not held: the timing hook hears synchronous writes only
 *   - the session store: saves while browsing go in the background; the last save on closing is synchronous even when
 *     the same tabs are still on their way to the disk
 *   - the Speed check: stalls, slow work, garbage collection, the graphics card, the report text
 *   - the wiring: main.js, storage, session, privacy files, IPC, preload, Settings
 *
 * Run: node tests/p16-smooth.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const atomic = require('../src/utils/atomicJson');
const { SessionStore } = require('../src/services/sessionStore');
const { PerfMonitor, reportText } = require('../src/services/perfMonitor');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; } catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const SRC = path.join(__dirname, '..', 'src');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth-p16-'));
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const leftovers = (dir) => fs.readdirSync(dir).filter((n) => n.includes('.tmp'));

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — Smoothness: background writes, Speed check');
  console.log('══════════════════════════════════════════════════════\n');

  console.log('📋 Background writes');
  await test('the file is replaced whole, a backup is kept, nothing temporary is left', async () => {
    const dir = fs.mkdtempSync(path.join(TMP, 'a-'));
    const f = path.join(dir, 'data.json');
    await atomic.writeJsonAtomicAsync(f, { v: 1 });
    eq(read(f), { v: 1 });
    await atomic.writeJsonAtomicAsync(f, { v: 2 });
    eq(read(f), { v: 2 });
    eq(read(f + '.bak'), { v: 1 }, 'the previous good copy');
    eq(leftovers(dir), []);
  });

  await test('many saves in a row: a few writes, the newest data last', async () => {
    const dir = fs.mkdtempSync(path.join(TMP, 'b-'));
    const f = path.join(dir, 'data.json');
    const origOpen = fs.promises.open;
    let opens = 0;
    fs.promises.open = (...a) => { if (String(a[0]).startsWith(f)) opens++; return origOpen.apply(fs.promises, a); };
    try {
      const data = { n: 0 };
      let last;
      for (let i = 1; i <= 20; i++) { data.n = i; last = atomic.writeJsonAtomicAsync(f, data); }
      data.n = 999;                                   // a change after the last save does not leak into it
      await last;
      eq(read(f), { n: 20 });
      assert(opens <= 2, 'writes: ' + opens);
      eq(leftovers(dir), []);
    } finally { fs.promises.open = origOpen; }
  });

  await test('a synchronous write (the browser closing) wins over one still on its way', async () => {
    const dir = fs.mkdtempSync(path.join(TMP, 'c-'));
    const f = path.join(dir, 'data.json');
    const pending = atomic.writeJsonAtomicAsync(f, { from: 'background' });
    atomic.writeJsonAtomic(f, { from: 'closing' });
    await pending;
    eq(read(f), { from: 'closing' });
    eq(leftovers(dir), []);
  });

  await test('the timing hook hears synchronous writes (they hold the thread), not background ones', async () => {
    const dir = fs.mkdtempSync(path.join(TMP, 'd-'));
    const heard = [];
    atomic.setTimingHook((what, ms) => heard.push([what, ms]));
    try {
      await atomic.writeJsonAtomicAsync(path.join(dir, 'bg.json'), { a: 1 });
      atomic.writeJsonAtomic(path.join(dir, 'now.json'), { a: 1 });
    } finally { atomic.setTimingHook(null); }
    eq(heard.map((h) => h[0]), ['write now.json']);
    assert(heard[0][1] >= 0);
  });

  console.log('\n📋 Session store');
  await test('saves while browsing go in the background; the save on closing is written at once', async () => {
    const dir = fs.mkdtempSync(path.join(TMP, 's-'));
    const store = new SessionStore(dir);
    const snap = (url) => ({ version: 1, tabs: [{ url, title: 't', pinned: false }], active: 0 });
    assert(store.save(snap('https://a.example/'), { background: true }), 'started');
    assert(!store.save(snap('https://a.example/'), { background: true }), 'the same tabs again: nothing new');
    // the window closes before the background write landed: the same tabs are written synchronously
    assert(store.save(snap('https://a.example/')), 'written on closing');
    eq(read(path.join(dir, 'shmmoth-session.json')).tabs[0].url, 'https://a.example/');
    await new Promise((r) => setTimeout(r, 100));
    assert(!store.save(snap('https://a.example/')), 'already on the disk');
    assert(store.save(snap('https://b.example/'), { background: true }));
    await new Promise((r) => setTimeout(r, 200));
    eq(read(path.join(dir, 'shmmoth-session.json')).tabs[0].url, 'https://b.example/');
  });

  console.log('\n📋 Speed check');
  await test('stalls, slow work, garbage collection and the graphics card are reported', async () => {
    let now = 1_000_000;
    const m = new PerfMonitor({ now: () => now });
    m._last = now;
    now += 50; m._tick();                              // on time
    now += 450; m._tick();                             // 400 ms late
    now += 1350; m._tick();                            // 1300 ms late
    m.note('write mtc-data.json', 120);
    m.note('web request checks', 0.2);
    m.note('web request checks', 0.3);
    m.noteGc(12); m.noteGc(80);
    now += 60000;
    const r = m.report({
      gpuStatus: { gpu_compositing: 'disabled_software', rasterization: 'enabled', video_decode: 'enabled', webgl: 'enabled_on' },
      metrics: [{ type: 'Browser', memory: { workingSetSize: 204800 }, cpu: { percentCPUUsage: 1.5 } }, { type: 'Tab', memory: { workingSetSize: 102400 }, cpu: { percentCPUUsage: 3 } }],
      tabs: 3, sleepingTabs: 1, heapMB: 60, versions: { app: '1.5.7', electron: '44', chrome: '152', os: 'win32' }
    });
    eq([r.stalls.count, r.stalls.over250ms, r.stalls.over1s, r.stalls.worst], [2, 2, 1, [1300, 400]]);
    eq(r.slowWork, [{ what: 'write mtc-data.json', ms: 120 }], 'only work of 30 ms or more is listed');
    assert(r.work.some((w) => w.what === 'web request checks' && w.count === 2), 'all work is counted');
    eq([r.gc.count, r.gc.maxMs, r.gc.over50ms, r.gc.heapMB], [2, 80, 1, 60]);
    eq(r.gpu.notOnGpu, ['gpu_compositing'], 'drawn in software');
    eq(r.processes.Browser, { count: 1, memoryMB: 200, cpu: 1.5 });
    const text = reportText(r);
    for (const part of ['SHMMOTH speed check — 1.5.7', 'Stalls: 2', 'over 1 s: 1', 'Not on the graphics card: gpu_compositing', 'write mtc-data.json 120 ms', 'Garbage collection: 2×']) assert(text.includes(part), 'report text: ' + part);
  });

  await test('start / stop: a real timer, unref\'d, and the GC watch', async () => {
    const m = new PerfMonitor();
    m.start(); m.start();                              // twice is harmless
    assert(m._timer && m._gcObserver);
    m.stop();
    assert(!m._timer && !m._gcObserver);
  });

  console.log('\n📋 Wiring');
  await test('main.js, storage, session, privacy files, IPC, preload, Settings', async () => {
    const r = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
    const main = r('main.js');
    assert(/this\.perf = new PerfMonitor\(\);\s*this\.perf\.start\(\);/.test(main), 'Speed check started first');
    assert(main.indexOf('this.perf.start()') < main.indexOf('new StorageService()'), 'before anything else');
    assert(/setTimingHook\(\(what, ms\) => this\.perf\.note\(what, ms\)\)/.test(main) && /webRequestHub\.setTimingHook/.test(main));
    const storage = r('services/storage.js');
    assert(/setTimeout\(\(\) => \{ this\._saveTimer = null; this\._saveInBackground\(\); \}/.test(storage), 'history saves in the background');
    assert(/if \(this\._saveTimer \|\| this\._writing > 0\) this\.save\(\);/.test(storage), 'closing writes what is still on its way');
    assert(/_saveSessionNow\(\{ background: true \}\)/.test(r('browser/session.js')), 'tab saves in the background');
    for (const f of ['services/privacyStats.js', 'services/privacyCleaner.js']) assert(/this\.flush\(\{ background: true \}\)/.test(r(f)), f);
    assert(r('browser/ipc.js').includes("ipcMain.handle('perf:report', secureHandlerRaw("));
    assert(/getPerfReport:\s+\(\)\s+=> ipcRenderer\.invoke\('perf:report'\)/.test(r('preload-internal.js')));
    const html = r('pages/settings.html');
    for (const id of ['btn-perf-check', 'btn-perf-copy', 'perf-report']) assert(html.includes(`id="${id}"`), id);
    assert(/out\.textContent = res\.text;/.test(r('pages/settings.js')), 'the report is shown as text');
    assert(/app\.getGPUFeatureStatus\(\)/.test(r('browser/network.js')));
  });

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\n  p16-smooth: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
