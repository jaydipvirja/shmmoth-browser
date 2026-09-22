/**
 * FULLSCREEN & HTML5 VIDEO (YOUTUBE) TEST SUITE — tests/stage9-fullscreen-video.test.js
 *
 * Validates True Fullscreen support for YouTube and HTML5 media elements:
 * - BrowserWindow fullscreenable: true configuration
 * - HTML5 fullscreen event listeners (enter-html-full-screen, leave-html-full-screen)
 * - View bounds calculation (0,0,width,height) in fullscreen mode
 * - F11 keyboard shortcut support
 * - Preload and IPC API surface
 * - Renderer CSS chrome hiding rule
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
console.log('  SHMMOTH Browser — Fullscreen & YouTube Video Suite     ');
console.log('══════════════════════════════════════════════════════════\n');

// 1. Check main.js BrowserWindow fullscreenable configuration
runTest('1. main.js configures fullscreenable: true on browser windows', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes('fullscreenable:  true') || main.includes('fullscreenable: true'), 'Missing fullscreenable: true in main.js');
});

// 2. Check main.js window fullscreen lifecycle events
runTest('2. main.js handles enter-full-screen and leave-full-screen window events', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes("this.mainWindow.on('enter-full-screen'"), 'Missing mainWindow enter-full-screen handler');
  assert(main.includes("this.mainWindow.on('leave-full-screen'"), 'Missing mainWindow leave-full-screen handler');
  assert(main.includes("this.incognitoWindow.on('enter-full-screen'"), 'Missing incognitoWindow enter-full-screen handler');
  assert(main.includes("this.incognitoWindow.on('leave-full-screen'"), 'Missing incognitoWindow leave-full-screen handler');
});

// 3. Check updateViewBounds covers 100% of display in fullscreen
runTest('3. updateViewBounds sets (0,0,width,height) without header margin in fullscreen', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes('const isFullScreen = win.isFullScreen() || Boolean(activeTab && activeTab.isHtmlFullScreen);'), 'Missing isFullScreen check in updateViewBounds');
  assert(main.includes('x: 0,\n            y: 0,\n            width: bounds.width,\n            height: bounds.height'), 'updateViewBounds does not cover 0,0,bounds.width,bounds.height');
});

// 4. Check HTML5 fullscreen listeners in createTab
runTest('4. createTab attaches enter-html-full-screen and leave-html-full-screen listeners', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes("wc.on('enter-html-full-screen'"), 'Missing enter-html-full-screen on wc');
  assert(main.includes("wc.on('leave-html-full-screen'"), 'Missing leave-html-full-screen on wc');
  assert(main.includes("targetWin.setFullScreen(true)"), 'enter-html-full-screen does not call setFullScreen(true)');
  assert(main.includes("targetWin.setFullScreen(false)"), 'leave-html-full-screen does not call setFullScreen(false)');
});

// 5. Check F11 shortcut in before-input-event on WebContents
runTest('5. WebContents before-input-event listens for F11 fullscreen shortcut', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes("wc.on('before-input-event'"), 'Missing before-input-event listener on wc');
  assert(main.includes("input.key === 'F11'"), 'F11 key not handled in before-input-event');
});

// 6. Check fullscreen safety on tab switch and tab close
runTest('6. switchTab and closeTab safely exit fullscreen when tab leaves focus', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes('prevActiveTab.isHtmlFullScreen'), 'switchTab does not check prevActiveTab.isHtmlFullScreen');
  assert(main.includes('tabData.isHtmlFullScreen'), 'closeTab does not check tabData.isHtmlFullScreen');
});

// 7. Check IPC handlers in main.js
runTest('7. setupIpc registers window:isFullScreen and window:setFullScreen handlers', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes("ipcMain.handle('window:isFullScreen'"), 'Missing window:isFullScreen IPC handler');
  assert(main.includes("ipcMain.handle('window:setFullScreen'"), 'Missing window:setFullScreen IPC handler');
});

// 8. Check Preload scripts expose fullscreen APIs
runTest('8. Preload scripts expose isWindowFullScreen, toggleFullScreen, and onFullScreenChange', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const preloadInternal = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-internal.js'), 'utf8');

  assert(preload.includes('isWindowFullScreen'), 'Missing isWindowFullScreen in preload.js');
  assert(preload.includes('toggleFullScreen'), 'Missing toggleFullScreen in preload.js');
  assert(preload.includes('onFullScreenChange'), 'Missing onFullScreenChange in preload.js');

  assert(preloadInternal.includes('isWindowFullScreen'), 'Missing isWindowFullScreen in preload-internal.js');
  assert(preloadInternal.includes('toggleFullScreen'), 'Missing toggleFullScreen in preload-internal.js');
  assert(preloadInternal.includes('onFullScreenChange'), 'Missing onFullScreenChange in preload-internal.js');
});

// 9. Check renderer app.js handles onFullScreenChange and F11
runTest('9. app.js toggles is-fullscreen class on body and handles F11 shortcut', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert(app.includes('api.onFullScreenChange'), 'app.js does not listen to onFullScreenChange');
  assert(app.includes("document.body.classList.toggle('is-fullscreen'"), 'app.js does not toggle is-fullscreen on body');
  assert(app.includes("e.key === 'F11'"), 'app.js does not handle F11 key in shortcuts');
});

// 10. Check CSS hides browser chrome in fullscreen
runTest('10. style.css hides .browser-chrome when body has is-fullscreen class', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');
  assert(css.includes('body.is-fullscreen .browser-chrome'), 'Missing body.is-fullscreen .browser-chrome rule');
  assert(css.includes('display: none !important;'), 'Missing display: none !important rule in fullscreen style');
});

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  Fullscreen & YouTube Video Suite: ${testsPassed} passed, ${testsFailed} failed`);
console.log('══════════════════════════════════════════════════════════\n');

if (testsFailed > 0) {
  process.exit(1);
}
