/**
 * UPDATE SIGNATURES — updateSignature.js
 *
 * Authenticity check for downloaded installers. Pure Node (no Electron), shared by the
 * updater in the app and by scripts/release-tool.js so both always agree on the format.
 *
 * Threat: the installers live on GitHub Releases. A SHA-256 published next to the
 * installer (GitHub's asset `digest`, latest.yml, a .sha256 file) is replaced together with
 * the installer by anyone who can edit the release — a stolen token, a compromised account,
 * a malicious collaborator — and the old updater would then run that file on every user's
 * PC. Releases are not immutable (the v1.0.16 installer was re-uploaded a day after the
 * release was published).
 *
 * Therefore every installer must carry a detached Ed25519 signature made with a private key
 * that is NEVER stored on GitHub, and the matching public key(s) are compiled into the app
 * (see updateKeys.js). Without a valid signature nothing is run.
 *
 * Signed message (binds the file name/version, the exact size and the content hash):
 *     "SHMMOTH-UPDATE-V1\n<assetName>\n<sizeInBytes>\n<sha256Hex>\n"
 *
 * Signature file (<installer>.sig):
 *     {"version":1,"algorithm":"ed25519","signature":"<base64>"}
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');

const SIGNATURE_DOMAIN = 'SHMMOTH-UPDATE-V1';
const MAX_SIGNATURE_FILE_BYTES = 4096;

function buildSignedMessage({ assetName, size, sha256 }) {
  if (typeof assetName !== 'string' || !/^[\w.\- ]{1,200}$/.test(assetName)) throw new Error('Invalid asset name');
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid size');
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Invalid sha256');
  return Buffer.from(`${SIGNATURE_DOMAIN}\n${assetName}\n${size}\n${sha256}\n`, 'utf8');
}

/** Accepts a PEM public key or the base64 of its SPKI DER encoding (what release-tool prints). */
function parsePublicKey(key) {
  if (key && typeof key === 'object' && key.type === 'public') return key;
  if (typeof key !== 'string' || !key.trim()) throw new Error('Empty public key');
  const text = key.trim();
  const k = text.includes('BEGIN PUBLIC KEY')
    ? crypto.createPublicKey(text)
    : crypto.createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' });
  if (k.asymmetricKeyType !== 'ed25519') throw new Error('Update keys must be Ed25519');
  return k;
}

function serializeSignature(signatureBase64) {
  return JSON.stringify({ version: 1, algorithm: 'ed25519', signature: signatureBase64 }) + '\n';
}

/** Parses the contents of a .sig file. Throws on anything unexpected. */
function parseSignatureFile(text) {
  if (typeof text !== 'string' || text.length > MAX_SIGNATURE_FILE_BYTES) throw new Error('Signature file has an unexpected size');
  let obj;
  try { obj = JSON.parse(text); } catch (_) { throw new Error('Signature file is not valid JSON'); }
  if (!obj || obj.version !== 1 || obj.algorithm !== 'ed25519' || typeof obj.signature !== 'string') {
    throw new Error('Unsupported signature file');
  }
  const sig = Buffer.from(obj.signature, 'base64');
  if (sig.length !== 64) throw new Error('Signature has the wrong length');
  return sig;
}

/**
 * @returns {{ ok: boolean, keyIndex?: number, reason?: string }}
 */
function verifyUpdateSignature({ assetName, size, sha256, signatureFileText, publicKeys }) {
  let message; let signature;
  try {
    message = buildSignedMessage({ assetName, size, sha256 });
    signature = parseSignatureFile(signatureFileText);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  const keys = Array.isArray(publicKeys) ? publicKeys : [];
  if (keys.length === 0) return { ok: false, reason: 'No update signing key is configured' };

  for (let i = 0; i < keys.length; i++) {
    try {
      if (crypto.verify(null, message, parsePublicKey(keys[i]), signature)) return { ok: true, keyIndex: i };
    } catch (_) { /* malformed key: try the next one */ }
  }
  return { ok: false, reason: 'Signature does not match any trusted update key' };
}

function signUpdate({ assetName, size, sha256, privateKeyPem }) {
  const message = buildSignedMessage({ assetName, size, sha256 });
  const signature = crypto.sign(null, message, crypto.createPrivateKey(privateKeyPem));
  return serializeSignature(signature.toString('base64'));
}

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

/** Streams a file through SHA-256. Returns { sha256, size }. */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let size = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => { hash.update(chunk); size += chunk.length; });
    stream.on('error', reject);
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), size }));
  });
}

module.exports = {
  SIGNATURE_DOMAIN,
  buildSignedMessage,
  parsePublicKey,
  parseSignatureFile,
  serializeSignature,
  verifyUpdateSignature,
  signUpdate,
  generateKeyPair,
  hashFile
};
