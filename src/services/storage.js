/**
 * STORAGE SERVICE — storage.js
 *
 * Persistent local storage for SHMMOTH Browser application data.
 * Stage 2: Enhanced History (visitCount, timestamps, time ranges)
 *          Enhanced Bookmarks (folders, search, edit, move)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
const { storageLogger: log } = require('../utils/logger');

class StorageService {
  constructor() {
    let userDataPath;
    try {
      userDataPath = app.getPath('userData');
    } catch (_) {
      userDataPath = require('os').tmpdir();
    }
    this.storagePath = path.join(userDataPath, 'mtc-data.json');

    this.defaultData = {
      settings: {
        searchEngine: 'google',
        searchEngineUrls: {
          google:     'https://www.google.com/search?q=',
          duckduckgo: 'https://duckduckgo.com/?q=',
          bing:       'https://www.bing.com/search?q=',
          yahoo:      'https://search.yahoo.com/search?p='
        },
        adBlockerEnabled:       true,
        ramSaverEnabled:        true,
        ramSaverTimeoutMinutes: 15,
        theme:                  'dark',
        homepage:               'mtc://newtab',
        showBookmarksBar:       true,
        downloadPath:           '',
        askWhereToSave:         false
      },
      bookmarkFolders: ['Bookmarks Bar', 'Other Bookmarks'],
      bookmarks: [
        { id: 'bm_1', title: 'Google',    url: 'https://www.google.com',    favicon: 'https://www.google.com/favicon.ico',                                            folder: 'Bookmarks Bar', createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'bm_2', title: 'YouTube',   url: 'https://www.youtube.com',   favicon: 'https://www.youtube.com/favicon.ico',                                           folder: 'Bookmarks Bar', createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'bm_3', title: 'GitHub',    url: 'https://github.com',        favicon: 'https://github.githubassets.com/favicons/favicon.png',                          folder: 'Bookmarks Bar', createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'bm_4', title: 'Wikipedia', url: 'https://www.wikipedia.org', icon: '📚',                                                                              folder: 'Bookmarks Bar', createdAt: Date.now(), updatedAt: Date.now() }
      ],
      history:   [],
      notes:     'Welcome to SHMMOTH Browser Quick Notes!\nWrite any notes, links, or ideas here - they save automatically.',
      shortcuts: [
        { id: 'sc_1', title: 'Google',     url: 'https://www.google.com',    icon: '🔍' },
        { id: 'sc_2', title: 'YouTube',    url: 'https://www.youtube.com',   icon: '▶️' },
        { id: 'sc_3', title: 'GitHub',     url: 'https://github.com',        icon: '💻' },
        { id: 'sc_4', title: 'Wikipedia',  url: 'https://www.wikipedia.org', icon: '📚' }
      ],
      sitePermissions: {}
    };

    this.data = this.load();
    if (!this.data.sitePermissions) {
      this.data.sitePermissions = {};
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GENERIC STORAGE INTERFACE
  // ═══════════════════════════════════════════════════════════════════

  get(key, defaultValue = undefined) {
    return key in this.data ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  has(key) {
    return key in this.data;
  }

  delete(key) {
    delete this.data[key];
    this.save();
  }

  clear(key) {
    if (key in this.defaultData) {
      this.data[key] = JSON.parse(JSON.stringify(this.defaultData[key]));
      this.save();
    } else {
      this.delete(key);
    }
  }

  getSensitive(key) {
    log.warn('getSensitive() called but safeStorage is not yet implemented. Returning null.');
    return null;
  }

  setSensitive(key, value) {
    log.warn('setSensitive() called but safeStorage is not yet implemented. Value NOT stored.');
    throw new Error('Sensitive storage is not yet implemented. Do not store secrets in plain JSON.');
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE I/O
  // ═══════════════════════════════════════════════════════════════════

  load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const fileContent = fs.readFileSync(this.storagePath, 'utf-8');
        const parsed = JSON.parse(fileContent);
        const merged = {
          ...this.defaultData,
          ...parsed,
          settings: { ...this.defaultData.settings, ...(parsed.settings || {}) },
          bookmarkFolders: parsed.bookmarkFolders || this.defaultData.bookmarkFolders
        };
        log.info('Storage loaded from disk', { path: this.storagePath });
        return merged;
      }
    } catch (err) {
      log.error('Error loading storage file, using defaults', { error: err.message });
    }
    return JSON.parse(JSON.stringify(this.defaultData));
  }

  save() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      log.error('Error saving storage file', { error: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════════════

  getSettings() {
    return this.data.settings;
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
    return this.data.settings;
  }

  // ═══════════════════════════════════════════════════════════════════
  // BOOKMARKS (Stage 2)
  // ═══════════════════════════════════════════════════════════════════

  getBookmarks(folderOrFilter) {
    let list = this.data.bookmarks || [];
    if (typeof folderOrFilter === 'string' && folderOrFilter.trim()) {
      const f = folderOrFilter.trim();
      if (f !== 'All Bookmarks') {
        list = list.filter(b => (b.folder || 'Bookmarks Bar') === f);
      }
    } else if (folderOrFilter && typeof folderOrFilter === 'object') {
      if (folderOrFilter.folder && folderOrFilter.folder !== 'All Bookmarks') {
        list = list.filter(b => (b.folder || 'Bookmarks Bar') === folderOrFilter.folder);
      }
      if (folderOrFilter.query) {
        const q = folderOrFilter.query.toLowerCase();
        list = list.filter(b =>
          (b.title && b.title.toLowerCase().includes(q)) ||
          (b.url && b.url.toLowerCase().includes(q))
        );
      }
    }
    return list;
  }

  getBookmarkFolders() {
    if (!this.data.bookmarkFolders || !Array.isArray(this.data.bookmarkFolders)) {
      this.data.bookmarkFolders = ['Bookmarks Bar', 'Other Bookmarks'];
    }
    return [...this.data.bookmarkFolders];
  }

  addBookmarkFolder(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return this.getBookmarkFolders();
    if (!this.data.bookmarkFolders.includes(trimmed)) {
      this.data.bookmarkFolders.push(trimmed);
      this.save();
    }
    return this.getBookmarkFolders();
  }

  removeBookmarkFolder(name) {
    const trimmed = (name || '').trim();
    if (trimmed === 'Bookmarks Bar' || trimmed === 'Other Bookmarks') {
      return this.getBookmarkFolders(); // Protected default folders
    }
    this.data.bookmarkFolders = this.data.bookmarkFolders.filter(f => f !== trimmed);
    // Re-assign bookmarks in this folder to 'Other Bookmarks'
    if (this.data.bookmarks) {
      this.data.bookmarks.forEach(b => {
        if (b.folder === trimmed) {
          b.folder = 'Other Bookmarks';
          b.updatedAt = Date.now();
        }
      });
    }
    this.save();
    return this.getBookmarkFolders();
  }

  addBookmark(item) {
    if (!item || !item.url) return this.data.bookmarks || [];
    const url = item.url.trim();
    const existing = (this.data.bookmarks || []).find(b => b.url === url);
    const now = Date.now();

    if (existing) {
      existing.title     = item.title || existing.title || url;
      existing.favicon   = item.favicon || existing.favicon || '';
      existing.folder    = item.folder || existing.folder || 'Bookmarks Bar';
      existing.updatedAt = now;
    } else {
      const newBm = {
        id:        'bm_' + now + '_' + Math.floor(Math.random() * 1000),
        title:     item.title || url,
        url:       url,
        favicon:   item.favicon || '',
        folder:    item.folder || 'Bookmarks Bar',
        createdAt: now,
        updatedAt: now
      };
      if (!this.data.bookmarks) this.data.bookmarks = [];
      this.data.bookmarks.push(newBm);
    }
    this.save();
    return this.data.bookmarks;
  }

  editBookmark(id, updates) {
    if (!id || !updates || !this.data.bookmarks) return null;
    const bm = this.data.bookmarks.find(b => b.id === id);
    if (!bm) return null;

    if (updates.title !== undefined)   bm.title = updates.title.trim();
    if (updates.url !== undefined)     bm.url   = updates.url.trim();
    if (updates.folder !== undefined)  bm.folder = updates.folder.trim();
    if (updates.favicon !== undefined) bm.favicon = updates.favicon;
    bm.updatedAt = Date.now();

    this.save();
    return bm;
  }

  moveBookmark(id, targetFolder) {
    return this.editBookmark(id, { folder: targetFolder });
  }

  removeBookmark(urlOrId) {
    if (!urlOrId || !this.data.bookmarks) return this.data.bookmarks || [];
    const target = urlOrId.trim();
    this.data.bookmarks = this.data.bookmarks.filter(b => b.id !== target && b.url !== target);
    this.save();
    return this.data.bookmarks;
  }

  searchBookmarks(query) {
    if (!query || typeof query !== 'string') return this.getBookmarks();
    const q = query.toLowerCase().trim();
    return (this.data.bookmarks || []).filter(b =>
      (b.title && b.title.toLowerCase().includes(q)) ||
      (b.url && b.url.toLowerCase().includes(q)) ||
      (b.folder && b.folder.toLowerCase().includes(q))
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // HISTORY (Stage 2)
  // ═══════════════════════════════════════════════════════════════════

  getHistory(query) {
    const list = this.data.history || [];
    if (!query || typeof query !== 'string') return list;
    const q = query.toLowerCase().trim();
    return list.filter(h =>
      (h.title && h.title.toLowerCase().includes(q)) ||
      (h.url && h.url.toLowerCase().includes(q))
    );
  }

  addHistory(item) {
    if (!item || !item.url) return;
    const url = item.url.trim();
    if (url.startsWith('mtc://') || url.startsWith('about:')) return;

    if (!this.data.history) this.data.history = [];
    const now = Date.now();

    // Check if URL already visited
    const existingIndex = this.data.history.findIndex(h => h.url === url);
    if (existingIndex >= 0) {
      const existing = this.data.history[existingIndex];
      existing.visitCount = (existing.visitCount || 1) + 1;
      existing.visitTime  = now;
      if (item.title && item.title !== 'New Tab') existing.title = item.title;
      if (item.favicon) existing.favicon = item.favicon;

      // Bring to top of history
      this.data.history.splice(existingIndex, 1);
      this.data.history.unshift(existing);
    } else {
      const record = {
        id:         'hist_' + now + '_' + Math.floor(Math.random() * 1000),
        title:      item.title || url,
        url:        url,
        favicon:    item.favicon || '',
        visitTime:  now,
        visitCount: 1
      };
      this.data.history.unshift(record);
    }

    // Cap history at 2,000 entries
    if (this.data.history.length > 2000) {
      this.data.history = this.data.history.slice(0, 2000);
    }
    this.save();
  }

  deleteHistoryItem(id) {
    if (!id || !this.data.history) return this.data.history || [];
    this.data.history = this.data.history.filter(h => h.id !== id);
    this.save();
    return this.data.history;
  }

  deleteHistoryItems(ids) {
    if (!Array.isArray(ids) || !this.data.history) return this.data.history || [];
    const set = new Set(ids);
    this.data.history = this.data.history.filter(h => !set.has(h.id));
    this.save();
    return this.data.history;
  }

  clearHistoryByRange(range = 'all') {
    if (!this.data.history) return true;
    const now = Date.now();

    let cutoff = 0;
    if (range === 'hour') {
      cutoff = now - 3600 * 1000;
    } else if (range === 'day') {
      cutoff = now - 24 * 3600 * 1000;
    } else if (range === 'week') {
      cutoff = now - 7 * 24 * 3600 * 1000;
    } else if (range === 'month') {
      cutoff = now - 28 * 24 * 3600 * 1000;
    } else if (range === 'all') {
      this.data.history = [];
      this.save();
      return true;
    }

    if (cutoff > 0) {
      this.data.history = this.data.history.filter(h => {
        const t = h.visitTime || h.timestamp || 0;
        return t < cutoff;
      });
      this.save();
    }
    return true;
  }

  clearHistory() {
    return this.clearHistoryByRange('all');
  }

  // ═══════════════════════════════════════════════════════════════════
  // NOTES & SHORTCUTS
  // ═══════════════════════════════════════════════════════════════════

  getNotes() {
    return this.data.notes || '';
  }

  saveNotes(notes) {
    this.data.notes = notes;
    this.save();
    return true;
  }

  getShortcuts() {
    return this.data.shortcuts || this.defaultData.shortcuts;
  }

  addShortcut(shortcut) {
    this.data.shortcuts.push({
      id:    'sc_' + Date.now(),
      title: shortcut.title,
      url:   shortcut.url,
      icon:  shortcut.icon || '🌐'
    });
    this.save();
    return this.data.shortcuts;
  }

  removeShortcut(id) {
    this.data.shortcuts = this.data.shortcuts.filter(s => s.id !== id);
    this.save();
    return this.data.shortcuts;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SITE PERMISSIONS (Stage 5)
  // ═══════════════════════════════════════════════════════════════════

  getSitePermissions(origin = null) {
    this.data.sitePermissions = this.data.sitePermissions || {};
    if (origin) {
      return this.data.sitePermissions[origin] || {};
    }
    return this.data.sitePermissions;
  }

  setSitePermission(origin, permission, decision) {
    if (!origin || !permission) return false;
    this.data.sitePermissions = this.data.sitePermissions || {};
    if (!this.data.sitePermissions[origin]) {
      this.data.sitePermissions[origin] = {};
    }
    this.data.sitePermissions[origin][permission] = decision; // 'allow' | 'block' | 'ask'
    this.save();
    log.info(`Permission set: ${permission}=${decision} for ${origin}`);
    return true;
  }

  removeSitePermission(origin, permission = null) {
    this.data.sitePermissions = this.data.sitePermissions || {};
    if (!this.data.sitePermissions[origin]) return false;

    if (permission) {
      delete this.data.sitePermissions[origin][permission];
      if (Object.keys(this.data.sitePermissions[origin]).length === 0) {
        delete this.data.sitePermissions[origin];
      }
    } else {
      delete this.data.sitePermissions[origin];
    }
    this.save();
    log.info(`Permission removed for ${origin} (perm: ${permission || 'all'})`);
    return true;
  }

  clearAllSitePermissions() {
    this.data.sitePermissions = {};
    this.save();
    log.info('All site permissions cleared');
    return true;
  }
}

module.exports = StorageService;
