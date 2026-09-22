/**
 * AUTO-UPDATE MANAGER — updateManager.js
 *
 * Provides background and on-demand software updates for SHMMOTH Browser
 * via electron-updater, adhering to Chromium's update workflow.
 *
 * FEATURES:
 * - Checks GitHub Releases / update server for newer releases
 * - Automatic background download of differential blockmaps
 * - Chrome-style status states: idle, checking, available, downloading, downloaded, not-available, error
 * - Safe handling of development environments (unpackaged dev builds)
 * - IPC event emissions to browser chrome and Settings UI
 */

'use strict';

const EventEmitter = require('events');
const { app } = require('electron');
const { mainLogger: log } = require('../utils/logger');

class UpdateManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.storage] - Browser Storage instance
   * @param {Object} [options.updater] - Optional mock or custom updater instance
   */
  constructor(options = {}) {
    super();
    this.storage = options.storage || null;
    this.updater = options.updater || null;
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
   * Initialize electron-updater listeners and configuration.
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    if (!this.updater) {
      try {
        const { autoUpdater } = require('electron-updater');
        this.updater = autoUpdater;
      } catch (err) {
        if (log) log.warn('electron-updater could not be loaded', { error: err.message });
      }
    }

    if (!this.updater) {
      return;
    }

    try {
      this.updater.autoDownload = true;
      this.updater.autoInstallOnAppQuit = true;
      this.updater.logger = {
        info: (msg) => { if (log) log.info(`[UPDATER] ${msg}`); },
        warn: (msg) => { if (log) log.warn(`[UPDATER] ${msg}`); },
        error: (msg) => { if (log) log.error(`[UPDATER] ${msg}`); },
        debug: () => {}
      };
    } catch (e) {
      // ignore
    }

    this._setupListeners();
  }

  /**
   * Wire updater event callbacks.
   */
  _setupListeners() {
    if (!this.updater || typeof this.updater.on !== 'function') return;

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

    // In dev mode (unpackaged app), electron-updater cannot verify against a signed release without dev-app-update.yml
    if (app && !app.isPackaged && !process.env.FORCE_UPDATE_CHECK) {
      if (log) log.info('Skipping auto-update check in development mode (app is not packaged)');
      this._updateStatus({
        status: 'not-available',
        lastChecked: new Date().toISOString(),
        message: `SHMMOTH Browser v${this._status.currentVersion} (Development build). Auto-updates are active in packaged .exe.`,
        error: null
      });
      return { ...this._status };
    }

    if (!this.updater || typeof this.updater.checkForUpdates !== 'function') {
      this._updateStatus({
        status: 'error',
        message: 'Update service is unavailable.',
        error: 'Updater not initialized'
      });
      return { ...this._status };
    }

    this._updateStatus({
      status: 'checking',
      message: 'Checking for updates...',
      error: null
    });

    try {
      await this.updater.checkForUpdates();
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
   * Quit the browser and apply downloaded update.
   */
  quitAndInstall() {
    if (this.updater && typeof this.updater.quitAndInstall === 'function') {
      if (log) log.info('Triggering quitAndInstall');
      this.updater.quitAndInstall(false, true);
      return true;
    }
    return false;
  }
}

module.exports = UpdateManager;
