/**
 * SECURE DNS (DNS-over-HTTPS) — secureDns.js
 *
 * Name lookups normally go out in clear text to the DNS server of the network (anyone on the path can read or change
 * them). With DNS-over-HTTPS the browser asks a resolver over an encrypted HTTPS connection. AdGuard DNS is the default:
 * besides encrypting the lookups it refuses to resolve known ad, tracker and malware domains, which complements the
 * ad blocker (it also covers requests the filter lists miss).
 *
 * "automatic" mode (the default) asks the DoH server first and quietly falls back to the system DNS when it cannot be
 * reached, so a blocked/offline resolver never leaves the browser unable to load pages. "Strict" never falls back.
 *
 * Applied with Electron's app.configureHostResolver() (after the app is ready); the result is global for every session
 * including incognito. When a proxy is used, the proxy resolves the names of the sites itself.
 */

'use strict';

const PROVIDERS = Object.freeze({
  system: Object.freeze({
    id: 'system', label: 'System default (not encrypted)', servers: Object.freeze([]),
    description: 'Use the DNS server of your network or Windows settings.'
  }),
  adguard: Object.freeze({
    id: 'adguard', label: 'AdGuard DNS — blocks ads & trackers (recommended)', servers: Object.freeze(['https://dns.adguard-dns.com/dns-query']),
    description: 'Encrypted lookups; known ad, tracker and malware domains are not resolved.'
  }),
  'adguard-family': Object.freeze({
    id: 'adguard-family', label: 'AdGuard DNS — Family protection', servers: Object.freeze(['https://family.adguard-dns.com/dns-query']),
    description: 'Like AdGuard DNS, and adult sites are blocked as well.'
  }),
  'adguard-unfiltered': Object.freeze({
    id: 'adguard-unfiltered', label: 'AdGuard DNS — non-filtering', servers: Object.freeze(['https://unfiltered.adguard-dns.com/dns-query']),
    description: 'Encrypted lookups only, nothing is blocked.'
  }),
  custom: Object.freeze({
    id: 'custom', label: 'Custom (your own DNS-over-HTTPS address)', servers: Object.freeze([]),
    description: 'Any DoH resolver, e.g. https://dns.example.com/dns-query.'
  })
});

const DEFAULT_PROVIDER = 'adguard';
const MAX_URL_LENGTH = 256;

function normalizeProvider(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? id : DEFAULT_PROVIDER;
}

/**
 * A DoH address must be a plain https URL of a resolver: no credentials, no fragment, no whitespace, a path.
 * @returns {{ ok: boolean, url?: string, reason?: string }}
 */
function validateDohUrl(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'Enter the address of a DNS-over-HTTPS server.' };
  const text = input.trim();
  if (!text) return { ok: false, reason: 'Enter the address of a DNS-over-HTTPS server.' };
  if (text.length > MAX_URL_LENGTH || /\s/.test(text)) return { ok: false, reason: 'That address is not valid.' };
  let u;
  try { u = new URL(text); } catch (_) { return { ok: false, reason: 'That address is not valid (example: https://dns.example.com/dns-query).' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'The address must start with https://' };
  if (u.username || u.password) return { ok: false, reason: 'The address must not contain a user name or password.' };
  if (u.hash) return { ok: false, reason: 'The address must not contain a # fragment.' };
  if (!u.hostname || u.pathname === '' ) return { ok: false, reason: 'That address is not valid.' };
  return { ok: true, url: u.href };
}

/**
 * Settings → the options for app.configureHostResolver().
 * An invalid custom address degrades to "system" (never to a guessed server).
 */
function buildHostResolverConfig(input) {
  const settings = input && typeof input === 'object' ? input : {};
  const provider = normalizeProvider(settings.secureDnsProvider);
  let servers = PROVIDERS[provider].servers.slice();
  if (provider === 'custom') {
    const v = validateDohUrl(settings.secureDnsCustomUrl);
    servers = v.ok ? [v.url] : [];
  }
  if (servers.length === 0) {
    return { provider: 'system', options: { secureDnsMode: 'off', secureDnsServers: [] } };
  }
  return {
    provider,
    options: {
      secureDnsMode: settings.secureDnsStrict === true ? 'secure' : 'automatic',
      secureDnsServers: servers,
      enableBuiltInResolver: true            // DoH is done by Chromium's own resolver (off by default on Windows / Linux)
    }
  };
}

/**
 * "Test it": what the browser's own resolver answers for an ad domain that every AdGuard filter blocks, once with secure
 * DNS and once with the system's DNS only, so the result can say whether AdGuard DNS is really in use — instead of the
 * user guessing from whether ads are still there (DNS cannot remove ads that are served from the page's own address).
 */
const TEST_BLOCKED_HOST = 'doubleclick.net';
const TEST_NORMAL_HOST = 'example.com';
const NULL_ADDRESSES = new Set(['0.0.0.0', '::', '::0', '0:0:0:0:0:0:0:0']);

/** Is this resolver answer a refusal? (no such name, or the "null address" blocking servers answer with) */
function isRefusal(answer) {
  if (!answer) return false;
  if (!answer.ok) return /NAME_NOT_RESOLVED|NXDOMAIN|ENOTFOUND|not.?found/i.test(String(answer.error || ''));
  const list = Array.isArray(answer.addresses) ? answer.addresses : [];
  return list.length === 0 || list.every((a) => NULL_ADDRESSES.has(String(a)));
}

/**
 * @param {object} p
 * @param {string} p.provider       the provider that is in force ('system' | 'adguard' | …)
 * @param {boolean} p.proxyActive
 * @param {{ok:boolean,addresses?:string[],error?:string}} p.secureBlocked  ad domain through secure DNS
 * @param {{ok:boolean,addresses?:string[],error?:string}} p.systemBlocked  ad domain through the system DNS only
 * @param {{ok:boolean,addresses?:string[],error?:string}} p.normal         an ordinary domain through secure DNS
 * @returns {{ verdict: string, message: string }}
 */
function classifyDnsTest({ provider, proxyActive, secureBlocked, systemBlocked, normal }) {
  if (proxyActive) {
    return { verdict: 'proxy', message: 'A proxy is set (Settings → Connection). The proxy looks up website names itself, so the DNS choice above is not used while it is on.' };
  }
  if (!normal || !normal.ok) {
    return { verdict: 'broken', message: 'Website names cannot be looked up at all right now (even example.com). Check the internet connection; if "Never fall back to normal DNS" is on, turn it off and test again.' };
  }
  if (provider === 'system') {
    return { verdict: 'off', message: 'Secure DNS is off: names are looked up by your network\'s normal DNS in plain text. Pick "AdGuard DNS" above to encrypt them and refuse known ad domains.' };
  }
  const filtering = provider === 'adguard' || provider === 'adguard-family';
  if (!filtering) {
    return { verdict: 'encrypted', message: 'Lookups work through the secure DNS server you chose. It does not filter ads, so ads are left to the ad blocker.' };
  }
  if (isRefusal(secureBlocked)) {
    return isRefusal(systemBlocked)
      ? { verdict: 'working', message: 'AdGuard DNS answers like a filtering server: the test ad domain is refused. (Your network\'s own DNS refuses it too, so this test cannot tell the two apart.)' }
      : { verdict: 'working', message: 'AdGuard DNS is working: the test ad domain is refused, while your network\'s normal DNS would have answered it.' };
  }
  return {
    verdict: 'not-filtering',
    message: 'AdGuard DNS is NOT in use right now: the browser got a real answer for an ad domain. Common causes: the AdGuard server cannot be reached from this network (in "automatic" mode the browser then quietly uses the normal DNS), a VPN or security program takes over DNS, or a proxy is used. Turn on "Never fall back to normal DNS" and test again — if pages stop loading, this network blocks AdGuard DNS. Note that DNS can only stop ads that come from their own server names; ads served from the page\'s own address are the ad blocker\'s job.'
  };
}

module.exports = {
  PROVIDERS, DEFAULT_PROVIDER, normalizeProvider, validateDohUrl, buildHostResolverConfig,
  TEST_BLOCKED_HOST, TEST_NORMAL_HOST, isRefusal, classifyDnsTest
};
