/**
 * TURBO DOWNLOAD ENGINE — turboDownloadEngine.js
 *
 * Ultra-fast, multi-threaded, segmented download engine inspired by IDM.
 *
 * CORE CAPABILITIES:
 *   ✓ Multi-Segment Parallel Connections (4 to 32 parallel sockets)
 *   ✓ Multi-Source Internet Bonding (Channel Aggregation across Wi-Fi + LAN + 4G/5G USB)
 *   ✓ Dynamic Network Interface Discovery & localAddress Socket Binding
 *   ✓ Failover Protection (Auto-reassignment if one connection drops)
 *   ✓ HTTP Range Probe & Accept-Ranges detection
 *   ✓ Direct Sparse File Writing (fs.write at byte positions — 0 merge delay!)
 *   ✓ Dynamic Speed & ETA Calculation with Smooth Moving Average
 *   ✓ Pause & Resume with byte-accurate state tracking
 *   ✓ Per-segment visualizer metrics for IDM-style progress bars
 *   ✓ Automatic graceful fallback to single-stream if range requests unsupported
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

/**
 * Follows HTTP redirects to get final headers or stream.
 * Supports socket binding to specific localAddress (network interface).
 */
function requestWithRedirects(targetUrl, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many HTTP redirects'));

    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const reqOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
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
        const nextUrl = new URL(res.headers.location, targetUrl).toString();
        return requestWithRedirects(nextUrl, options, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }
      resolve({ res, finalUrl: targetUrl, req });
    });

    req.setTimeout(options.timeout || 20000, () => {
      req.destroy(new Error('ETIMEDOUT: Socket connection timed out'));
    });

    req.on('error', (err) => {
      // If localAddress binding failed (e.g. EINVAL / EADDRNOTAVAIL on Windows dual-stack), retry without localAddress
      if (reqOptions.localAddress && /EINVAL|EADDRNOTAVAIL/i.test(err.code || err.message)) {
        const fallbackOpts = { ...options, localAddress: undefined };
        return requestWithRedirects(targetUrl, fallbackOpts, maxRedirects)
          .then(resolve)
          .catch(reject);
      }
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
   * @param {number} [options.minTurboSize=2097152] (2 MB minimum)
   * @param {boolean} [options.multiSource=true]
   */
  constructor(options = {}) {
    super();
    this.defaultThreads = options.defaultThreads || 8;
    this.minTurboSize = options.minTurboSize || (2 * 1024 * 1024); // 2 MB minimum for turbo
    this.multiSourceEnabled = options.multiSource !== false;
    this.activeTasks = new Map();
  }

  /**
   * Discovers all active physical and reachable IPv4 network interfaces on the system.
   * Useful for Multi-Source Internet Bonding (Wi-Fi + LAN + 4G/5G USB Tethering).
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
          const isVirtual = /vEthernet|VirtualBox|VMware|WSL|Tailscale|ZeroTier/i.test(name);
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
   * Tests whether an interface with the specified localAddress has live internet connectivity.
   * Uses a fast TCP handshake to 1.1.1.1:53 with a 1500ms timeout.
   * @param {string} ip
   * @param {number} [timeoutMs=1500]
   * @returns {Promise<boolean>}
   */
  static checkInterfaceOnline(ip, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const s = net.createConnection({
        host: '1.1.1.1',
        port: 53,
        localAddress: ip
      }, () => {
        s.destroy();
        resolve(true);
      });
      s.setTimeout(timeoutMs, () => {
        s.destroy();
        resolve(false);
      });
      s.on('error', () => {
        s.destroy();
        resolve(false);
      });
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
   * Probes remote server to check for range support, file size, and final URL.
   * @param {string} url
   * @param {object} [headers]
   * @returns {Promise<{ acceptsRanges: boolean, totalBytes: number, finalUrl: string, filename: string }>}
   */
  async probe(url, headers = {}) {
    try {
      // First attempt a range test request for byte 0-0
      const { res, finalUrl, req } = await requestWithRedirects(url, {
        method: 'GET',
        headers: {
          ...headers,
          'Range': 'bytes=0-0'
        }
      });

      req.destroy(); // We only needed headers

      const statusCode = res.statusCode;
      const contentRange = res.headers['content-range'] || '';
      const acceptRanges = res.headers['accept-ranges'] || '';
      let totalBytes = 0;
      let acceptsRanges = false;

      // 206 Partial Content means server supports byte ranges
      if (statusCode === 206) {
        acceptsRanges = true;
        const match = contentRange.match(/\/(\d+|\*)$/);
        if (match && match[1] !== '*') {
          totalBytes = parseInt(match[1], 10);
        }
      } else if (statusCode === 200) {
        // Server returned full file or doesn't support ranges
        if (acceptRanges.toLowerCase() === 'bytes') {
          acceptsRanges = true;
        }
        totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      }

      // Extract filename if Content-Disposition exists
      let filename = '';
      const disposition = res.headers['content-disposition'];
      if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1]);
        }
      }
      if (!filename) {
        try {
          filename = path.basename(new URL(finalUrl).pathname) || 'download';
        } catch (_) {
          filename = 'download';
        }
      }

      return {
        acceptsRanges,
        totalBytes,
        finalUrl,
        filename
      };
    } catch (err) {
      return {
        acceptsRanges: false,
        totalBytes: 0,
        finalUrl: url,
        filename: path.basename(new URL(url).pathname) || 'download'
      };
    }
  }

  /**
   * Starts a download. Automatically splits into parallel threads if range supported
   * and aggregates multiple internet connections if available.
   *
   * @param {object} taskOpts
   * @param {string} taskOpts.id
   * @param {string} taskOpts.url
   * @param {string} taskOpts.savePath
   * @param {number} [taskOpts.threads]
   * @param {number} [taskOpts.totalBytes]
   * @param {object} [taskOpts.headers]
   * @param {boolean} [taskOpts.multiSource]
   */
  async start(taskOpts) {
    const { id, url, savePath, headers = {} } = taskOpts;
    const threadsCount = taskOpts.threads || this.defaultThreads;
    const multiSourceRequested = taskOpts.multiSource !== undefined ? taskOpts.multiSource : this.multiSourceEnabled;

    let probeInfo = { acceptsRanges: true, totalBytes: taskOpts.totalBytes || 0, finalUrl: url, filename: '' };
    if (!taskOpts.totalBytes) {
      try {
        probeInfo = await this.probe(url, headers);
      } catch (_) {}
    }
    const totalBytes = taskOpts.totalBytes || probeInfo.totalBytes || 0;
    const finalUrl = probeInfo.finalUrl || url;
    const isTurboEligible = (probeInfo.acceptsRanges !== false) && totalBytes >= this.minTurboSize;

    // Detect available network interfaces with live internet connectivity for Multi-WAN bonding
    let availableInterfaces = [];
    try {
      availableInterfaces = await TurboDownloadEngine.getAvailableNetworkInterfacesAsync(1200);
    } catch (_) {
      availableInterfaces = TurboDownloadEngine.getAvailableNetworkInterfaces();
    }
    const onlineInterfaces = availableInterfaces.filter(i => i.isOnline !== false);
    const usableInterfaces = onlineInterfaces.length > 0 ? onlineInterfaces : availableInterfaces;
    const canUseMultiSource = multiSourceRequested && usableInterfaces.length > 1;

    const task = {
      id,
      url: finalUrl,
      savePath,
      totalBytes,
      receivedBytes: 0,
      state: 'progressing',
      isPaused: false,
      isTurbo: isTurboEligible,
      isMultiSource: canUseMultiSource,
      threadsCount: isTurboEligible ? threadsCount : 1,
      segments: [],
      interfaces: usableInterfaces.map(iface => ({
        name: iface.name,
        address: iface.address,
        receivedBytes: 0,
        lastReceivedBytes: 0,
        speed: 0,
        failed: false
      })),
      speed: 0,
      eta: null,
      fd: null,
      lastCalculatedTime: Date.now(),
      lastReceivedBytes: 0,
      timer: null
    };
    task.headers = headers;

    this.activeTasks.set(id, task);

    // Ensure target folder exists
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open target file for random access sparse writing (w+)
    task.fd = fs.openSync(savePath, 'w+');

    if (isTurboEligible) {
      this._startMultiSegment(task, threadsCount, headers);
    } else {
      this._startSingleStream(task, headers);
    }

    return task;
  }

  /**
   * Multi-segmented parallel download implementation with interface distribution.
   */
  _startMultiSegment(task, numThreads, headers) {
    const { totalBytes } = task;
    const chunkSize = Math.floor(totalBytes / numThreads);
    task.segments = [];

    const activeIfaces = task.interfaces.filter(i => !i.failed);
    const isBonding = Boolean(task.isMultiSource && activeIfaces.length > 1);

    for (let i = 0; i < numThreads; i++) {
      const start = i * chunkSize;
      const end = (i === numThreads - 1) ? totalBytes - 1 : ((i + 1) * chunkSize - 1);

      // Assign round-robin to network interfaces ONLY if multi-source bonding is active (2+ interfaces)
      const assignedIface = isBonding
        ? activeIfaces[i % activeIfaces.length]
        : (activeIfaces[0] || null);

      task.segments.push({
        index: i,
        start,
        end,
        total: (end - start + 1),
        received: 0,
        currentOffset: start,
        isCompleted: false,
        interfaceName: assignedIface ? assignedIface.name : 'Default',
        interfaceAddress: (isBonding && assignedIface) ? assignedIface.address : null,
        req: null
      });
    }

    this._startSpeedMonitoring(task);

    // Launch each parallel segment stream
    task.segments.forEach(seg => {
      this._downloadSegment(task, seg, headers);
    });
  }

  /**
   * Downloads an individual segment stream bound to an interface localAddress.
   */
  async _downloadSegment(task, seg, headers) {
    if (seg.received >= seg.total || task.isPaused || task.state !== 'progressing') {
      return;
    }

    const rangeHeader = `bytes=${seg.currentOffset}-${seg.end}`;

    try {
      const reqOpts = {
        method: 'GET',
        headers: {
          ...headers,
          'Range': rangeHeader
        }
      };

      // Apply socket interface binding if assigned
      if (seg.interfaceAddress) {
        reqOpts.localAddress = seg.interfaceAddress;
      }

      const { res, req } = await requestWithRedirects(task.url, reqOpts);
      seg.req = req;

      // If server does not support ranges and sends full file (200 OK) on segment 0
      if (res.statusCode === 200 && seg.index === 0) {
        task.isTurbo = false;
        task.isMultiSource = false;
        task.threadsCount = 1;
        task.segments.slice(1).forEach(s => {
          if (s.req) { try { s.req.destroy(); } catch (_) {} }
          s.isCompleted = true;
        });
        seg.end = task.totalBytes ? task.totalBytes - 1 : 0;
        seg.total = task.totalBytes;
      }

      res.on('data', (chunk) => {
        if (task.isPaused || task.state !== 'progressing') {
          req.destroy();
          return;
        }

        // Direct Positional File Writing (Sparse Write — 0 merge delay!)
        try {
          fs.writeSync(task.fd, chunk, 0, chunk.length, seg.currentOffset);
          seg.currentOffset += chunk.length;
          seg.received += chunk.length;
          task.receivedBytes += chunk.length;

          // Track per-interface bytes
          if (seg.interfaceAddress) {
            const iface = task.interfaces.find(i => i.address === seg.interfaceAddress);
            if (iface) {
              iface.receivedBytes += chunk.length;
            }
          }
        } catch (writeErr) {
          req.destroy();
          this._handleError(task, writeErr);
          return;
        }
      });

      res.on('end', () => {
        seg.isCompleted = true;
        this._checkTaskCompletion(task);
      });

      res.on('error', (err) => {
        if (!task.isPaused && task.state === 'progressing') {
          this._handleSegmentError(task, seg, headers, err);
        }
      });

    } catch (err) {
      if (!task.isPaused && task.state === 'progressing') {
        this._handleSegmentError(task, seg, headers, err);
      }
    }
  }

  /**
   * Handles segment network errors with interface failover protection.
   */
  _handleSegmentError(task, seg, headers, err) {
    if (seg.received >= seg.total || task.isPaused || task.state !== 'progressing') {
      return;
    }

    // Check if error is related to network interface drop (e.g. cable unplugged, tethering lost)
    if (seg.interfaceAddress) {
      const iface = task.interfaces.find(i => i.address === seg.interfaceAddress);
      if (iface) {
        // Mark interface suspect on connection-level socket errors
        const isIfaceDrop = /EADDRNOTAVAIL|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ETIMEDOUT/i.test(err.code || err.message || '');
        if (isIfaceDrop) {
          iface.failed = true;
          // Reassign segment to another healthy interface or default route
          const survivingIface = task.interfaces.find(i => !i.failed && i.address !== seg.interfaceAddress);
          if (survivingIface) {
            seg.interfaceName = survivingIface.name;
            seg.interfaceAddress = survivingIface.address;
          } else {
            // Fall back to OS default routing
            seg.interfaceName = 'Default';
            seg.interfaceAddress = null;
          }
        }
      }
    }

    // Retry downloading remainder of this chunk
    setTimeout(() => {
      if (!task.isPaused && task.state === 'progressing' && !seg.isCompleted) {
        this._downloadSegment(task, seg, headers);
      }
    }, 1000);
  }

  /**
   * Single-stream fallback for servers without range support.
   */
  async _startSingleStream(task, headers) {
    this._startSpeedMonitoring(task);

    task.segments = [{
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
    }];

    try {
      const { res, req } = await requestWithRedirects(task.url, {
        method: 'GET',
        headers
      });

      task.segments[0].req = req;

      res.on('data', (chunk) => {
        if (task.isPaused || task.state !== 'progressing') {
          req.destroy();
          return;
        }
        try {
          fs.writeSync(task.fd, chunk, 0, chunk.length, task.receivedBytes);
          task.receivedBytes += chunk.length;
          task.segments[0].received = task.receivedBytes;
        } catch (writeErr) {
          req.destroy();
          this._handleError(task, writeErr);
        }
      });

      res.on('end', () => {
        task.segments[0].isCompleted = true;
        this._checkTaskCompletion(task);
      });

      res.on('error', (err) => {
        this._handleError(task, err);
      });
    } catch (err) {
      this._handleError(task, err);
    }
  }

  /**
   * Real-time transfer speed calculation and progress event broadcasting.
   * Tracks total speed and per-interface speed.
   */
  _startSpeedMonitoring(task) {
    if (task.timer) clearInterval(task.timer);

    const emitProgressNow = () => {
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
        interfaces: task.interfaces.map(i => ({
          name: i.name,
          address: i.address,
          speed: i.speed,
          received: i.receivedBytes,
          failed: i.failed
        })),
        segments: task.segments.map(s => ({
          index: s.index,
          start: s.start,
          end: s.end,
          received: s.received,
          total: s.total,
          percent: s.total > 0 ? Math.min(100, Math.round((s.received / s.total) * 100)) : 0,
          isCompleted: s.isCompleted,
          interfaceName: s.interfaceName,
          interfaceAddress: s.interfaceAddress
        }))
      });
    };

    // Emit initial progress immediately on stream start
    emitProgressNow();

    task.timer = setInterval(() => {
      if (task.state !== 'progressing') {
        clearInterval(task.timer);
        return;
      }
      emitProgressNow();
    }, 400);
  }

  _checkTaskCompletion(task) {
    const allDone = task.segments.every(s => s.isCompleted);
    if (allDone) {
      task.state = 'completed';
      if (task.timer) clearInterval(task.timer);

      try {
        if (task.fd) fs.closeSync(task.fd);
        task.fd = null;
      } catch (_) {}

      this.emit('completed', {
        id: task.id,
        savePath: task.savePath,
        total: task.totalBytes,
        received: task.receivedBytes,
        isTurbo: task.isTurbo,
        isMultiSource: task.isMultiSource,
        threads: task.threadsCount
      });

      this.activeTasks.delete(task.id);
    }
  }

  _handleError(task, err) {
    task.state = 'interrupted';
    if (task.timer) clearInterval(task.timer);

    try {
      if (task.fd) fs.closeSync(task.fd);
      task.fd = null;
    } catch (_) {}

    this.emit('error', {
      id: task.id,
      error: err.message || String(err)
    });
  }

  /**
   * Pauses an active download.
   */
  pause(id) {
    const task = this.activeTasks.get(id);
    if (!task || task.state !== 'progressing') return false;

    task.isPaused = true;
    task.state = 'paused';
    if (task.timer) clearInterval(task.timer);

    task.segments.forEach(s => {
      if (s.req) {
        try { s.req.destroy(); } catch (_) {}
      }
    });

    this.emit('paused', { id });
    return true;
  }

  /**
   * Resumes a paused download.
   */
  resume(id, headers = {}) {
    const task = this.activeTasks.get(id);
    if (!task || task.state !== 'paused') return false;

    task.isPaused = false;
    task.state = 'progressing';

    if (!task.fd) {
      task.fd = fs.openSync(task.savePath, 'r+');
    }

    const effectiveHeaders = {
      ...(task.headers || {}),
      ...(headers || {})
    };

    this._startSpeedMonitoring(task);

    task.segments.forEach(s => {
      if (!s.isCompleted) {
        this._downloadSegment(task, s, effectiveHeaders);
      }
    });

    this.emit('resumed', { id });
    return true;
  }

  /**
   * Cancels and deletes incomplete download file.
   */
  cancel(id) {
    const task = this.activeTasks.get(id);
    if (!task) return false;

    task.state = 'cancelled';
    if (task.timer) clearInterval(task.timer);

    task.segments.forEach(s => {
      if (s.req) {
        try { s.req.destroy(); } catch (_) {}
      }
    });

    try {
      if (task.fd) fs.closeSync(task.fd);
      task.fd = null;
    } catch (_) {}

    try {
      if (fs.existsSync(task.savePath)) {
        fs.unlinkSync(task.savePath);
      }
    } catch (_) {}

    this.emit('cancelled', { id });
    this.activeTasks.delete(id);
    return true;
  }
}

module.exports = TurboDownloadEngine;
