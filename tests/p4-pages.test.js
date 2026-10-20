/**
 * Phase 4 of the redesign — History, Bookmarks, Downloads, Extensions, Notes, Error and Crash pages.
 * Run: node tests/p4-pages.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', ...p), 'utf8');

const PAGES = ['history', 'bookmarks', 'downloads', 'extensions', 'notes', 'error', 'crash', 'privacy'];
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿⏩-⏺]/u;
const icons = read('icons.js');
const iconNames = [...icons.matchAll(/^\s+'?([a-z-]+)'?:\s+\[\[/gm)].map((m) => m[1]);

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — library and error pages (Phase 4)');
console.log('══════════════════════════════════════════════════════\n');

test('no emoji in the markup or the scripts of these pages', () => {
  for (const p of PAGES) {
    for (const f of [p + '.html', p + '.js']) {
      const src = read(f);
      assert(!EMOJI.test(src), `${f} still has emoji: ${(src.match(EMOJI) || [])[0]}`);
    }
  }
});

test('every page loads icons.js (before its own script) and the theme', () => {
  for (const p of PAGES) {
    const html = read(p + '.html');
    const at = (s) => html.indexOf(`<script src="${s}"></script>`);
    assert(at('icons.js') > 0 && at('theme.js') > 0, p + ': icons.js / theme.js');
    assert(at('icons.js') < at(p + '.js'), p + ': icons.js must come first');
  }
});

test('every icon the pages and their scripts ask for exists in the set', () => {
  for (const p of PAGES) {
    const src = read(p + '.html') + read(p + '.js');
    for (const m of src.matchAll(/data-icon="([a-z-]+)"|data-fallback-icon="([a-z-]+)"/g)) {
      const n = m[1] || m[2];
      assert(iconNames.includes(n), `${p}: unknown icon "${n}"`);
    }
  }
  const err = read('error.js');
  for (const m of err.matchAll(/icon: '([a-z-]+)'/g)) assert(iconNames.includes(m[1]), 'error.js: unknown icon ' + m[1]);
});

test('markup built by the scripts gets its icons drawn', () => {
  assert(/window\.ShIcons\.drawAll\(row\)/.test(read('history.js')));
  assert(/window\.ShIcons\.drawAll\(card\)/.test(read('bookmarks.js')) && /window\.ShIcons\.drawAll\(item\)/.test(read('bookmarks.js')));
  assert(/window\.ShIcons\.drawAll\(div\)/.test(read('downloads.js')) && /window\.ShIcons\.drawAll\(bondingStatusBadge\)/.test(read('downloads.js')));
  assert(/window\.ShIcons\.drawAll\(card\)/.test(read('extensions.js')));
  assert(/iconEl\.replaceChildren\(iconSvg\)/.test(read('error.js')) && !/innerHTML/.test(read('error.js')), 'the error page stays free of innerHTML');
});

test('favicons fall back to an icon, the file type is an escaped label', () => {
  for (const f of ['history.js', 'bookmarks.js', 'extensions.js']) {
    const js = read(f);
    assert(/data-fallback-icon="(globe|puzzle)"/.test(js) && !/data-fallback="/.test(js), f);
  }
  assert(/<div class="dl-icon-container">\$\{escapeHtml\(fileIcon\)\}<\/div>/.test(read('downloads.js')));
});

test('colours come from the tokens: no inline status colours or old dark literals', () => {
  for (const p of PAGES) {
    const src = read(p + '.html') + read(p + '.js');
    assert(!/style\.color = '#/.test(src), p + ': colour set from script');
    assert(!/rgba\((59, ?130, ?246|96, ?165, ?250|52, ?211, ?153|0, ?0, ?0, ?0\.[4-7])/.test(src), p + ': old literal colour');
    assert(!/#(64748b|94a3b8|ef4444|60a5fa|93c5fd|f59e0b|10b981|34d399|f87171)\b/i.test(src), p + ': old hex colour');
  }
  assert(!/rgba\(59, 130, 246|#ef4444|color: var\(--sh-on-accent\);\s*\n\s*padding: 12px 18px/.test(read('extensions.css')), 'extensions.css: toast text readable in light');
  assert(/\.btn-primary \{\s*\n\s*background: var\(--sh-accent\);/.test(read('settings.css')), 'settings.css styles .btn-primary');
});

test('search boxes have the search icon and a name for screen readers', () => {
  const boxes = { history: 'history-search-input', bookmarks: 'bm-search-input', downloads: 'search-downloads', extensions: 'ext-search-input' };
  for (const [p, id] of Object.entries(boxes)) {
    const html = read(p + '.html');
    assert(new RegExp(`<input type="search" id="${id}"[^>]*aria-label="Search ${p}"`).test(html), p + ': search input');
    assert(/data-icon="search"/.test(html), p + ': search icon');
  }
});

test('icon-only buttons carry a name', () => {
  const src = read('history.js') + read('bookmarks.js') + read('downloads.js') + read('extensions.html');
  for (const m of src.matchAll(/<button [^>]*>\s*<span class="sh-icon"[^>]*><\/span>\s*<\/button>/g)) {
    assert(/aria-label="/.test(m[0]), 'unnamed button: ' + m[0]);
  }
});

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
