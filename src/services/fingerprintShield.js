/**
 * Fingerprinting protection (1.5.1) — the page side.
 *
 * Sites that cannot set cookies recognise a browser by what its computer looks like: how a canvas or a sound is drawn
 * (each graphics card and driver differs by a few bits), the graphics card's name, the number of processor cores, the
 * battery. Like Brave (and Safari's "advanced fingerprinting protection"), the page sees:
 *   - canvas and WebGL read-backs (toDataURL, toBlob, getImageData, readPixels) and audio read-backs (getChannelData,
 *     copyFromChannel, getFloatFrequencyData) with a tiny change no one can see or hear. It is the same every time on
 *     one site, and different on every other site and in every browser session — so the "fingerprint" cannot follow
 *     you from site to site;
 *   - the graphics card's maker only, not its model; 2, 4 or 8 processor cores; 4 or 8 GB of memory; a battery that is
 *     always full and charging.
 * The script runs in the page itself, before the page's own scripts (preload-privacy.js), in every frame, and patches
 * the about:blank frames and windows a page creates itself. The changed functions look like the browser's own: they
 * read as native code, have no `prototype` and cannot be called with `new` (1.5.2: in 1.5.1 they had a `prototype`, a
 * sure sign of tampering that YouTube's anti-adblock check reacts to). They are written as methods (`{ name() {} }`)
 * for that reason.
 *
 * Only `buildPageScript` runs in a page: it must not use anything outside its own text.
 */
'use strict';

/**
 * The script for one site: `seed` (32-bit, per site and browser session), `secret` (marks windows already done; random
 * per browser session, so a page cannot fake or predict it).
 */
function buildPageScript(seed, secret) {
  return `(${pageScript.toString()})(${Number(seed) >>> 0}, ${JSON.stringify(String(secret))});`;
}

/* eslint-disable no-var */
function pageScript(SEED, SECRET) {
  var MARK = Symbol.for('shmmoth-fp-' + SECRET);
  var native = new WeakMap();                         // wrapper -> the function it replaces (for toString)
  var touchedAudio = new WeakSet();
  // between 1 + 1e-7 (just above float32 precision, so every site sees a change) and 1 + 1e-4: ~a million steps
  var AUDIO_FACTOR = 1 + (1000 + (SEED % 999000)) * 1e-10;

  function rng(s) {
    s = (s >>> 0) || 0x9e3779b9;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // A few pixels change their lowest bit: where depends on the site's seed and the image size, so the same drawing
  // reads the same on one site (and two reads of one canvas agree), and differently on any other site.
  function noisePixels(data, w, h, salt) {
    var n = w * h;
    if (!n || !data || data.length < n * 4) return;
    var r = rng(SEED ^ Math.imul(w, 73856093) ^ Math.imul(h, 19349663) ^ salt);
    var changed = 0;
    for (var pass = 0; pass < 2 && changed < 24; pass++) {
      for (var t = 0; t < 2048 && changed < 24; t++) {
        var p = Math.floor(r() * n) * 4;
        var a = data[p + 3];
        if (pass === 0 ? a !== 255 : a === 0) continue;
        var c = Math.floor(r() * 3);
        data[p + c] = data[p + c] ^ 1;
        changed++;
      }
    }
  }

  function define(obj, name, wrapper, original) {
    var d = Object.getOwnPropertyDescriptor(obj, name);
    if (!d) return;
    try { Object.defineProperty(wrapper, 'name', { value: original.name, configurable: true }); } catch (e) { /* keep */ }
    try { Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true }); } catch (e) { /* keep */ }
    native.set(wrapper, original);
    if ('value' in d) d.value = wrapper; else d.get = wrapper;
    Object.defineProperty(obj, name, d);
  }
  function method(proto, name, make) {
    if (!proto) return;
    var d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== 'function') return;
    define(proto, name, make(d.value), d.value);
  }
  function getter(proto, name, make) {
    if (!proto) return;
    var d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.get !== 'function') return;
    define(proto, name, make(d.get), d.get);
  }

  function patch(w) {
    try {
      if (!w || w[MARK]) return;
      Object.defineProperty(w, MARK, { value: true });
    } catch (e) { return; }                            // another site's frame: not ours to touch

    try {
      // the changed functions read as native code
      method(w.Function.prototype, 'toString', function (orig) {
        return { toString() { return orig.call(native.get(this) || this); } }.toString;
      });

      var Canvas = w.HTMLCanvasElement && w.HTMLCanvasElement.prototype;
      var Ctx2d = w.CanvasRenderingContext2D && w.CanvasRenderingContext2D.prototype;
      var createElement = w.Document.prototype.createElement;
      var getContext = Canvas && Canvas.getContext;
      var drawImage = Ctx2d && Ctx2d.drawImage;
      var getImageData = Ctx2d && Ctx2d.getImageData;
      var putImageData = Ctx2d && Ctx2d.putImageData;

      // toDataURL / toBlob read a copy with the change, never the page's own canvas
      var noisyCopy = function (canvas) {
        var cw = canvas.width; var ch = canvas.height;
        if (!cw || !ch || cw * ch > 16777216) return null;
        var copy = createElement.call(canvas.ownerDocument || w.document, 'canvas');
        copy.width = cw; copy.height = ch;
        var ctx = getContext.call(copy, '2d');
        drawImage.call(ctx, canvas, 0, 0);
        var img = getImageData.call(ctx, 0, 0, cw, ch);   // throws for a tainted canvas: the original throws as well
        noisePixels(img.data, cw, ch, 1);
        putImageData.call(ctx, img, 0, 0);
        return copy;
      };
      method(Canvas, 'toDataURL', function (orig) {
        return { toDataURL() {
          var copy = null;
          try { copy = noisyCopy(this); } catch (e) { copy = null; }
          return orig.apply(copy || this, arguments);
        } }.toDataURL;
      });
      method(Canvas, 'toBlob', function (orig) {
        return { toBlob() {
          var copy = null;
          try { copy = noisyCopy(this); } catch (e) { copy = null; }
          return orig.apply(copy || this, arguments);
        } }.toBlob;
      });
      var readImage = function (orig) {
        return { getImageData() {
          var img = orig.apply(this, arguments);
          try { noisePixels(img.data, img.width, img.height, 2); } catch (e) { /* as read */ }
          return img;
        } }.getImageData;
      };
      method(Ctx2d, 'getImageData', readImage);
      if (w.OffscreenCanvasRenderingContext2D) method(w.OffscreenCanvasRenderingContext2D.prototype, 'getImageData', readImage);

      // WebGL: the maker of the graphics card, not its model; read-backs as for a canvas
      var glPatch = function (proto) {
        if (!proto) return;
        method(proto, 'getParameter', function (orig) {
          return { getParameter(p) {
            var v = orig.apply(this, arguments);
            if ((p === 0x9245 || p === 0x9246) && typeof v === 'string') {
              var m = /ANGLE \(([^,()]+)/.exec(orig.call(this, 0x9246) || '');
              var maker = m ? m[1].trim() : 'Generic';
              return p === 0x9245 ? 'Google Inc. (' + maker + ')' : 'ANGLE (' + maker + ', ' + maker + ' GPU)';
            }
            return v;
          } }.getParameter;
        });
        method(proto, 'readPixels', function (orig) {
          return { readPixels(x, y, rw, rh, format, type, pixels) {
            var out = orig.apply(this, arguments);
            try { if (pixels && pixels.BYTES_PER_ELEMENT === 1 && pixels.length >= rw * rh * 4) noisePixels(pixels, rw, rh, 3); } catch (e) { /* as read */ }
            return out;
          } }.readPixels;
        });
      };
      glPatch(w.WebGLRenderingContext && w.WebGLRenderingContext.prototype);
      glPatch(w.WebGL2RenderingContext && w.WebGL2RenderingContext.prototype);

      // audio: a level change far below hearing (about -80 dB), applied once per buffer
      var scale = function (arr) {
        if (!arr || touchedAudio.has(arr)) return;
        touchedAudio.add(arr);
        for (var i = 0; i < arr.length; i++) arr[i] = arr[i] * AUDIO_FACTOR;
      };
      var AB = w.AudioBuffer && w.AudioBuffer.prototype;
      method(AB, 'getChannelData', function (orig) {
        return { getChannelData() { var a = orig.apply(this, arguments); scale(a); return a; } }.getChannelData;
      });
      method(AB, 'copyFromChannel', function (orig) {
        return { copyFromChannel(dest) {
          var r = orig.apply(this, arguments);
          try { for (var i = 0; i < dest.length; i++) dest[i] = dest[i] * AUDIO_FACTOR; } catch (e) { /* as read */ }
          return r;
        } }.copyFromChannel;
      });
      var AN = w.AnalyserNode && w.AnalyserNode.prototype;
      method(AN, 'getFloatFrequencyData', function (orig) {
        return { getFloatFrequencyData(arr) {
          var r = orig.apply(this, arguments);
          try { for (var i = 0; i < arr.length; i++) arr[i] = arr[i] * AUDIO_FACTOR; } catch (e) { /* as read */ }
          return r;
        } }.getFloatFrequencyData;
      });

      // the computer: common values only
      var Nav = w.Navigator && w.Navigator.prototype;
      getter(Nav, 'hardwareConcurrency', function (orig) {
        return Object.getOwnPropertyDescriptor({ get hardwareConcurrency() {
          var n = orig.call(this);
          return n >= 8 ? 8 : n >= 4 ? 4 : 2;
        } }, 'hardwareConcurrency').get;
      });
      getter(Nav, 'deviceMemory', function (orig) {
        return Object.getOwnPropertyDescriptor({ get deviceMemory() {
          var n = orig.call(this);
          return n >= 8 ? 8 : 4;
        } }, 'deviceMemory').get;
      });
      // the battery reads like a desktop computer on mains power. The API itself stays: every Chrome has it, and a
      // Chrome without it is itself unusual (sites that look for tampering notice it)
      var Battery = w.BatteryManager && w.BatteryManager.prototype;
      var FIXED = { charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 };
      getter(Battery, 'charging', function () { return Object.getOwnPropertyDescriptor({ get charging() { return FIXED.charging; } }, 'charging').get; });
      getter(Battery, 'chargingTime', function () { return Object.getOwnPropertyDescriptor({ get chargingTime() { return FIXED.chargingTime; } }, 'chargingTime').get; });
      getter(Battery, 'dischargingTime', function () { return Object.getOwnPropertyDescriptor({ get dischargingTime() { return FIXED.dischargingTime; } }, 'dischargingTime').get; });
      getter(Battery, 'level', function () { return Object.getOwnPropertyDescriptor({ get level() { return FIXED.level; } }, 'level').get; });

      // frames and windows the page makes itself (about:blank) get the same treatment before the page can use them
      var IFrame = w.HTMLIFrameElement && w.HTMLIFrameElement.prototype;
      getter(IFrame, 'contentWindow', function (orig) {
        return Object.getOwnPropertyDescriptor({ get contentWindow() {
          var cw = orig.call(this);
          if (cw) patch(cw);
          return cw;
        } }, 'contentWindow').get;
      });
      getter(IFrame, 'contentDocument', function (orig) {
        return Object.getOwnPropertyDescriptor({ get contentDocument() {
          var d = orig.call(this);
          if (d && d.defaultView) patch(d.defaultView);
          return d;
        } }, 'contentDocument').get;
      });
      method(w, 'open', function (orig) {
        return { open() { var nw = orig.apply(this, arguments); if (nw) patch(nw); return nw; } }.open;
      });
    } catch (e) { /* a page without some of these still works */ }
  }

  patch(window);
}
/* eslint-enable no-var */

/** A 32-bit seed for (secret, partition, site): stable for a site in one browser session, unrelated between sites. */
function seedFor(secret, partition, site) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(`${secret}|${partition}|${site}`).digest().readUInt32LE(0);
}

module.exports = { buildPageScript, seedFor, pageScript };
