// Runs in EVERY frame of every web page (registered with session.registerPreloadScript, type "frame").
// It tells the browser that the user really clicked / pressed a key, so that window.open() calls that come out of
// nowhere (timers, page load) can be told apart from the ones a person asked for, and it keeps Shift + right-click away
// from the page. Only events with isTrusted === true count — a page cannot make those up, and this script lives in its
// own isolated world.
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

  // Shift + right-click always opens the browser's own menu (as in Firefox), also on pages that replace it with their
  // own (YouTube's player, web apps): the page never sees that right-click, so it cannot cancel it. A plain right-click
  // stays the page's. Registered before any script of the page exists, so no page listener runs before this one.
  window.addEventListener('contextmenu', (e) => {
    if (e && e.isTrusted === true && e.shiftKey === true) e.stopImmediatePropagation();
  }, true);
  ipcRenderer.send('shmmoth:gesture-ready');
} catch (_) { /* a page that cannot be scripted simply reports nothing */ }
