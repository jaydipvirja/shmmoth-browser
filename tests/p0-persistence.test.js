/**
 * SHMMOTH BROWSER — P0 PERSISTENCE / PASSWORD-VAULT TESTS
 *   - atomic writes, backups, non-destructive recovery of damaged data files
 *   - StorageService / AutofillService / PasswordVault / ProxyManager use them
 *   - vault refuses weak encryption; legacy records are migrated
 *
 * Run with: node tests/p0-persistence.test.js
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

// ── Electron mock with a switchable safeStorage ──────────────────────────────
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_p0_persist_'));
const state = { osEncryption: false };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return {
      app: { getPath: () => path.join(ROOT, 'userData'), quit() {} },
      safeStorage: {
        isEncryptionAvailable: () => state.osEncryption,
        encryptString: (s) => Buffer.from('DPAPI:' + s, 'utf8'),
        decryptString: (b) => {
          const t = b.toString('utf8');
          if (!t.startsWith('DPAPI:')) throw new Error('bad blob');
          return t.slice(6);
        }
      }
    };
  }
  return origLoad.call(this, request, ...args);
};

const { writeJsonAtomic, readJsonRecovering, isPlainObject } = require('../src/utils/atomicJson');
const StorageService  = require('../src/services/storage');
const { AutofillService } = require('../src/services/autofillService');
const { PasswordVault } = require('../src/services/passwordVault');
const { ProxyManager }  = require('../src/services/proxyManager');

let counter = 0;
function freshDir() {
  const d = path.join(ROOT, 'case_' + (++counter));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const list = (dir) => fs.readdirSync(dir).sort();
const write = (f, s) => fs.writeFileSync(f, s, 'utf8');
const read  = (f) => fs.readFileSync(f, 'utf8');

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — P0 Persistence / Vault Tests       ');
console.log('══════════════════════════════════════════════════════\n');

// ═════════════════════════════════════════════════════════════════════════════
console.log('📋 1. atomicJson');
// ═════════════════════════════════════════════════════════════════════════════

test('write creates a valid file and leaves no temp files behind', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  writeJsonAtomic(f, { hello: 'world' });
  assert(JSON.parse(read(f)).hello === 'world');
  assert(list(dir).join() === 'a.json', 'unexpected files: ' + list(dir));
});

test('second write keeps the previous content as .bak', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  writeJsonAtomic(f, { v: 1 }); writeJsonAtomic(f, { v: 2 });
  assert(JSON.parse(read(f)).v === 2);
  assert(JSON.parse(read(f + '.bak')).v === 1);
});

test('a crash mid-write (leftover half-written temp file) never affects the real file', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  writeJsonAtomic(f, { v: 1 });
  write(f + '.tmp-99999', '{"v": 2, "trunc');          // what a killed process leaves behind
  const res = readJsonRecovering(f);
  assert(res.source === 'primary' && res.data.v === 1);
  writeJsonAtomic(f, { v: 3 });                          // and the next write still works
  assert(JSON.parse(read(f)).v === 3);
});

test('a failed write (unserialisable data) throws and leaves the old file intact', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  writeJsonAtomic(f, { v: 1 });
  const cyclic = {}; cyclic.self = cyclic;
  let threw = false;
  try { writeJsonAtomic(f, cyclic); } catch (_) { threw = true; }
  assert(threw && JSON.parse(read(f)).v === 1);
  assert(!list(dir).some(n => n.includes('.tmp-')), 'temp file leaked: ' + list(dir));
});

test('damaged primary + good .bak → restored from backup, damaged copy preserved', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  writeJsonAtomic(f, { v: 1 }); writeJsonAtomic(f, { v: 2 });    // primary v2, bak v1
  write(f, '{"v": 2, "bookmarks": [ {"url": "https://exa');       // truncated by a crash
  const res = readJsonRecovering(f);
  assert(res.source === 'backup' && res.data.v === 1, JSON.stringify(res));
  assert(res.corruptPath && fs.existsSync(res.corruptPath), 'damaged copy must be preserved');
  assert(read(res.corruptPath).startsWith('{"v": 2, "bookmarks"'));
  assert(JSON.parse(read(f)).v === 1, 'primary must be restored');
});

test('damaged primary and NO backup → defaults, but the damaged file is kept, never overwritten', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  write(f, 'not json at all {{{');
  const res = readJsonRecovering(f);
  assert(res.source === 'none' && res.data === null);
  assert(fs.existsSync(res.corruptPath) && read(res.corruptPath) === 'not json at all {{{');
  writeJsonAtomic(f, { fresh: true });                           // subsequent save must not destroy the evidence
  assert(read(res.corruptPath) === 'not json at all {{{');
});

test('valid JSON of the wrong shape is treated as damaged', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  write(f, '[1,2,3]');
  const res = readJsonRecovering(f, { validate: isPlainObject });
  assert(res.source === 'none' && res.corruptPath, JSON.stringify(res));
});

test('a UTF-8 BOM does not make a good file look damaged', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  write(f, '﻿{"v": 1}');
  assert(readJsonRecovering(f).data.v === 1);
});

test('an existing file that cannot be READ is reported as unreadable (not treated as damaged)', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  fs.mkdirSync(f);                                               // reading a directory throws EISDIR
  const res = readJsonRecovering(f);
  assert(res.source === 'unreadable' && !res.corruptPath, JSON.stringify(res));
  assert(fs.statSync(f).isDirectory(), 'must not be moved/removed');
});

test('a damaged file never replaces a good backup', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  writeJsonAtomic(f, { v: 1 }); writeJsonAtomic(f, { v: 2 });    // bak = v1
  write(f, '{broken');                                           // damaged primary, not yet noticed
  writeJsonAtomic(f, { v: 3 });                                  // next write must not copy it over the backup
  assert(JSON.parse(read(f + '.bak')).v === 1, 'good backup was overwritten by damaged data');
});

test('backup interval throttles .bak refreshes', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  writeJsonAtomic(f, { v: 1 }, { backupIntervalMs: 60000 });
  writeJsonAtomic(f, { v: 2 }, { backupIntervalMs: 60000 });     // creates .bak (v1) – none existed yet
  writeJsonAtomic(f, { v: 3 }, { backupIntervalMs: 60000 });     // within interval → .bak stays v1
  assert(JSON.parse(read(f + '.bak')).v === 1);
});

test('only the 3 newest damaged copies are kept', () => {
  const dir = freshDir(); const f = path.join(dir, 'a.json');
  for (let i = 0; i < 5; i++) {
    write(f, '{bad' + i);
    readJsonRecovering(f);
    // ensure distinct timestamps
    const t = Date.now(); while (Date.now() === t) { /* spin 1ms */ }
  }
  const copies = list(dir).filter(n => n.includes('.corrupt-'));
  assert(copies.length === 3, 'copies: ' + copies.length);
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 2. StorageService (bookmarks / history / settings / notes)');
// ═════════════════════════════════════════════════════════════════════════════

function newStorage(dir) {
  const s = new StorageService();
  s.storagePath = path.join(dir, 'mtc-data.json');
  s.data = s.load();
  return s;
}

test('data survives restart; each save is atomic and produces a .bak', () => {
  const dir = freshDir();
  const s = newStorage(dir);
  s.addBookmark({ title: 'Mine', url: 'https://mine.example/' });
  s.addBookmark({ title: 'Mine2', url: 'https://mine2.example/' });
  const again = newStorage(dir);
  assert(again.getBookmarks().some(b => b.url === 'https://mine2.example/'));
  assert(fs.existsSync(path.join(dir, 'mtc-data.json.bak')));
});

test('REGRESSION: a truncated data file no longer wipes bookmarks/history on the next save', () => {
  const dir = freshDir();
  const s = newStorage(dir);
  s.addBookmark({ title: 'Precious', url: 'https://precious.example/' });
  s.addHistory({ title: 'Page', url: 'https://page.example/' });
  const file = path.join(dir, 'mtc-data.json');
  const good = read(file);
  fs.copyFileSync(file, file + '.bak');                           // (a backup exists after normal use)
  write(file, good.slice(0, Math.floor(good.length / 2)));        // crash/power-loss truncation

  const restarted = newStorage(dir);                              // app starts again
  assert(restarted.loadSource === 'backup', 'loadSource=' + restarted.loadSource);
  assert(restarted.getBookmarks().some(b => b.url === 'https://precious.example/'), 'bookmark lost');
  restarted.addHistory({ title: 'New', url: 'https://new.example/' }); // first save after recovery
  assert(JSON.parse(read(file)).bookmarks.some(b => b.url === 'https://precious.example/'));
  assert(list(dir).some(n => n.startsWith('mtc-data.json.corrupt-')), 'damaged copy not preserved');
});

test('damaged data file with no backup: starts fresh but keeps the damaged copy', () => {
  const dir = freshDir();
  write(path.join(dir, 'mtc-data.json'), '{"bookmarks": [');
  const s = newStorage(dir);
  assert(s.loadSource === 'none');
  s.addBookmark({ title: 'x', url: 'https://x.example/' });
  const kept = list(dir).filter(n => n.startsWith('mtc-data.json.corrupt-'));
  assert(kept.length === 1 && read(path.join(dir, kept[0])) === '{"bookmarks": [');
});

test('unreadable data file → persistence blocked so the user data is never overwritten', () => {
  const dir = freshDir();
  fs.mkdirSync(path.join(dir, 'mtc-data.json'));                  // stands in for a locked/permission-denied file
  const s = newStorage(dir);
  assert(s.persistBlocked === true);
  s.addBookmark({ title: 'x', url: 'https://x.example/' });       // must not throw or replace the path
  assert(fs.statSync(path.join(dir, 'mtc-data.json')).isDirectory());
});

test('non-object JSON (e.g. "null" or an array) is handled', () => {
  for (const bad of ['null', '[]', '"str"', '42']) {
    const dir = freshDir();
    write(path.join(dir, 'mtc-data.json'), bad);
    const s = newStorage(dir);
    assert(Array.isArray(s.getBookmarks()), 'defaults expected for ' + bad);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 3. AutofillService / ProxyManager use the same safety net');
// ═════════════════════════════════════════════════════════════════════════════

test('autofill profiles: restored from backup after truncation, damaged copy kept', () => {
  const dir = freshDir(); const f = path.join(dir, 'shmmoth-autofill.json');
  const a = new AutofillService(f);
  a.saveProfile({ name: 'Home', email: 'me@example.com' });
  a.saveProfile({ name: 'Work', email: 'me@work.example' });      // creates .bak with 1 profile
  write(f, '{"profiles": [{"na');
  const b = new AutofillService(f);
  assert(b.getProfiles().length >= 1, 'profile lost');
  assert(list(dir).some(n => n.includes('.corrupt-')));
});

test('proxy config: damaged file does not crash and keeps the damaged copy', () => {
  const dir = freshDir(); const f = path.join(dir, 'shmmoth-proxy.json');
  write(f, '{"mode": "man');
  const p = new ProxyManager(f, null);
  assert(p.getConfig().mode === 'system');
  assert(list(dir).some(n => n.includes('.corrupt-')));
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 4. PasswordVault');
// ═════════════════════════════════════════════════════════════════════════════

const cred = (n = 1) => ({ origin: 'https://site' + n + '.example', username: 'user' + n, password: 'S3cret!' + n });

test('without OS encryption the vault REFUSES to store passwords (no predictable-key fallback)', () => {
  state.osEncryption = false;
  const dir = freshDir(); const f = path.join(dir, 'shmmoth-vault.json');
  const v = new PasswordVault(f);
  assert(v.canEncrypt() === false);
  let code = null;
  try { v.saveCredential(cred()); } catch (e) { code = e.code; }
  assert(code === 'ENCRYPTION_UNAVAILABLE', 'code=' + code);
  assert(!fs.existsSync(f), 'nothing may be written');
  assert(v.getAllCredentialsMetadata().length === 0);
});

test('with OS encryption: stored as safe:…, plaintext never on disk, round-trips', () => {
  state.osEncryption = true;
  const dir = freshDir(); const f = path.join(dir, 'shmmoth-vault.json');
  const v = new PasswordVault(f);
  const saved = v.saveCredential(cred(1));
  assert(saved.encryptedPassword.startsWith('safe:'));
  assert(!read(f).includes('S3cret!1'), 'plaintext leaked to disk');
  assert(v.decryptForAuthorizedUse(saved.id) === 'S3cret!1');
  assert(new PasswordVault(f).getAllCredentialsMetadata().length === 1);
});

test('REGRESSION: a damaged vault no longer wipes all passwords — backup is restored', () => {
  state.osEncryption = true;
  const dir = freshDir(); const f = path.join(dir, 'shmmoth-vault.json');
  const v = new PasswordVault(f);
  v.saveCredential(cred(1)); v.saveCredential(cred(2));           // .bak now holds the 1-credential vault
  write(f, '{"credentials": [ {"id": "cred_1", "orig');           // truncated
  const restarted = new PasswordVault(f);
  assert(restarted.getAllCredentialsMetadata().length >= 1, 'all passwords lost');
  restarted.saveCredential(cred(3));                              // first save after recovery
  assert(list(dir).some(n => n.startsWith('shmmoth-vault.json.corrupt-')), 'damaged vault must be preserved');
});

test('damaged vault with no backup: starts empty but the damaged file is kept for manual recovery', () => {
  state.osEncryption = true;
  const dir = freshDir(); const f = path.join(dir, 'shmmoth-vault.json');
  write(f, '{"credentials": [ {"id": "x"');
  const v = new PasswordVault(f);
  assert(v.getAllCredentialsMetadata().length === 0);
  v.saveCredential(cred(1));
  const kept = list(dir).filter(n => n.startsWith('shmmoth-vault.json.corrupt-'));
  assert(kept.length === 1 && read(path.join(dir, kept[0])).startsWith('{"credentials": [ {"id": "x"'));
});

test('write failure is reported and does not leave a phantom credential in memory', () => {
  state.osEncryption = true;
  const dir = freshDir(); const f = path.join(dir, 'shmmoth-vault.json');
  const v = new PasswordVault(f);
  fs.mkdirSync(f + '.tmp-' + process.pid);                        // make the temp-file path unusable → write fails
  let code = null;
  try { v.saveCredential(cred(1)); } catch (e) { code = e.code; }
  assert(code === 'VAULT_WRITE_FAILED', 'code=' + code);
  assert(v.getAllCredentialsMetadata().length === 0, 'phantom credential kept in memory');
});

test('legacy hostname-key (aes:) records are migrated to OS protection once available', () => {
  const dir = freshDir(); const f = path.join(dir, 'shmmoth-vault.json');
  state.osEncryption = false;
  const legacy = new PasswordVault(f, { allowInsecureFallback: true });   // what ≤1.0.16 produced
  const rec = legacy.saveCredential(cred(7));
  assert(rec.encryptedPassword.startsWith('aes:'));
  assert(read(f).includes('aes:'));

  state.osEncryption = true;                                              // e.g. after app.whenReady on Windows
  const migrated = new PasswordVault(f);
  assert(!read(f).includes('aes:'), 'legacy record still on disk');
  assert(read(f).includes('safe:'));
  const id = migrated.getAllCredentialsMetadata()[0].id;
  assert(migrated.decryptForAuthorizedUse(id) === 'S3cret!7', 'migrated password must still decrypt');
});

test('undecryptable credential: reveal returns null instead of throwing', () => {
  state.osEncryption = true;
  const dir = freshDir(); const f = path.join(dir, 'shmmoth-vault.json');
  const v = new PasswordVault(f);
  const rec = v.saveCredential(cred(1));
  v.credentials[0].encryptedPassword = 'safe:' + Buffer.from('garbage').toString('base64');
  assert(v.decryptForAuthorizedUse(rec.id) === null);
});

test('proxy password is also refused (not stored in a weak form) when OS encryption is missing', () => {
  state.osEncryption = false;
  const dir = freshDir();
  const vault = new PasswordVault(path.join(dir, 'v.json'));
  const p = new ProxyManager(path.join(dir, 'p.json'), vault);
  let threw = false;
  try { p.setConfig({ mode: 'manual', rules: { protocol: 'http', host: 'proxy.example', port: 8080, username: 'u', password: 'pw' } }); }
  catch (e) { threw = e.code === 'ENCRYPTION_UNAVAILABLE'; }
  assert(threw);
});

// ─────────────────────────────────────────────────────────────────────────────
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) { /* ignore */ }
console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
