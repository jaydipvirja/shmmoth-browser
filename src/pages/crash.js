// Tab-crash page controller (mtc://crash)
// (extracted from an inline <script> so the mtc:// Content-Security-Policy can forbid inline scripts)
'use strict';

const urlParams = new URLSearchParams(window.location.search);
const reason = urlParams.get('reason') || 'crashed';
const targetUrl = urlParams.get('url') || '';
const tabId = urlParams.get('tabId') || '';

const codeEl = document.getElementById('crash-code');
if (codeEl) {
  codeEl.textContent = `Error code: STATUS_${reason.toUpperCase().replace(/-/g, '_')}`;
}

document.getElementById('btn-reload').addEventListener('click', () => {
  if (window.mtcAPI && window.mtcAPI.reloadTab) {
    window.mtcAPI.reloadTab();
  } else if (/^https?:\/\//i.test(targetUrl)) {
    window.location.href = targetUrl;
  } else {
    window.location.reload();
  }
});

document.getElementById('btn-newtab').addEventListener('click', () => {
  if (window.mtcAPI && window.mtcAPI.createTab) {
    window.mtcAPI.createTab('mtc://newtab');
  } else {
    window.location.href = 'mtc://newtab';
  }
});
