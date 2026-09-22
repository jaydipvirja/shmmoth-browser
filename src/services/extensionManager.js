/**
 * SHMMOTH BROWSER — EXTENSION MANAGER SERVICE (extensionManager.js)
 *
 * Dedicated management engine for Chromium extensions in SHMMOTH Browser.
 * Supports unpacked extensions with primary focus on Manifest V3 (MV3)
 * while providing compatibility support for unpacked Manifest V2 (MV2).
 *
 * SECURITY GUARANTEES:
 *   - Strict manifest validation before installation (schema, files, traversal check).
 *   - Path traversal defense: prevents relative paths escapes (../, ..\\).
 *   - Rejection of dangerous/disallowed permissions (nativeMessaging, debugger unless dev mode).
 *   - Categorization of permissions with explicit high-risk flagging.
 *   - Zero privileged exposure: extensions cannot access internal APIs (mtcAPI, shmmothAPI)
 *     or nodeIntegration.
 *   - Crash resilience: runtime errors in extension scripts are logged without crashing the browser.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { mainLogger: log, securityLogger } = require('../utils/logger');

// Disallowed permissions that extensions are not allowed to request
const DISALLOWED_PERMISSIONS = new Set([
  'nativeMessaging',
  'enterprise.deviceAttributes',
  'enterprise.hardwarePlatform',
  'enterprise.networkingAttributes',
  'enterprise.platformKeys'
]);

// High-risk permissions that grant broad access or network interception
const HIGH_RISK_PERMISSIONS = new Set([
  '<all_urls>',
  '*://*/*',
  'http://*/*',
  'https://*/*',
  'webRequest',
  'webRequestBlocking',
  'cookies',
  'tabs',
  'declarativeNetRequestFeedback',
  'proxy',
  'management',
  'privacy',
  'topSites',
  'history',
  'downloads'
]);

// User-friendly descriptions for permissions
const PERMISSION_DESCRIPTIONS = {
  '<all_urls>': 'Read and change all your data on all websites you visit',
  'storage': 'Store and retrieve data locally in your browser',
  'tabs': 'Access your browser tabs, active URLs, and title information',
  'activeTab': 'Access the active tab when you click the extension',
  'cookies': 'Read and modify cookies for websites you visit',
  'webRequest': 'Intercept, inspect, and analyze network requests',
  'webRequestBlocking': 'Block or modify network requests in real time',
  'declarativeNetRequest': 'Block or modify network requests using declarative rules',
  'declarativeNetRequestFeedback': 'Access detailed information on blocked requests',
  'alarms': 'Schedule tasks to run periodically in the background',
  'contextMenus': 'Add custom options to the browser right-click menu',
  'notifications': 'Display desktop notifications',
  'unlimitedStorage': 'Store an unlimited amount of client-side data',
  'scripting': 'Execute scripts and styles into web pages',
  'downloads': 'Manage and inspect your browser downloads',
  'history': 'Read and change your browsing history',
  'bookmarks': 'Read and change your bookmarks',
  'management': 'Manage installed browser extensions and apps',
  'privacy': 'Control privacy settings in the browser',
  'proxy': 'Manage and route network connections through proxies'
};

class ExtensionManager {
  /**
   * @param {string} [customUserDataPath] Custom path for persisting extensions registry
   */
  constructor(customUserDataPath = null) {
    this.userDataPath = customUserDataPath || (app ? app.getPath('userData') : path.join(__dirname, '..', '..'));
    this.registryFilePath = path.join(this.userDataPath, 'shmmoth-extensions.json');

    this.extensions = {}; // { [id]: ExtensionRecord }
    this.developerMode = false;
    this.loadedSessions = new Set();

    this.loadRegistry();
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  /**
   * Loads the extension registry from disk.
   */
  loadRegistry() {
    try {
      if (fs.existsSync(this.registryFilePath)) {
        const raw = fs.readFileSync(this.registryFilePath, 'utf8');
        const data = JSON.parse(raw);

        if (data && typeof data === 'object') {
          this.extensions = (typeof data.extensions === 'object' && data.extensions !== null) ? data.extensions : {};
          this.developerMode = Boolean(data.developerMode);
          log.info('Extension registry loaded from disk', { count: Object.keys(this.extensions).length, devMode: this.developerMode });
          return;
        }
      }
    } catch (err) {
      log.error('Failed to load extension registry from disk', { error: err.message });
    }

    // Default state if missing or corrupted
    this.extensions = {};
    this.developerMode = false;
  }

  /**
   * Persists the current extension registry to disk safely.
   */
  saveRegistry() {
    try {
      const dir = path.dirname(this.registryFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const payload = {
        version: 1,
        updatedAt: Date.now(),
        developerMode: this.developerMode,
        extensions: this.extensions
      };

      const tmpPath = `${this.registryFilePath}.tmp_${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.registryFilePath);
      log.info('Extension registry saved to disk', { count: Object.keys(this.extensions).length });
    } catch (err) {
      log.error('Failed to save extension registry to disk', { error: err.message });
    }
  }

  // ─── Validation & Security Checks ─────────────────────────────────────────

  /**
   * Generates a deterministic 32-character extension ID from its folder path.
   * Maps hex characters (0-f) to Chrome's (a-p) alphabet.
   *
   * @param {string} extPath
   * @returns {string} 32-character extension ID
   */
  generateExtensionId(extPath) {
    const normalized = path.resolve(extPath).toLowerCase().replace(/\\/g, '/');
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
    // Convert hex chars 0-9a-f to a-p (standard Chrome extension ID format)
    return hash.split('').map(ch => {
      const code = ch.charCodeAt(0);
      if (code >= 48 && code <= 57) return String.fromCharCode(97 + (code - 48)); // 0-9 -> a-j
      if (code >= 97 && code <= 102) return String.fromCharCode(107 + (code - 97)); // a-f -> k-p
      return 'a';
    }).join('');
  }

  /**
   * Validates that a file reference stays strictly within the extension root directory.
   *
   * @param {string} rootDir
   * @param {string} relativeFile
   * @returns {boolean}
   */
  isSafeSubpath(rootDir, relativeFile) {
    if (!relativeFile || typeof relativeFile !== 'string') return false;
    // Check for path traversal sequences
    if (relativeFile.includes('..') || relativeFile.startsWith('/') || relativeFile.startsWith('\\')) {
      const stripped = relativeFile.replace(/^[\/\\]+/, '');
      if (stripped.includes('..')) return false;
      const resolved = path.resolve(rootDir, stripped);
      return resolved.startsWith(path.resolve(rootDir));
    }
    const resolved = path.resolve(rootDir, relativeFile);
    return resolved.startsWith(path.resolve(rootDir));
  }

  /**
   * Thoroughly validates an unpacked extension before installation.
   *
   * @param {string} extensionDir
   * @returns {object} Validation result and parsed metadata
   */
  validateExtension(extensionDir) {
    if (!extensionDir || typeof extensionDir !== 'string') {
      throw new Error('Extension path must be a valid non-empty string');
    }

    const resolvedDir = path.resolve(extensionDir);

    if (!fs.existsSync(resolvedDir)) {
      throw new Error(`Extension directory not found: ${resolvedDir}`);
    }

    const stats = fs.statSync(resolvedDir);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedDir}`);
    }

    const manifestPath = path.join(resolvedDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('manifest.json not found in extension directory');
    }

    let manifest;
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      manifest = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid manifest.json: not valid JSON (${err.message})`);
    }

    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Invalid manifest.json: root must be a JSON object');
    }

    // 1. Required Fields
    if (!manifest.name || typeof manifest.name !== 'string' || manifest.name.trim() === '') {
      throw new Error('Manifest missing required field: name');
    }

    if (!manifest.version || typeof manifest.version !== 'string' || manifest.version.trim() === '') {
      throw new Error('Manifest missing required field: version');
    }

    // 2. Manifest Version
    if (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) {
      throw new Error(`Unsupported manifest_version: ${manifest.manifest_version}. Only Manifest V2 and Manifest V3 are supported.`);
    }

    // 3. Security Check: Path Traversal & Script Existence
    const checkFile = (relPath, fieldName) => {
      if (!relPath || typeof relPath !== 'string') return;
      if (!this.isSafeSubpath(resolvedDir, relPath)) {
        securityLogger.warn('Extension path traversal attempt detected', { field: fieldName, path: relPath, extension: manifest.name });
        throw new Error(`Security error: Path traversal detected in ${fieldName} ("${relPath}")`);
      }
      const safeRel = relPath.replace(/^[\/\\]+/, '');
      const fullPath = path.join(resolvedDir, safeRel);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Referenced file in ${fieldName} does not exist: ${relPath}`);
      }
    };

    // Background / Service Worker
    if (manifest.manifest_version === 3) {
      if (manifest.background && manifest.background.service_worker) {
        checkFile(manifest.background.service_worker, 'background.service_worker');
      }
    } else if (manifest.manifest_version === 2) {
      if (manifest.background) {
        if (Array.isArray(manifest.background.scripts)) {
          for (const s of manifest.background.scripts) {
            checkFile(s, 'background.scripts');
          }
        }
        if (manifest.background.page) {
          checkFile(manifest.background.page, 'background.page');
        }
      }
    }

    // Content Scripts
    if (Array.isArray(manifest.content_scripts)) {
      for (let i = 0; i < manifest.content_scripts.length; i++) {
        const cs = manifest.content_scripts[i];
        if (Array.isArray(cs.js)) {
          for (const jsFile of cs.js) {
            checkFile(jsFile, `content_scripts[${i}].js`);
          }
        }
        if (Array.isArray(cs.css)) {
          for (const cssFile of cs.css) {
            checkFile(cssFile, `content_scripts[${i}].css`);
          }
        }
      }
    }

    // Action popup
    const action = manifest.action || manifest.browser_action || manifest.page_action || {};
    if (action.default_popup) {
      checkFile(action.default_popup, 'action.default_popup');
    }

    // Icons
    if (manifest.icons && typeof manifest.icons === 'object') {
      for (const [size, iconPath] of Object.entries(manifest.icons)) {
        checkFile(iconPath, `icons[${size}]`);
      }
    }

    // 4. Permissions Parsing & Disallowed Permission Rejection
    const rawPermissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    const rawHostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];

    // Separate host permissions vs API permissions
    const permissions = [];
    const hostPermissions = [...rawHostPermissions];

    for (const perm of rawPermissions) {
      if (typeof perm !== 'string') continue;
      if (perm === '<all_urls>' || perm.includes('://') || perm.includes('*')) {
        hostPermissions.push(perm);
      } else {
        permissions.push(perm);
      }
    }

    // Check disallowed permissions
    for (const perm of permissions) {
      if (DISALLOWED_PERMISSIONS.has(perm)) {
        securityLogger.warn('Extension requested disallowed permission', { permission: perm, extension: manifest.name });
        throw new Error(`Disallowed permission requested: ${perm}`);
      }
      if (perm === 'debugger' && !this.developerMode) {
        throw new Error('Permission "debugger" is restricted and requires Developer Mode to be enabled');
      }
    }

    // Categorize permissions into safe vs high risk
    const highRiskPermissions = [];
    const safePermissions = [];

    for (const perm of permissions) {
      if (HIGH_RISK_PERMISSIONS.has(perm)) {
        highRiskPermissions.push({
          id: perm,
          name: perm,
          description: PERMISSION_DESCRIPTIONS[perm] || `High-risk API access: ${perm}`,
          riskLevel: 'high'
        });
      } else {
        safePermissions.push({
          id: perm,
          name: perm,
          description: PERMISSION_DESCRIPTIONS[perm] || `Standard extension permission: ${perm}`,
          riskLevel: 'standard'
        });
      }
    }

    for (const host of hostPermissions) {
      const isBroad = host === '<all_urls>' || host.includes('*://*/*');
      highRiskPermissions.push({
        id: host,
        name: host,
        description: isBroad ? 'Access to data on all websites' : `Access to data on ${host}`,
        riskLevel: isBroad ? 'high' : 'medium'
      });
    }

    const id = this.generateExtensionId(resolvedDir);

    return {
      valid: true,
      id,
      name: manifest.name,
      version: manifest.version,
      manifestVersion: manifest.manifest_version,
      description: manifest.description || '',
      author: manifest.author || '',
      homepageUrl: manifest.homepage_url || '',
      permissions,
      hostPermissions,
      safePermissions,
      highRiskPermissions,
      totalPermissionsCount: permissions.length + hostPermissions.length,
      action: {
        default_title: action.default_title || manifest.name,
        default_popup: action.default_popup || null,
        default_icon: action.default_icon || null
      },
      icons: manifest.icons || null,
      optionsPage: manifest.options_page || (manifest.options_ui ? manifest.options_ui.page : null),
      path: resolvedDir,
      isLegacyMV2: manifest.manifest_version === 2
    };
  }

  // ─── Extension Lifecycle ──────────────────────────────────────────────────

  /**
   * Registers and installs an unpacked extension from folder path.
   *
   * @param {string} extensionDir
   * @param {object} [options]
   * @returns {Promise<object>} Installed extension metadata
   */
  async installUnpacked(extensionDir, options = {}) {
    const validated = this.validateExtension(extensionDir);
    const existing = this.extensions[validated.id];

    const record = {
      id: validated.id,
      name: validated.name,
      version: validated.version,
      manifestVersion: validated.manifestVersion,
      description: validated.description,
      author: validated.author,
      path: validated.path,
      enabled: options.enabled !== undefined ? Boolean(options.enabled) : true,
      installedAt: existing ? existing.installedAt : Date.now(),
      updatedAt: Date.now(),
      pinned: existing ? Boolean(existing.pinned) : false,
      allowIncognito: existing ? Boolean(existing.allowIncognito) : false,
      allowFileAccess: existing ? Boolean(existing.allowFileAccess) : true,
      siteAccess: existing ? existing.siteAccess : 'all',
      permissions: validated.permissions,
      hostPermissions: validated.hostPermissions,
      safePermissions: validated.safePermissions,
      highRiskPermissions: validated.highRiskPermissions,
      action: validated.action,
      icons: validated.icons,
      optionsPage: validated.optionsPage,
      status: 'installed',
      errors: []
    };

    this.extensions[validated.id] = record;
    this.saveRegistry();
    log.info(`Extension installed: ${record.name} (${record.id}) [MV${record.manifestVersion}]`);

    return record;
  }

  /**
   * Loads an extension into an Electron session.
   *
   * @param {object} sessionInstance Electron Session
   * @param {string} extensionId
   * @returns {Promise<object|null>}
   */
  async loadIntoSession(sessionInstance, extensionId) {
    const record = this.extensions[extensionId];
    if (!record) {
      throw new Error(`Extension not found in registry: ${extensionId}`);
    }

    if (!fs.existsSync(record.path)) {
      record.status = 'missing';
      log.warn(`Extension directory missing on load: ${record.path}`, { id: extensionId });
      return null;
    }

    if (!record.enabled) {
      log.info(`Skipping disabled extension: ${record.name}`, { id: extensionId });
      record.status = 'disabled';
      return null;
    }

    try {
      const ext = await sessionInstance.loadExtension(record.path, {
        allowFileAccess: Boolean(record.allowFileAccess)
      });

      record.status = 'active';
      record.loadedId = ext.id;
      record.errors = [];
      log.info(`Loaded extension into session: ${record.name}`, { id: record.id, chromiumId: ext.id });
      return ext;
    } catch (err) {
      record.status = 'error';
      this.recordError(extensionId, err);
      log.error(`Failed to load extension into session: ${record.name}`, { error: err.message, stack: err.stack });
      return null;
    }
  }

  /**
   * Unloads an extension from an Electron session.
   *
   * @param {object} sessionInstance Electron Session
   * @param {string} extensionId
   * @returns {Promise<boolean>}
   */
  async unloadFromSession(sessionInstance, extensionId) {
    const record = this.extensions[extensionId];
    if (!record) return false;

    const targetId = record.loadedId || extensionId;
    try {
      if (sessionInstance.removeExtension) {
        await sessionInstance.removeExtension(targetId);
      }
      record.status = record.enabled ? 'inactive' : 'disabled';
      log.info(`Unloaded extension from session: ${record.name}`, { id: targetId });
      return true;
    } catch (err) {
      log.warn(`Error unloading extension from session: ${record.name}`, { error: err.message });
      return false;
    }
  }

  /**
   * Enables an installed extension.
   *
   * @param {string} extensionId
   * @param {object} [sessionInstance]
   */
  async enableExtension(extensionId, sessionInstance = null) {
    const record = this.extensions[extensionId];
    if (!record) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    record.enabled = true;
    record.status = 'enabled';
    this.saveRegistry();

    if (sessionInstance) {
      await this.loadIntoSession(sessionInstance, extensionId);
    }
    log.info(`Extension enabled: ${record.name}`, { id: extensionId });
    return record;
  }

  /**
   * Disables an installed extension.
   *
   * @param {string} extensionId
   * @param {object} [sessionInstance]
   */
  async disableExtension(extensionId, sessionInstance = null) {
    const record = this.extensions[extensionId];
    if (!record) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    record.enabled = false;
    record.status = 'disabled';
    this.saveRegistry();

    if (sessionInstance) {
      await this.unloadFromSession(sessionInstance, extensionId);
    }
    log.info(`Extension disabled: ${record.name}`, { id: extensionId });
    return record;
  }

  /**
   * Uninstalls/removes an extension completely.
   *
   * @param {string} extensionId
   * @param {object} [sessionInstance]
   */
  async removeExtension(extensionId, sessionInstance = null) {
    const record = this.extensions[extensionId];
    if (!record) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    if (sessionInstance) {
      await this.unloadFromSession(sessionInstance, extensionId);
    }

    delete this.extensions[extensionId];
    this.saveRegistry();
    log.info(`Extension removed: ${record.name}`, { id: extensionId });
    return true;
  }

  /**
   * Reloads an unpacked extension (for developer iteration).
   *
   * @param {string} extensionId
   * @param {object} [sessionInstance]
   */
  async reloadExtension(extensionId, sessionInstance = null) {
    const record = this.extensions[extensionId];
    if (!record) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    // Validate current directory state
    const validated = this.validateExtension(record.path);
    record.name = validated.name;
    record.version = validated.version;
    record.description = validated.description;
    record.action = validated.action;
    record.permissions = validated.permissions;
    record.hostPermissions = validated.hostPermissions;
    record.safePermissions = validated.safePermissions;
    record.highRiskPermissions = validated.highRiskPermissions;
    record.errors = [];

    if (sessionInstance) {
      await this.unloadFromSession(sessionInstance, extensionId);
      if (record.enabled) {
        await this.loadIntoSession(sessionInstance, extensionId);
      }
    }

    this.saveRegistry();
    log.info(`Extension reloaded: ${record.name}`, { id: extensionId });
    return record;
  }

  // ─── Error Logging & Resilience ───────────────────────────────────────────

  /**
   * Records a runtime or startup error for an extension.
   *
   * @param {string} extensionId
   * @param {Error|string} error
   */
  recordError(extensionId, error) {
    const record = this.extensions[extensionId];
    if (!record) return;

    if (!Array.isArray(record.errors)) {
      record.errors = [];
    }

    const errObj = {
      id: `err_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      message: (error && error.message) ? error.message : String(error),
      stack: (error && error.stack) ? error.stack : null
    };

    record.errors.unshift(errObj);
    // Keep max 20 errors
    if (record.errors.length > 20) {
      record.errors = record.errors.slice(0, 20);
    }
    record.status = 'error';
    this.saveRegistry();
  }

  /**
   * Clears recorded runtime errors for an extension.
   *
   * @param {string} extensionId
   */
  clearErrors(extensionId) {
    const record = this.extensions[extensionId];
    if (!record) return false;

    record.errors = [];
    if (record.status === 'error') {
      record.status = record.enabled ? 'active' : 'disabled';
    }
    this.saveRegistry();
    return true;
  }

  // ─── Getters & Settings ───────────────────────────────────────────────────

  /**
   * Lists all extensions in the registry.
   */
  getAllExtensions() {
    return Object.values(this.extensions).map(ext => this.formatExtensionSummary(ext));
  }

  /**
   * Returns full details for an extension.
   *
   * @param {string} extensionId
   */
  getExtensionDetails(extensionId) {
    const record = this.extensions[extensionId];
    if (!record) return null;

    let sizeBytes = 0;
    try {
      sizeBytes = this.calculateDirectorySize(record.path);
    } catch (_) {}

    return {
      ...record,
      sizeBytes,
      sizeFormatted: this.formatBytes(sizeBytes)
    };
  }

  /**
   * Toggles whether an extension is pinned to the browser chrome toolbar.
   *
   * @param {string} extensionId
   * @param {boolean} pinned
   */
  setPinned(extensionId, pinned) {
    const record = this.extensions[extensionId];
    if (!record) throw new Error(`Extension not found: ${extensionId}`);
    record.pinned = Boolean(pinned);
    this.saveRegistry();
    return record.pinned;
  }

  /**
   * Toggles developer mode.
   *
   * @param {boolean} enabled
   */
  setDeveloperMode(enabled) {
    this.developerMode = Boolean(enabled);
    this.saveRegistry();
    return this.developerMode;
  }

  isDeveloperMode() {
    return Boolean(this.developerMode);
  }

  /**
   * Updates per-extension settings (allowIncognito, allowFileAccess, siteAccess).
   *
   * @param {string} extensionId
   * @param {object} settings
   */
  updateExtensionSettings(extensionId, settings = {}) {
    const record = this.extensions[extensionId];
    if (!record) throw new Error(`Extension not found: ${extensionId}`);

    if (settings.allowIncognito !== undefined) record.allowIncognito = Boolean(settings.allowIncognito);
    if (settings.allowFileAccess !== undefined) record.allowFileAccess = Boolean(settings.allowFileAccess);
    if (settings.siteAccess !== undefined) record.siteAccess = settings.siteAccess;

    this.saveRegistry();
    return record;
  }

  // ─── Update Mechanism (Local / Unpacked Architecture) ──────────────────────

  /**
   * Checks for updates for an extension.
   * For unpacked extensions: inspects manifest version on disk vs registry.
   *
   * @param {string} extensionId
   */
  async checkForUpdates(extensionId) {
    const record = this.extensions[extensionId];
    if (!record) throw new Error(`Extension not found: ${extensionId}`);

    if (!fs.existsSync(record.path)) {
      return { extensionId, status: 'missing', error: 'Extension directory not found' };
    }

    try {
      const validated = this.validateExtension(record.path);
      const hasNewVersion = validated.version !== record.version;

      return {
        extensionId,
        name: record.name,
        currentVersion: record.version,
        latestVersion: validated.version,
        updateAvailable: hasNewVersion,
        type: 'unpacked'
      };
    } catch (err) {
      return {
        extensionId,
        status: 'error',
        error: err.message
      };
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  formatExtensionSummary(record) {
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      manifestVersion: record.manifestVersion,
      description: record.description,
      enabled: Boolean(record.enabled),
      pinned: Boolean(record.pinned),
      status: record.status || (record.enabled ? 'active' : 'disabled'),
      isLegacyMV2: record.manifestVersion === 2,
      path: record.path,
      action: record.action || null,
      icons: record.icons || null,
      optionsPage: record.optionsPage || null,
      hasErrors: Array.isArray(record.errors) && record.errors.length > 0,
      errorsCount: Array.isArray(record.errors) ? record.errors.length : 0,
      highRiskCount: Array.isArray(record.highRiskPermissions) ? record.highRiskPermissions.length : 0
    };
  }

  calculateDirectorySize(dirPath, currentDepth = 0) {
    if (currentDepth > 10 || !fs.existsSync(dirPath)) return 0;
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += this.calculateDirectorySize(full, currentDepth + 1);
        } else if (entry.isFile()) {
          const s = fs.statSync(full);
          total += s.size;
        }
      } catch (_) {}
    }
    return total;
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

// Dual export for ESM and CJS compatibility
ExtensionManager.ExtensionManager = ExtensionManager;
module.exports = ExtensionManager;
