/**
 * POP-UP POLICY — decides whether a page may open a new window / tab with window.open().
 *
 * Until now every window.open() became a new tab, so pop-ups and pop-unders from ad networks (the typical annoyance of
 * video and download sites) opened without limit. The rules, in order — all of them only while the ad blocker is in
 * force for the page (pausing it on a site lets that site open what it wants):
 *   1. the target is an ad / tracker address on the filter lists            → refused
 *   2. the page opens it from a background tab (a pop-under)                → refused
 *   3. no real click or key press happened on the tab in the last 5 s       → refused (Chrome's "transient activation")
 *   4. more than 3 windows in 10 s from the same tab                        → refused
 * Rule 3 relies on a small preload script (preload-gesture.js) that reports only trusted input events; it is applied
 * only to tabs from which that script has reported in (so a missing script can never block every pop-up).
 *
 * Switch: Settings → Ad-Blocker & Privacy → "Block pop-ups and pop-unders".
 */

'use strict';

const GESTURE_WINDOW_MS = 5000;
const BURST_WINDOW_MS = 10000;
const BURST_LIMIT = 3;

class PopupPolicy {
  /**
   * @param {object} deps
   * @param {object} deps.adBlocker      needs isActiveFor(host) and matchPopup(url, openerUrl); noteBlockedPopup() optional
   * @param {Function} deps.getSettings  () => settings
   * @param {Function} [deps.now]
   */
  constructor({ adBlocker, getSettings, now = Date.now }) {
    this.adBlocker = adBlocker;
    this.getSettings = getSettings;
    this.now = now;
    this.lastGesture = new Map();       // webContents id → time of the last trusted click / key press
    this.reported = new Set();          // webContents ids whose gesture script has reported in
    this.opened = new Map();            // webContents id → times of recent allowed pop-ups
  }

  /** The gesture script of a tab is running. */
  noteReady(wcId) { this.reported.add(wcId); }

  /** A trusted click / key press happened in the tab (any frame). */
  noteGesture(wcId) { this.reported.add(wcId); this.lastGesture.set(wcId, this.now()); }

  forget(wcId) { this.lastGesture.delete(wcId); this.reported.delete(wcId); this.opened.delete(wcId); }

  /**
   * @param {{ wcId: number, url: string, openerUrl: string, openerIsActive: boolean }} p
   * @returns {{ allow: boolean, reason?: string }}
   */
  decide({ wcId, url, openerUrl, openerIsActive }) {
    const settings = this.getSettings() || {};
    if (settings.popupBlockerEnabled === false) return { allow: true };

    // Only web pages are judged: the browser's own pages (mtc://, file://) open what they need
    let host = '';
    try { const u = new URL(openerUrl); if (u.protocol === 'http:' || u.protocol === 'https:') host = u.hostname; } catch (_) { /* no address */ }
    if (!host || !this.adBlocker || !this.adBlocker.isActiveFor(host)) return { allow: true };

    if (this.adBlocker.matchPopup(url, openerUrl)) return { allow: false, reason: 'ad address' };
    if (openerIsActive === false) return { allow: false, reason: 'opened by a background tab' };

    const t = this.now();
    if (this.reported.has(wcId) && t - (this.lastGesture.get(wcId) || 0) > GESTURE_WINDOW_MS) {
      return { allow: false, reason: 'no click or key press' };
    }

    const recent = (this.opened.get(wcId) || []).filter((x) => t - x < BURST_WINDOW_MS);
    if (recent.length >= BURST_LIMIT) { this.opened.set(wcId, recent); return { allow: false, reason: 'too many at once' }; }
    recent.push(t);
    this.opened.set(wcId, recent);
    return { allow: true };
  }
}

PopupPolicy.GESTURE_WINDOW_MS = GESTURE_WINDOW_MS;
module.exports = PopupPolicy;
