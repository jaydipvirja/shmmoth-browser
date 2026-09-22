/**
 * BUGFIXES, FLOATING WINDOWS, THEME & PERFORMANCE SUITE — tests/stage10-bugfixes-theme-extensions.test.js
 *
 * Validates:
 * 1. Native floating bubbles (extensions, shield, permissions) registered in main.js.
 * 2. Native bubble files (extension-bubble.html, shield-bubble.html, permission-bubble.html) exist.
 * 3. IPC handlers for extensions:toggleBubble, shield:toggleBubble, permissions:openBubble registered.
 * 4. Preload scripts expose bubble APIs (toggleExtensionBubble, toggleShieldBubble, openPermissionBubble).
 * 5. .hidden { display: none !important; } rule present in src/pages/extensions.css.
 * 6. Lag-free throttled resize in src/main.js (throttledUpdateViewBounds).
 * 7. Header height caching in src/main.js (_cachedHeaderHeight).
 * 8. DuckDuckGo search engine normalization in src/main.js (_getSearchUrl) and newtab.js.
 * 9. body.theme-light CSS variables and overrides in src/renderer/style.css.
 * 10. theme-light styling and live listener in src/pages/settings.css / settings.js.
 * 11. theme-light styling and live listener in src/pages/extensions.css / extensions.js.
 * 12. theme-light styling and live listener in src/pages/newtab.css / newtab.js.
 * 13. src/renderer/app.js wires btn-adblocker-status and btn-extensions to floating bubbles.
 * 14. src/renderer/app.js defines openSettingsTab, openDownloadsTab, openExtensionsTab.
 * 15. In-DOM permission prompt card kept hidden to avoid WebContentsView occlusion.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    testsFailed++;
  }
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — Stage 10 Bugfixes & Floating Suite  ');
console.log('══════════════════════════════════════════════════════════\n');

// 1. Floating bubbles registered in main.js
runTest('1. main.js defines extensionBubbleWin, shieldBubbleWin, permissionBubbleWin', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes('this.extensionBubbleWin'), 'Missing extensionBubbleWin in main.js');
  assert(main.includes('this.shieldBubbleWin'), 'Missing shieldBubbleWin in main.js');
  assert(main.includes('this.permissionBubbleWin'), 'Missing permissionBubbleWin in main.js');
  assert(main.includes('toggleExtensionBubble'), 'Missing toggleExtensionBubble in main.js');
  assert(main.includes('toggleShieldBubble'), 'Missing toggleShieldBubble in main.js');
  assert(main.includes('openPermissionBubble'), 'Missing openPermissionBubble in main.js');
});

// 2. Bubble HTML files exist
runTest('2. Bubble HTML files exist in src/pages/', () => {
  assert(fs.existsSync(path.join(__dirname, '..', 'src', 'pages', 'extension-bubble.html')), 'Missing extension-bubble.html');
  assert(fs.existsSync(path.join(__dirname, '..', 'src', 'pages', 'shield-bubble.html')), 'Missing shield-bubble.html');
  assert(fs.existsSync(path.join(__dirname, '..', 'src', 'pages', 'permission-bubble.html')), 'Missing permission-bubble.html');
});

// 3. Bubble IPC handlers in main.js
runTest('3. main.js registers IPC handlers for bubbles', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes("ipcMain.handle('extensions:toggleBubble'"), 'Missing extensions:toggleBubble');
  assert(main.includes("ipcMain.handle('shield:toggleBubble'"), 'Missing shield:toggleBubble');
  assert(main.includes("ipcMain.handle('permissions:openBubble'"), 'Missing permissions:openBubble');
  assert(main.includes("ipcMain.handle('permissions:closeBubble'"), 'Missing permissions:closeBubble');
});

// 4. Preload scripts expose bubble APIs
runTest('4. Preload scripts expose bubble APIs', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const preloadInternal = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-internal.js'), 'utf8');
  assert(preload.includes('toggleExtensionBubble'), 'Missing toggleExtensionBubble in preload.js');
  assert(preload.includes('toggleShieldBubble'), 'Missing toggleShieldBubble in preload.js');
  assert(preload.includes('openPermissionBubble'), 'Missing openPermissionBubble in preload.js');
  assert(preloadInternal.includes('toggleExtensionBubble'), 'Missing toggleExtensionBubble in preload-internal.js');
  assert(preloadInternal.includes('toggleShieldBubble'), 'Missing toggleShieldBubble in preload-internal.js');
});

// 5. .hidden rule in extensions.css
runTest('5. .hidden { display: none !important; } in extensions.css prevents error popup bug', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'extensions.css'), 'utf8');
  assert(css.includes('.hidden') && css.includes('display: none !important'), 'Missing .hidden display none rule in extensions.css');
});

// 6. Throttled resize in main.js
runTest('6. main.js uses throttledUpdateViewBounds to eliminate Windows 10 resize lag', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes('throttledUpdateViewBounds'), 'Missing throttledUpdateViewBounds in main.js');
  assert(main.includes("this.mainWindow.on('resize',     () => this.throttledUpdateViewBounds"), 'mainWindow resize not using throttler');
});

// 7. Cached header height in main.js
runTest('7. main.js caches headerHeight to prevent synchronous storage queries on resize', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes('this._cachedHeaderHeight'), 'Missing _cachedHeaderHeight in main.js');
});

// 8. DuckDuckGo search engine normalization
runTest('8. DuckDuckGo search engine normalization in main.js and newtab.js', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const newtab = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'newtab.js'), 'utf8');
  assert(main.includes('duckduckgo:'), 'Missing duckduckgo in main.js search URLs');
  assert(newtab.includes('duckduckgo:'), 'Missing duckduckgo in newtab.js search URLs');
});

// 9. body.theme-light styles in style.css
runTest('9. body.theme-light CSS variables and overrides in src/renderer/style.css', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');
  assert(css.includes('body.theme-light'), 'Missing body.theme-light in style.css');
  assert(css.includes('--bg-chrome: #e2e8f0;'), 'Missing light bg-chrome');
  assert(css.includes('--bg-toolbar: #f8fafc;'), 'Missing light bg-toolbar');
  assert(css.includes('--text-main: #0f172a;'), 'Missing light text-main');
});

// 10. theme-light styling in internal pages
runTest('10. Internal pages (settings, extensions, newtab) have theme-light styles', () => {
  const setCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'settings.css'), 'utf8');
  const extCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'extensions.css'), 'utf8');
  const ntCss  = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'newtab.css'), 'utf8');
  assert(setCss.includes('body.theme-light'), 'Missing body.theme-light in settings.css');
  assert(extCss.includes('body.theme-light'), 'Missing body.theme-light in extensions.css');
  assert(ntCss.includes('body.theme-light'),  'Missing body.theme-light in newtab.css');
});

// 11. Theme broadcasting and live synchronization
runTest('11. main.js broadcasts theme:changed and settings:updated', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes('broadcastThemeChange'), 'Missing broadcastThemeChange in main.js');
  assert(main.includes('broadcastSettingsUpdated'), 'Missing broadcastSettingsUpdated in main.js');
});

// 12. app.js wires floating bubbles and tab helpers
runTest('12. app.js wires floating bubbles and tab openers', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert(app.includes('api.toggleShieldBubble'), 'Missing toggleShieldBubble wire in app.js');
  assert(app.includes('api.toggleExtensionBubble'), 'Missing toggleExtensionBubble wire in app.js');
  assert(app.includes('function openSettingsTab'), 'Missing openSettingsTab in app.js');
  assert(app.includes('function openDownloadsTab'), 'Missing openDownloadsTab in app.js');
  assert(app.includes('function openExtensionsTab'), 'Missing openExtensionsTab in app.js');
});

// 13. in-DOM permissionPromptCard kept hidden
runTest('13. in-DOM permissionPromptCard kept hidden to prevent WebContentsView occlusion', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert(app.includes('if (permissionPromptCard) permissionPromptCard.classList.add(\'hidden\');'), 'permissionPromptCard not kept hidden');
});

console.log('\n──────────────────────────────────────────────────────────');
console.log(`  Tests Passed: ${testsPassed} / ${testsPassed + testsFailed}`);
if (testsFailed > 0) {
  console.log(`  Tests Failed: ${testsFailed}`);
  process.exit(1);
} else {
  console.log('  All Stage 10 bugfix and floating bubble tests PASSED! ✨');
}
