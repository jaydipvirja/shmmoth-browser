/**
 * P0 — release.bat / scripts/release-publish.js: sign and publish the newest draft in one go, on the publisher's PC.
 * The GitHub CLI is replaced by a fake that keeps a draft in memory, so nothing here touches GitHub.
 * Run: node tests/p0-release-publish.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const sig = require('../src/services/updateSignature');
const { publish, pickDraft, expectedHash, cleanPath } = require('../scripts/release-publish');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth-publish-test-'));
const trusted = sig.generateKeyPair();
const other = sig.generateKeyPair();
const keyFile = (name, pem) => { const p = path.join(TMP, name); fs.writeFileSync(p, pem); return p; };
const goodKey = keyFile('release-signing-key.pem', trusted.privateKeyPem);
const otherKey = keyFile('other.pem', other.privateKeyPem);
const notAKey = keyFile('notes.txt', 'hello');

// A fake `gh api` with one draft (and an old one); records every call, the uploaded .sig and the final draft state
function fakeGh({ version = '1.2.0', sums, oldSig = false } = {}) {
  const file = `SHMMOTH-Browser-Setup-${version}.exe`;
  const exe = crypto.randomBytes(4096);
  const hash = crypto.createHash('sha256').update(exe).digest('hex');
  const assets = { 11: [file, exe], 12: ['SHA256SUMS.txt', Buffer.from(sums !== undefined ? sums : `${hash}  ${file}\n`)] };
  if (oldSig) assets[13] = [file + '.sig', Buffer.from('old')];
  const state = { calls: [], draft: true, uploaded: null, deleted: [], file, exe };
  state.gh = (args, opts = {}) => {
    state.calls.push(args);
    assert(args[0] === 'api', 'only the REST API is used: ' + args.join(' '));
    const url = args[args.length - 1];
    const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
    if (method === 'GET' && url === 'repos/o/r/releases?per_page=30') {
      return JSON.stringify([
        { id: 1, tag_name: 'v1.1.6', draft: true, assets: [] },
        { id: 7, tag_name: `v${version}`, draft: true, assets: Object.entries(assets).map(([id, [name]]) => ({ id: Number(id), name })) },
        { id: 3, tag_name: 'v1.1.15', draft: false, assets: [] }
      ]);
    }
    let m;
    if (method === 'GET' && (m = /^repos\/o\/r\/releases\/assets\/(\d+)$/.exec(url))) {
      assert(opts.binary && args.includes('Accept: application/octet-stream'), 'assets are downloaded as bytes');
      return assets[m[1]][1];
    }
    if (method === 'DELETE' && (m = /^repos\/o\/r\/releases\/assets\/(\d+)$/.exec(url))) { state.deleted.push(Number(m[1])); return ''; }
    if (method === 'POST' && url === `https://uploads.github.com/repos/o/r/releases/7/assets?name=${encodeURIComponent(file + '.sig')}`) {
      state.uploaded = fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8');
      return '{}';
    }
    if (method === 'PATCH' && url === 'repos/o/r/releases/7') {
      assert(args.join(' ').includes('-F draft=false') && args.join(' ').includes('-f make_latest=true'));
      state.draft = false;
      return '{}';
    }
    throw new Error('unexpected gh ' + args.join(' '));
  };
  return state;
}
const run = (gh, opts = {}) => {
  const lines = [];
  return publish({ gh: gh.gh, ask: async () => opts.answer || 'y', log: (m) => lines.push(m), keyPath: goodKey, repo: 'o/r', workDir: fs.mkdtempSync(path.join(TMP, 'w-')), trustedKeys: [trusted.publicKeyBase64], ...opts })
    .then((r) => ({ ...r, lines }));
};

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — release.bat (sign and publish)');
console.log('══════════════════════════════════════════════════════\n');

(async () => {
  await test('the newest plain vX.Y.Z draft is chosen (1.2.0 over the old 1.1.6 draft), published releases never', () => {
    const list = [['v1.1.6', true], ['v1.10.0', true], ['v1.9.9', true], ['v2.0.0', false], ['v3.0.0-beta', true]].map(([tag_name, draft]) => ({ tag_name, draft }));
    assert(pickDraft(list).tag_name === 'v1.10.0');
    assert(pickDraft(list, 'v1.1.6').tag_name === 'v1.1.6' && pickDraft(list, 'v2.0.0') === null && pickDraft([]) === null);
  });

  await test('the hash is read from SHA256SUMS.txt for exactly that file; a dragged path loses its quotes', () => {
    const h = 'a'.repeat(64);
    assert(expectedHash(`${h}  SHMMOTH-Browser-Setup-1.2.0.exe\r\n`, 'SHMMOTH-Browser-Setup-1.2.0.exe') === h);
    assert(expectedHash(`${h}  SHMMOTH-Browser-Setup-1.2.0.exe`, 'SHMMOTH-Browser-Setup-1.2.01.exe') === null);
    assert(cleanPath(' "C:\\Users\\me\\release-signing-key.pem" ') === 'C:\\Users\\me\\release-signing-key.pem');
  });

  await test('a full run downloads, checks the hash, signs, uploads a .sig that the app accepts, and publishes', async () => {
    const gh = fakeGh();
    const r = await run(gh);
    assert(r.published && r.tag === 'v1.2.0' && gh.draft === false, 'published');
    const hash = crypto.createHash('sha256').update(gh.exe).digest('hex');
    const v = sig.verifyUpdateSignature({ assetName: gh.file, size: gh.exe.length, sha256: hash, signatureFileText: gh.uploaded, publicKeys: [trusted.publicKeyBase64] });
    assert(v.ok, 'the uploaded .sig verifies: ' + v.reason);
    const order = gh.calls.map((c) => (c.includes('-X') ? c[c.indexOf('-X') + 1] : 'GET')).join(',');
    assert(order === 'GET,GET,GET,POST,PATCH', order);
  });

  await test('the private key never leaves the PC: it is in no gh call, no message, and not in the uploaded .sig', async () => {
    const gh = fakeGh();
    const r = await run(gh);
    const pemBody = trusted.privateKeyPem.split('\n').filter((l) => l && !l.startsWith('-----')).join('');
    const everything = JSON.stringify(gh.calls) + r.lines.join('\n') + gh.uploaded;
    assert(!everything.includes(pemBody) && !/PRIVATE KEY/.test(everything), 'key material leaked');
    assert(!gh.calls.some((c) => c.some((a) => a.includes('.pem'))), 'the key file was handed to gh');
  });

  await test('answering "n" leaves it a draft (with its .sig); nothing is published', async () => {
    const gh = fakeGh();
    const r = await run(gh, { answer: 'n' });
    assert(!r.published && gh.draft === true && gh.uploaded, 'still a draft');
    assert(!gh.calls.some((c) => c.includes('PATCH')));
  });

  await test('running it again after "n" replaces the earlier .sig instead of failing on the duplicate name', async () => {
    const gh = fakeGh({ oldSig: true });
    const r = await run(gh);
    assert(r.published && gh.deleted.join() === '13' && gh.uploaded);
  });

  await test('a key the app does not trust, or a file that is no key, is refused before GitHub is touched', async () => {
    for (const keyPath of [otherKey, notAKey]) {
      const gh = fakeGh();
      let err = null;
      try { await run(gh, { keyPath }); } catch (e) { err = e; }
      assert(err && /not the one built into|not a signing key/.test(err.message), String(err && err.message));
      assert(gh.calls.length === 0, 'gh was called');
    }
  });

  await test('no key next to release.bat: it asks for the file (drag into the window) and uses the answer', async () => {
    const gh = fakeGh();
    const asked = [];
    const r = await publish({ gh: gh.gh, ask: async (q) => { asked.push(q); return asked.length === 1 ? `"${goodKey}"` : 'y'; }, log: () => {}, keyPath: path.join(TMP, 'missing.pem'), repo: 'o/r', workDir: fs.mkdtempSync(path.join(TMP, 'w-')), trustedKeys: [trusted.publicKeyBase64] });
    assert(r.published && /Drag release-signing-key\.pem/.test(asked[0]));
  });

  await test('an installer whose SHA-256 differs from the build, or that SHA256SUMS.txt does not list, is never signed', async () => {
    for (const sums of [`${'0'.repeat(64)}  SHMMOTH-Browser-Setup-1.2.0.exe\n`, '']) {
      const gh = fakeGh({ sums });
      let err = null;
      try { await run(gh); } catch (e) { err = e; }
      assert(err && /is not the one the build reported|does not list/.test(err.message), String(err && err.message));
      assert(!gh.uploaded && gh.draft, 'signed or published anyway');
    }
  });

  await test('release.bat runs the script from its own folder, passes the dragged file, and keeps the window open', () => {
    const bat = read('release.bat');
    assert(/\r\n/.test(bat), 'CRLF line ends (cmd.exe)');
    assert(/cd \/d "%~dp0"/.test(bat) && /node scripts\\release-publish\.js %\*/.test(bat) && /\npause/.test(bat));
    assert(JSON.parse(read('package.json')).scripts['release:publish'] === 'node scripts/release-publish.js');
    assert(!JSON.parse(read('package.json')).build.files.some((f) => /release|scripts/.test(f)), 'the tool is not packaged into the app');
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
})();
