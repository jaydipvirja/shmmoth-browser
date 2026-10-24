/**
 * AUTO STREAMS — streamController.js (1.5.4)
 *
 * How many connections each network runs for one download, decided while it runs. After Plexo (MIT,
 * github.com/anmolkapil/plexo, src/main/download/concurrency.ts), which follows Gopeed, aria2 and Surge: no speed
 * comparisons, so noise on a flaky network cannot move it.
 *
 *   - A network starts with START_STREAMS. Once every one of its streams has received data, it doubles, up to the
 *     limit: another connection costs little when the line is already full, and a server that caps each connection's
 *     speed is only outrun by more of them.
 *   - A server that refuses some of a network's streams (403, 429, 503) while it sends data down others wants fewer
 *     connections from that address: the refused streams close and the network stays at the ones left. After
 *     RECOVER_MS without another refusal it may have one more, and so on back up to the limit.
 *   - A server that refuses while sending nothing is busy or the link is dead: that is waited out or reported by the
 *     engine, and the count stays.
 *   - A disk that cannot keep up (most streams hold data the disk has not taken, while writes still land) holds every
 *     network at half the most any runs, after DISK_PATIENCE_MS; each DISK_RECOVER_MS it keeps up at the cap, the cap
 *     doubles. A hard drive is down to the streams it writes fastest with within seconds.
 *   - Nothing grows while the waiting blocks could not keep another stream busy.
 *
 * Pure: it reads a snapshot (time included) and says what to do, so every rule can be tested exactly. *
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

const START_STREAMS = 4;
const MAX_STREAMS = 16;
const RECOVER_MS = 60 * 1000;
const DISK_PATIENCE_MS = 500;
const DISK_RECOVER_MS = 10 * 1000;
const DISK_STALLED_MS = 500;

/** Whether the disk is what holds a download back, judged by the clock rather than by how often it is looked at. */
class DiskWatch {
  constructor() { this.reading = 'unknown'; this.since = 0; this.landedAt = 0; }

  /** A write reached the disk. */
  landed(now) { this.landedAt = now; }

  /** `writing`: streams fetching a block; `held`: those of them waiting for the disk to take their data. */
  sample(now, writing, held) {
    const reading = writing === 0 ? 'unknown'
      : held * 2 <= writing ? 'keeping-up'
        : now - this.landedAt < DISK_STALLED_MS ? 'behind' : 'unknown';
    if (reading === this.reading) return;
    this.reading = reading;
    this.since = now;
  }
}

class StreamController {
  /**
   * @param {number} maxPerNetwork the most streams a network may run
   */
  constructor(maxPerNetwork = MAX_STREAMS) {
    this.maxPerNetwork = Math.max(1, maxPerNetwork);
    this.ceilings = new Map();             // network → { limit, since }: a server refused there
    this.disk = { cap: null, from: 0 };    // the disk's cap on every network (null: none)
  }

  /**
   * @param {{ now:number, networks:Array<{id:string, streams:number, answered:number, refused:number, served:number}>,
   *           spareWork:number, disk?:{reading:string, since:number} }} snapshot
   * @returns {Array<{kind:'add'|'retire', networkId:string, count:number}>}
   */
  tick(snapshot) {
    const actions = [];
    const { now } = snapshot;
    let spare = snapshot.spareWork;
    this._judgeDisk(snapshot);
    const diskHolds = Boolean(snapshot.disk) && snapshot.disk.reading !== 'keeping-up';
    for (const network of snapshot.networks) {
      const { id, streams } = network;
      const refusedNow = network.refused > 0 && network.served > 0;
      const entry = this.ceilings.get(id);
      if (refusedNow) {
        const limit = Math.max(1, Math.min(streams - network.refused, entry ? entry.limit : Infinity));
        this.ceilings.set(id, { limit, since: now });
      } else if (entry && network.refused === 0 && now - entry.since >= RECOVER_MS) {
        entry.limit++;
        entry.since = now;
        if (entry.limit >= this.maxPerNetwork) this.ceilings.delete(id);
      }
      const ceiling = this.limit(id);
      if (streams > ceiling) {
        actions.push({ kind: 'retire', networkId: id, count: streams - ceiling });
        continue;
      }
      if (network.refused > 0 || diskHolds || streams === 0 || network.answered < streams) continue;
      const count = Math.min(streams, ceiling - streams, spare);
      if (count < 1) continue;
      spare -= count;
      actions.push({ kind: 'add', networkId: id, count });
    }
    return actions;
  }

  /** The most streams a network may run now: the lowest of a server's ceiling and the disk's cap. */
  limit(networkId) {
    const entry = this.ceilings.get(networkId);
    return Math.min(this.maxPerNetwork, entry ? entry.limit : Infinity, this.disk.cap === null ? Infinity : this.disk.cap);
  }

  _judgeDisk({ now, disk, networks }) {
    if (!disk) return;
    const streams = Math.max(0, ...networks.map((n) => n.streams));
    const { cap, from } = this.disk;
    const lasted = now - Math.max(disk.since, from);   // only what was seen since the cap last moved counts
    if (disk.reading === 'behind' && lasted >= DISK_PATIENCE_MS && streams > 1) {
      this.disk.cap = Math.ceil(streams / 2);
    } else if (disk.reading === 'keeping-up' && cap !== null && streams < cap) {
      return;                                          // below the cap says nothing about it
    } else if (disk.reading === 'keeping-up' && cap !== null && lasted >= DISK_RECOVER_MS) {
      this.disk.cap = cap * 2 >= this.maxPerNetwork ? null : cap * 2;
    } else {
      return;
    }
    this.disk.from = now;
  }
}

module.exports = {
  StreamController, DiskWatch,
  START_STREAMS, MAX_STREAMS, RECOVER_MS, DISK_PATIENCE_MS, DISK_RECOVER_MS, DISK_STALLED_MS
};
