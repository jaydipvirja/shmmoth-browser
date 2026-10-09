/**
 * GOOGLE LOGIN VERIFICATION TEST (talks to the live accounts.google.com; kept for manual use, not in the automated suite)
 *
 * Verifies, with the identity the browser shows on Google's sign-in pages (services/googleSignIn.js):
 * 1. The User-Agent does not leak 'Electron/'.
 * 2. Nothing is disguised: navigator.userAgentData is the engine's own (native functions, no "Google Chrome").
 * 3. DOM navigator.webdriver is false.
 * 4. Window does not expose shmmothBrowser or mtcBrowser to external pages.
 * 5. Google serves the normal sign-in (GlifWebSignIn), not the degraded one it gives to browsers it recognises as
 *    embedded (WebLiteSignIn).
 * A real sign-in can only be checked by hand: enter an account and see that Google asks for the password.
 *
 * Run with: node .\node_modules\electron\cli.js tests/google-login-verification.test.js
 * (PROFILE=chrome|firefox to check another identity)
 */

'use strict';

const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const GoogleSignIn = require('../src/services/googleSignIn');

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

const PRELOAD_EXTERNAL = path.join(__dirname, '..', 'src', 'preload-external.js');
const PROFILE = process.env.PROFILE || 'app';

app.whenReady().then(async () => {
  console.log('══════════════════════════════════════════════════════════');
  console.log('   Google Sign-In Compatibility Verification Test        ');
  console.log('══════════════════════════════════════════════════════════');

  const ua = GoogleSignIn.userAgentOf(PROFILE, {
    platform: process.platform, chromeVersion: process.versions.chrome, appVersion: require('../package.json').version
  });
  console.log('  identity:', PROFILE, '—', ua);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'google_verify_test',
      preload: PRELOAD_EXTERNAL,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setUserAgent(ua);

  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      failed++;
    }
  }

  try {
    console.log('\n📋 1. Loading accounts.google.com...');
    await win.loadURL('https://accounts.google.com');
    await new Promise(r => setTimeout(r, 2000));

    const finalUrl = win.webContents.getURL();
    const title = win.getTitle();

    assert(finalUrl.includes('accounts.google.com'), 'Successfully loaded accounts.google.com');
    assert(finalUrl.includes('flowName=GlifWebSignIn'), 'Uses modern GlifWebSignIn (not degraded WebLiteSignIn)');
    assert(!finalUrl.includes('rejected'), 'Not rejected on initial access');

    console.log('\n📋 2. Inspecting DOM Fingerprint in Webpage...');
    const domInfo = await win.webContents.executeJavaScript(`({
      ua: navigator.userAgent,
      hasElectron: /Electron/i.test(navigator.userAgent),
      brands: navigator.userAgentData ? navigator.userAgentData.brands : [],
      nativeBrands: navigator.userAgentData ? /\\[native code\\]/.test(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator.userAgentData), 'brands').get.toString()) : null,
      webdriver: navigator.webdriver,
      hasShmmothBrowser: 'shmmothBrowser' in window,
      hasMtcBrowser: 'mtcBrowser' in window
    })`);

    assert(!domInfo.hasElectron, 'DOM navigator.userAgent has no Electron substring');
    assert(domInfo.webdriver === false, 'DOM navigator.webdriver is false');
    assert(domInfo.hasShmmothBrowser === false, 'window.shmmothBrowser is not leaked to external pages');
    assert(domInfo.hasMtcBrowser === false, 'window.mtcBrowser is not leaked to external pages');

    const claimsChrome = Array.isArray(domInfo.brands) && domInfo.brands.some(b => b.brand === 'Google Chrome');
    assert(!claimsChrome && domInfo.nativeBrands === true, 'navigator.userAgentData is the engine\'s own (native, no "Google Chrome")');
    assert(domInfo.ua === ua, 'the page reports the sign-in identity');

    console.log('\n══════════════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('══════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    win.destroy();
    app.quit();
    process.exit(failed > 0 ? 1 : 0);
  }
});
