// Ad & Tracker Blocker for SHMMOTH BROWSER
//
// Engine: Ghostery's adblocker (the Brave-style Rust-free engine behind the Ghostery extension), fed with EasyList,
// EasyPrivacy, uBlock Origin's lists and AdGuard Base + Popups (services/filterLists.js). It does four things:
//   1. network blocking     - requests to ad / tracker hosts are cancelled (webRequest)
//   2. element hiding       - empty ad slots, banners and overlays are hidden (cosmetic filters)
//   3. scriptlets           - uBlock Origin's page scripts that defuse pop-ups, anti-adblock walls and in-page ads
//   4. pop-up matching      - a window.open() to an ad host can be refused before the tab exists (matchPopup)
// Until the lists are available a short built-in list of the biggest ad networks is in force.
const fs   = require('fs');
const path = require('path');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const filterLists = require('./filterLists');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_CHECK_MS = 6 * 60 * 60 * 1000;
const MAX_PAUSED_SITES = 500;
const MAX_CUSTOM_FILTER_LINES = 5000;
const MAX_CUSTOM_FILTER_LINE = 1000;
const META_VERSION = 2;
const DOWNLOAD_CONCURRENCY = 4;
const GIVE_UP_AFTER_FAILED_LISTS = 4;           // this many lists in a row without any answer = offline, stop trying
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** What the engine is built with: network + cosmetic filters + scriptlets. */
const ENGINE_CONFIG = Object.freeze({
  loadNetworkFilters: true,
  loadCosmeticFilters: true,
  loadGenericCosmeticsFilters: true,
  enableMutationObserver: true
});

const COSMETIC_CHANNEL = '@ghostery/adblocker/inject-cosmetic-filters';
const MUTATION_CHANNEL = '@ghostery/adblocker/is-mutation-observer-enabled';

/** Hosts of the biggest ad networks: in force while the real lists are not available, and a last resort for pop-ups. */
const FALLBACK_DOMAINS = Object.freeze([
  'doubleclick.net',
  'googleads.g.doubleclick.net',
  'pagead2.googlesyndication.com',
  'adservice.google.com',
  'ads.pubmatic.com',
  'adnxs.com',
  'criteo.com',
  'taboola.com',
  'outbrain.com',
  'popads.net',
  'propellerads.com'
]);

/** Lower-case host name without a leading "www." or trailing dot; '' when it is not a plain host name / IPv4 address. */
function normalizeHost(input) {
  if (typeof input !== 'string') return '';
  const h = input.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return HOST.test(h) ? h : '';
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch (_) { return ''; }
}

/** The user's own filter lines ("My filters"): trimmed, no empty lines, bounded. */
function parseCustomFilters(text) {
  if (typeof text !== 'string') return [];
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length > MAX_CUSTOM_FILTER_LINE) continue;
    lines.push(line);
    if (lines.length >= MAX_CUSTOM_FILTER_LINES) break;
  }
  return lines;
}

/**
 * Lists are fetched with Electron's net.fetch: unlike Node's http it follows the browser's proxy setting and trusts the
 * operating system's certificate store (corporate / antivirus root CAs), which Node-side requests do not.
 * (Resolved lazily so the module can be loaded without Electron, e.g. in unit tests.)
 */
const electronFetch = (...args) => require('electron').net.fetch(...args);

class AdBlockerService {
  /**
   * @param {object} storageService
   * @param {object} [options]
   * @param {string} [options.cacheFile]  where the compiled filter engine is kept between runs (none = nothing is kept)
   * @param {string} [options.listsDir]   where the downloaded lists are kept (default: next to the engine file)
   * @param {Function} [options.fetch]    fetch implementation (default: Electron net.fetch)
   * @param {number} [options.ttlMs]      how long downloaded lists are used before they are downloaded again
   * @param {Function} [options.preloadPath] returns the path of the cosmetic-filter preload script
   */
  constructor(storageService, options = {}) {
    this.storage = storageService;
    this.cacheFile = options.cacheFile || null;
    this.listsDir = options.listsDir || (this.cacheFile ? this.cacheFile.replace(/\.bin$/i, '') + '-lists' : null);
    this.metaFile = this.cacheFile ? this.cacheFile.replace(/\.bin$/i, '') + '.json' : null;
    this._fetch = options.fetch || electronFetch;
    this.cacheTtlMs = options.ttlMs || CACHE_TTL_MS;
    this._preloadPath = options.preloadPath || defaultPreloadPath;
    // Sites where the user paused the blocker ("Ad blocker on this site: off"). Matches the host and its subdomains.
    this._paused = new Set();
    this.reloadAllowlist();
    this.blockedCount = 0;
    this.isEnabled = this.storage.getSettings().adBlockerEnabled ?? true;
    this.blocker = null;
    this._blockerPromise = null;
    // Every session the blocker protects (normal + incognito). Previously a single `this.session`
    // was overwritten when the incognito window opened, so toggling the setting only affected
    // incognito and the normal session could never be switched off again.
    this.sessions = new Set();
    this._cosmeticPreloads = new Map();          // session → id of the registered cosmetic-filter preload script
    this._cosmeticHandlersInstalled = false;
    this._customApplied = [];                    // the user's own filter lines currently in the engine
    this._refreshing = null;
    this._refreshTimer = null;
    this.meta = null;                            // what the current engine was built from (see _writeEngineCache)
    this._lastRefreshError = '';
  }

  // ─── Per-site pause ───────────────────────────────────────────────────────

  /** (Re)reads the paused sites from the saved settings, dropping anything that is not a plain host name. */
  reloadAllowlist() {
    const saved = this.storage.getSettings().adBlockerAllowlist;
    const list = Array.isArray(saved) ? saved : [];
    this._paused = new Set(list.map(normalizeHost).filter(Boolean).slice(0, MAX_PAUSED_SITES));
  }

  getPausedSites() {
    return Array.from(this._paused).sort();
  }

  /** True when the blocker is paused for this host or one of its parent domains (www.a.example.com → example.com). */
  isSitePaused(host) {
    let h = normalizeHost(host);
    if (!h || this._paused.size === 0) return false;
    for (;;) {
      if (this._paused.has(h)) return true;
      const dot = h.indexOf('.');
      if (dot < 0) return false;
      h = h.slice(dot + 1);
    }
  }

  /** Is blocking in force for pages of this host? (the master switch AND not paused for the site) */
  isActiveFor(host) {
    return this.isEnabled && !this.isSitePaused(host);
  }

  /**
   * Pauses (or resumes) the blocker for a site. Resuming a site also removes the parent domain that covered it, so
   * "turn it back on here" always works. @returns {boolean} true when the list changed
   */
  setSitePaused(host, paused) {
    const h = normalizeHost(host);
    if (!h) return false;
    if (paused) {
      if (this.isSitePaused(h) || this._paused.size >= MAX_PAUSED_SITES) return false;
      this._paused.add(h);
    } else {
      let changed = false;
      for (const entry of Array.from(this._paused)) {
        if (h === entry || h.endsWith('.' + entry)) { this._paused.delete(entry); changed = true; }
      }
      if (!changed) return false;
    }
    this.storage.updateSettings({ adBlockerAllowlist: this.getPausedSites() });
    return true;
  }

  /** The address of the page a request belongs to: the tab that issued it, else the referrer. */
  _pageHost(details) {
    try {
      const wc = details && details.webContents;
      const url = (wc && !(wc.isDestroyed && wc.isDestroyed()) && wc.getURL && wc.getURL()) || (details && details.referrer) || '';
      return url ? new URL(url).hostname : '';
    } catch (_) {
      return '';
    }
  }

  _pausedFor(details) {
    return this._paused.size > 0 && this.isSitePaused(this._pageHost(details));
  }

  // ─── Turning the engine on / off for a session ────────────────────────────

  /**
   * Runs `fn` with the engine's own cosmetic-filter registration switched off. The engine would register its preload
   * script and a global ipcMain handler for EVERY session it is enabled in (the second registration throws), and its
   * handler cannot know about paused sites. Both are done here instead (see _registerCosmetic).
   */
  _withoutEngineCosmeticRegistration(blocker, fn) {
    const saved = blocker.config.loadCosmeticFilters;
    blocker.config.loadCosmeticFilters = false;
    try { return fn(); } finally { blocker.config.loadCosmeticFilters = saved; }
  }

  /**
   * Turns the engine on for a session. The engine registers its own webRequest listeners; they are replaced by thin
   * wrappers that let requests of paused sites through untouched and hand everything else to the engine.
   */
  /**
   * Google sign-in is a security-sensitive flow: never let the general ad/tracker filter
   * cancel the authentication document or its authentication-only supporting resources.
   * Google search/YouTube pages outside an auth flow remain subject to normal blocking.
   */
  _isGoogleAuthRequest(details) {
    if (!details || typeof details.url !== 'string') return false;

    let target;
    try { target = new URL(details.url); } catch (_) { return false; }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;

    const targetHost = target.hostname.toLowerCase();
    const targetIsAuthHost =
      targetHost === 'accounts.google.com' ||
      targetHost.endsWith('.accounts.google.com') ||
      targetHost === 'accounts.youtube.com' ||
      targetHost.endsWith('.accounts.youtube.com');

    if (targetIsAuthHost) return true;

    let sourceUrl = '';
    try {
      const wc = details.webContents;
      if (wc && typeof wc.getURL === 'function' && !(wc.isDestroyed && wc.isDestroyed())) sourceUrl = wc.getURL() || '';
    } catch (_) {}
    if (!sourceUrl) sourceUrl = typeof details.referrer === 'string' ? details.referrer : '';

    let sourceHost = '';
    try { sourceHost = new URL(sourceUrl).hostname.toLowerCase(); } catch (_) { return false; }

    const sourceIsAuth =
      sourceHost === 'accounts.google.com' ||
      sourceHost.endsWith('.accounts.google.com') ||
      sourceHost === 'accounts.youtube.com' ||
      sourceHost.endsWith('.accounts.youtube.com');

    if (!sourceIsAuth) return false;

    return (
      targetHost === 'gstatic.com' || targetHost.endsWith('.gstatic.com') ||
      targetHost === 'googleusercontent.com' || targetHost.endsWith('.googleusercontent.com') ||
      targetHost === 'google.com' || targetHost.endsWith('.google.com') ||
      targetHost === 'googleapis.com' || targetHost.endsWith('.googleapis.com') ||
      targetHost === 'recaptcha.net' || targetHost.endsWith('.recaptcha.net')
    );
  }

  _enableEngine(sessionInstance) {
    const blocker = this.blocker;
    const context = this._withoutEngineCosmeticRegistration(blocker, () => blocker.enableBlockingInSession(sessionInstance));
    if (context && blocker.config.loadNetworkFilters !== false) {
      const filter = { urls: ['<all_urls>'] };
      if (typeof context.onBeforeRequest === 'function') {
        sessionInstance.webRequest.onBeforeRequest(filter, Object.assign(
          (details, callback) => (
            this._pausedFor(details) || this._isGoogleAuthRequest(details)
              ? callback({})
              : context.onBeforeRequest(details, callback)
          ), { engine: true }));
      }
      if (typeof context.onHeadersReceived === 'function') {
        sessionInstance.webRequest.onHeadersReceived(filter, (details, callback) => (
          this._pausedFor(details) || this._isGoogleAuthRequest(details)
            ? callback({})
            : context.onHeadersReceived(details, callback)
        ));
      }
    }
    this._registerCosmetic(sessionInstance);
  }

  _disableEngine(sessionInstance, blocker = this.blocker) {
    if (blocker && (typeof blocker.isBlockingEnabled !== 'function' || blocker.isBlockingEnabled(sessionInstance))) {
      this._withoutEngineCosmeticRegistration(blocker, () => blocker.disableBlockingInSession(sessionInstance));   // (throws for a session that was never enabled)
    }
    this._unregisterCosmetic(sessionInstance);
  }

  /** Element hiding + scriptlets: a preload script in every frame of the session asks the main process what to inject. */
  _registerCosmetic(sessionInstance) {
    if (!this.blocker || this.blocker.config.loadCosmeticFilters === false) return;
    if (typeof sessionInstance.registerPreloadScript !== 'function' || this._cosmeticPreloads.has(sessionInstance)) return;
    try {
      const id = sessionInstance.registerPreloadScript({ type: 'frame', filePath: this._preloadPath() });
      this._cosmeticPreloads.set(sessionInstance, id);
    } catch (err) {
      console.warn('Could not register the element-hiding script:', err && err.message);
      return;
    }
    this._installCosmeticHandlers();
  }

  _unregisterCosmetic(sessionInstance) {
    const id = this._cosmeticPreloads.get(sessionInstance);
    if (id === undefined) return;
    this._cosmeticPreloads.delete(sessionInstance);
    try { sessionInstance.unregisterPreloadScript(id); } catch (_) { /* session is gone */ }
  }

  _installCosmeticHandlers() {
    if (this._cosmeticHandlersInstalled) return;
    const { ipcMain } = require('electron');
    ipcMain.removeHandler(COSMETIC_CHANNEL);
    ipcMain.removeHandler(MUTATION_CHANNEL);
    ipcMain.handle(COSMETIC_CHANNEL, (event, url, msg) => this._onCosmeticRequest(event, url, msg));
    ipcMain.handle(MUTATION_CHANNEL, () => Boolean(this.blocker && this.blocker.config.enableMutationObserver));
    this._cosmeticHandlersInstalled = true;
  }

  /** A frame asks which elements to hide / which scriptlets to run. Only web pages, only when the blocker is in force. */
  _onCosmeticRequest(event, url, msg) {
    if (!this.isEnabled || !this.blocker || typeof url !== 'string') return undefined;
    let frameHost;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;     // never the browser's own pages
      frameHost = u.hostname;
    } catch (_) {
      return undefined;
    }
    if (this._paused.size > 0) {
      let topHost = '';
      try {
        const sender = event && event.sender;
        if (sender && !(sender.isDestroyed && sender.isDestroyed())) topHost = hostnameOf(sender.getURL());
      } catch (_) { /* ignore */ }
      if (this.isSitePaused(frameHost) || (topHost && this.isSitePaused(topHost))) return undefined;
    }
    return this.blocker.onInjectCosmeticFilters(event, url, msg);
  }

  // ─── Lists and the compiled engine ────────────────────────────────────────

  _ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); return true; } catch (_) { return false; }
  }

  _listFile(id) { return this.listsDir ? path.join(this.listsDir, id + '.txt') : null; }
  _listMetaFile(id) { return this.listsDir ? path.join(this.listsDir, id + '.json') : null; }

  /** The kept copy of a list: { text, fetchedAt, url } or null. */
  _readStoredList(id) {
    if (!this.listsDir) return null;
    try {
      const text = fs.readFileSync(this._listFile(id), 'utf8');
      if (!text) return null;
      let info = {};
      try { info = JSON.parse(fs.readFileSync(this._listMetaFile(id), 'utf8')); } catch (_) { /* meta is optional */ }
      let fetchedAt = Number(info.fetchedAt);
      if (!Number.isFinite(fetchedAt)) { try { fetchedAt = fs.statSync(this._listFile(id)).mtimeMs; } catch (_) { fetchedAt = 0; } }
      return { text, fetchedAt, url: typeof info.url === 'string' ? info.url : '' };
    } catch (_) {
      return null;
    }
  }

  _storeList(id, text, url) {
    if (!this.listsDir || !this._ensureDir(this.listsDir)) return;
    try {
      fs.writeFileSync(this._listFile(id), text);
      fs.writeFileSync(this._listMetaFile(id), JSON.stringify({ fetchedAt: Date.now(), url }));
    } catch (err) {
      console.warn(`Could not keep the list ${id}:`, err && err.message);
    }
  }

  /**
   * Makes sure every list (and the scriptlet resources) is at hand: a fresh kept copy is used as it is, anything else is
   * downloaded; when that fails an old kept copy is better than nothing.
   * @returns {Promise<Array>} one entry per list: { id, name, core, ok, stale, text, source, fetchedAt, error }
   */
  async _collectLists({ force = false } = {}) {
    const now = Date.now();
    let failedInARow = 0;
    const handle = async (item, validate) => {
      const kept = this._readStoredList(item.id);
      const fresh = kept && !force && now - kept.fetchedAt < this.cacheTtlMs;
      const entry = { id: item.id, name: item.name, core: item.core === true, ok: false, stale: false, text: '', source: '', fetchedAt: 0, error: '' };
      if (fresh) return Object.assign(entry, { ok: true, text: kept.text, source: kept.url || 'kept copy', fetchedAt: kept.fetchedAt });
      if (failedInARow >= GIVE_UP_AFTER_FAILED_LISTS) {
        entry.error = 'not tried (no internet connection?)';
      } else {
        const got = await filterLists.downloadList(this._fetch, item, { validate });
        if (got.ok) {
          failedInARow = 0;
          this._storeList(item.id, got.text, got.url);
          return Object.assign(entry, { ok: true, text: got.text, source: got.url, fetchedAt: Date.now() });
        }
        failedInARow++;
        entry.error = got.error;
      }
      if (kept) return Object.assign(entry, { ok: true, stale: true, text: kept.text, source: kept.url || 'kept copy', fetchedAt: kept.fetchedAt });
      return entry;
    };

    const lists = await filterLists.mapLimit(filterLists.LISTS, DOWNLOAD_CONCURRENCY, (item) => handle(item, filterLists.looksLikeFilterList));
    const resources = await handle(filterLists.RESOURCES, filterLists.looksLikeResources);
    return { lists, resources };
  }

  /** Builds an engine from the lists that are at hand. Returns { blocker, meta, changed } (changed=false: nothing new). */
  async _buildEngine({ force = false } = {}) {
    const { lists, resources } = await this._collectLists({ force });
    const usable = lists.filter((l) => l.ok);
    if (usable.length === 0) {
      throw new Error('no filter list could be downloaded or read from disk (' + (lists[0] && lists[0].error || 'no connection') + ')');
    }

    const signature = filterLists.signatureOf([...usable, ...(resources.ok ? [resources] : [])]);
    const listInfo = lists.map((l) => ({ id: l.id, name: l.name, ok: l.ok, stale: l.stale, bytes: l.text.length, source: l.source, fetchedAt: l.fetchedAt, error: l.error }));
    const resourcesInfo = { ok: resources.ok, stale: resources.stale, source: resources.source, fetchedAt: resources.fetchedAt, error: resources.error };

    if (this.meta && this.blocker && this.meta.signature === signature) {
      // same content as the engine in use: only the freshness bookkeeping changes
      this.meta = Object.assign({}, this.meta, { lists: listInfo, resources: resourcesInfo, checkedAt: Date.now() });
      this._writeMeta();
      return { blocker: this.blocker, meta: this.meta, changed: false };
    }

    const blocker = ElectronBlocker.parse(usable.map((l) => l.text).join('\n'), Object.assign({}, ENGINE_CONFIG));
    if (resources.ok) blocker.updateResources(resources.text, String(resources.text.length));
    const counts = this._countRules(blocker);
    const meta = {
      version: META_VERSION, signature, builtAt: Date.now(), checkedAt: Date.now(),
      networkRules: counts.network, cosmeticRules: counts.cosmetic, lists: listInfo, resources: resourcesInfo
    };
    this._writeEngineCache(blocker, meta);
    return { blocker, meta, changed: true };
  }

  _countRules(blocker) {
    try {
      const f = blocker.getFilters();
      return { network: f.networkFilters.length, cosmetic: f.cosmeticFilters.length };
    } catch (_) {
      return { network: 0, cosmetic: 0 };
    }
  }

  _writeEngineCache(blocker, meta) {
    if (!this.cacheFile) return;
    try {
      this._ensureDir(path.dirname(this.cacheFile));
      const tmp = this.cacheFile + '.tmp';
      fs.writeFileSync(tmp, blocker.serialize());
      fs.renameSync(tmp, this.cacheFile);
      this._writeMeta(meta);
    } catch (err) {
      console.warn('Could not keep the compiled ad-block engine:', err && err.message);
    }
  }

  _writeMeta(meta = this.meta) {
    if (!this.metaFile || !meta) return;
    try { fs.writeFileSync(this.metaFile, JSON.stringify(meta)); } catch (_) { /* the engine file is the important one */ }
  }

  /** The kept engine: { blocker, meta } or null (missing, damaged, or from another engine version). */
  _readEngineCache() {
    if (!this.cacheFile || !this.metaFile) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
      if (!meta || meta.version !== META_VERSION || typeof meta.signature !== 'string') return null;
      const blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(this.cacheFile)));
      return { blocker, meta };
    } catch (_) {
      return null;
    }
  }

  /** True when any list is older than the time-to-live (or missing). */
  _listsAreStale() {
    if (!this.meta || !Array.isArray(this.meta.lists)) return true;
    const now = Date.now();
    return this.meta.lists.some((l) => !l.ok || l.stale || now - (l.fetchedAt || 0) > this.cacheTtlMs)
      || !this.meta.resources || !this.meta.resources.ok;
  }

  /** Loads the kept engine at once (a start-up needs no network and blocks from the first request), else builds one. */
  async _createInitialEngine() {
    const kept = this._readEngineCache();
    if (kept) {
      this.meta = kept.meta;
      return kept.blocker;
    }
    const built = await this._buildEngine();
    this.meta = built.meta;
    return built.blocker;
  }

  /** Builds the (expensive, network-backed) filter engine once and shares it between sessions. */
  _loadBlocker() {
    if (!this._blockerPromise) {
      this._blockerPromise = this._createInitialEngine().then((blocker) => {
        this._adopt(blocker);
        return blocker;
      });
      // A failed download must not be cached forever
      this._blockerPromise.catch(() => { this._blockerPromise = null; });
    }
    return this._blockerPromise;
  }

  _adopt(blocker) {
    blocker.on('request-blocked', () => { this.blockedCount++; });
    blocker.on('request-redirected', () => { this.blockedCount++; });
    this.blocker = blocker;
    this._customApplied = [];
    this.reloadCustomFilters();
  }

  /**
   * Downloads the lists that are due and, when something changed, swaps the new engine into every session.
   * Safe to call at any time; concurrent calls share one run. @returns {Promise<object>} the status
   */
  refresh({ force = false } = {}) {
    if (!this._refreshing) {
      this._refreshing = (async () => {
        try {
          await this._loadBlocker().catch(() => null);
          const built = await this._buildEngine({ force });
          this.meta = built.meta;
          this._lastRefreshError = '';
          if (built.changed) this._swapEngine(built.blocker);
        } catch (err) {
          this._lastRefreshError = (err && err.message) || String(err);
          console.warn('Could not refresh the ad-block lists:', this._lastRefreshError);
        } finally {
          this._refreshing = null;
        }
        return this.getStatus();
      })();
    }
    return this._refreshing;
  }

  _swapEngine(next) {
    const old = this.blocker;
    const enabled = new Set(this.sessions);
    for (const sess of enabled) { try { this._disableEngine(sess, old); } catch (_) { /* never enabled */ } }
    this._adopt(next);
    this._blockerPromise = Promise.resolve(next);
    if (this.isEnabled) for (const sess of enabled) this._enableEngine(sess);
    console.log('Ad-block lists updated.');
  }

  /** Looks every few hours whether the lists are due for a refresh (a browser that stays open for days stays current). */
  _scheduleRefresh() {
    if (this._refreshTimer) return;
    this._refreshTimer = setInterval(() => { if (this._listsAreStale()) this.refresh(); }, REFRESH_CHECK_MS);
    if (this._refreshTimer.unref) this._refreshTimer.unref();
  }

  async setupFilter(sessionInstance) {
    if (!sessionInstance) return;
    this.sessions.add(sessionInstance);

    // The full engine needs the lists first (a download: seconds, or never when offline), and until then nothing would be
    // blocked. Start with the short built-in list; when the engine is ready its own webRequest listeners replace this one.
    if (!this.blocker) this.setupFallbackFilter(sessionInstance);

    try {
      console.log('Loading the ad-block engine (EasyList, EasyPrivacy, uBlock Origin, AdGuard)...');
      await this._loadBlocker();
      if (this.isEnabled) {
        this._enableEngine(sessionInstance);
        console.log('Ad-Blocker successfully activated for a session.');
      }
      if (this._listsAreStale()) this.refresh();                // after the first protection is in place
      this._scheduleRefresh();
    } catch (err) {
      console.error('Failed to initialize the ad-block engine, keeping the built-in fallback filter:', err);
      this._lastRefreshError = (err && err.message) || String(err);
      this._scheduleRefresh();                                  // try again later (a connection may come up)
    }
  }

  setupFallbackFilter(sessionInstance) {
    sessionInstance.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (!this.isEnabled || this._pausedFor(details)) {
        callback({ cancel: false });
        return;
      }
      const url = details.url.toLowerCase();

      // Whitelist Google authentication, captcha challenges, and security telemetry endpoints
      if (
        url.includes('accounts.google.com') ||
        url.includes('accounts.youtube.com') ||
        url.includes('play.google.com/log') ||
        url.includes('gstatic.com') ||
        url.includes('recaptcha')
      ) {
        callback({ cancel: false });
        return;
      }

      const cancel = FALLBACK_DOMAINS.some((d) => url.includes(d));
      if (cancel) this.blockedCount++;
      callback({ cancel });
    });
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    this.storage.updateSettings({ adBlockerEnabled: enabled });
    if (this.blocker) {
      for (const sess of this.sessions) {
        if (enabled) this._enableEngine(sess);
        else this._disableEngine(sess);
      }
    }
  }

  getBlockedCount() {
    return this.blockedCount;
  }

  // ─── Pop-ups ──────────────────────────────────────────────────────────────

  /**
   * Should a window.open() from `openerUrl` to `targetUrl` be refused because the target is an ad / tracker address?
   * The address is looked up like a frame the opener would load (the lists describe hosts that way); the first hop of a
   * pop-under is almost always such a host.
   */
  matchPopup(targetUrl, openerUrl) {
    if (typeof targetUrl !== 'string' || !/^https?:/i.test(targetUrl)) return false;
    if (!this.isActiveFor(hostnameOf(openerUrl))) return false;
    if (this.blocker) {
      try {
        const { Request } = require('@ghostery/adblocker-electron');
        const request = Request.fromRawDetails({ url: targetUrl, sourceUrl: typeof openerUrl === 'string' ? openerUrl : '', type: 'sub_frame' });
        const result = this.blocker.match(request);
        return Boolean(result && (result.match || result.redirect));
      } catch (_) {
        /* fall through to the short list */
      }
    }
    const lower = targetUrl.toLowerCase();
    if (FALLBACK_DOMAINS.some((d) => lower.includes(d))) { this.blockedCount++; return true; }
    return false;
  }

  /** A pop-up was refused for a reason other than a list match (background tab, no click, too many): it still counts. */
  noteBlockedPopup() {
    this.blockedCount++;
  }

  // ─── The user's own filters ("My filters") ────────────────────────────────

  /** Brings the engine in line with Settings → My filters (added/removed lines only; no rebuild). */
  reloadCustomFilters() {
    if (!this.blocker) return false;
    const wanted = parseCustomFilters(this.storage.getSettings().adBlockerCustomFilters);
    const have = new Set(this._customApplied);
    const want = new Set(wanted);
    const added = wanted.filter((l) => !have.has(l));
    const removed = this._customApplied.filter((l) => !want.has(l));
    if (added.length === 0 && removed.length === 0) return false;
    try {
      this.blocker.updateFromDiff({ added, removed });
      this._customApplied = wanted;
      return true;
    } catch (err) {
      console.warn('Could not apply the custom ad-block filters:', err && err.message);
      return false;
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  /** What the Settings page shows: is the real engine in force, how many rules, which lists failed. */
  getStatus() {
    const meta = this.meta;
    const lists = meta && Array.isArray(meta.lists) ? meta.lists : [];
    return {
      enabled: this.isEnabled,
      engine: this.blocker ? 'full' : (this._blockerPromise || this._refreshing ? 'loading' : 'fallback'),
      refreshing: Boolean(this._refreshing),
      networkRules: meta ? meta.networkRules : 0,
      cosmeticRules: meta ? meta.cosmeticRules : 0,
      customRules: this._customApplied.length,
      scriptlets: Boolean(meta && meta.resources && meta.resources.ok),
      updatedAt: meta ? (meta.checkedAt || meta.builtAt || 0) : 0,
      listsLoaded: lists.filter((l) => l.ok).length,
      listsTotal: lists.length || filterLists.LISTS.length,
      lists: lists.map((l) => ({ id: l.id, name: l.name, ok: l.ok, stale: l.stale, error: l.error || '' })),
      error: this.blocker ? '' : this._lastRefreshError
    };
  }
}

function defaultPreloadPath() {
  const pkg = require.resolve('@ghostery/adblocker-electron');
  return require.resolve('@ghostery/adblocker-electron-preload', { paths: [path.dirname(pkg), __dirname] });
}

AdBlockerService.normalizeHost = normalizeHost;
AdBlockerService.parseCustomFilters = parseCustomFilters;
AdBlockerService.FALLBACK_DOMAINS = FALLBACK_DOMAINS;
module.exports = AdBlockerService;
