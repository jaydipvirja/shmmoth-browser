/**
 * AUTO-UPDATE MANAGER — updateManager.js
 *
 * Provides background and on-demand software updates for SHMMOTH Browser
 * via native GitHub Releases API, adhering to Chromium's update workflow.
 *
 * Designed to be 100% stable, crash-free, and independent of fragile Chromium net-stack hooks.
 */

'use strict';

const EventEmitter = require('events');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { app } = require('electron');
const { mainLogger: log } = require('../utils/logger');

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

/**
 * Follow HTTP/HTTPS redirects and stream data.
 */
function fetchWithRedirects(url, headers = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));

    const req = https.get(url, { headers: { 'User-Agent': 'shmmoth-browser', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchWithRedirects(res.headers.location, headers, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }
      resolve(res);
    });

    req.on('error', reject);
  });
}

class UpdateManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.storage] - Browser Storage instance
   * @param {Object} [options.updater] - Optional mock updater instance for unit tests
   */
  constructor(options = {}) {
    super();
    this.storage = options.storage || null;
    this.updater = options.updater || null;
    this.autoDownload = true;
    this.downloadedInstallerPath = null;
    this.isDownloading = false;

    this.githubOwner = 'jaydipvirja';
    this.githubRepo = 'shmmoth-browser';

    this._status = {
      status: 'idle',
      currentVersion: app ? app.getVersion() : '1.0.0',
      availableVersion: null,
      message: 'Up to date',
      percent: 0,
      transferred: 0,
      total: 0,
      bytesPerSecond: 0,
      lastChecked: null,
      error: null
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
    if (app) {
      this._status.currentVersion = app.getVersion();
    }
    this.emit('status-changed', { ...this._status });
  }

  /**
   * Retrieve current update status.
   * @returns {Object}
   */
  getStatus() {
    if (app) {
      this._status.currentVersion = app.getVersion();
    }
    return { ...this._status };
  }

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

    // In dev mode (unpackaged app), skip unless forced
    if (app && !app.isPackaged && !process.env.FORCE_UPDATE_CHECK) {
      if (log) log.info('Skipping auto-update check in development mode');
      this._updateStatus({
        status: 'not-available',
        lastChecked: new Date().toISOString(),
        message: `SHMMOTH Browser v${this._status.currentVersion} (Development build).`,
        error: null
      });
      return { ...this._status };
    }

    this._updateStatus({
      status: 'checking',
      message: 'Checking for updates...',
      error: null
    });

    try {
      const releaseUrl = `https://api.github.com/repos/${this.githubOwner}/${this.githubRepo}/releases/latest`;
      if (log) log.info('Checking GitHub releases', { url: releaseUrl });

      const res = await fetchWithRedirects(releaseUrl, { Accept: 'application/vnd.github+json' });
      let data = '';
      for await (const chunk of res) {
        data += chunk;
      }
      const release = JSON.parse(data);
      const remoteVersion = (release.tag_name || '').replace(/^v/, '');
      const currentVer = this._status.currentVersion || (app ? app.getVersion() : '1.0.0');

      if (log) log.info('Release lookup complete', { remoteVersion, currentVer });

      if (compareSemver(remoteVersion, currentVer) > 0) {
        // Find Windows executable asset
        const asset = (release.assets || []).find(a => a.name.endsWith('.exe') && !a.name.includes('uninstaller'));

        this._updateStatus({
          status: 'available',
          availableVersion: remoteVersion,
          message: `Update available: v${remoteVersion}`,
          error: null
        });

        if (this.autoDownload && asset && !this.isDownloading) {
          this.downloadUpdate(asset, remoteVersion).catch(err => {
            if (log) log.warn('Update download error', { error: err.message });
          });
        }
      } else {
        this._updateStatus({
          status: 'not-available',
          lastChecked: new Date().toISOString(),
          message: 'SHMMOTH Browser is up to date.',
          error: null
        });
      }

      return { ...this._status };
    } catch (err) {
      const errMsg = err?.message || String(err);
      if (log) log.warn('checkForUpdates failed', { error: errMsg });
      this._updateStatus({
        status: 'error',
        error: errMsg,
        message: 'Could not connect to update server.'
      });
      return { ...this._status };
    }
  }

  /**
   * Download the update asset directly with progress events.
   */
  async downloadUpdate(asset, version) {
    if (this.isDownloading) return;
    this.isDownloading = true;

    const tempDir = app ? app.getPath('temp') : os.tmpdir();
    const destPath = path.join(tempDir, asset.name || `SHMMOTH-Browser-Setup-${version}.exe`);
    this.downloadedInstallerPath = destPath;

    if (log) log.info('Starting update download', { url: asset.browser_download_url, dest: destPath });

    this._updateStatus({
      status: 'downloading',
      percent: 0,
      transferred: 0,
      total: asset.size || 0,
      bytesPerSecond: 0,
      message: 'Starting update download...'
    });

    try {
      const fileStream = fs.createWriteStream(destPath);
      const res = await fetchWithRedirects(asset.browser_download_url);
      const totalBytes = parseInt(res.headers['content-length'], 10) || asset.size || 0;
      let transferredBytes = 0;
      let lastTime = Date.now();
      let lastTransferred = 0;

      res.on('data', (chunk) => {
        transferredBytes += chunk.length;
        fileStream.write(chunk);

        const now = Date.now();
        if (now - lastTime >= 500) {
          const deltaSec = (now - lastTime) / 1000;
          const bytesPerSecond = Math.round((transferredBytes - lastTransferred) / deltaSec);
          lastTime = now;
          lastTransferred = transferredBytes;
          const percent = totalBytes > 0 ? Math.round((transferredBytes / totalBytes) * 100) : 0;

          this._updateStatus({
            status: 'downloading',
            percent,
            transferred: transferredBytes,
            total: totalBytes,
            bytesPerSecond,
            message: `Downloading update (${percent}%)...`
          });
        }
      });

      await new Promise((resolve, reject) => {
        res.on('end', () => {
          fileStream.end();
          resolve();
        });
        res.on('error', (err) => {
          fileStream.destroy();
          reject(err);
        });
        fileStream.on('error', reject);
      });

      this.isDownloading = false;
      if (log) log.info('Update download complete', { file: destPath });

      this._updateStatus({
        status: 'downloaded',
        percent: 100,
        availableVersion: version,
        message: `Update v${version} downloaded. Relaunch to apply.`,
        error: null
      });
    } catch (err) {
      this.isDownloading = false;
      const errMsg = err?.message || String(err);
      if (log) log.warn('Download update failed', { error: errMsg });
      this._updateStatus({
        status: 'error',
        error: errMsg,
        message: 'Failed to download update.'
      });
    }
  }

  /**
   * Quit the browser and apply downloaded update.
   */
  quitAndInstall() {
    if (this.updater && typeof this.updater.quitAndInstall === 'function') {
      if (log) log.info('Triggering mock quitAndInstall');
      this.updater.quitAndInstall(false, true);
      return true;
    }

    if (this.downloadedInstallerPath && fs.existsSync(this.downloadedInstallerPath)) {
      if (log) log.info('Launching downloaded installer', { path: this.downloadedInstallerPath });

      try {
        const child = spawn(this.downloadedInstallerPath, ['--updated'], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();

        setTimeout(() => {
          if (app) app.quit();
        }, 500);

        return true;
      } catch (err) {
        if (log) log.error('Failed to spawn installer', { error: err.message });
        return false;
      }
    }

    return false;
  }
}

module.exports = UpdateManager;
