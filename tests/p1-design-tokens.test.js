/**
 * Phase 1 of the redesign — design tokens, the Theme setting ("Follow Windows"), icons, accessibility basics.
 * Run: node tests/p1-design-tokens.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { mainSource } = require('./helpers/main-source');
const { THEMES, DEFAULT_THEME, normalizeTheme } = require('../src/services/theme');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const PAGES = path.join(ROOT, 'src', 'pages');
const tokensCss = read('src', 'pages', 'design-tokens.css');

/** The custom properties declared in the first block whose selector matches `selector`. */
function tokenSet(selector) {
  const i = tokensCss.indexOf(selector + ' {');
  assert(i >= 0, 'no block ' + selector);
  const body = tokensCss.slice(i, tokensCss.indexOf('\n}', i));
  const out = {};
  for (const m of body.matchAll(/(--sh-[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const dark = tokenSet(':root');
const light = { ...dark, ...tokenSet('body.theme-light') };
const incognito = { ...dark, ...tokenSet('.theme-incognito') };

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — design tokens, theme, icons (Phase 1)');
console.log('══════════════════════════════════════════════════════\n');

console.log('📋 1. Tokens');
test('dark, light and incognito sets define every colour role', () => {
  const roles = ['--sh-bg', '--sh-surface', '--sh-surface-2', '--sh-field', '--sh-hover', '--sh-selected', '--sh-border', '--sh-text', '--sh-text-2', '--sh-accent', '--sh-accent-text', '--sh-on-accent', '--sh-focus', '--sh-danger', '--sh-danger-bg', '--sh-track', '--sh-shadow'];
  for (const [name, set] of [['dark', dark], ['light', light], ['incognito', incognito]]) {
    for (const r of roles) assert(set[r], `${name} has no ${r}`);
  }
  const lightOwn = tokenSet('body.theme-light');
  for (const r of ['--sh-bg', '--sh-surface', '--sh-text', '--sh-text-2', '--sh-accent-text', '--sh-border']) assert(lightOwn[r] && lightOwn[r] !== dark[r], `light overrides ${r}`);
  assert(/:root\.theme-light,\s*\nbody\.theme-light \{/.test(tokensCss), 'light applies to <html> (pages) and <body> (frame)');
});
test('text is readable in every set: at least 4.5 : 1 (WCAG AA)', () => {
  for (const [name, t] of [['dark', dark], ['light', light], ['incognito', incognito]]) {
    const pairs = [['text on bg', t['--sh-text'], t['--sh-bg']], ['text on surface', t['--sh-text'], t['--sh-surface']], ['text-2 on surface', t['--sh-text-2'], t['--sh-surface']], ['text-2 on bg', t['--sh-text-2'], t['--sh-bg']],
      ['on-accent on accent', t['--sh-on-accent'], t['--sh-accent']], ['accent-text on surface', t['--sh-accent-text'], t['--sh-surface']], ['white on danger button', '#ffffff', t['--sh-danger-bg']]];
    for (const [what, fg, bg] of pairs) {
      const r = contrast(fg, bg);
      assert(r >= 4.5, `${name}: ${what} is ${r.toFixed(2)} : 1`);
    }
  }
});
test('a visible keyboard focus ring and no motion when Windows turns animations off', () => {
  assert(/:focus-visible \{\s*outline: 2px solid var\(--sh-focus\)/.test(tokensCss));
  assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 1ms !important/.test(tokensCss));
});

console.log('\n📋 2. Every screen uses them');
const htmlPages = fs.readdirSync(PAGES).filter((f) => f.endsWith('.html'));
test('the frame, every internal page and every bubble load design-tokens.css first', () => {
  for (const f of htmlPages.filter((x) => x !== 'autofill-bubble.html')) {
    const html = read('src', 'pages', f);
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    assert(links[0] === 'design-tokens.css', `${f}: ${links.join(', ')}`);
  }
  assert(/<link rel="stylesheet" href="\.\.\/pages\/design-tokens\.css">/.test(read('src', 'renderer', 'index.html')), 'frame');
});
test('the pages that had a light theme take it from the tokens (no dark colours left on their surfaces)', () => {
  for (const f of ['settings.css', 'extensions.css']) {
    const css = read('src', 'pages', f);
    assert(!/background(-color)?: (#0f172a|#1e293b|#0b1120|#162032)/i.test(css), f + ' still paints dark surfaces');
    assert(!/body\.theme-light \.(sidebar|card|settings-section|ext-card)/.test(css), f + ' keeps an old light block');
  }
  const newtab = read('src', 'pages', 'newtab.css');
  assert(/\.search-box \{[^}]*background: var\(--sh-surface\)/.test(newtab), 'the New Tab search box follows the theme');
  assert(!/search-bar-wrapper/.test(newtab), 'the old selector that never matched is gone');
  for (const f of ['history.html', 'bookmarks.html', 'downloads.html', 'notes.html']) {
    assert(/href="settings\.css"/.test(read('src', 'pages', f)), f + ' shares the tokenised settings.css');
  }
});

console.log('\n📋 3. Theme setting: Follow Windows, Light, Dark');
test('the setting accepts system / light / dark; anything else (also the old "midnight") shows dark', () => {
  assert(JSON.stringify(THEMES) === '["system","light","dark"]' && DEFAULT_THEME === 'system');
  for (const t of THEMES) assert(normalizeTheme(t) === t);
  for (const t of ['midnight', '', undefined, null, 'LIGHT', 'blue']) assert(normalizeTheme(t) === 'dark', String(t));
});
test('new installs follow Windows; the main process applies the setting at start and on every change', () => {
  assert(/theme:\s+DEFAULT_THEME/.test(read('src', 'services', 'storage.js')));
  const main = mainSource();
  assert(/nativeTheme\.themeSource = normalizeTheme\(this\.storage\.getSettings\(\)\.theme\)/.test(main), 'at start');
  assert(/if \(delta\.theme !== undefined\) delta = \{ \.\.\.delta, theme: normalizeTheme\(delta\.theme\) \}/.test(main), 'on change, before it is saved');
  assert(/broadcastThemeChange\(delta\.theme\)/.test(main));
});
test('Settings offers Follow Windows, Light and Dark', () => {
  const html = read('src', 'pages', 'settings.html');
  const sel = /<select id="select-theme"[^>]*>([\s\S]*?)<\/select>/.exec(html)[1];
  const values = [...sel.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert(JSON.stringify(values) === '["system","light","dark"]', values.join());
  assert(/>Follow Windows</.test(sel));
});
test('pages/theme.js: the setting decides, "system" follows the Windows query, both live', () => {
  const js = read('src', 'pages', 'theme.js');
  assert(/setting === 'light' \|\| \(setting === 'system' && Boolean\(systemLight && systemLight\.matches\)\)/.test(js));
  assert(/systemLight\.addEventListener\('change', apply\)/.test(js) && /onThemeChanged\(use\)/.test(js));
  for (const f of ['settings', 'newtab', 'history', 'bookmarks', 'downloads', 'extensions', 'notes', 'error', 'crash']) {
    assert(/<script src="theme\.js"><\/script>/.test(read('src', 'pages', f + '.html')), f + '.html has no theme.js');
  }
  const app = read('src', 'renderer', 'app.js');
  assert(/prefersLight\.addEventListener\('change', \(\) => \{ if \(settings\.theme === 'system'\) applyTheme\('system'\); \}\)/.test(app), 'the frame follows a Windows switch');
  const bubbles = read('src', 'browser', 'bubbles.js');
  assert(/action\.startsWith\('theme-'\)[\s\S]{0,200}normalizeTheme[\s\S]{0,300}broadcastThemeChange\(theme\)/.test(bubbles), 'the main menu switches the theme (since 1.3.0)');
});

console.log('\n📋 4. Icons');
const icons = read('src', 'pages', 'icons.js');
test('one SVG icon set, drawn with DOM calls (CSP-safe), never innerHTML', () => {
  const code = icons.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert(!/innerHTML|outerHTML|insertAdjacentHTML/.test(code));
  assert(/createElementNS\(NS, 'svg'\)/.test(icons) && /stroke: 'currentColor'/.test(icons));
});
test('every data-icon used by a page exists in the set, and pages that use them load icons.js', () => {
  const names = [...icons.matchAll(/^\s+'?([a-z-]+)'?:\s+\[\[/gm)].map((m) => m[1]);
  assert(names.length >= 20, names.join());
  for (const f of htmlPages) {
    const html = read('src', 'pages', f);
    const used = [...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]);
    for (const u of used) assert(names.includes(u), `${f}: unknown icon "${u}"`);
    if (used.length) assert(/<script src="icons\.js"><\/script>/.test(html), f + ' uses icons without icons.js');
  }
  assert(/data-icon="shield"/.test(read('src', 'pages', 'settings.html')) && !/>🛡️ Ad-Blocker/.test(read('src', 'pages', 'settings.html')), 'the Settings menu uses the icons, not emoji');
});

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
