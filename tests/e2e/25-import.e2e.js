/**
 * E2E 25 — Import bookmarks and history from another browser
 *
 *   - with Chrome on the computer, the Welcome card offers "Import from Google Chrome"; one click brings its bookmarks
 *     (into "Imported from Google Chrome") and its history (with the original visit times)
 *   - Settings → General → Import lists the browser and imports again without doubling anything
 *
 * A small Chrome profile is written to a temporary folder that the app is pointed at (XDG_CONFIG_HOME on Linux,
 * LOCALAPPDATA on Windows), so nothing of the machine's own browsers is read.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/25-import.e2e.js)
 */

'use strict';

const path = require('path');
const {
  runSuite, assert, assertEqual, waitFor, tmpDir,
  launchApp, api, waitForWebContents, evalIn
} = require('./helpers');
const { writeFakeProfile } = require('../helpers/fake-chromium-profile');

runSuite('SHMMOTH Browser — E2E 25: import from another browser', async (t) => {
  const base = tmpDir('shmmoth-import-');
  const chromeDir = process.platform === 'win32' ? path.join(base, 'Google', 'Chrome', 'User Data')
    : process.platform === 'darwin' ? null : path.join(base, 'google-chrome');
  if (!chromeDir) { console.log('  (skipped on macOS: the profile folder is under the real home folder)'); return; }
  const fake = writeFakeProfile(chromeDir);
  const env = process.platform === 'win32' ? { LOCALAPPDATA: base } : { XDG_CONFIG_HOME: base };

  const ctx = await launchApp({ env });
  const { app, chrome } = ctx;
  const inNewTab = (code) => evalIn(app, 'mtc://newtab', code);
  try {
    t.section('Welcome card');
    await t.test('offers "Import from Google Chrome" when Chrome is on the computer', async () => {
      await waitForWebContents(app, 'mtc://newtab');
      const label = await waitFor(() => inNewTab(`(() => {
        const row = document.getElementById('welcome-import-row');
        return row && !row.classList.contains('hidden') ? document.getElementById('welcome-import').textContent : null;
      })()`), { message: 'the import row' });
      assertEqual(label, 'Import from Google Chrome');
    });

    await t.test('one click brings the bookmarks and the history', async () => {
      await inNewTab("document.getElementById('welcome-import').click(), true");
      const text = await waitFor(() => inNewTab(`(() => {
        const l = document.getElementById('welcome-import-label').textContent;
        return /^Imported|work|Close/.test(l) ? l : null;
      })()`), { message: 'the import result' });
      assertEqual(text, 'Imported 3 bookmarks and 2 pages of history');
      const bms = await api(chrome, 'getBookmarks', 'Imported from Google Chrome');
      assertEqual(JSON.stringify(bms.map((b) => b.url).sort()), JSON.stringify([...fake.expectedBookmarks].sort()));
      const hist = await api(chrome, 'getHistory', 'recent.example.com');
      assert(hist.length === 1 && Math.abs(hist[0].visitTime - fake.recentVisit) < 5 && hist[0].visitCount === 7, JSON.stringify(hist));
    });

    t.section('Settings');
    await t.test('Settings → Import lists Chrome and a second import adds nothing twice', async () => {
      await api(chrome, 'createTab', 'mtc://settings');
      await waitForWebContents(app, 'mtc://settings');
      const inSettings = (code) => evalIn(app, 'mtc://settings', code);
      await waitFor(() => inSettings("Boolean(document.getElementById('btn-open-import'))"), { message: 'the import row' });
      await inSettings("document.getElementById('btn-open-import').click(), true");
      const options = await waitFor(() => inSettings(`(() => {
        const o = Array.from(document.querySelectorAll('#select-import-source option')).map((x) => x.textContent);
        return o.length ? o : null;
      })()`), { message: 'the browser list' });
      assertEqual(JSON.stringify(options), JSON.stringify(['Google Chrome']));
      await inSettings("document.getElementById('btn-run-import').click(), true");
      const line = await waitFor(() => inSettings(`(() => {
        const s = document.getElementById('import-status');
        return s.classList.contains('success') || s.classList.contains('error') ? s.textContent : null;
      })()`), { message: 'the result line' });
      assertEqual(line, 'Imported 0 bookmarks and 0 pages of history.');
      assertEqual((await api(chrome, 'getBookmarks', 'Imported from Google Chrome')).length, 3, 'still three');
    });
  } finally {
    await ctx.close();
  }
});
