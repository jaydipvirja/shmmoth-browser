/**
 * E2E 24 — Polish (redesign Phase 5)
 *
 *   - first start: the New Tab page shows the Welcome card; its Look and Search-with buttons save the theme and the
 *     search engine at once, "Start browsing" closes it for good
 *   - a profile from before 1.4.0 never sees the card
 *   - a new tab slides in once; the tabs already there do not move
 *   - Settings and the browser frame are free of emoji
 *   - the Mica switch stays hidden where Windows has no Mica (here: Linux)
 *
 * Run: npm run test:e2e   (or: node tests/e2e/24-polish.e2e.js)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  runSuite, assert, assertEqual, waitFor, tmpDir,
  launchApp, api, waitForWebContents, evalIn
} = require('./helpers');

const EMOJI = '/[\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF\\u2B00-\\u2BFF\\u23E9-\\u23FA]/u';

runSuite('SHMMOTH Browser — E2E 24: polish', async (t) => {
  t.section('First start');
  {
    const ctx = await launchApp();
    const { app, chrome } = ctx;
    const inNewTab = (code) => evalIn(app, 'mtc://newtab', code);
    try {
      await t.test('a new profile sees the Welcome card on the New Tab page', async () => {
        await waitForWebContents(app, 'mtc://newtab');
        const shown = await waitFor(() => inNewTab("!document.getElementById('welcome-card').classList.contains('hidden') || null"), { message: 'the Welcome card' });
        assert(shown);
        const pressed = await inNewTab("Array.from(document.querySelectorAll('.welcome-card [aria-pressed=\"true\"]')).map((b) => b.dataset.value)");
        assertEqual(JSON.stringify(pressed), JSON.stringify(['system', 'google']), 'the current choices are marked');
      });

      await t.test('Look and Search with save at once; the search box names the engine', async () => {
        await inNewTab("document.querySelector('#welcome-theme [data-value=\"light\"]').click(), true");
        await waitFor(async () => (await api(chrome, 'getSettings')).theme === 'light', { message: 'light saved' });
        await waitFor(() => inNewTab("document.body.classList.contains('theme-light') || null"), { message: 'the page in light' });
        await inNewTab("document.querySelector('#welcome-engine [data-value=\"duckduckgo\"]').click(), true");
        await waitFor(async () => (await api(chrome, 'getSettings')).searchEngine === 'duckduckgo', { message: 'DuckDuckGo saved' });
        assertEqual(await inNewTab("document.getElementById('search-input').placeholder"), 'Search DuckDuckGo or type a web address');
      });

      await t.test('"Start browsing" closes it, also for the next New Tab', async () => {
        await inNewTab("document.getElementById('welcome-done').click(), true");
        await waitFor(async () => (await api(chrome, 'getSettings')).welcomeDone === true, { message: 'welcomeDone saved' });
        assert(await inNewTab("document.getElementById('welcome-card').classList.contains('hidden')"));
        await api(chrome, 'createTab', 'mtc://newtab');
        await waitFor(async () => (await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.getURL().startsWith('mtc://newtab')).length)) >= 2, { message: 'a second New Tab' });
        const second = await app.evaluate(async ({ webContents }) => {
          const wc = webContents.getAllWebContents().filter((w) => w.getURL().startsWith('mtc://newtab')).sort((a, b) => b.id - a.id)[0];
          await new Promise((r) => setTimeout(r, 600));
          return wc.executeJavaScript("document.getElementById('welcome-card').classList.contains('hidden')");
        });
        assertEqual(second, true, 'card hidden on the next New Tab');
      });

      t.section('Motion');
      await t.test('a new tab slides in once; the tabs already open do not', async () => {
        // record every tab that is drawn with the slide-in, from now on
        await chrome.evaluate(() => {
          window.__entered = [];
          new MutationObserver(() => {
            for (const el of document.querySelectorAll('.browser-tab.tab-enter')) {
              if (!window.__entered.includes(el.dataset.tabId)) window.__entered.push(el.dataset.tabId);
            }
          }).observe(document.body, { childList: true, subtree: true });
        });
        const id = await api(chrome, 'createTab', 'mtc://history');
        await waitForWebContents(app, 'mtc://history');
        await new Promise((r) => setTimeout(r, 500));
        assertEqual(JSON.stringify(await chrome.evaluate(() => window.__entered)), JSON.stringify([String(id)]));
      });

      t.section('No emoji left');
      await t.test('the frame has no emoji, in the visible parts or the hidden panels', async () => {
        const r = await chrome.evaluate(`(${EMOJI}).test(document.body.textContent)`);
        assertEqual(r, false);
      });

      await t.test('Settings has no emoji, in any section; the Mica switch is hidden off Windows 11', async () => {
        await api(chrome, 'createTab', 'mtc://settings');
        await waitForWebContents(app, 'mtc://settings');
        const r = await waitFor(() => evalIn(app, 'mtc://settings', `(() => {
          const row = document.getElementById('row-mica');
          if (!row) return null;
          return { emoji: (${EMOJI}).test(document.body.textContent), micaHidden: row.classList.contains('hidden'), updateIcon: Boolean(document.querySelector('#update-status-icon svg')) };
        })()`), { message: 'Settings' });
        assertEqual(r.emoji, false, 'emoji in Settings');
        assertEqual(r.micaHidden, process.platform !== 'win32' ? true : r.micaHidden, 'Mica switch');
        assert(r.updateIcon, 'the update card shows an icon');
      });
    } finally {
      try { await api(chrome, 'updateSettings', { theme: 'dark', searchEngine: 'google' }); } catch (_) { /* closing anyway */ }
      await ctx.close();
    }
  }

  t.section('Upgrading from an older version');
  {
    const userData = tmpDir();
    // a profile written by 1.3.x: settings without welcomeDone
    fs.writeFileSync(path.join(userData, 'mtc-data.json'), JSON.stringify({ settings: { theme: 'dark', searchEngine: 'google' } }));
    const ctx = await launchApp({ userData });
    try {
      await t.test('an existing profile does not see the Welcome card', async () => {
        await waitForWebContents(ctx.app, 'mtc://newtab');
        await new Promise((r) => setTimeout(r, 800));
        const hidden = await evalIn(ctx.app, 'mtc://newtab', "document.getElementById('welcome-card').classList.contains('hidden')");
        assertEqual(hidden, true);
        assertEqual((await api(ctx.chrome, 'getSettings')).welcomeDone, true);
      });
    } finally {
      await ctx.close();
    }
  }
});
