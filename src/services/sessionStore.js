/**
 * SESSION STORE — sessionStore.js
 *
 * Remembers which tabs were open so "Continue where I left off" (Settings → On start-up) can bring them back after a
 * normal exit, a crash or a power cut. Only normal tabs are stored — never incognito tabs — and only their address,
 * title, icon and pin state, not their page history or content.
 *
 * The file is rewritten shortly after every tab change (see main.js), atomically via utils/atomicJson, so a crash at
 * any moment leaves the last complete snapshot behind. Whatever is read back is validated again: addresses must be
 * http(s) or one of the known internal pages, everything else is dropped.
 */

'use strict';

const path = require('path');
const { writeJsonAtomic, readJsonRecovering, isPlainObject } = require('../utils/atomicJson');
const { displayUrl } = require('../utils/errorPage');

const FORMAT_VERSION = 1;
const MAX_TABS = 100;
const MAX_URL = 4096;
const MAX_TITLE = 200;
const MAX_FAVICON = 2048;

/** Internal pages that make sense to reopen (mtc://crash and anything unknown are not restored). */
const RESTORABLE_INTERNAL = new Set(['newtab', 'settings', 'bookmarks', 'history', 'downloads', 'extensions', 'notes']);

/** @returns {boolean} true when `url` may be reopened in a restored tab */
function isRestorableUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL) return false;
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  if (u.protocol === 'http:' || u.protocol === 'https:') return true;
  return u.protocol === 'mtc:' && RESTORABLE_INTERNAL.has(u.hostname);
}

const cleanIcon = (f) => (typeof f === 'string' && f.length <= MAX_FAVICON && /^https?:\/\//i.test(f)) ? f : '';
const cleanTitle = (t) => (typeof t === 'string' ? t.slice(0, MAX_TITLE) : '');

/**
 * @param {object} tabs        main.js tab map { id: { url, title, favicon, isPinned, isIncognito, pendingLoadUrl? } }
 * @param {string[]} order     ids of the normal tabs, left to right
 * @param {string|null} activeId
 * @returns {{version:number, savedAt:number, active:number, tabs:Array}}
 */
function buildSnapshot(tabs, order, activeId) {
  const out = [];
  let active = -1;
  for (const id of order || []) {
    const t = tabs && tabs[id];
    if (!t || t.isIncognito) continue;
    const url = t.pendingLoadUrl || displayUrl(t);          // a tab showing the error page is saved under the address that failed
    if (!isRestorableUrl(url)) continue;
    if (id === activeId) active = out.length;
    out.push({ url, title: cleanTitle(t.title), favicon: cleanIcon(t.favicon), pinned: Boolean(t.isPinned) });
    if (out.length >= MAX_TABS) break;
  }
  return { version: FORMAT_VERSION, savedAt: Date.now(), active: active >= 0 ? active : Math.max(0, out.length - 1), tabs: out };
}

/** Validates data read from disk. Returns null when nothing usable is in it. */
function sanitizeSnapshot(raw) {
  if (!isPlainObject(raw) || raw.version !== FORMAT_VERSION || !Array.isArray(raw.tabs)) return null;
  const tabs = [];
  for (const t of raw.tabs) {
    if (!isPlainObject(t) || !isRestorableUrl(t.url)) continue;
    tabs.push({ url: t.url, title: cleanTitle(t.title), favicon: cleanIcon(t.favicon), pinned: t.pinned === true });
    if (tabs.length >= MAX_TABS) break;
  }
  if (tabs.length === 0) return null;
  const active = Number.isInteger(raw.active) && raw.active >= 0 && raw.active < tabs.length ? raw.active : tabs.length - 1;
  return { version: FORMAT_VERSION, savedAt: Number(raw.savedAt) || 0, active, tabs };
}

class SessionStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'shmmoth-session.json');
    this._last = '';
  }

  /** @returns the saved session, or null (no file, damaged file, nothing restorable) */
  load() {
    try {
      const res = readJsonRecovering(this.filePath, { validate: (d) => isPlainObject(d) });
      return sanitizeSnapshot(res.data);
    } catch (_) {
      return null;
    }
  }

  /** Writes the snapshot unless it is identical to the previous one. Never throws (a failed save must not break browsing). */
  save(snapshot) {
    try {
      const fingerprint = JSON.stringify(snapshot.tabs) + snapshot.active;
      if (fingerprint === this._last) return false;
      writeJsonAtomic(this.filePath, snapshot, { backupIntervalMs: 60000, space: 0 });
      this._last = fingerprint;
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = { SessionStore, buildSnapshot, sanitizeSnapshot, isRestorableUrl, MAX_TABS };
