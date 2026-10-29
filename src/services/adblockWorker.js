/**
 * AD-BLOCK ENGINE BUILDER — adblockWorker.js (1.5.6), runs in a worker thread (services/adblocker.js)
 *
 * Turning about 13 MB of filter lists into an engine takes 1.5 s on a fast computer and several seconds on a slow one.
 * On the browser's main thread that froze everything for that long: the window, typing, and every page that was
 * loading (each request waits for the main thread). It happened at the first start and at every list update (YouTube's
 * fixes: every 4 hours). Here the work runs beside the browser: the lists are parsed, the scriptlet resources added,
 * the engine serialized and written to the cache file; the browser only reads the finished engine back (≈ 0.1 s).
 *
 * In:  workerData { text, resources, config, cacheFile, adblockerPath }
 * Out: { ok: true, engine: Uint8Array (transferred), network, cosmetic, written } | { ok: false, error }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');

function build({ text, resources, config, cacheFile, adblockerPath }) {
  const { FiltersEngine } = require(adblockerPath);
  const engine = FiltersEngine.parse(text, Object.assign({}, config));
  if (typeof resources === 'string' && resources) engine.updateResources(resources, String(resources.length));
  let network = 0;
  let cosmetic = 0;
  try {
    const f = engine.getFilters();
    network = f.networkFilters.length;
    cosmetic = f.cosmeticFilters.length;
  } catch (_) { /* counts are for Settings only */ }
  const bytes = engine.serialize();
  let written = false;
  if (cacheFile) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const tmp = cacheFile + '.tmp';
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, cacheFile);
      written = true;
    } catch (_) { /* the browser still gets the engine; it is built again next time */ }
  }
  return { network, cosmetic, bytes, written };
}

try {
  const r = build(workerData || {});
  parentPort.postMessage({ ok: true, engine: r.bytes, network: r.network, cosmetic: r.cosmetic, written: r.written }, [r.bytes.buffer]);
} catch (err) {
  parentPort.postMessage({ ok: false, error: (err && err.message) || String(err) });
}
