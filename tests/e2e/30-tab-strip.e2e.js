/**
 * E2E 30 — many tabs (1.5.2)
 *
 * With the strip full, a new tab opened out of sight: tabs stopped shrinking at 120 px, then the strip overflowed with
 * its scroll bar hidden, nothing brought the new (active) tab into view and the mouse wheel did nothing. Now:
 *   - tabs get narrower as more open, as in Chrome, down to the icon; the title and the close button of the inactive
 *     ones go first, the active tab keeps its close button
 *   - past that the strip scrolls, a new or selected tab is always in view, and a redraw (another tab loading) leaves
 *     the strip where the user scrolled it
 *   - the mouse wheel scrolls the strip; the + button and the window controls stay in place
 *
 * Run: npm run test:e2e   (or: node tests/e2e/30-tab-strip.e2e.js)
 */
'use strict';

const { runSuite, assert, assertEqual, waitFor, sleep, launchApp, api } = require('./helpers');

const strip = (chrome) => chrome.evaluate(() => {
  const s = document.getElementById('tabs-strip');
  const tabs = Array.from(s.querySelectorAll('.browser-tab'));
  const act = s.querySelector('.browser-tab.active');
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
  const visible = (el) => getComputedStyle(el).display !== 'none';
  const inactive = tabs.find((t) => !t.classList.contains('active'));
  return {
    count: tabs.length, scrollLeft: Math.round(s.scrollLeft), scrolls: s.scrollWidth > s.clientWidth + 1,
    strip: box(s), active: act && box(act), activeId: act && act.dataset.tabId, firstId: tabs[0].dataset.tabId,
    tabWidth: inactive ? box(inactive).width : 0,
    activeClose: act ? visible(act.querySelector('.tab-close-btn')) : false,
    inactiveClose: inactive ? visible(inactive.querySelector('.tab-close-btn')) : true,
    newTab: box(document.getElementById('btn-new-tab')), windowWidth: innerWidth
  };
});
const openUntil = async (chrome, n) => {
  while ((await strip(chrome)).count < n) await api(chrome, 'createTab', 'about:blank');
  await waitFor(async () => (await strip(chrome)).count >= n, { message: n + ' tabs' });
  await sleep(500);
  return strip(chrome);
};
const inView = (s) => s.active.left >= s.strip.left - 1 && s.active.right <= s.strip.right + 1;

runSuite('SHMMOTH Browser — E2E 30: many tabs', async (t) => {
  const ctx = await launchApp();
  const { chrome } = ctx;
  try {
    await t.test('a few tabs: full width with titles', async () => {
      const s = await openUntil(chrome, 3);
      assert(s.tabWidth >= 200, 'tab width ' + s.tabWidth);
      assertEqual(s.scrolls, false);
    });

    await t.test('more tabs: they get narrower and all fit (no scrolling yet); the new one is in view', async () => {
      const s = await openUntil(chrome, 14);
      assert(s.tabWidth < 120 && s.tabWidth >= 44, 'tab width ' + s.tabWidth);
      assertEqual(s.scrolls, false, 'the strip scrolls although the tabs could still shrink');
      assert(inView(s), 'the new tab is out of sight: ' + JSON.stringify(s));
      assertEqual(s.inactiveClose, false, 'narrow inactive tabs keep their close button');
      assertEqual(s.activeClose, true, 'the active tab lost its close button');
    });

    let full;
    await t.test('a full strip scrolls: every new tab opens in view; + and the window controls stay on screen', async () => {
      for (const n of [30, 31, 32]) {
        full = await openUntil(chrome, n);
        assert(full.scrolls, 'expected a scrolling strip at ' + n);
        assert(inView(full), `tab ${n} is out of sight: ` + JSON.stringify(full));
      }
      assert(full.newTab.right <= full.windowWidth - 100, 'the + button was pushed away: ' + JSON.stringify(full.newTab));
    });

    await t.test('a redraw (another tab loads a page) keeps the strip where the user scrolled it', async () => {
      const s0 = await strip(chrome);
      await chrome.evaluate(() => { const st = document.getElementById('tabs-strip'); st.scrollLeft = 120; st.firstElementChild.__old = true; });
      // a background tab loads a page: the browser redraws the whole strip, the active tab stays the same
      await api(chrome, 'navigateTab', Number(s0.firstId) || s0.firstId, 'about:blank#redraw');
      await sleep(800);
      const after = await strip(chrome);
      assertEqual(await chrome.evaluate(() => document.getElementById('tabs-strip').firstElementChild.__old === true), false, 'the strip was not redrawn');
      assertEqual(after.activeId, s0.activeId, 'the active tab changed');
      assertEqual(after.scrollLeft, 120, 'the redraw moved the strip');
    });

    await t.test('the mouse wheel scrolls the strip; selecting the first tab brings it into view', async () => {
      const box = (await strip(chrome)).strip;
      const start = (await strip(chrome)).scrollLeft;
      await chrome.mouse.move(box.left + 40, 25);
      await chrome.mouse.wheel(0, -300);
      await waitFor(async () => (await strip(chrome)).scrollLeft < start, { message: 'the wheel to scroll the strip' });
      const first = (await strip(chrome)).firstId;
      await chrome.evaluate(() => { document.getElementById('tabs-strip').scrollLeft = 1e6; });
      await api(chrome, 'switchTab', Number(first) || first);
      await waitFor(async () => { const s = await strip(chrome); return s.activeId === first && inView(s); }, { message: 'the first tab in view' });
    });
  } finally {
    await ctx.close();
  }
});
