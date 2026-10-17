/**
 * Windows 11 "Mica": the desktop colour shows faintly through the tab strip (redesign Phase 5).
 *
 * Electron draws it with BrowserWindow.setBackgroundMaterial('mica'), which Windows supports from Windows 11 22H2
 * (build 22621). The window background must then be transparent, and the frame page leaves its tab strip transparent
 * (body.mica in renderer/style.css); the toolbar and the pages stay solid. Off by default (Settings → Appearance),
 * and everywhere else (Windows 10, Linux, macOS) the setting does nothing.
 */
'use strict';

const os = require('os');

const MIN_BUILD = 22621;

/** true on Windows 11 22H2 or newer */
function supportsMica(platform = process.platform, release = os.release()) {
  if (platform !== 'win32') return false;
  const build = Number(String(release).split('.')[2]);
  return Number.isFinite(build) && build >= MIN_BUILD;
}

/**
 * Switches Mica on or off for one window. `solidColor` is the background the window has without it.
 * Returns whether Mica is on afterwards.
 */
function applyMica(win, enabled, solidColor, supported = supportsMica()) {
  if (!win || win.isDestroyed() || !supported || typeof win.setBackgroundMaterial !== 'function') return false;
  const on = Boolean(enabled);
  try {
    win.setBackgroundColor(on ? '#00000000' : solidColor);
    win.setBackgroundMaterial(on ? 'mica' : 'none');
  } catch (_) {
    return false;
  }
  return on;
}

module.exports = { supportsMica, applyMica, MIN_BUILD };
