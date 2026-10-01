/**
 * SHMMOTH BROWSER — P0 UPDATER HARDENING TESTS
 *
 * The updater must never run an installer that is not provably authentic.
 * Every scenario below is something that could happen to a GitHub-hosted release.
 *
 * Run with: node tests/p0-updater.test.js
 */

'use strict';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
  catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth_p0_upd_'));
let dirCounter = 0;
const freshDir = () => { const d = path.join(TMP, 'd' + (++dirCounter)); fs.mkdirSync(d, { recursive: true }); return d; };

const sig = require('../src/services/updateSignature');
const UpdateManager = require('../src/services/updateManager');

const OWNER = 'jaydipvirja', REPO = 'shmmoth-browser';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const dlUrl = (tag, name) => `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${name}`;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const KEYS = { main: sig.generateKeyPair(), attacker: sig.generateKeyPair(), next: sig.generateKeyPair() };

// ── A tiny in-memory "GitHub" ────────────────────────────────────────────────
function resp(r) {
  const body = r.body || Buffer.alloc(0);
  const chunks = []; for (let i = 0; i < body.length; i += 65536) chunks.push(body.subarray(i, i + 65536));
  return {
    statusCode: r.status || 200,
    headers: { 'content-length': String(r.contentLength !== undefined ? r.contentLength : body.length) },
    stream: Readable.from(chunks),
    abort() {}
  };
}
function makeFetcher(routes) {
  const requested = [];
  return {
    requested,
    async get(url, { validateUrl } = {}) {
      let current = url;
      for (let hop = 0; hop < 6; hop++) {
        if (validateUrl) validateUrl(current);
        requested.push(current);
        const r = routes[current];
        if (!r) return resp({ status: 404 });
        if (r.redirect) { current = r.redirect; continue; }
        if (r.throws) throw new Error(r.throws);
        return resp(r);
      }
      throw new Error('Too many redirects');
    }
  };
}

/** Builds a release + the routes serving it. Options let each test break one thing. */
function buildWorld(o = {}) {
  const version = o.version || '1.0.17';
  const tag = o.tag || 'v' + version;
  const name = o.assetName || `SHMMOTH-Browser-Setup-${version}.exe`;
  const installer = o.installerBytes || crypto.randomBytes(300 * 1024 + 17);
  const served = o.servedBytes || installer;                          // what the download actually returns
  const signedBy = o.signWith || KEYS.main;
  const sigText = o.sigText !== undefined ? o.sigText
    : sig.signUpdate({ assetName: o.signedName || name, size: installer.length, sha256: sha(installer), privateKeyPem: signedBy.privateKeyPem });

  const assets = [];
  const routes = {};
  if (!o.noInstaller) {
    assets.push({ name, size: o.announcedSize || served.length, digest: o.digest !== undefined ? o.digest : 'sha256:' + sha(served),
                  browser_download_url: o.installerUrl || dlUrl(tag, name) });
    routes[dlUrl(tag, name)] = o.installerRoute || { redirect: 'https://release-assets.githubusercontent.com/x/' + name };
    routes['https://release-assets.githubusercontent.com/x/' + name] = { body: served, contentLength: o.contentLength };
    if (o.installerUrl) routes[o.installerUrl] = { body: served };
  }
  if (!o.noSig) {
    assets.push({ name: name + '.sig', size: sigText.length, browser_download_url: dlUrl(tag, name + '.sig') });
    routes[dlUrl(tag, name + '.sig')] = { body: Buffer.from(sigText) };
  }
  const release = Object.assign({
    tag_name: tag, draft: false, prerelease: false,
    html_url: `https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`, assets
  }, o.releaseOverrides || {});
  routes[API] = { body: Buffer.from(typeof o.releaseRaw === 'string' ? o.releaseRaw : JSON.stringify(release)) };
  return { routes, installer, served, name, version, sigText };
}

function newManager(world, extra = {}) {
  const fetcher = makeFetcher(world.routes);
  const launched = [];
  const quits = [];
  const mgr = new UpdateManager({
    fetcher,
    publicKeys: extra.publicKeys !== undefined ? extra.publicKeys : [KEYS.main.publicKeyBase64],
    updatesDir: extra.updatesDir || path.join(freshDir(), 'updates'),
    launcher: async (p) => { launched.push(p); return extra.launchError || ''; },
    quitApp: () => quits.push(1)
  });
  mgr._status.currentVersion = extra.currentVersion || '1.0.16';
  return { mgr, fetcher, launched, quits };
}

/** checkForUpdates() starts the download in the background; wait until it settles. */
async function checkAndSettle(mgr) {
  await mgr.checkForUpdates();
  for (let i = 0; i < 200 && (mgr.isDownloading || mgr.getStatus().status === 'checking'); i++) await sleep(10);
  await sleep(20);
  return mgr.getStatus();
}
const filesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

(async () => {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SHMMOTH Browser — P0 Updater Hardening Tests         ');
  console.log('══════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('📋 1. updateSignature.js');
  // ═══════════════════════════════════════════════════════════════════════════
  const msgArgs = { assetName: 'SHMMOTH-Browser-Setup-1.0.17.exe', size: 1234, sha256: 'a'.repeat(64) };

  await test('sign → verify round trip (base64 SPKI key and PEM key both accepted)', async () => {
    const text = sig.signUpdate({ ...msgArgs, privateKeyPem: KEYS.main.privateKeyPem });
    assert(sig.verifyUpdateSignature({ ...msgArgs, signatureFileText: text, publicKeys: [KEYS.main.publicKeyBase64] }).ok);
    const pem = require('crypto').createPublicKey({ key: Buffer.from(KEYS.main.publicKeyBase64, 'base64'), format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' });
    assert(sig.verifyUpdateSignature({ ...msgArgs, signatureFileText: text, publicKeys: [pem] }).ok);
  });

  await test('signature is bound to file name, size and hash', async () => {
    const text = sig.signUpdate({ ...msgArgs, privateKeyPem: KEYS.main.privateKeyPem });
    const keys = [KEYS.main.publicKeyBase64];
    assert(!sig.verifyUpdateSignature({ ...msgArgs, assetName: 'SHMMOTH-Browser-Setup-1.0.18.exe', signatureFileText: text, publicKeys: keys }).ok, 'name');
    assert(!sig.verifyUpdateSignature({ ...msgArgs, size: 1235, signatureFileText: text, publicKeys: keys }).ok, 'size');
    assert(!sig.verifyUpdateSignature({ ...msgArgs, sha256: 'b'.repeat(64), signatureFileText: text, publicKeys: keys }).ok, 'hash');
  });

  await test('wrong key, no keys, malformed / oversized / wrong-algorithm signature files are all rejected', async () => {
    const good = sig.signUpdate({ ...msgArgs, privateKeyPem: KEYS.main.privateKeyPem });
    assert(!sig.verifyUpdateSignature({ ...msgArgs, signatureFileText: good, publicKeys: [KEYS.attacker.publicKeyBase64] }).ok);
    assert(!sig.verifyUpdateSignature({ ...msgArgs, signatureFileText: good, publicKeys: [] }).ok);
    for (const bad of ['', 'not json', '{}', JSON.stringify({ version: 1, algorithm: 'rsa', signature: 'AA==' }),
                       JSON.stringify({ version: 1, algorithm: 'ed25519', signature: 'AAAA' }), 'x'.repeat(10000)]) {
      assert(!sig.verifyUpdateSignature({ ...msgArgs, signatureFileText: bad, publicKeys: [KEYS.main.publicKeyBase64] }).ok, 'accepted: ' + bad.slice(0, 20));
    }
  });

  await test('a garbage entry in the key list does not break verification with the other keys', async () => {
    const text = sig.signUpdate({ ...msgArgs, privateKeyPem: KEYS.next.privateKeyPem });
    const v = sig.verifyUpdateSignature({ ...msgArgs, signatureFileText: text, publicKeys: ['%%%not a key%%%', KEYS.next.publicKeyBase64] });
    assert(v.ok && v.keyIndex === 1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 2. Happy path');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('a correctly signed release is downloaded, verified and installable', async () => {
    const w = buildWorld(); const { mgr, launched, quits } = newManager(w);
    const st = await checkAndSettle(mgr);
    assert(st.status === 'downloaded', 'status=' + st.status + ' ' + (st.error || ''));
    assert(st.autoInstall === true && st.availableVersion === '1.0.17');
    const v = mgr.verifiedUpdate;
    assert(v && fs.readFileSync(v.path).equals(w.installer), 'installer on disk must equal the signed one');
    assert(!filesIn(path.dirname(v.path)).some(n => n.endsWith('.part')), '.part file left behind');
    const ok = await mgr.quitAndInstall();
    assert(ok === true && launched.join() === v.path, 'installer was not launched');
    await sleep(900);
    assert(quits.length === 1, 'app should quit after launching the installer');
  });

  await test('key rotation: a release signed with the NEW key is accepted while both keys are trusted', async () => {
    const w = buildWorld({ signWith: KEYS.next });
    const { mgr } = newManager(w, { publicKeys: [KEYS.main.publicKeyBase64, KEYS.next.publicKeyBase64] });
    assert((await checkAndSettle(mgr)).status === 'downloaded');
  });

  await test('download goes through a trusted CDN redirect (githubusercontent.com)', async () => {
    const w = buildWorld(); const { mgr, fetcher } = newManager(w);
    await checkAndSettle(mgr);
    assert(fetcher.requested.some(u => u.startsWith('https://release-assets.githubusercontent.com/')));
  });

  await test('a verified update is not downloaded again when the user checks twice', async () => {
    const w = buildWorld(); const { mgr, fetcher } = newManager(w);
    await checkAndSettle(mgr);
    const downloads = () => fetcher.requested.filter(u => u.includes('githubusercontent.com')).length;
    const before = downloads();
    const st = await checkAndSettle(mgr);
    assert(st.status === 'downloaded' && downloads() === before, 'downloaded again');
  });

  await test('concurrent checks are collapsed into one', async () => {
    const w = buildWorld({ version: '1.0.16' }); const { mgr, fetcher } = newManager(w);
    await Promise.all([mgr.checkForUpdates(), mgr.checkForUpdates(), mgr.checkForUpdates()]);
    assert(fetcher.requested.filter(u => u === API).length === 1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 3. Attacks on the release (all must be rejected, nothing may run)');
  // ═══════════════════════════════════════════════════════════════════════════

  async function expectRejected(world, extra, messagePattern) {
    const { mgr, launched } = newManager(world, extra);
    const st = await checkAndSettle(mgr);
    assert(st.status === 'error', `status=${st.status} (${st.message})`);
    if (messagePattern) assert(messagePattern.test(st.message), 'message: ' + st.message);
    assert(mgr.verifiedUpdate === null, 'verifiedUpdate must be null');
    const dir = mgr._updatesDir;
    assert(filesIn(dir).length === 0, 'files left in updates dir: ' + filesIn(dir));
    assert((await mgr.quitAndInstall()) === false && launched.length === 0, 'installer must never be launched');
  }

  await test('ATTACK: installer replaced by malware, GitHub digest updated to match (the v1.0.16 scenario)', async () => {
    const malware = crypto.randomBytes(300 * 1024 + 17);
    // signature + .sig are the legitimate ones; the .exe and its digest are the attacker's
    const real = buildWorld();
    const w = buildWorld({ installerBytes: real.installer, servedBytes: malware, sigText: real.sigText });
    await expectRejected(w, {}, /invalid signature/i);
  });

  await test('ATTACK: attacker replaces installer AND signature (signed with their own key)', async () => {
    await expectRejected(buildWorld({ signWith: KEYS.attacker }), {}, /invalid signature/i);
  });

  await test('ATTACK: replay of an old signed installer as a new version', async () => {
    const old = buildWorld({ version: '1.0.15' });
    // attacker publishes the old (validly signed) bytes + sig under the name/tag of a newer release
    const w = buildWorld({ version: '1.0.99', installerBytes: old.installer, sigText: old.sigText });
    await expectRejected(w, {}, /invalid signature/i);
  });

  await test('ATTACK: signature made for a different file name', async () => {
    await expectRejected(buildWorld({ signedName: 'SHMMOTH-Browser-Setup-1.0.16.exe' }), {}, /invalid signature/i);
  });

  await test('CORRUPTION: download does not match the published checksum', async () => {
    await expectRejected(buildWorld({ digest: 'sha256:' + 'f'.repeat(64) }), {}, /checksum/i);
  });

  await test('size: Content-Length differs from the release metadata', async () => {
    await expectRejected(buildWorld({ contentLength: 12345 }), {}, /size/i);
  });

  await test('size: body is larger than announced', async () => {
    const big = crypto.randomBytes(400 * 1024);
    const w = buildWorld({ installerBytes: big, announcedSize: 300 * 1024 });
    await expectRejected(w, {}, /larger than announced|size/i);
  });

  await test('size: body is shorter than announced (truncated download)', async () => {
    const full = crypto.randomBytes(300 * 1024);
    const w = buildWorld({ installerBytes: full, servedBytes: full.subarray(0, 100 * 1024), announcedSize: full.length, digest: null, contentLength: full.length });
    await expectRejected(w, {}, /incomplete|invalid signature/i);
  });

  await test('redirect to an untrusted host is refused', async () => {
    const w = buildWorld({ installerRoute: { redirect: 'https://evil.example.com/malware.exe' } });
    await expectRejected(w, {}, /untrusted host/i);
  });

  await test('http:// download URL is refused', async () => {
    const w = buildWorld({ installerRoute: { redirect: 'http://github.com/x.exe' } });
    await expectRejected(w, {}, /HTTPS/i);
  });

  await test('asset whose download URL is not the release\'s own URL is refused', async () => {
    const w = buildWorld({ installerUrl: 'https://github.com/someone-else/other-repo/releases/download/v1.0.17/SHMMOTH-Browser-Setup-1.0.17.exe' });
    await expectRejected(w, {}, /unexpected download URL|release/i);
  });

  await test('non-semver / pre-release / draft / garbage release documents are refused', async () => {
    await expectRejected(buildWorld({ tag: 'v1.0.17-beta1' }), {}, /version tag/i);
    await expectRejected(buildWorld({ tag: 'latest' }), {}, /version tag/i);
    await expectRejected(buildWorld({ releaseOverrides: { prerelease: true } }), {}, /final release/i);
    await expectRejected(buildWorld({ releaseOverrides: { draft: true } }), {}, /final release/i);
    await expectRejected(buildWorld({ releaseRaw: '<html>not json</html>' }), {}, /invalid data/i);
    await expectRejected(buildWorld({ releaseRaw: 'null' }), {}, /unexpected/i);
  });

  await test('network failures surface as an error status, not a crash', async () => {
    const w = buildWorld(); w.routes[API] = { throws: 'ECONNRESET' };
    const { mgr } = newManager(w);
    const st = await checkAndSettle(mgr);
    assert(st.status === 'error');
  });

  await test('HTTP error from the download server is an error', async () => {
    const w = buildWorld(); w.routes['https://release-assets.githubusercontent.com/x/SHMMOTH-Browser-Setup-1.0.17.exe'] = { status: 503 };
    await expectRejected(w, {}, /HTTP 503/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 4. Fail closed when it cannot be installed automatically');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('no signing key compiled into the app → announces the update but downloads/runs nothing', async () => {
    const { mgr, fetcher, launched } = newManager(buildWorld(), { publicKeys: [] });
    const st = await checkAndSettle(mgr);
    assert(st.status === 'available' && st.autoInstall === false && /releases page/i.test(st.message), JSON.stringify(st));
    assert(st.manualDownloadUrl === `https://github.com/${OWNER}/${REPO}/releases/tag/v1.0.17`);
    assert(!fetcher.requested.some(u => u.includes('githubusercontent.com')), 'must not download the installer');
    assert((await mgr.quitAndInstall()) === false && launched.length === 0);
  });

  await test('release without a .sig asset → announced but not installed automatically', async () => {
    const { mgr, fetcher } = newManager(buildWorld({ noSig: true }));
    const st = await checkAndSettle(mgr);
    assert(st.status === 'available' && st.autoInstall === false && /not signed/i.test(st.message), JSON.stringify(st));
    assert(!fetcher.requested.some(u => u.includes('githubusercontent.com')));
  });

  await test('release without any installer asset → points to the releases page', async () => {
    const { mgr } = newManager(buildWorld({ noInstaller: true, noSig: true }));
    const st = await checkAndSettle(mgr);
    assert(st.status === 'available' && st.autoInstall === false);
  });

  await test('same or older version → up to date (no downgrade)', async () => {
    for (const v of ['1.0.16', '1.0.15', '0.9.0']) {
      const { mgr } = newManager(buildWorld({ version: v }), { currentVersion: '1.0.16' });
      assert((await checkAndSettle(mgr)).status === 'not-available', v);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 5. Between download and install');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('ATTACK: installer swapped on disk after verification → refused, deleted, never launched', async () => {
    const w = buildWorld(); const { mgr, launched } = newManager(w);
    assert((await checkAndSettle(mgr)).status === 'downloaded');
    const p = mgr.verifiedUpdate.path;
    fs.writeFileSync(p, Buffer.concat([w.installer.subarray(0, 1000), Buffer.from('MALWARE'), w.installer.subarray(1007)]));
    const ok = await mgr.quitAndInstall();
    assert(ok === false && launched.length === 0, 'tampered installer was launched');
    assert(!fs.existsSync(p), 'tampered installer must be deleted');
    const st = mgr.getStatus();
    assert(st.status === 'error' && /integrity check/i.test(st.message), st.message);
  });

  await test('installer deleted between download and install → refused cleanly', async () => {
    const w = buildWorld(); const { mgr, launched } = newManager(w);
    await checkAndSettle(mgr);
    fs.rmSync(mgr.verifiedUpdate.path);
    assert((await mgr.quitAndInstall()) === false && launched.length === 0);
  });

  await test('quitAndInstall without any verified update does nothing', async () => {
    const { mgr, launched } = newManager(buildWorld());
    assert((await mgr.quitAndInstall()) === false && launched.length === 0);
  });

  await test('launcher failure is reported and the app does not quit', async () => {
    const w = buildWorld(); const { mgr, quits } = newManager(w, { launchError: 'Access is denied' });
    await checkAndSettle(mgr);
    assert((await mgr.quitAndInstall()) === false);
    await sleep(900);
    assert(quits.length === 0 && mgr.getStatus().status === 'error');
  });

  await test('stale installers in the updates folder are removed when a new download starts', async () => {
    const dir = path.join(freshDir(), 'updates'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SHMMOTH-Browser-Setup-1.0.1.exe'), 'old'); fs.writeFileSync(path.join(dir, 'junk.part'), 'x');
    const { mgr } = newManager(buildWorld(), { updatesDir: dir });
    await checkAndSettle(mgr);
    assert(filesIn(dir).join() === 'SHMMOTH-Browser-Setup-1.0.17.exe', filesIn(dir).join());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 6. Release tool (scripts/release-tool.js)');
  // ═══════════════════════════════════════════════════════════════════════════

  const tool = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'release-tool.js'), ...args], { encoding: 'utf8' });

  await test('keygen → sign → verify works end-to-end and the app-side verifier accepts the result', async () => {
    const dir = freshDir(); const keyFile = path.join(dir, 'k.pem');
    const gen = tool('keygen', '--out', keyFile);
    assert(gen.status === 0 && fs.existsSync(keyFile), gen.stderr);
    const pub = /'([A-Za-z0-9+/=]{20,})'/.exec(gen.stdout)[1];
    assert(!gen.stdout.includes('PRIVATE KEY'), 'private key must not be printed');
    const exe = path.join(dir, 'SHMMOTH-Browser-Setup-9.9.9.exe'); fs.writeFileSync(exe, crypto.randomBytes(5000));
    const signed = tool('sign', exe, '--key', keyFile);
    assert(signed.status === 0 && fs.existsSync(exe + '.sig'), signed.stderr + signed.stdout);
    assert(tool('verify', exe, '--pubkey', pub).status === 0, 'verify failed');
    const { sha256, size } = await sig.hashFile(exe);
    assert(sig.verifyUpdateSignature({ assetName: path.basename(exe), size, sha256, signatureFileText: fs.readFileSync(exe + '.sig', 'utf8'), publicKeys: [pub] }).ok);
    fs.appendFileSync(exe, 'x');                                              // modify the installer → verify must fail
    assert(tool('verify', exe, '--pubkey', pub).status !== 0, 'tampered installer verified');
  });

  await test('keygen refuses to overwrite an existing key; sign refuses wrong file names / missing key', async () => {
    const dir = freshDir(); const keyFile = path.join(dir, 'k.pem');
    assert(tool('keygen', '--out', keyFile).status === 0);
    assert(tool('keygen', '--out', keyFile).status !== 0, 'overwrote key');
    const bad = path.join(dir, 'setup.exe'); fs.writeFileSync(bad, 'x');
    assert(tool('sign', bad, '--key', keyFile).status !== 0, 'signed a wrongly named file');
    const good = path.join(dir, 'SHMMOTH-Browser-Setup-1.2.3.exe'); fs.writeFileSync(good, 'x');
    assert(tool('sign', good, '--key', path.join(dir, 'missing.pem')).status !== 0);
  });

  if (process.platform !== 'win32') {
    await test('private key file is created readable by the owner only', async () => {
      const keyFile = path.join(freshDir(), 'k.pem'); tool('keygen', '--out', keyFile);
      assert((fs.statSync(keyFile).mode & 0o077) === 0, 'mode ' + (fs.statSync(keyFile).mode & 0o777).toString(8));
    });
  }

  await test('the REAL GitHub v1.0.16 release document (fixture) is parsed correctly', async () => {
    const real = fs.readFileSync(path.join(__dirname, 'fixtures', 'github-release-v1.0.16.json'), 'utf8');
    // current 1.0.15 → 1.0.16 is newer, but that release has no .sig (published before signing existed)
    const w = buildWorld(); w.routes[API] = { body: Buffer.from(real) };
    const { mgr, fetcher } = newManager(w, { currentVersion: '1.0.15' });
    const st = await checkAndSettle(mgr);
    assert(st.status === 'available' && st.autoInstall === false && /not signed/i.test(st.message), JSON.stringify(st));
    assert(st.availableVersion === '1.0.16' && st.manualDownloadUrl.endsWith('/releases/tag/v1.0.16'));
    assert(!fetcher.requested.some(u => u.endsWith('.exe')), 'must not download an unsigned installer');
    const { mgr: same } = newManager(w, { currentVersion: '1.0.16' });
    assert((await checkAndSettle(same)).status === 'not-available');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 7. Source invariants');
  // ═══════════════════════════════════════════════════════════════════════════
  const SRC = path.join(__dirname, '..', 'src');
  const um = fs.readFileSync(path.join(SRC, 'services', 'updateManager.js'), 'utf8');
  const code = um.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  await test('the updater no longer uses Node http/https (so it cannot bypass the browser proxy)', async () => {
    assert(!/require\(\s*['"]https?['"]\s*\)/.test(code), 'updateManager requires http/https');
    assert(/createElectronFetcher/.test(code));
    const f = fs.readFileSync(path.join(SRC, 'services', 'updateFetch.js'), 'utf8');
    assert(/net\.request/.test(f) && /session\.defaultSession/.test(f) && /redirect:\s*'manual'/.test(f));
  });

  await test('the installer is launched from exactly one place, after the re-hash', async () => {
    assert((code.match(/\.openPath\(/g) || []).length === 1 && (code.match(/\bspawn\(/g) || []).length === 1);
    assert(code.indexOf('hashFile(v.path)') < code.indexOf('this._launch(v.path)'));
  });

  await test('Settings no longer links to a hard-coded old installer', async () => {
    const js = fs.readFileSync(path.join(SRC, 'pages', 'settings.js'), 'utf8');
    const html = fs.readFileSync(path.join(SRC, 'pages', 'settings.html'), 'utf8');
    assert(!/1\.0\.10/.test(js) && !/1\.0\.10/.test(html) && !/Setup-\d/.test(js));
  });

  await test('private key files are git-ignored and release scripts are registered', async () => {
    const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    assert(/release-signing-key/.test(gi) && /\*\.pem/.test(gi));
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    for (const s of ['release:keygen', 'release:sign', 'release:verify']) assert(pkg.scripts[s], s);
    assert(!pkg.build.files.some(f => /scripts|\.pem/.test(f)), 'scripts/keys must not be packaged');
  });

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
})();
