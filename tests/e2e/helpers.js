/**
 * E2E HELPERS — tests/e2e/helpers.js
 *
 * Tiny toolkit for the end-to-end tests: launches the REAL app (or a packaged build) through
 * Playwright's Electron driver, gives access to the browser chrome window, the main process and any
 * web contents, and provides a minimal test runner whose output matches the unit tests.
 *
 * Environment:
 *   APP_EXE=<path>        run a packaged build instead of `electron .` (see `npm run test:e2e:packaged`)
 *   E2E_NO_SANDBOX=1      pass --no-sandbox (needed in Linux containers / CI; added automatically when root)
 *
 * Linux needs a display: `npm run test:e2e` re-launches itself under xvfb-run when DISPLAY is unset.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');
const { _electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Minimal test runner (same output format as the unit tests) ──────────────

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'Values differ'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function runSuite(title, body) {
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  ${title}`);
  console.log('══════════════════════════════════════════════════════\n');
  let passed = 0; let failed = 0; let skipped = 0;
  const t = {
    async test(name, fn) {
      try { await fn(); console.log(`  ✅ PASS: ${name}`); passed++; }
      catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${String(err && err.message || err).split('\n').join('\n         ')}`); failed++; }
    },
    skip(name, why) { console.log(`  ⏭️  SKIP: ${name} (${why})`); skipped++; },
    section(name) { console.log(`\n📋 ${name}`); }
  };
  try {
    await body(t);
  } catch (err) {
    console.error(`  ❌ SUITE ERROR: ${err && err.stack || err}`);
    failed++;
  }
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  console.log('══════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

/** Polls `fn` until it returns a truthy value. */
async function waitFor(fn, { timeout = 15000, interval = 100, message = 'condition' } = {}) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) { lastErr = err; }
    await sleep(interval);
  }
  throw new Error(`Timed out after ${timeout} ms waiting for ${message}${lastErr ? ` (last error: ${lastErr.message})` : ''}`);
}

// ─── Launching ───────────────────────────────────────────────────────────────

function needsNoSandbox() {
  return process.env.E2E_NO_SANDBOX === '1' || (typeof process.getuid === 'function' && process.getuid() === 0);
}

function tmpDir(prefix = 'shmmoth-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** process.env plus overrides; a value of `undefined` removes the variable. */
function buildEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}

/** Variables through which Chromium picks up a *system* proxy on Linux. */
const NO_SYSTEM_PROXY_ENV = {
  HTTP_PROXY: undefined, HTTPS_PROXY: undefined, ALL_PROXY: undefined,
  http_proxy: undefined, https_proxy: undefined, all_proxy: undefined
};

/**
 * Launches the app. Returns a context with:
 *   app        Playwright ElectronApplication (use app.evaluate to run code in the main process)
 *   chrome     Page of the normal browser-chrome window (has window.mtcAPI)
 *   userData   the --user-data-dir in use (pass it back via opts.userData to simulate a restart)
 *   log        { text } – everything the app wrote to stdout/stderr
 *   close()    closes the app
 */
async function launchApp(opts = {}) {
  const userData = opts.userData || tmpDir();
  const packaged = Boolean(process.env.APP_EXE);
  const executablePath = process.env.APP_EXE || require('electron');
  // Mirror stdout/stderr into a file from the very first byte (Playwright only attaches to the streams after
  // start-up, and it strips NODE_OPTIONS, so the hook is loaded with `-r`).
  const logFile = path.join(os.tmpdir(), `shmmoth-e2e-${process.pid}-${Date.now()}.log`);
  const captureScript = path.join(__dirname, 'fixtures', 'capture-output.js');

  const args = ['-r', captureScript];
  if (!packaged) args.push(ROOT);
  args.push(`--user-data-dir=${userData}`, '--disable-gpu');
  if (needsNoSandbox()) args.push('--no-sandbox');
  if (opts.args) args.push(...opts.args);

  const app = await _electron.launch({
    executablePath,
    args,
    cwd: packaged ? undefined : ROOT,
    env: buildEnv({ ...(opts.env || {}), E2E_LOG_FILE: logFile }),
    // Playwright adds --no-sandbox on Linux unless told otherwise; run with the real OS sandbox whenever the machine allows it
    chromiumSandbox: !needsNoSandbox(),
    timeout: 60000
  });

  // `log.text` = everything the app printed. Uses the file when the capture hook ran, the live streams otherwise.
  let streamText = '';
  app.process().stdout.on('data', (d) => { streamText += d; });
  app.process().stderr.on('data', (d) => { streamText += d; });
  const log = {
    get text() {
      try { return fs.readFileSync(logFile, 'utf8'); } catch (_) { return streamText; }
    },
    /** true when the capture hook ran (it does not for packaged builds, which ignore `-r`); start-up output is then incomplete */
    get complete() { return fs.existsSync(logFile); }
  };

  await app.firstWindow();
  const ctx = {
    app, userData, log, packaged,
    async close() {
      try { await app.close(); } catch (_) { /* already gone */ }
      try { fs.rmSync(logFile, { force: true }); } catch (_) { /* ignore */ }
    }
  };
  ctx.chrome = await chromeWindow(app, { incognito: false });
  await waitFor(() => ctx.chrome.evaluate(() => Boolean(window.mtcAPI)), { message: 'window.mtcAPI in the chrome window', timeout: 30000 });
  // let start-up work (tab creation, extension load, …) settle
  await waitFor(() => listWebContents(app).then((l) => l.some((w) => w.url.startsWith('mtc://newtab'))), { message: 'the first tab', timeout: 30000 });
  return ctx;
}

/** The browser-chrome window (normal or incognito). */
async function chromeWindow(app, { incognito = false } = {}) {
  return waitFor(() => app.windows().find((w) => {
    const u = w.url();
    return u.includes('renderer/index.html') && u.includes('incognito=true') === incognito;
  }), { message: `${incognito ? 'incognito ' : ''}chrome window`, timeout: 30000 });
}

/** Calls window.mtcAPI.<method>(...args) in a chrome/internal page. */
function api(page, method, ...args) {
  return page.evaluate(([m, a]) => window.mtcAPI[m](...a), [method, args]);
}

// ─── Web contents access (main process) ──────────────────────────────────────

function listWebContents(app) {
  return app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => ({
    url: w.getURL(), title: w.getTitle(), loading: w.isLoading(), id: w.id
  })));
}

/** Waits until a web contents whose URL starts with `prefix` exists and finished loading. */
function waitForWebContents(app, prefix, { timeout = 20000, settle = true } = {}) {
  return waitFor(async () => {
    const list = await listWebContents(app);
    const hit = list.find((w) => w.url.startsWith(prefix) && (!settle || !w.loading));
    return hit || null;
  }, { timeout, message: `a web contents at ${prefix}*` });
}

/** Runs JavaScript inside the (first) web contents whose URL starts with `prefix`. */
function evalIn(app, prefix, code, { gesture = false } = {}) {
  return app.evaluate(async ({ webContents }, { prefix, code, gesture }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(prefix));
    if (!wc) throw new Error('no web contents at ' + prefix);
    return wc.executeJavaScript(code, gesture);
  }, { prefix, code, gesture });
}

/** Opens a tab through the chrome API and waits for it to finish loading. */
async function openTab(ctx, url, { page = ctx.chrome, waitPrefix } = {}) {
  await api(page, 'createTab', url);
  const prefix = waitPrefix || url.replace(/\/+$/, '');
  return waitForWebContents(ctx.app, prefix);
}

/** Main-process monitors: CSP violations and hosts contacted. Install right after launch. */
async function installMonitors(app) {
  await app.evaluate(({ app, session }) => {
    global.__csp = [];
    global.__hosts = [];
    app.on('web-contents-created', (e, wc) => {
      wc.on('console-message', function onMessage(details) {
        const m = details && typeof details.message === 'string' ? details.message : '';
        if (/Content Security Policy/i.test(m)) global.__csp.push(m.slice(0, 200));
      });
    });
    for (const s of [session.defaultSession, session.fromPartition('incognito')]) {
      const note = (d) => { try { global.__hosts.push(new URL(d.url).host); } catch (_) { /* ignore */ } };
      s.webRequest.onCompleted({ urls: ['*://*/*'] }, note);
      s.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, note);
    }
  });
}
const cspViolations = (app) => app.evaluate(() => global.__csp.slice());
const hostsContacted = (app) => app.evaluate(() => Array.from(new Set(global.__hosts)));

// ─── Local servers ───────────────────────────────────────────────────────────

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server, port, url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); })
      });
    });
  });
}

/** Serves `size` bytes with Range support (so the Turbo engine accepts it) as an attachment. */
function fileHandler({ size = 3 * 1024 * 1024, filename = 'file.bin', onRequest } = {}) {
  const body = Buffer.alloc(size, 7);
  return (req, res) => {
    if (onRequest) onRequest(req);
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : body.length - 1;
    res.writeHead(m ? 206 : 200, {
      'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': end - start + 1,
      ...(m ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {})
    });
    res.end(body.subarray(start, end + 1));
  };
}

module.exports = {
  ROOT, sleep, assert, assertEqual, runSuite, waitFor,
  launchApp, chromeWindow, api, tmpDir,
  listWebContents, waitForWebContents, evalIn, openTab,
  installMonitors, cspViolations, hostsContacted,
  startServer, fileHandler,
  needsNoSandbox, NO_SYSTEM_PROXY_ENV
};
