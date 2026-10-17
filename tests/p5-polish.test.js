/**
 * Phase 5 of the redesign — polish: no emoji anywhere in the interface, motion, the first-start card, Windows 11 Mica.
 * Run: node tests/p5-polish.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿⏩-⏺]/u;

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — polish (Phase 5)');
console.log('══════════════════════════════════════════════════════\n');

test('no emoji in any page, bubble or the browser frame (comments aside)', () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'src', 'pages')).filter((f) => /\.(html|js)$/.test(f)).map((f) => ['src', 'pages', f]),
    ['src', 'renderer', 'index.html'], ['src', 'renderer', 'app.js']
  ];
  for (const f of files) {
    const code = read(...f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    assert(!EMOJI.test(code), `${f.join('/')}: ${(code.match(EMOJI) || [])[0]}`);
  }
});

test('every icon the frame and Settings ask for exists in the set', () => {
  const names = [...read('src', 'pages', 'icons.js').matchAll(/^\s+'?([a-z-]+)'?:\s+\[\[/gm)].map((m) => m[1]);
  const src = read('src', 'renderer', 'index.html') + read('src', 'renderer', 'app.js') + read('src', 'pages', 'settings.html') + read('src', 'pages', 'settings.js');
  for (const m of src.matchAll(/data-icon="([a-z-]+)"|iconMarkup\('([a-z-]+)'\)|setUpdateIcon\('([a-z-]+)'\)|data-fallback-icon="([a-z-]+)"/g)) {
    const n = m[1] || m[2] || m[3] || m[4];
    assert(names.includes(n), 'unknown icon ' + n);
  }
  for (const m of read('src', 'pages', 'settings.js').matchAll(/icon = '([a-z-]+)'/g)) assert(names.includes(m[1]), 'unknown icon ' + m[1]);
});

test('Settings status lines and the update card take their colours from the tokens', () => {
  const js = read('src', 'pages', 'settings.js');
  assert(!/style\.color = '#/.test(js), 'colour set from script');
  assert(/function setImportStatus\(kind, text\)/.test(js) && /\.status-line\.error\s+\{ color: var\(--sh-danger\); \}/.test(read('src', 'pages', 'settings.css')));
  assert(!/style="background:\s*#2563eb/.test(read('src', 'pages', 'settings.html')), 'hard-coded blue buttons');
});

test('the password and saved-login windows follow the theme (tokens, theme.js, icons.js)', () => {
  for (const f of ['password-bubble.html', 'autofill-bubble.html']) {
    const html = read('src', 'pages', f);
    assert(/href="design-tokens\.css"/.test(html) && /<script src="theme\.js"><\/script>/.test(html) && /<script src="icons\.js"><\/script>/.test(html), f);
    assert(!/#1e293b|#38bdf8|#2563eb/.test(html), f + ': old dark colours');
  }
  const csp = /content="([^"]+)"/.exec(read('src', 'pages', 'autofill-bubble.html').match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0])[1];
  assert(/default-src 'none'/.test(csp) && /script-src 'self' 'unsafe-inline'/.test(csp) && !/https?:|\*/.test(csp), 'the list keeps a tight policy: ' + csp);
  assert(!/innerHTML/.test(read('src', 'pages', 'autofill-bubble.html')), 'the list still builds with DOM calls');
});

test('motion: bubbles drop in, a new tab slides in once, all of it off under reduced motion', () => {
  const tokens = read('src', 'pages', 'design-tokens.css');
  assert(/@keyframes sh-pop/.test(tokens) && /prefers-reduced-motion: reduce[\s\S]*animation-duration: 1ms !important/.test(tokens));
  for (const f of ['shield-bubble.html', 'download-bubble.html', 'extension-bubble.html', 'permission-bubble.html', 'menu-bubble.html', 'password-bubble.html', 'autofill-bubble.html']) {
    assert(/animation: sh-pop var\(--sh-motion\)/.test(read('src', 'pages', f)), f);
  }
  const app = read('src', 'renderer', 'app.js');
  assert(/if \(previousTabIds && !previousTabIds\.has\(tab\.id\)\) tabEl\.classList\.add\('tab-enter'\);/.test(app));
  assert(/\.browser-tab\.tab-enter \{ animation: sh-tab-in/.test(read('src', 'renderer', 'style.css')));
});

test('first start: new profiles get the card, profiles from before 1.4.0 do not', () => {
  const storageSrc = read('src', 'services', 'storage.js');
  assert(/welcomeDone:\s+false/.test(storageSrc));
  // run the real Storage against a fresh and an old profile
  const Module = require('module');
  const realLoad = Module._load;
  let profileDir = os.tmpdir();
  Module._load = function (req, ...rest) { return req === 'electron' ? { app: { getPath: () => profileDir } } : realLoad.call(this, req, ...rest); };
  try {
    const Storage = require(path.join(ROOT, 'src', 'services', 'storage.js'));
    const make = (dir) => { profileDir = dir; return new Storage(); };
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-fresh-'));
    assert(make(fresh).getSettings().welcomeDone === false, 'a new profile shows the card');
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-old-'));
    fs.writeFileSync(path.join(old, 'mtc-data.json'), JSON.stringify({ settings: { theme: 'dark' } }));
    assert(make(old).getSettings().welcomeDone === true, 'an existing profile does not');
  } finally {
    Module._load = realLoad;
  }
  const nt = read('src', 'pages', 'newtab.js');
  assert(/if \(settings\.welcomeDone !== false\) return;/.test(nt) && /updateSettings\(\{ welcomeDone: true \}\)/.test(nt));
  assert(!/'welcomeDone'/.test(read('src', 'pages', 'settings.js')), 'Reset to defaults does not bring the card back');
});

test('Mica: Windows 11 22H2+ only, off by default, the tab strip is left clear only while it is on', () => {
  const { supportsMica, applyMica } = require(path.join(ROOT, 'src', 'services', 'windowMaterial.js'));
  assert(supportsMica('win32', '10.0.22621') && supportsMica('win32', '10.0.26100'));
  assert(!supportsMica('win32', '10.0.22000') && !supportsMica('win32', '10.0.19045') && !supportsMica('linux', '6.1.0') && !supportsMica('darwin', '23.0.0'));
  const calls = [];
  const win = { isDestroyed: () => false, setBackgroundColor: (c) => calls.push(['color', c]), setBackgroundMaterial: (m) => calls.push(['material', m]) };
  assert(applyMica(win, true, '#0f172a', true) === true && JSON.stringify(calls) === JSON.stringify([['color', '#00000000'], ['material', 'mica']]));
  calls.length = 0;
  assert(applyMica(win, false, '#0f172a', true) === false && JSON.stringify(calls) === JSON.stringify([['color', '#0f172a'], ['material', 'none']]));
  calls.length = 0;
  assert(applyMica(win, true, '#0f172a', false) === false && calls.length === 0, 'nothing happens without Mica');
  assert(/micaEffect:\s+false/.test(read('src', 'services', 'storage.js')));
  assert(/if \(delta\.micaEffect !== undefined\) this\.applyWindowMaterial\(\);/.test(read('src', 'browser', 'ipc.js')));
  assert(/body\.mica \.tabs-header-row \{ background-color: transparent; \}/.test(read('src', 'renderer', 'style.css')));
  assert(/id="row-mica"/.test(read('src', 'pages', 'settings.html')) && /if \(f && f\.mica\)/.test(read('src', 'pages', 'settings.js')));
});

test('the logo is the moth (chosen in 1.4.3), the same file for the app icon and the pages', () => {
  const svg = read('src', 'pages', 'logo.svg');
  assert(svg === read('build', 'icon.svg'), 'one logo');
  assert(/the moth: two pairs of wings/.test(svg) && /stop-color="#4f46e5"/.test(svg), 'moth on the indigo tile');
  assert(!/M 700 345/.test(svg), 'the old ribbon S is gone');
});

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
