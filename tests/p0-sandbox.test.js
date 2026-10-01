/**
 * SHMMOTH BROWSER — P0 RENDERER SANDBOX TESTS
 *
 * Every window / view that renders content must run with the Chromium renderer
 * sandbox (sandbox: true) + context isolation and no Node integration, and the
 * preload scripts must stay compatible with a sandboxed preload environment
 * (only a small subset of Electron's API, no Node built-ins).
 *
 * Run with: node tests/p0-sandbox.test.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

const SRC  = path.join(__dirname, '..', 'src');
const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — P0 Renderer Sandbox Tests          ');
console.log('══════════════════════════════════════════════════════\n');

// ═════════════════════════════════════════════════════════════════════════════
console.log('📋 1. main.js: every webPreferences block is sandboxed + isolated');
// ═════════════════════════════════════════════════════════════════════════════

/** Returns the text of every `webPreferences ... { ... }` object literal (balanced braces). */
function webPreferenceBlocks(source) {
  const blocks = [];
  const re = /webPreferences\s*[:=]\s*\{/g;
  let m;
  while ((m = re.exec(source))) {
    let depth = 1; let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    blocks.push({ text: source.slice(m.index, i), line: source.slice(0, m.index).split('\n').length });
  }
  return blocks;
}

const blocks = webPreferenceBlocks(main);

test('found the expected number of webPreferences blocks (guards the scanner itself)', () => {
  // main window, incognito window, tab view, side panel, popup (OAuth), 5 bubbles/popups
  assert(blocks.length >= 11, 'only found ' + blocks.length);
});

test('no sandbox: false anywhere in main.js', () => {
  assert(!/sandbox\s*:\s*false/.test(main), 'sandbox: false found');
});

test('every webPreferences block sets sandbox: true', () => {
  for (const b of blocks) assert(/sandbox\s*:\s*true/.test(b.text), `main.js:${b.line} is missing sandbox: true`);
});

test('every webPreferences block keeps contextIsolation on and nodeIntegration off', () => {
  for (const b of blocks) {
    assert(/contextIsolation\s*:\s*true/.test(b.text), `main.js:${b.line} must set contextIsolation: true`);
    assert(!/nodeIntegration\s*:\s*true/.test(b.text), `main.js:${b.line} enables nodeIntegration`);
  }
});

test('nothing else weakens the renderer security model', () => {
  for (const bad of [/nodeIntegrationInSubFrames\s*:\s*true/, /webviewTag\s*:\s*true/, /webSecurity\s*:\s*false/,
                     /allowRunningInsecureContent\s*:\s*true/, /enableRemoteModule/, /--no-sandbox|no-sandbox/, /enableSandbox\(\s*false/]) {
    assert(!bad.test(main), 'found ' + bad);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 2. Preloads run inside a sandboxed-preload environment');
// ═════════════════════════════════════════════════════════════════════════════

// What a sandboxed preload may require(): https://www.electronjs.org/docs/latest/tutorial/sandbox
const ALLOWED_MODULES = new Set(['electron', 'events', 'timers', 'url']);
const ALLOWED_ELECTRON = new Set(['contextBridge', 'crashReporter', 'ipcRenderer', 'nativeImage', 'webFrame', 'webUtils']);

function runPreloadStrict(file, location) {
  const exposed = [];
  const isolatedWorldScripts = [];
  const electron = new Proxy({
    contextBridge: { exposeInMainWorld: (name) => exposed.push(name) },
    ipcRenderer: { send() {}, invoke() {}, on() {} },
    webFrame: { executeJavaScriptInIsolatedWorld: (world, scripts) => isolatedWorldScripts.push(scripts) }
  }, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (!ALLOWED_ELECTRON.has(prop)) throw new Error(`electron.${prop} is not available to sandboxed preloads`);
      return target[prop];
    }
  });
  const sandbox = {
    window: { location },
    require: (m) => {
      if (!ALLOWED_MODULES.has(m)) throw new Error(`require('${m}') is not available in a sandboxed preload`);
      return m === 'electron' ? electron : {};
    },
    // sandboxed preloads get only a limited process object and no __dirname/__filename/module
    process: { platform: 'win32', sandboxed: true, versions: {} },
    console, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file });
  return { exposed, isolatedWorldScripts };
}

const loc = (protocol, host, pathname) => ({ protocol, host, pathname });

test('preload-internal.js loads in a sandboxed environment and exposes the API on trusted pages', () => {
  const r = runPreloadStrict('preload-internal.js', loc('mtc:', 'history', '/'));
  assert(r.exposed.includes('mtcAPI') && r.exposed.includes('shmmothAPI'));
});

test('preload-internal.js loads in a sandboxed environment on an external page (no API, UA patch only)', () => {
  const r = runPreloadStrict('preload-internal.js', loc('https:', 'example.com', '/'));
  assert(r.exposed.length === 0 && r.isolatedWorldScripts.length === 1);
});

test('preload-external.js loads in a sandboxed environment and applies the UA-data patch without exposing anything', () => {
  const r = runPreloadStrict('preload-external.js', loc('https:', 'example.com', '/'));
  assert(r.exposed.length === 0 && r.isolatedWorldScripts.length === 1);
});

test('preloads only require modules available to sandboxed preloads', () => {
  for (const f of ['preload-internal.js', 'preload-external.js']) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert(ALLOWED_MODULES.has(m[1]), `${f} requires '${m[1]}'`);
    }
    assert(!/__dirname|__filename|process\.binding|child_process|\bfs\b\./.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
      `${f} uses a Node-only facility`);
  }
});

test('the strict shim really rejects Node built-ins (self-check of this test)', () => {
  let threw = false;
  try { vm.runInNewContext("require('fs')", { require: (m) => { if (!ALLOWED_MODULES.has(m)) throw new Error('x'); } }); } catch (_) { threw = true; }
  assert(threw);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
