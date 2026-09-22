/**
 * DOWNLOAD MANAGER — downloadManager.js
 *
 * Handles all file download lifecycle events for SHMMOTH Browser.
 * Stage 3 / Core: Pause, resume, cancel, open file, show in folder, retry, remove,
 * and persistent download history.
 *
 * ROBUST NATIVE PIPELINE:
 *   ✓ Safe filename sanitization (illegal Windows characters, path traversal, reserved names).
 *   ✓ Automatic duplicate name resolution (file (1).ext) without overwriting.
 *   ✓ Ensures target download directory exists before saving.
 *   ✓ Real-time transfer speed (bytes/sec) and ETA remaining estimation.
 *   ✓ Partial file (.crdownload) cleanup upon user cancellation.
 *   ✓ Full Incognito isolation: in-memory tracking only, never persisted to disk.
 *   ✓ "Ask where to save each file" integration via dialog callback.
 *   ✓ Multi-target IPC push to active browser tabs and chrome windows.
 *
 * SECURITY GUARANTEES:
 *   ✗ Downloaded files are NEVER automatically opened or executed.
 *   ✓ The user can manually open files or containing folders only via explicit UI action.
 *   ✓ Downloaded paths are strictly verified to exist before opening.
 */

'use strict';

const path  = require('path');
const fs    = require('fs');
const { app, shell } = require('electron');
const { downloadLogger: log } = require('../utils/logger');
const TurboDownloadEngine = require('./turboDownloadEngine');

let _idCounter = 1;
function generateId() {
  return `dl_${Date.now()}_${_idCounter++}`;
}

/**
 * Sanitizes a filename received from the server or URL.
 * - Strips directory traversal (../, ..\, etc.)
 * - Strips invalid Windows & POSIX characters (< > : " / \ | ? *)
 * - Avoids Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 * - Truncates excessively long filenames safely preserving the extension
 * - Returns a safe fallback if empty
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'download';

  // Strip null bytes and control characters
  let clean = name.replace(/[\x00-\x1f\x80-\x9f]/g, '').trim();

  // Strip directory paths and path traversal
  clean = path.basename(clean);

  // Replace invalid characters for Windows and Unix: < > : " / \ | ? *
  clean = clean.replace(/[<>:"/\\|?*]/g, '_');

  // Remove trailing dots and spaces (forbidden on Windows)
  clean = clean.replace(/[. ]+$/, '');

  // Extract extension and check for Windows reserved device names
  const ext = path.extname(clean);
  const base = path.basename(clean, ext).toUpperCase();
  const reservedRegex = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/;
  if (reservedRegex.test(base)) {
    clean = `_${clean}`;
  }

  // Length safety limit (max 240 chars)
  if (clean.length > 240) {
    const extLen = ext.length;
    clean = clean.substring(0, 240 - extLen) + ext;
  }

  return clean || 'download';
}

/**
 * Resolves a unique file path within a directory by appending (1), (2), etc.
 * if a file or partial .crdownload file already exists.
 *
 * @param {string} dir Target directory
 * @param {string} filename Base filename
 * @returns {string} Absolute unique path
 */
function getUniqueSavePath(dir, filename) {
  let targetPath = path.join(dir, filename);
  if (!fs.existsSync(targetPath) && !fs.existsSync(`${targetPath}.crdownload`)) {
    return targetPath;
  }

  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let counter = 1;

  while (counter < 1000) {
    const candidateName = `${base} (${counter})${ext}`;
    const candidatePath = path.join(dir, candidateName);
    if (!fs.existsSync(candidatePath) && !fs.existsSync(`${candidatePath}.crdownload`)) {
      return candidatePath;
    }
    counter++;
  }

  return path.join(dir, `${base}_${Date.now()}${ext}`);
}

/**
 * Safely removes a partial file and any .crdownload temporary files from disk.
 *
 * @param {string} filePath
 */
function cleanupPartialFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {}
  try {
    const crdownload = `${filePath}.crdownload`;
    if (fs.existsSync(crdownload)) {
      fs.unlinkSync(crdownload);
    }
  } catch (_) {}
}

class DownloadManager {
  /**
   * @param {object|null} storage StorageService instance
   * @param {object} [options]
   * @param {function} [options.promptSaveDialog] Optional async callback for "Ask where to save"
   */
  constructor(storage = null, options = {}) {
    this.storage = storage;
    this.downloads = {};
    this._onUpdate = null;
    this._promptSaveDialog = options.promptSaveDialog || null;

    // Turbo Multi-Thread & Multi-Source Internet Bonding Engine
    this.turboEngine = new TurboDownloadEngine({
      defaultThreads: 8,
      minTurboSize: 2 * 1024 * 1024,
      multiSource: true
    });

    this._setupTurboListeners();
    this._resolveSaveDir();
    this._loadPersisted();
  }

  _setupTurboListeners() {
    this.turboEngine.on('progress', (prog) => {
      const record = this.downloads[prog.id];
      if (!record) return;
      record.received = prog.received;
      record.total = prog.total;
      record.speed = prog.speed;
      record.eta = prog.eta;
      record.isTurbo = prog.isTurbo;
      record.isMultiSource = prog.isMultiSource;
      record.threadsCount = prog.threads;
      record.segments = prog.segments;
      record.interfaces = prog.interfaces;
      record.state = prog.state;
      this._notify(record);
    });

    this.turboEngine.on('completed', (data) => {
      const record = this.downloads[data.id];
      if (!record) return;
      record.state = 'completed';
      record.isPaused = false;
      record.endedAt = Date.now();
      record.received = data.received;
      record.total = data.total;
      record.speed = 0;
      record.eta = null;
      log.info(`Turbo download completed: ${record.filename}`, { id: data.id, savePath: data.savePath });
      this._notify(record);
      this._persist();
    });

    this.turboEngine.on('error', (data) => {
      const record = this.downloads[data.id];
      if (!record) return;
      record.state = 'interrupted';
      record.isPaused = false;
      record.endedAt = Date.now();
      record.speed = 0;
      record.eta = null;
      log.warn(`Turbo download error: ${record.filename}`, { id: data.id, error: data.error });
      this._notify(record);
      this._persist();
    });

    this.turboEngine.on('paused', (data) => {
      const record = this.downloads[data.id];
      if (!record) return;
      record.state = 'paused';
      record.isPaused = true;
      record.speed = 0;
      record.eta = null;
      this._notify(record);
    });

    this.turboEngine.on('resumed', (data) => {
      const record = this.downloads[data.id];
      if (!record) return;
      record.state = 'progressing';
      record.isPaused = false;
      this._notify(record);
    });

    this.turboEngine.on('cancelled', (data) => {
      const record = this.downloads[data.id];
      if (!record) return;
      record.state = 'cancelled';
      record.isPaused = false;
      record.speed = 0;
      record.eta = null;
      record.endedAt = Date.now();
      this._notify(record);
      this._persist();
    });
  }

  /**
   * Resolves the default download directory from settings or system defaults.
   */
  _resolveSaveDir() {
    let customPath = '';
    if (this.storage) {
      try {
        const settings = this.storage.getSettings ? this.storage.getSettings() : (this.storage.get('settings') || {});
        if (settings && settings.downloadPath && typeof settings.downloadPath === 'string') {
          customPath = settings.downloadPath.trim();
        }
      } catch (_) {}
    }

    if (customPath) {
      try {
        if (!fs.existsSync(customPath)) {
          fs.mkdirSync(customPath, { recursive: true });
        }
        this._saveDir = customPath;
        return;
      } catch (err) {
        log.warn('Configured downloadPath inaccessible, falling back to system downloads', { error: err.message });
      }
    }

    try {
      this._saveDir = app.getPath('downloads');
    } catch (_) {
      try {
        this._saveDir = app.getPath('userData');
      } catch (__) {
        this._saveDir = process.cwd();
      }
    }

    try {
      if (!fs.existsSync(this._saveDir)) {
        fs.mkdirSync(this._saveDir, { recursive: true });
      }
    } catch (_) {}
  }

  /**
   * Gets the current effective download directory.
   * @returns {string}
   */
  getSaveDir() {
    this._resolveSaveDir();
    return this._saveDir;
  }

  /**
   * Sets a custom download directory and ensures it exists.
   * @param {string} newDir
   */
  setSaveDir(newDir) {
    if (!newDir || typeof newDir !== 'string') return;
    try {
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }
      this._saveDir = newDir;
      if (this.storage && this.storage.updateSettings) {
        this.storage.updateSettings({ downloadPath: newDir });
      }
    } catch (err) {
      log.error('Failed to set download directory', { error: err.message });
    }
  }

  /**
   * Checks whether "Ask where to save each file before downloading" is enabled.
   * @returns {boolean}
   */
  shouldAskWhereToSave() {
    if (this.storage) {
      try {
        const settings = this.storage.getSettings ? this.storage.getSettings() : (this.storage.get('settings') || {});
        return Boolean(settings && settings.askWhereToSave);
      } catch (_) {}
    }
    return false;
  }

  _loadPersisted() {
    if (this.storage) {
      try {
        const list = this.storage.get('downloads', []);
        if (Array.isArray(list)) {
          list.forEach(r => {
            if (r && r.id) {
              this.downloads[r.id] = {
                ...r,
                speed: 0,
                eta: null,
                isIncognito: false, // Persisted records are strictly non-incognito
                item: null          // Inactive item
              };
            }
          });
        }
      } catch (err) {
        log.warn('Could not load persisted downloads', { error: err.message });
      }
    }
  }

  _persist() {
    if (this.storage) {
      try {
        // Incognito downloads are strictly ephemeral and NEVER persisted
        const serialized = Object.values(this.downloads)
          .filter(r => !r.isIncognito)
          .map(r => this._serialize(r));
        this.storage.set('downloads', serialized);
      } catch (err) {
        log.warn('Could not persist downloads', { error: err.message });
      }
    }
  }

  /**
   * Attaches DownloadManager to an Electron session (`session.defaultSession` or partition session).
   *
   * @param {Electron.Session} session
   * @param {function} onUpdate Callback invoked when any download updates
   * @param {object} [options]
   * @param {boolean} [options.isIncognito] Whether downloads on this session are incognito
   */
  attach(session, onUpdate, options = {}) {
    if (onUpdate) {
      this._onUpdate = onUpdate;
    }
    this._resolveSaveDir();

    const isIncognito = Boolean(options.isIncognito);

    session.on('will-download', (event, item, webContents) => {
      this._handleDownload(item, webContents, { isIncognito });
    });

    log.info(`DownloadManager attached to session ${isIncognito ? '(Incognito)' : '(Default)'}`);
  }

  isTurboEnabled() {
    if (this.storage) {
      try {
        const settings = this.storage.getSettings ? this.storage.getSettings() : (this.storage.get('settings') || {});
        return settings.turboDownloadEnabled !== false;
      } catch (_) {}
    }
    return true;
  }

  isMultiSourceEnabled() {
    if (this.storage) {
      try {
        const settings = this.storage.getSettings ? this.storage.getSettings() : (this.storage.get('settings') || {});
        return settings.multiSourceBonding !== false;
      } catch (_) {}
    }
    return true;
  }

  getTurboThreads() {
    if (this.storage) {
      try {
        const settings = this.storage.getSettings ? this.storage.getSettings() : (this.storage.get('settings') || {});
        return Number(settings.turboThreads) || 8;
      } catch (_) {}
    }
    return 8;
  }

  async getNetworkInterfaces() {
    try {
      return await TurboDownloadEngine.getAvailableNetworkInterfacesAsync(1200);
    } catch (_) {
      return TurboDownloadEngine.getAvailableNetworkInterfaces();
    }
  }

  /**
   * Starts an ultra-fast IDM-style Turbo multi-threaded download.
   */
  async startTurboDownload(opts = {}) {
    const { url, filename: customFilename, headers = {}, isIncognito = false, threads } = opts;
    if (!url || typeof url !== 'string') throw new Error('Valid URL required for Turbo download');

    // Anti-duplicate protection for Turbo downloads
    const now = Date.now();
    const isDuplicate = Object.values(this.downloads).some(d => {
      if (!d || d.url !== url) return false;
      if (d.state === 'progressing' && !d.isPaused) return true;
      if (d.startedAt && (now - d.startedAt) < 4000) return true;
      return false;
    });
    if (isDuplicate) {
      log.warn(`Smart Duplicate Protection: Skipped duplicate Turbo download for URL: ${url.slice(0, 100)}`);
      return null;
    }

    const id = generateId();
    this._resolveSaveDir();

    let probe = { acceptsRanges: false, totalBytes: opts.totalBytes || 0, finalUrl: url, filename: 'download' };
    if (!opts.totalBytes) {
      try {
        probe = await this.turboEngine.probe(url, headers);
      } catch (_) {}
    }

    const filename = sanitizeFilename(customFilename || probe.filename || 'download');
    let savePath = opts.savePath || getUniqueSavePath(this._saveDir, filename);

    if (!opts.savePath && this.shouldAskWhereToSave() && typeof this._promptSaveDialog === 'function') {
      try {
        const dialogResult = await this._promptSaveDialog({
          filename,
          defaultPath: savePath,
          webContents: opts.webContents
        });
        if (dialogResult && dialogResult.cancelled) {
          return null;
        } else if (dialogResult && dialogResult.filePath) {
          savePath = dialogResult.filePath;
        }
      } catch (err) {
        log.warn('Error prompting save dialog for turbo download', { error: err.message });
      }
    }

    // Ensure target folder exists on disk
    try {
      const targetDir = path.dirname(savePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
    } catch (err) {
      log.error('Could not ensure target folder exists', { savePath, error: err.message });
    }

    const multiSource = opts.multiSource !== undefined ? opts.multiSource : this.isMultiSourceEnabled();
    const threadCount = threads || this.getTurboThreads();

    const record = {
      id,
      filename: path.basename(savePath),
      url,
      savePath,
      state: 'progressing',
      isPaused: false,
      isIncognito: Boolean(isIncognito),
      isTurbo: true,
      isMultiSource: multiSource,
      threadsCount: threadCount,
      received: 0,
      total: opts.totalBytes || probe.totalBytes || 0,
      speed: 0,
      eta: null,
      startedAt: Date.now(),
      endedAt: null,
      segments: [],
      interfaces: [],
      item: null
    };

    this.downloads[id] = record;
    log.info(`Turbo download started: ${record.filename}`, { id, url: url.slice(0, 100), isIncognito });
    this._notify(record);
    this._persist();

    this.turboEngine.start({
      id,
      url,
      savePath,
      headers,
      threads: threadCount,
      totalBytes: opts.totalBytes || probe.totalBytes,
      multiSource
    }).catch(err => {
      log.error(`Turbo download failed to start: ${record.filename}`, { error: err.message });
      record.state = 'interrupted';
      this._notify(record);
      this._persist();
    });

    return record;
  }

  async _handleDownload(item, webContents = null, options = {}) {
    const id = generateId();
    const rawFilename = item.getFilename();
    const filename = sanitizeFilename(rawFilename);
    const url = item.getURL();
    const total = item.getTotalBytes() || 0;
    const isIncognito = Boolean(options.isIncognito);
    const now = Date.now();

    // ── Smart Anti-Duplicate / Anti-Spam Protection ──
    // Prevents parallel duplicate downloads when websites (like HDHub4u / HubCloud / Mediator)
    // fire window.open + location.href concurrently (within milliseconds), or rapid double-clicks.
    // This prevents server-side bandwidth throttling (e.g. Google Drive 5 B/s cap) and duplicate files.
    const isDuplicate = Object.values(this.downloads).some(d => {
      if (!d || d.url !== url) return false;
      const rawBase = path.basename(filename, path.extname(filename));
      const dBase = path.basename(d.filename || '', path.extname(d.filename || '')).replace(/ \(\d+\)$/, '');
      if (rawBase === dBase) {
        if (d.state === 'progressing' && !d.isPaused) return true;
        if (d.startedAt && (now - d.startedAt) < 4000) return true;
      }
      return false;
    });

    if (isDuplicate) {
      log.warn(`Smart Duplicate Protection: Prevented duplicate stream for "${filename}" from URL: ${url.slice(0, 100)}`);
      try { item.cancel(); } catch (_) {}
      return;
    }

    this._resolveSaveDir();
    let savePath = getUniqueSavePath(this._saveDir, filename);

    // Ask where to save if enabled and callback is provided
    if (this.shouldAskWhereToSave() && typeof this._promptSaveDialog === 'function') {
      try {
        const dialogResult = await this._promptSaveDialog({
          filename,
          defaultPath: savePath,
          webContents
        });
        if (dialogResult && dialogResult.cancelled) {
          item.cancel();
          return;
        } else if (dialogResult && dialogResult.filePath) {
          savePath = dialogResult.filePath;
        }
      } catch (err) {
        log.warn('Error prompting save dialog, falling back to default path', { error: err.message });
      }
    }

    // Ensure target folder exists on disk
    try {
      const targetDir = path.dirname(savePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
    } catch (err) {
      log.error('Could not ensure target folder exists', { savePath, error: err.message });
    }

    // Check if eligible for Turbo multi-threaded IDM downloading
    const isHttp = /^https?:\/\//i.test(url);
    if (webContents && this.isTurboEnabled() && isHttp && !options.useNative) {
      const headers = {
        'Accept': '*/*'
      };
      try {
        const referer = webContents.getURL ? webContents.getURL() : '';
        if (referer && !referer.startsWith('devtools://')) {
          headers['Referer'] = referer;
        }
        const s = webContents.session || (webContents.webContents ? webContents.webContents.session : null);
        if (s) {
          if (s.getUserAgent) {
            const ua = s.getUserAgent();
            if (ua) headers['User-Agent'] = ua;
          }
          if (s.cookies && s.cookies.get) {
            const cookies = await s.cookies.get({ url });
            if (cookies && cookies.length > 0) {
              headers['Cookie'] = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            }
          }
        }
      } catch (hErr) {
        log.warn('Could not extract cookies/headers for Turbo download', { error: hErr.message });
      }

      // Cancel native single-stream Electron download
      try { item.cancel(); } catch (_) {}

      // Launch Turbo multi-threaded download!
      const threads = this.getTurboThreads();
      const multiSource = this.isMultiSourceEnabled();

      return this.startTurboDownload({
        url,
        filename,
        savePath,
        headers,
        isIncognito,
        threads,
        multiSource,
        totalBytes: total,
        webContents
      });
    }

    try {
      item.setSavePath(savePath);
    } catch (err) {
      log.error('Failed to set save path on download item', { savePath, error: err.message });
    }

    const record = {
      id,
      filename: path.basename(savePath),
      url,
      savePath,
      state: 'progressing',
      isPaused: false,
      isIncognito,
      received: 0,
      total,
      speed: 0,        // bytes per second
      eta: null,       // seconds remaining
      startedAt: Date.now(),
      endedAt: null,
      item,
      _lastTimestamp: Date.now(),
      _lastReceived: 0
    };

    this.downloads[id] = record;
    log.info(`Download started: ${record.filename}`, { id, url: url.slice(0, 120), isIncognito });
    this._notify(record);
    this._persist();

    item.on('updated', (_, state) => {
      const now = Date.now();
      const currentReceived = item.getReceivedBytes();
      const elapsed = (now - record._lastTimestamp) / 1000;

      // Calculate speed and ETA periodically (smoothed over >= 0.4 seconds)
      if (elapsed >= 0.4) {
        const bytesDelta = currentReceived - record._lastReceived;
        const currentSpeed = Math.max(0, bytesDelta / elapsed);
        record.speed = record.speed > 0
          ? Math.round(0.7 * currentSpeed + 0.3 * record.speed)
          : Math.round(currentSpeed);
        record._lastTimestamp = now;
        record._lastReceived = currentReceived;

        if (record.speed > 0 && record.total > currentReceived) {
          record.eta = Math.round((record.total - currentReceived) / record.speed);
        } else {
          record.eta = null;
        }
      }

      record.received = currentReceived;
      record.total = item.getTotalBytes();
      record.isPaused = item.isPaused();
      record.state = record.isPaused ? 'paused' : state;
      this._notify(record);
    });

    item.once('done', (_, state) => {
      record.state = state; // 'completed' | 'cancelled' | 'interrupted'
      record.isPaused = false;
      record.endedAt = Date.now();
      record.received = item.getReceivedBytes();
      record.speed = 0;
      record.eta = null;

      if (state === 'completed') {
        log.info(`Download completed: ${record.filename}`, { id, savePath });
      } else {
        log.warn(`Download ${state}: ${record.filename}`, { id });
        if (state === 'cancelled') {
          // Clean up partial files upon cancellation
          setTimeout(() => cleanupPartialFile(record.savePath), 100);
        }
      }

      this._notify(record);
      this._persist();
    });
  }

  _notify(record) {
    if (typeof this._onUpdate === 'function') {
      this._onUpdate(this._serialize(record));
    }
  }

  _serialize(record) {
    const { item, _lastTimestamp, _lastReceived, ...safe } = record;
    return safe;
  }

  /**
   * Retrieves download records.
   * By default, returns all non-incognito downloads.
   * If `filter.includeIncognito` is true, returns all.
   * If `filter.incognitoOnly` is true, returns only incognito downloads.
   *
   * @param {object} [filter]
   * @returns {Array<object>}
   */
  getDownloads(filter = {}) {
    const records = Object.values(this.downloads);
    if (filter.incognitoOnly) {
      return records.filter(r => r.isIncognito).map(r => this._serialize(r));
    }
    if (filter.includeIncognito) {
      return records.map(r => this._serialize(r));
    }
    return records.filter(r => !r.isIncognito).map(r => this._serialize(r));
  }

  pauseDownload(id) {
    const record = this.downloads[id];
    if (!record) return false;
    if (record.isTurbo) {
      return this.turboEngine.pause(id);
    }
    if (!record.item) return false;
    if (record.state === 'progressing') {
      try {
        record.item.pause();
        record.state = 'paused';
        record.isPaused = true;
        record.speed = 0;
        record.eta = null;
        this._notify(record);
        log.info(`Download paused: ${record.filename}`, { id });
        return true;
      } catch (err) {
        log.error(`Failed to pause download ${id}`, { error: err.message });
      }
    }
    return false;
  }

  resumeDownload(id) {
    const record = this.downloads[id];
    if (!record) return false;
    if (record.isTurbo) {
      return this.turboEngine.resume(id);
    }
    if (!record.item) return false;
    if (record.item.canResume()) {
      try {
        record.item.resume();
        record.state = 'progressing';
        record.isPaused = false;
        record._lastTimestamp = Date.now();
        record._lastReceived = record.received;
        this._notify(record);
        log.info(`Download resumed: ${record.filename}`, { id });
        return true;
      } catch (err) {
        log.error(`Failed to resume download ${id}`, { error: err.message });
      }
    }
    return false;
  }

  cancelDownload(id) {
    const record = this.downloads[id];
    if (!record) return false;
    if (record.isTurbo) {
      return this.turboEngine.cancel(id);
    }
    if (record.item && (record.state === 'progressing' || record.state === 'paused')) {
      try {
        record.item.cancel();
        record.state = 'cancelled';
        record.isPaused = false;
        record.speed = 0;
        record.eta = null;
        record.endedAt = Date.now();
        // Remove partial files from disk
        setTimeout(() => cleanupPartialFile(record.savePath), 100);
        this._notify(record);
        this._persist();
        log.info(`Download cancelled by user: ${record.filename}`, { id });
        return true;
      } catch (err) {
        log.error(`Failed to cancel download ${id}`, { error: err.message });
      }
    }
    return false;
  }

  openFile(id) {
    const record = this.downloads[id];
    if (!record || !record.savePath) return { success: false, error: 'Download record not found' };
    if (!fs.existsSync(record.savePath)) {
      return { success: false, error: 'File does not exist on disk' };
    }
    try {
      shell.openPath(record.savePath);
      log.info(`File opened by user: ${record.savePath}`);
      return { success: true };
    } catch (err) {
      log.error(`Failed to open file: ${record.savePath}`, { error: err.message });
      return { success: false, error: err.message };
    }
  }

  showInFolder(id) {
    const record = this.downloads[id];
    if (!record || !record.savePath) return false;
    try {
      if (fs.existsSync(record.savePath)) {
        shell.showItemInFolder(record.savePath);
        return true;
      }
      return false;
    } catch (err) {
      log.error(`Failed to show in folder: ${record.savePath}`, { error: err.message });
      return false;
    }
  }

  openDownloadsFolder() {
    this._resolveSaveDir();
    try {
      if (fs.existsSync(this._saveDir)) {
        shell.openPath(this._saveDir);
        return true;
      }
      return false;
    } catch (err) {
      log.error('Failed to open downloads folder', { dir: this._saveDir, error: err.message });
      return false;
    }
  }

  removeDownload(id) {
    if (this.downloads[id]) {
      // If still progressing, cancel first
      if (this.downloads[id].item && (this.downloads[id].state === 'progressing' || this.downloads[id].state === 'paused')) {
        try { this.downloads[id].item.cancel(); } catch (_) {}
      }
      delete this.downloads[id];
      this._persist();
      return true;
    }
    return false;
  }

  clearCompleted() {
    let count = 0;
    for (const [id, record] of Object.entries(this.downloads)) {
      if (record.state !== 'progressing' && record.state !== 'paused') {
        delete this.downloads[id];
        count++;
      }
    }
    this._persist();
    log.info(`Cleared ${count} completed downloads from history`);
    return count;
  }

  /**
   * Cleans up all ephemeral in-memory incognito downloads.
   * Invoked when incognito window closes.
   */
  clearIncognitoDownloads() {
    let count = 0;
    for (const [id, record] of Object.entries(this.downloads)) {
      if (record.isIncognito) {
        if (record.item && (record.state === 'progressing' || record.state === 'paused')) {
          try { record.item.cancel(); } catch (_) {}
        }
        delete this.downloads[id];
        count++;
      }
    }
    log.info(`Cleared ${count} ephemeral incognito downloads`);
    return count;
  }
}

// Export helper functions for testing
DownloadManager.sanitizeFilename = sanitizeFilename;
DownloadManager.getUniqueSavePath = getUniqueSavePath;
DownloadManager.cleanupPartialFile = cleanupPartialFile;

module.exports = DownloadManager;
