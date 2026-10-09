/**
 * A throw-away self-signed TLS certificate for the E2E tests, made with nothing but Node's crypto module (no openssl,
 * no extra packages; works the same on Linux and Windows). The browser is started with --ignore-certificate-errors and
 * --host-resolver-rules, so a page "on" a real host name (www.youtube.com, which only works over HTTPS) is served by a
 * local test server.
 *
 * selfSignedCert('www.youtube.com') → { key, cert } (PEM), ready for https.createServer.
 */

'use strict';

const crypto = require('crypto');

// ─── A minimal DER encoder ────────────────────────────────────────────────────

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const nul = () => Buffer.from([0x05, 0x00]);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const octets = (buf) => tlv(0x04, buf);
const bits = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const explicit = (n, body) => tlv(0xa0 + n, body);

function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk = [p & 0x7f];
    let v = p >> 7;
    while (v > 0) { chunk.unshift(0x80 | (v & 0x7f)); v >>= 7; }
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function utcTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  const s = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, 'ascii'));
}

const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

// ─── The certificate ─────────────────────────────────────────────────────────

function selfSignedCert(hostname) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sha256WithRSA = seq(oid('1.2.840.113549.1.1.11'), nul());
  const name = seq(set(seq(oid('2.5.4.3'), utf8(hostname))));
  const now = Date.now();
  const san = seq(seq(oid('2.5.29.17'), octets(seq(tlv(0x82, Buffer.from(hostname, 'ascii'))))));
  const tbs = seq(
    explicit(0, int(Buffer.from([2]))),                                    // version 3
    int(crypto.randomBytes(8)),
    sha256WithRSA,
    name,
    seq(utcTime(new Date(now - 24 * 3600 * 1000)), utcTime(new Date(now + 7 * 24 * 3600 * 1000))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, san)
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, sha256WithRSA, bits(signature));
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', cert) };
}

module.exports = { selfSignedCert };
