/**
 * "Check multi-network setup" (Settings → Downloads): what this computer needs for a download to be split over two
 * internet connections, checked one by one, each with what to do about it.
 *
 *   - two physical networks with internet (each adapter is tested with a connection bound to its own address)
 *   - no VPN in the way (it would carry everything over one connection)
 *   - no proxy (the fast engine does not go through proxies)
 *   - the switches in Settings
 *   - Windows: the policy "Minimize the number of simultaneous connections" (fMinimizeConnections), which can make
 *     Windows drop Wi-Fi while a cable is connected, or after a while
 *
 * Reads only: reg.exe with fixed arguments, nothing is changed. Pure function of its inputs for the tests.
 */
'use strict';

const { execFile } = require('child_process');

const POLICY_KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WcmSvc\\GroupPolicy';
const POLICY_FIX = `reg add "${POLICY_KEY}" /v fMinimizeConnections /t REG_DWORD /d 0 /f`;

/** The value of fMinimizeConnections (0–3), or null when the policy is not set. */
function readMinimizePolicy({ platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    run('reg', ['query', POLICY_KEY, '/v', 'fMinimizeConnections'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /fMinimizeConnections\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(stdout || ''));
      resolve(m ? parseInt(m[1], 16) : null);
    });
  });
}

/**
 * The checks as { id, status: 'ok' | 'warn' | 'fail', title, detail } and an overall verdict.
 * `interfaces`: TurboDownloadEngine.getAvailableNetworkInterfacesAsync() (name, address, isVirtual, isOnline).
 */
function evaluate({ interfaces = [], platform = process.platform, policy = null, proxyActive = false, turboOn = true, multiOn = true }) {
  const checks = [];
  const physical = interfaces.filter((i) => !i.isVirtual);
  const online = physical.filter((i) => i.isOnline);
  const vpn = interfaces.filter((i) => i.isVirtual && i.isOnline);
  const names = (list) => list.map((i) => `${i.name} (${i.address})`).join(', ');

  checks.push(turboOn && multiOn
    ? { id: 'settings', status: 'ok', title: 'Turbo and multi-network downloading are on' }
    : { id: 'settings', status: 'fail', title: 'Switched off in Settings', detail: 'Turn on "Turbo Download Engine" and "Multi-Source Internet Bonding" above.' });

  if (online.length >= 2) {
    checks.push({ id: 'networks', status: 'ok', title: `${online.length} internet connections work at the same time`, detail: names(online) });
  } else {
    const offline = physical.filter((i) => !i.isOnline);
    checks.push({
      id: 'networks', status: 'fail',
      title: online.length === 1 ? 'Only one internet connection works' : 'No working internet connection was found',
      detail: (online.length ? `Working: ${names(online)}. ` : '') + (offline.length ? `Connected but without internet: ${names(offline)}. ` : '') +
        'Connect a second one at the same time: Wi-Fi + an Ethernet cable, or Wi-Fi + your phone by USB with "USB tethering" on (Android: Settings → Hotspot & tethering). A phone hotspot over the same Wi-Fi card does not count: one Wi-Fi card joins one network.'
    });
  }

  if (vpn.length) {
    checks.push({ id: 'vpn', status: 'warn', title: 'A VPN or virtual network is active', detail: `${names(vpn)}. While a VPN carries all traffic, everything goes through one connection: disconnect it for big downloads.` });
  }

  checks.push(proxyActive
    ? { id: 'proxy', status: 'fail', title: 'A proxy is set', detail: 'The fast engine does not go through proxies: set Network & Proxy to "System" without a proxy, or "Direct".' }
    : { id: 'proxy', status: 'ok', title: 'No proxy in the way' });

  if (platform === 'win32') {
    if (policy === 0) {
      checks.push({ id: 'windows', status: 'ok', title: 'Windows keeps all connections at once' });
    } else if (policy === 3) {
      checks.push({ id: 'windows', status: 'fail', title: 'Windows turns Wi-Fi off while a cable is connected', detail: 'The policy "Minimize the number of simultaneous connections" is set to "Prevent Wi-Fi when on Ethernet" (fMinimizeConnections = 3). Ask whoever manages this PC, or open Command Prompt as administrator and run: ' + POLICY_FIX + ' — then restart the PC.' });
    } else {
      checks.push({ id: 'windows', status: 'warn', title: 'Windows may drop one connection after a while', detail: 'By default Windows "minimizes simultaneous connections" and can disconnect the less preferred network. If one of them keeps disappearing, open Command Prompt as administrator and run: ' + POLICY_FIX + ' — then restart the PC.' });
    }
  }

  const verdict = checks.some((c) => c.status === 'fail') ? 'fail' : (checks.some((c) => c.status === 'warn') ? 'warn' : 'ok');
  return { verdict, checks, fix: POLICY_FIX };
}

module.exports = { evaluate, readMinimizePolicy, POLICY_KEY, POLICY_FIX };
