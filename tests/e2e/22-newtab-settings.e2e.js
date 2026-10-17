/**
 * E2E 22 — New Tab and Settings, redesigned (Phase 3)
 *
 *   - New Tab: the SHMMOTH logo, a small clock, the search box, shortcut tiles with a letter (no emoji, no image the
 *     browser would have to fetch), the status chips
 *   - Settings: "Search settings" shows only the settings that match, across every section, says when nothing matches,
 *     and Escape brings the open section back
 *   - Settings → Appearance: the Follow Windows / Light / Dark buttons save the theme and show which one is chosen
 *
 * Run: npm run test:e2e   (or: node tests/e2e/22-newtab-settings.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor,
  launchApp, api, waitForWebContents, evalIn
} = require('./helpers');

runSuite('SHMMOTH Browser — E2E 22: New Tab and Settings', async (t) => {
  const ctx = await launchApp();
  const { app, chrome } = ctx;

  try {
    t.section('New Tab');

    await t.test('logo, small clock, search box, letter tiles and status chips; no emoji and no images to fetch', async () => {
      await api(chrome, 'createTab', 'mtc://newtab');
      await waitForWebContents(app, 'mtc://newtab');
      const r = await waitFor(() => evalIn(app, 'mtc://newtab', `(() => {
        const tiles = Array.from(document.querySelectorAll('#shortcuts-grid .shortcut-card'));
        if (!tiles.length) return null;
        return {
          logo: Boolean(document.querySelector('.brand img[src="logo.svg"]')),
          clock: /^\\d\\d:\\d\\d/.test(document.getElementById('live-time').textContent),
          clockSize: parseFloat(getComputedStyle(document.getElementById('live-time')).fontSize),
          letters: tiles.map((c) => c.querySelector('.tile-letter').textContent),
          remoteImages: Array.from(document.images).filter((i) => !/^mtc:|^data:/.test(i.src)).length,
          emoji: /[\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF\\u2B00-\\u2BFF]/u.test(document.body.innerText),
          chips: document.querySelectorAll('.footer-stat .sh-icon svg').length
        };
      })()`), { message: 'the shortcuts' });
      assert(r.logo && r.clock, JSON.stringify(r));
      assert(r.clockSize <= 24, 'the clock is small now: ' + r.clockSize);
      assert(r.letters.every((l) => /^[A-Z0-9]$/.test(l)), r.letters.join());
      assertEqual(r.remoteImages, 0, 'images fetched from the web');
      assertEqual(r.emoji, false, 'emoji on the page');
      assertEqual(r.chips, 3, 'status chips with icons');
    });

    t.section('Settings');

    const inSettings = (code) => evalIn(app, 'mtc://settings', code);
    const search = (q) => inSettings(`(() => { const i = document.getElementById('settings-search-input'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return true; })()`);
    const visible = () => inSettings(`(() => {
      const shown = (el) => el.offsetParent !== null;
      return {
        panes: Array.from(document.querySelectorAll('.tab-pane')).filter(shown).map((p) => p.id),
        rows: Array.from(document.querySelectorAll('.setting-row')).filter(shown).map((r) => (r.querySelector('.setting-label') || r).textContent.trim()),
        empty: shown(document.getElementById('settings-search-empty'))
      };
    })()`);

    await t.test('"Search settings" shows the matching settings of every section, and only those', async () => {
      await api(chrome, 'createTab', 'mtc://settings');
      await waitForWebContents(app, 'mtc://settings');
      await waitFor(() => inSettings("Boolean(document.getElementById('settings-search-input'))"), { message: 'the search box' });
      await search('bookmarks bar');
      const r = await visible();
      assertEqual(JSON.stringify(r.panes), JSON.stringify(['tab-general']), 'sections shown');
      assertEqual(JSON.stringify(r.rows), JSON.stringify(['Show Bookmarks Bar']), 'rows shown');
      await search('theme');
      const th = await visible();
      assert(th.panes.includes('tab-appearance') && th.rows.some((x) => /Theme/.test(x)), JSON.stringify(th));
    });

    await t.test('no match: one plain sentence; Escape brings the open section back', async () => {
      await search('zzzz-nothing');
      const r = await visible();
      assert(r.empty && r.panes.length === 0, JSON.stringify(r));
      await inSettings("document.getElementById('settings-search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true");
      const back = await visible();
      assertEqual(JSON.stringify(back.panes), JSON.stringify(['tab-general']));
      assert(!back.empty && back.rows.length >= 3, JSON.stringify(back));
    });

    await t.test('Appearance: the three theme buttons save the choice and show it', async () => {
      for (const theme of ['light', 'system', 'dark']) {
        await inSettings(`document.querySelector('#theme-buttons [data-theme-value="${theme}"]').click(), true`);
        await waitFor(async () => (await api(chrome, 'getSettings')).theme === theme, { message: theme + ' saved' });
        const pressed = await inSettings("Array.from(document.querySelectorAll('#theme-buttons [aria-pressed=\"true\"]')).map((b) => b.dataset.themeValue)");
        assertEqual(JSON.stringify(pressed), JSON.stringify([theme]));
      }
    });
  } finally {
    try { await api(chrome, 'updateSettings', { theme: 'dark' }); } catch (_) { /* closing anyway */ }
    await ctx.close();
  }
});
