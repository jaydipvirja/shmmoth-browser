/**
 * SHMMOTH icon set: one consistent family of 24 px stroke icons in place of emoji (docs/redesign-plan.md, Phase 1).
 *
 * In markup: <span class="sh-icon" data-icon="shield" aria-hidden="true"></span> — this script draws the icon into
 * every [data-icon] element when the page loads. In code: ShIcons.create('shield') returns the <svg> element.
 * Icons take the text colour (currentColor) and 1em size unless the element sets its own.
 * Built with DOM calls (no innerHTML), so it works under the pages' Content Security Policy.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  // name → list of [element, attributes]
  const ICONS = {
    search:      [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm20 20-4-4' }]],
    shield:      [['path', { d: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
    key:         [['circle', { cx: 8, cy: 15, r: 4 }], ['path', { d: 'M10.8 12.2 20 3M16 7l3 3M14 9l2 2' }]],
    form:        [['rect', { x: 4, y: 3, width: 16, height: 18, rx: 2 }], ['path', { d: 'M8 8h8M8 12h8M8 16h5' }]],
    globe:       [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' }]],
    download:    [['path', { d: 'M12 4v11M7 10l5 5 5-5M5 20h14' }]],
    puzzle:      [['path', { d: 'M9 4h4v3a2 2 0 1 0 4 0V4h3v6h-3a2 2 0 1 0 0 4h3v6H9v-3a2 2 0 1 0-4 0v3H4V10h5z' }]],
    bolt:        [['path', { d: 'M13 3 5 13h6l-1 8 8-10h-6z' }]],
    palette:     [['path', { d: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.6-1-2.5s.7-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z' }], ['circle', { cx: 7.5, cy: 11, r: 1 }], ['circle', { cx: 10, cy: 7, r: 1 }], ['circle', { cx: 15, cy: 7.5, r: 1 }]],
    info:        [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v6M12 7.5v.01' }]],
    star:        [['path', { d: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z' }]],
    history:     [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
    settings:    [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }]],
    'arrow-left':  [['path', { d: 'M19 12H5M12 19l-7-7 7-7' }]],
    'arrow-right': [['path', { d: 'M5 12h14M12 5l7 7-7 7' }]],
    reload:      [['path', { d: 'M21 12a9 9 0 1 1-3-6.7L21 8' }], ['path', { d: 'M21 3v5h-5' }]],
    close:       [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
    plus:        [['path', { d: 'M12 5v14M5 12h14' }]],
    lock:        [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]],
    folder:      [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]],
    trash:       [['path', { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' }]],
    menu:        [['circle', { cx: 12, cy: 5, r: 1.2 }], ['circle', { cx: 12, cy: 12, r: 1.2 }], ['circle', { cx: 12, cy: 19, r: 1.2 }]],
    sun:         [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }]],
    moon:        [['path', { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' }]],
    home:        [['path', { d: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' }]],
    stop:        [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
    incognito:   [['path', { d: 'M3 11l2-6h14l2 6M10 15h4' }], ['circle', { cx: 6.5, cy: 15, r: 3.5 }], ['circle', { cx: 17.5, cy: 15, r: 3.5 }]],
    notes:       [['rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }], ['path', { d: 'M8 9h8M8 13h8M8 17h5' }]],
    code:        [['path', { d: 'm8 6-6 6 6 6M16 6l6 6-6 6' }]],
    login:       [['path', { d: 'M15 3h4v18h-4M10 17l5-5-5-5M15 12H3' }]],
    file:        [['path', { d: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z' }], ['path', { d: 'M14 3v5h5' }]],
    'volume':    [['path', { d: 'M4 9h4l5-4v14l-5-4H4z' }], ['path', { d: 'M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12' }]],
    'volume-off':[['path', { d: 'M4 9h4l5-4v14l-5-4H4z' }], ['path', { d: 'm17 9 5 6M22 9l-5 6' }]],
    sleep:       [['path', { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' }], ['path', { d: 'M15 4h4l-4 4h4' }]],
    warning:     [['path', { d: 'M12 3 2 20h20z' }], ['path', { d: 'M12 10v4M12 17v.01' }]]
  };

  function create(name, size) {
    const parts = ICONS[name];
    if (!parts) return null;
    const svg = document.createElementNS(NS, 'svg');
    const px = String(size || '1em');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: px, height: px, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'sh-icon-svg' })) {
      svg.setAttribute(k, String(v));
    }
    for (const [tag, attrs] of parts) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      svg.appendChild(el);
    }
    return svg;
  }

  function drawAll(root) {
    for (const el of (root || document).querySelectorAll('[data-icon]')) {
      const svg = create(el.getAttribute('data-icon'));
      if (svg) el.replaceChildren(svg);
    }
  }

  window.ShIcons = Object.freeze({ create, drawAll, names: Object.freeze(Object.keys(ICONS)) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => drawAll(), { once: true });
  else drawAll();
})();
