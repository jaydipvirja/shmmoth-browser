// Runs in EVERY frame of every web page while Global Privacy Control is on (Settings → Ad-Blocker & Privacy). Registered
// by browser/network.js with session.registerPreloadScript, type "frame".
// Pages read navigator.globalPrivacyControl to learn that the user does not want their data sold or shared; the request
// header (Sec-GPC: 1) is added by services/privacyShield.js. webFrame.executeJavaScript runs this in the page itself,
// before the page's own scripts.
'use strict';
const { webFrame } = require('electron');

try {
  if (/^https?:/i.test(String(location.href || ''))) {
    webFrame.executeJavaScript("try{Object.defineProperty(Navigator.prototype,'globalPrivacyControl',{get:function(){return true},configurable:true,enumerable:true})}catch(e){}").catch(() => {});
  }
} catch (_) { /* the header still says it */ }
