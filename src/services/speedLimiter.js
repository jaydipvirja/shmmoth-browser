/**
 * SPEED LIMITS — speedLimiter.js (1.5.4)
 *
 * Speed limits for every download together: a total limit, one per network, and Slow mode (a one-click lower total
 * for calls and video). After Plexo (MIT, github.com/anmolkapil/plexo, src/main/network/limits.ts).
 *
 * Every byte the download engine receives passes through take(), with the network it came in on, which says how long
 * to stop reading for. Stopping reading is what slows the sender: TCP's window fills, and it waits. *
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

class SpeedLimiter {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.total = null;
    this.perNetwork = new Map();
  }

  /**
   * Takes up the limits of the settings: downloadSpeedLimit (bytes/s, 0 = none), downloadSlowMode +
   * downloadSlowModeSpeed (stands in for the total while on), downloadNetworkLimits ({ networkName: bytes/s }).
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
  }

  /** Is any limit in force? */
  get active() { return Boolean(this.total) || this.perNetwork.size > 0; }

  /** Counts `bytes` just received on `networkId` (a network's name, '' for the normal route); ms to stop reading for. */
  take(networkId, bytes) {
    if (!this.active) return 0;
    const now = this.now();
    const a = this.total ? this.total.take(bytes, now) : 0;
    const per = networkId ? this.perNetwork.get(networkId) : null;
    const b = per ? per.take(bytes, now) : 0;
    return Math.max(a, b);
  }
}

module.exports = { SpeedLimiter, Bucket, DEFAULT_SLOW_MODE_SPEED };
