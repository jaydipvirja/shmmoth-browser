/**
 * ATOMIC JSON PERSISTENCE — atomicJson.js
 *
 * Crash-safe read/write of the browser's small JSON data files
 * (settings/bookmarks/history, password vault, autofill profiles, …).
 *
 * Why: the previous code wrote with a bare fs.writeFileSync() (truncate, then
 * write). A crash, power loss or full disk in the middle left a half-written
 * file; the next start failed to parse it, silently fell back to EMPTY data, and
 * the first save then overwrote the damaged file — permanently losing every
 * bookmark, history entry and saved password.
 *
 * Guarantees:
 *   write: data goes to a temp file, is fsync'ed, the previous good copy is kept
 *          as <file>.bak, and only then is the temp file renamed over <file>
 *          (atomic) — readers see either the old or the new file, never half.
 *   read:  a file that exists but cannot be parsed/validated is MOVED ASIDE to
 *          <file>.corrupt-<timestamp> (never deleted/overwritten), and the
 *          last good <file>.bak is restored if there is one. A file that cannot
 *          even be read (locked, permissions) is reported as "unreadable" so the
 *          caller can avoid writing over it.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const KEEP_CORRUPT_COPIES = 3;
const lastBackupAt = new Map(); // filePath -> epoch ms

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) { /* best effort */ }
}

/** Writes + fsyncs so the bytes are on disk before the rename publishes them. */
function writeFileDurable(file, contents) {
  const fd = fs.openSync(file, 'w', 0o600);
  try {
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Windows can briefly refuse to replace a file that antivirus/indexers have open. */
function renameWithRetry(from, to) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      lastErr = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(20 * (attempt + 1));
    }
  }
  throw lastErr;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function parseFile(file, validate) {
  const data = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
  if (validate && !validate(data)) {
    const err = new Error('JSON does not have the expected shape');
    err.code = 'E_INVALID_SHAPE';
    throw err;
  }
  return data;
}

/** True when the failure is "the content is bad" rather than "the file can't be read". */
function isContentError(err) {
  return err instanceof SyntaxError || (err && err.code === 'E_INVALID_SHAPE');
}

/**
 * Keeps <file>.bak equal to the last known-good content. Only copies a primary
 * that itself parses, so a damaged file can never replace a good backup.
 */
function maybeBackup(filePath, backupIntervalMs, validate) {
  const bakPath = filePath + '.bak';
  const now = Date.now();
  const due = backupIntervalMs <= 0
    || !fs.existsSync(bakPath)
    || now - (lastBackupAt.get(filePath) || 0) >= backupIntervalMs;
  if (!due || !fs.existsSync(filePath)) return;

  try {
    parseFile(filePath, validate);          // only back up good data
  } catch (_) {
    return;
  }
  const tmp = `${bakPath}.tmp-${process.pid}`;
  try {
    fs.copyFileSync(filePath, tmp);
    renameWithRetry(tmp, bakPath);
    lastBackupAt.set(filePath, now);
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (__) { /* ignore */ }
  }
}

/**
 * Atomically replaces `filePath` with the JSON of `data`.
 * Throws on failure (callers decide whether that is fatal); the previous file is untouched in that case.
 *
 * @param {string} filePath
 * @param {*} data
 * @param {object} [opts]
 * @param {number} [opts.backupIntervalMs=0] refresh <file>.bak at most this often (0 = every write)
 * @param {(data:*)=>boolean} [opts.validate] shape check used when deciding if the old file is a good backup source
 * @param {number} [opts.space=2]
 */
function writeJsonAtomic(filePath, data, { backupIntervalMs = 0, validate, space = 2 } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const json = JSON.stringify(data, null, space);
  const tmp = `${filePath}.tmp-${process.pid}`;
  try {
    writeFileDurable(tmp, json);
    maybeBackup(filePath, backupIntervalMs, validate);
    renameWithRetry(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw err;
  }
}

function pruneCorruptCopies(filePath) {
  try {
    const dir = path.dirname(filePath);
    const prefix = path.basename(filePath) + '.corrupt-';
    const copies = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - KEEP_CORRUPT_COPIES))) {
      try { fs.unlinkSync(path.join(dir, old)); } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}

/**
 * Reads `filePath`, recovering from damage without ever destroying evidence.
 *
 * @returns {{
 *   data: *|null,
 *   source: 'primary'|'backup'|'none'|'unreadable',
 *   corruptPath?: string,   // where the damaged file was preserved
 *   error?: Error
 * }}
 *   'none'       — no file (fresh install) or damaged with no usable backup: start from defaults.
 *   'unreadable' — the file exists but the OS would not let us read it: do NOT write over it.
 */
function readJsonRecovering(filePath, { validate } = {}) {
  if (!fs.existsSync(filePath)) {
    return { data: null, source: 'none' };
  }

  let firstError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return { data: parseFile(filePath, validate), source: 'primary' };
    } catch (err) {
      firstError = err;
      if (isContentError(err)) break;       // damaged content: retrying will not help
      sleepSync(30 * (attempt + 1));        // transient lock (antivirus, indexer): retry
    }
  }

  if (!isContentError(firstError)) {
    return { data: null, source: 'unreadable', error: firstError };
  }

  // Damaged content: preserve it, then try the last good backup.
  const corruptPath = `${filePath}.corrupt-${Date.now()}`;
  try {
    renameWithRetry(filePath, corruptPath);
  } catch (_) {
    try { fs.copyFileSync(filePath, corruptPath); } catch (__) { /* keep going */ }
  }
  pruneCorruptCopies(filePath);

  const bakPath = filePath + '.bak';
  if (fs.existsSync(bakPath)) {
    try {
      const data = parseFile(bakPath, validate);
      try { fs.copyFileSync(bakPath, filePath); } catch (_) { /* next save recreates it */ }
      return { data, source: 'backup', corruptPath, error: firstError };
    } catch (_) { /* backup unusable too */ }
  }
  return { data: null, source: 'none', corruptPath, error: firstError };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

module.exports = { writeJsonAtomic, readJsonRecovering, isPlainObject };
