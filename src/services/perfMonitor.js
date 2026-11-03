/**
 * SPEED CHECK — perfMonitor.js (1.5.7)
 *
 * In Electron the browser's own code runs on the thread that also passes every scroll, click and key press on to the
 * pages. Whenever that thread is busy for a moment, the whole browser stutters — while Chrome on the same computer is
 * smooth. This watches that thread and collects what is needed to find the cause on the user's own computer:
 *   - stalls: a timer that should fire every 50 ms notes each time it came late by 100 ms or more (and by how much)
 *   - slow work: known operations of the browser that held the thread for 30 ms or more (disk writes, the ad blocker)
 *   - the graphics card: whether pages are drawn by the GPU or in software (Chromium's own feature status) — software
 *     drawing alone makes scrolling and video stutter
 *   - garbage collection: pauses of the browser's own JavaScript (a big heap pauses longer)
 *   - the browser's processes: how many, their memory and CPU
 * Settings → Performance → Speed check shows it, and "Copy report" puts it on the clipboard as text. Nothing is sent
 * anywhere.
 */
'use strict';

const TICK_MS = 50;
const STALL_MS = 100;
const SLOW_OP_MS = 30;
const KEEP = 20;

class PerfMonitor {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.startedAt = now();
    this.stalls = { count: 0, over250: 0, over1000: 0, totalMs: 0, worst: [] };
    this.slowOps = [];                     // [{ what, ms, at }], slowest first
    this.opCounts = {};                    // what → { count, totalMs, maxMs }
    this.gc = { count: 0, totalMs: 0, maxMs: 0, over50: 0 };
    this._gcObserver = null;
    this._timer = null;
    this._last = 0;
  }

  start() {
    if (this._timer) return;
    this._last = this.now();
    this._timer = setInterval(() => this._tick(), TICK_MS);
    if (this._timer.unref) this._timer.unref();
    try {
      const { PerformanceObserver } = require('perf_hooks');
      this._gcObserver = new PerformanceObserver((list) => { for (const e of list.getEntries()) this.noteGc(e.duration); });
      this._gcObserver.observe({ entryTypes: ['gc'] });
    } catch (_) { this._gcObserver = null; }
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    if (this._gcObserver) { try { this._gcObserver.disconnect(); } catch (_) { /* ignore */ } this._gcObserver = null; }
  }

  /** A garbage collection paused the browser's JavaScript for `ms`. */
  noteGc(ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.gc.count++;
    this.gc.totalMs += ms;
    this.gc.maxMs = Math.max(this.gc.maxMs, ms);
    if (ms >= 50) this.gc.over50++;
  }

  _tick() {
    const t = this.now();
    const late = t - this._last - TICK_MS;
    this._last = t;
    if (late >= STALL_MS) this.noteStall(late, t);
  }

  /** The main thread was held for `ms` (also callable directly, for tests). */
  noteStall(ms, at = this.now()) {
    const s = this.stalls;
    s.count++;
    s.totalMs += ms;
    if (ms >= 250) s.over250++;
    if (ms >= 1000) s.over1000++;
    s.worst.push({ ms: Math.round(ms), at });
    s.worst.sort((a, b) => b.ms - a.ms);
    if (s.worst.length > KEEP) s.worst.length = KEEP;
  }

  /** A known piece of work held the main thread for `ms`. */
  note(what, ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    const name = String(what || 'work').slice(0, 80);
    const c = this.opCounts[name] || (this.opCounts[name] = { count: 0, totalMs: 0, maxMs: 0 });
    c.count++;
    c.totalMs += ms;
    c.maxMs = Math.max(c.maxMs, ms);
    if (ms < SLOW_OP_MS) return;
    this.slowOps.push({ what: name, ms: Math.round(ms), at: this.now() });
    this.slowOps.sort((a, b) => b.ms - a.ms);
    if (this.slowOps.length > KEEP) this.slowOps.length = KEEP;
  }

  /** Runs `fn` and notes how long it took. */
  time(what, fn) {
    const t = this.now();
    try { return fn(); } finally { this.note(what, this.now() - t); }
  }

  /**
   * Everything for the Speed check. `extra`: { gpuStatus, gpuInfo, metrics, tabs, sleepingTabs, extensions, settings,
   * adblock, versions } gathered by the caller (Electron calls).
   */
  report(extra = {}) {
    const minutes = Math.max(1 / 60, (this.now() - this.startedAt) / 60000);
    const metrics = Array.isArray(extra.metrics) ? extra.metrics : [];
    const byType = {};
    for (const m of metrics) {
      const k = m.type || 'other';
      const b = byType[k] || (byType[k] = { count: 0, memoryMB: 0, cpu: 0 });
      b.count++;
      b.memoryMB += Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024);
      b.cpu += Math.round(((m.cpu && m.cpu.percentCPUUsage) || 0) * 10) / 10;
    }
    const gpu = extra.gpuStatus || {};
    const software = ['gpu_compositing', 'rasterization', 'video_decode', 'webgl']
      .filter((k) => typeof gpu[k] === 'string' && !/^enabled/.test(gpu[k]));
    return {
      uptimeMinutes: Math.round(minutes),
      stalls: {
        count: this.stalls.count,
        perMinute: Math.round((this.stalls.count / minutes) * 10) / 10,
        over250ms: this.stalls.over250,
        over1s: this.stalls.over1000,
        totalMs: Math.round(this.stalls.totalMs),
        worst: this.stalls.worst.slice(0, 5).map((w) => w.ms)
      },
      gc: { count: this.gc.count, totalMs: Math.round(this.gc.totalMs), maxMs: Math.round(this.gc.maxMs), over50ms: this.gc.over50, heapMB: extra.heapMB || 0 },
      slowWork: this.slowOps.slice(0, 10).map((o) => ({ what: o.what, ms: o.ms })),
      work: Object.entries(this.opCounts)
        .sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 10)
        .map(([what, c]) => ({ what, count: c.count, totalMs: Math.round(c.totalMs), maxMs: Math.round(c.maxMs) })),
      gpu: { status: gpu, notOnGpu: software, info: extra.gpuInfo || null },
      processes: byType,
      tabs: extra.tabs || 0,
      sleepingTabs: extra.sleepingTabs || 0,
      extensions: extra.extensions || 0,
      adblock: extra.adblock || null,
      settings: extra.settings || {},
      versions: extra.versions || {}
    };
  }
}

/** The report as plain text (what "Copy report" puts on the clipboard). */
function reportText(r) {
  const lines = [];
  lines.push(`SHMMOTH speed check — ${r.versions.app || '?'} (Electron ${r.versions.electron || '?'}, Chromium ${r.versions.chrome || '?'}, ${r.versions.os || '?'})`);
  lines.push(`Running for ${r.uptimeMinutes} min, ${r.tabs} tabs (${r.sleepingTabs} sleeping), ${r.extensions} extensions`);
  lines.push(`Stalls: ${r.stalls.count} (${r.stalls.perMinute}/min), over 250 ms: ${r.stalls.over250ms}, over 1 s: ${r.stalls.over1s}, worst: ${r.stalls.worst.join(', ') || '-'} ms`);
  lines.push(`Garbage collection: ${r.gc.count}× ${r.gc.totalMs} ms, longest ${r.gc.maxMs} ms, over 50 ms: ${r.gc.over50ms}, heap ${r.gc.heapMB} MB`);
  lines.push(`Not on the graphics card: ${r.gpu.notOnGpu.length ? r.gpu.notOnGpu.join(', ') : 'nothing (all on the GPU)'}`);
  if (r.gpu.info) lines.push(`Graphics: ${JSON.stringify(r.gpu.info)}`);
  lines.push('Slow work: ' + (r.slowWork.length ? r.slowWork.map((o) => `${o.what} ${o.ms} ms`).join('; ') : '-'));
  lines.push('Work: ' + (r.work.length ? r.work.map((o) => `${o.what} ×${o.count} (${o.totalMs} ms, max ${o.maxMs})`).join('; ') : '-'));
  lines.push('Processes: ' + Object.entries(r.processes).map(([k, v]) => `${k} ×${v.count} ${v.memoryMB} MB ${v.cpu}%`).join('; '));
  if (r.adblock) lines.push(`Ad blocker: ${JSON.stringify(r.adblock)}`);
  lines.push(`Settings: ${JSON.stringify(r.settings)}`);
  lines.push(`GPU status: ${JSON.stringify(r.gpu.status)}`);
  return lines.join('\n');
}

module.exports = { PerfMonitor, reportText, STALL_MS, SLOW_OP_MS };
