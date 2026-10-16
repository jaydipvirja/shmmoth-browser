/**
 * E2E 21 — the redesigned toolbar and its main menu (⋮)
 *
 * The toolbar keeps back / forward / reload / home, the address bar, the ad blocker, downloads, extensions and ⋮;
 * the other actions moved into the main menu, a small window of its own (pages/menu-bubble.html):
 *   - a real click on ⋮ opens it under the button, a second click closes it
 *   - Theme: Windows / Light / Dark switch the browser at once, the menu stays open and shows the choice
 *   - Zoom: + / − / the percentage change the active tab and the menu shows the new value
 *   - New tab, History, Settings … run in the browser window and close the menu
 *   - Escape closes it; only the menu window itself may choose an entry (another internal page is refused)
 *
 * Run: npm run test:e2e   (or: node tests/e2e/21-main-menu.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, listWebContents, waitForWebContents, evalIn
} = require('./helpers');

const MENU = 'menu-bubble.html';

runSuite('SHMMOTH Browser — E2E 21: toolbar and main menu', async (t) => {
  const ctx = await launchApp();
  const { app, chrome } = ctx;
  const menuUrl = async () => ((await listWebContents(app)).find((w) => w.url.includes(MENU) && !w.loading) || {}).url;
  const openMenu = async () => {
    if (!(await menuUrl())) await chrome.click('#btn-menu');
    return waitFor(menuUrl, { message: 'the main menu' });
  };
  const inMenu = async (code) => evalIn(app, await openMenu(), code);
  // clicked after the call returns: an entry that closes the menu destroys its window, and a call still running in a
  // destroyed window never answers
  const choose = async (action) => inMenu(`setTimeout(() => document.querySelector('[data-action="${action}"]').click(), 0), true`);
  const menuShows = (code, want, message) => waitFor(async () => (await inMenu(code)) === want, { message });
  const tabCount = () => chrome.evaluate(() => document.querySelectorAll('#tabs-strip .browser-tab').length);

  try {
    t.section('Toolbar');

    await t.test('only the everyday buttons stay on the toolbar; the rest moved into ⋮', async () => {
      const ids = await chrome.evaluate(() => Array.from(document.querySelectorAll('.nav-toolbar button[id]')).map((b) => b.id));
      for (const id of ['btn-back', 'btn-forward', 'btn-reload', 'btn-home', 'btn-star-bookmark', 'btn-adblocker-status', 'btn-downloads', 'btn-extensions', 'btn-menu']) {
        assert(ids.includes(id), id + ' missing: ' + ids.join());
      }
      for (const id of ['btn-incognito', 'btn-toggle-notes', 'btn-devtools', 'btn-check-update-toolbar', 'btn-toggle-theme', 'btn-import-session-toolbar', 'btn-settings']) {
        assert(!ids.includes(id), id + ' is still on the toolbar');
      }
      const emoji = await chrome.evaluate(() => /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(document.querySelector('.nav-toolbar').textContent));
      assertEqual(emoji, false, 'no emoji on the toolbar (SVG icons)');
    });

    t.section('Main menu');

    await t.test('a click on ⋮ opens the menu with every entry; a second click closes it', async () => {
      await openMenu();
      const actions = await inMenu("Array.from(document.querySelectorAll('[data-action]')).map((b) => b.dataset.action)");
      for (const a of ['new-tab', 'new-incognito', 'history', 'downloads', 'bookmarks', 'passwords', 'notes', 'extensions', 'import-signin', 'devtools', 'check-update', 'settings', 'about', 'theme-system', 'theme-light', 'theme-dark', 'zoom-in', 'zoom-out', 'zoom-reset']) {
        assert(actions.includes(a), a + ' missing');
      }
      await chrome.click('#btn-menu');
      await waitFor(async () => !(await menuUrl()), { message: 'the menu to close' });
    });

    await t.test('Theme: Light / Dark / Windows switch the browser at once and the menu shows the choice', async () => {
      for (const theme of ['light', 'dark', 'system']) {
        await choose('theme-' + theme);
        await waitFor(async () => (await api(chrome, 'getSettings')).theme === theme, { message: theme + ' saved' });
        await menuShows(`document.querySelector('[data-action="theme-${theme}"]').getAttribute('aria-pressed')`, 'true', theme + ' pressed');
        if (theme !== 'system') {
          await waitFor(async () => (await chrome.evaluate(() => document.body.classList.contains('theme-light'))) === (theme === 'light'), { message: 'the frame follows ' + theme });
          await menuShows("document.documentElement.classList.contains('theme-light')", theme === 'light', 'the menu itself follows ' + theme);
        }
      }
      await choose('theme-dark');
    });

    await t.test('Zoom: + / − / reset change the active tab, the menu shows the value', async () => {
      await choose('zoom-in');
      await menuShows("document.getElementById('zoom-value').textContent", '110%', '110%');
      assertEqual(await api(chrome, 'getZoomFactor'), 1.1);
      await choose('zoom-out');
      await choose('zoom-out');
      await menuShows("document.getElementById('zoom-value').textContent", '90%', '90%');
      await choose('zoom-reset');
      await menuShows("document.getElementById('zoom-value').textContent", '100%', '100%');
      assertEqual(await api(chrome, 'getZoomFactor'), 1);
    });

    await t.test('New tab / History / Settings open in the browser window and close the menu', async () => {
      const before = await tabCount();
      await choose('new-tab');
      await waitFor(async () => (await tabCount()) === before + 1, { message: 'a new tab' });
      await waitFor(async () => !(await menuUrl()), { message: 'the menu to close' });
      await choose('history');
      await waitForWebContents(app, 'mtc://history');
      await choose('settings');
      await waitForWebContents(app, 'mtc://settings');
    });

    await t.test('Escape closes the menu', async () => {
      await openMenu();
      await inMenu("setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 0), true");
      await waitFor(async () => !(await menuUrl()), { message: 'the menu to close' });
    });

    await t.test('only the menu window may choose an entry: another internal page is refused', async () => {
      await waitForWebContents(app, 'mtc://settings');
      const r = await evalIn(app, 'mtc://settings', "window.mtcAPI.menuAction('devtools').then(() => 'ran', (e) => 'refused: ' + e.message)");
      assert(/^refused/.test(r), r);
      const s = await evalIn(app, 'mtc://settings', "window.mtcAPI.getMenuState().then(() => 'ran', () => 'refused')");
      assertEqual(s, 'refused');
    });

    await t.test('an unknown entry does nothing', async () => {
      const r = await inMenu("window.mtcAPI.menuAction('format-disk')");
      assertEqual(r, false);
      await sleep(200);
      assert(await menuUrl(), 'the menu is still open');
      await api(chrome, 'closeMenuBubble');
    });
  } finally {
    await ctx.close();
  }
});
