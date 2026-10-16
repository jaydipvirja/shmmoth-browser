/**
 * The Theme setting and what Electron gets from it.
 *
 * "system" follows Windows' own dark / light setting, "light" and "dark" fix one. The frame (renderer/app.js) and the
 * internal pages (pages/theme.js) put the matching class on the page, which switches the design tokens
 * (pages/design-tokens.css), live. The main process also sets nativeTheme.themeSource to it, for what Chromium draws
 * itself (scroll bars, form controls, native menus).
 * Older values: "midnight" (Midnight OLED, until 1.2.0) is shown as dark.
 */

'use strict';

const THEMES = ['system', 'light', 'dark'];
const DEFAULT_THEME = 'system';

/** A Theme setting value Electron accepts; anything unknown becomes "dark" (what every version before 1.2.1 showed). */
function normalizeTheme(value) {
  if (THEMES.includes(value)) return value;
  return 'dark';
}

module.exports = { THEMES, DEFAULT_THEME, normalizeTheme };
