/**
 * PERMISSION POLICY — permissionPolicy.js
 *
 * Permissions that web pages get WITHOUT a prompt, the way Chrome grants them: they are harmless, or Chromium already
 * requires a user gesture for them.
 *
 *  - fullscreen / pointerLock    video players, games
 *  - clipboard-sanitized-write   navigator.clipboard.writeText() / write() of plain text and images, and only while the
 *                                user is interacting with the page. Every "Copy link" / "Copy video URL" / "Copy code"
 *                                button depends on it. Because the permission *check* handler answers "no" to anything
 *                                it does not know, leaving it out made all of those buttons fail with
 *                                "NotAllowedError: Write permission denied".
 *
 * Deliberately NOT here: clipboard-read (a page reading what you copied — passwords, addresses), media, geolocation,
 * notifications, … Those stay behind the per-site prompt.
 */

'use strict';

const ALWAYS_ALLOWED = Object.freeze(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);

/** @returns {boolean} true when pages may use the permission without asking */
function isAlwaysAllowedPermission(permission) {
  return typeof permission === 'string' && ALWAYS_ALLOWED.includes(permission);
}

module.exports = { ALWAYS_ALLOWED, isAlwaysAllowedPermission };
