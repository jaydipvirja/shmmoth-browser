/**
 * SPEED AND DATA LIMITS — speedLimiter.js (1.5.4, data limits 1.5.5)
 *
 * Speed limits for every download together: a total limit, one per network, and Slow mode (a one-click lower total
 * for calls and video). Data limits per network for a day, a week or a month (a mobile hotspot): what each network
 * used is counted and kept (network-usage.json), and a network that used up its data stops downloading until the next
 * period or until its count is reset. After Plexo (MIT, github.com/anmolkapil/plexo, src/main/network/limits.ts).
 *
 * Every byte the download engine receives passes through take(), with the network it came in on, which says how long
 * to stop reading for. Stopping reading is what slows the sender: TCP's window fills, and it waits.
 *
 * Parts of this file are adapted from Plexo, under the MIT License:
 *   Copyright (c) 2026 Anmol Kapil
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 *   documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 *   the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 *   permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *   The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 *   the Software.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 *   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 *   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
'use strict';

const DEFAULT_SLOW_MODE_SPEED = 512 * 1024;     // bytes per second

/**
 * A rate as a bucket of tokens (bytes) that refills at `rate` per second. Taking more than it holds leaves it in debt,
 * and the debt is the wait. A second's worth is all it ever holds, so a quiet spell does not buy a burst over the limit.
 */
class Bucket {
  constructor(rate, now = Date.now()) { this.rate = rate; this.tokens = 0; this.at = now; }

  /** Takes `bytes`, and says how many ms to wait before taking more. */
  take(bytes, now) {
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    this.tokens -= bytes;
    return this.tokens >= 0 ? 0 : (-this.tokens / this.rate) * 1000;
  }
}

/** The bucket for `rate` bytes a second: `current` changed in place (a debt carries over), or none for no limit. */
function adjust(current, rate, now) {
  if (!(Number(rate) > 0)) return null;
  if (!current) return new Bucket(Number(rate), now);
  current.rate = Number(rate);
  return current;
}

const PERIODS = ['day', 'week', 'month'];
const USAGE_SAVE_MS = 10 * 1000;

/** The calendar period `time` falls in, as a key: '2026-10-25', '2026-W43' (weeks start on Monday), '2026-10'. */
function periodKey(period, time) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  if (period === 'day') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === 'week') {
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}/w`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

class SpeedLimiter {
  /**
   * @param {object} [o]
   * @param {Function} [o.now]
   * @param {Function} [o.defaultNetwork] the name of the network the normal route uses ('' when it cannot be told), so
   *        a download that is not split over networks is counted and limited on the network it really uses
   * @param {{load:Function, save:Function}} [o.store] where the data used is kept (network-usage.json)
   * @param {Function} [o.onLimitReached] told (with the network's name) when a network used up its data
   */
  constructor({ now = () => Date.now(), defaultNetwork = () => '', store = null, onLimitReached = null } = {}) {
    this.now = now;
    this.defaultNetwork = defaultNetwork;
    this.store = store;
    this.onLimitReached = onLimitReached;
    this.total = null;
    this.perNetwork = new Map();
    this.dataLimits = new Map();          // network → { bytes, period }
    this.usage = {};                      // period → { key, bytes: { network: n } }
    for (const p of PERIODS) this.usage[p] = { key: periodKey(p, now()), bytes: {} };
    this._saveTimer = null;
    this._load();
  }

  /**
   * Takes up the limits of the settings: downloadSpeedLimit (bytes/s, 0 = none), downloadSlowMode +
   * downloadSlowModeSpeed (stands in for the total while on), downloadNetworkLimits ({ networkName: bytes/s }),
   * downloadDataLimits ({ networkName: { bytes, period: 'day' | 'week' | 'month' } }).
   */
  configure(settings = {}) {
    const total = settings.downloadSlowMode
      ? (Number(settings.downloadSlowModeSpeed) > 0 ? Number(settings.downloadSlowModeSpeed) : DEFAULT_SLOW_MODE_SPEED)
      : settings.downloadSpeedLimit;
    this.total = adjust(this.total, total, this.now());
    const per = settings.downloadNetworkLimits && typeof settings.downloadNetworkLimits === 'object' ? settings.downloadNetworkLimits : {};
    for (const id of new Set([...this.perNetwork.keys(), ...Object.keys(per)])) {
      const bucket = adjust(this.perNetwork.get(id) || null, per[id], this.now());
      if (bucket) this.perNetwork.set(id, bucket);
      else this.perNetwork.delete(id);
    }
    this.dataLimits.clear();
    const data = settings.downloadDataLimits && typeof settings.downloadDataLimits === 'object' ? settings.downloadDataLimits : {};
    for (const [id, v] of Object.entries(data)) {
      const bytes = Number(v && v.bytes);
      if (bytes > 0) this.dataLimits.set(id, { bytes, period: PERIODS.includes(v.period) ? v.period : 'month' });
    }
  }

  /** Is any speed limit in force? */
  get active() { return Boolean(this.total) || this.perNetwork.size > 0; }

  /** The network a byte that came in on `networkId` is counted on: the normal route ('') is the default network. */
  resolve(networkId) {
    if (networkId) return networkId;
    try { return this.defaultNetwork() || ''; } catch (_) { return ''; }
  }

  /** Counts `bytes` just received on `networkId` (a network's name, '' for the normal route); ms to stop reading for. */
  take(networkId, bytes) {
    const id = this.resolve(networkId);
    const now = this.now();
    if (id) this._count(id, bytes, now);
    if (!this.active) return 0;
    const a = this.total ? this.total.take(bytes, now) : 0;
    const per = id ? this.perNetwork.get(id) : null;
    const b = per ? per.take(bytes, now) : 0;
    return Math.max(a, b);
  }

  /** Has `networkId` (resolved as in take()) used up its data for its period? */
  limitReached(networkId) {
    const id = this.resolve(networkId);
    const limit = id ? this.dataLimits.get(id) : null;
    if (!limit) return false;
    this._roll(this.now());
    return (this.usage[limit.period].bytes[id] || 0) >= limit.bytes;
  }

  /** What each network used in the period its limit counts (the month when it has none): { name: bytes }. */
  used() {
    this._roll(this.now());
    const out = {};
    const names = new Set([...PERIODS.flatMap((p) => Object.keys(this.usage[p].bytes)), ...this.dataLimits.keys()]);
    for (const id of names) out[id] = this.usage[(this.dataLimits.get(id) || { period: 'month' }).period].bytes[id] || 0;
    return out;
  }

  /** Starts the network's current period again (the other periods keep what they counted). */
  resetUsage(networkId) {
    this._roll(this.now());
    const period = (this.dataLimits.get(networkId) || { period: 'month' }).period;
    delete this.usage[period].bytes[networkId];
    this.save();
  }

  /** Writes what was used now (on quit; otherwise every 10 s while downloading). */
  save() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (!this.store) return;
    try { this.store.save({ version: 1, periods: this.usage }); } catch (_) { /* kept in memory */ }
  }

  _count(id, bytes, now) {
    this._roll(now);
    const limit = this.dataLimits.get(id);
    const before = limit ? (this.usage[limit.period].bytes[id] || 0) : 0;
    for (const p of PERIODS) this.usage[p].bytes[id] = (this.usage[p].bytes[id] || 0) + bytes;
    if (limit && before < limit.bytes && before + bytes >= limit.bytes && this.onLimitReached) {
      setImmediate(() => { try { this.onLimitReached(id); } catch (_) { /* ignore */ } });
    }
    if (this.store && !this._saveTimer) {
      this._saveTimer = setTimeout(() => this.save(), USAGE_SAVE_MS);
      if (this._saveTimer.unref) this._saveTimer.unref();
    }
  }

  _roll(now) {
    for (const p of PERIODS) {
      const key = periodKey(p, now);
      if (this.usage[p].key !== key) this.usage[p] = { key, bytes: {} };
    }
  }

  _load() {
    if (!this.store) return;
    try {
      const saved = this.store.load();
      if (!saved || saved.version !== 1 || !saved.periods) return;
      for (const p of PERIODS) {
        const e = saved.periods[p];
        if (!e || e.key !== this.usage[p].key || !e.bytes || typeof e.bytes !== 'object') continue;
        for (const [id, n] of Object.entries(e.bytes)) if (Number.isSafeInteger(n) && n >= 0) this.usage[p].bytes[id] = n;
      }
    } catch (_) { /* start counting again */ }
  }
}

module.exports = { SpeedLimiter, Bucket, DEFAULT_SLOW_MODE_SPEED, periodKey };
