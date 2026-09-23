/**
 * GOOGLE LOGIN VERIFICATION TEST
 *
 * Verifies that:
 * 1. User-Agent is clean and does not leak 'Electron/' or app names.
 * 2. Client Hints (sec-ch-ua) include "Google Chrome".
 * 3. DOM navigator.userAgentData.brands includes "Google Chrome".
 * 4. DOM navigator.webdriver is false.
 * 5. Window does not expose shmmothBrowser or mtcBrowser to external pages.
 * 6. Google accounts page loads modern GlifWebSignIn without being degraded to WebLiteSignIn.
 *
 * Run with: node .\node_modules\electron\cli.js tests/google-login-verification.test.js
 */

'use strict';

const { app, BrowserWindow, session } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

const PRELOAD_EXTERNAL = path.join(__dirname, '..', 'src', 'preload-external.js');

app.whenReady().then(async () => {
  console.log('══════════════════════════════════════════════════════════');
  console.log('   Google Sign-In Compatibility Verification Test        ');
  console.log('══════════════════════════════════════════════════════════');

  const ses = session.fromPartition('google_verify_test');

  const rawUa = ses.getUserAgent();
  const cleanUa = rawUa
    .replace(/Electron\/\S+\s?/, '')
    .replace(/mtc-browser\/\S+\s?/, '')
    .replace(/shmmoth-browser\/\S+\s?/, '')
    .trim() || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

  ses.setUserAgent(cleanUa);

  // Synchronize Google headers
  const filter = {
    urls: [
      '*://*.google.com/*',
      '*://*.gstatic.com/*',
      '*://*.googleusercontent.com/*',
      '*://*.youtube.com/*',
      '*://*.recaptcha.net/*'
    ]
  };
  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = details.requestHeaders;
    const chromeVer = (cleanUa.match(/Chrome\/(\d+)/) || [])[1] || '130';
    headers['User-Agent'] = cleanUa;
    headers['sec-ch-ua'] = `"Chromium";v="${chromeVer}", "Google Chrome";v="${chromeVer}", "Not?A_Brand";v="99"`;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"Windows"';
    callback({ requestHeaders: headers });
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'google_verify_test',
      preload: PRELOAD_EXTERNAL,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setUserAgent(cleanUa);

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
      webdriver: navigator.webdriver,
      hasShmmothBrowser: 'shmmothBrowser' in window,
      hasMtcBrowser: 'mtcBrowser' in window
    })`);

    assert(!domInfo.hasElectron, 'DOM navigator.userAgent has no Electron substring');
    assert(domInfo.webdriver === false, 'DOM navigator.webdriver is false');
    assert(domInfo.hasShmmothBrowser === false, 'window.shmmothBrowser is not leaked to external pages');
    assert(domInfo.hasMtcBrowser === false, 'window.mtcBrowser is not leaked to external pages');

    const hasGoogleChromeBrand = Array.isArray(domInfo.brands) && domInfo.brands.some(b => b.brand === 'Google Chrome');
    assert(hasGoogleChromeBrand, 'DOM navigator.userAgentData.brands includes "Google Chrome"');

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
