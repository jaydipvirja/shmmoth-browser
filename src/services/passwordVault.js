/**
 * PASSWORD VAULT SERVICE — passwordVault.js
 *
 * Secure credential storage for SHMMOTH Browser.
 * Encrypts passwords at rest using Electron safeStorage (Windows DPAPI).
 *
 * If OS-level encryption is NOT available the vault refuses to store passwords
 * (see ENCRYPTION_UNAVAILABLE) instead of silently using a key that anyone
 * can recompute. The AES fallback below exists only for unit tests/dev
 * (`allowInsecureFallback: true`) and to READ + migrate records written by
 * earlier versions.
 *
 * NEVER PERSISTS PLAINTEXT PASSWORDS.
 * NEVER LOGS PASSWORDS.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const { storageLogger: log } = require('../utils/logger');
const { writeJsonAtomic, readJsonRecovering, isPlainObject } = require('../utils/atomicJson');

class PasswordVault {
  /**
   * @param {string} [customStoragePath] Optional custom storage path for tests
   * @param {object} [options]
   * @param {boolean} [options.allowInsecureFallback=false] TESTS/DEV ONLY: use a machine-derived AES key
   *        when OS encryption is unavailable. Never enable in production.
   */
  constructor(customStoragePath = null, options = {}) {
    this.allowInsecureFallback = Boolean(options && options.allowInsecureFallback);

    let userDataPath;
    try {
      userDataPath = app.getPath('userData');
    } catch (_) {
      userDataPath = require('os').tmpdir();
    }

    this.vaultPath = customStoragePath || path.join(userDataPath, 'shmmoth-vault.json');

    // LEGACY key (versions <= 1.0.16 used it whenever safeStorage was unavailable). It is derived from the
    // hostname, i.e. anyone who has the vault file can recompute it, so it is kept ONLY to read and migrate
    // old 'aes:' records (and for the test/dev insecure fallback).
    this.fallbackKey = crypto.createHash('sha256')
      .update('SHMMOTH_SECURE_VAULT_KEY_' + (process.env.COMPUTERNAME || process.env.HOSTNAME || 'LOCALHOST'))
      .digest();

    this.credentials = [];
    this.neverSaveOrigins = [];

    this.load();
  }

  // ─── Encryption / Decryption ──────────────────────────────────────────────

  /** True when the OS can protect secrets for us (Windows DPAPI / macOS Keychain / Linux keyring). */
  _osEncryptionAvailable() {
    try {
      return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
    } catch (_) {
      return false;
    }
  }

  /** Whether passwords can currently be stored (used to avoid offering a save prompt that cannot succeed). */
  canEncrypt() {
    return this._osEncryptionAvailable() || this.allowInsecureFallback;
  }

  /**
   * Encrypt a plaintext password string.
   * Returns base64 encoded ciphertext with metadata prefix.
   * @param {string} plaintext
   * @returns {string}
   * @throws {Error} code ENCRYPTION_UNAVAILABLE when no secure encryption is available
   */
  encryptPassword(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Invalid plaintext password');
    }

    if (this._osEncryptionAvailable()) {
      try {
        const encryptedBuf = safeStorage.encryptString(plaintext);
        return 'safe:' + encryptedBuf.toString('base64');
      } catch (err) {
        log.warn('safeStorage encryption failed', { error: err.message });
      }
    }

    if (!this.allowInsecureFallback) {
      const err = new Error('Secure password storage (OS encryption) is not available on this system, so the password was not saved.');
      err.code = 'ENCRYPTION_UNAVAILABLE';
      throw err;
    }

    return this._encryptLegacyAes(plaintext);
  }

  _encryptLegacyAes(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.fallbackKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    return `aes:${iv.toString('base64')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypt ciphertext back to plaintext.
   * Only called on explicit user authorization (reveal or autofill).
   * @param {string} ciphertext
   * @returns {string}
   */
  decryptPassword(ciphertext) {
    if (!ciphertext || typeof ciphertext !== 'string') {
      throw new Error('Invalid ciphertext');
    }

    if (ciphertext.startsWith('safe:')) {
      const b64 = ciphertext.slice(5);
      const buf = Buffer.from(b64, 'base64');
      if (safeStorage && typeof safeStorage.decryptString === 'function') {
        return safeStorage.decryptString(buf);
      }
      throw new Error('safeStorage unavailable to decrypt credential');
    }

    if (ciphertext.startsWith('aes:')) {
      const parts = ciphertext.split(':');
      if (parts.length !== 4) throw new Error('Malformed AES ciphertext');
      const iv = Buffer.from(parts[1], 'base64');
      const authTag = Buffer.from(parts[2], 'base64');
      const encrypted = parts[3];

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.fallbackKey, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }

    throw new Error('Unrecognized encryption scheme');
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  load() {
    const validate = (d) => isPlainObject(d)
      && (d.credentials === undefined || Array.isArray(d.credentials));
    const res = readJsonRecovering(this.vaultPath, { validate });
    this.persistBlocked = res.source === 'unreadable';

    if (res.source === 'unreadable') {
      log.error('Password vault exists but cannot be read; vault is read-only this session to protect it', {
        error: res.error && res.error.message
      });
    } else if (res.corruptPath) {
      log.error('Password vault file was damaged; the damaged copy was preserved', {
        corruptCopy: res.corruptPath, recoveredFromBackup: res.source === 'backup'
      });
    }

    if (res.data) {
      this.credentials = Array.isArray(res.data.credentials) ? res.data.credentials : [];
      this.neverSaveOrigins = Array.isArray(res.data.neverSaveOrigins) ? res.data.neverSaveOrigins : [];
      log.info('Password vault loaded from disk', { count: this.credentials.length, source: res.source });
      this._migrateLegacyRecords();
    } else {
      this.credentials = [];
      this.neverSaveOrigins = [];
    }
  }

  /**
   * Records written by earlier versions with the hostname-derived AES key ('aes:') are re-encrypted
   * with OS-level protection as soon as it is available.
   */
  _migrateLegacyRecords() {
    if (!this._osEncryptionAvailable() || this.persistBlocked) return;
    let migrated = 0;
    for (const c of this.credentials) {
      if (typeof c.encryptedPassword !== 'string' || !c.encryptedPassword.startsWith('aes:')) continue;
      try {
        const plain = this.decryptPassword(c.encryptedPassword);
        c.encryptedPassword = 'safe:' + safeStorage.encryptString(plain).toString('base64');
        migrated++;
      } catch (err) {
        log.warn('Could not migrate a legacy credential', { id: c.id, error: err.message });
      }
    }
    if (migrated > 0) {
      this.save();
      log.info(`Migrated ${migrated} legacy credential(s) to OS-protected encryption`);
    }
  }

  save() {
    if (this.persistBlocked) return false;
    try {
      const data = {
        version: 1,
        updatedAt: Date.now(),
        neverSaveOrigins: this.neverSaveOrigins,
        credentials: this.credentials.map(c => ({
          id: c.id,
          origin: c.origin,
          username: c.username,
          encryptedPassword: c.encryptedPassword,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          lastUsedAt: c.lastUsedAt
        }))
      };

      // Atomic + fsync'ed, and the previous good vault is kept as shmmoth-vault.json.bak
      writeJsonAtomic(this.vaultPath, data, { backupIntervalMs: 0, validate: isPlainObject });
      return true;
    } catch (err) {
      log.error('Failed to save password vault to disk', { error: err.message });
      return false;
    }
  }

  _cleanOrigin(urlOrOrigin) {
    if (!urlOrOrigin || typeof urlOrOrigin !== 'string') return '';
    try {
      return new URL(urlOrOrigin).origin;
    } catch (_) {
      return urlOrOrigin.trim().toLowerCase();
    }
  }

  // ─── Credential Operations ────────────────────────────────────────────────

  /**
   * Save or update credentials for an origin.
   * @param {string} origin
   * @param {string} username
   * @param {string} plainPassword
   * @returns {object} metadata of saved credential (NO plain password)
   */
  saveCredential(originOrObj, username, plainPassword) {
    let cleanOrigin, cleanUser, password;
    if (originOrObj && typeof originOrObj === 'object') {
      cleanOrigin = this._cleanOrigin(originOrObj.origin);
      cleanUser   = (originOrObj.username || '').trim();
      password    = originOrObj.password || originOrObj.plainPassword;
    } else {
      cleanOrigin = this._cleanOrigin(originOrObj);
      cleanUser   = (username || '').trim();
      password    = plainPassword;
    }

    if (!cleanOrigin || !cleanUser || !password) {
      throw new Error('Invalid credential parameters (origin, username, and password required)');
    }

    if (this.isNeverSaveOrigin(cleanOrigin)) {
      log.info(`Password save suppressed for blacklisted origin: ${cleanOrigin}`);
      return null;
    }

    const encrypted = this.encryptPassword(password);
    const existing = this.credentials.find(c => c.origin === cleanOrigin && c.username === cleanUser);

    if (existing) {
      const previous = { ...existing };
      existing.encryptedPassword = encrypted;
      existing.updatedAt = Date.now();
      existing.lastUsedAt = Date.now();
      if (!this.save()) {
        Object.assign(existing, previous);
        throw this._persistError();
      }
      log.info(`Updated existing credential for ${cleanOrigin}`);
      return { id: existing.id, origin: existing.origin, username: existing.username, updatedAt: existing.updatedAt };
    }

    const record = {
      id: 'cred_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      origin: cleanOrigin,
      username: cleanUser,
      encryptedPassword: encrypted,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: Date.now()
    };

    this.credentials.push(record);
    if (!this.save()) {
      this.credentials.pop();
      throw this._persistError();
    }
    log.info(`Saved new credential for ${cleanOrigin}`);
    return {
      id: record.id,
      origin: record.origin,
      username: record.username,
      encryptedPassword: record.encryptedPassword,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }


  _persistError() {
    const err = new Error('The password vault could not be written to disk, so the password was not saved.');
    err.code = 'VAULT_WRITE_FAILED';
    return err;
  }

  /**
   * Retrieve credential metadata matching an origin (without plain password).
   * @param {string} origin
   * @returns {Array<object>}
   */
  getCredentialsForOrigin(origin) {
    const clean = this._cleanOrigin(origin);
    return this.credentials
      .filter(c => c.origin === clean)
      .map(c => ({
        id: c.id,
        origin: c.origin,
        username: c.username,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        lastUsedAt: c.lastUsedAt
      }));
  }

  /**
   * Get all saved credential records metadata for management UI.
   * Plaintext passwords are NEVER returned here.
   * @param {string} [searchQuery]
   * @returns {Array<object>}
   */
  getAllCredentialsMetadata(searchQuery = '') {
    const query = (searchQuery || '').toLowerCase().trim();
    return this.credentials
      .filter(c => {
        if (!query) return true;
        return c.origin.toLowerCase().includes(query) || c.username.toLowerCase().includes(query);
      })
      .map(c => ({
        id: c.id,
        origin: c.origin,
        username: c.username,
        hasPassword: Boolean(c.encryptedPassword),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        lastUsedAt: c.lastUsedAt
      }));
  }

  getCredentialById(id) {
    const found = this.credentials.find(c => c.id === id);
    if (!found) return null;
    return {
      id: found.id,
      origin: found.origin,
      username: found.username,
      hasPassword: Boolean(found.encryptedPassword),
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
      lastUsedAt: found.lastUsedAt
    };
  }

  /**
   * Update an existing credential record.
   * @param {string} id
   * @param {object} updates
   */
  updateCredential(id, updates = {}) {
    const found = this.credentials.find(c => c.id === id);
    if (!found) return false;

    const previous = { ...found };
    if (updates.username) {
      found.username = updates.username.trim();
    }

    if (updates.password) {
      found.encryptedPassword = this.encryptPassword(updates.password);
    }

    found.updatedAt = Date.now();
    if (!this.save()) {
      Object.assign(found, previous);
      throw this._persistError();
    }
    log.info(`Updated credential ${id}`);
    return { id: found.id, origin: found.origin, username: found.username, updatedAt: found.updatedAt };
  }

  /**
   * Delete a single credential record.
   * @param {string} id
   */
  deleteCredential(id) {
    const initialLen = this.credentials.length;
    this.credentials = this.credentials.filter(c => c.id !== id);
    if (this.credentials.length !== initialLen) {
      this.save();
      log.info(`Deleted credential ${id}`);
      return true;
    }
    return false;
  }

  /**
   * Delete all saved credentials.
   */
  clearAllCredentials() {
    this.credentials = [];
    this.save();
    log.info('Cleared all credentials from password vault');
    return true;
  }

  /**
   * Decrypt a password ONLY for authorized user interaction (e.g. reveal in UI or autofill injection).
   * @param {string} id
   * @returns {string|null}
   */
  decryptForAuthorizedUse(id) {
    const found = this.credentials.find(c => c.id === id);
    if (!found || !found.encryptedPassword) return null;

    try {
      const plaintext = this.decryptPassword(found.encryptedPassword);
      found.lastUsedAt = Date.now();
      this.save();
      return plaintext;
    } catch (err) {
      log.warn(`Could not decrypt credential ${id}`, { error: err.message });
      return null;
    }
  }

  // ─── Never Save (Blacklist) ───────────────────────────────────────────────

  addNeverSaveOrigin(origin) {
    const clean = this._cleanOrigin(origin);
    if (clean && !this.neverSaveOrigins.includes(clean)) {
      this.neverSaveOrigins.push(clean);
      this.save();
      log.info(`Added ${clean} to neverSave origins`);
    }
    return true;
  }

  neverSaveOrigin(origin) {
    return this.addNeverSaveOrigin(origin);
  }

  removeNeverSaveOrigin(origin) {
    const clean = this._cleanOrigin(origin);
    this.neverSaveOrigins = this.neverSaveOrigins.filter(o => o !== clean);
    this.save();
    return true;
  }

  isNeverSaveOrigin(origin) {
    const clean = this._cleanOrigin(origin);
    return this.neverSaveOrigins.includes(clean);
  }
}

PasswordVault.PasswordVault = PasswordVault;
module.exports = PasswordVault;

