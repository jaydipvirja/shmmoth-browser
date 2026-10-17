/**
 * Default browser (Settings → General): is SHMMOTH the browser Windows opens links with, and the way to make it so.
 *
 * The installer registers SHMMOTH as a browser (build/installer.nsh: StartMenuInternet, RegisteredApplications and
 * the SHMMOTHURL link handler). Since Windows 10 only the user can pick the default browser, so "Make default" opens
 * Windows' own Default apps page at SHMMOTH's entry. The registry is read with reg.exe and fixed arguments; nothing
 * is written here.
 */
'use strict';

const { execFile } = require('child_process');

const CLIENT = 'SHMMOTH Browser';
const PROG_ID = 'SHMMOTHURL';
const REGISTERED_APPS = 'Software\\RegisteredApplications';
const USER_CHOICE = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice';

/** The data of value `name` in `reg query` output, or null. */
function parseRegValue(stdout, name) {
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /^\s+(.+?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/.exec(line);
    if (m && m[1].toLowerCase() === String(name).toLowerCase()) return m[3].trim();
  }
  return null;
}

function regQuery(key, value, run = execFile) {
  return new Promise((resolve) => {
    run('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : parseRegValue(stdout, value));
    });
  });
}

/**
 * { supported, registered, scope: 'user'|'machine'|null, isDefault }
 * supported: Windows only; registered: the installer's entry exists (not in a development run).
 */
async function getStatus({ platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32') return { supported: false, registered: false, scope: null, isDefault: false };
  const [user, machine, choice] = await Promise.all([
    regQuery('HKCU\\' + REGISTERED_APPS, CLIENT, run),
    regQuery('HKLM\\' + REGISTERED_APPS, CLIENT, run),
    regQuery(USER_CHOICE, 'ProgId', run)
  ]);
  const scope = user ? 'user' : (machine ? 'machine' : null);
  return { supported: true, registered: Boolean(scope), scope, isDefault: choice === PROG_ID };
}

/** Windows' Default apps page, opened at SHMMOTH's entry. */
function settingsUrl(scope) {
  const param = scope === 'machine' ? 'registeredAppMachine' : 'registeredAppUser';
  return `ms-settings:defaultapps?${param}=${encodeURIComponent(CLIENT)}`;
}

module.exports = { getStatus, settingsUrl, parseRegValue, CLIENT, PROG_ID };
