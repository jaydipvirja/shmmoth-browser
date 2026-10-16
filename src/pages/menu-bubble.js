/**
 * The main menu (⋮ in the toolbar). Each entry names an action (data-action); the main process runs it
 * (browser/bubbles.js runMenuAction): theme and zoom there, with the menu staying open to show the new value; all
 * other entries in the browser window the menu belongs to, which closes the menu.
 * Keyboard: ↑ / ↓ / Home / End move, Enter or Space choose, Escape closes.
 */
(function () {
  'use strict';
  const api = window.mtcAPI;
  const zoomValue = document.getElementById('zoom-value');
  const updateLabel = document.getElementById('update-label');
  const updateItem = document.getElementById('item-update');

  function show(state) {
    if (!state || typeof state !== 'object') return;
    for (const b of document.querySelectorAll('.segmented button')) {
      b.setAttribute('aria-pressed', String(b.dataset.action === 'theme-' + state.theme));
    }
    if (typeof state.zoom === 'number') zoomValue.textContent = state.zoom + '%';
    const u = state.update || {};
    if (u.status === 'downloaded') {
      updateLabel.textContent = 'Restart to update' + (u.availableVersion ? ' (' + u.availableVersion + ')' : '');
      updateItem.classList.add('attention');
    } else if (u.status === 'available' || u.status === 'downloading') {
      updateLabel.textContent = 'Downloading an update…';
    } else {
      updateLabel.textContent = 'Check for updates';
      updateItem.classList.remove('attention');
    }
  }

  async function choose(action) {
    try { show(await api.menuAction(action)); } catch (_) { /* the menu was closed meanwhile */ }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el) choose(el.dataset.action);
  });

  const items = () => Array.from(document.querySelectorAll('.item, .segmented button, .zoom-btn, #zoom-value'));
  document.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = list[(i + 1) % list.length];
    else if (e.key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else if (e.key === 'Escape') { api.closeMenuBubble(); e.preventDefault(); return; }
    if (next) { next.focus(); e.preventDefault(); }
  });

  if (api && api.getMenuState) api.getMenuState().then(show).catch(() => {});
})();
