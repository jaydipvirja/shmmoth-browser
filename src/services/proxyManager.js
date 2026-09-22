/**
 * PROXY MANAGER SERVICE — proxyManager.js
 *
 * Manages network and proxy settings for SHMMOTH Browser.
 * Supports:
 *   - System default proxy
 *   - Direct connection (bypass proxy)
 *   - Manual proxy configuration (HTTP, HTTPS, SOCKS5)
 *   - Bypass rules for intranet/local sites
 *   - Encrypted proxy credentials
 *   - Session-wide proxy application via Electron session.setProxy()
 *   - Proxy connectivity testing
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const net    = require('net');
const { app } = require('electron');
const { mainLogger: log } = require('../utils/logger');

class ProxyManager {
  /**
   * @param {string} [customStoragePath]
   * @param {object} [passwordVault]
   */
  constructor(customStoragePath = null, passwordVault = null) {
    let userDataPath;
    try {
      userDataPath = app.getPath('userData');
    } catch (_) {
      userDataPath = require('os').tmpdir();
    }

    this.storagePath = customStoragePath || path.join(userDataPath, 'shmmoth-proxy.json');
    this.vault = passwordVault;

    this.config = {
      mode: 'system', // 'system' | 'direct' | 'manual'
      rules: {
        protocol: 'http', // 'http' | 'https' | 'socks5'
        host: '',
        port: 8080,
        username: '',
        encryptedPassword: '',
        bypassRules: '<local>;localhost;127.0.0.1',
      },
    };

    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (['system', 'direct', 'manual'].includes(parsed.mode)) {
            this.config.mode = parsed.mode;
          }
          if (parsed.rules && typeof parsed.rules === 'object') {
            this.config.rules = {
              protocol: ['http', 'https', 'socks5'].includes(parsed.rules.protocol)
                ? parsed.rules.protocol
                : 'http',
              host: typeof parsed.rules.host === 'string' ? parsed.rules.host.trim() : '',
              port: Number.isInteger(parsed.rules.port) && parsed.rules.port >= 1 && parsed.rules.port <= 65535
                ? parsed.rules.port
                : 8080,
              username: typeof parsed.rules.username === 'string' ? parsed.rules.username.trim() : '',
              encryptedPassword: typeof parsed.rules.encryptedPassword === 'string' ? parsed.rules.encryptedPassword : '',
              bypassRules: typeof parsed.rules.bypassRules === 'string' ? parsed.rules.bypassRules : '<local>;localhost;127.0.0.1',
            };
          }
          log.info('Proxy configuration loaded from disk', { mode: this.config.mode });
        }
      }
    } catch (err) {
      log.error('Failed to load proxy config from disk, using defaults', { error: err.message });
    }
  }

  save() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const data = {
        version: 1,
        mode: this.config.mode,
        rules: this.config.rules,
        updatedAt: new Date().toISOString(),
      };

      const tmpPath = this.storagePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.storagePath);
      log.info('Proxy configuration saved to disk', { mode: this.config.mode });
    } catch (err) {
      log.error('Failed to save proxy config to disk', { error: err.message });
      throw err;
    }
  }

  /**
   * Get raw configuration (internal use)
   */
  getConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Get public configuration safe for UI consumption
   */
  getPublicConfig() {
    return {
      mode: this.config.mode,
      rules: {
        protocol: this.config.rules.protocol,
        host: this.config.rules.host,
        port: this.config.rules.port,
        username: this.config.rules.username,
        hasPassword: Boolean(this.config.rules.encryptedPassword),
        bypassRules: this.config.rules.bypassRules,
      },
    };
  }

  /**
   * Update proxy settings
   * @param {object} newConfig
   */
  setConfig(newConfig) {
    if (!newConfig || typeof newConfig !== 'object') {
      throw new Error('Invalid proxy configuration object');
    }

    if (!['system', 'direct', 'manual'].includes(newConfig.mode)) {
      throw new Error("Mode must be 'system', 'direct', or 'manual'");
    }

    this.config.mode = newConfig.mode;

    if (newConfig.mode === 'manual') {
      const r = newConfig.rules || {};
      const protocol = ['http', 'https', 'socks5'].includes(r.protocol) ? r.protocol : 'http';
      const host = typeof r.host === 'string' ? r.host.trim() : '';
      const port = parseInt(r.port, 10);

      if (!host) {
        throw new Error('Proxy host cannot be empty for manual mode');
      }
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error('Proxy port must be between 1 and 65535');
      }

      this.config.rules.protocol = protocol;
      this.config.rules.host = host;
      this.config.rules.port = port;
      this.config.rules.username = typeof r.username === 'string' ? r.username.trim() : '';
      this.config.rules.bypassRules = typeof r.bypassRules === 'string' ? r.bypassRules.trim() : '<local>;localhost;127.0.0.1';

      // Handle password encryption
      if (typeof r.password === 'string' && r.password.length > 0) {
        if (this.vault) {
          this.config.rules.encryptedPassword = this.vault.encryptPassword(r.password);
        } else {
          // Base64-obfuscated fallback if vault not linked
          this.config.rules.encryptedPassword = 'b64:' + Buffer.from(r.password, 'utf8').toString('base64');
        }
      } else if (r.clearPassword) {
        this.config.rules.encryptedPassword = '';
      }
    }

    this.save();
    return this.getPublicConfig();
  }

  /**
   * Decrypt stored proxy password (for internal proxy auth)
   */
  getDecryptedPassword() {
    const enc = this.config.rules.encryptedPassword;
    if (!enc) return '';

    if (enc.startsWith('b64:')) {
      return Buffer.from(enc.slice(4), 'base64').toString('utf8');
    }

    if (this.vault) {
      try {
        return this.vault.decryptPassword(enc);
      } catch (err) {
        log.error('Failed to decrypt proxy password', { error: err.message });
        return '';
      }
    }

    return '';
  }

  /**
   * Build Electron session.setProxy configuration dictionary
   * @param {object} [cfg]
   * @returns {object}
   */
  buildElectronProxyConfig(cfg = null) {
    const conf = cfg || this.config;
    if (conf.mode === 'direct') {
      return { mode: 'direct' };
    }

    if (conf.mode === 'manual') {
      const { protocol, host, port, bypassRules } = conf.rules;
      if (!host) {
        return { mode: 'direct' };
      }

      let proxyRules;
      if (protocol === 'socks5') {
        proxyRules = `socks5://${host}:${port}`;
      } else if (protocol === 'https') {
        proxyRules = `https://${host}:${port}`;
      } else {
        proxyRules = `http://${host}:${port}`;
      }

      return {
        mode: 'fixed_servers',
        proxyRules,
        proxyBypassRules: bypassRules || '<local>;localhost;127.0.0.1',
      };
    }

    // Default 'system'
    return { mode: 'system' };
  }

  /**
   * Apply current proxy configuration to an Electron session
   * @param {Electron.Session} targetSession
   */
  async applyToSession(targetSession) {
    if (!targetSession || typeof targetSession.setProxy !== 'function') {
      throw new Error('Invalid target session provided');
    }

    const proxyConfig = this.buildElectronProxyConfig();
    log.info('Applying proxy settings to session', {
      mode: proxyConfig.mode,
      proxyRules: proxyConfig.proxyRules || 'none',
    });

    await targetSession.setProxy(proxyConfig);
  }

  /**
   * Reset proxy configuration to System Default and apply to session
   * @param {Electron.Session} [targetSession]
   */
  async resetToSystem(targetSession = null) {
    this.config.mode = 'system';
    this.save();

    if (targetSession) {
      await this.applyToSession(targetSession);
    }

    return this.getPublicConfig();
  }

  /**
   * Test network connection to a specified proxy endpoint or current config
   * @param {object} [testRules] Optional rules to test before saving
   * @returns {Promise<{ success: boolean, latencyMs?: number, error?: string }>}
   */
  testConnection(testRules = null) {
    return new Promise((resolve) => {
      const rules = testRules || (this.config.mode === 'manual' ? this.config.rules : null);

      if (!rules || !rules.host || !rules.port) {
        if (this.config.mode === 'direct' || this.config.mode === 'system') {
          return resolve({ success: true, latencyMs: 0, message: 'Direct/System mode active' });
        }
        return resolve({ success: false, error: 'No host or port specified for testing' });
      }

      const host = String(rules.host).trim();
      const port = parseInt(rules.port, 10);
      const startTime = Date.now();
      const socket = new net.Socket();

      socket.setTimeout(4000);

      socket.once('connect', () => {
        const latencyMs = Date.now() - startTime;
        socket.destroy();
        resolve({ success: true, latencyMs, host, port });
      });

      socket.once('timeout', () => {
        socket.destroy();
        resolve({ success: false, error: 'Connection timed out (4000ms)', host, port });
      });

      socket.once('error', (err) => {
        socket.destroy();
        resolve({ success: false, error: err.message, host, port });
      });

      try {
        socket.connect(port, host);
      } catch (err) {
        resolve({ success: false, error: err.message, host, port });
      }
    });
  }
}

ProxyManager.ProxyManager = ProxyManager;
module.exports = ProxyManager;

