// The imports and constants the main-process modules share (formerly the top of main.js). Only definitions:
// everything that has an effect (command-line switches, the User-Agent fallback, the mtc:// scheme) stays in
// main.js, which runs it before the app is ready.
'use strict';

const SRC_DIR = require('path').join(__dirname, '..');   // src/ (the pages, preloads and renderer live there)

const { app, BrowserWindow, WebContentsView, protocol, net, ipcMain, session, dialog, Menu, MenuItem, clipboard, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

const StorageService   = require('../services/storage');
const AdBlockerService = require('../services/adblocker');
const PopupPolicy      = require('../services/popupPolicy');
const GoogleSignIn     = require('../services/googleSignIn');
const PasswordGate     = require('../services/passwordGate');
const RamSaverService  = require('../services/ramSaver');
const DownloadManager  = require('../services/downloadManager');
const { PasswordVault }   = require('../services/passwordVault');
const { PasswordAutofill } = require('../services/passwordAutofill');
const { FormAutofill } = require('../services/formAutofill');
const { PrivacyShield, siteOf } = require('../services/privacyShield');
const webRequestHub = require('../services/webRequestHub');
const { AutofillService } = require('../services/autofillService');
const { ProxyManager }    = require('../services/proxyManager');
const ExtensionManager    = require('../services/extensionManager');
const UpdateManager       = require('../services/updateManager');
const { SessionStore, buildSnapshot } = require('../services/sessionStore');

const { secureHandlerRaw, validateUrl, sanitizeString, getSenderUrl } = require('../security/ipcSecurity');
const { checkNavigation, isPopupBlocked, isSafeToLoad }  = require('../security/urlPolicy');
const { isTrustedInternalUrl, BROWSER_CHROME_URL }        = require('../security/trustedPages');
const { MTC_PAGE_CSP }                                    = require('../security/csp');
const { mainLogger: log, securityLogger }                 = require('../utils/logger');
const { urlsFromArgv }                                    = require('../utils/launchArgs');
const { shouldShowErrorPage, buildErrorPageUrl, displayUrl } = require('../utils/errorPage');
const secureDns = require('../services/secureDns');
const { isAlwaysAllowedPermission } = require('../security/permissionPolicy');

// The UA / Client-Hints strings we present must match the Chromium that is actually running; a
// hard-coded version drifts apart from the engine on every Electron upgrade (and looks inconsistent
// to anti-bot checks). Always derive it from the runtime.
const CHROME_MAJOR = String((process.versions && process.versions.chrome) || '130').split('.')[0];
const CHROME_REDUCED = `Chrome/${CHROME_MAJOR}.0.0.0`;
const DESKTOP_UA_FALLBACK = `Mozilla/5.0 (${GoogleSignIn.osToken(process.platform)}) AppleWebKit/537.36 (KHTML, like Gecko) ${CHROME_REDUCED} Safari/537.36`;

// Google's sign-in pages (accounts.google.com, accounts.youtube.com): see services/googleSignIn.js for how the browser
// presents itself there. Nothing else about the browser is disguised — pages see the engine's own, native values.
function isGoogleAuthUrl(url) {
  return GoogleSignIn.isSignInUrl(url);
}

// ─── Preload path constants ───────────────────────────────────────────────────
const PRELOAD_INTERNAL = path.join(SRC_DIR, 'preload-internal.js');
const PRELOAD_EXTERNAL = path.join(SRC_DIR, 'preload-external.js');

// ─── Standard Zoom Levels (Stage 3) ───────────────────────────────────────────
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

// How long the right-click menu waits for the page to say whether a video / audio is under the cursor
const CONTEXT_MENU_HIT_TEST_MS = 250;

/**
 * Returns the correct preload path for a given URL.
 * Trusted internal pages (mtc:// and the exact app-shipped file:// documents)
 * → full API preload. Everything else, including arbitrary local files, →
 * empty/minimal external preload.
 *
 * @param {string} url
 * @returns {string} absolute path to preload file
 */
function selectPreload(url) {
  return isTrustedInternalUrl(url) ? PRELOAD_INTERNAL : PRELOAD_EXTERNAL;
}


module.exports = {
  AdBlockerService,
  app,
  AutofillService,
  BROWSER_CHROME_URL,
  BrowserWindow,
  buildErrorPageUrl,
  buildSnapshot,
  checkNavigation,
  CHROME_MAJOR,
  CHROME_REDUCED,
  clipboard,
  CONTEXT_MENU_HIT_TEST_MS,
  DESKTOP_UA_FALLBACK,
  dialog,
  displayUrl,
  DownloadManager,
  ExtensionManager,
  fs,
  getSenderUrl,
  GoogleSignIn,
  ipcMain,
  isAlwaysAllowedPermission,
  isGoogleAuthUrl,
  isPopupBlocked,
  isSafeToLoad,
  isTrustedInternalUrl,
  log,
  Menu,
  MenuItem,
  MTC_PAGE_CSP,
  net,
  PasswordAutofill,
  FormAutofill,
  PrivacyShield,
  siteOf,
  webRequestHub,
  PasswordGate,
  PasswordVault,
  path,
  PopupPolicy,
  PRELOAD_EXTERNAL,
  PRELOAD_INTERNAL,
  protocol,
  ProxyManager,
  RamSaverService,
  sanitizeString,
  screen,
  secureDns,
  secureHandlerRaw,
  securityLogger,
  selectPreload,
  session,
  SessionStore,
  shouldShowErrorPage,
  SRC_DIR,
  StorageService,
  UpdateManager,
  urlsFromArgv,
  validateUrl,
  WebContentsView,
  ZOOM_LEVELS
};
