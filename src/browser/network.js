// Secure DNS, proxy and WebRTC policy, Google sign-in identity, site permissions.
// Methods of the browser application (ShmmothBrowserApp), moved here from main.js unchanged: browser/mixins.js adds
// them to the class, so `this` is the application as before.
'use strict';

const {
  app,
  session,
  dialog,
  path,
  GoogleSignIn,
  isTrustedInternalUrl,
  log,
  secureDns,
  isAlwaysAllowedPermission,
  SRC_DIR
} = require('./shared');

class NetworkMethods {
  // ─── Secure DNS ──────────────────────────────────────────────────────────

  /** Applies the saved DNS-over-HTTPS choice (app.configureHostResolver must run after 'ready'; init() calls this first). */
  applySecureDns() {
    const { provider, options } = secureDns.buildHostResolverConfig(this.storage.getSettings());
    try {
      app.configureHostResolver(options);
      // answers cached from the previous resolver (e.g. the system's) would otherwise live on for a while
      Promise.all(this._browsingSessions().map((s) => s.clearHostResolverCache())).catch(() => {});
      log.info('Secure DNS configured', { provider, mode: options.secureDnsMode, servers: options.secureDnsServers });
    } catch (err) {
      log.warn('Could not configure secure DNS', { error: err.message });
    }
    return provider;
  }

  /** What the Settings page shows. */
  getSecureDnsState() {
    const s = this.storage.getSettings();
    const provider = secureDns.normalizeProvider(s.secureDnsProvider);
    const effective = secureDns.buildHostResolverConfig(s);
    return {
      provider,
      effectiveProvider: effective.provider,
      customUrl: typeof s.secureDnsCustomUrl === 'string' ? s.secureDnsCustomUrl : '',
      strict: s.secureDnsStrict === true,
      servers: effective.options.secureDnsServers,
      providers: Object.values(secureDns.PROVIDERS).map((p) => ({ id: p.id, label: p.label, description: p.description }))
    };
  }

  // ─── Proxy / network privacy ─────────────────────────────────────────────

  /** All sessions that carry web content. A proxy must apply to every one of them. */
  _browsingSessions() {
    return [session.defaultSession, session.fromPartition('incognito')];
  }

  /**
   * WebRTC can open UDP sockets that bypass an HTTP/SOCKS proxy and reveal the real IP.
   * With a manual proxy only proxied UDP is allowed; otherwise only the default route's public address is used while
   * fingerprinting protection is on (pages never see the local network's addresses), else Chromium's default.
   */
  _webRtcPolicyForProxy() {
    const cfg = this.proxyManager ? this.proxyManager.getConfig() : null;
    if (cfg && cfg.mode === 'manual') return 'disable_non_proxied_udp';
    // fingerprinting protection: calls still connect, but pages never learn the computer's local network addresses
    return this.privacyShield ? this.privacyShield.webRtcPolicy() : 'default';
  }

  _applyWebRtcPolicy(wc) {
    try {
      if (wc && !wc.isDestroyed()) wc.setWebRTCIPHandlingPolicy(this._webRtcPolicyForProxy());
    } catch (err) {
      log.warn('Could not set WebRTC IP handling policy', { error: err.message });
    }
  }

  /** Applies the saved proxy to the normal AND the incognito session, and refreshes WebRTC policy of open tabs. */
  async applyProxyToAllSessions() {
    if (!this.proxyManager) return;
    for (const sess of this._browsingSessions()) {
      await this.proxyManager.applyToSession(sess);
    }
    await this.refreshSystemProxyState();
    this.refreshWebRtcPolicies();
  }

  /**
   * In 'system' mode Chromium may still be using a proxy (Windows settings / PAC). Node-based code such as the
   * Turbo downloader cannot see it, so remember whether one is in effect. Cached because callers are synchronous.
   */
  async refreshSystemProxyState() {
    try {
      const resolved = await session.defaultSession.resolveProxy('https://www.example.com/');
      const hops = String(resolved || '').split(';').map(h => h.trim()).filter(Boolean);
      this._systemProxyActive = hops.some(h => !/^DIRECT$/i.test(h));
    } catch (_) {
      this._systemProxyActive = true; // unknown → be conservative (keeps downloads on the proxied native path)
    }
  }

  /** True when web traffic is currently routed through a proxy. */
  isProxyActive() {
    const cfg = this.proxyManager ? this.proxyManager.getConfig() : null;
    if (!cfg || cfg.mode === 'direct') return false;
    if (cfg.mode === 'manual') return Boolean(cfg.rules && cfg.rules.host);
    return Boolean(this._systemProxyActive);
  }

  /**
   * Requests are sent as the engine makes them: no header is rewritten to pass for Google Chrome (that is what got the
   * sign-in refused, see services/googleSignIn.js). Two exceptions on Google's sign-in pages only:
   *   - a page request that arrives there by a redirect (gmail.com → accounts.google.com) carries the sign-in identity's
   *     User-Agent, the same one the page itself then reports (the tab's own User-Agent is switched when it navigates,
   *     which a redirect is not)
   *   - while the Firefox identity is shown, the Chromium client hints (Sec-CH-UA…) are left out, as Firefox never sends them
   */
  setupSignInClientHints(targetSession) {
    if (!targetSession || !targetSession.webRequest) return;
    const filter = { urls: ['https://accounts.google.com/*', 'https://accounts.youtube.com/*', 'https://*.google.com/*', 'https://*.gstatic.com/*'] };
    targetSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      if (!this.googleSignIn) return callback({});
      let pageUrl = '';
      try {
        const wc = details.webContents;
        if (wc && !wc.isDestroyed()) pageUrl = wc.getURL() || '';
      } catch (_) { /* gone */ }
      const isPage = details.resourceType === 'mainFrame' && GoogleSignIn.isSignInUrl(details.url);
      const pageUa = isPage ? this._userAgentFor(details.url) : '';
      const hideHints = this.googleSignIn.hidesClientHints(isPage ? details.url : (pageUrl || details.url));
      const headers = Object.assign({}, details.requestHeaders);
      const uaName = Object.keys(headers).find((n) => n.toLowerCase() === 'user-agent') || 'User-Agent';
      if ((!pageUa || headers[uaName] === pageUa) && !hideHints) return callback({});
      if (pageUa) headers[uaName] = pageUa;
      if (hideHints) for (const name of Object.keys(headers)) if (/^sec-ch-ua/i.test(name)) delete headers[name];
      callback({ requestHeaders: headers });
    });
  }

  /** The User-Agent for a page of a tab or a sign-in window: the sign-in identity on Google's sign-in pages. */
  _userAgentFor(url) {
    const normal = this.cleanUa || app.userAgentFallback;
    return this.googleSignIn ? this.googleSignIn.userAgentFor(url, normal) : normal;
  }

  /**
   * Watches a tab or a sign-in window for Google's refusal page and starts the sign-in again with the next browser
   * identity (see services/googleSignIn.js). The page is recognised by its address, and — in case Google moves it — by
   * the link to Google's help article for this refusal, which the page carries in every language.
   */
  _watchGoogleSignIn(wc, parentWindow) {
    if (!wc || wc.__shmmothSignInWatched) return;
    wc.__shmmothSignInWatched = true;
    const wcId = wc.id;
    const act = (url, refused) => {
      if (!this.googleSignIn || wc.isDestroyed()) return;
      const r = this.googleSignIn.noteNavigation(wcId, url, { refused });
      if (r.action === 'retry') {
        log.info('Google sign-in refused; starting again with another browser identity', { profile: r.profile });
        wc.setUserAgent(this._userAgentFor(r.url));
        wc.loadURL(r.url).catch(() => {});
      } else if (r.action === 'give-up') {
        this._explainGoogleRefusal(wc, parentWindow);
      }
    };
    const lookInPage = (url) => {
      if (!GoogleSignIn.isSignInUrl(url) || GoogleSignIn.isRefusalUrl(url)) return;
      for (const delay of [800, 2500]) {
        setTimeout(() => {
          if (wc.isDestroyed() || wc.getURL() !== url) return;
          wc.executeJavaScript(`!!document.querySelector('a[href*="answer/${GoogleSignIn.REFUSAL_HELP_ANSWER}"]')`)
            .then((refused) => { if (refused === true && wc.getURL() === url) act(url, true); })
            .catch(() => {});
        }, delay);
      }
    };
    wc.on('did-navigate', (_, url) => { act(url, false); lookInPage(url); });
    wc.on('did-navigate-in-page', (_, url, isMainFrame) => { if (isMainFrame === false) return; act(url, false); lookInPage(url); });
    wc.once('destroyed', () => { if (this.googleSignIn) this.googleSignIn.forget(wcId); });
  }

  /** Every browser identity was refused in this sign-in: say so once, in plain words, and offer to try again. */
  async _explainGoogleRefusal(wc, parentWindow) {
    const parent = parentWindow && !parentWindow.isDestroyed() ? parentWindow : this.mainWindow;
    const options = {
      type: 'warning',
      title: 'Google sign-in',
      message: 'Google refused to sign in this browser.',
      detail: 'Google blocks sign-in from browsers it cannot tell apart from an embedded or automated one ("This browser or app may not be secure"). '
        + 'SHMMOTH tried each of its browser identities and Google refused all of them this time. This is a decision on Google\'s side, often for a while '
        + 'after several attempts from the same computer. Try again later, or sign in to Google in another browser for now.',
      buttons: ['Try again', 'Close'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
    try {
      const { response } = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (response === 0 && !wc.isDestroyed() && this.googleSignIn) {
        this.googleSignIn.resetFlow(wc.id);
        const here = wc.getURL();
        const again = GoogleSignIn.restartUrl(here, here);
        wc.setUserAgent(this._userAgentFor(again));
        wc.loadURL(again).catch(() => {});
      }
    } catch (err) {
      log.warn('Could not show the Google sign-in notice', { error: err.message });
    }
  }

  // ─── Content Permissions & Security (Stage 5) ───────────────────────────

  setupPermissions(targetSession) {
    if (!targetSession) return;

    targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      // Our own pages (mtc:// and the exact app-shipped documents) are trusted.
      // Arbitrary local files are NOT: their origin is just "file://".
      const checkUrl = (details && details.requestingUrl) || requestingOrigin;
      if (isTrustedInternalUrl(checkUrl)) {
        return true;
      }

      // Permissions every page gets without a prompt (fullscreen, pointer lock, writing to the clipboard on a click)
      if (isAlwaysAllowedPermission(permission)) {
        return true;
      }

      // Check stored permissions for this origin
      if (this.storage) {
        const perms = this.storage.getSitePermissions(requestingOrigin);
        if (perms && perms[permission]) {
          return perms[permission] === 'allow';
        }
      }

      // Default to false for sensitive permissions (triggers setPermissionRequestHandler)
      return false;
    });

    targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const requestingUrl = details.requestingUrl || (webContents ? webContents.getURL() : '');
      let origin = '';
      try {
        origin = new URL(requestingUrl).origin;
      } catch (_) {
        origin = requestingUrl || 'unknown';
      }

      // Our own pages are auto-granted; arbitrary local files go through the normal prompt
      if (isTrustedInternalUrl(requestingUrl)) {
        return callback(true);
      }

      // Permissions every page gets without a prompt (see security/permissionPolicy.js)
      if (isAlwaysAllowedPermission(permission)) {
        return callback(true);
      }

      // Check stored decision
      if (this.storage) {
        const perms = this.storage.getSitePermissions(origin);
        if (perms && perms[permission] === 'allow') {
          return callback(true);
        } else if (perms && perms[permission] === 'block') {
          return callback(false);
        }
      }

      // Find which tab requested this
      let foundTab = null;
      if (webContents) {
        for (const t of Object.values(this.tabs)) {
          if (t.view && t.view.webContents && t.view.webContents.id === webContents.id) {
            foundTab = t;
            break;
          }
        }
      }

      const targetWin = (foundTab && foundTab.isIncognito) ? this.incognitoWindow : this.mainWindow;
      if (!targetWin || targetWin.isDestroyed() || !targetWin.webContents) {
        return callback(false);
      }

      const requestId = 'perm_req_' + (++this.permissionReqCounter);
      this.pendingPermissionRequests[requestId] = {
        callback,
        origin,
        permission,
        tabId: foundTab ? foundTab.id : null
      };

      // Auto-expire after 30 seconds
      const timeout = setTimeout(() => {
        if (this.pendingPermissionRequests[requestId]) {
          const req = this.pendingPermissionRequests[requestId];
          delete this.pendingPermissionRequests[requestId];
          try { req.callback(false); } catch (_) {}
        }
      }, 30000);
      this.pendingPermissionRequests[requestId].timeout = timeout;

      const permData = {
        requestId,
        origin,
        permission,
        details: { mediaTypes: details.mediaTypes || [] },
        tabId: foundTab ? foundTab.id : null
      };

      targetWin.webContents.send('permission:request', permData);
      this.openPermissionBubble(permData, Boolean(foundTab && foundTab.isIncognito));
      log.info(`Permission requested: ${permission} by ${origin}`, { requestId });
    });
  }

  /** Every frame of every web page of the session reports real clicks / key presses (see services/popupPolicy.js). */
  /**
   * The privacy shield's page side (preload-privacy.js) in every frame of the normal and incognito session. The
   * preload asks which scripts the page gets (Global Privacy Control, fingerprinting protection with the site's seed):
   * the answer follows the settings at the moment each page loads, so nothing has to be registered again on a change.
   */
  registerPrivacyPreload() {
    const { ipcMain } = require('electron');
    ipcMain.removeAllListeners('shmmoth:privacy-page');
    ipcMain.on('shmmoth:privacy-page', (event, href) => {
      let scripts = [];
      try {
        const wc = event.sender;
        const frame = event.senderFrame;
        const isTop = !frame || !frame.parent;
        const topUrl = isTop ? String(href || '') : wc.getURL();
        const partition = wc.session === session.fromPartition('incognito') ? 'incognito' : 'default';
        scripts = this.privacyShield ? this.privacyShield.pageScripts(topUrl, partition) : [];
      } catch (_) { scripts = []; }
      event.returnValue = scripts;
    });
    for (const sess of [session.defaultSession, session.fromPartition('incognito')]) {
      try {
        sess.registerPreloadScript({ type: 'frame', filePath: path.join(SRC_DIR, 'preload-privacy.js') });
      } catch (err) {
        log.warn('Could not register the privacy script', { error: err.message });
      }
    }
  }

  /** WebRTC of every open tab again (the proxy or fingerprinting protection changed). */
  refreshWebRtcPolicies() {
    for (const tab of Object.values(this.tabs)) {
      if (tab && tab.view) this._applyWebRtcPolicy(tab.view.webContents);
    }
  }

  registerGesturePreload(sess) {
    try {
      sess.registerPreloadScript({ type: 'frame', filePath: path.join(SRC_DIR, 'preload-gesture.js') });
    } catch (err) {
      log.warn('Could not register the gesture script', { error: err.message });
    }
  }
}

module.exports = NetworkMethods;
