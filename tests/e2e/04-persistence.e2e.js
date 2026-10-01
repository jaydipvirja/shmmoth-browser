/**
 * E2E 04 — persistence and crash recovery
 *
 * The data files (bookmarks/history/settings, vault, …) are written atomically with a .bak and a damaged file
 * is never silently replaced by empty data. These tests damage real files on disk and restart the real app.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/04-persistence.e2e.js)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { runSuite, assert, assertEqual, waitFor, launchApp, api, tmpDir } = require('./helpers');

const DATA = 'mtc-data.json';
const list = (dir, prefix) => fs.readdirSync(dir).filter((n) => n.startsWith(prefix));

runSuite('SHMMOTH Browser — E2E 04: persistence & crash recovery', async (t) => {
  t.section('Damaged data file with a good backup');

  await t.test('a truncated data file is restored from .bak on start-up, the damaged copy is kept, and the next save is valid', async () => {
    const userData = tmpDir('shmmoth-e2e-ud-');
    const good = { bookmarks: [{ id: 'bm_backup', title: 'From backup', url: 'https://backup.example/', folder: 'Bookmarks Bar', createdAt: 1, updatedAt: 1 }], settings: {} };
    fs.writeFileSync(path.join(userData, DATA + '.bak'), JSON.stringify(good));
    fs.writeFileSync(path.join(userData, DATA), JSON.stringify(good).slice(0, 40));             // what a crash mid-write used to leave

    const ctx = await launchApp({ userData });
    try {
      const marks = await api(ctx.chrome, 'getBookmarks');
      assert(marks.some((b) => b.title === 'From backup'), 'bookmark from the backup is missing: ' + marks.map((b) => b.title));
      const kept = list(userData, DATA + '.corrupt-');
      assertEqual(kept.length, 1, 'damaged copy');
      assertEqual(fs.readFileSync(path.join(userData, kept[0]), 'utf8'), JSON.stringify(good).slice(0, 40), 'damaged copy content');

      await api(ctx.chrome, 'addBookmark', { title: 'After recovery', url: 'https://after.example/' });
      const saved = await waitFor(() => { try { return JSON.parse(fs.readFileSync(path.join(userData, DATA), 'utf8')); } catch (_) { return null; } }, { message: 'a valid data file' });
      const titles = saved.bookmarks.map((b) => b.title);
      assert(titles.includes('From backup') && titles.includes('After recovery'), titles.join());
      if (ctx.log.complete) assert(/Storage file was damaged/.test(ctx.log.text), 'the recovery should have been logged');
    } finally { await ctx.close(); }
  });

  t.section('Damaged data file without a backup');

  await t.test('the app still starts (with defaults) and keeps the damaged file for manual recovery', async () => {
    const userData = tmpDir('shmmoth-e2e-ud-');
    fs.writeFileSync(path.join(userData, DATA), '{"bookmarks": [ {"title": "irreplaceable"');
    const ctx = await launchApp({ userData });
    try {
      assert((await api(ctx.chrome, 'getBookmarks')).length >= 1, 'default bookmarks expected');
      await api(ctx.chrome, 'addBookmark', { title: 'new', url: 'https://new.example/' });
      const kept = list(userData, DATA + '.corrupt-');
      assertEqual(kept.length, 1);
      assertEqual(fs.readFileSync(path.join(userData, kept[0]), 'utf8'), '{"bookmarks": [ {"title": "irreplaceable"', 'damaged copy must stay untouched');
    } finally { await ctx.close(); }
  });

  t.section('Normal operation');

  await t.test('settings survive a restart and no temp files are left behind', async () => {
    const userData = tmpDir('shmmoth-e2e-ud-');
    let ctx = await launchApp({ userData });
    try {
      await api(ctx.chrome, 'updateSettings', { theme: 'light', showBookmarksBar: false });
      await api(ctx.chrome, 'addBookmark', { title: 'Persisted', url: 'https://persisted.example/' });
    } finally { await ctx.close(); }

    ctx = await launchApp({ userData });
    try {
      const s = await api(ctx.chrome, 'getSettings');
      assertEqual(s.theme, 'light');
      assertEqual(s.showBookmarksBar, false);
      assert((await api(ctx.chrome, 'getBookmarks')).some((b) => b.title === 'Persisted'));
    } finally { await ctx.close(); }

    const leftovers = fs.readdirSync(userData).filter((n) => /\.tmp-/.test(n));
    assertEqual(leftovers.join(), '', 'temp files');
  });

  t.section('Password vault');

  await t.test('saving a password either encrypts it with the OS or is refused with a clear error — never a weak fallback', async () => {
    const userData = tmpDir('shmmoth-e2e-ud-');
    const ctx = await launchApp({ userData });
    try {
      const res = await api(ctx.chrome, 'savePassword', { origin: 'https://vault.example', username: 'u', password: 'correct-horse-battery-staple' });
      if (res.success) {
        const raw = fs.readFileSync(path.join(userData, 'shmmoth-vault.json'), 'utf8');
        assert(!raw.includes('correct-horse-battery-staple'), 'plaintext password on disk');
        assert(/"encryptedPassword": "safe:/.test(raw) && !/aes:/.test(raw), 'password must be stored with OS encryption');
      } else {
        assertEqual(res.code, 'ENCRYPTION_UNAVAILABLE', JSON.stringify(res));
        assert(!fs.existsSync(path.join(userData, 'shmmoth-vault.json')), 'nothing may be written');
      }
    } finally { await ctx.close(); }
  });
});
