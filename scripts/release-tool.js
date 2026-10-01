#!/usr/bin/env node
/**
 * RELEASE TOOL — scripts/release-tool.js
 *
 * Creates and checks the update signatures the browser requires before it installs an update.
 * See docs/releasing.md.
 *
 *   npm run release:keygen                       one-time: create the signing key pair
 *   npm run release:sign   -- <installer.exe>    after building: writes <installer.exe>.sig
 *   npm run release:verify -- <installer.exe>    check an installer + its .sig against the keys in the app
 *   npm run release:check  [-- --tag v1.2.3]     is the source ready to be released? (keys, version, changelog, icon)
 *   node scripts/release-tool.js notes <version> print that version's section of CHANGELOG.md (release notes)
 *
 * The PRIVATE key (release-signing-key.pem) must never be committed or uploaded to GitHub.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const sig = require('../src/services/updateSignature');
const { UPDATE_PUBLIC_KEYS } = require('../src/services/updateKeys');

const DEFAULT_KEY_FILE = path.join(__dirname, '..', 'release-signing-key.pem');
const INSTALLER_NAME = /^SHMMOTH-Browser-Setup-\d+\.\d+\.\d+\.exe$/;

function fail(msg) { console.error('\n✖ ' + msg + '\n'); process.exit(1); }
function flag(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

const VERSION = /^\d+\.\d+\.\d+$/;

/** True for the base64 SPKI DER of an Ed25519 public key (what keygen prints and updateKeys.js lists). */
function isValidPublicKey(b64) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(String(b64), 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519';
  } catch (_) {
    return false;
  }
}

/** The text under "## <version>" in CHANGELOG.md, up to the next "## " heading; null when there is none. */
function extractNotes(changelog, version) {
  const lines = String(changelog || '').split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+\\[?v?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

/**
 * Everything that would make a release useless or dangerous, found before anything is built:
 * - no (valid) trusted signing key compiled in: users who install this build could never accept a signed update again
 * - version / tag mismatch, or a version the updater would not accept
 */
function checkRelease({ version, tag, keys, changelog, files }) {
  const problems = [];
  if (!VERSION.test(String(version))) problems.push(`package.json version "${version}" is not a plain x.y.z version (the updater ignores anything else)`);
  if (tag !== undefined && tag !== `v${version}`) problems.push(`the tag "${tag}" does not match package.json version "${version}" (expected "v${version}")`);
  if (!Array.isArray(keys) || keys.length === 0) {
    problems.push('src/services/updateKeys.js lists no update-signing public key. A build without one can never install a signed update — run "npm run release:keygen" on your PC and paste the PUBLIC key in');
  } else {
    keys.forEach((k, i) => { if (!isValidPublicKey(k)) problems.push(`update key #${i + 1} in updateKeys.js is not a valid Ed25519 public key (base64 SPKI)`); });
  }
  if (VERSION.test(String(version)) && !extractNotes(changelog, version)) problems.push(`CHANGELOG.md has no "## ${version}" section with release notes`);
  for (const f of ['build/icon.ico', 'build/icon.png']) if (!(files || []).includes(f)) problems.push(`${f} is missing (app icon)`);
  return { ok: problems.length === 0, problems };
}

function publicKeyBase64FromPrivatePem(pem) {
  return crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'der' }).toString('base64');
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'keygen') {
    const out = path.resolve(flag(args, '--out') || DEFAULT_KEY_FILE);
    if (fs.existsSync(out)) fail(`${out} already exists. Refusing to overwrite a signing key.`);
    const { publicKeyBase64, privateKeyPem } = sig.generateKeyPair();
    fs.writeFileSync(out, privateKeyPem, { mode: 0o600 });
    console.log(`\n✔ Private signing key written to:\n    ${out}`);
    console.log('  • Keep it secret and BACK IT UP (password manager / offline). Do NOT commit it or upload it to GitHub.');
    console.log('  • If you lose it, existing installs can no longer be updated automatically.\n');
    console.log('Now add this PUBLIC key to src/services/updateKeys.js (UPDATE_PUBLIC_KEYS) and ship a release containing it:\n');
    console.log(`    '${publicKeyBase64}'\n`);
    return;
  }

  if (cmd === 'sign') {
    const installer = args.find(a => !a.startsWith('--') && a !== flag(args, '--key'));
    if (!installer) fail('Usage: release-tool sign <SHMMOTH-Browser-Setup-x.y.z.exe> [--key release-signing-key.pem]');
    const assetName = path.basename(installer);
    if (!INSTALLER_NAME.test(assetName)) fail(`The installer must be named SHMMOTH-Browser-Setup-<version>.exe (got "${assetName}").`);
    const keyPath = path.resolve(flag(args, '--key') || DEFAULT_KEY_FILE);
    const pem = process.env.SHMMOTH_SIGNING_KEY_PEM || (fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : null);
    if (!pem) fail(`No signing key found. Run "npm run release:keygen" first, or pass --key <file> / set SHMMOTH_SIGNING_KEY_PEM.`);

    const { sha256, size } = await sig.hashFile(installer);
    const sigText = sig.signUpdate({ assetName, size, sha256, privateKeyPem: pem });
    const sigPath = installer + '.sig';
    fs.writeFileSync(sigPath, sigText);

    // Round-trip check with the exact verifier the app uses
    const ownPublic = publicKeyBase64FromPrivatePem(pem);
    const check = sig.verifyUpdateSignature({ assetName, size, sha256, signatureFileText: sigText, publicKeys: [ownPublic] });
    if (!check.ok) fail('Internal error: the new signature does not verify (' + check.reason + ')');

    console.log(`\n✔ Signed ${assetName}`);
    console.log(`    size   ${size} bytes`);
    console.log(`    sha256 ${sha256}`);
    console.log(`    sig    ${sigPath}`);
    if (!UPDATE_PUBLIC_KEYS.includes(ownPublic)) {
      console.log('\n⚠ This key is NOT listed in src/services/updateKeys.js — installed browsers will reject this update until a build containing');
      console.log(`  '${ownPublic}'`);
      console.log('  has been released.');
    }
    console.log(`\nUpload BOTH files to the GitHub release:\n    ${assetName}\n    ${assetName}.sig\n`);
    return;
  }

  if (cmd === 'verify') {
    const installer = args.find(a => !a.startsWith('--') && a !== flag(args, '--sig') && a !== flag(args, '--pubkey'));
    if (!installer) fail('Usage: release-tool verify <installer.exe> [--sig <file>] [--pubkey <base64>]');
    const sigPath = flag(args, '--sig') || installer + '.sig';
    if (!fs.existsSync(sigPath)) fail(`Signature file not found: ${sigPath}`);
    const keys = flag(args, '--pubkey') ? [flag(args, '--pubkey')] : UPDATE_PUBLIC_KEYS;
    const { sha256, size } = await sig.hashFile(installer);
    const verdict = sig.verifyUpdateSignature({ assetName: path.basename(installer), size, sha256, signatureFileText: fs.readFileSync(sigPath, 'utf8'), publicKeys: keys });
    if (!verdict.ok) fail('Signature INVALID: ' + verdict.reason);
    console.log(`\n✔ Signature valid (key #${verdict.keyIndex + 1}) — sha256 ${sha256}\n`);
    return;
  }

  if (cmd === 'check') {
    const root = path.join(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const changelogPath = path.join(root, 'CHANGELOG.md');
    const res = checkRelease({
      version: pkg.version,
      tag: flag(args, '--tag'),
      keys: UPDATE_PUBLIC_KEYS,
      changelog: fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '',
      files: ['build/icon.ico', 'build/icon.png'].filter((f) => fs.existsSync(path.join(root, f)))
    });
    if (!res.ok) fail('Not ready to release:\n  - ' + res.problems.join('\n  - '));
    console.log(`\n✔ Ready to release ${pkg.version} (${UPDATE_PUBLIC_KEYS.length} update key${UPDATE_PUBLIC_KEYS.length === 1 ? '' : 's'}, changelog, icon)\n`);
    return;
  }

  if (cmd === 'notes') {
    const version = args[0];
    if (!version || !VERSION.test(version)) fail('Usage: release-tool notes <x.y.z>');
    const file = path.join(__dirname, '..', 'CHANGELOG.md');
    const notes = fs.existsSync(file) ? extractNotes(fs.readFileSync(file, 'utf8'), version) : null;
    if (!notes) fail(`CHANGELOG.md has no "## ${version}" section`);
    process.stdout.write(notes + '\n');
    return;
  }

  console.log('Usage:\n  release-tool keygen [--out file]\n  release-tool sign <installer.exe> [--key file]\n  release-tool verify <installer.exe> [--sig file] [--pubkey base64]\n  release-tool check [--tag vX.Y.Z]\n  release-tool notes <x.y.z>');
  process.exit(cmd ? 1 : 0);
}

module.exports = { isValidPublicKey, extractNotes, checkRelease };

if (require.main === module) main().catch(err => fail(err.message));
