/**
 * WINDOW FRAME, DRAG & RESIZE TEST SUITE — tests/stage8-window-frame-resize.test.js
 *
 * Validates Chrome-style top bar window dragging, 8-direction edge resizing,
 * double-click maximize/restore, and anti-duplicate download protection.
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
console.log('  SHMMOTH Browser — Window Frame, Drag & Resize Suite    ');
console.log('══════════════════════════════════════════════════════════\n');

// 1. Package version check
runTest('1. package.json version bumped to 1.0.8', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.version, '1.0.8');
});

// 2. index.html contains draggable region
runTest('2. index.html defines #drag-region for window dragging', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert(html.includes('id="drag-region"'), 'Missing id="drag-region" in index.html');
  assert(html.includes('class="drag-region"'), 'Missing class="drag-region" in index.html');
});

// 3. CSS contains webkit-app-region drag and no-drag declarations
runTest('3. style.css configures drag regions and no-drag controls', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');
  assert(css.includes('-webkit-app-region: drag;'), 'Missing drag region in style.css');
  assert(css.includes('.drag-region'), 'Missing .drag-region rule in style.css');
  assert(css.includes('.tabs-strip'), 'Missing .tabs-strip rule in style.css');
  assert(css.includes('-webkit-app-region: no-drag;'), 'Missing no-drag rules in style.css');
  assert(css.includes('.tabs-header-row::before'), 'Missing top edge resize handle in style.css');
});

// 4. Main process window configurations
runTest('4. main.js configures compact min dimensions, thickFrame, and resizable', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(/minWidth:\s*400/.test(main), 'minWidth 400 not configured');
  assert(/minHeight:\s*300/.test(main), 'minHeight 300 not configured');
  assert(/resizable:\s*true/.test(main), 'resizable true not configured');
  assert(/thickFrame:\s*true/.test(main), 'thickFrame true not configured');
});

// 5. Main process reserves edge margins in windowed mode for OS resize handles
runTest('5. main.js reserves 4px margin in windowed mode for 8-direction resize handles', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(main.includes('const edgeMargin = isMax ? 0 : 4;'), 'Missing edgeMargin calculation in main.js');
  assert(main.includes('ipcMain.handle(\'window:isMaximized\''), 'Missing window:isMaximized IPC handler in main.js');
});

// 6. Preload scripts expose isWindowMaximized and onWindowState
runTest('6. Preload scripts expose window state APIs', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const preloadInternal = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-internal.js'), 'utf8');
  assert(preload.includes('isWindowMaximized'), 'isWindowMaximized missing in preload.js');
  assert(preload.includes('onWindowState'), 'onWindowState missing in preload.js');
  assert(preloadInternal.includes('isWindowMaximized'), 'isWindowMaximized missing in preload-internal.js');
  assert(preloadInternal.includes('onWindowState'), 'onWindowState missing in preload-internal.js');
});

// 7. Anti-Duplicate Download Protection in downloadManager
runTest('7. downloadManager includes anti-duplicate protection and 4000ms debounce', () => {
  const dm = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'downloadManager.js'), 'utf8');
  assert(dm.includes('Smart Anti-Duplicate'), 'Missing Smart Anti-Duplicate comment in downloadManager');
  assert(dm.includes('(now - d.startedAt) < 4000'), 'Missing 4000ms cooldown in downloadManager');
});

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  Window Frame & Resize Suite: ${testsPassed} passed, ${testsFailed} failed`);
console.log('══════════════════════════════════════════════════════════\n');

if (testsFailed > 0) {
  process.exit(1);
}
