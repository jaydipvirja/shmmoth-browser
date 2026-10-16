/**
 * SHMMOTH BROWSER — the main process split into files (src/main.js + src/browser/)
 *
 * main.js holds the start-up only; the application's other methods live in src/browser/*.js and browser/mixins.js
 * copies them onto the class. Checked here, without Electron:
 *   - every file in src/browser/ (besides shared.js and mixins.js) is added by mixins.js, and nothing else is
 *   - no method is defined twice across main.js and those files (mixins.js would also refuse it at start-up)
 *   - the moved code finds its pages and preloads through SRC_DIR (src/), not through its own folder
 *   - main.js stays the small start-up file it was split into
 *
 * Run: node tests/p0-main-split.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { mainSourceFiles, SRC } = require('./helpers/main-source');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const METHOD = /^  (?:async )?([A-Za-z_$][\w$]*)\s*\(.*\)\s*\{\s*$/gm;
const methodsOf = (text) => Array.from(text.matchAll(METHOD), (m) => m[1]).filter((n) => !['if', 'for', 'while', 'switch', 'catch'].includes(n));

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — main process split into files');
console.log('══════════════════════════════════════════════════════\n');

test('mixins.js adds exactly the area files of src/browser/', () => {
  const onDisk = fs.readdirSync(path.join(SRC, 'browser')).filter((f) => f.endsWith('.js') && !['shared.js', 'mixins.js'].includes(f)).sort();
  const added = mainSourceFiles().filter((f) => f.startsWith('browser' + path.sep) && !f.endsWith('shared.js')).map((f) => path.basename(f)).sort();
  assert(JSON.stringify(onDisk) === JSON.stringify(added), `on disk ${onDisk.join()} vs added ${added.join()}`);
  const listed = /module\.exports\.FILES = \[([^\]]*)\]/.exec(read(path.join('browser', 'mixins.js')));
  assert(listed && listed[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort().join() === added.join(), 'FILES matches the required files');
});

test('no method is defined twice across main.js and src/browser/', () => {
  const seen = new Map();
  for (const f of mainSourceFiles()) {
    for (const name of methodsOf(read(f))) {
      assert(!seen.has(name), `${name} in ${f} and ${seen.get(name)}`);
      seen.set(name, f);
    }
  }
  assert(seen.size > 80, 'expected the application\'s methods, found ' + seen.size);
  assert(seen.get('constructor') === 'main.js' && seen.get('init') === 'main.js', 'constructor and init stay in main.js');
});

test('mixins.js refuses a method defined twice and copies the methods with their descriptors', () => {
  const src = read(path.join('browser', 'mixins.js'));
  assert(/hasOwnProperty\.call\(App\.prototype, name\)\) throw/.test(src));
  assert(/Object\.defineProperty\(App\.prototype, name, Object\.getOwnPropertyDescriptor\(Mixin\.prototype, name\)\)/.test(src));
});

test('the moved code finds pages and preloads through SRC_DIR (src/), never through its own folder', () => {
  for (const f of mainSourceFiles().filter((x) => x.startsWith('browser'))) {
    const code = read(f).replace(/^\s*\/\/.*$/gm, '');
    const uses = code.match(/__dirname/g) || [];
    if (f.endsWith('shared.js')) assert(uses.length === 1 && /const SRC_DIR = require\('path'\)\.join\(__dirname, '\.\.'\)/.test(code), 'shared.js defines SRC_DIR once');
    else assert(uses.length === 0, `${f} uses __dirname`);
  }
});

test('main.js is the start-up only (switches, scheme, constructor, init, bootstrap) and adds the rest', () => {
  const main = read('main.js');
  const lines = main.split('\n').length;
  assert(lines < 600, `main.js has grown to ${lines} lines — new code belongs in src/browser/`);
  assert(/require\('\.\/browser\/mixins'\)\(ShmmothBrowserApp\);/.test(main));
  assert(/app\.commandLine\.appendSwitch\('disable-blink-features', 'AutomationControlled'\)/.test(main), 'switches run in main.js, before ready');
  assert(/protocol\.registerSchemesAsPrivileged\(/.test(main), 'the mtc:// scheme is registered in main.js, before ready');
  assert(main.indexOf("require('./browser/mixins')") < main.indexOf('new ShmmothBrowserApp()'), 'the methods are added before the app is created');
});

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
