// Page-load error controller (mtc://error?code=-105&name=ERR_NAME_NOT_RESOLVED&url=https%3A%2F%2F…)
// The query string is data, not markup: everything is written with textContent, never parsed as markup.
'use strict';

const params = new URLSearchParams(window.location.search);
const code = parseInt(params.get('code'), 10) || 0;
const name = (params.get('name') || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64);
const rawUrl = params.get('url') || '';
const failedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
// HTTPS-Only asked for this http address over https, and the site has no working https (services/privacyShield.js)
const noHttps = params.get('https') === '1' && /^http:\/\//i.test(failedUrl);

const CHECK_CONNECTION = ['Check your network cables, modem and router', 'Reconnect to your Wi-Fi network'];

const MESSAGES = {
  '-105': { icon: 'search', title: "Server not found", desc: "The server's address could not be found.", hints: ['Check the address for typing mistakes', 'Check your internet connection', 'Check your DNS settings or try again in a minute'] },
  '-106': { icon: 'wifi-off', title: 'No internet connection', desc: 'The computer is not connected to the internet.', hints: CHECK_CONNECTION },
  '-102': { icon: 'close', title: 'Connection refused', desc: 'The server refused the connection.', hints: ['The site may be down for maintenance', 'A firewall or antivirus could be blocking the connection'] },
  '-118': { icon: 'history', title: 'The connection timed out', desc: 'The server took too long to respond.', hints: ['Try again in a few minutes', 'Check your internet connection'] },
  '-7':   { icon: 'history', title: 'The connection timed out', desc: 'The server took too long to respond.', hints: ['Try again in a few minutes', 'Check your internet connection'] },
  '-101': { icon: 'reload', title: 'The connection was reset', desc: 'The connection to the server was interrupted.', hints: ['Try again', 'A firewall, VPN or proxy may be interfering'] },
  '-100': { icon: 'reload', title: 'The connection was closed', desc: 'The server closed the connection unexpectedly.', hints: ['Try again'] },
  '-109': { icon: 'globe', title: 'Address unreachable', desc: 'The server cannot be reached from this network.', hints: ['Check your internet connection or VPN'] },
  '-130': { icon: 'settings', title: 'Proxy server problem', desc: 'The proxy server is not responding properly.', hints: ['Check your proxy in Settings → Network & Proxy', 'Switch the proxy to "System" or "Direct" to test'] },
  '-111': { icon: 'settings', title: 'Proxy server problem', desc: 'A tunnel through the proxy server could not be opened.', hints: ['Check your proxy in Settings → Network & Proxy'] },
  '-20':  { icon: 'shield', title: 'Blocked by the ad blocker', desc: 'This address is on a filter list used by the ad & tracker blocker.', hints: ['If you trust this site, switch the ad blocker off in Settings → Ad-Blocker & Privacy'] },
  '-310': { icon: 'reload', title: 'Too many redirects', desc: 'The page keeps redirecting and never loads.', hints: ['Clearing the cookies for this site may help'] },
  '-300': { icon: 'info', title: 'Invalid address', desc: 'The address is not valid.', hints: ['Check it for typing mistakes'] },
  '-324': { icon: 'info', title: 'No data received', desc: 'The server closed the connection without sending anything.', hints: ['Try again in a few minutes'] },
  '-21':  { icon: 'wifi-off', title: 'The network changed', desc: 'The network connection changed while the page was loading.', hints: ['Try again'] }
};

const CERT = { icon: 'lock', title: 'Your connection is not private', desc: "This site's security certificate cannot be trusted, so SHMMOTH Browser did not load it. Attackers might be trying to steal your information.", hints: ['Check that your computer\'s date and time are correct', 'Try the site later, or contact its owner', 'SHMMOTH Browser does not offer a way to continue past this warning'] };
const GENERIC = { icon: 'globe', title: "This page can't be loaded", desc: 'Something went wrong while connecting to the site.', hints: ['Try again in a few minutes', 'Check your internet connection'] };

function describe(c) {
  if (MESSAGES[String(c)]) return MESSAGES[String(c)];
  if (c <= -200 && c > -300) return CERT;              // ERR_CERT_*
  return GENERIC;
}

const NO_HTTPS = { icon: 'lock', title: 'This site does not offer a secure connection', desc: 'SHMMOTH Browser asked for this page over a secure connection (HTTPS-Only), and the site does not offer one. If you continue, what you send and see on this site can be read or changed by others on the network.', hints: ['Do not enter passwords, card numbers or other private information on this site', 'HTTPS-Only can be switched off in Settings → Ad-Blocker & Privacy'] };

const info = noHttps ? NO_HTTPS : describe(code);
let host = '';
try { host = new URL(failedUrl).host; } catch (_) { /* no valid address */ }

// an icon of icons.js (drawn with DOM calls, no markup)
const iconEl = document.getElementById('icon');
const iconSvg = window.ShIcons && window.ShIcons.create(info.icon);
if (iconSvg) iconEl.replaceChildren(iconSvg);
if (info === CERT || code === -20) iconEl.classList.add('danger');
document.getElementById('title').textContent = info.title;
document.getElementById('desc').textContent = info.desc;
const addr = document.getElementById('address');
if (failedUrl) {
  const label = document.createElement('b');
  label.textContent = host || 'This page';
  addr.appendChild(label);
  addr.appendChild(document.createTextNode(`  —  ${failedUrl.length > 300 ? failedUrl.slice(0, 300) + '…' : failedUrl}`));
} else {
  addr.classList.add('hidden');
}
const hints = document.getElementById('hints');
for (const h of info.hints) {
  const li = document.createElement('li');
  li.textContent = h;
  hints.appendChild(li);
}
document.getElementById('code').textContent = `Error code: ${name || 'ERR_FAILED'} (${code})`;
document.title = host || info.title;

const retry = document.getElementById('btn-retry');
if (noHttps) {
  // the browser lets exactly this address through over http when it comes from this page (until it is closed)
  retry.textContent = 'Continue to the site (not secure)';
  retry.classList.replace('btn-primary', 'btn-secondary');
  retry.addEventListener('click', () => { window.location.href = failedUrl; });
} else if (failedUrl) {
  retry.addEventListener('click', () => { window.location.href = failedUrl; });
} else {
  retry.classList.add('hidden');
}
const back = document.getElementById('btn-back');
if (window.history.length > 1) {
  back.addEventListener('click', () => window.history.back());
} else {
  back.classList.add('hidden');            // the very first page of this tab failed: nowhere to go back to
}
