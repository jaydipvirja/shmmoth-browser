/**
 * Preloaded into the app's main process by the E2E helpers (NODE_OPTIONS=--require=…).
 * Playwright attaches to the app's stdout/stderr only after start-up, so early output (storage recovery messages,
 * deprecation warnings, …) would be lost. This mirrors everything written to stdout/stderr into E2E_LOG_FILE.
 */
'use strict';
const fs = require('fs');
const file = process.env.E2E_LOG_FILE;
if (file) {
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      try { fs.appendFileSync(file, typeof chunk === 'string' ? chunk : Buffer.from(chunk)); } catch (_) { /* never break the app */ }
      return original(chunk, ...rest);
    };
  }
}
