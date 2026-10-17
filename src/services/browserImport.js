/**
 * Import bookmarks and history from Chrome, Edge or Brave on this computer (Settings → General, the Welcome card).
 *
 * Only reads: the other browser's `Bookmarks` file (JSON) and a copy of its `History` database (SQLite, opened
 * read-only through node:sqlite; the copy is needed because the browser may have the file open). Passwords and
 * cookies are not imported: the other browsers encrypt them for themselves.
 *
 * Callers pass a browser id and a profile folder name as they were offered by detect(); anything else is refused,
 * so no page can make the browser read a path of its choosing.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BOOKMARKS = 5000;
const MAX_HISTORY = 2000;                       // the browser keeps 2,000 history entries (storage.js)
const MAX_TITLE = 500;
const CHROME_EPOCH_OFFSET_MS = 11644473600000;  // Chromium counts microseconds from 1601-01-01

const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', win: ['Google', 'Chrome', 'User Data'], linux: ['google-chrome'], mac: ['Google', 'Chrome'] },
  { id: 'edge', name: 'Microsoft Edge', win: ['Microsoft', 'Edge', 'User Data'], linux: ['microsoft-edge'], mac: ['Microsoft Edge'] },
  { id: 'brave', name: 'Brave', win: ['BraveSoftware', 'Brave-Browser', 'User Data'], linux: ['BraveSoftware', 'Brave-Browser'], mac: ['BraveSoftware', 'Brave-Browser'] }
];

/** Where each browser keeps its profiles on this system. */
function userDataDir(browser, { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(local, ...browser.win);
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', ...browser.mac);
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), ...browser.linux);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** The installed browsers with at least one profile that has bookmarks or history. */
function detect(opts = {}) {
  const found = [];
  for (const b of BROWSERS) {
    const root = userDataDir(b, opts);
    if (!fs.existsSync(root)) continue;
    const state = readJson(path.join(root, 'Local State'));
    const cache = state && state.profile && state.profile.info_cache && typeof state.profile.info_cache === 'object' ? state.profile.info_cache : {};
    const dirs = Object.keys(cache).length ? Object.keys(cache) : ['Default'];
    const profiles = [];
    for (const dir of dirs) {
      if (!/^[A-Za-z0-9 _-]{1,64}$/.test(dir)) continue;           // "Default", "Profile 1" …
      const p = path.join(root, dir);
      const hasBookmarks = fs.existsSync(path.join(p, 'Bookmarks'));
      const hasHistory = fs.existsSync(path.join(p, 'History'));
      if (!hasBookmarks && !hasHistory) continue;
      const name = cache[dir] && typeof cache[dir].name === 'string' ? cache[dir].name.slice(0, 80) : dir;
      profiles.push({ dir, name, hasBookmarks, hasHistory });
    }
    if (profiles.length) found.push({ id: b.id, name: b.name, profiles });
  }
  return found;
}

function webUrl(u) {
  if (typeof u !== 'string' || u.length > 4096) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch (_) { return null; }
}

/** The web addresses in a Chromium `Bookmarks` file, bookmarks bar first, in the browser's order. */
function parseBookmarks(json) {
  const out = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || out.length >= MAX_BOOKMARKS) return;
    if (node.type === 'url') {
      const url = webUrl(node.url);
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push({ title: String(node.name || url).slice(0, MAX_TITLE), url });
      }
      return;
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  const roots = json && json.roots;
  if (roots) ['bookmark_bar', 'other', 'synced'].forEach((k) => walk(roots[k]));
  return out;
}

/** The most recent web pages of a Chromium `History` database (read from a copy). */
function readHistory(historyFile, { sqlite = require('node:sqlite'), tmp = os.tmpdir() } = {}) {
  const copy = path.join(fs.mkdtempSync(path.join(tmp, 'shmmoth-import-')), 'History');
  try {
    fs.copyFileSync(historyFile, copy);
    const db = new sqlite.DatabaseSync(copy, { readOnly: true });
    try {
      const rows = db.prepare('SELECT url, title, visit_count, last_visit_time / 1000 AS visit_ms FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?').all(MAX_HISTORY * 2);
      const out = [];
      for (const r of rows) {
        const url = webUrl(r.url);
        if (!url) continue;
        // microseconds since 1601 do not fit a JavaScript number; the query hands over milliseconds
        const t = Number(r.visit_ms) - CHROME_EPOCH_OFFSET_MS;
        out.push({
          url,
          title: String(r.title || url).slice(0, MAX_TITLE),
          visitCount: Math.max(1, Number(r.visit_count) || 1),
          visitTime: Number.isFinite(t) && t > 0 ? Math.round(t) : Date.now()
        });
        if (out.length >= MAX_HISTORY) break;
      }
      return out;
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(path.dirname(copy), { recursive: true, force: true });
  }
}

/**
 * Imports from one detected profile into `storage`. Returns { bookmarks, history } counts of what was added,
 * or throws with a message the user can act on.
 */
function runImport(storage, { browserId, profileDir, bookmarks = true, history = true }, opts = {}) {
  const browser = detect(opts).find((b) => b.id === browserId);
  const profile = browser && browser.profiles.find((p) => p.dir === profileDir);
  if (!profile) throw new Error('That browser profile was not found on this computer.');
  const dir = path.join(userDataDir(BROWSERS.find((b) => b.id === browserId), opts), profile.dir);
  const result = { bookmarks: 0, history: 0, folder: null };

  if (bookmarks && profile.hasBookmarks) {
    const list = parseBookmarks(readJson(path.join(dir, 'Bookmarks')));
    result.folder = `Imported from ${browser.name}`;
    result.bookmarks = storage.importBookmarks(list, result.folder);
  }
  if (history && profile.hasHistory) {
    let rows;
    try {
      rows = readHistory(path.join(dir, 'History'), opts);
    } catch (err) {
      if (/EBUSY|EPERM|locked/i.test(String(err && (err.code || err.message)))) {
        throw new Error(`${browser.name} is using its history right now. Close ${browser.name} and try again.`);
      }
      throw new Error('The history could not be read.');
    }
    result.history = storage.importHistory(rows);
  }
  return result;
}

module.exports = { detect, parseBookmarks, readHistory, runImport, userDataDir, BROWSERS, CHROME_EPOCH_OFFSET_MS };
