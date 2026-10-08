/**
 * P0 — release pipeline: readiness check, changelog notes, draft-only workflow, icons, licence.
 * Run: node tests/p0-release.test.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const { isValidPublicKey, extractNotes, checkRelease } = require('../scripts/release-tool');
const sig = require('../src/services/updateSignature');
const crypto = require('crypto');

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — P0 Release Pipeline Tests          ');
console.log('══════════════════════════════════════════════════════\n');

const goodKey = sig.generateKeyPair().publicKeyBase64;
const changelog = '# Changelog\n\n## 1.2.0\n\n- new thing\n- other thing\n\n## 1.1.0\n\n- older\n';
const files = ['build/icon.ico', 'build/icon.png'];
const base = { version: '1.2.0', tag: 'v1.2.0', keys: [goodKey], changelog, files };

console.log('📋 1. Is the source ready to release?');
test('a complete release passes', () => assert(checkRelease(base).ok));
test('NO signing key compiled in → refused (such a build could never accept a signed update)', () => {
  const r = checkRelease({ ...base, keys: [] });
  assert(!r.ok && /no update-signing public key/.test(r.problems.join()), r.problems.join());
});
test('a malformed or non-Ed25519 key is refused', () => {
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  for (const bad of ['', 'not base64 !!', Buffer.from('hello').toString('base64'), rsa]) {
    assert(!checkRelease({ ...base, keys: [goodKey, bad] }).ok, 'accepted: ' + bad.slice(0, 20));
  }
  assert(isValidPublicKey(goodKey) && !isValidPublicKey(undefined) && !isValidPublicKey(null));
});
test('tag and package.json version must agree; only plain x.y.z versions are releasable', () => {
  assert(!checkRelease({ ...base, tag: 'v1.2.1' }).ok);
  assert(!checkRelease({ ...base, tag: '1.2.0' }).ok, 'tag needs the v prefix');
  for (const v of ['1.2', '1.2.0-beta.1', 'latest', '', undefined]) assert(!checkRelease({ ...base, version: v, tag: undefined }).ok, String(v));
  assert(checkRelease({ ...base, tag: undefined }).ok, 'no tag given = no tag check');
});
test('a changelog entry for the version and both icon files are required', () => {
  assert(!checkRelease({ ...base, changelog: '## 1.1.0\n- x' }).ok);
  assert(!checkRelease({ ...base, changelog: '## 1.2.0\n\n## 1.1.0\n- x' }).ok, 'empty section');
  assert(!checkRelease({ ...base, files: ['build/icon.png'] }).ok && !checkRelease({ ...base, files: [] }).ok);
});

console.log('\n📋 2. Release notes from CHANGELOG.md');
test('the section of one version is returned without its heading or the neighbours', () => {
  assert(extractNotes(changelog, '1.2.0') === '- new thing\n- other thing', JSON.stringify(extractNotes(changelog, '1.2.0')));
  assert(extractNotes(changelog, '1.1.0') === '- older');
});
test('"## [1.2.0] - date", "## v1.2.0" and CRLF files work; 1.2.0 does not match 11.2.0 or 1.2.01', () => {
  assert(extractNotes('## [1.2.0] - 2026-10-01\r\n\r\n- a\r\n\r\n## 1.1.0\r\n- b', '1.2.0') === '- a');
  assert(extractNotes('## v1.2.0\n- a', '1.2.0') === '- a');
  assert(extractNotes('## 11.2.0\n- a', '1.2.0') === null && extractNotes('## 1.2.01\n- a', '1.2.0') === null);
  assert(extractNotes('', '1.0.0') === null && extractNotes(undefined, '1.0.0') === null);
});
test('the repository\'s own CHANGELOG has notes for the current version', () => {
  const notes = extractNotes(read('CHANGELOG.md'), pkg.version);
  assert(notes && notes.length > 100, 'no notes for ' + pkg.version);
});

console.log('\n📋 3. The release workflow');
const wf = read('.github', 'workflows', 'release.yml');
const ci = read('.github', 'workflows', 'ci.yml');
test('it runs only for version tags', () => {
  assert(/tags:\s*\['v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\]/.test(wf) && !/branches:|pull_request/.test(wf));
});
test('it checks readiness before building, builds with the production configuration and smoke-tests the installer', () => {
  const i = (s) => wf.indexOf(s);
  assert(i('release-tool.js check --tag') > 0 && i('release-tool.js check --tag') < i('electron-builder --win'), 'check must come first');
  assert(i('electron-builder --win') < i('smoke-installer.js') && i('smoke-installer.js') < i('gh release create'));
  assert(!/electronFuses/.test(wf), 'the release build must not override any fuse');
});
test('it only creates a DRAFT, never signs, and holds no secret besides the built-in token', () => {
  assert(/gh release create[\s\S]*--draft/.test(wf) && !/--latest|--prerelease=false/.test(wf));
  assert(!/release-signing-key|SHMMOTH_SIGNING_KEY_PEM|\.pem\b/.test(wf), 'the signing key must never reach CI');
  const commands = wf.split('\n').map((l) => l.trim()).filter((l) => !l.startsWith('#') && !l.startsWith('echo'));
  assert(!commands.some((l) => /^(npm run release:sign|node scripts\/release-tool\.js sign)/.test(l)), 'CI must not sign (instructions in comments / the summary are fine)');
  const secrets = [...wf.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert(secrets.every((s) => s === 'GITHUB_TOKEN'), 'secrets used: ' + secrets.join());
});
test('write access to contents is granted to this workflow only; the CI workflow stays read-only', () => {
  assert(/permissions:\s*\n\s*contents: write/.test(wf));
  assert(/permissions:\s*\n\s*contents: read/.test(ci) && !/contents: write/.test(ci));
});

console.log('\n📋 4. Icon and licence');
test('build/icon.png is a square PNG of at least 512 px; icon.svg exists; the app shows the logo on the About page', () => {
  const png = fs.readFileSync(path.join(ROOT, 'build', 'icon.png'));
  assert(png.subarray(1, 4).toString() === 'PNG', 'not a PNG');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  assert(w === h && w >= 512, `${w}x${h}`);
  assert(fs.existsSync(path.join(ROOT, 'build', 'icon.svg')));
  assert(read('build', 'icon.svg') === read('src', 'pages', 'logo.svg'), 'src/pages/logo.svg must be a copy of build/icon.svg');
  assert(/src="logo\.svg"/.test(read('src', 'pages', 'settings.html')));
});
test('build/icon.ico holds the Windows sizes (16 … 256)', () => {
  const ico = fs.readFileSync(path.join(ROOT, 'build', 'icon.ico'));
  assert(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, 'not an ICO');
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) sizes.push(ico[6 + i * 16] || 256);
  for (const s of [16, 32, 48, 256]) assert(sizes.includes(s), `size ${s} missing (${sizes.join()})`);
});
test('the licence names the author and the installer metadata carries the same copyright', () => {
  assert(/^MIT License/.test(read('LICENSE')) && /Copyright \(c\) 2026 Jaydip B\. Virja/.test(read('LICENSE')));
  assert(pkg.license === 'MIT' && /Jaydip B\. Virja/.test(pkg.build.copyright));
});
test('the private signing key can never be committed', () => {
  const ignore = read('.gitignore');
  assert(/release-signing-key/.test(ignore) && /\*\.pem/.test(ignore));
});
test('all core source files parse without syntax errors', () => {
  const { execFileSync } = require('child_process');
  for (const rel of ['src/main.js', 'src/preload-external.js', 'src/preload-gesture.js', 'src/preload-internal.js']) {
    execFileSync(process.execPath, ['-c', path.join(ROOT, rel)]);
  }
});

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
