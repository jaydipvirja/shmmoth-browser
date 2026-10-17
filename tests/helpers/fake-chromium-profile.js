/**
 * A small Chrome / Edge / Brave user-data folder for the import tests: `Local State`, and one profile with a
 * `Bookmarks` file and a `History` SQLite database laid out like Chromium's.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CHROME_EPOCH_OFFSET_MS = 11644473600000;
const toChromeTime = (ms) => (ms + CHROME_EPOCH_OFFSET_MS) * 1000;

/**
 * Writes the folder under `root` (the user-data folder itself, e.g. …/google-chrome) and returns what it contains.
 * `profileDir` "Default" by default.
 */
function writeFakeProfile(root, { profileDir = 'Default', profileName = 'Person 1', now = Date.now() } = {}) {
  const dir = path.join(root, profileDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { [profileDir]: { name: profileName } } } }));

  const bookmarks = {
    version: 1,
    roots: {
      bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
        { type: 'url', name: 'Example', url: 'https://example.com/' },
        { type: 'folder', name: 'Work', children: [{ type: 'url', name: 'Docs', url: 'https://docs.example.org/start' }] },
        { type: 'url', name: 'Script', url: 'javascript:alert(1)' }
      ] },
      other: { type: 'folder', name: 'Other', children: [
        { type: 'url', name: 'Local file', url: 'file:///C:/secret.txt' },
        { type: 'url', name: 'Example again', url: 'https://example.com/' },
        { type: 'url', name: 'News', url: 'http://news.example.net/' }
      ] },
      synced: { type: 'folder', name: 'Mobile', children: [] }
    }
  };
  fs.writeFileSync(path.join(dir, 'Bookmarks'), JSON.stringify(bookmarks));

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'History'));
  db.exec('CREATE TABLE urls(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)');
  const insert = db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)');
  const history = [
    ['https://older.example.com/page', 'Older page', 2, now - 3 * 86400000, 0],
    ['https://recent.example.com/', 'Recent page', 7, now - 3600000, 0],
    ['chrome://settings/', 'Settings', 1, now - 1000, 0],
    ['https://hidden.example.com/', 'Hidden', 1, now - 2000, 1]
  ];
  for (const row of history) insert.run(row[0], row[1], row[2], toChromeTime(row[3]), row[4]);
  db.close();

  return {
    dir,
    expectedBookmarks: ['https://example.com/', 'https://docs.example.org/start', 'http://news.example.net/'],
    expectedHistory: ['https://recent.example.com/', 'https://older.example.com/page'],
    recentVisit: now - 3600000
  };
}

module.exports = { writeFakeProfile, toChromeTime };
