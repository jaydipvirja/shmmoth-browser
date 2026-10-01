/**
 * Fixture for tests/e2e/05-updater.e2e.js — runs inside a real Electron main process.
 *
 * It starts a fake "GitHub" (API + release downloads + CDN redirect) and a forwarding proxy on localhost, then drives the
 * REAL UpdateManager with the REAL Electron `net` based fetcher through several release scenarios. The outcome of
 * each scenario is written as JSON to the file named by E2E_RESULT_FILE.
 */
'use strict';

const { app, session } = require('electron');
const http   = require('http');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'services');
const UpdateManager = require(path.join(SRC, 'updateManager'));
const sig = require(path.join(SRC, 'updateSignature'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const KEY = sig.generateKeyPair();
const EVIL = sig.generateKeyPair();

const S = { tag: 'v1.0.17', ver: '1.0.17', installer: crypto.randomBytes(5 * 1024 * 1024 + 123), served: null, sigKey: KEY, redirectTo: null, base: '' };
const NAME = () => `SHMMOTH-Browser-Setup-${S.ver}.exe`;
const signature = () => sig.signUpdate({ assetName: NAME(), size: S.installer.length, sha256: sha(S.installer), privateKeyPem: S.sigKey.privateKeyPem });

const github = http.createServer((req, res) => {
  const u = req.url;
  if (u === '/repos/jaydipvirja/shmmoth-browser/releases/latest') {
    const served = S.served || S.installer;
    const dl = (n) => `${S.base}/jaydipvirja/shmmoth-browser/releases/download/${S.tag}/${n}`;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      tag_name: S.tag, draft: false, prerelease: false,
      html_url: `${S.base}/jaydipvirja/shmmoth-browser/releases/tag/${S.tag}`,
      assets: [
        { name: NAME(), size: served.length, digest: 'sha256:' + sha(served), browser_download_url: dl(NAME()) },
        { name: NAME() + '.sig', size: signature().length, browser_download_url: dl(NAME() + '.sig') }
      ]
    }));
  }
  const m = /^\/jaydipvirja\/shmmoth-browser\/releases\/download\/[^/]+\/(.+)$/.exec(u);
  if (m) { res.writeHead(302, { Location: S.redirectTo || '/cdn/' + m[1] }); return res.end(); }
  if (u.startsWith('/cdn/')) {
    const name = decodeURIComponent(u.slice(5));
    if (name.endsWith('.sig')) return res.end(signature());
    const body = S.served || S.installer;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length });
    let off = 0;
    const pump = () => { while (off < body.length) { if (!res.write(body.subarray(off, off += 256 * 1024))) return res.once('drain', pump); } res.end(); };
    return pump();
  }
  res.writeHead(404); res.end('nope');
});

// Forward proxy: the only route to http://gh-fake.test
const proxyLog = [];
const proxy = http.createServer((req, res) => {
  proxyLog.push(req.url.replace(/^http:\/\/gh-fake\.test/, ''));
  const target = new URL(req.url);
  const up = http.request({ host: '127.0.0.1', port: github.address().port, path: target.pathname + target.search, method: req.method, headers: { ...req.headers, host: 'gh-fake.test' } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(up);
});

async function scenario(name, opts, mutate) {
  Object.assign(S, { served: null, sigKey: KEY, redirectTo: null, tag: 'v1.0.17', ver: '1.0.17' });
  if (mutate) mutate();
  const updatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shmmoth-upd-e2e-'));
  const launched = [];
  const mgr = new UpdateManager({
    apiBase: S.base, downloadBase: S.base, allowHttp: true, allowedHosts: opts.allowedHosts || ['127.0.0.1'],
    publicKeys: [KEY.publicKeyBase64], updatesDir,
    launcher: async (p) => { launched.push(p); return ''; }, quitApp: () => {}
  });
  mgr._status.currentVersion = '1.0.16';
  await mgr.checkForUpdates();
  for (let i = 0; i < 600 && (mgr.isDownloading || mgr.getStatus().status === 'checking'); i++) await sleep(25);
  await sleep(100);
  const st = mgr.getStatus();
  const installCall = st.status === 'downloaded' ? await mgr.quitAndInstall() : null;
  const out = {
    scenario: name, status: st.status, message: st.message, verified: Boolean(mgr.verifiedUpdate),
    bytesOnDisk: mgr.verifiedUpdate ? fs.statSync(mgr.verifiedUpdate.path).size : 0,
    launched: launched.length, installCall, filesLeft: fs.readdirSync(updatesDir)
  };
  fs.rmSync(updatesDir, { recursive: true, force: true });
  return out;
}

app.whenReady().then(async () => {
  const results = {};
  try {
    await new Promise((r) => github.listen(0, '127.0.0.1', r));
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    S.base = `http://127.0.0.1:${github.address().port}`;

    results.good = await scenario('good release', {});
    results.malware = await scenario('installer replaced by malware (digest matches, signature does not)', {}, () => { S.served = crypto.randomBytes(S.installer.length); });
    results.attackerKey = await scenario('signed by an attacker key', {}, () => { S.sigKey = EVIL; });
    results.badRedirect = await scenario('redirect to a host that is not allowed', {}, () => { S.redirectTo = `http://localhost:${github.address().port}/cdn/${NAME()}`; });

    // proxy: the host does not resolve; only the configured proxy can reach it
    await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:' + proxy.address().port, proxyBypassRules: '' });
    await session.defaultSession.closeAllConnections();
    S.base = 'http://gh-fake.test';
    results.viaProxy = await scenario('release reachable only through the configured proxy', { allowedHosts: ['gh-fake.test'] });
    results.viaProxy.proxySawApi = proxyLog.some((p) => p.startsWith('/repos/'));
    results.viaProxy.proxySawDownload = proxyLog.some((p) => p.startsWith('/cdn/') && !p.endsWith('.sig'));
  } catch (err) {
    results.fatal = String(err && err.stack || err);
  }
  fs.writeFileSync(process.env.E2E_RESULT_FILE, JSON.stringify(results, null, 2));
  github.close(); proxy.close();
  app.exit(0);
});
