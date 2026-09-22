/**
 * IPC SECURITY UTILITIES — ipcSecurity.js
 *
 * Centralised security guards for all ipcMain handlers.
 * Import and call these at the top of every privileged IPC handler
 * to ensure only trusted internal browser frames can invoke them.
 *
 * SECURITY MODEL:
 *   - Only frames whose URL begins with 'mtc://' or 'file://' are trusted.
 *   - The browser chrome (BrowserWindow) loads via file:// → trusted.
 *   - Internal pages (mtc://newtab, mtc://settings, etc.) → trusted.
 *   - External web pages (https://, http://) → NEVER trusted.
 *   - If origin cannot be determined → rejected.
 *
 * FUTURE SHMMOTH AGENT NOTE:
 *   When the SHMMOTH agent needs to invoke privileged browser actions, it
 *   must do so through a dedicated, separately-validated agent IPC channel
 *   — NOT by spoofing an internal origin. Agent requests must carry their
 *   own authentication token validated in main process memory.
 */

'use strict';

const { URL } = require('url');

// ─── Trusted origin prefixes ─────────────────────────────────────────────────

const TRUSTED_PREFIXES = [
  'mtc://',
  'file://',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the URL of the frame that sent an IPC event.
 * Falls back to checking webContents.getURL() if senderFrame is unavailable.
 * @param {Electron.IpcMainInvokeEvent} event
 * @returns {string|null}
 */
function getSenderUrl(event) {
  try {
    if (event.senderFrame && typeof event.senderFrame.url === 'string') {
      return event.senderFrame.url;
    }
    // Fallback for older Electron or edge cases
    if (event.sender && typeof event.sender.getURL === 'function') {
      return event.sender.getURL();
    }
  } catch (_) {}
  return null;
}

/**
 * Returns true if the given URL is a trusted internal origin.
 * @param {string|null} senderUrl
 * @returns {boolean}
 */
function isTrustedOrigin(senderUrl) {
  if (!senderUrl) return false;
  return TRUSTED_PREFIXES.some(prefix => senderUrl.startsWith(prefix));
}

// ─── Exported guards ─────────────────────────────────────────────────────────

/**
 * Validates that the IPC event came from a trusted internal frame.
 * Throws a structured error if the sender is untrusted.
 *
 * Usage:
 *   ipcMain.handle('some:channel', (event, ...args) => {
 *     validateTrustedSender(event);
 *     // ... handler logic
 *   });
 *
 * @param {Electron.IpcMainInvokeEvent} event
 * @throws {Error} if sender is not trusted
 */
function validateTrustedSender(event) {
  const senderUrl = getSenderUrl(event);
  if (!isTrustedOrigin(senderUrl)) {
    const err = new Error(`[IPC SECURITY] Rejected call from untrusted origin: ${senderUrl || 'unknown'}`);
    err.code = 'UNTRUSTED_ORIGIN';
    throw err;
  }
}

/**
 * Validates that a tabId argument is a non-empty string matching the
 * expected format ('tab_<number>') and exists in the current tab registry.
 *
 * @param {*} tabId — value received from renderer
 * @param {Object} tabs — current this.tabs registry from MtcBrowserApp
 * @returns {string} validated tabId
 * @throws {Error} if invalid
 */
function validateTabId(tabId, tabs) {
  if (typeof tabId !== 'string' || !/^tab_\d+$/.test(tabId)) {
    const err = new Error(`[IPC SECURITY] Invalid tabId format: ${JSON.stringify(tabId)}`);
    err.code = 'INVALID_TAB_ID';
    throw err;
  }
  if (tabs && !tabs[tabId]) {
    const err = new Error(`[IPC SECURITY] Tab does not exist: ${tabId}`);
    err.code = 'TAB_NOT_FOUND';
    throw err;
  }
  return tabId;
}

/**
 * Validates that a URL argument is a non-empty string with acceptable length.
 * Does NOT enforce protocol here — that is the responsibility of urlPolicy.js.
 *
 * @param {*} url — value received from renderer
 * @returns {string} validated url string
 * @throws {Error} if invalid
 */
function validateUrl(url) {
  if (typeof url !== 'string') {
    const err = new Error(`[IPC SECURITY] URL must be a string, got: ${typeof url}`);
    err.code = 'INVALID_URL_TYPE';
    throw err;
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    const err = new Error('[IPC SECURITY] URL must not be empty');
    err.code = 'EMPTY_URL';
    throw err;
  }
  if (trimmed.length > 8192) {
    const err = new Error('[IPC SECURITY] URL exceeds maximum allowed length');
    err.code = 'URL_TOO_LONG';
    throw err;
  }
  return trimmed;
}

/**
 * Sanitizes a string argument: trims whitespace and enforces a maximum length.
 *
 * @param {*} str — value received from renderer
 * @param {number} maxLen — maximum allowed character length
 * @param {string} fieldName — name of the field (for error messages)
 * @returns {string} sanitized string
 * @throws {Error} if not a string
 */
function sanitizeString(str, maxLen = 512, fieldName = 'field') {
  if (typeof str !== 'string') {
    const err = new Error(`[IPC SECURITY] ${fieldName} must be a string`);
    err.code = 'INVALID_STRING';
    throw err;
  }
  return str.trim().slice(0, maxLen);
}

/**
 * Wraps an IPC handler with trusted-sender validation and structured error handling.
 * Returns a { success, data } or { success: false, error, code } envelope.
 *
 * Usage:
 *   ipcMain.handle('some:channel', secureHandler(async (event, ...args) => {
 *     // handler body — always called with trusted sender
 *     return someResult;
 *   }));
 *
 * @param {Function} handler — async (event, ...args) => result
 * @returns {Function} wrapped handler
 */
function secureHandler(handler) {
  return async (event, ...args) => {
    try {
      validateTrustedSender(event);
      const result = await handler(event, ...args);
      return { success: true, data: result };
    } catch (err) {
      // Log security violations prominently
      if (err.code && err.code.includes('ORIGIN')) {
        console.error(`[SECURITY VIOLATION] ${err.message}`);
      }
      return { success: false, error: err.message, code: err.code || 'HANDLER_ERROR' };
    }
  };
}

/**
 * Same as secureHandler but returns the raw result (not wrapped in {success, data}).
 * Use for handlers that already have their own return shape and where the caller
 * checks the result directly (e.g., getSettings, getBookmarks).
 *
 * On security failure, throws so Electron surfaces it as a rejected promise.
 *
 * @param {Function} handler
 * @returns {Function}
 */
function secureHandlerRaw(handler) {
  return async (event, ...args) => {
    validateTrustedSender(event);
    return handler(event, ...args);
  };
}

module.exports = {
  validateTrustedSender,
  validateTabId,
  validateUrl,
  sanitizeString,
  secureHandler,
  secureHandlerRaw,
  isTrustedOrigin,
  getSenderUrl,
};
