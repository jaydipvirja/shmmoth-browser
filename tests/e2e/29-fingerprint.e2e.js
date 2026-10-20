/**
 * E2E 29 — fingerprinting protection (1.5.1) in the real browser
 *
 * One test page, served by two local sites (127.0.0.1 and localhost — different sites to the browser), computes what
 * fingerprinting scripts compute: a canvas drawing as data URL and pixels, an audio rendering, the graphics card, the
 * processor cores, the battery — also from an about:blank frame it creates itself.
 *   - one site reads the same values every time (reload, a second tab): pages that use canvas still work
 *   - another site reads different canvas / audio values: the fingerprint cannot be linked across sites
 *   - the graphics card shows its maker only; 2/4/8 cores; no battery API; the changed functions read as native code
 *   - the drawing itself is untouched (the page's canvas keeps its pixels; the change is too small to see)
 *   - switched off for a site from the shield ("Tracking protection"), or in Settings, the real values come back
 *
 * Run: npm run test:e2e   (or: node tests/e2e/29-fingerprint.e2e.js)
 */
'use strict';

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, startServer, evalIn, waitForWebContents, listWebContents
} = require('./helpers');

const PROBE = `<!doctype html><title>probe</title><body><script>
  async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join(''); }
  function draw(doc) {
    const c = doc.createElement('canvas'); c.width = 220; c.height = 40;
    const x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '16px Arial'; x.fillStyle = '#f60'; x.fillRect(100, 1, 62, 20);
    x.fillStyle = '#069'; x.fillText('SHMMOTH fp, 1.5.1 <canvas>', 2, 15);
    x.fillStyle = 'rgba(102, 204, 0, 0.7)'; x.fillText('SHMMOTH fp, 1.5.1 <canvas>', 4, 17);
    return c;
  }
  async function audio() {
    const ctx = new OfflineAudioContext(1, 5000, 44100);
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0); let s = 0; for (let i = 4500; i < 5000; i++) s += Math.abs(d[i]);
    return s.toString();
  }
  window.probe = async function () {
    const c = draw(document);
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    c.toDataURL();                                              // reads a copy: the page's canvas keeps its pixels
    const pxAfter = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const frame = document.createElement('iframe'); document.body.appendChild(frame);
    const cf = draw(frame.contentWindow.document);
    let renderer = '';
    try { const gl = document.createElement('canvas').getContext('webgl'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '(none)'; } catch (e) { renderer = 'error ' + e.message; }
    return {
      dataUrl: await sha(c.toDataURL()),
      dataUrlAgain: await sha(c.toDataURL()),
      pixels: await sha(Array.from(px).join(',')),
      pixelsAfter: await sha(Array.from(pxAfter).join(',')),
      frameDataUrl: await sha(frame.contentWindow.HTMLCanvasElement.prototype.toDataURL.call(cf)),
      audio: await audio(),
      renderer,
      cores: navigator.hardwareConcurrency,
      battery: typeof navigator.getBattery,
      nativeLook: HTMLCanvasElement.prototype.toDataURL.toString(),
      gpc: navigator.globalPrivacyControl
    };
  };
</script></body>`;

runSuite('SHMMOTH Browser — E2E 29: fingerprinting protection', async (t) => {
  const site = await startServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PROBE); });
  const siteA = site.url;                                   // http://127.0.0.1:port
  const siteB = site.url.replace('127.0.0.1', 'localhost'); // another site, same page
  const ctx = await launchApp();
  const { app, chrome } = ctx;
  const read = async (base, tag) => {
    const url = `${base}/probe?${tag}`;
    await api(chrome, 'createTab', url);
    await waitForWebContents(app, url);
    await waitFor(async () => (await listWebContents(app)).some((w) => w.url === url && !w.loading), { message: url });
    await sleep(200);
    return evalIn(app, url, 'window.probe()');
  };

  try {
    let a1; let a2; let b1;
    t.section('Per site');

    await t.test('one site reads the same values every time (two tabs)', async () => {
      a1 = await read(siteA, 'a1');
      a2 = await read(siteA, 'a2');
      for (const k of ['dataUrl', 'pixels', 'audio', 'frameDataUrl']) assertEqual(a2[k], a1[k], k);
      assertEqual(a1.dataUrlAgain, a1.dataUrl, 'two reads in one page');
      assertEqual(a1.pixelsAfter, a1.pixels, 'reading the canvas changed the page\'s own canvas');
    });

    await t.test('another site reads different canvas and audio values (the fingerprint does not link the two)', async () => {
      b1 = await read(siteB, 'b1');
      assert(b1.dataUrl !== a1.dataUrl, 'canvas data URL is the same on both sites');
      assert(b1.pixels !== a1.pixels, 'canvas pixels are the same on both sites');
      assert(b1.audio !== a1.audio, 'audio is the same on both sites: ' + a1.audio);
      assert(b1.frameDataUrl !== a1.frameDataUrl, 'an about:blank frame gives the real canvas');
    });

    await t.test('the graphics card shows its maker only; 2/4/8 cores; no battery API; the functions read as native code', async () => {
      // (no WebGL at all on a machine without a graphics driver: nothing to hide there)
      if (!/\(none\)|error/.test(a1.renderer)) assert(/^ANGLE \([^,]+, [^,]+ GPU\)$/.test(a1.renderer), a1.renderer);
      console.log('    renderer seen by the page: ' + a1.renderer);
      assert([2, 4, 8].includes(a1.cores), String(a1.cores));
      assertEqual(a1.battery, 'undefined');
      assert(/\[native code\]/.test(a1.nativeLook) && !/noise|copy/.test(a1.nativeLook), a1.nativeLook);
      assertEqual(a1.gpc, true);
    });

    t.section('Switched off');

    await t.test('off for a site ("Tracking protection" in the shield): the real values come back there, other sites stay protected', async () => {
      await api(chrome, 'updateSettings', { privacyCookieAllowSites: ['127.0.0.1'] });
      const off1 = await read(siteA, 'off1');
      const off2 = await read(siteB, 'off2');
      assert(off1.dataUrl !== a1.dataUrl, 'still the protected value');
      assert(off2.dataUrl === b1.dataUrl, 'the other site lost its protection');
      assertEqual(off1.battery, 'function');
      await api(chrome, 'updateSettings', { privacyCookieAllowSites: [] });
    });

    await t.test('off in Settings: both sites read the same, real values', async () => {
      await api(chrome, 'updateSettings', { privacyFingerprintProtection: false });
      const r1 = await read(siteA, 'r1');
      const r2 = await read(siteB, 'r2');
      assertEqual(r1.dataUrl, r2.dataUrl, 'unprotected canvas differs between sites');
      assertEqual(r1.audio, r2.audio, 'unprotected audio differs between sites');
      await api(chrome, 'updateSettings', { privacyFingerprintProtection: true });
    });

    await t.test('WebRTC never shows the local network addresses while it is on', async () => {
      const policy = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.getURL().startsWith('http')).map((w) => w.getWebRTCIPHandlingPolicy()));
      assert(policy.length && policy.every((p) => p === 'default_public_interface_only'), policy.join());
    });
  } finally {
    await ctx.close();
    await site.close();
  }
});
