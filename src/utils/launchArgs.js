/**
 * Command-line URLs. The OS hands a URL to the browser as a plain argument (`shmmoth.exe https://example.com`, or
 * when it is the default browser). Only web addresses are accepted: no file paths, no `mtc://`, no `javascript:`.
 */

'use strict';

const MAX_URLS = 10;
const MAX_LENGTH = 8192;

/**
 * @param {string[]} argv process.argv or the argv of a second instance
 * @returns {string[]} normalised http(s) URLs, in order, without duplicates
 */
function urlsFromArgv(argv) {
  const out = [];
  if (!Array.isArray(argv)) return out;
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.startsWith('-') || arg.length > MAX_LENGTH) continue;
    let u;
    try { u = new URL(arg); } catch (_) { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;     // "C:\x" parses as protocol "c:" and is rejected here
    if (!out.includes(u.href)) out.push(u.href);
    if (out.length >= MAX_URLS) break;
  }
  return out;
}

module.exports = { urlsFromArgv, MAX_URLS };
