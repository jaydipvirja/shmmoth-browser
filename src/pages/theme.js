/**
 * Puts the page in the theme the user chose: `theme-light` or `theme-dark` on <html> and <body>, which switch the
 * design tokens (design-tokens.css) and the page styles that still select on those classes.
 *
 * Theme setting: "light", "dark", or "system" = follow Windows' own setting (the `prefers-color-scheme` query, which
 * reports the system's setting). Changes apply live: a new setting arrives as `theme:changed`, a Windows switch as a
 * change of the query.
 */
(function () {
  'use strict';
  const api = window.mtcAPI || null;
  const systemLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  let setting = 'system';

  function apply() {
    const light = setting === 'light' || (setting === 'system' && Boolean(systemLight && systemLight.matches));
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      el.classList.toggle('theme-light', light);
      el.classList.toggle('theme-dark', !light);
    }
  }

  function use(theme) {
    setting = ['system', 'light', 'dark'].includes(theme) ? theme : 'dark';   // "midnight" (until 1.2.0) shows dark
    apply();
  }

  apply();
  if (!document.body) document.addEventListener('DOMContentLoaded', apply, { once: true });
  if (systemLight) systemLight.addEventListener('change', apply);
  if (api && typeof api.getSettings === 'function') {
    Promise.resolve(api.getSettings()).then((s) => use(s && s.theme)).catch(() => {});
  }
  if (api && typeof api.onThemeChanged === 'function') api.onThemeChanged(use);
})();
