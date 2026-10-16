#!/usr/bin/env node
/**
 * RELEASE PUBLISH — scripts/release-publish.js (started by release.bat)
 *
 * Signs and publishes the newest DRAFT release in one go, on the publisher's PC:
 *   1. finds the newest draft vX.Y.Z on GitHub (or the one given with --tag)
 *   2. downloads its installer and SHA256SUMS.txt, and checks the installer's SHA-256
 *   3. signs it with the private key (release-signing-key.pem) and checks the signature with the keys built into the
 *      app; a key the app does not trust is refused
 *   4. uploads the .sig, asks once, and publishes the release
 *
 * The private key is only read from the file and used here: it is never printed, copied, uploaded or sent anywhere.
 * Needs the GitHub CLI (https://cli.github.com), signed in once with "gh auth login".
 *
 *   release.bat                       (key next to it: release-signing-key.pem)
 *   drag the key file onto release.bat
 *   node scripts/release-publish.js [<key file>] [--tag vX.Y.Z] [--yes]
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const sig = require('../src/services/updateSignature');
const { UPDATE_PUBLIC_KEYS } = require('../src/services/updateKeys');
const { publicKeyBase64FromPrivatePem } = require('./release-tool');

const ROOT = path.join(__dirname, '..');
const DEFAULT_KEY_FILE = path.join(ROOT, 'release-signing-key.pem');
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function repoName() {
  const pub = (require('../package.json').build.publish || [])[0] || {};
  return `${pub.owner}/${pub.repo}`;
}

/** The newest draft with a plain vX.Y.Z tag, from GET /repos/{repo}/releases; null when there is none. */
function pickDraft(releases, wanted) {
  const drafts = (releases || []).filter((r) => r && r.draft && TAG.test(r.tag_name));
  if (wanted) return drafts.find((r) => r.tag_name === wanted) || null;
  const num = (t) => TAG.exec(t).slice(1).map(Number);
  drafts.sort((a, b) => { const x = num(a.tag_name), y = num(b.tag_name); return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); });
  return drafts[0] || null;
}

/** The SHA-256 that SHA256SUMS.txt lists for `file`; null when it is not listed. */
function expectedHash(sums, file) {
  for (const line of String(sums || '').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (m && m[2] === file) return m[1].toLowerCase();
  }
  return null;
}

/** A path typed or dragged into the window: surrounding quotes and spaces removed. */
function cleanPath(p) {
  return String(p || '').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

/**
 * Does the whole job. `gh(args)` runs the GitHub CLI and returns its output, `ask(question)` returns the answer typed,
 * `log` prints. Returns { published, tag }. Throws on any problem, before anything is published.
 */
async function publish({ gh, ask, log, keyPath, tag, yes, repo, workDir, trustedKeys = UPDATE_PUBLIC_KEYS }) {
  // The key first: a missing or untrusted key stops before anything is downloaded or changed
  if (!keyPath || !fs.existsSync(keyPath)) keyPath = cleanPath(await ask('Drag release-signing-key.pem into this window and press Enter: '));
  if (!keyPath || !fs.existsSync(keyPath)) throw new Error('No key file at ' + (keyPath || '(nothing given)'));
  const pem = fs.readFileSync(keyPath, 'utf8');
  let ownPublic;
  try { ownPublic = publicKeyBase64FromPrivatePem(pem); } catch (_) { throw new Error('That file is not a signing key (release-signing-key.pem)'); }
  if (!trustedKeys.includes(ownPublic)) throw new Error('This key is not the one built into SHMMOTH Browser (src/services/updateKeys.js): installed browsers would refuse the update. Use the release-signing-key.pem made with "npm run release:keygen".');
  log('✔ Signing key found and trusted by the app');

  // GitHub's REST API through the GitHub CLI (`gh api`), which handles the sign-in
  const list = JSON.parse(String(gh(['api', `repos/${repo}/releases?per_page=30`])) || '[]');
  const draft = pickDraft(list, tag);
  if (!draft) throw new Error(tag ? `No draft release ${tag} on GitHub` : 'No draft release on GitHub. Start one first: Actions → Release (draft) → Run workflow');
  const version = draft.tag_name.slice(1);
  const file = `SHMMOTH-Browser-Setup-${version}.exe`;
  const asset = (name) => (draft.assets || []).find((x) => x.name === name);
  log(`✔ Draft release ${draft.tag_name}`);

  fs.mkdirSync(workDir, { recursive: true });
  const download = (name) => {
    const a = asset(name);
    if (!a) throw new Error(`The draft has no ${name}`);
    const to = path.join(workDir, name);
    fs.writeFileSync(to, gh(['api', '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${a.id}`], { binary: true }));
    return to;
  };
  const installer = download(file);
  const sumsFile = download('SHA256SUMS.txt');

  const want = expectedHash(fs.readFileSync(sumsFile, 'utf8'), file);
  if (!want) throw new Error(`SHA256SUMS.txt of the draft does not list ${file}`);
  const { sha256, size } = await sig.hashFile(installer);
  if (sha256 !== want) throw new Error(`The downloaded installer's SHA-256 (${sha256}) is not the one the build reported (${want}). Nothing was signed.`);
  log(`✔ Downloaded ${file} (${(size / 1048576).toFixed(1)} MB), SHA-256 matches the build: ${sha256}`);

  const sigText = sig.signUpdate({ assetName: file, size, sha256, privateKeyPem: pem });
  const check = sig.verifyUpdateSignature({ assetName: file, size, sha256, signatureFileText: sigText, publicKeys: trustedKeys });
  if (!check.ok) throw new Error('The new signature does not verify (' + check.reason + ')');
  const sigPath = installer + '.sig';
  fs.writeFileSync(sigPath, sigText);
  log(`✔ Signed, and the signature verifies with the app's key`);

  const old = asset(file + '.sig');                  // from an earlier run that was not published
  if (old) gh(['api', '-X', 'DELETE', `repos/${repo}/releases/assets/${old.id}`]);
  gh(['api', '-X', 'POST', '-H', 'Content-Type: application/octet-stream', '--input', sigPath,
    `https://uploads.github.com/repos/${repo}/releases/${draft.id}/assets?name=${encodeURIComponent(file + '.sig')}`]);
  log(`✔ Uploaded ${file}.sig to the draft`);

  const answer = yes ? 'y' : String(await ask(`\nPublish SHMMOTH Browser ${version} now? Every installed browser will be offered the update. (y/n): `)).trim().toLowerCase();
  if (!/^(y|yes|ha|haa|h)$/.test(answer)) { log('Not published. The draft (with its .sig) stays as it is; run this again to publish.'); return { published: false, tag: draft.tag_name }; }
  gh(['api', '-X', 'PATCH', '-F', 'draft=false', '-f', 'make_latest=true', `repos/${repo}/releases/${draft.id}`]);
  log(`\n✔ SHMMOTH Browser ${version} is published: https://github.com/${repo}/releases/tag/${draft.tag_name}`);
  return { published: true, tag: draft.tag_name };
}

function runGh(args, { binary = false } = {}) {
  try {
    return execFileSync('gh', args, { encoding: binary ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024 });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('The GitHub CLI is not installed. Install it from https://cli.github.com, run "gh auth login" once, then run this again.');
    const detail = String(err.stderr || err.message).trim();
    if (/auth login|not logged|authentication/i.test(detail)) throw new Error('The GitHub CLI is not signed in. Run "gh auth login" once, then run this again.');
    throw new Error(`GitHub refused ${args.filter((a) => !a.startsWith('-')).slice(1, 2).join(' ')}: ${detail}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const tag = flag('--tag');
  if (tag && !TAG.test(tag)) throw new Error('--tag must look like v1.2.3');
  const given = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--tag');
  const keyPath = given ? path.resolve(cleanPath(given)) : DEFAULT_KEY_FILE;
  const readline = require('readline');
  const ask = (q) => new Promise((resolve) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); resolve(a); }); });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth-release-'));
  console.log('\nSHMMOTH Browser — sign and publish the draft release\n');
  try {
    await publish({ gh: runGh, ask, log: (m) => console.log(m), keyPath, tag, yes: args.includes('--yes'), repo: repoName(), workDir });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('\n✖ ' + err.message + '\n'); process.exit(1); });
}

module.exports = { publish, pickDraft, expectedHash, cleanPath };
