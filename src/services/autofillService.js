/**
 * AUTOFILL SERVICE — autofillService.js
 *
 * Manages non-sensitive user identity and address profiles for form autofill.
 * Supports: Name, Email, Phone, Address, City, State, Country, Postal Code.
 * Ensures whole profiles are never exposed to arbitrary web pages.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
const { storageLogger: log } = require('../utils/logger');

class AutofillService {
  /**
   * @param {string} [customStoragePath] Optional custom storage path for testing
   */
  constructor(customStoragePath = null) {
    let userDataPath;
    try {
      userDataPath = app.getPath('userData');
    } catch (_) {
      userDataPath = require('os').tmpdir();
    }

    this.storagePath = customStoragePath || path.join(userDataPath, 'shmmoth-autofill.json');
    this.enabled = true;
    this.profiles = [];

    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        this.enabled = data.enabled !== false;
        this.profiles = Array.isArray(data.profiles) ? data.profiles : [];
        log.info('Autofill profiles loaded from disk', { count: this.profiles.length });
      } else {
        this.enabled = true;
        this.profiles = [];
      }
    } catch (err) {
      log.error('Failed to load autofill profiles from disk', { error: err.message });
      this.enabled = true;
      this.profiles = [];
    }
  }

  save() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const data = {
        version: 1,
        enabled: this.enabled,
        updatedAt: Date.now(),
        profiles: this.profiles
      };

      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (err) {
      log.error('Failed to save autofill profiles to disk', { error: err.message });
      return false;
    }
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  isAutofillEnabled() {
    return this.enabled;
  }

  setAutofillEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.save();
    log.info(`Autofill ${this.enabled ? 'enabled' : 'disabled'}`);
    return this.enabled;
  }

  // ─── Profile Operations ───────────────────────────────────────────────────

  getProfiles(searchQuery = '') {
    const q = (searchQuery || '').toLowerCase().trim();
    if (!q) return [...this.profiles];

    return this.profiles.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.email && p.email.toLowerCase().includes(q)) ||
      (p.address && p.address.toLowerCase().includes(q)) ||
      (p.city && p.city.toLowerCase().includes(q))
    );
  }

  getProfileById(id) {
    return this.profiles.find(p => p.id === id) || null;
  }

  /**
   * Save a new autofill profile.
   * @param {object} profileData
   */
  saveProfile(profileData = {}) {
    const profile = {
      id:         'profile_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name:       (profileData.name || '').trim(),
      email:      (profileData.email || '').trim(),
      phone:      (profileData.phone || '').trim(),
      address:    (profileData.address || '').trim(),
      city:       (profileData.city || '').trim(),
      state:      (profileData.state || '').trim(),
      country:    (profileData.country || '').trim(),
      postalCode: (profileData.postalCode || '').trim(),
      createdAt:  Date.now(),
      updatedAt:  Date.now()
    };

    if (!profile.name && !profile.email && !profile.address) {
      throw new Error('Profile must have at least a Name, Email, or Address');
    }

    this.profiles.push(profile);
    this.save();
    log.info(`Saved autofill profile ${profile.id}`, { name: profile.name });
    return profile;
  }

  /**
   * Update an existing profile.
   * @param {string} id
   * @param {object} updates
   */
  updateProfile(id, updates = {}) {
    const found = this.profiles.find(p => p.id === id);
    if (!found) return null;

    if (updates.name !== undefined)       found.name       = String(updates.name).trim();
    if (updates.email !== undefined)      found.email      = String(updates.email).trim();
    if (updates.phone !== undefined)      found.phone      = String(updates.phone).trim();
    if (updates.address !== undefined)    found.address    = String(updates.address).trim();
    if (updates.city !== undefined)       found.city       = String(updates.city).trim();
    if (updates.state !== undefined)      found.state      = String(updates.state).trim();
    if (updates.country !== undefined)    found.country    = String(updates.country).trim();
    if (updates.postalCode !== undefined) found.postalCode = String(updates.postalCode).trim();

    found.updatedAt = Date.now();
    this.save();
    log.info(`Updated autofill profile ${id}`);
    return found;
  }

  /**
   * Delete a profile.
   * @param {string} id
   */
  deleteProfile(id) {
    const initialLen = this.profiles.length;
    this.profiles = this.profiles.filter(p => p.id !== id);
    if (this.profiles.length !== initialLen) {
      this.save();
      log.info(`Deleted autofill profile ${id}`);
      return true;
    }
    return false;
  }

  /**
   * Delete all autofill profiles.
   */
  clearAllProfiles() {
    this.profiles = [];
    this.save();
    log.info('Cleared all autofill profiles');
    return true;
  }

  /**
   * Safe field suggestions lookup for web pages.
   * Only returns the requested single field value for matching profiles,
   * NEVER exposing the entire profile structure or unrelated fields.
   * @param {string} fieldType e.g. 'name'|'email'|'phone'|'address'|'city'|'postalCode'
   * @param {string} [prefix]
   */
  getFieldSuggestions(fieldType, prefix = '') {
    if (!this.enabled) return [];
    const validFields = ['name', 'email', 'phone', 'address', 'city', 'state', 'country', 'postalCode'];
    if (!validFields.includes(fieldType)) return [];

    const pre = (prefix || '').toLowerCase().trim();
    const suggestions = new Set();

    for (const p of this.profiles) {
      const val = p[fieldType];
      if (val && typeof val === 'string') {
        if (!pre || val.toLowerCase().startsWith(pre)) {
          suggestions.add(val);
        }
      }
    }

    return Array.from(suggestions).slice(0, 5).map(val => ({ value: val }));
  }
}

AutofillService.AutofillService = AutofillService;
module.exports = AutofillService;

