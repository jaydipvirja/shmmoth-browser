// Tabs: creating them (with all their page events), switching, closing, pinning, zoom, the address bar, YouTube ads.
// Methods of the browser application (ShmmothBrowserApp), moved here from main.js unchanged: browser/mixins.js adds
// them to the class, so `this` is the application as before.
'use strict';

const {
  WebContentsView,
  session,
  Menu,
  MenuItem,
  clipboard,
  screen,
  checkNavigation,
  isPopupBlocked,
  isSafeToLoad,
  log,
  securityLogger,
  shouldShowErrorPage,
  buildErrorPageUrl,
  displayUrl,
  isGoogleAuthUrl,
  PRELOAD_EXTERNAL,
  ZOOM_LEVELS,
  CONTEXT_MENU_HIT_TEST_MS,
  selectPreload
} = require('./shared');

class TabsMethods {
  // ─── Tab Management (Stage 1 Core) ───────────────────────────────────────

  createTab(initialUrl = 'mtc://newtab', insertAfterTabId = null, isPinned = false, isIncognito = false, isPopupTab = false, options = {}) {
    const tabId = 'tab_' + this.tabCounter++;
    const preloadPath = selectPreload(initialUrl);

    // Every renderer runs inside the Chromium OS sandbox: a compromised tab (e.g. a Blink/V8 exploit)
    // cannot touch the filesystem or spawn processes directly. This is why the preloads may only use
    // the small Electron subset available to sandboxed preloads (see tests/p0-sandbox.test.js).
    const webPreferences = {
      preload:          preloadPath,
      contextIsolation: true,
      nodeIntegration:  false,
      plugins:          true,
      webSecurity:      true,
      sandbox:          true
    };

    if (isIncognito) {
      webPreferences.partition = 'incognito';
    }

    const view = new WebContentsView({ webPreferences });

    if (view.webContents) {
      view.webContents.setUserAgent(this._userAgentFor(initialUrl));
    }

    const tabData = {
      id:             tabId,
      title:          'New Tab',
      url:            initialUrl,
      favicon:        '',
      view:           view,
      isAudible:      false,
      isMuted:        false,
      isLoading:      false,
      isSleeping:     false,
      isPinned:       Boolean(isPinned),
      isIncognito:    Boolean(isIncognito),
      isPopupTab:     Boolean(isPopupTab),
      openerTabId:    insertAfterTabId,
      canGoBack:      false,
      canGoForward:   false,
      lastActiveTime: Date.now(),
      isCrashed:      false,
      crashReason:    null,
      isUnresponsive: false,
      isHtmlFullScreen: false,
      lastValidUrl:   initialUrl,
      pendingLoadUrl: null,           // set for a restored background tab until it is first selected
      failedUrl:      null            // the address behind the error page this tab currently shows
    };
    if (options.deferLoad) tabData.pendingLoadUrl = initialUrl;
    // a restored tab shows its saved title / icon straight away (the page replaces them as soon as it reports its own)
    if (typeof options.title === 'string' && options.title) tabData.title = options.title;
    if (typeof options.favicon === 'string') tabData.favicon = options.favicon;

    this.tabs[tabId] = tabData;

    const targetOrder = isIncognito ? this.incognitoTabOrder : this.tabOrder;

    // Tab ordering
    if (insertAfterTabId && targetOrder.includes(insertAfterTabId)) {
      const idx = targetOrder.indexOf(insertAfterTabId);
      targetOrder.splice(idx + 1, 0, tabId);
    } else if (isPinned) {
      // Pinned tabs stay grouped at the front
      const lastPinnedIndex = this._getLastPinnedIndex(isIncognito);
      targetOrder.splice(lastPinnedIndex + 1, 0, tabId);
    } else {
      targetOrder.push(tabId);
    }

    // Keep pinned tabs cleanly clustered at the beginning
    this._reorderPinnedFirst(isIncognito);

    const wc = view.webContents;
    this._applyWebRtcPolicy(wc);

    // ── Title + Favicon updates ──
    wc.on('page-title-updated', (_, title) => {
      tabData.title = title || 'New Tab';
      if (!tabData.isIncognito && title) this.storage.updateHistoryEntry(tabData.url, { title });
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    wc.on('page-favicon-updated', (_, favicons) => {
      if (favicons && favicons.length > 0) {
        tabData.favicon = favicons[0];
        if (!tabData.isIncognito) this.storage.updateHistoryEntry(tabData.url, { favicon: favicons[0] });
        this.broadcastTabsUpdate(tabData.isIncognito);
      }
    });

    // ── Loading state events (Stage 1) ──
    wc.on('did-start-loading', () => {
      tabData.isLoading = true;
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }
    });

    wc.on('did-stop-loading', () => {
      tabData.isLoading = false;
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }
    });

    wc.on('did-fail-load', (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
      tabData.isLoading = false;
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }

      // Electron leaves a tab whose page could not be loaded blank: show a proper error page instead
      if (shouldShowErrorPage({ errorCode, validatedURL, isMainFrame })) {
        this._showErrorPage(tabData, errorCode, errorDescription, validatedURL);
      }

      // If a popup/new tab aborted because it converted into a download (-3 ERR_ABORTED),
      // cleanly close the empty tab so user stays on their active page
      if (tabData.isPopupTab && errorCode === -3) {
        setTimeout(() => {
          if (this.tabs[tabId] && (!tabData.lastValidUrl || tabData.lastValidUrl === initialUrl)) {
            log.info(`Auto-closing empty popup tab ${tabId} after download handoff`);
            this.closeTab(tabId);
            if (tabData.openerTabId && this.tabs[tabData.openerTabId]) {
              this.switchTab(tabData.openerTabId);
            }
          }
        }, 150);
      }
    });

    // ── Navigation events ──
    const updateTabUa = (targetUrl) => {
      if (!wc || wc.isDestroyed()) return;
      const ua = this._userAgentFor(targetUrl);
      if (ua && wc.getUserAgent() !== ua) wc.setUserAgent(ua);
    };
    this._watchGoogleSignIn(wc, tabData.isIncognito ? this.incognitoWindow : this.mainWindow);

    wc.on('will-navigate', (_, navUrl) => {
      updateTabUa(navUrl);
    });

    wc.on('did-start-navigation', (_, navUrl, isInPlace, isMainFrame) => {
      if (isMainFrame) {
        updateTabUa(navUrl);
        if (!isInPlace && this.passwordAutofill) this.passwordAutofill.forgetTab(tabId);
      }
    });

    wc.on('did-navigate', (_, navUrl) => {
      updateTabUa(navUrl);
      tabData.url = navUrl;
      const isErrorPage = Boolean(navUrl) && navUrl.startsWith('mtc://error');
      if (!isErrorPage) tabData.failedUrl = null;              // a real page loaded: forget the address that failed before
      if (navUrl && !navUrl.startsWith('mtc://crash') && !isErrorPage) {
        tabData.lastValidUrl = navUrl;
        tabData.isCrashed = false;
        tabData.crashReason = null;
      }
      tabData.lastActiveTime = Date.now();
      tabData.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      tabData.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      // Zero history recorded for incognito tabs (Stage 4)
      if (!tabData.isIncognito && !isErrorPage) {
        // tabData.title / favicon still belong to the PREVIOUS page here; the real ones are filled in by the
        // page-title-updated / page-favicon-updated handlers above
        this.storage.addHistory({ title: '', url: navUrl, favicon: '' });
      }
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }
      this._applyYouTubeOptimizer(wc, navUrl);
      // A Google sign-in often completes by redirecting through several Google hosts. Persist the
      // just-issued cookie state at the navigation boundary as well as on the cookie event.
      if (!tabData.isIncognito && /^https?:\/\/([^.]+\.)*google\.com(?:\/|$)/i.test(navUrl || '')) {
        this._flushGoogleLogin('google-navigation');
      }
      this._restoreSiteZoom(tabId, navUrl);
    });

    // ── Find in Page results (Stage 3) ──
    wc.on('found-in-page', (_, result) => {
      const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
      if (targetWin && targetWin.webContents) {
        targetWin.webContents.send('find:result', {
          tabId,
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches,
          finalUpdate: result.finalUpdate
        });
      }
    });

    // ── Page Context Menu (Chrome/Edge Style) ──
    // Pages such as YouTube show their own menu on a right-click on the video and let this one through on a second
    // right-click (like in Chrome); Shift + right-click always opens this one (preload-gesture.js keeps it from the page).
    let contextMenuSeq = 0;
    wc.on('context-menu', async (event, params) => {
      event.preventDefault();
      const seq = ++contextMenuSeq;
      const menu = new Menu();

      // Chromium may report mediaType="none" when a site's player controls or another overlay
      // sits above the real <video>/<audio>. Hit-test the DOM whenever Chromium did not identify media.
      let detectedMedia = null;
      // Chromium can identify the media node but still omit srcURL (notably on Linux after a failed/slow media fetch).
      // Hit-test in that case too, so Save / Copy / Open actions can recover the element's currentSrc/src.
      // The page gets a short moment to answer: a busy or stuck page must never keep the menu from opening.
      if ((params.mediaType !== 'video' && params.mediaType !== 'audio') || !params.srcURL) {
        try {
          const hitX = Math.max(0, Math.round(Number(params.x) || 0));
          const hitY = Math.max(0, Math.round(Number(params.y) || 0));
          const detectionScript = "(function(){var x=" + hitX + ",y=" + hitY + ";var isMedia=function(el){return el&&(el.tagName==='VIDEO'||el.tagName==='AUDIO');};var media=document.elementsFromPoint(x,y).find(isMedia);if(!media){media=document.querySelector('video.html5-main-video, video, audio');if(media){var r=media.getBoundingClientRect();if(!(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom))media=null;}}if(!media)return null;return {kind:media.tagName.toLowerCase(),isPaused:!!media.paused,isMuted:!!media.muted,isLooping:!!media.loop,isControlsVisible:!!media.controls,canToggleControls:true,canShowPictureInPicture:media.tagName==='VIDEO'&&!!(document.pictureInPictureEnabled&&media.requestPictureInPicture),srcURL:media.currentSrc||media.src||''};})()";
          let timer = null;
          detectedMedia = await Promise.race([
            wc.executeJavaScript(detectionScript, true),
            new Promise((resolve) => { timer = setTimeout(() => resolve(null), CONTEXT_MENU_HIT_TEST_MS); })
          ]).finally(() => clearTimeout(timer));
        } catch (err) {
          if (typeof log.debug === 'function') log.debug('Media hit-test unavailable', { error: err.message });
        }
        // a newer right-click (or the tab closing) while the page was asked: only the newest one gets a menu
        if (seq !== contextMenuSeq || wc.isDestroyed()) return;
      }
      // 1. Link items
      if (params.linkURL) {
        menu.append(new MenuItem({
          label: 'Open link in new tab',
          click: () => this.createTab(params.linkURL, tabId, false, tabData.isIncognito)
        }));
        menu.append(new MenuItem({
          label: 'Save link as...',
          click: () => {
            try {
              const sess = tabData.isIncognito ? session.fromPartition('incognito') : session.defaultSession;
              sess.downloadURL(params.linkURL);
            } catch (err) {
              log.error('Save link as failed', { error: err.message });
            }
          }
        }));
        menu.append(new MenuItem({
          label: 'Copy link address',
          click: () => clipboard.writeText(params.linkURL)
        }));
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // 2. Image / Media items
      if (params.hasImageContents || params.mediaType === 'image') {
        const imgSrc = params.srcURL;
        if (imgSrc) {
          menu.append(new MenuItem({
            label: 'Save image as...',
            click: () => {
              try {
                const sess = tabData.isIncognito ? session.fromPartition('incognito') : session.defaultSession;
                sess.downloadURL(imgSrc);
              } catch (err) {
                log.error('Save image as failed', { error: err.message });
              }
            }
          }));
          menu.append(new MenuItem({
            label: 'Copy image',
            click: () => wc.copyImageAt(params.x, params.y)
          }));
          menu.append(new MenuItem({
            label: 'Copy image address',
            click: () => clipboard.writeText(imgSrc)
          }));
          menu.append(new MenuItem({
            label: 'Open image in new tab',
            click: () => this.createTab(imgSrc, tabId, false, tabData.isIncognito)
          }));
          menu.append(new MenuItem({ type: 'separator' }));
        }
      }

      // 2b. Video / audio items (what Chrome offers; pages such as YouTube show their own menu and only let this one
      //     through on a second right-click)
      const effectiveMediaType = (params.mediaType === 'video' || params.mediaType === 'audio')
        ? params.mediaType
        : (detectedMedia && (detectedMedia.kind === 'video' || detectedMedia.kind === 'audio') ? detectedMedia.kind : null);
      if (effectiveMediaType) {
        const kind = effectiveMediaType;
        const flags = params.mediaType === kind ? (params.mediaFlags || {}) : detectedMedia;
        const px = Math.max(0, Math.round(Number(params.x) || 0));
        const py = Math.max(0, Math.round(Number(params.y) || 0));
        // runs `body` with `m` = the <video>/<audio> under the cursor, as a user action (play() and Picture-in-picture need one),
        // and `p` = YouTube's player around it when there is one: play / pause / mute go through the player's own controls
        // there (changing the <video> behind the player's back leaves its buttons showing the wrong state)
        const withMedia = (body) => wc.executeJavaScript(
          `(function(){var m=document.elementsFromPoint(${px},${py}).find(function(e){return e.tagName==='VIDEO'||e.tagName==='AUDIO';});if(!m){m=document.querySelector('video.html5-main-video, video, audio');}if(!m)return;var p=m.closest?m.closest('.html5-video-player'):null;if(!(p&&typeof p.playVideo==='function'&&typeof p.pauseVideo==='function'))p=null;${body}})()`, true
        ).catch((err) => log.warn('Media menu action failed', { error: err.message }));
        const rawMediaUrl = params.srcURL || (detectedMedia && detectedMedia.srcURL) || '';
        const mediaUrl = /^https?:\/\//i.test(rawMediaUrl) ? rawMediaUrl : '';

        menu.append(new MenuItem({ label: flags.isPaused === false ? 'Pause' : 'Play', click: () => withMedia('if(m.paused){if(p){p.playVideo();}else{var r=m.play();if(r&&r.catch)r.catch(function(){});}}else if(p){p.pauseVideo();}else{m.pause();}') }));
        menu.append(new MenuItem({ label: flags.isMuted ? 'Unmute' : 'Mute', click: () => withMedia('if(p&&typeof p.isMuted===\'function\'&&typeof p.mute===\'function\'&&typeof p.unMute===\'function\'){if(p.isMuted()){p.unMute();}else{p.mute();}}else{m.muted=!m.muted;}') }));
        menu.append(new MenuItem({ label: 'Loop', type: 'checkbox', checked: Boolean(flags.isLooping), click: () => withMedia('m.loop=!m.loop;') }));
        if (kind === 'video') {
          menu.append(new MenuItem({
            label: 'Show controls', type: 'checkbox', checked: Boolean(flags.isControlsVisible),
            enabled: flags.canToggleControls !== false, click: () => withMedia('m.controls=!m.controls;')
          }));
          menu.append(new MenuItem({
            label: 'Picture in picture', enabled: flags.canShowPictureInPicture !== false,
            click: () => withMedia('if(document.pictureInPictureElement===m){document.exitPictureInPicture();}else if(m.requestPictureInPicture){m.requestPictureInPicture();}')
          }));
        }
        if (mediaUrl) {
          menu.append(new MenuItem({ type: 'separator' }));
          menu.append(new MenuItem({
            label: `Save ${kind} as...`,
            click: () => {
              try {
                const sess = tabData.isIncognito ? session.fromPartition('incognito') : session.defaultSession;
                sess.downloadURL(mediaUrl);
              } catch (err) {
                log.error('Save media as failed', { error: err.message });
              }
            }
          }));
          menu.append(new MenuItem({ label: `Copy ${kind} address`, click: () => clipboard.writeText(mediaUrl) }));
          menu.append(new MenuItem({ label: `Open ${kind} in new tab`, click: () => this.createTab(mediaUrl, tabId, false, tabData.isIncognito) }));
        }
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // 3. Selection / Text search items
      if (params.selectionText && params.selectionText.trim()) {
        const text = params.selectionText.trim();
        menu.append(new MenuItem({
          label: 'Copy',
          role: 'copy'
        }));
        const truncated = text.length > 25 ? text.slice(0, 25) + '…' : text;
        menu.append(new MenuItem({
          label: `Search Google for "${truncated}"`,
          click: () => this.createTab(`https://www.google.com/search?q=${encodeURIComponent(text)}`, tabId, false, tabData.isIncognito)
        }));
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // 4. Editable (input/textarea) items
      if (params.isEditable) {
        menu.append(new MenuItem({ label: 'Undo', role: 'undo' }));
        menu.append(new MenuItem({ label: 'Redo', role: 'redo' }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
        menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
        menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
        menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
        menu.append(new MenuItem({ type: 'separator' }));
      }

      // 5. General Page Navigation items
      menu.append(new MenuItem({
        label: 'Back',
        enabled: Boolean(tabData.canGoBack),
        click: () => this.goBack(tabId)
      }));
      menu.append(new MenuItem({
        label: 'Forward',
        enabled: Boolean(tabData.canGoForward),
        click: () => this.goForward(tabId)
      }));
      menu.append(new MenuItem({
        label: 'Reload',
        click: () => this.reloadTab(tabId)
      }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: 'Inspect',
        click: () => wc.inspectElement(params.x, params.y)
      }));

      const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
      if (targetWin && !targetWin.isDestroyed()) {
        const popupOptions = { window: targetWin };
        if (params.frame) popupOptions.frame = params.frame;
        if (params.menuSourceType) popupOptions.sourceType = params.menuSourceType;
        menu.popup(popupOptions);
      }
    });

    // ── Credential Capture & Autofill (Stage 6) ──
    // Electron >= 35 passes one `details` object (details.message); the positional (level, message, …)
    // arguments are deprecated and slated for removal, but older runtimes only provide those.
    // (Declared with a single parameter on purpose: Electron prints a deprecation warning for listeners that
    //  declare the positional arguments.)
    const browserApp = this;
    wc.on('console-message', function onConsoleMessage(event) {
      const message = (event && typeof event.message === 'string') ? event.message : arguments[2];
      if (browserApp.passwordAutofill && browserApp.passwordAutofill.handleConsoleMessage(tabId, message)) return;
      if (typeof message === 'string' && message.startsWith('__SHMMOTH_LOGIN_SUBMIT__:')) {
        try {
          const payload = JSON.parse(message.slice(25));
          if (payload && payload.username && payload.password && tabData.url) {
            const origin = new URL(tabData.url).origin;
            browserApp.offerPasswordSave(tabId, origin, payload.username, payload.password);
          }
        } catch (_) {}
      }
    });

    wc.on('dom-ready', () => {
      this._applyYouTubeOptimizer(wc, tabData.url);
      this._attachCredentialAndAutofillHooks(wc, tabData);
      if (this.passwordAutofill) this.passwordAutofill.attach(wc, tabId, tabData);
    });

    wc.on('did-navigate-in-page', (_, navUrl) => {
      tabData.url = navUrl;
      tabData.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      tabData.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      this.broadcastTabsUpdate(tabData.isIncognito);
      const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
      if (activeId === tabId) {
        this.updateNavigationState(tabData.isIncognito);
      }
    });

    // ── URL Security Policy ──
    wc.on('will-navigate', (event, navUrl) => {
      const from   = tabData.url;
      const result = checkNavigation(from, navUrl);
      if (!result.allowed) {
        securityLogger.security(`Navigation blocked in tab ${tabId}`, {
          from: from ? from.slice(0, 120) : '',
          to:   navUrl.slice(0, 120),
          reason: result.reason
        });
        event.preventDefault();
      }
    });

    // ── Popup Policy ──
    wc.setWindowOpenHandler(({ url, disposition }) => {
      // Web content must not be able to open mtc:// pages or local files
      if (isPopupBlocked(url, tabData.url)) {
        securityLogger.security(`Popup blocked`, { url: url.slice(0, 120) });
        return { action: 'deny' };
      }

      // Ad pop-ups and pop-unders: refused before a tab exists (Google sign-in windows are never touched)
      if (this.popupPolicy && !isGoogleAuthUrl(url)) {
        const activeId = tabData.isIncognito ? this.activeIncognitoTabId : this.activeTabId;
        const verdict = this.popupPolicy.decide({
          wcId: wc.id, url, openerUrl: wc.getURL(), openerIsActive: activeId === tabId
        });
        if (!verdict.allow) {
          log.info('Pop-up blocked', { reason: verdict.reason, url: url.slice(0, 120) });
          if (this.adBlocker) this.adBlocker.noteBlockedPopup();
          return { action: 'deny' };
        }
      }

      // If the target URL is a direct downloadable media/binary file, initiate session download directly
      // without opening an unwanted blank tab that has to abort navigation
      const isDirectDownload = /\.(mkv|mp4|avi|mov|m4v|webm|zip|rar|7z|tar|gz|iso|exe|msi|bin|pdf)(\?.*)?$/i.test(url)
        || url.includes('response-content-disposition=attachment')
        || (url.includes('/hub/') && url.includes('cloudflarestorage.com'))
        || url.includes('cdn.pongala.life');

      if (isDirectDownload) {
        log.info(`Direct file download detected from popup: triggering session download`, { url: url.slice(0, 120) });
        const sess = tabData.isIncognito ? session.fromPartition('incognito') : session.defaultSession;
        sess.downloadURL(url);
        return { action: 'deny' };
      }

      // Google OAuth and Single Sign-On popups require window.opener preservation for token exchange
      const isGoogleOAuth = isGoogleAuthUrl(url);

      if (isGoogleOAuth) {
        log.info(`Google OAuth popup permitted with window.opener preserved`, { url: url.slice(0, 120) });
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 680,
            autoHideMenuBar: true,
            title: 'Sign in - Google Accounts',
            webPreferences: {
              preload: PRELOAD_EXTERNAL,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              partition: tabData.isIncognito ? 'incognito' : undefined
            }
          }
        };
      }

      this.createTab(url, tabId, false, tabData.isIncognito, true);
      return { action: 'deny' };
    });

    // When an allowed popup window is created (such as Google OAuth login window)
    wc.on('did-create-window', (childWin, { url: childUrl }) => {
      if (!childWin || !childWin.webContents) return;
      this._applyWebRtcPolicy(childWin.webContents);
      const child = childWin.webContents;
      const updateChildUa = (navUrl) => {
        if (child.isDestroyed()) return;
        const ua = this._userAgentFor(navUrl);
        if (ua && child.getUserAgent() !== ua) child.setUserAgent(ua);
      };
      updateChildUa(childUrl);
      child.on('will-navigate', (_, navUrl) => updateChildUa(navUrl));
      child.on('did-start-navigation', (_, navUrl, isInPlace, isMainFrame) => { if (isMainFrame) updateChildUa(navUrl); });
      this._watchGoogleSignIn(child, childWin);
    });

    // ── Audio & Mute State ──
    wc.on('media-started-playing', () => {
      tabData.isAudible = true;
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    wc.on('media-paused', () => {
      tabData.isAudible = false;
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    // ── Crash & Unresponsive Resilience (Stage 5) ──
    wc.on('render-process-gone', (event, details) => {
      log.error(`Renderer process gone for tab ${tabId}`, { reason: details.reason, exitCode: details.exitCode });
      tabData.isCrashed = true;
      tabData.crashReason = details.reason;
      tabData.isLoading = false;
      this.broadcastTabsUpdate(tabData.isIncognito);

      if (details.reason !== 'clean-exit') {
        const fallbackUrl = tabData.lastValidUrl || tabData.url || 'https://google.com';
        const crashUrl = `mtc://crash?tabId=${tabId}&reason=${encodeURIComponent(details.reason || 'crashed')}&url=${encodeURIComponent(fallbackUrl)}`;
        wc.loadURL(crashUrl).catch(() => {});
      }
    });

    wc.on('unresponsive', () => {
      log.warn(`Tab ${tabId} became unresponsive`);
      tabData.isUnresponsive = true;
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    wc.on('responsive', () => {
      log.info(`Tab ${tabId} resumed responsiveness`);
      tabData.isUnresponsive = false;
      this.broadcastTabsUpdate(tabData.isIncognito);
    });

    // ── HTML5 Fullscreen (YouTube, HTML5 Video, Canvas) ──
    wc.on('enter-html-full-screen', () => {
      const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
      if (!targetWin || targetWin.isDestroyed()) return;

      tabData.isHtmlFullScreen = true;
      targetWin._wasMaximizedBeforeFullscreen = targetWin.isMaximized();

      targetWin.setFullScreen(true);
      this.updateViewBounds(targetWin);

      if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
        targetWin.webContents.send('window:fullscreen-change', {
          isFullScreen: true,
          isHtmlFullScreen: true,
          tabId: tabData.id
        });
      }
      log.info(`Tab ${tabId} entered HTML full screen`);
    });

    wc.on('leave-html-full-screen', () => {
      const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
      if (!targetWin || targetWin.isDestroyed()) return;

      tabData.isHtmlFullScreen = false;

      targetWin.setFullScreen(false);
      if (targetWin._wasMaximizedBeforeFullscreen) {
        targetWin.maximize();
      }
      this.updateViewBounds(targetWin);
      setTimeout(() => {
        if (targetWin && !targetWin.isDestroyed()) {
          this.updateViewBounds(targetWin);
        }
      }, 100);

      if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
        targetWin.webContents.send('window:fullscreen-change', {
          isFullScreen: false,
          isHtmlFullScreen: false,
          tabId: tabData.id
        });
      }
      log.info(`Tab ${tabId} left HTML full screen`);
    });

    // ── Keyboard Shortcuts inside WebContents (e.g. F11 Fullscreen) ──
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        event.preventDefault();
        const targetWin = tabData.isIncognito ? this.incognitoWindow : this.mainWindow;
        if (targetWin && !targetWin.isDestroyed()) {
          const nextState = !targetWin.isFullScreen();
          tabData.isHtmlFullScreen = nextState;
          if (nextState) {
            targetWin._wasMaximizedBeforeFullscreen = targetWin.isMaximized();
            targetWin.setFullScreen(true);
          } else {
            targetWin.setFullScreen(false);
            if (targetWin._wasMaximizedBeforeFullscreen) {
              targetWin.maximize();
            }
          }
          this.updateViewBounds(targetWin);
          setTimeout(() => {
            if (targetWin && !targetWin.isDestroyed()) this.updateViewBounds(targetWin);
          }, 100);
          if (targetWin.webContents && !targetWin.webContents.isDestroyed()) {
            targetWin.webContents.send('window:fullscreen-change', {
              isFullScreen: nextState,
              isHtmlFullScreen: nextState,
              tabId: tabData.id
            });
          }
        }
      }
    });

    // Load initial URL (a restored background tab waits until it is selected)
    if (!tabData.pendingLoadUrl) wc.loadURL(initialUrl);

    if (options.background) this.broadcastTabsUpdate(isIncognito);
    else this.switchTab(tabId);
    log.info(`Tab created: ${tabId}`, { url: initialUrl, isPinned, isIncognito, deferred: Boolean(tabData.pendingLoadUrl) });
    return tabId;
  }

  _getLastPinnedIndex(isIncognito = false) {
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    let idx = -1;
    for (let i = 0; i < order.length; i++) {
      const t = this.tabs[order[i]];
      if (t && t.isPinned) idx = i;
    }
    return idx;
  }

  _reorderPinnedFirst(isIncognito = false) {
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    const pinned = [];
    const unpinned = [];
    for (const id of order) {
      const tab = this.tabs[id];
      if (tab && tab.isPinned) pinned.push(id);
      else if (tab) unpinned.push(id);
    }
    if (isIncognito) {
      this.incognitoTabOrder = [...pinned, ...unpinned];
    } else {
      this.tabOrder = [...pinned, ...unpinned];
    }
  }

  switchTab(tabId) {
    const currentTab = this.tabs[tabId];
    if (!currentTab) return;

    this.closePermissionBubble();
    this.closeExtensionBubble();
    this.closeShieldBubble();
    this.closeDownloadBubble();
    if (this.passwordAutofill) this.passwordAutofill.dismiss();

    const isIncognito = Boolean(currentTab.isIncognito);
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    const prevActiveId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;

    const prevActiveTab = this.tabs[prevActiveId];
    if (prevActiveTab && prevActiveTab.view && targetWin && !targetWin.isDestroyed()) {
      try { targetWin.contentView.removeChildView(prevActiveTab.view); } catch (_) {}
    }

    if (prevActiveTab && prevActiveTab.isHtmlFullScreen) {
      prevActiveTab.isHtmlFullScreen = false;
      if (targetWin && !targetWin.isDestroyed() && targetWin.isFullScreen()) {
        targetWin.setFullScreen(false);
      }
    }

    if (isIncognito) {
      this.activeIncognitoTabId = tabId;
    } else {
      this.activeTabId = tabId;
    }

    currentTab.lastActiveTime = Date.now();
    this._loadPendingUrl(currentTab);

    if (currentTab.isSleeping && this.ramSaver && !isIncognito) {
      this.ramSaver.wakeTab(tabId, currentTab);
    }

    if (targetWin && !targetWin.isDestroyed() && currentTab.view) {
      targetWin.contentView.addChildView(currentTab.view);
      this.updateViewBounds(targetWin);
    }

    this.broadcastTabsUpdate(isIncognito);
    this.updateNavigationState(isIncognito);

    if (targetWin && !targetWin.isDestroyed() && targetWin.webContents && currentTab.view && currentTab.view.webContents) {
      try {
        const factor = currentTab.view.webContents.getZoomFactor();
        targetWin.webContents.send('zoom:changed', { tabId, zoomFactor: factor });
      } catch (_) {}
    }
  }

  /** Replaces a blank, failed page with mtc://error (the failed address stays what the address bar shows). */
  _showErrorPage(tab, errorCode, errorDescription, failedUrl) {
    if (!tab || !tab.view) return;
    log.warn(`Page failed to load in ${tab.id}`, { errorCode, errorDescription, url: String(failedUrl).slice(0, 200) });
    tab.failedUrl = failedUrl;
    // not inside the did-fail-load event itself: starting a navigation from there can race with the failed one
    setImmediate(() => {
      const wc = tab.view && tab.view.webContents;
      if (!this.tabs[tab.id] || !wc || wc.isDestroyed()) return;
      wc.loadURL(buildErrorPageUrl(errorCode, errorDescription, failedUrl)).catch(() => {});
    });
  }

  /** A restored background tab has not loaded its page yet; do it now (selected, reloaded or navigated). */
  _loadPendingUrl(tab) {
    if (!tab || !tab.pendingLoadUrl) return;
    const url = tab.pendingLoadUrl;
    tab.pendingLoadUrl = null;
    if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.loadURL(url).catch(() => {});
    }
  }

  closeTab(tabId) {
    const tabData = this.tabs[tabId];
    if (!tabData) return;

    this.closePermissionBubble();
    this.closeExtensionBubble();
    this.closeShieldBubble();
    if (this.passwordAutofill) this.passwordAutofill.forgetTab(tabId);
    try { if (this.popupPolicy && tabData.view && tabData.view.webContents) this.popupPolicy.forget(tabData.view.webContents.id); } catch (_) {}

    const isIncognito = Boolean(tabData.isIncognito);
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    const targetOrder = isIncognito ? this.incognitoTabOrder : this.tabOrder;

    if (tabData.isHtmlFullScreen) {
      tabData.isHtmlFullScreen = false;
      if (targetWin && !targetWin.isDestroyed() && targetWin.isFullScreen()) {
        targetWin.setFullScreen(false);
      }
    }

    // Track closed tab for Reopen Closed Tab (Ctrl+Shift+T) ONLY for standard tabs
    const closedUrl = displayUrl(tabData);
    if (!isIncognito && closedUrl && !closedUrl.startsWith('mtc://newtab') && !closedUrl.startsWith('about:blank')) {
      this.closedTabs.push({ url: closedUrl, title: tabData.title || closedUrl });
      if (this.closedTabs.length > 25) {
        this.closedTabs.shift();
      }
    }

    if (targetWin && !targetWin.isDestroyed() && tabData.view) {
      try { targetWin.contentView.removeChildView(tabData.view); } catch (_) {}
      if (tabData.view.webContents) {
        try { tabData.view.webContents.close(); } catch (_) {}
      }
    }

    delete this.tabs[tabId];
    const filtered = targetOrder.filter(id => id !== tabId);
    if (isIncognito) {
      this.incognitoTabOrder = filtered;
    } else {
      this.tabOrder = filtered;
    }

    log.info(`Tab closed: ${tabId} (incognito: ${isIncognito})`);

    const activeId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;
    if (activeId === tabId) {
      if (filtered.length > 0) {
        this.switchTab(filtered[filtered.length - 1]);
      } else {
        if (isIncognito && targetWin && !targetWin.isDestroyed()) {
          targetWin.close();
        } else {
          this.createTab('mtc://newtab', null, false, false);
        }
      }
    } else {
      this.broadcastTabsUpdate(isIncognito);
    }
  }

  duplicateTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab) return null;
    return this.createTab(displayUrl(tab), tab.id, tab.isPinned, tab.isIncognito);
  }

  togglePinTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab) return;
    tab.isPinned = !tab.isPinned;
    this._reorderPinnedFirst(tab.isIncognito);
    this.broadcastTabsUpdate(tab.isIncognito);
    log.info(`Tab ${tab.id} pin toggled: ${tab.isPinned}`);
  }

  reorderTabs(tabId, targetIndex) {
    const tab = this.tabs[tabId];
    if (!tab) return;
    const isIncognito = Boolean(tab.isIncognito);
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    if (!order.includes(tabId)) return;
    const fromIndex = order.indexOf(tabId);
    if (fromIndex === targetIndex || targetIndex < 0 || targetIndex >= order.length) return;

    order.splice(fromIndex, 1);
    order.splice(targetIndex, 0, tabId);

    this._reorderPinnedFirst(isIncognito);
    this.broadcastTabsUpdate(isIncognito);
    log.info(`Tab ${tabId} reordered to index ${targetIndex} (incognito: ${isIncognito})`);
  }

  closeOtherTabs(tabId) {
    const keepId = tabId || this.activeTabId;
    const targetTab = this.tabs[keepId];
    if (!targetTab) return;

    const isIncognito = Boolean(targetTab.isIncognito);
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    const toClose = [];

    for (const id of order) {
      if (id === keepId) continue;
      const tab = this.tabs[id];
      if (!targetTab.isPinned && tab.isPinned) continue;
      toClose.push(id);
    }

    for (const id of toClose) {
      this.closeTab(id);
    }
  }

  closeTabsToRight(tabId) {
    const fromId = tabId || this.activeTabId;
    const fromTab = this.tabs[fromId];
    if (!fromTab) return;

    const isIncognito = Boolean(fromTab.isIncognito);
    const order = isIncognito ? this.incognitoTabOrder : this.tabOrder;
    const idx = order.indexOf(fromId);
    if (idx === -1) return;

    const toClose = [];
    for (let i = idx + 1; i < order.length; i++) {
      const id = order[i];
      const tab = this.tabs[id];
      if (tab && !tab.isPinned) {
        toClose.push(id);
      }
    }

    for (const id of toClose) {
      this.closeTab(id);
    }
  }

  reopenClosedTab() {
    if (this.closedTabs.length === 0) return null;
    const lastClosed = this.closedTabs.pop();
    log.info('Reopening closed tab', { url: lastClosed.url });
    return this.createTab(lastClosed.url);
  }

  stopTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (tab && tab.view && tab.view.webContents) {
      tab.view.webContents.stop();
      tab.isLoading = false;
      this.broadcastTabsUpdate();
      this.updateNavigationState();
    }
  }

  reloadTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab || !tab.view) return;
    if (tab.pendingLoadUrl) { this._loadPendingUrl(tab); return; }      // restored tab that never loaded: "reload" = load
    if (tab.failedUrl && tab.url && tab.url.startsWith('mtc://error')) { tab.view.webContents.loadURL(tab.failedUrl); return; }
    if (tab.isCrashed || (tab.url && tab.url.startsWith('mtc://crash'))) {
      tab.isCrashed = false;
      const target = tab.lastValidUrl && !tab.lastValidUrl.startsWith('mtc://crash') ? tab.lastValidUrl : 'mtc://newtab';
      tab.view.webContents.loadURL(target);
      return;
    }
    tab.view.webContents.reload();
  }

  reloadTabIgnoringCache(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (tab && tab.pendingLoadUrl) { this._loadPendingUrl(tab); return; }
    if (tab && tab.view && tab.failedUrl && tab.url && tab.url.startsWith('mtc://error')) { tab.view.webContents.loadURL(tab.failedUrl); return; }
    if (tab && tab.view && tab.view.webContents) {
      tab.view.webContents.reloadIgnoringCache();
    }
  }

  toggleMuteTab(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (tab && tab.view && tab.view.webContents) {
      const wc = tab.view.webContents;
      const muted = wc.isAudioMuted();
      wc.setAudioMuted(!muted);
      tab.isMuted = !muted;
      this.broadcastTabsUpdate();
    }
  }

  // ─── Zoom & Page View Controls (Stage 3) ───────────────────────────────────

  getZoomFactor(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (tab && tab.view && tab.view.webContents) {
      try {
        return tab.view.webContents.getZoomFactor();
      } catch (_) {
        return 1.0;
      }
    }
    return 1.0;
  }

  zoomIn(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab || !tab.view || !tab.view.webContents) return 1.0;
    try {
      const current = tab.view.webContents.getZoomFactor();
      const next = ZOOM_LEVELS.find(lvl => lvl > current + 0.01) || ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
      tab.view.webContents.setZoomFactor(next);
      this._saveSiteZoom(tab.url, next);
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('zoom:changed', { tabId: tab.id, zoomFactor: next });
      }
      return next;
    } catch (err) {
      log.warn('zoomIn failed', { error: err.message });
      return 1.0;
    }
  }

  zoomOut(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab || !tab.view || !tab.view.webContents) return 1.0;
    try {
      const current = tab.view.webContents.getZoomFactor();
      const prev = [...ZOOM_LEVELS].reverse().find(lvl => lvl < current - 0.01) || ZOOM_LEVELS[0];
      tab.view.webContents.setZoomFactor(prev);
      this._saveSiteZoom(tab.url, prev);
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('zoom:changed', { tabId: tab.id, zoomFactor: prev });
      }
      return prev;
    } catch (err) {
      log.warn('zoomOut failed', { error: err.message });
      return 1.0;
    }
  }

  resetZoom(tabId) {
    const tab = this.tabs[tabId || this.activeTabId];
    if (!tab || !tab.view || !tab.view.webContents) return 1.0;
    try {
      tab.view.webContents.setZoomFactor(1.0);
      this._saveSiteZoom(tab.url, 1.0);
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('zoom:changed', { tabId: tab.id, zoomFactor: 1.0 });
      }
      return 1.0;
    } catch (err) {
      log.warn('resetZoom failed', { error: err.message });
      return 1.0;
    }
  }

  _getSiteKey(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  _saveSiteZoom(url, factor) {
    const key = this._getSiteKey(url);
    if (!key || !this.storage) return;
    try {
      const siteZoom = this.storage.get('siteZoom', {});
      if (Math.abs(factor - 1.0) < 0.01) {
        delete siteZoom[key];
      } else {
        siteZoom[key] = factor;
      }
      this.storage.set('siteZoom', siteZoom);
    } catch (err) {
      log.warn('Could not save site zoom', { error: err.message });
    }
  }

  _restoreSiteZoom(tabId, url) {
    const tab = this.tabs[tabId];
    if (!tab || !tab.view || !tab.view.webContents) return;
    const isIncognito = Boolean(tab.isIncognito);
    const targetWin = isIncognito ? this.incognitoWindow : this.mainWindow;
    const activeId = isIncognito ? this.activeIncognitoTabId : this.activeTabId;

    const key = this._getSiteKey(url);
    let factor = 1.0;
    if (key && this.storage) {
      try {
        const siteZoom = this.storage.get('siteZoom', {});
        if (siteZoom && siteZoom[key]) {
          factor = siteZoom[key];
        }
      } catch (_) {}
    }
    try {
      tab.view.webContents.setZoomFactor(factor);
      if (targetWin && !targetWin.isDestroyed() && targetWin.webContents && tabId === activeId) {
        targetWin.webContents.send('zoom:changed', { tabId, zoomFactor: factor });
      }
    } catch (err) {
      log.warn('Could not restore site zoom', { error: err.message });
    }
  }

  // ─── Omnibox URL / Search Classification (Stage 1) ───────────────────────

  formatUrl(input) {
    let target = (input || '').trim();
    if (!target) return 'mtc://newtab';

    // Block dangerous schemes in raw input
    if (/^(javascript|data|vbscript):/i.test(target)) {
      securityLogger.security(`formatUrl blocked dangerous input: ${target.slice(0, 64)}`);
      return 'mtc://newtab';
    }

    let finalUrl;

    // 1. Internal schemes or file protocol
    if (target.startsWith('mtc://') || target.startsWith('file://') || target.startsWith('about:')) {
      finalUrl = target;
    }
    // 2. Contains any whitespace -> definitely search query (e.g. "steel casting manufacturers India")
    else if (/\s/.test(target)) {
      finalUrl = this._getSearchUrl(target);
    }
    // 3. Explicit HTTP / HTTPS
    else if (/^https?:\/\//i.test(target)) {
      finalUrl = target;
    }
    // 4. Localhost or IP address (e.g. localhost, localhost:3000, 127.0.0.1, 192.168.1.1:8080)
    else if (
      /^localhost(:\d+)?(\/.*)?$/i.test(target) ||
      /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/.test(target)
    ) {
      finalUrl = 'http://' + target;
    }
    // 5. Standard domain name with valid TLD (e.g. github.com, example.org/path?a=1)
    else if (/^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(target)) {
      finalUrl = 'https://' + target;
    }
    // 6. Otherwise -> search query
    else {
      finalUrl = this._getSearchUrl(target);
    }

    if (!isSafeToLoad(finalUrl) && !finalUrl.startsWith('mtc://')) {
      return 'mtc://newtab';
    }

    return finalUrl;
  }

  _getSearchUrl(query) {
    const settings   = this.storage ? this.storage.getSettings() : {};
    const engine     = (settings.searchEngine || 'google').toLowerCase();
    const defaultUrls = {
      google:     'https://www.google.com/search?q=',
      bing:       'https://www.bing.com/search?q=',
      duckduckgo: 'https://duckduckgo.com/?q=',
      yahoo:      'https://search.yahoo.com/search?p='
    };
    const engineUrls = Object.assign({}, defaultUrls, settings.searchEngineUrls || {});
    const baseUrl = engineUrls[engine] || defaultUrls[engine] || defaultUrls['google'];
    return baseUrl + encodeURIComponent(query);
  }

  // ─── YouTube ads ─────────────────────────────────────────────────────────
  //
  // The filter lists remove most YouTube ads before the player sees them (uBlock's YouTube rules, run at document start
  // by preload-scriptlets.js). This is only the last resort for an ad that still starts, and it must never get in the
  // way of the user. Up to 1.1.13 it did: every 100 ms it called play() whenever an anti-adblock notice was anywhere in
  // the page (pause was impossible), muted the video / set it to 16x / jumped to its end whenever an ad element was left
  // over in the player (also during the real video; with ads stitched into the stream that skipped the whole video),
  // clicked every "#dismiss-button" of the page, and hid the anti-adblock dialog but not its backdrop, which then took
  // every click on the player. Now:
  //   - it acts only while YouTube itself marks the player as showing an ad (class "ad-showing" on the main player)
  //   - during the ad: muted and 16x, a skip button inside the player is pressed; afterwards mute and speed are put back
  //     as they were (only what it changed itself)
  //   - it never calls play() / pause(), never seeks, never touches dialogs; ad boxes outside the player are hidden
  _applyYouTubeOptimizer(wc, currentUrl) {
    let host = '';
    try { host = new URL(currentUrl).hostname.toLowerCase(); } catch (_) { return; }
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return;
    // part of the ad blocker: it has to stop when the user switches the blocker off (everywhere, or for this site)
    if (this.adBlocker && !this.adBlocker.isActiveFor(host)) return;

    wc.insertCSS(`
      ytd-banner-promo-renderer, ytd-ad-slot-renderer,
      ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer,
      ytd-promoted-video-renderer, ytd-display-ad-renderer,
      ytd-statement-banner-renderer, .ytp-ad-overlay-container,
      .ytp-ad-message-container, .ytp-ad-overlay-slot,
      #player-ads, #masthead-ad,
      ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
      ytd-item-section-renderer:has(ytd-ad-slot-renderer),
      ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
      ytd-companion-slot-renderer { display: none !important; }
    `, { cssOrigin: 'user' }).catch(() => {});

    wc.executeJavaScript(`
      (function () {
        if (window.__shmmothYouTubeAds) return;
        window.__shmmothYouTubeAds = true;
        var SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern';
        var FAST = 16;
        var player = null, observer = null;
        var saved = null;                                  // { video, muted, rate } while an ad plays
        function check() {
          if (!player || !player.isConnected) return;
          var video = player.querySelector('video.html5-main-video') || player.querySelector('video');
          if (player.classList.contains('ad-showing') && video) {
            if (!saved || saved.video !== video) saved = { video: video, muted: video.muted, rate: video.playbackRate };
            if (!video.muted) video.muted = true;
            if (video.playbackRate !== FAST) { try { video.playbackRate = FAST; } catch (e) {} }
            var skip = player.querySelector(SKIP);
            if (skip && typeof skip.click === 'function') skip.click();
          } else if (saved) {
            var v = saved.video;
            if (v && v.isConnected) {
              if (v.muted && !saved.muted) v.muted = false;
              if (v.playbackRate === FAST) { try { v.playbackRate = saved.rate > 0 && saved.rate !== FAST ? saved.rate : 1; } catch (e) {} }
            }
            saved = null;
          }
        }
        function attach() {
          var p = document.querySelector('#movie_player.html5-video-player') || document.querySelector('.html5-video-player');
          if (p !== player) {
            if (observer) observer.disconnect();
            observer = null;
            player = p;
            if (p && window.MutationObserver) {
              observer = new MutationObserver(check);
              observer.observe(p, { attributes: true, attributeFilter: ['class'] });
            }
          }
          check();
        }
        attach();
        setInterval(attach, 500);
      })();
    `).catch(() => {});
  }
}

module.exports = TabsMethods;
