/**
 * AUTO-UPDATE MANAGER — updateManager.js
 *
 * Checks GitHub Releases for a newer SHMMOTH Browser and installs it — but ONLY after the
 * downloaded installer has been proven authentic:
 *
 *   1. strict release/asset validation (tag format, exact asset names, URL + redirect allow-list)
 *   2. size and (when GitHub publishes it) SHA-256 digest match
 *   3. a detached Ed25519 signature (<installer>.sig) verifies against a public key compiled into
 *      the app (updateKeys.js). The private key never lives on GitHub, so a compromised
 *      repository/token/release cannot push a malicious installer to users.
 *   4. the file is stored in a private per-user folder and re-hashed immediately before it is run
 *
 * Fail-closed: no configured key, no .sig asset, a bad signature … → nothing is run. When the
 * update cannot be installed automatically the user is pointed to the releases page instead.
 *
 * Networking goes through Electron's `net` (see updateFetch.js) so the browser's proxy applies.
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Loaded defensively: unit tests run this module in plain Node where Electron's API is absent.
let electron = {};
try { electron = require('electron') || {}; } catch (_) { electron = {}; }
const app = electron.app;

const { mainLogger: log } = require('../utils/logger');
const { verifyUpdateSignature, hashFile } = require('./updateSignature');
const { UPDATE_PUBLIC_KEYS } = require('./updateKeys');

const MAX_JSON_BYTES      = 1024 * 1024;           // release metadata
const MAX_SIGNATURE_BYTES = 4096;
const MAX_INSTALLER_BYTES = 600 * 1024 * 1024;     // hard ceiling even if the API claims more
const PROGRESS_INTERVAL_MS = 500;

/**
 * Compare two semver strings (e.g. "1.0.3" vs "1.0.2").
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/** Error whose message is safe to show to the user. */
class UpdateError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'E_UPDATE';
  }
}

class UpdateManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.storage]       Browser Storage instance
   * @param {Object} [options.updater]       Optional mock updater instance for unit tests
   * @param {Object} [options.fetcher]       HTTP client (see updateFetch.js); defaults to Electron `net`
   * @param {string[]} [options.publicKeys]  Trusted Ed25519 public keys (defaults to updateKeys.js)
   * @param {string} [options.updatesDir]    Private folder for downloaded installers
   * @param {string} [options.owner]/[options.repo]
   * @param {string} [options.apiBase]       Default https://api.github.com
   * @param {string} [options.downloadBase]  Default https://github.com
   * @param {string[]} [options.allowedHosts] Extra hosts allowed for API/download URLs (tests)
   * @param {boolean} [options.allowHttp]    Allow http:// (tests only — never set by the app)
   * @param {Function} [options.launcher]    async (installerPath) → error string ('' = ok)
   * @param {Function} [options.quitApp]
   * @param {Function} [options.prepareToQuit] async; called right before the installer is started (flush cookies to disk)
   */
  constructor(options = {}) {
    super();
    this.storage = options.storage || null;
    this.updater = options.updater || null;
    this.autoDownload = true;
    this.isDownloading = false;
    this._checking = null;

    this.githubOwner  = options.owner || 'jaydipvirja';
    this.githubRepo   = options.repo  || 'shmmoth-browser';
    this.apiBase      = (options.apiBase || 'https://api.github.com').replace(/\/+$/, '');
    this.downloadBase = (options.downloadBase || 'https://github.com').replace(/\/+$/, '');
    this.allowHttp    = Boolean(options.allowHttp);
    this.extraAllowedHosts = options.allowedHosts || [];
    this.publicKeys   = options.publicKeys || UPDATE_PUBLIC_KEYS;
    this._fetcher     = options.fetcher || null;
    this._updatesDir  = options.updatesDir || null;
    this._launcher    = options.launcher || null;
    this._quitApp     = options.quitApp || null;
    this._prepareToQuit = options.prepareToQuit || null;   // async () => void, runs right before the installer starts

    /** Set only after a download passed every check: { path, version, assetName, sha256, size } */
    this.verifiedUpdate = null;

    this._status = {
      status: 'idle',
      currentVersion: app && app.getVersion ? app.getVersion() : '1.0.0',
      availableVersion: null,
      message: 'Up to date',
      percent: 0,
      transferred: 0,
      total: 0,
      bytesPerSecond: 0,
      lastChecked: null,
      error: null,
      manualDownloadUrl: null,
      autoInstall: null          // true: downloaded + verified automatically; false: user must install manually
    };

    this._initialized = false;
  }

  /**
   * Initialize updater. If mock updater provided, wire its events.
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    if (this.updater && typeof this.updater.on === 'function') {
      this._setupMockListeners();
    }
  }

  /**
   * Wire mock updater event callbacks for testing.
   */
  _setupMockListeners() {
    this.updater.on('checking-for-update', () => {
      this._updateStatus({
        status: 'checking',
        message: 'Checking for updates...',
        error: null
      });
    });

    this.updater.on('update-available', (info) => {
      const version = info?.version || 'Unknown';
      this._updateStatus({
        status: 'available',
        availableVersion: version,
        message: `Update available: v${version}`,
        error: null
      });
    });

    this.updater.on('update-not-available', () => {
      this._updateStatus({
        status: 'not-available',
        lastChecked: new Date().toISOString(),
        message: 'SHMMOTH Browser is up to date.',
        error: null
      });
    });

    this.updater.on('download-progress', (progressObj) => {
      const percent = Math.round(progressObj?.percent || 0);
      this._updateStatus({
        status: 'downloading',
        percent,
        transferred: progressObj?.transferred || 0,
        total: progressObj?.total || 0,
        bytesPerSecond: progressObj?.bytesPerSecond || 0,
        message: `Downloading update (${percent}%)...`
      });
    });

    this.updater.on('update-downloaded', (info) => {
      const version = info?.version || this._status.availableVersion;
      this._updateStatus({
        status: 'downloaded',
        percent: 100,
        availableVersion: version,
        message: `Update v${version} downloaded. Relaunch to apply.`,
        error: null
      });
    });

    this.updater.on('error', (err) => {
      const errMsg = err?.message || String(err);
      if (log) log.warn('Auto-updater error encountered', { error: errMsg });
      this._updateStatus({
        status: 'error',
        error: errMsg,
        message: 'Unable to check for updates.'
      });
    });
  }

  /**
   * Internal status updater and event broadcaster.
   * @param {Object} patch
   */
  _updateStatus(patch) {
    Object.assign(this._status, patch);
    if (app && app.getVersion) {
      this._status.currentVersion = app.getVersion();
    }
    this.emit('status-changed', { ...this._status });
  }

  /**
   * Retrieve current update status.
   * @returns {Object}
   */
  getStatus() {
    if (app && app.getVersion) {
      this._status.currentVersion = app.getVersion();
    }
    return { ...this._status };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _getFetcher() {
    if (!this._fetcher) this._fetcher = require('./updateFetch').createElectronFetcher(electron);
    return this._fetcher;
  }

  _getUpdatesDir() {
    if (!this._updatesDir) {
      let base;
      try { base = app.getPath('userData'); } catch (_) { base = os.tmpdir(); }
      this._updatesDir = path.join(base, 'updates');
    }
    fs.mkdirSync(this._updatesDir, { recursive: true, mode: 0o700 });
    return this._updatesDir;
  }

  /** Every URL we talk to (including each redirect hop) must pass this. */
  _validateUrl(rawUrl) {
    let u;
    try { u = new URL(rawUrl); } catch (_) { throw new UpdateError('Update server returned an invalid URL', 'E_URL'); }
    const httpsOk = u.protocol === 'https:';
    const httpOk = this.allowHttp && u.protocol === 'http:';
    if (!httpsOk && !httpOk) throw new UpdateError('Update URL must use HTTPS', 'E_URL');
    const host = u.hostname.toLowerCase();
    const ok = host === 'api.github.com' || host === 'github.com'
      || host.endsWith('.githubusercontent.com') || host === 'githubusercontent.com'
      || this.extraAllowedHosts.includes(host);
    if (!ok) throw new UpdateError(`Update URL points to an untrusted host (${host})`, 'E_HOST');
    return u;
  }

  async _readLimited(stream, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > maxBytes) { stream.destroy(); throw new UpdateError('Update server response is too large', 'E_SIZE'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async _getBuffer(url, maxBytes, accept) {
    const res = await this._getFetcher().get(url, {
      headers: { 'User-Agent': 'shmmoth-browser', Accept: accept },
      validateUrl: (u) => this._validateUrl(u)
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      if (res.abort) res.abort();
      throw new UpdateError(`Update server answered HTTP ${res.statusCode}`, 'E_HTTP');
    }
    return this._readLimited(res.stream, maxBytes);
  }

  _installerName(version) { return `SHMMOTH-Browser-Setup-${version}.exe`; }

  /** Strictly validates the GitHub release document and extracts what we need. */
  _parseRelease(release) {
    if (!release || typeof release !== 'object') throw new UpdateError('Unexpected update server response', 'E_RELEASE');
    const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(release.tag_name || ''));
    if (!m) throw new UpdateError('Release has an unsupported version tag', 'E_RELEASE');
    if (release.draft === true || release.prerelease === true) throw new UpdateError('Latest release is not a final release', 'E_RELEASE');
    const version = `${m[1]}.${m[2]}.${m[3]}`;
    const tag = release.tag_name;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const releasePrefix = `${this.downloadBase}/${this.githubOwner}/${this.githubRepo}/releases/download/${tag}/`;

    const pick = (name) => {
      const a = assets.find(x => x && x.name === name);
      if (!a) return null;
      if (typeof a.browser_download_url !== 'string' || a.browser_download_url !== releasePrefix + encodeURIComponent(name)) {
        throw new UpdateError('Release asset has an unexpected download URL', 'E_RELEASE');
      }
      return a;
    };
    const installerName = this._installerName(version);
    const installer = pick(installerName);
    const signature = pick(installerName + '.sig');

    let releaseUrl = `https://github.com/${this.githubOwner}/${this.githubRepo}/releases/latest`;
    if (typeof release.html_url === 'string' && release.html_url.startsWith(`https://github.com/${this.githubOwner}/${this.githubRepo}/`)) {
      releaseUrl = release.html_url;
    }
    return { version, tag, installerName, installer, signature, releaseUrl };
  }

  // ─── Check ────────────────────────────────────────────────────────────────

  /**
   * Trigger an update check.
   * @returns {Promise<Object>}
   */
  async checkForUpdates() {
    this.init();

    // If unit test mock updater is provided:
    if (this.updater && typeof this.updater.checkForUpdates === 'function') {
      this._updateStatus({
        status: 'checking',
        message: 'Checking for updates...',
        error: null
      });
      await this.updater.checkForUpdates();
      return { ...this._status };
    }

    if (this._checking) return this._checking;                    // collapse concurrent checks
    this._checking = this._check().finally(() => { this._checking = null; });
    return this._checking;
  }

  async _check() {
    // A download that is already verified and waiting for the user must not be disturbed
    if (this.isDownloading) return { ...this._status };

    this._updateStatus({ status: 'checking', message: 'Checking for updates...', error: null, manualDownloadUrl: null, autoInstall: null });

    try {
      const releaseUrl = `${this.apiBase}/repos/${this.githubOwner}/${this.githubRepo}/releases/latest`;
      if (log) log.info('Checking GitHub releases', { url: releaseUrl });

      const body = await this._getBuffer(releaseUrl, MAX_JSON_BYTES, 'application/vnd.github+json');
      let release;
      try { release = JSON.parse(body.toString('utf8')); } catch (_) { throw new UpdateError('Update server returned invalid data', 'E_RELEASE'); }
      const info = this._parseRelease(release);
      const currentVer = this._status.currentVersion || (app && app.getVersion ? app.getVersion() : '1.0.0');

      if (log) log.info('Release lookup complete', { remoteVersion: info.version, currentVer });

      if (compareSemver(info.version, currentVer) <= 0) {
        this._updateStatus({
          status: 'not-available',
          lastChecked: new Date().toISOString(),
          message: 'SHMMOTH Browser is up to date.',
          error: null
        });
        return { ...this._status };
      }

      // Already downloaded and verified (e.g. the user pressed "check" again while it waits for a restart)
      if (this.verifiedUpdate && compareSemver(this.verifiedUpdate.version, info.version) >= 0 && fs.existsSync(this.verifiedUpdate.path)) {
        this._updateStatus({
          status: 'downloaded', percent: 100, availableVersion: this.verifiedUpdate.version,
          message: `Update v${this.verifiedUpdate.version} downloaded and verified. Relaunch to apply.`, error: null
        });
        return { ...this._status };
      }

      // A newer version exists. Can we install it by ourselves, safely?
      const base = { availableVersion: info.version, manualDownloadUrl: info.releaseUrl, error: null, autoInstall: false };
      if (!info.installer) {
        this._updateStatus({ ...base, status: 'available', message: `Update v${info.version} is available. Download it from the releases page.` });
      } else if (!Array.isArray(this.publicKeys) || this.publicKeys.length === 0) {
        if (log) log.warn('Update available but automatic install is disabled: no update signing key is configured');
        this._updateStatus({ ...base, status: 'available',
          message: `Update v${info.version} is available. Automatic install is disabled (no update signing key is configured) — download it from the releases page.` });
      } else if (!info.signature) {
        if (log) log.warn('Update available but the release has no .sig asset; not installing automatically', { version: info.version });
        this._updateStatus({ ...base, status: 'available',
          message: `Update v${info.version} is available but is not signed, so it will not be installed automatically. Download it from the releases page.` });
      } else {
        this._updateStatus({ ...base, autoInstall: true, status: 'available', message: `Update available: v${info.version}` });
        if (this.autoDownload && !this.isDownloading) {
          this.downloadUpdate(info).catch(err => {
            if (log) log.warn('Update download error', { error: err.message });
          });
        }
      }
      return { ...this._status };
    } catch (err) {
      const errMsg = err?.message || String(err);
      if (log) log.warn('checkForUpdates failed', { error: errMsg });
      this._updateStatus({
        status: 'error',
        error: errMsg,
        message: err instanceof UpdateError ? errMsg : 'Could not connect to update server.'
      });
      return { ...this._status };
    }
  }

  // ─── Download + verify ────────────────────────────────────────────────────

  /**
   * Downloads the installer + signature, verifies everything and, only then, marks it installable.
   * @param {{version:string, installerName:string, installer:Object, signature:Object}} info from _parseRelease
   */
  async downloadUpdate(info) {
    if (this.isDownloading) return;
    this.isDownloading = true;
    this.verifiedUpdate = null;

    const dir = this._getUpdatesDir();
    this._cleanUpdatesDir(dir);
    const finalPath = path.join(dir, info.installerName);
    const partPath = finalPath + '.part';

    try {
      this._updateStatus({
        status: 'downloading', percent: 0, transferred: 0, total: info.installer.size || 0,
        bytesPerSecond: 0, message: 'Starting update download...', error: null
      });

      // 1. the (tiny) signature first: fail fast if it is missing or malformed
      const sigBuf = await this._getBuffer(info.signature.browser_download_url, MAX_SIGNATURE_BYTES, 'application/octet-stream');
      const signatureFileText = sigBuf.toString('utf8');

      // 2. the installer, streamed to disk while hashing
      const expectedSize = Number.isSafeInteger(info.installer.size) && info.installer.size > 0 ? info.installer.size : 0;
      if (expectedSize > MAX_INSTALLER_BYTES) throw new UpdateError('Update installer is unexpectedly large', 'E_SIZE');
      const maxBytes = expectedSize || MAX_INSTALLER_BYTES;

      const res = await this._getFetcher().get(info.installer.browser_download_url, {
        headers: { 'User-Agent': 'shmmoth-browser', Accept: 'application/octet-stream' },
        validateUrl: (u) => this._validateUrl(u)
      });
      if (res.statusCode !== 200) {
        if (res.abort) res.abort();
        throw new UpdateError(`Update server answered HTTP ${res.statusCode}`, 'E_HTTP');
      }
      const declared = parseInt(res.headers['content-length'], 10);
      if (expectedSize && Number.isFinite(declared) && declared !== expectedSize) {
        if (res.abort) res.abort();
        throw new UpdateError('Update installer size does not match the release metadata', 'E_SIZE');
      }

      const hash = crypto.createHash('sha256');
      let received = 0;
      let lastTime = Date.now();
      let lastReceived = 0;
      const fh = await fs.promises.open(partPath, 'w', 0o600);
      try {
        for await (const chunk of res.stream) {
          received += chunk.length;
          if (received > maxBytes) { if (res.abort) res.abort(); throw new UpdateError('Update installer is larger than announced', 'E_SIZE'); }
          hash.update(chunk);
          await fh.write(chunk);

          const now = Date.now();
          if (now - lastTime >= PROGRESS_INTERVAL_MS) {
            const bytesPerSecond = Math.round((received - lastReceived) / ((now - lastTime) / 1000));
            lastTime = now; lastReceived = received;
            const total = expectedSize || declared || 0;
            const percent = total > 0 ? Math.round((received / total) * 100) : 0;
            this._updateStatus({ status: 'downloading', percent, transferred: received, total, bytesPerSecond, message: `Downloading update (${percent}%)...` });
          }
        }
        await fh.sync();
      } finally {
        await fh.close();
      }
      const sha256 = hash.digest('hex');

      // 3. verify
      this._updateStatus({ status: 'downloading', percent: 100, transferred: received, total: received, bytesPerSecond: 0, message: 'Verifying update...' });

      if (expectedSize && received !== expectedSize) throw new UpdateError('Update installer is incomplete', 'E_SIZE');

      const published = typeof info.installer.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(info.installer.digest) : null;
      if (published && published[1].toLowerCase() !== sha256) {
        throw new UpdateError('Downloaded update does not match its published checksum and was discarded', 'E_DIGEST');
      }

      const verdict = verifyUpdateSignature({
        assetName: info.installerName, size: received, sha256, signatureFileText, publicKeys: this.publicKeys
      });
      if (!verdict.ok) {
        if (log) log.error('Update signature verification FAILED; installer discarded', { version: info.version, reason: verdict.reason });
        throw new UpdateError('The update could not be verified (invalid signature) and was discarded', 'E_SIGNATURE');
      }

      fs.renameSync(partPath, finalPath);
      this.verifiedUpdate = { path: finalPath, version: info.version, assetName: info.installerName, sha256, size: received };
      this.isDownloading = false;
      if (log) log.info('Update downloaded and signature verified', { version: info.version, sha256 });

      this._updateStatus({
        status: 'downloaded', percent: 100, availableVersion: info.version,
        message: `Update v${info.version} downloaded and verified. Relaunch to apply.`, error: null
      });
    } catch (err) {
      this.isDownloading = false;
      this.verifiedUpdate = null;
      try { fs.rmSync(partPath, { force: true }); } catch (_) { /* ignore */ }
      try { fs.rmSync(finalPath, { force: true }); } catch (_) { /* ignore */ }
      const errMsg = err?.message || String(err);
      if (log) log.warn('Download update failed', { error: errMsg, code: err.code });
      this._updateStatus({
        status: 'error', error: errMsg,
        message: err instanceof UpdateError ? errMsg : 'Failed to download update.'
      });
    }
  }

  _cleanUpdatesDir(dir) {
    try {
      for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true, recursive: true });
    } catch (_) { /* best effort */ }
  }

  // ─── Install ──────────────────────────────────────────────────────────────

  /**
   * Quit the browser and apply the downloaded update.
   * Returns a boolean for the (test) mock updater, otherwise a Promise<boolean>.
   */
  quitAndInstall() {
    if (this.updater && typeof this.updater.quitAndInstall === 'function') {
      if (log) log.info('Triggering mock quitAndInstall');
      this.updater.quitAndInstall(false, true);
      return true;
    }
    return this._installVerified();
  }

  async _installVerified() {
    const v = this.verifiedUpdate;
    if (!v) {
      if (log) log.warn('quitAndInstall called but there is no verified update');
      return false;
    }

    // The file sat on disk since download: prove it is still exactly what was verified
    try {
      const { sha256, size } = await hashFile(v.path);
      if (sha256 !== v.sha256 || size !== v.size) throw new UpdateError('The downloaded update changed on disk after it was verified', 'E_TAMPERED');
    } catch (err) {
      if (log) log.error('Refusing to run the update installer', { error: err.message });
      try { fs.rmSync(v.path, { force: true }); } catch (_) { /* ignore */ }
      this.verifiedUpdate = null;
      this._updateStatus({
        status: 'error', error: err.message,
        message: err instanceof UpdateError ? 'The downloaded update failed its final integrity check and was discarded.' : 'The downloaded update could not be read.'
      });
      return false;
    }

    if (this._prepareToQuit) {
      // the installer closes the running browser, possibly the hard way: write cookies and storage first
      try {
        await Promise.race([this._prepareToQuit(), new Promise((resolve) => setTimeout(resolve, 4000))]);
      } catch (err) { if (log) log.warn('Preparing to quit failed', { error: err.message }); }
    }

    if (log) log.info('Launching verified installer', { path: v.path, version: v.version });
    try {
      const failure = await this._launch(v.path);
      if (failure) throw new Error(failure);
    } catch (err) {
      if (log) log.error('Failed to launch installer', { error: err.message });
      this._updateStatus({ status: 'error', error: err.message, message: 'Could not start the update installer.' });
      return false;
    }

    setTimeout(() => {
      if (this._quitApp) this._quitApp();
      else if (app && app.quit) app.quit();
    }, 800);
    return true;
  }

  async _launch(installerPath) {
    if (this._launcher) return this._launcher(installerPath);
    if (electron.shell && typeof electron.shell.openPath === 'function') {
      return electron.shell.openPath(installerPath);       // '' on success, otherwise an error string
    }
    const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    return '';
  }
}

UpdateManager.compareSemver = compareSemver;
UpdateManager.UpdateError = UpdateError;

module.exports = UpdateManager;
