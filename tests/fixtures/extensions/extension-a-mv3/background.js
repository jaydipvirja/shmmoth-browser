// Test Extension A background service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension A service worker installed');
});
