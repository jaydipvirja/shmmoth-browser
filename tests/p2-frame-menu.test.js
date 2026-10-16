/**
 * Phase 2 of the redesign — the browser frame and its main menu (⋮).
 * Run: node tests/p2-frame-menu.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { mainSource } = require('./helpers/main-source');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const indexHtml = read('src', 'renderer', 'index.html');
const appJs = read('src', 'renderer', 'app.js');
const css = read('src', 'renderer', 'style.css');
const menuHtml = read('src', 'pages', 'menu-bubble.html');
const menuJs = read('src', 'pages', 'menu-bubble.js');
const bubbles = read('src', 'browser', 'bubbles.js');
const main = mainSource();

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — frame and main menu (Phase 2)');
console.log('══════════════════════════════════════════════════════\n');

console.log('📋 1. Frame');
test('the toolbar holds the everyday buttons and ⋮; the moved ones are gone from the frame', () => {
  const toolbar = indexHtml.slice(indexHtml.indexOf('<div class="nav-toolbar">'), indexHtml.indexOf('<!-- Bookmarks Bar -->'));
  for (const id of ['btn-back', 'btn-forward', 'btn-reload', 'btn-home', 'omnibox-input', 'btn-star-bookmark', 'btn-adblocker-status', 'btn-downloads', 'btn-extensions', 'btn-menu']) {
    assert(toolbar.includes(`id="${id}"`), id);
  }
  for (const id of ['btn-incognito', 'btn-toggle-notes', 'btn-devtools', 'btn-check-update-toolbar', 'btn-toggle-theme', 'btn-import-session-toolbar', 'btn-settings']) {
    assert(!indexHtml.includes(`id="${id}"`), id + ' is still in the frame');
  }
});
test('no emoji in the tab strip and toolbar markup or in the tab / address-bar icons; icon-only buttons have a name', () => {
  const top = indexHtml.slice(indexHtml.indexOf('<header'), indexHtml.indexOf('<!-- Bookmarks Bar -->'));
  assert(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(top), 'emoji in the frame markup');
  const tabRender = appJs.slice(appJs.indexOf('// Loading indicator vs Favicon'), appJs.indexOf('// Sleep badge'));
  assert(!/'🌐'|'🚀'|'⚙️'|'🕒'/.test(tabRender), 'emoji tab icons');
  assert(!/omniboxSecurity\.textContent = /.test(appJs), 'emoji in the address bar');
  for (const m of top.matchAll(/<button [^>]*>/g)) {
    assert(/aria-label="|title="/.test(m[0]), 'unnamed button: ' + m[0]);
  }
  assert(/<script src="\.\.\/pages\/icons\.js"><\/script>\s*\n\s*<script src="\.\.\/pages\/safe-html\.js"><\/script>\s*\n\s*<script src="app\.js"><\/script>/.test(indexHtml), 'icons.js before app.js');
});
test('the frame takes its colours from the tokens, declared on body so the theme class reaches them', () => {
  assert(/body \{\s*\n\s*--bg-chrome: var\(--sh-frame\);/.test(css));
  assert(!/body\.theme-incognito \{\s*\n\s*--bg-chrome: #/.test(css), 'old incognito colours');
  assert(!/\.brand-chip|\.btn-update-toolbar/.test(css), 'styles of removed elements');
});
test('the header keeps its height (42 + 44 + 28 = 114 px), so the page area does not move', () => {
  assert(/\.tabs-header-row \{[^}]*height: 42px;/.test(css) && /\.nav-toolbar \{[^}]*height: 44px;/.test(css) && /\.bookmarks-bar \{[^}]*height: 28px;/.test(css));
  assert(/this\.headerHeight = \(settings\.showBookmarksBar !== false\) \? 114 : 86;/.test(main));
});

console.log('\n📋 2. Main menu');
const menuActions = [...menuHtml.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]);
const frameActions = JSON.parse('[' + /FRAME_MENU_ACTIONS = new Set\(\[([^\]]+)\]\)/.exec(bubbles)[1].replace(/'/g, '"') + ']');
const appActions = [...appJs.slice(appJs.indexOf('const MENU_ACTIONS = {'), appJs.indexOf('function runMenuAction')).matchAll(/^\s+'?([a-z-]+)'?:\s+\(\) =>/gm)].map((m) => m[1]);
test('every entry of the menu is handled: in the main process (theme, zoom) or by the browser window', () => {
  for (const a of menuActions) {
    const here = /^theme-(system|light|dark)$/.test(a) || ['zoom-in', 'zoom-out', 'zoom-reset'].includes(a);
    assert(here || frameActions.includes(a), a + ' is not accepted by the main process');
    if (!here) assert(appActions.includes(a), a + ' is not run by the browser window');
  }
  assert(JSON.stringify([...frameActions].sort()) === JSON.stringify([...appActions].sort()), `main ${frameActions} vs window ${appActions}`);
});
test('only the menu window may choose an entry or read its state; unknown entries are refused', () => {
  assert(/const fromMenu = \(event\) => Boolean\(this\.menuBubbleWin && !this\.menuBubbleWin\.isDestroyed\(\) && event\.sender === this\.menuBubbleWin\.webContents\)/.test(main));
  assert(/'menu:action', secureHandlerRaw\(\(event, action\) => \{\s*\n\s*if \(!fromMenu\(event\)\) throw/.test(main));
  assert(/'menu:getState', secureHandlerRaw\(\(event\) => \{\s*\n\s*if \(!fromMenu\(event\)\) throw/.test(main));
  assert(/if \(!FRAME_MENU_ACTIONS\.has\(action\)\) return false;/.test(bubbles));
  assert(/Object\.prototype\.hasOwnProperty\.call\(MENU_ACTIONS, action\)/.test(appJs), 'the window runs only its own list (no prototype keys)');
});
test('the menu page is a trusted internal page in both lists, built without inline script', () => {
  assert(read('src', 'security', 'trustedPages.js').includes("['pages', 'menu-bubble.html']"));
  assert(read('src', 'preload-internal.js').includes("'/pages/menu-bubble.html'"));
  assert(!/<script>/.test(menuHtml) && /<script src="menu-bubble\.js"><\/script>/.test(menuHtml));
  assert(!/innerHTML/.test(menuJs.replace(/\/\*[\s\S]*?\*\//g, '')));
});
test('the menu closes when it loses focus, on tab switch and on Escape; theme changes reach it while it is open', () => {
  assert(/this\.menuBubbleWin\.on\('blur'/.test(bubbles));
  assert(/this\.closeMenuBubble\(\);/.test(read('src', 'browser', 'tabs.js')));
  assert(/e\.key === 'Escape'\) \{ api\.closeMenuBubble\(\)/.test(menuJs));
  assert(/broadcastThemeChange\(theme\) \{[\s\S]{0,200}this\.menuBubbleWin/.test(main));
});
test('updates: a dot on ⋮ while one is coming or ready, and the menu entry says "Restart to update"', () => {
  assert(/menuUpdateDot\.classList\.toggle\('hidden', !pending\)/.test(appJs) && /menuUpdateDot\.classList\.toggle\('ready', status\.status === 'downloaded'\)/.test(appJs));
  assert(/'check-update':\s+\(\) => runUpdateCheck\(\)/.test(appJs) && /api\.installUpdate\(\)/.test(appJs));
  assert(/Restart to update/.test(menuJs));
});

console.log('\n📋 3. Bubbles (1.3.1)');
const BUBBLES = ['shield-bubble.html', 'download-bubble.html', 'extension-bubble.html', 'permission-bubble.html', 'menu-bubble.html'];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\u23E9-\u23FA]/u;
test('every bubble follows the theme, uses the tokens, the Inter font and the icon set', () => {
  for (const f of BUBBLES) {
    const html = read('src', 'pages', f);
    assert(/<script src="icons\.js"><\/script>/.test(html) && /<script src="theme\.js"><\/script>/.test(html), f + ': icons.js / theme.js');
    assert(/href="design-tokens\.css"/.test(html) && /href="fonts\.css"/.test(html), f + ': tokens / font');
    const style = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
    assert(!/background(-color)?: (#1e293b|#0f172a|#182234|#141c2b)/i.test(style), f + ': dark surfaces left');
    assert(!/box-shadow: 0 16px \d+px rgba\(0, 0, 0, 0\.7/.test(style), f + ': old heavy shadow');
  }
});
test('no emoji in the bubbles: icons, and the file type as a short label in the downloads list', () => {
  for (const f of BUBBLES) {
    const html = read('src', 'pages', f);
    assert(!EMOJI.test(html), f + ' still has emoji: ' + (html.match(EMOJI) || [])[0]);
  }
  const dl = read('src', 'pages', 'download-bubble.html');
  assert(/<div class="card-icon">\$\{escapeHtml\(icon\)\}<\/div>/.test(dl), 'the file label is escaped');
  assert(/window\.ShIcons\.drawAll\(bubbleList\)/.test(dl) && /window\.ShIcons\.drawAll\(extListContainer\)/.test(read('src', 'pages', 'extension-bubble.html')));
});

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
