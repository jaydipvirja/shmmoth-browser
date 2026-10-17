/**
 * E2E 23 — History, Bookmarks, Downloads, Extensions, Notes, Error and Crash pages, redesigned (Phase 4)
 *
 *   - no emoji on any of them: the SHMMOTH icons (SVG) are drawn instead, also in the parts the page builds itself
 *     (bookmark cards, empty lists, the error icon)
 *   - the search boxes carry the search icon and a name for screen readers
 *   - the pages follow the Light theme like the rest of the browser
 *
 * Run: npm run test:e2e   (or: node tests/e2e/23-pages.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor,
  launchApp, api, waitForWebContents, evalIn
} = require('./helpers');

const PAGES = [
  ['mtc://history', '#history-search-input'],
  ['mtc://bookmarks', '#bm-search-input'],
  ['mtc://downloads', '#search-downloads'],
  ['mtc://extensions', '#ext-search-input'],
  ['mtc://notes', null],
  ['mtc://error?code=-105&name=ERR_NAME_NOT_RESOLVED&url=https%3A%2F%2Fexample.invalid%2F', null],
  ['mtc://crash?tabId=0&reason=crashed&url=https%3A%2F%2Fexample.com%2F', null]
];

// what is on screen: emoji, how many icons were drawn, icons left undrawn, the search box
const SNAPSHOT = (search) => `(() => {
  const icons = Array.from(document.querySelectorAll('[data-icon]'));
  const box = ${search ? `document.querySelector(${JSON.stringify(search)})` : 'null'};
  return {
    emoji: (document.body.innerText.match(/[\\u{1F300}-\\u{1FAFF}\\u2600-\\u27BF\\u2B00-\\u2BFF\\u23E9-\\u23FA]/u) || [null])[0],
    svgs: document.querySelectorAll('svg.sh-icon-svg').length,
    undrawn: icons.filter((el) => !el.querySelector('svg')).map((el) => el.dataset.icon),
    search: box ? { label: box.getAttribute('aria-label'), icon: Boolean(box.parentElement.querySelector('[data-icon="search"] svg')) } : null,
    light: document.documentElement.classList.contains('theme-light') || document.body.classList.contains('theme-light'),
    bg: getComputedStyle(document.body).backgroundColor
  };
})()`;

runSuite('SHMMOTH Browser — E2E 23: library and error pages', async (t) => {
  const ctx = await launchApp();
  const { app, chrome } = ctx;

  try {
    await api(chrome, 'addBookmark', { title: 'Example', url: 'https://example.com/' });

    t.section('Icons instead of emoji');
    for (const [url, search] of PAGES) {
      const prefix = url.split('?')[0];
      await t.test(`${prefix}: no emoji, every icon drawn${search ? ', a named search box with its icon' : ''}`, async () => {
        await api(chrome, 'createTab', url);
        await waitForWebContents(app, prefix);
        const r = await waitFor(async () => {
          const s = await evalIn(app, prefix, SNAPSHOT(search));
          return s.svgs > 0 ? s : null;
        }, { message: 'icons on ' + prefix });
        assertEqual(r.emoji, null, 'emoji on the page');
        assertEqual(JSON.stringify(r.undrawn), '[]', 'icons not drawn');
        if (search) assert(r.search && r.search.label && r.search.icon, JSON.stringify(r.search));
      });
    }

    await t.test('bookmark cards draw their icons (folder, edit, delete) after the page builds them', async () => {
      const r = await waitFor(() => evalIn(app, 'mtc://bookmarks', `(() => {
        const card = document.querySelector('.bookmark-card');
        return card ? ['folder', 'edit', 'trash'].map((n) => Boolean(card.querySelector('[data-icon="' + n + '"] svg'))) : null;
      })()`), { message: 'a bookmark card' });
      assertEqual(JSON.stringify(r), '[true,true,true]');
    });

    await t.test('the error page shows the icon for the error (search for "server not found")', async () => {
      const r = await evalIn(app, 'mtc://error', "document.querySelector('#icon svg') ? document.getElementById('title').textContent : null");
      assertEqual(r, 'Server not found');
    });

    t.section('Light theme');
    await t.test('the pages switch to the light colours with the rest of the browser', async () => {
      await api(chrome, 'updateSettings', { theme: 'light' });
      for (const prefix of ['mtc://history', 'mtc://downloads', 'mtc://extensions', 'mtc://error']) {
        const r = await waitFor(async () => {
          const s = await evalIn(app, prefix, SNAPSHOT(null));
          return s.light ? s : null;
        }, { message: prefix + ' in light' });
        const [red, green, blue] = r.bg.match(/\d+/g).map(Number);
        assert(red + green + blue > 600, prefix + ' background is still dark: ' + r.bg);
      }
    });
  } finally {
    try { await api(chrome, 'updateSettings', { theme: 'dark' }); } catch (_) { /* closing anyway */ }
    await ctx.close();
  }
});
