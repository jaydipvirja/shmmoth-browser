// Runs in EVERY frame of every web page (registered with session.registerPreloadScript, type "frame").
// Its only job: tell the browser that the user really clicked / pressed a key, so that window.open() calls that come
// out of nowhere (timers, page load) can be told apart from the ones a person asked for. Only events with
// isTrusted === true count — a page cannot make those up, and this script lives in its own isolated world.
'use strict';
const { ipcRenderer } = require('electron');

try {
  let last = 0;
  const mark = (e) => {
    if (!e || e.isTrusted !== true) return;
    const now = Date.now();
    if (now - last < 150) return;
    last = now;
    ipcRenderer.send('shmmoth:gesture');
  };
  for (const type of ['pointerdown', 'mousedown', 'keydown', 'touchstart']) window.addEventListener(type, mark, true);

  // YouTube frequently suppresses the page contextmenu event. Capture only a trusted right-click
  // inside an actual video rectangle and hand it to the browser's native media-menu path.
  window.addEventListener('contextmenu', (e) => {
    if (!e || e.isTrusted !== true) return;
    const host = String(location.hostname || '').toLowerCase();
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return;
    const x = Math.max(0, Math.round(Number(e.clientX) || 0));
    const y = Math.max(0, Math.round(Number(e.clientY) || 0));
    let inVideo = false;
    try {
      for (const video of document.querySelectorAll('video')) {
        const r = video.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { inVideo = true; break; }
      }
    } catch (_) {}
    if (!inVideo) return;
    e.preventDefault();
    ipcRenderer.send('shmmoth:youtube-context-menu', { x, y });
  }, true);
  ipcRenderer.send('shmmoth:gesture-ready');
} catch (_) { /* a page that cannot be scripted simply reports nothing */ }
