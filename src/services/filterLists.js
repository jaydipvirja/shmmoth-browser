/**
 * FILTER LISTS — which lists the ad blocker uses, where they come from, and how a downloaded file is checked.
 *
 * Every list has several addresses and the first one that answers with something that really looks like a filter list
 * wins: the list's own repository on GitHub, the Ghostery mirror of it, the same through the jsDelivr CDN (reachable
 * where raw.githubusercontent.com is not), and the list's own server. A network that blocks one host therefore does
 * not leave the browser with the 11-domain emergency list.
 *
 * uBlock Origin's lists come from its own repository first (1.4.4): the Ghostery mirror is updated only now and then,
 * and YouTube's ad and anti-adblock fixes change several times a week (quick-fixes.txt, filters-2025/2026.txt), so the
 * mirror was days to weeks behind exactly where it matters. The engine expects the arguments of `##+js(...)` rules
 * URL-encoded, as the Ghostery mirror has them; lists taken from anywhere else are encoded the same way on arrival
 * (encodeScriptletArgs).
 *
 * Pure functions only (no Electron), so the tests can drive them with a fake fetch.
 */

'use strict';

const crypto = require('crypto');

const GHOSTERY_RAW = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets';
const GHOSTERY_CDN = 'https://cdn.jsdelivr.net/gh/ghostery/adblocker@master/packages/adblocker/assets';
const ADGUARD_RAW = 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/platforms/extension/ublock/filters';
const ADGUARD_CDN = 'https://cdn.jsdelivr.net/gh/AdguardTeam/FiltersRegistry@master/platforms/extension/ublock/filters';
const ADGUARD = 'https://filters.adtidy.org/extension/ublock/filters';
const UBO = 'https://ublockorigin.github.io/uAssets/filters';
const UASSETS_RAW = 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters';
const UASSETS_CDN = 'https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssets@master/filters';
const QUICK_FIXES_TTL_MS = 4 * 60 * 60 * 1000;     // YouTube's fixes: fetched again after 4 hours (other lists: a day)

const ghostery = (p) => [`${GHOSTERY_RAW}/${p}`, `${GHOSTERY_CDN}/${p}`];
// uBlock's own repository first, then the Ghostery mirror (when it has the file), then the CDN and uBlock's site
const ubo = (file, { mirror = true } = {}) => [`${UASSETS_RAW}/${file}`, ...(mirror ? ghostery(`ublock-origin/${file}`) : []), `${UASSETS_CDN}/${file}`, `${UBO}/${file}`];
const adguard = (n) => [`${ADGUARD}/${n}`, `${ADGUARD_RAW}/${n}`, `${ADGUARD_CDN}/${n}`];

/**
 * The lists. `core` lists are the ones the browser cannot do without; the others are bonuses (a failed download is
 * only reported in the status).
 */
const LISTS = Object.freeze([
  { id: 'easylist',        name: 'EasyList',                         core: true,  urls: [...ghostery('easylist/easylist.txt'), 'https://easylist.to/easylist/easylist.txt'] },
  { id: 'easyprivacy',     name: 'EasyPrivacy',                      core: true,  urls: [...ghostery('easylist/easyprivacy.txt'), 'https://easylist.to/easylist/easyprivacy.txt'] },
  { id: 'peter-lowe',      name: "Peter Lowe's ad & tracking servers", core: false, urls: [...ghostery('peter-lowe/serverlist.txt'), 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext'] },
  { id: 'ubo-filters',     name: 'uBlock filters',                   core: true,  urls: ubo('filters.txt') },
  { id: 'ubo-filters-2020', name: 'uBlock filters 2020',             core: false, urls: ubo('filters-2020.txt') },
  { id: 'ubo-filters-2021', name: 'uBlock filters 2021',             core: false, urls: ubo('filters-2021.txt') },
  { id: 'ubo-filters-2022', name: 'uBlock filters 2022',             core: false, urls: ubo('filters-2022.txt') },
  { id: 'ubo-filters-2023', name: 'uBlock filters 2023',             core: false, urls: ubo('filters-2023.txt') },
  { id: 'ubo-filters-2024', name: 'uBlock filters 2024',             core: false, urls: ubo('filters-2024.txt') },
  { id: 'ubo-filters-2025', name: 'uBlock filters 2025',             core: false, urls: ubo('filters-2025.txt') },
  { id: 'ubo-filters-2026', name: 'uBlock filters 2026',             core: false, urls: ubo('filters-2026.txt') },
  { id: 'ubo-filters-general', name: 'uBlock filters – general',     core: false, urls: ubo('filters-general.txt', { mirror: false }) },
  { id: 'ubo-badware',     name: 'uBlock filters – badware',         core: false, urls: ubo('badware.txt') },
  { id: 'ubo-privacy',     name: 'uBlock filters – privacy',         core: false, urls: ubo('privacy.txt') },
  { id: 'ubo-resource-abuse', name: 'uBlock filters – resource abuse', core: false, urls: ubo('resource-abuse.txt') },
  { id: 'ubo-quick-fixes', name: 'uBlock filters – quick fixes',     core: false, urls: ubo('quick-fixes.txt'), ttlMs: QUICK_FIXES_TTL_MS },
  { id: 'ubo-unbreak',     name: 'uBlock filters – unbreak',         core: false, urls: ubo('unbreak.txt') },
  { id: 'adguard-base',    name: 'AdGuard Base',                     core: false, urls: adguard('2_without_easylist.txt') },
  { id: 'adguard-popups',  name: 'AdGuard Popups',                   core: false, urls: adguard('19.txt') },
]);

/** uBlock Origin's scriptlets and replacement resources (what `##+js(...)` rules run). */
const RESOURCES = Object.freeze({
  id: 'resources', name: 'Scriptlets (uBlock Origin resources)',
  urls: [...ghostery('ublock-origin/resources.json')]
});

const MIN_LIST_BYTES = 200;
const MAX_LIST_BYTES = 40 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25 * 1000;

/** Is the list at this address in the engine's form already (the Ghostery mirror), or as its authors write it? */
function isEngineEncoded(url) {
  return typeof url === 'string' && url.includes('ghostery/adblocker');
}

/**
 * `##+js(name, arg, …)` rules as the engine wants them: each argument URL-encoded (the engine decodes them before the
 * scriptlet runs). In the authors' form arguments are separated by commas and a comma inside one is written "\,".
 * Lines that are not scriptlet rules are left as they are.
 */
function encodeScriptletArgs(text) {
  if (typeof text !== 'string' || !text.includes('+js(')) return text;
  return text.split('\n').map((line) => {
    const m = /^([^!].*?#@?#\+js\()(.*)\)\s*$/.exec(line);
    if (!m) return line;
    const parts = [];
    let cur = '';
    for (let i = 0; i < m[2].length; i++) {
      const c = m[2][i];
      if (c === '\\' && m[2][i + 1] === ',') { cur += ','; i++; continue; }
      if (c === ',') { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    const [name, ...args] = parts.map((p) => p.trim());
    return m[1] + [name, ...args.map((a) => encodeURIComponent(a))].join(', ') + ')';
  }).join('\n');
}

/** Does this text look like an ad-block list (and not an HTML error page or a captive portal)? */
function looksLikeFilterList(text) {
  if (typeof text !== 'string' || text.length < MIN_LIST_BYTES || text.length > MAX_LIST_BYTES) return false;
  const head = text.slice(0, 4096).trimStart().toLowerCase();
  if (head.startsWith('<') || head.includes('<html') || head.includes('<!doctype')) return false;
  let rules = 0;
  const lines = text.slice(0, 200000).split('\n');
  for (const line of lines) {
    if (line.startsWith('||') || line.includes('##') || line.startsWith('@@') || line.startsWith('|http') || /^[a-z0-9*.\-/_]+\$[a-z,~=|.\-_*]+$/i.test(line)) rules++;
    if (rules >= 10) return true;
  }
  return false;
}

/** uBlock's resources.json: an object with a non-empty `scriptlets` array. */
function looksLikeResources(text) {
  if (typeof text !== 'string' || text.length < MIN_LIST_BYTES || text.length > MAX_LIST_BYTES) return false;
  try {
    const json = JSON.parse(text);
    return Boolean(json) && Array.isArray(json.scriptlets) && json.scriptlets.length > 0;
  } catch (_) {
    return false;
  }
}

/** fetch() with a time limit. */
async function fetchText(fetchImpl, url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : '???'}`);
    return await response.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Downloads one list, trying every address in turn.
 * @returns {Promise<{ ok: true, text: string, url: string } | { ok: false, error: string }>}
 */
async function downloadList(fetchImpl, list, { validate = looksLikeFilterList, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const errors = [];
  for (const url of list.urls) {
    try {
      const text = await fetchText(fetchImpl, url, timeoutMs);
      if (!validate(text)) { errors.push(`${hostOf(url)}: not a filter list`); continue; }
      return { ok: true, text: validate === looksLikeFilterList && !isEngineEncoded(url) ? encodeScriptletArgs(text) : text, url };
    } catch (err) {
      errors.push(`${hostOf(url)}: ${(err && err.name === 'AbortError') ? 'timed out' : (err && err.message) || 'failed'}`);
    }
  }
  return { ok: false, error: errors.join('; ') };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return url; }
}

/** Runs `worker(item)` for every item with at most `limit` in flight. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** A short fingerprint of a set of list texts: engines are only rebuilt when it changes. */
function signatureOf(parts) {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(`${p.id}:${p.text.length}:`).update(p.text.length > 0 ? crypto.createHash('sha1').update(p.text).digest() : '');
  return h.digest('hex');
}

module.exports = {
  LISTS, RESOURCES, MIN_LIST_BYTES, MAX_LIST_BYTES, FETCH_TIMEOUT_MS, QUICK_FIXES_TTL_MS,
  encodeScriptletArgs, isEngineEncoded, looksLikeFilterList, looksLikeResources, fetchText, downloadList, mapLimit, signatureOf, hostOf
};
