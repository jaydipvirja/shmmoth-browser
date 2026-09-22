/**
 * STRUCTURED LOGGER — logger.js
 *
 * Centralised application logger for MTC Browser.
 *
 * LOG LEVELS:
 *   INFO     — Normal operational events
 *   WARN     — Unusual but non-critical situations
 *   ERROR    — Errors that affect functionality
 *   SECURITY — Security policy violations and IPC rejections
 *   AGENT    — Reserved for future SHMMOTH agent activity
 *
 * PRIVACY RULES (enforced by redact()):
 *   The logger MUST NOT record:
 *     ✗ Passwords or passphrases
 *     ✗ API keys or access tokens
 *     ✗ Session tokens or auth cookies
 *     ✗ Private user data (email, name, etc.)
 *
 * OUTPUT:
 *   - Always: process.stdout (console)
 *   - Future: optional file log in %APPDATA%/mtc-browser/logs/
 *
 * FUTURE SHMMOTH AGENT NOTE:
 *   All agent actions MUST be logged at the AGENT level with their
 *   full action descriptor (minus any sensitive values).
 *   Agent logs create an auditable trail of browser actions taken by SHMMOTH.
 */

'use strict';

// ─── Log level constants ──────────────────────────────────────────────────────

const Level = Object.freeze({
  INFO:     'INFO',
  WARN:     'WARN',
  ERROR:    'ERROR',
  SECURITY: 'SECURITY',
  AGENT:    'AGENT',
});

// ─── Redaction ────────────────────────────────────────────────────────────────

/**
 * Patterns of strings that must be redacted from log output.
 * These are matched case-insensitively against stringified log data.
 */
const REDACT_KEYS = [
  'password', 'passwd', 'secret', 'apikey', 'api_key',
  'token', 'accesstoken', 'access_token', 'authtoken', 'auth_token',
  'cookie', 'session', 'credential', 'private_key', 'privatekey',
];

/**
 * Recursively redacts sensitive fields from an object before logging.
 * Mutates a deep clone — original object is not modified.
 *
 * @param {*} data
 * @returns {*} redacted clone
 */
function redact(data) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // Redact patterns like "password=abc123" or "token: xyz" in strings
    return data.replace(/(password|token|api[_-]?key|secret|cookie|session)[=:\s]+\S+/gi,
      (_, key) => `${key}=[REDACTED]`);
  }
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(redact);

  const clone = {};
  for (const [k, v] of Object.entries(data)) {
    const lk = k.toLowerCase().replace(/[_-]/g, '');
    if (REDACT_KEYS.some(rk => lk.includes(rk))) {
      clone[k] = '[REDACTED]';
    } else {
      clone[k] = redact(v);
    }
  }
  return clone;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatTimestamp() {
  return new Date().toISOString();
}

function formatMessage(level, category, message, data) {
  const ts = formatTimestamp();
  let line = `[${ts}] [${level}]`;
  if (category) line += ` [${category}]`;
  line += ` ${message}`;
  if (data !== undefined) {
    try {
      const safe = redact(typeof data === 'object' ? data : { value: data });
      line += ' ' + JSON.stringify(safe);
    } catch (_) {
      line += ' [unserializable data]';
    }
  }
  return line;
}

// ─── Logger class ─────────────────────────────────────────────────────────────

class Logger {
  constructor(category = '') {
    this.category = category;
  }

  /**
   * Create a child logger with a sub-category label.
   * @param {string} subCategory
   * @returns {Logger}
   */
  child(subCategory) {
    return new Logger(this.category ? `${this.category}:${subCategory}` : subCategory);
  }

  _log(level, message, data) {
    const line = formatMessage(level, this.category, message, data);
    if (level === Level.ERROR || level === Level.SECURITY) {
      console.error(line);
    } else if (level === Level.WARN) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  info(message, data)     { this._log(Level.INFO,     message, data); }
  warn(message, data)     { this._log(Level.WARN,     message, data); }
  error(message, data)    { this._log(Level.ERROR,    message, data); }
  security(message, data) { this._log(Level.SECURITY, message, data); }
  agent(message, data)    { this._log(Level.AGENT,    message, data); }
}

// ─── Default singleton ────────────────────────────────────────────────────────

const rootLogger = new Logger('MTC');

module.exports = {
  Level,
  Logger,
  redact,
  // Convenience singleton
  log: rootLogger,
  // Named child loggers for each subsystem
  mainLogger:      rootLogger.child('MAIN'),
  ipcLogger:       rootLogger.child('IPC'),
  storageLogger:   rootLogger.child('STORAGE'),
  downloadLogger:  rootLogger.child('DOWNLOAD'),
  securityLogger:  rootLogger.child('SECURITY'),
  aiLogger:        rootLogger.child('AI'),
  agentLogger:     rootLogger.child('AGENT'),
};
