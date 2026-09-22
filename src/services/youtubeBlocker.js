/**
 * @deprecated — LEGACY REFERENCE FILE (not loaded by the application)
 *
 * This file contains a renderer-side content-script implementation of the
 * YouTube ad-skip engine. It is NOT used by the browser.
 *
 * CANONICAL IMPLEMENTATION:
 *   main.js → MtcBrowserApp._applyYouTubeOptimizer(wc, url)
 *
 * The main-process injection approach (via wc.insertCSS + wc.executeJavaScript)
 * is more reliable and does not require this file to be loaded as a preload.
 *
 * This file is preserved here for reference only.
 * Do NOT require() or import this file.
 */

// YouTube Ad Neutralizer & Auto-Skip Engine for MTC BROWSER (LEGACY)

function initYouTubeAdBlocker() {
  if (!window.location.hostname.includes('youtube.com')) return;

  // 1. Inject CSS to hide all display, banner, promoted, and overlay ads
  const injectStyle = () => {
    if (document.getElementById('mtc-yt-adblock-css')) return;
    const style = document.createElement('style');
    style.id = 'mtc-yt-adblock-css';
    style.textContent = `
      ytd-banner-promo-renderer,
      ytd-ad-slot-renderer,
      ytd-in-feed-ad-layout-renderer,
      ytd-promoted-sparkles-web-renderer,
      ytd-promoted-video-renderer,
      ytd-display-ad-renderer,
      ytd-statement-banner-renderer,
      .ytp-ad-overlay-container,
      .ytp-ad-message-container,
      .ytp-ad-action-interstitial,
      #player-ads,
      #masthead-ad,
      ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
      ytd-item-section-renderer:has(ytd-ad-slot-renderer),
      ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
      tp-yt-paper-dialog:has(ytd-enforcement-message-view-model),
      .ytp-ad-preview-container,
      .ytp-ad-overlay-slot,
      ytd-companion-slot-renderer {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  // 2. Inject Main-World Script to intercept ytInitialPlayerResponse & player fetch
  const injectMainWorldScript = () => {
    if (document.getElementById('mtc-yt-main-world-script')) return;
    const script = document.createElement('script');
    script.id = 'mtc-yt-main-world-script';
    script.textContent = `
      (function() {
        function cleanPlayerResponse(response) {
          if (!response) return response;
          if (response.adPlacements) delete response.adPlacements;
          if (response.playerAds) delete response.playerAds;
          if (response.adSlots) delete response.adSlots;
          return response;
        }

        // Clean existing ytInitialPlayerResponse if present
        if (window.ytInitialPlayerResponse) {
          cleanPlayerResponse(window.ytInitialPlayerResponse);
        }

        // Intercept fetch for player and next video responses
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const response = await originalFetch.apply(this, args);
          try {
            const url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';
            if (url && (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next'))) {
              const clone = response.clone();
              const text = await clone.text();
              try {
                const data = JSON.parse(text);
                cleanPlayerResponse(data);
                return new Response(JSON.stringify(data), {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers
                });
              } catch (e) {
                return response;
              }
            }
          } catch (err) {}
          return response;
        };
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
  };

  // 3. Fast-forward & Auto-skip Video Ads Engine
  let lastWasAd = false;
  let originalMutedState = false;

  function checkAndSkipAds() {
    const player = document.querySelector('.html5-video-player');
    const video = document.querySelector('video.html5-main-video');

    // Check if player is in ad-showing mode
    const isAdShowing = player && (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting') ||
      document.querySelector('.ytp-ad-player-overlay') ||
      document.querySelector('.ytp-ad-text') ||
      document.querySelector('.ytp-ad-preview-text')
    );

    if (isAdShowing && video) {
      if (!lastWasAd) {
        originalMutedState = video.muted;
        lastWasAd = true;
      }

      // Mute ad audio so user hears nothing
      video.muted = true;

      // 16x speed up playback
      video.playbackRate = 16.0;

      // Jump straight to the end of the ad video
      if (isFinite(video.duration) && video.duration > 0) {
        video.currentTime = video.duration;
      }
    } else if (lastWasAd) {
      // Ad finished, restore regular playback rate and sound
      lastWasAd = false;
      if (video) {
        video.playbackRate = 1.0;
        video.muted = originalMutedState;
      }
    }

    // Auto click skip buttons
    const skipSelectors = [
      '.ytp-ad-skip-button',
      '.ytp-ad-skip-button-modern',
      '.ytp-skip-ad-button',
      'button.ytp-ad-skip-button-icon',
      '.ytp-ad-overlay-close-button',
      '#dismiss-button'
    ];

    for (const selector of skipSelectors) {
      const btn = document.querySelector(selector);
      if (btn && typeof btn.click === 'function') {
        btn.click();
      }
    }

    // Dismiss any "Ad blockers violate terms" popup automatically
    const dismissDialog = document.querySelector('tp-yt-paper-dialog:has(ytd-enforcement-message-view-model) #dismiss-button, ytd-enforcement-message-view-model button');
    if (dismissDialog) {
      dismissDialog.click();
      if (video && video.paused) {
        video.play();
      }
    }
  }

  // Run on initial load, interval, and SPA navigation
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectStyle();
      injectMainWorldScript();
    });
  } else {
    injectStyle();
    injectMainWorldScript();
  }

  // Fast check loop (every 100ms)
  setInterval(checkAndSkipAds, 100);

  // SPA navigation listener
  window.addEventListener('yt-navigate-finish', () => {
    injectStyle();
    checkAndSkipAds();
  });
}

module.exports = initYouTubeAdBlocker;
