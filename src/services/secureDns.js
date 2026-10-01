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

module.exports = { PROVIDERS, DEFAULT_PROVIDER, normalizeProvider, validateDohUrl, buildHostResolverConfig };
