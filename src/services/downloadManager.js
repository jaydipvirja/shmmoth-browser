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

  // Strip directory paths and path traversal. Servers send both "/" and "\" separators regardless of the
  // host OS, and path.basename() only knows the host's own separator, so split on both.
  clean = clean.split(/[\\/]/).pop();

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
  for (const suffix of ['.crdownload', '.shmmoth-part']) {
    try {
      const partial = `${filePath}${suffix}`;
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
    } catch (_) {}
  }
}

/**
 * File types that run code (or open a shell / macro document) when opened. Opening one from the downloads list asks
 * first, like Chrome and Edge do. Judged by the LAST extension, with the trailing dots and spaces that Windows ignores
 * removed, so "invoice.pdf.exe" and "setup.exe. " are caught.
 */
const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'msi', 'msp', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'drv', 'ocx',
  'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ws', 'ps1', 'ps1xml', 'psc1', 'psm1', 'hta', 'jar',
  'lnk', 'reg', 'msc', 'inf', 'scf', 'url', 'library-ms', 'search-ms', 'diagcab', 'chm',
  'appx', 'msix', 'appxbundle', 'msixbundle', 'application', 'gadget',
  'docm', 'dotm', 'xlsm', 'xlam', 'pptm', 'ppam',
  'sh', 'command', 'app', 'pkg', 'dmg', 'deb', 'rpm', 'run'
]);

function isDangerousFile(nameOrPath) {
  if (typeof nameOrPath !== 'string') return false;
  const base = nameOrPath.split(/[\\/]/).pop().replace(/[. ]+$/, '');
  const dot = base.lastIndexOf('.');
  if (dot < 0) return false;
  return DANGEROUS_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

class DownloadManager {
  /**
   * @param {object|null} storage StorageService instance
   * @param {object} [options]
   * @param {function} [options.confirmOpenDangerous] async ({ filename, filePath }) => boolean. Asked before a file
   *        that can run code (.exe, .msi, .bat, .js, …) is opened; without it such files are never opened, only shown in
   *        their folder.
   * @param {function} [options.promptSaveDialog] Optional async callback for "Ask where to save"
   * @param {function} [options.isProxyActive] (isIncognito:boolean) => boolean. The Turbo engine talks to the
   *        network with Node's http/https, which ignores the browser's proxy settings; while a proxy is in use
   *        downloads therefore stay on Chromium's native downloader (which honours it) instead of leaking the real IP.
   */
  constructor(storage = null, options = {}) {
    this.storage = storage;
    this.downloads = {};
    this._onUpdate = null;
    this._promptSaveDialog = options.promptSaveDialog || null;
    this._confirmOpenDangerous = typeof options.confirmOpenDangerous === 'function' ? options.confirmOpenDangerous : null;
    this._isProxyActive = typeof options.isProxyActive === 'function' ? options.isProxyActive : null;
    this._sessions = { default: null, incognito: null };
    // (isIncognito) => a live WebContents of that session, or null. Chromium sends a Referer for a download only when
    // it is started from a WebContents (session.downloadURL drops it), and many file servers refuse requests without it.
    this._getDownloadHost = typeof options.getDownloadHost === 'function' ? options.getDownloadHost : null;
    // url -> { id, savePath }: downloads that must go through Chromium's own downloader (see _handOverToNative)
    this._nativeOnly = new Map();

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
      log.warn(`Turbo download error: ${record.filename}`, { id: data.id, error: data.error, received: data.received });

      // Nothing arrived at all: the server does not like the Turbo engine's requests (it refuses them, or hangs on them).
      // Chromium's own downloader sends exactly what the page would, so hand the download over to it once.
      if (!data.received && !record.nativeTried && this._handOverToNative(record, data.error)) return;

      record.state = 'interrupted';
      record.isPaused = false;
      record.endedAt = Date.now();
      record.speed = 0;
      record.eta = null;
      record.error = String(data.error || 'The download failed').slice(0, 300);
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
              const unfinished = r.state === 'progressing' || r.state === 'paused';
              this.downloads[r.id] = {
                ...r,
                // Nothing keeps running while the browser is closed: a record that was still "downloading" would
                // otherwise sit at its old number for ever (pause/cancel buttons that do nothing). Show it as
                // interrupted so it can be retried or removed.
                ...(unfinished ? { state: 'interrupted', error: 'The browser was closed before this download finished.', endedAt: Date.now() } : {}),
                isPaused: false,
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
          .filter(r => !r.isIncognito && !r.held)
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
    this._sessions[isIncognito ? 'incognito' : 'default'] = session;

    session.on('will-download', (event, item, webContents) => {
      this._handleDownload(item, webContents, { isIncognito });
    });

    log.info(`DownloadManager attached to session ${isIncognito ? '(Incognito)' : '(Default)'}`);
  }

  /** True while the browser is configured to use a proxy (conservatively true if that cannot be determined). */
  isProxyActive(isIncognito = false) {
    if (!this._isProxyActive) return false;
    try {
      return Boolean(this._isProxyActive(Boolean(isIncognito)));
    } catch (_) {
      return true;
    }
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

    // Node's http/https ignores the browser proxy → hand the download to Chromium, which honours it
    if (this.isProxyActive(isIncognito)) {
      const sess = this._sessions[isIncognito ? 'incognito' : 'default'];
      if (sess && typeof sess.downloadURL === 'function') {
        log.info('Proxy active: Turbo download routed through the native (proxied) downloader', { url: url.slice(0, 100) });
        sess.downloadURL(url);
        return null;
      }
      throw new Error('Turbo downloads are unavailable while a proxy is configured');
    }

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

    let probe = opts.probe || { acceptsRanges: false, totalBytes: opts.totalBytes || 0, finalUrl: url, filename: 'download' };
    if (!opts.probe && !opts.totalBytes) {
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
      referrer: (headers && typeof headers.Referer === 'string' && /^https?:\/\//i.test(headers.Referer)) ? headers.Referer.slice(0, 2048) : '',
      received: 0,
      total: opts.totalBytes || probe.totalBytes || 0,
      headers: headers,
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
      probe: opts.probe || undefined,
      multiSource
    }).catch(err => {
      log.error(`Turbo download failed to start: ${record.filename}`, { error: err.message });
      if (!record.nativeTried && this._handOverToNative(record, err.message)) return;
      record.state = 'interrupted';
      record.error = String((err && err.message) || 'The download could not be started').slice(0, 300);
      this._notify(record);
      this._persist();
    });

    return record;
  }

  async _handleDownload(item, webContents = null, options = {}) {
    const rawFilename = item.getFilename();
    const filename = sanitizeFilename(rawFilename);
    const url = item.getURL();
    const total = item.getTotalBytes() || 0;
    const isIncognito = Boolean(options.isIncognito);
    const now = Date.now();

    // A download that was handed over to Chromium's own downloader (retry, or the Turbo engine could not get anything)
    // keeps its card (same id) and is never mistaken for a duplicate of itself
    const handedOver = this._takeHandover(item, url);
    const id = (handedOver && handedOver.id) || generateId();

    // The page the download was started from. A retry must ask for the file the way the original request did: many
    // file servers only answer a request that names the page (Referer) and drop the connection otherwise.
    let referrer = (handedOver && handedOver.referrer) || '';
    try {
      const pageUrl = webContents && typeof webContents.getURL === 'function' ? webContents.getURL() : '';
      if (!referrer && /^https?:\/\//i.test(pageUrl)) referrer = pageUrl.slice(0, 2048);
    } catch (_) {}

    // ── Smart Anti-Duplicate / Anti-Spam Protection ──
    // Prevents parallel duplicate downloads when websites (like HDHub4u / HubCloud / Mediator)
    // fire window.open + location.href concurrently (within milliseconds), or rapid double-clicks.
    // This prevents server-side bandwidth throttling (e.g. Google Drive 5 B/s cap) and duplicate files.
    const isDuplicate = !handedOver && Object.values(this.downloads).some(d => {
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
    const keepPath = Boolean(handedOver && handedOver.savePath);
    if (keepPath) {
      // same place the user already chose (or accepted) for this download
      savePath = fs.existsSync(handedOver.savePath)
        ? getUniqueSavePath(path.dirname(handedOver.savePath), path.basename(handedOver.savePath))
        : handedOver.savePath;
    }

    // Ask where to save if enabled and callback is provided. The callback should answer synchronously (see below);
    // an asynchronous one still works for hosts that have no synchronous dialog.
    if (!keepPath && this.shouldAskWhereToSave() && typeof this._promptSaveDialog === 'function') {
      try {
        let answer = this._promptSaveDialog({
          filename,
          defaultPath: savePath,
          webContents
        });
        if (answer && typeof answer.then === 'function') answer = await answer;
        if (answer && answer.cancelled) {
          item.cancel();
          return;
        } else if (answer && answer.filePath) {
          savePath = answer.filePath;
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

    // ── Electron decides the save path the moment this function returns ──
    // A path that is set after an `await` is ignored and Electron opens its own "Save as" dialog instead (measured), so
    // the path is set here, before the first await. A download that the fast engine may still take over is HELD
    // (paused) while the engine is being proven, and the browser's own download goes on if it is not.
    try {
      item.setSavePath(savePath);
    } catch (err) {
      log.error('Failed to set save path on download item', { savePath, error: err.message });
    }

    // Check if eligible for Turbo multi-connection downloading
    const isHttp = /^https?:\/\//i.test(url);
    const proxied = this.isProxyActive(isIncognito);
    if (proxied && webContents && this.isTurboEnabled() && isHttp) {
      log.info('Proxy active: using the native downloader instead of Turbo so the proxy is honoured', { url: url.slice(0, 100) });
    }
    const turboCandidate = Boolean(webContents) && this.isTurboEnabled() && isHttp && !options.useNative && !proxied && !handedOver
      && !(total > 0 && total < this.turboEngine.minTurboSize);          // a small file is not worth a second request

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
      nativeTried: Boolean(handedOver),
      referrer,
      held: turboCandidate,       // not announced yet: the fast engine may still take this download over
      item,
      _lastTimestamp: Date.now(),
      _lastReceived: 0
    };

    this.downloads[id] = record;

    item.on('updated', (_, state) => {
      if (record.held || record.abandoned) return;
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
      if (record.abandoned) return;            // given up on purpose, the fast engine has it
      record.settled = true;
      record.held = false;
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
        if (state === 'interrupted') record.error = 'The connection was interrupted or the server stopped sending the file.';
        if (state === 'cancelled') {
          // Clean up partial files upon cancellation
          setTimeout(() => cleanupPartialFile(record.savePath), 100);
        }
      }

      this._notify(record);
      this._persist();
    });

    if (!turboCandidate) {
      log.info(`Download started: ${record.filename}`, { id, url: url.slice(0, 120), isIncognito });
      this._notify(record);
      this._persist();
      return;
    }

    // ── Held: prove that the fast engine works for this link before the browser's own download is given up ──
    // One small ranged request, made the way the engine will make all of them (same cookies, page, user agent). Before,
    // the browser's download was cancelled first — for a link that works once, or a server that refuses the engine's
    // requests, nothing was left: the download sat at "0 B" or failed.
    let paused = false;
    try { item.pause(); paused = true; } catch (_) { /* nothing to hold */ }

    const headers = {
      'Accept': '*/*'
    };
    try {
      const referer = webContents.getURL ? webContents.getURL() : '';
      if (referer && !referer.startsWith('devtools://')) {
        headers['Referer'] = referer;
      }
      const sess = webContents.session || (webContents.webContents ? webContents.webContents.session : null);
      if (sess) {
        if (sess.getUserAgent) {
          const ua = sess.getUserAgent();
          if (ua) headers['User-Agent'] = ua;
        }
        if (sess.cookies && sess.cookies.get) {
          const cookies = await sess.cookies.get({ url });
          if (cookies && cookies.length > 0) {
            headers['Cookie'] = cookies.map(c => `${c.name}=${c.value}`).join('; ');
          }
        }
      }
    } catch (hErr) {
      log.warn('Could not extract cookies/headers for Turbo download', { error: hErr.message });
    }

    let probe = null;
    let reason = '';
    try { probe = await this.turboEngine.probe(url, headers, { timeout: 6000 }); } catch (_) { probe = null; }
    if (record.settled) return;                 // the item ended meanwhile (and was reported by its 'done' handler)
    if (!probe || !probe.acceptsRanges) reason = 'the server does not answer ranged requests' + (probe && probe.status ? ` (HTTP ${probe.status})` : '');
    else if (probe.totalBytes < this.turboEngine.minTurboSize) reason = 'the file is small';
    else if (total > 0 && probe.totalBytes !== total) reason = 'the size differs from the one announced';

    if (!reason) {
      // Cancel the held native download (Chromium removes its placeholder file) and let the fast engine have it
      record.abandoned = true;
      delete this.downloads[id];
      try { item.cancel(); } catch (_) {}
      // Chromium removes its placeholder file shortly after the cancel: the fast engine must not open the same file
      // before that (the late removal would delete the file it is writing to)
      savePath = await this._afterPlaceholderGone(savePath);
      await new Promise((r) => setTimeout(r, 250));      // grace: the file thread may still be finishing with the cancelled item

      try {
        return await this.startTurboDownload({
          url,
          filename,
          savePath,
          headers,
          isIncognito,
          threads: this.getTurboThreads(),
          multiSource: this.isMultiSourceEnabled(),
          totalBytes: total || probe.totalBytes,
          probe,
          webContents
        });
      } catch (err) {
        log.error('Could not start the Turbo download', { error: err.message });
        return null;
      }
    }

    // Not proven: the browser's own download carries on (nothing was lost, it was only held)
    log.info(`Turbo engine not used for "${filename}": ${reason}; the normal download continues`, { url: url.slice(0, 100) });
    record.held = false;
    if (paused) {
      try { item.resume(); } catch (err) { log.warn('Could not resume the held download', { error: err.message }); }
    }
    record.isPaused = false;
    record.state = 'progressing';
    record._lastTimestamp = Date.now();
    log.info(`Download started: ${record.filename}`, { id, url: url.slice(0, 120), isIncognito });
    this._notify(record);
    this._persist();
  }

  /** Waits (at most `timeoutMs`) until `savePath` is free; returns a path that is safe to open. */
  async _afterPlaceholderGone(savePath, timeoutMs = 2000) {
    const end = Date.now() + timeoutMs;
    while (fs.existsSync(savePath) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return fs.existsSync(savePath) ? getUniqueSavePath(path.dirname(savePath), path.basename(savePath)) : savePath;
  }

  _notify(record) {
    if (typeof this._onUpdate === 'function') {
      this._onUpdate(this._serialize(record));
    }
  }

  _serialize(record) {
    // `headers` holds the Cookie header of the page the download came from: it stays in memory (needed to resume),
    // it is neither written to downloads.json nor sent to any page
    const { item, _lastTimestamp, _lastReceived, headers, held, settled, abandoned, ...safe } = record;
    return safe;
  }

  /**
   * Finds (and removes) the hand-over entry that belongs to this native download item.
   * The key is the URL the hand-over asked for; after redirects the item reports the final URL, so the chain counts too.
   */
  _takeHandover(item, url) {
    if (!this._nativeOnly.size) return null;
    let chain = [];
    try { chain = (item && typeof item.getURLChain === 'function' && item.getURLChain()) || []; } catch (_) {}
    for (const key of [url, ...chain]) {
      if (this._nativeOnly.has(key)) {
        const found = this._nativeOnly.get(key);
        this._nativeOnly.delete(key);
        return found;
      }
    }
    return null;
  }

  /**
   * Starts the download of `url` again with Chromium's own downloader (not the Turbo engine), in `isIncognito`'s
   * session. This is what the "retry" button does: after a failure the safest choice is the most compatible one.
   * @returns {boolean} false when the session cannot start downloads
   */
  retryDownload(url, isIncognito = false) {
    const sess = this._sessions[isIncognito ? 'incognito' : 'default'];
    if (!sess || typeof sess.downloadURL !== 'function' || typeof url !== 'string' || !url) return false;
    const previous = Object.values(this.downloads)
      .filter((d) => d && d.url === url && Boolean(d.isIncognito) === Boolean(isIncognito))
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
    const referrer = (previous && (previous.referrer || (previous.headers && previous.headers.Referer))) || '';
    this._nativeOnly.set(url, { referrer });
    this._expireHandover(url, null);
    try {
      this._startNativeDownload(url, isIncognito, referrer);
    } catch (err) {
      this._nativeOnly.delete(url);
      throw err;
    }
    return true;
  }

  /** A hand-over entry that Electron never answers must not live (or block the card) for ever. */
  _expireHandover(url, record) {
    const timer = setTimeout(() => {
      const entry = this._nativeOnly.get(url);
      if (!entry) return;
      this._nativeOnly.delete(url);
      if (record && this.downloads[record.id] === record) {
        record.state = 'interrupted';
        record.error = 'The browser could not start this download.';
        this._notify(record);
        this._persist();
      }
    }, 30000);
    if (timer.unref) timer.unref();
  }

  /**
   * The Turbo engine got nothing from the server (it refuses the engine's requests, hangs on them, or the link only
   * works for the browser itself). Start the same download again with Chromium's downloader, on the same card.
   * @returns {boolean} true when the hand-over was started
   */
  _handOverToNative(record, reason) {
    const sess = this._sessions[record.isIncognito ? 'incognito' : 'default'];
    if (!sess || typeof sess.downloadURL !== 'function') return false;

    const referer = record.referrer || (record.headers && record.headers.Referer) || '';
    record.nativeTried = true;
    record.isTurbo = false;
    record.isMultiSource = false;
    record.state = 'progressing';
    record.isPaused = false;
    record.received = 0;
    record.speed = 0;
    record.eta = null;
    record.segments = [];
    record.interfaces = [];
    record.error = '';
    this._nativeOnly.set(record.url, { id: record.id, savePath: record.savePath, referrer: referer });
    this._expireHandover(record.url, record);
    log.info(`Turbo engine could not start "${record.filename}" (${reason}); using the standard downloader`, { id: record.id });
    this._notify(record);
    try {
      this._startNativeDownload(record.url, record.isIncognito, referer);
    } catch (err) {
      this._nativeOnly.delete(record.url);
      log.warn('Hand-over to the standard downloader failed', { error: err.message });
      return false;
    }
    return true;
  }

  /**
   * Starts a download with Chromium's own downloader, naming `referrer` as the page it came from when possible.
   * (Measured: session.downloadURL() accepts custom headers but silently drops "Referer"; webContents.downloadURL() sends it.)
   */
  _startNativeDownload(url, isIncognito, referrer = '') {
    const sess = this._sessions[isIncognito ? 'incognito' : 'default'];
    if (referrer && this._getDownloadHost) {
      let host = null;
      try { host = this._getDownloadHost(Boolean(isIncognito)); } catch (_) { host = null; }
      let alive = false;
      try { alive = Boolean(host) && !host.isDestroyed() && typeof host.downloadURL === 'function' && host.session === sess; } catch (_) { alive = false; }
      if (alive) {
        host.downloadURL(url, { headers: { Referer: referrer } });
        return;
      }
    }
    sess.downloadURL(url);
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
    // a download that is still being proven for the fast engine (held) has not been announced yet
    const records = Object.values(this.downloads).filter(r => !r.held);
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
      if (this.isProxyActive(record.isIncognito)) {
        // A proxy was configured after this download started: don't continue it outside the proxy
        try { this.turboEngine.pause(id); } catch (_) {}
        record.state = 'interrupted';
        record.isPaused = false;
        this._notify(record);
        log.warn('Not resuming a Turbo download while a proxy is active; retry it to download through the proxy', { id });
        return false;
      }
      if (this.turboEngine.activeTasks && this.turboEngine.activeTasks.has(id)) {
        return this.turboEngine.resume(id, record.headers || {});
      } else {
        record.state = 'progressing';
        record.isPaused = false;
        this._notify(record);
        this.turboEngine.start({
          id,
          url: record.url,
          savePath: record.savePath,
          headers: record.headers || {},
          threads: record.threadsCount || this.getTurboThreads(),
          totalBytes: record.total,
          multiSource: record.isMultiSource
        }).catch(err => {
          record.state = 'interrupted';
          this._notify(record);
        });
        return true;
      }
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
      if (this.turboEngine.cancel(id)) return true;
      // no running task behind this card (it was lost, e.g. across a restart): just close the card's download
      if (record.state === 'progressing' || record.state === 'paused' || record.state === 'interrupted') {
        record.state = 'cancelled';
        record.isPaused = false;
        record.speed = 0;
        record.eta = null;
        record.endedAt = Date.now();
        setTimeout(() => cleanupPartialFile(record.savePath), 100);
        this._notify(record);
        this._persist();
        return true;
      }
      return false;
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
    if (!record.item && !record.isTurbo && (record.state === 'progressing' || record.state === 'paused')) {
      // waiting for a hand-over that has not arrived yet
      this._nativeOnly.delete(record.url);
      record.state = 'cancelled';
      record.isPaused = false;
      record.endedAt = Date.now();
      this._notify(record);
      this._persist();
      return true;
    }
    return false;
  }

  async openFile(id) {
    const record = this.downloads[id];
    if (!record || !record.savePath) return { success: false, error: 'Download record not found' };
    if (!fs.existsSync(record.savePath)) {
      return { success: false, error: 'File does not exist on disk' };
    }
    if (isDangerousFile(record.savePath)) {
      let allowed = false;
      try {
        allowed = this._confirmOpenDangerous
          ? Boolean(await this._confirmOpenDangerous({ filename: path.basename(record.savePath), filePath: record.savePath }))
          : false;
      } catch (_) { allowed = false; }
      if (!allowed) {
        log.warn(`Opening a program-type download was not confirmed: ${record.savePath}`);
        try { shell.showItemInFolder(record.savePath); } catch (_) { /* best effort */ }
        return { success: false, cancelled: true, dangerous: true, error: 'This type of file can run programs, so it was not opened. It is shown in its folder instead.' };
      }
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
      if (this.downloads[id].isTurbo && (this.downloads[id].state === 'progressing' || this.downloads[id].state === 'paused')) {
        try { this.turboEngine.cancel(id); } catch (_) {}
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
        if (record.isTurbo && (record.state === 'progressing' || record.state === 'paused')) {
          try { this.turboEngine.cancel(id); } catch (_) {}
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

DownloadManager.isDangerousFile = isDangerousFile;
module.exports = DownloadManager;
