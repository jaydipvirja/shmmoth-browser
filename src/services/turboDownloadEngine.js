/**
 * TURBO DOWNLOAD ENGINE — turboDownloadEngine.js
 *
 * Multi-connection download engine with optional multi-network ("bonding") support.
 *
 * HOW IT WORKS
 *   The file is cut into blocks (1–8 MiB). A pool of workers — each one connection — keeps taking the next block
 *   from a queue, so a fast connection simply does more blocks than a slow one. (Before, the file was cut into
 *   equal parts, one per connection: with two networks of different speed the download took as long as the slow
 *   network needed for its half, and one stuck connection stalled everything at the end.)
 *
 *   - Blocks are claimed in file order and written with asynchronous positional writes, so the data lands close
 *     to the front of the file (no multi-GB gap that NTFS must zero-fill before the first write) and the main
 *     process is never blocked by disk writes.
 *   - Multi-network: when two or more *physical* networks can reach the server, the workers are spread over them,
 *     each bound to its network's local address (localAddress). A network that cannot connect is dropped and its
 *     workers move to a working one. When the queue runs dry, an idle worker repeats the block a slower connection
 *     is still busy with ("end game"), so the last block never waits for the slowest link.
 *   - Every answer is checked: only "206 Partial Content" for the requested range is accepted. A server that
 *     ignores Range switches the download to one stream; a refusal (401/403/404/410), a TLS problem or silence
 *     is reported — never retried for ever behind a progress bar that does not move.
 *   - Transient errors (reset, early close, 429, 5xx) are retried with a growing pause; a block continues where it
 *     stopped. Pause/resume keeps every byte.
 *
 * EVENTS: progress, completed, error, paused, resumed, cancelled (payloads unchanged)
 */

'use strict';

const EventEmitter = require('events');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');

// Fallback UA for downloads started without browser headers: match the running Chromium
const CHROME_MAJOR = String((process.versions && process.versions.chrome) || '130').split('.')[0];

const MiB = 1024 * 1024;

/**
 * Limits. All can be overridden through the constructor (the tests use short ones).
 *   startStallMs   nothing at all arrived (the server never answers, queues us, throttles extra connections …):
 *                  give up quickly so the caller can hand the download to Chromium's own downloader
 *   stallMs        data had been flowing and then stopped: keep retrying this long before giving up
 */
const DEFAULT_LIMITS = Object.freeze({
  startStallMs: 30 * 1000,
  stallMs: 10 * 60 * 1000,
  socketTimeoutMs: 20 * 1000,
  retryBaseMs: 1000,
  retryMaxMs: 15 * 1000,
  minBlockBytes: 1 * MiB,
  maxBlockBytes: 8 * MiB,
  maxWorkers: 32,
  interfaceProbeMs: 1500,
  endGameMinBytes: 256 * 1024
});

const MAX_REGIONS = 32;                    // bars shown in the download list
const PART_SUFFIX = '.shmmoth-part';       // a download is written here until it is complete

const TLS_ERROR = /^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|CERT_UNTRUSTED|HOSTNAME_MISMATCH|ERR_TLS_.*|ERR_SSL_.*)$/;
const NETWORK_DOWN = /EADDRNOTAVAIL|ENETUNREACH|EHOSTUNREACH|ENETDOWN|ETIMEDOUT|EINVAL/;

/** An HTTP status that is not a usable answer to a ranged download request. */
class HttpStatusError extends Error {
  constructor(status) {
    let text;
    if (status === 401 || status === 403) text = 'The server refused the download (HTTP ' + status + '). The link may have expired or may only work inside the page that offered it.';
    else if (status === 404 || status === 410) text = 'The file is no longer available on the server (HTTP ' + status + ').';
    else if (status === 429) text = 'The server limits how many connections it accepts (HTTP 429).';
    else if (status === 416) text = 'The server did not accept the requested part of the file (HTTP 416).';
    else text = 'The server answered with an error (HTTP ' + status + ').';
    super(text);
    this.name = 'HttpStatusError';
    this.status = status;
    /** retrying the same request will not help */
    this.permanent = status === 401 || status === 403 || status === 404 || status === 410;
  }
}

/** Gives connection/TLS errors a readable message and marks the ones that retrying cannot fix. */
function describeError(err, phase) {
  if (!(err instanceof Error)) err = new Error(String(err));
  if (err.name === 'HttpStatusError') return err;
  const code = err.code || '';
  if (TLS_ERROR.test(code)) {
    err.message = `The secure connection to the server could not be verified (${code}).`;
    err.permanent = true;
    err.tls = true;
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    err.message = 'The server address could not be found.';
    err.permanent = true;
  } else if (code === 'ECONNREFUSED') {
    err.message = 'The server refused the connection.';
    err.permanent = true;
  }
  if (phase) err.phase = phase;
  return err;
}

/** Copy of `headers` without what must not follow a request to another site (the page's cookies, credentials). */
function withoutCredentials(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!/^(cookie|authorization)$/i.test(k)) out[k] = v;
  }
  return out;
}

/**
 * Follows HTTP redirects to get final headers or stream.
 * Supports socket binding to specific localAddress (network interface).
 * `options.onRequest(req)` is called for every request that is created, so the caller can abort it while it is
 * still connecting.
 */
function requestWithRedirects(targetUrl, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many HTTP redirects'));

    let parsed;
    try { parsed = new URL(targetUrl); } catch (err) { return reject(err); }
    const client = parsed.protocol === 'https:' ? https : http;

    const reqOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
        'Accept': '*/*',
        ...(options.headers || {})
      }
    };

    // Bind to specific local IP interface for Multi-WAN Internet Bonding
    if (options.localAddress && typeof options.localAddress === 'string') {
      reqOptions.localAddress = options.localAddress;
      reqOptions.family = 4;
    }

    const req = client.request(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let nextUrl;
        try { nextUrl = new URL(res.headers.location, targetUrl).toString(); } catch (err) { return reject(err); }
        let nextOptions = options;
        if (new URL(nextUrl).host !== parsed.host && options.headers) {
          // the page's cookies belong to the site that was asked, not to wherever it redirects to (a CDN, a mirror …)
          nextOptions = { ...options, headers: withoutCredentials(options.headers) };
        }
        return requestWithRedirects(nextUrl, nextOptions, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }
      resolve({ res, finalUrl: targetUrl, req });
    });
    if (typeof options.onRequest === 'function') options.onRequest(req);

    req.setTimeout(options.timeout || 20000, () => {
      req.destroy(Object.assign(new Error('ETIMEDOUT: Socket connection timed out'), { code: 'ETIMEDOUT' }));
    });

    req.on('error', (err) => {
      // If localAddress binding failed (e.g. EINVAL / EADDRNOTAVAIL on Windows dual-stack), report it as a network problem
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

class TurboDownloadEngine extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultThreads=8]
   * @param {number} [options.minTurboSize=2097152] (2 MB minimum for turbo)
   * @param {boolean} [options.multiSource=true]
   * @param {number} [options.blockBytes]  fixed block size (default: chosen from the file size)
   * @param {number} [options.startStallMs] … see DEFAULT_LIMITS (also stallMs, socketTimeoutMs, retryBaseMs, retryMaxMs,
   *        minBlockBytes, maxBlockBytes, maxWorkers, interfaceProbeMs, endGameMinBytes)
   */
  constructor(options = {}) {
    super();
    this.defaultThreads = options.defaultThreads || 8;
    this.minTurboSize = options.minTurboSize || (2 * MiB); // 2 MB minimum for turbo
    this.multiSourceEnabled = options.multiSource !== false;
    this.blockBytes = Number.isFinite(options.blockBytes) && options.blockBytes > 0 ? options.blockBytes : 0;
    this.limits = { ...DEFAULT_LIMITS };
    for (const key of Object.keys(DEFAULT_LIMITS)) {
      if (Number.isFinite(options[key]) && options[key] > 0) this.limits[key] = options[key];
    }
    this.activeTasks = new Map();
    this._starting = new Set();      // ids whose start() is still probing / looking for network interfaces
    this._precancelled = new Set();  // ... and that were cancelled meanwhile
  }

  // ───────────────────────────── network interfaces ─────────────────────────────

  /**
   * Discovers all active IPv4 network interfaces of the system.
   * `isVirtual` marks adapters that only exist inside the computer (VMs, WSL, VPNs, containers): they leave through
   * the same physical connection as everything else, so they never add bandwidth.
   *
   * @returns {Array<{ name: string, address: string, netmask: string, isVirtual: boolean }>}
   */
  static getAvailableNetworkInterfaces() {
    const interfaces = [];
    const nets = os.networkInterfaces();

    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        // Only valid IPv4, skip loopback and auto-private 169.254.x.x
        if ((net.family === 'IPv4' || net.family === 4) && !net.internal && !net.address.startsWith('169.254.')) {
          const isVirtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Tailscale|ZeroTier|WireGuard|OpenVPN|\bVPN\b|\bTAP\b|\bTUN\b|Npcap|Loopback|Teredo|isatap|Pseudo|Docker|^docker|^veth|^br-|^virbr|^vboxnet|^tailscale|^zt|^tun\d|^tap\d|^wg\d/i.test(name);
          interfaces.push({
            name,
            address: net.address,
            netmask: net.netmask,
            isVirtual
          });
        }
      }
    }

    // Sort so physical adapters (Wi-Fi, Ethernet, Mobile USB) come before virtual adapters
    interfaces.sort((a, b) => (a.isVirtual === b.isVirtual ? 0 : a.isVirtual ? 1 : -1));
    return interfaces;
  }

  /**
   * True when a TCP connection from local address `ip` to host:port succeeds within `timeoutMs`.
   * The connection is bound to `ip`, so it only succeeds when that network really reaches the target.
   */
  static _connectFrom(ip, host, port, timeoutMs = 1500) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok, sock) => { if (done) return; done = true; try { sock.destroy(); } catch (_) {} resolve(ok); };
      let s;
      try {
        s = net.createConnection({ host, port, localAddress: ip, family: 4 }, () => finish(true, s));
      } catch (_) { return resolve(false); }
      s.setTimeout(timeoutMs, () => finish(false, s));
      s.on('error', () => finish(false, s));
    });
  }

  /**
   * Tests whether the network with address `ip` has live internet connectivity (a TCP handshake to a public HTTPS
   * port; port 443 is open on almost every network, while port 53 — used before — is blocked on many mobile and
   * public networks, which made working networks look offline).
   * @param {string} ip
   * @param {number} [timeoutMs=1500]
   * @returns {Promise<boolean>}
   */
  static async checkInterfaceOnline(ip, timeoutMs = 1500) {
    const probes = ['1.1.1.1', '8.8.8.8'].map((host) => TurboDownloadEngine._connectFrom(ip, host, 443, timeoutMs));
    return new Promise((resolve) => {
      let pending = probes.length;
      probes.forEach((p) => p.then((ok) => {
        if (ok) resolve(true);
        else if (--pending === 0) resolve(false);
      }));
    });
  }

  /**
   * Discovers all network interfaces and checks live internet connectivity for each.
   * @param {number} [timeoutMs=1500]
   * @returns {Promise<Array<{ name: string, address: string, netmask: string, isVirtual: boolean, isOnline: boolean }>>}
   */
  static async getAvailableNetworkInterfacesAsync(timeoutMs = 1500) {
    const raw = TurboDownloadEngine.getAvailableNetworkInterfaces();
    await Promise.all(raw.map(async (iface) => {
      try {
        iface.isOnline = await TurboDownloadEngine.checkInterfaceOnline(iface.address, timeoutMs);
      } catch (_) {
        iface.isOnline = false;
      }
    }));
    return raw;
  }

  /**
   * Decides which networks take part in a download. Bonding needs at least two *physical* networks that can both
   * reach the download server (checked with a connection bound to each, to the server's own address and port).
   * Anything else downloads over the system's normal route — workers are not bound to an address then, because
   * binding cannot help and only adds ways to fail.
   * @returns {Promise<Array<{name, address, ...stats}>>} the networks to use ([] = normal route)
   */
  async _selectInterfaces(taskOpts, targetUrl) {
    let list;
    if (Array.isArray(taskOpts.interfaces)) {
      list = taskOpts.interfaces.filter((i) => i && typeof i.address === 'string').map((i) => ({ name: String(i.name || i.address), address: i.address }));
    } else {
      const physical = TurboDownloadEngine.getAvailableNetworkInterfaces().filter((i) => !i.isVirtual);
      list = physical.map((i) => ({ name: i.name, address: i.address }));
    }
    if (list.length < 2) return [];

    let host; let port;
    try {
      const u = new URL(targetUrl);
      host = u.hostname;
      port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    } catch (_) { return []; }

    const reach = await Promise.all(list.map((i) => TurboDownloadEngine._connectFrom(i.address, host, port, this.limits.interfaceProbeMs)));
    const usable = list.filter((_, k) => reach[k]);
    if (usable.length < 2) return [];
    return usable.map((i) => ({ ...i, receivedBytes: 0, lastReceivedBytes: 0, speed: 0, failed: false, failures: 0 }));
  }

  // ───────────────────────────────── probing ─────────────────────────────────

  /**
   * Probes remote server to check for range support, file size, and final URL.
   * @param {string} url
   * @param {object} [headers]
   * @param {object} [opts]
   * @param {number} [opts.timeout] socket timeout in ms
   * @returns {Promise<{ acceptsRanges: boolean, totalBytes: number, finalUrl: string, filename: string, status: number, error?: string }>}
   */
  async probe(url, headers = {}, opts = {}) {
    const fallbackName = () => { try { return path.basename(new URL(url).pathname) || 'download'; } catch (_) { return 'download'; } };
    try {
      // First attempt a range test request for byte 0-0
      const { res, finalUrl, req } = await requestWithRedirects(url, {
        method: 'GET',
        timeout: opts.timeout || this.limits.socketTimeoutMs,
        headers: {
          ...headers,
          'Range': 'bytes=0-0'
        }
      });

      res.resume();
      req.destroy(); // We only needed headers

      const statusCode = res.statusCode;
      const contentRange = res.headers['content-range'] || '';
      let totalBytes = 0;
      let acceptsRanges = false;

      // 206 Partial Content means server supports byte ranges. Anything else (200 = the whole file was sent although
      // a range was asked for, errors …) means ranges cannot be used.
      if (statusCode === 206) {
        acceptsRanges = true;
        const match = contentRange.match(/\/(\d+|\*)$/);
        if (match && match[1] !== '*') {
          totalBytes = parseInt(match[1], 10);
        }
      } else if (statusCode === 200) {
        totalBytes = parseInt(res.headers['content-length'] || '0', 10) || 0;
      }

      // Extract filename if Content-Disposition exists
      let filename = '';
      const disposition = res.headers['content-disposition'];
      if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
        if (match && match[1]) {
          try { filename = decodeURIComponent(match[1]); } catch (_) { filename = match[1]; }
        }
      }
      if (!filename) {
        try {
          filename = path.basename(new URL(finalUrl).pathname) || 'download';
        } catch (_) {
          filename = 'download';
        }
      }

      return { acceptsRanges, totalBytes, finalUrl, filename, status: statusCode };
    } catch (err) {
      return {
        acceptsRanges: false,
        totalBytes: 0,
        finalUrl: url,
        filename: fallbackName(),
        status: 0,
        error: (err && err.message) || String(err)
      };
    }
  }

  // ─────────────────────────────────── start ───────────────────────────────────

  /**
   * Starts a download. Automatically splits into parallel connections if ranges are supported
   * and spreads them over several networks if more than one can reach the server.
   *
   * @param {object} taskOpts
   * @param {string} taskOpts.id
   * @param {string} taskOpts.url
   * @param {string} taskOpts.savePath
   * @param {number} [taskOpts.threads]
   * @param {number} [taskOpts.totalBytes]
   * @param {object} [taskOpts.probe]       result of probe() the caller already has
   * @param {object} [taskOpts.headers]
   * @param {boolean} [taskOpts.multiSource]
   * @param {Array<{name:string,address:string}>} [taskOpts.interfaces] networks to use instead of discovering them
   */
  async start(taskOpts) {
    const { id } = taskOpts;
    this._starting.add(id);
    try {
      return await this._start(taskOpts);
    } finally {
      this._starting.delete(id);
      this._precancelled.delete(id);
    }
  }

  async _start(taskOpts) {
    const { id, url, savePath } = taskOpts;
    let headers = taskOpts.headers || {};
    const requestedThreads = Math.max(1, Math.min(this.limits.maxWorkers, taskOpts.threads || this.defaultThreads));
    const multiSourceRequested = taskOpts.multiSource !== undefined ? taskOpts.multiSource : this.multiSourceEnabled;

    let probeInfo = taskOpts.probe || { acceptsRanges: true, totalBytes: taskOpts.totalBytes || 0, finalUrl: url, filename: '' };
    if (!taskOpts.probe && !taskOpts.totalBytes) {
      try {
        probeInfo = await this.probe(url, headers);
      } catch (_) {}
    }
    const totalBytes = taskOpts.totalBytes || probeInfo.totalBytes || 0;
    const finalUrl = probeInfo.finalUrl || url;
    try {
      // the cookies were collected for the address that was asked; the final address may be another site
      if (new URL(finalUrl).host !== new URL(url).host) headers = withoutCredentials(headers);
    } catch (_) {}
    const isTurboEligible = (probeInfo.acceptsRanges !== false) && totalBytes >= this.minTurboSize;

    let networks = [];
    if (isTurboEligible && multiSourceRequested) {
      try { networks = await this._selectInterfaces(taskOpts, finalUrl); } catch (_) { networks = []; }
    }

    // Cancelled (or removed from the list) while the server was still being probed: do not start at all
    if (this._precancelled.has(id)) return null;

    const task = {
      id,
      url: finalUrl,
      savePath,                                  // where the finished file ends up
      workPath: savePath + PART_SUFFIX,          // where it is written meanwhile (renamed when complete)
      totalBytes,
      receivedBytes: 0,
      state: 'progressing',
      isPaused: false,
      isTurbo: isTurboEligible,
      isMultiSource: networks.length > 1,
      threadsCount: isTurboEligible ? requestedThreads : 1,
      segments: [],
      interfaces: networks,
      speed: 0,
      eta: null,
      fd: null,
      pendingWrites: 0,
      onDrained: null,
      lastCalculatedTime: Date.now(),
      lastReceivedBytes: 0,
      lastProgressAt: Date.now(),   // last time bytes arrived (or the download was started / resumed)
      timer: null,
      rangeVerified: false,
      workers: [],
      blocks: new Map(),
      requeue: [],
      headers
    };

    this.activeTasks.set(id, task);

    // Ensure target folder exists
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open the part file for random access positional writing (w+). The final name is only taken at the very end: a
    // file under the final name could be removed by something else that used the name before (the browser's own,
    // cancelled download of the same file deletes its placeholder shortly after the cancel — it did delete a finished
    // Turbo download on Windows).
    try {
      task.fd = fs.openSync(task.workPath, 'w+');
    } catch (err) {
      this.activeTasks.delete(id);
      throw err;
    }

    if (isTurboEligible) {
      this._startBlocks(task);
    } else {
      this._startSingleStream(task, headers);
    }

    return task;
  }

  // ───────────────────────────── block scheduler ─────────────────────────────

  _startBlocks(task) {
    const networks = task.interfaces;
    // enough connections for every network to be busy, but never more workers than blocks
    let workerCount = networks.length > 1 ? Math.max(task.threadsCount, networks.length * 2) : task.threadsCount;
    workerCount = Math.min(workerCount, this.limits.maxWorkers);

    let blockSize = this.blockBytes;
    if (!blockSize) {
      blockSize = Math.ceil(task.totalBytes / (workerCount * 16));
      blockSize = Math.max(this.limits.minBlockBytes, Math.min(this.limits.maxBlockBytes, blockSize));
    }
    task.blockSize = blockSize;
    task.blockCount = Math.max(1, Math.ceil(task.totalBytes / blockSize));
    task.nextBlock = 0;
    task.doneBlocks = 0;
    workerCount = Math.min(workerCount, task.blockCount);
    task.threadsCount = workerCount;

    // bars for the download list: at most MAX_REGIONS slices of the file
    task.regionCount = Math.min(MAX_REGIONS, task.blockCount);
    task.regionBlocks = Math.ceil(task.blockCount / task.regionCount);
    task.regionCount = Math.ceil(task.blockCount / task.regionBlocks);
    task.regionDone = new Array(task.regionCount).fill(0);
    task.regionTotal = new Array(task.regionCount).fill(0);
    for (let i = 0; i < task.blockCount; i++) {
      task.regionTotal[Math.floor(i / task.regionBlocks)] += this._blockLength(task, i);
    }
    task.regionNet = new Array(task.regionCount).fill(null);

    task.workers = [];
    for (let i = 0; i < workerCount; i++) {
      task.workers.push({
        id: i,
        iface: networks.length > 1 ? networks[i % networks.length] : null,
        running: false, idle: false, dead: false, restart: false,
        block: null, req: null, timer: null, failures: 0
      });
    }

    this._startSpeedMonitoring(task);
    task.workers.forEach((w) => this._workerLoop(task, w));
  }

  _blockLength(task, index) {
    const start = index * task.blockSize;
    return Math.min(task.totalBytes, start + task.blockSize) - start;
  }

  _blockAt(task, index) {
    let b = task.blocks.get(index);
    if (!b) {
      const start = index * task.blockSize;
      const length = this._blockLength(task, index);
      b = { index, start, end: start + length - 1, length, received: 0, fetchers: new Set(), done: false };
      task.blocks.set(index, b);
    }
    return b;
  }

  /** Next block for `worker`: a block that must be redone, else the next one of the file, else (end game) a copy of the slowest. */
  _claim(task, worker) {
    while (task.requeue.length) {
      const b = task.blocks.get(task.requeue.shift());
      if (b && !b.done && b.fetchers.size === 0) return b;
    }
    if (task.nextBlock < task.blockCount) return this._blockAt(task, task.nextBlock++);

    // End game: nothing left to start — help with the block that has the most left, the slow link may still be on it
    let best = null;
    for (const b of task.blocks.values()) {
      if (b.done || b.fetchers.size !== 1 || b.fetchers.has(worker)) continue;
      const remaining = b.length - b.received;
      if (remaining < this.limits.endGameMinBytes) continue;
      if (!best || remaining > best.length - best.received) best = b;
    }
    return best;
  }

  _requeue(task, block) {
    if (block && !block.done && block.fetchers.size === 0 && !task.requeue.includes(block.index)) {
      task.requeue.push(block.index);
    }
  }

  /** Restarts workers that ran out of work, now that a block is waiting again. */
  _wake(task) {
    if (task.state !== 'progressing' || task.isPaused) return;
    for (const w of task.workers) {
      if (w.idle && !w.dead && !w.running && !w.timer) {
        w.idle = false;
        this._workerLoop(task, w);
      }
    }
  }

  async _workerLoop(task, worker) {
    if (worker.dead) return;
    if (worker.running) { worker.restart = true; return; }
    worker.running = true;
    try {
      while (!worker.dead && task.state === 'progressing' && !task.isPaused) {
        const block = this._claim(task, worker);
        if (!block) { worker.idle = true; return; }
        worker.idle = false;

        let failure = null;
        try { failure = await this._fetchBlock(task, worker, block); } catch (e) { failure = e; }
        block.fetchers.delete(worker);
        worker.block = null;
        worker.req = null;

        if (failure && !block.done) {
          this._onWorkerError(task, worker, block, failure);
          return;                                    // the retry timer starts the loop again
        }
        if (!block.done) {                           // given up on purpose (paused, overtaken …)
          this._requeue(task, block);
          this._wake(task);
        }
      }
    } finally {
      worker.running = false;
      if (worker.restart) {
        worker.restart = false;
        setImmediate(() => this._workerLoop(task, worker));
      }
    }
  }

  /**
   * Fetches (the rest of) one block. Resolves null when the block is finished or the fetch was given up on purpose,
   * or with the error when it failed.
   */
  async _fetchBlock(task, worker, block) {
    block.fetchers.add(worker);
    worker.block = block;
    const from = block.start + block.received;

    let res; let req;
    try {
      ({ res, req } = await requestWithRedirects(task.url, {
        method: 'GET',
        timeout: this.limits.socketTimeoutMs,
        localAddress: worker.iface && !worker.iface.failed ? worker.iface.address : undefined,
        onRequest: (r) => { worker.req = r; },
        headers: { ...task.headers, 'Range': `bytes=${from}-${block.end}` }
      }));
    } catch (err) {
      return describeError(err, 'connect');
    }
    worker.req = req;

    if (worker.dead || block.done || task.state !== 'progressing' || task.isPaused) {
      res.resume(); req.destroy();
      return null;
    }

    // The server ignored "Range" and sends the whole file
    if (res.statusCode === 200) {
      if (!task.rangeVerified) {
        const reusable = (block.index === 0 && from === 0) ? { res, req } : null;
        if (reusable) worker.req = null;              // the answer is carried over, it must not be closed here
        else { res.resume(); req.destroy(); }
        this._degradeToSingleStream(task, task.headers, reusable);
        return null;
      }
      res.resume(); req.destroy();
      return new Error('The server stopped honouring byte ranges during the download');
    }
    if (res.statusCode !== 206) {
      res.resume(); req.destroy();
      return new HttpStatusError(res.statusCode);
    }
    const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(res.headers['content-range'] || '');
    if (range) {
      if (Number(range[1]) !== from) {
        res.resume(); req.destroy();
        return new Error('The server sent a different part of the file than the one requested');
      }
      if (range[3] !== '*' && task.totalBytes && Number(range[3]) !== task.totalBytes) {
        res.resume(); req.destroy();
        return Object.assign(new Error('The file on the server has a different size than expected (it may have changed).'), { permanent: true });
      }
    }
    task.rangeVerified = true;

    return new Promise((resolve) => {
      let pos = from;
      let pending = 0;
      let ended = false;
      let settled = false;
      const fd = task.fd;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        // a response that was read to its end leaves its connection to the agent (the next block re-uses it);
        // anything else is cut off
        if (!res.complete) { try { req.destroy(); } catch (_) {} }
        resolve(result);
      };
      const maybeEnd = () => {
        if (settled || pending > 0) return;
        if (block.done) return finish(null);
        if (!ended) return;
        if (block.received >= block.length) return finish(null);
        finish(new Error('The connection closed before the file was complete'));
      };

      res.on('data', (data) => {
        if (settled) return;
        if (worker.dead || block.done || task.state !== 'progressing' || task.isPaused || task.fd !== fd) return finish(null);

        let chunk = data;
        const room = block.end + 1 - pos;                  // never keep what lies beyond this block
        if (chunk.length > room) chunk = chunk.subarray(0, room);
        if (chunk.length === 0) return;
        if (pos + chunk.length <= block.start + block.received) return finish(null);   // another connection is already past here

        res.pause();
        pending++;
        task.pendingWrites++;
        const offset = pos;
        pos += chunk.length;
        fs.write(fd, chunk, 0, chunk.length, offset, (err, written) => {
          pending--;
          task.pendingWrites--;
          if (!err) this._commit(task, worker, block, offset, written);
          this._afterWrite(task);
          if (err) return finish(err);
          if (settled) return;
          if (block.done) return finish(null);
          if (ended) return maybeEnd();
          res.resume();
        });
      });
      res.on('end', () => { ended = true; maybeEnd(); });
      res.on('error', (err) => finish(err));
      res.on('close', () => {
        if (settled) return;
        if (ended) return maybeEnd();
        finish(new Error('The connection was closed before the file was complete'));
      });
    });
  }

  /** Accounts for bytes that reached the disk. A block's `received` is the contiguous part written from its start. */
  _commit(task, worker, block, offset, written) {
    const rel = offset - block.start;
    if (rel > block.received) return;                      // cannot happen (each fetcher writes in order); never count a gap
    const high = rel + written;
    if (high <= block.received) return;
    const gained = high - block.received;
    block.received = high;
    task.receivedBytes += gained;
    task.lastProgressAt = Date.now();
    worker.failures = 0;
    if (worker.iface) {
      worker.iface.receivedBytes += gained;
      worker.iface.failures = 0;
    }
    const region = Math.floor(block.index / task.regionBlocks);
    task.regionNet[region] = worker.iface ? worker.iface : null;
    if (block.received >= block.length && !block.done) this._completeBlock(task, block);
  }

  _completeBlock(task, block) {
    block.done = true;
    task.doneBlocks++;
    task.regionDone[Math.floor(block.index / task.regionBlocks)] += block.length;
    // a second connection that was repeating this block is not needed any more
    for (const w of block.fetchers) {
      if (w.req) { try { w.req.destroy(); } catch (_) {} }
    }
    task.blocks.delete(block.index);
    if (task.doneBlocks >= task.blockCount) this._finishTask(task);
  }

  _onWorkerError(task, worker, block, err) {
    if (worker.dead || block.done || task.state !== 'progressing' || task.isPaused) {
      this._requeue(task, block);
      return;
    }
    err = describeError(err);

    // A refusal before a single byte arrived means nothing will ever work with these headers (expired or
    // session-bound link, untrusted certificate …): fail now instead of retrying until the watchdog gives up.
    if (err.permanent && task.receivedBytes === 0) {
      this._handleError(task, err);
      return;
    }

    // A network that cannot connect is dropped; its workers move to a working one (or to the normal route)
    if (worker.iface && err.phase === 'connect' && NETWORK_DOWN.test(err.code || err.message || '')) {
      worker.iface.failures = (worker.iface.failures || 0) + 1;
      if (worker.iface.failures >= 2 || /EADDRNOTAVAIL|EINVAL/.test(err.code || '')) this._failInterface(task, worker.iface);
    }

    worker.failures++;
    task.lastError = err;
    this._requeue(task, block);

    // The server accepts fewer connections than asked for: this one stops trying, the others carry on
    const others = task.workers.filter((w) => w !== worker && !w.dead && w.failures < 3);
    if (worker.failures >= 5 && task.receivedBytes > 0 && others.length > 0) {
      worker.dead = true;
      this._wake(task);
      return;
    }

    const delay = Math.min(this.limits.retryMaxMs, this.limits.retryBaseMs * Math.pow(2, Math.min(worker.failures - 1, 10)));
    if (worker.timer) clearTimeout(worker.timer);
    worker.timer = setTimeout(() => {
      worker.timer = null;
      this._workerLoop(task, worker);
    }, delay);
    this._wake(task);
  }

  _failInterface(task, iface) {
    if (iface.failed) return;
    iface.failed = true;
    const healthy = task.interfaces.filter((i) => !i.failed);
    task.workers.forEach((w) => {
      if (w.iface === iface) w.iface = healthy.length ? healthy[w.id % healthy.length] : null;
    });
    if (healthy.length < 2) task.isMultiSource = false;
  }

  /** The server does not do ranges: drop the parallel workers and fetch the whole file as one stream. */
  _degradeToSingleStream(task, headers, existing = null) {
    if (task.degraded || task.state !== 'progressing') {
      if (existing) { try { existing.req.destroy(); } catch (_) {} }
      return;
    }
    task.degraded = true;
    this._killWorkers(task);

    task.isTurbo = false;
    task.isMultiSource = false;
    task.threadsCount = 1;
    task.receivedBytes = 0;
    task.lastReceivedBytes = 0;
    task.lastProgressAt = Date.now();
    task.blockCount = 0;
    task.blocks.clear();
    task.requeue = [];
    task.interfaces.forEach((i) => { i.receivedBytes = 0; i.lastReceivedBytes = 0; });
    try { if (task.fd !== null) fs.ftruncateSync(task.fd, 0); } catch (_) {}

    this._startSingleStream(task, headers, existing);
  }

  /** Stops every worker for good (they will not be restarted). */
  _killWorkers(task) {
    for (const w of task.workers) {
      w.dead = true;
      if (w.timer) { clearTimeout(w.timer); w.timer = null; }
      if (w.req) { try { w.req.destroy(); } catch (_) {} }
    }
  }

  // ─────────────────────────────── single stream ───────────────────────────────

  /**
   * Single-stream mode for servers without range support (or an unknown size).
   * @param {object} [existing] an answer that is already open ({res, req})
   */
  async _startSingleStream(task, headers, existing = null) {
    this._startSpeedMonitoring(task);

    const seg = {
      index: 0,
      start: 0,
      end: task.totalBytes ? task.totalBytes - 1 : 0,
      total: task.totalBytes,
      received: 0,
      currentOffset: 0,
      isCompleted: false,
      interfaceName: 'Default',
      interfaceAddress: null,
      req: null
    };
    task.segments = [seg];
    task.single = seg;
    const fd = task.fd;

    try {
      const { res, req } = existing || await requestWithRedirects(task.url, {
        method: 'GET',
        timeout: this.limits.socketTimeoutMs,
        onRequest: (r) => { seg.req = r; },
        headers
      });
      if (seg.dead || task.state !== 'progressing' || task.fd !== fd) { req.destroy(); return; }

      seg.req = req;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        req.destroy();
        throw new HttpStatusError(res.statusCode);
      }

      let settled = false;
      let ended = false;
      let pending = 0;
      const complete = () => {
        if (settled || !ended || pending > 0) return;
        settled = true;
        if (task.totalBytes > 0 && task.receivedBytes < task.totalBytes) {
          return this._handleError(task, new Error('The connection closed before the file was complete'));
        }
        seg.isCompleted = true;
        this._finishTask(task);
      };

      res.on('data', (chunk) => {
        if (settled || seg.dead || task.isPaused || task.state !== 'progressing' || task.fd !== fd) {
          req.destroy();
          return;
        }
        res.pause();
        pending++;
        task.pendingWrites++;
        const offset = task.receivedBytes;
        task.receivedBytes += chunk.length;                  // single stream: bytes arrive and are written in order
        fs.write(fd, chunk, 0, chunk.length, offset, (err) => {
          pending--;
          task.pendingWrites--;
          this._afterWrite(task);
          if (err) {
            if (!settled && task.state === 'progressing') { settled = true; req.destroy(); this._handleError(task, err); }
            return;
          }
          task.lastProgressAt = Date.now();
          seg.received = task.receivedBytes;
          if (settled) return;
          if (ended) return complete();
          res.resume();
        });
      });

      res.on('end', () => { ended = true; complete(); });

      res.on('error', (err) => {
        if (settled || seg.dead || task.state !== 'progressing') return;
        settled = true;
        this._handleError(task, describeError(err));
      });
    } catch (err) {
      if (!seg.dead && task.state === 'progressing') this._handleError(task, describeError(err));
    }
  }

  // ───────────────────────────────── progress ─────────────────────────────────

  /** Bars for the list: slices of the file with what is already there. */
  _segmentsView(task) {
    if (!task.blockCount) {
      return task.segments.map((s) => ({
        index: s.index, start: s.start, end: s.end, received: s.received, total: s.total,
        percent: s.total > 0 ? Math.min(100, Math.round((s.received / s.total) * 100)) : 0,
        isCompleted: s.isCompleted, interfaceName: s.interfaceName, interfaceAddress: s.interfaceAddress
      }));
    }
    const got = task.regionDone.slice();
    for (const b of task.blocks.values()) {
      if (!b.done) got[Math.floor(b.index / task.regionBlocks)] += b.received;
    }
    const out = [];
    for (let k = 0; k < task.regionCount; k++) {
      const start = k * task.regionBlocks * task.blockSize;
      const total = task.regionTotal[k];
      const net = task.regionNet[k];
      out.push({
        index: k, start, end: start + total - 1, received: got[k], total,
        percent: total > 0 ? Math.min(100, Math.round((got[k] / total) * 100)) : 0,
        isCompleted: got[k] >= total,
        interfaceName: net ? net.name : 'Default',
        interfaceAddress: net ? net.address : null
      });
    }
    return out;
  }

  /** Computes speed / ETA and tells the listeners. */
  _emitProgress(task) {
    const now = Date.now();
    const deltaSec = Math.max(0.01, (now - task.lastCalculatedTime) / 1000);
    const deltaBytes = task.receivedBytes - task.lastReceivedBytes;
    task.speed = Math.max(0, Math.round(deltaBytes / deltaSec));
    task.lastCalculatedTime = now;
    task.lastReceivedBytes = task.receivedBytes;

    // Calculate per-interface speeds
    if (task.interfaces && task.interfaces.length > 0) {
      task.interfaces.forEach(iface => {
        const ifaceDelta = iface.receivedBytes - iface.lastReceivedBytes;
        iface.speed = Math.max(0, Math.round(ifaceDelta / deltaSec));
        iface.lastReceivedBytes = iface.receivedBytes;
      });
    }

    const remaining = task.totalBytes - task.receivedBytes;
    task.eta = (task.speed > 0 && remaining > 0) ? Math.ceil(remaining / task.speed) : null;

    const percent = task.totalBytes > 0
      ? Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 100))
      : 0;

    this.emit('progress', {
      id: task.id,
      state: task.state,
      received: task.receivedBytes,
      total: task.totalBytes,
      percent,
      speed: task.speed,
      eta: task.eta,
      isTurbo: task.isTurbo,
      isMultiSource: task.isMultiSource,
      threads: task.threadsCount,
      // the networks in use; without bonding that is the system's normal route
      interfaces: task.interfaces.length
        ? task.interfaces.map(i => ({ name: i.name, address: i.address, speed: i.speed, received: i.receivedBytes, failed: i.failed }))
        : [{ name: 'Default route', address: '', speed: task.speed, received: task.receivedBytes, failed: false }],
      segments: this._segmentsView(task)
    });
  }

  /**
   * Real-time transfer speed calculation and progress event broadcasting.
   * Tracks total speed and per-interface speed. Also the watchdog: a download never sits at "0 B" without a verdict.
   */
  _startSpeedMonitoring(task) {
    if (task.timer) clearInterval(task.timer);

    const emitProgressNow = () => this._emitProgress(task);

    // Emit initial progress immediately on stream start
    emitProgressNow();

    task.timer = setInterval(() => {
      if (task.state !== 'progressing') {
        clearInterval(task.timer);
        return;
      }
      emitProgressNow();

      // Watchdog
      if (task.pendingWrites > 0) task.lastProgressAt = Date.now();     // a busy disk is not a stalled server
      const idleMs = Date.now() - task.lastProgressAt;
      const started = task.receivedBytes > 0;
      const limit = started ? this.limits.stallMs : this.limits.startStallMs;
      if (idleMs > limit) {
        const seconds = Math.round(limit / 1000);
        const detail = task.lastError && task.lastError.message ? ` (${task.lastError.message})` : '';
        const err = new Error(started
          ? `The download stalled: no data arrived for ${seconds} seconds${detail}`
          : `The server did not send any data for ${seconds} seconds${detail}`);
        err.stalled = true;
        this._handleError(task, err);
      } else if (task.blockCount && task.workers.length && task.workers.every((w) => w.dead)) {
        this._handleError(task, task.lastError || new Error('All connections to the server failed'));
      }
    }, 400);
  }

  // ─────────────────────────────── ending a task ───────────────────────────────

  /** Called after every write: closes (and, when asked, deletes) the file once the last write has landed. */
  _afterWrite(task) {
    if (task.pendingWrites === 0 && task.onDrained) {
      const run = task.onDrained;
      task.onDrained = null;
      run();
    }
  }

  /**
   * Closes the target file — after the writes that are still on their way to the disk (an fd that is closed under a
   * queued write can be re-used by another file and receive its data).
   */
  _disposeFile(task, { remove = false } = {}, done = null) {
    const run = () => {
      try { if (task.fd !== null) fs.closeSync(task.fd); } catch (_) {}
      task.fd = null;
      if (remove) { try { if (fs.existsSync(task.workPath)) fs.unlinkSync(task.workPath); } catch (_) {} }
      if (done) done();
    };
    if (task.pendingWrites > 0) task.onDrained = run;
    else run();
  }

  /**
   * Gives the finished part file its final name. Retried for a moment: on Windows a virus scanner may still hold the
   * file that was just closed.
   * @param {function(Error|null)} done
   */
  _commitFile(task, done, attempt = 0) {
    try {
      fs.renameSync(task.workPath, task.savePath);
      return done(null);
    } catch (err) {
      if (attempt >= 15) return done(err);
      setTimeout(() => this._commitFile(task, done, attempt + 1), 150);
    }
  }

  _finishTask(task) {
    if (task.state !== 'progressing') return;
    if (task.totalBytes > 0 && task.blockCount && task.receivedBytes !== task.totalBytes) {
      return this._handleError(task, new Error('The file is incomplete (' + task.receivedBytes + ' of ' + task.totalBytes + ' bytes)'));
    }
    if (task.blockCount === 0 && task.totalBytes === 0) task.totalBytes = task.receivedBytes;
    this._emitProgress(task);                    // the last numbers (100 %) reach the list before "completed"
    task.state = 'completed';
    if (task.timer) clearInterval(task.timer);
    this._killWorkers(task);
    this.activeTasks.delete(task.id);
    // announced once the file is closed and has its final name: the caller may open or move it at once
    this._disposeFile(task, {}, () => {
      this._commitFile(task, (err) => {
        if (err) {
          try { fs.unlinkSync(task.workPath); } catch (_) {}
          return this.emit('error', {
            id: task.id,
            error: 'The finished file could not be saved as "' + path.basename(task.savePath) + '" (' + (err.code || err.message) + ').',
            received: task.receivedBytes,
            status: null,
            stalled: false
          });
        }
        this.emit('completed', {
          id: task.id,
          savePath: task.savePath,
          total: task.totalBytes,
          received: task.receivedBytes,
          isTurbo: task.isTurbo,
          isMultiSource: task.isMultiSource,
          threads: task.threadsCount
        });
      });
    });
  }

  _handleError(task, err) {
    if (task.state === 'interrupted' || task.state === 'cancelled' || task.state === 'completed') return;
    task.state = 'interrupted';
    if (task.timer) clearInterval(task.timer);
    this._killWorkers(task);
    if (task.single) { task.single.dead = true; try { if (task.single.req) task.single.req.destroy(); } catch (_) {} }

    // The engine cannot continue a failed transfer, and a half-written file of the full size looks finished: remove it
    this.activeTasks.delete(task.id);
    this._disposeFile(task, { remove: true }, () => {
      this.emit('error', {
        id: task.id,
        error: (err && err.message) || String(err),
        received: task.receivedBytes,
        status: (err && err.status) || null,
        stalled: Boolean(err && err.stalled)
      });
    });
  }

  /**
   * Pauses an active download. Every byte that arrived is kept; resume() continues exactly there.
   */
  pause(id) {
    const task = this.activeTasks.get(id);
    if (!task || task.state !== 'progressing') return false;

    task.isPaused = true;
    task.state = 'paused';
    if (task.timer) clearInterval(task.timer);

    task.workers.forEach((w) => {
      if (w.timer) { clearTimeout(w.timer); w.timer = null; }
      if (w.req) { try { w.req.destroy(); } catch (_) {} }
    });
    if (task.single && task.single.req) { try { task.single.req.destroy(); } catch (_) {} }

    this.emit('paused', { id });
    return true;
  }

  /**
   * Resumes a paused download.
   */
  resume(id, headers = {}) {
    const task = this.activeTasks.get(id);
    if (!task || task.state !== 'paused') return false;

    if (task.single) {
      // a single stream cannot continue in the middle: start the file again
      task.isPaused = false;
      task.state = 'progressing';
      task.receivedBytes = 0;
      task.lastReceivedBytes = 0;
      task.lastProgressAt = Date.now();
      try { if (task.fd !== null) fs.ftruncateSync(task.fd, 0); } catch (_) {}
      task.single.dead = true;
      this._startSingleStream(task, { ...(task.headers || {}), ...(headers || {}) });
      this.emit('resumed', { id });
      return true;
    }

    task.isPaused = false;
    task.state = 'progressing';
    task.lastProgressAt = Date.now();
    task.headers = { ...(task.headers || {}), ...(headers || {}) };

    if (task.fd === null) {
      task.fd = fs.openSync(task.workPath, 'r+');
    }

    this._startSpeedMonitoring(task);
    task.workers.forEach((w) => {
      if (w.dead) return;
      w.idle = false;
      this._workerLoop(task, w);
    });

    this.emit('resumed', { id });
    return true;
  }

  /**
   * Cancels and deletes incomplete download file.
   */
  cancel(id) {
    const task = this.activeTasks.get(id);
    if (!task) {
      if (this._starting.has(id)) {            // not running yet: make sure it never does
        this._precancelled.add(id);
        this.emit('cancelled', { id });
        return true;
      }
      return false;
    }

    task.state = 'cancelled';
    if (task.timer) clearInterval(task.timer);
    this._killWorkers(task);
    if (task.single) { task.single.dead = true; try { if (task.single.req) task.single.req.destroy(); } catch (_) {} }
    this._disposeFile(task, { remove: true });

    this.emit('cancelled', { id });
    this.activeTasks.delete(task.id);
    return true;
  }
}

TurboDownloadEngine.HttpStatusError = HttpStatusError;
module.exports = TurboDownloadEngine;
