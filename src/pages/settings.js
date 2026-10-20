// SHMMOTH BROWSER - Settings Controller

let currentSettings = {};

// Tab switching
const navLinks = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');

navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    const targetTab = link.getAttribute('data-tab');
    if (!targetTab) return;
    e.preventDefault();

    navLinks.forEach(l => l.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));

    link.classList.add('active');
    const activePane = document.getElementById('tab-' + targetTab);
    if (activePane) activePane.classList.add('active');
  });
});

// UI Elements
const selectSearchEngine = document.getElementById('select-search-engine');
const selectStartup = document.getElementById('select-startup');
const toggleBookmarksBar = document.getElementById('toggle-bookmarks-bar');
const toggleAdblocker = document.getElementById('toggle-adblocker');
const togglePasswordAutofill = document.getElementById('toggle-password-autofill');
// privacy shield (services/privacyShield.js): switch → setting
const PRIVACY_TOGGLES = {
  'toggle-privacy-cookies': 'privacyBlockThirdPartyCookies',
  'toggle-privacy-params': 'privacyStripTrackingParams',
  'toggle-privacy-gpc': 'privacyGpc',
  'toggle-privacy-https': 'privacyHttpsOnly',
  'toggle-privacy-fingerprint': 'privacyFingerprintProtection'
};
const toggleMica = document.getElementById('toggle-mica');
const togglePopups = document.getElementById('toggle-popups');
const adblockEngineStatus = document.getElementById('adblock-engine-status');
const adblockEngineFailed = document.getElementById('adblock-engine-failed');
const btnUpdateFilterLists = document.getElementById('btn-update-filter-lists');
const inputCustomFilters = document.getElementById('input-custom-filters');
const btnSaveCustomFilters = document.getElementById('btn-save-custom-filters');
const customFiltersStatus = document.getElementById('custom-filters-status');
const btnTestDns = document.getElementById('btn-test-dns');
const dnsTestResult = document.getElementById('dns-test-result');
const badgeBlockedCount = document.getElementById('badge-blocked-count');
const btnOpenClearData = document.getElementById('btn-open-clear-data');
const btnOpenCookiesModal = document.getElementById('btn-open-cookies-modal');
const toggleRamSaver = document.getElementById('toggle-ram-saver');
const selectRamTimeout = document.getElementById('select-ram-timeout');
const selectTheme = document.getElementById('select-theme');
const btnBackToBrowsing = document.getElementById('btn-back-to-browsing');
const btnResetDefaults = document.getElementById('btn-reset-defaults');
const toast = document.getElementById('toast');

// Stage 4: Modals & Controls
const modalClearData = document.getElementById('modal-clear-data');
const btnCloseClearModal = document.getElementById('btn-close-clear-modal');
const btnCancelClearModal = document.getElementById('btn-cancel-clear-modal');
const btnConfirmClearData = document.getElementById('btn-confirm-clear-data');
const selectClearRange = document.getElementById('select-clear-range');
const cbClearHistory = document.getElementById('cb-clear-history');
const cbClearCookies = document.getElementById('cb-clear-cookies');
const cbClearCache = document.getElementById('cb-clear-cache');
const cbClearDownloads = document.getElementById('cb-clear-downloads');

const modalCookiesData = document.getElementById('modal-cookies-data');
const btnCloseCookiesModal = document.getElementById('btn-close-cookies-modal');
const btnDoneCookiesModal = document.getElementById('btn-done-cookies-modal');
const cookiesCountLabel = document.getElementById('cookies-count-label');
const cookiesSearchInput = document.getElementById('cookies-search-input');
const btnClearAllCookies = document.getElementById('btn-clear-all-cookies');
const cookiesList = document.getElementById('cookies-list');

let allCookies = [];

// Google / Session Importer Elements
const btnOpenSessionImport   = document.getElementById('btn-open-session-import');
const modalSessionImport     = document.getElementById('modal-session-import');
const btnCloseSessionImport  = document.getElementById('btn-close-session-import');
const btnCancelSessionImport = document.getElementById('btn-cancel-session-import');
const inputSessionJson       = document.getElementById('input-session-json');
const sessionImportStatus    = document.getElementById('session-import-status');
const btnDoImportYoutube     = document.getElementById('btn-do-import-youtube');
const btnDoImportGoogle      = document.getElementById('btn-do-import-google');

// Stage 5: Permissions Manager Elements
const btnOpenPermissionsModal  = document.getElementById('btn-open-permissions-modal');
const modalPermissionsData     = document.getElementById('modal-permissions-data');
const btnClosePermissionsModal = document.getElementById('btn-close-permissions-modal');
const btnDonePermissionsModal  = document.getElementById('btn-done-permissions-modal');
const permissionsCountLabel    = document.getElementById('permissions-count-label');
const permissionsSearchInput   = document.getElementById('permissions-search-input');
const btnClearAllPermissions   = document.getElementById('btn-clear-all-permissions');
const permissionsList          = document.getElementById('permissions-list');

let allPermissions = {};

// Stage 6: Password Manager Elements
const passwordsSearchInput    = document.getElementById('passwords-search-input');
const btnAddPasswordModal     = document.getElementById('btn-add-password-modal');
const btnClearAllPasswords    = document.getElementById('btn-clear-all-passwords');
const passwordsList           = document.getElementById('passwords-list');
const modalPasswordEdit       = document.getElementById('modal-password-edit');
const passwordModalTitle      = document.getElementById('password-modal-title');
const btnClosePasswordModal   = document.getElementById('btn-close-password-modal');
const btnCancelPasswordModal  = document.getElementById('btn-cancel-password-modal');
const btnSavePasswordEntry    = document.getElementById('btn-save-password-entry');
const inputPasswordId         = document.getElementById('input-password-id');
const inputPasswordOrigin     = document.getElementById('input-password-origin');
const inputPasswordUser       = document.getElementById('input-password-user');
const inputPasswordVal        = document.getElementById('input-password-val');

let allPasswords = [];

// Stage 6: Autofill Elements
const toggleAutofill          = document.getElementById('toggle-autofill');
const btnAddProfileModal      = document.getElementById('btn-add-profile-modal');
const btnClearAllProfiles     = document.getElementById('btn-clear-all-profiles');
const autofillList            = document.getElementById('autofill-list');
const modalAutofillEdit       = document.getElementById('modal-autofill-edit');
const autofillModalTitle      = document.getElementById('autofill-modal-title');
const btnCloseAutofillModal   = document.getElementById('btn-close-autofill-modal');
const btnCancelAutofillModal  = document.getElementById('btn-cancel-autofill-modal');
const btnSaveAutofillProfile  = document.getElementById('btn-save-autofill-profile');
const inputAutofillId         = document.getElementById('input-autofill-id');
const inputAutofillName       = document.getElementById('input-autofill-name');
const inputAutofillEmail      = document.getElementById('input-autofill-email');
const inputAutofillPhone      = document.getElementById('input-autofill-phone');
const inputAutofillCountry    = document.getElementById('input-autofill-country');
const inputAutofillAddress    = document.getElementById('input-autofill-address');
const inputAutofillCity       = document.getElementById('input-autofill-city');
const inputAutofillState      = document.getElementById('input-autofill-state');
const inputAutofillPostal     = document.getElementById('input-autofill-postal');

let allProfiles = [];

// Stage 6: Proxy & Network Elements
const selectProxyMode         = document.getElementById('select-proxy-mode');
const manualProxyContainer    = document.getElementById('manual-proxy-container');
const selectProxyProtocol     = document.getElementById('select-proxy-protocol');
const inputProxyHost          = document.getElementById('input-proxy-host');
const inputProxyPort          = document.getElementById('input-proxy-port');
const inputProxyUser          = document.getElementById('input-proxy-user');
const inputProxyPass          = document.getElementById('input-proxy-pass');
const inputProxyBypass        = document.getElementById('input-proxy-bypass');
const proxyTestStatus         = document.getElementById('proxy-test-status');
const btnTestProxy            = document.getElementById('btn-test-proxy');
const btnResetProxy           = document.getElementById('btn-reset-proxy');
const btnSaveProxy            = document.getElementById('btn-save-proxy');

// Downloads Settings Elements
const labelDownloadPath             = document.getElementById('label-download-path');
const btnChangeDownloadFolder       = document.getElementById('btn-change-download-folder');
const btnOpenDownloadFolderSettings = document.getElementById('btn-open-download-folder-settings');
const toggleAskWhereToSave          = document.getElementById('toggle-ask-where-to-save');
const toggleTurboDownload           = document.getElementById('toggle-turbo-download');
const toggleMultiSourceBonding      = document.getElementById('toggle-multi-source-bonding');
const selectTurboThreads            = document.getElementById('select-turbo-threads');

function showToast(msg = 'Settings Saved!') {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2000);
}

// ─── Secure DNS (DNS-over-HTTPS) ────────────────────────────────────────────
const selectDnsProvider = document.getElementById('select-dns-provider');
const dnsCustomRow = document.getElementById('dns-custom-row');
const inputDnsCustom = document.getElementById('input-dns-custom');
const toggleDnsStrict = document.getElementById('toggle-dns-strict');
const dnsStatus = document.getElementById('dns-status');
const dnsProviderDesc = document.getElementById('dns-provider-desc');

function renderSecureDns(state) {
  if (!state || !selectDnsProvider) return;
  if (selectDnsProvider.options.length === 0) {
    for (const p of state.providers) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      opt.dataset.description = p.description;
      selectDnsProvider.appendChild(opt);
    }
  }
  selectDnsProvider.value = state.provider;
  inputDnsCustom.value = state.customUrl || '';
  toggleDnsStrict.checked = Boolean(state.strict);
  dnsCustomRow.classList.toggle('hidden', state.provider !== 'custom');
  const chosen = state.providers.find((p) => p.id === state.provider);
  dnsProviderDesc.textContent = chosen ? chosen.description : '';
  dnsStatus.textContent = state.effectiveProvider === 'system'
    ? 'Currently: your system\'s normal DNS.'
    : `Currently encrypted via ${state.servers[0]}${state.strict ? ' (no fallback)' : ' (falls back to normal DNS if unreachable)'}.`;
  toggleDnsStrict.disabled = state.effectiveProvider === 'system';
}

async function saveSecureDns() {
  const res = await window.mtcAPI.setSecureDns({
    provider: selectDnsProvider.value,
    customUrl: inputDnsCustom.value,
    strict: toggleDnsStrict.checked
  });
  renderSecureDns(res.state);
  if (res.success) showToast('Secure DNS saved');
  else { dnsStatus.textContent = res.error || 'That setting could not be applied.'; showToast(res.error || 'Secure DNS not changed'); }
}

if (selectDnsProvider && window.mtcAPI && window.mtcAPI.getSecureDns) {
  window.mtcAPI.getSecureDns().then(renderSecureDns).catch(() => {});
  selectDnsProvider.addEventListener('change', () => {
    dnsCustomRow.classList.toggle('hidden', selectDnsProvider.value !== 'custom');
    if (selectDnsProvider.value !== 'custom') saveSecureDns();
    else inputDnsCustom.focus();
  });
  inputDnsCustom.addEventListener('change', saveSecureDns);
  toggleDnsStrict.addEventListener('change', saveSecureDns);
}

// Load Settings
async function initSettings() {
  if (window.mtcAPI && window.mtcAPI.getSettings) {
    try {
      currentSettings = await window.mtcAPI.getSettings();
      
      // Populate fields
      selectSearchEngine.value = currentSettings.searchEngine || 'google';
      selectStartup.value = currentSettings.startupBehavior === 'restore' ? 'restore' : 'newtab';
      toggleBookmarksBar.checked = currentSettings.showBookmarksBar ?? true;
      toggleAdblocker.checked = currentSettings.adBlockerEnabled ?? true;
      if (togglePasswordAutofill) togglePasswordAutofill.checked = currentSettings.passwordAutofillEnabled !== false;
      if (toggleMica) toggleMica.checked = currentSettings.micaEffect === true;
      if (togglePopups) togglePopups.checked = currentSettings.popupBlockerEnabled !== false;
      for (const [id, key] of Object.entries(PRIVACY_TOGGLES)) {
        const el = document.getElementById(id);
        if (el) el.checked = currentSettings[key] !== false;
      }
      renderCookieSites(currentSettings.privacyCookieAllowSites);
      if (inputCustomFilters) inputCustomFilters.value = typeof currentSettings.adBlockerCustomFilters === 'string' ? currentSettings.adBlockerCustomFilters : '';
      loadAdBlockerStatus();
      toggleRamSaver.checked = currentSettings.ramSaverEnabled ?? true;
      selectRamTimeout.value = String(currentSettings.ramSaverTimeoutMinutes || 15);
      // "midnight" (until 1.2.0) is shown as Dark, like the browser does (services/theme.js)
      selectTheme.value = ['system', 'light', 'dark'].includes(currentSettings.theme) ? currentSettings.theme : 'dark';
      syncThemeButtons();

      // Live ad blocked count
      const blockedCount = await window.mtcAPI.getAdsBlockedCount();
      badgeBlockedCount.textContent = `${blockedCount} Blocked`;

      // Stage 6: Load passwords, autofill, and proxy
      await loadPasswords();
      await loadAutofill();
      await loadProxySettings();

      // Download Settings
      if (toggleAskWhereToSave) {
        toggleAskWhereToSave.checked = Boolean(currentSettings.askWhereToSave);
      }
      if (labelDownloadPath) {
        labelDownloadPath.textContent = currentSettings.downloadPath || 'Default system downloads folder';
      }
      if (toggleTurboDownload) {
        toggleTurboDownload.checked = currentSettings.turboDownloadEnabled !== false;
      }
      if (toggleMultiSourceBonding) {
        toggleMultiSourceBonding.checked = currentSettings.multiSourceBonding !== false;
      }
      if (selectTurboThreads) {
        selectTurboThreads.value = String(currentSettings.turboThreads || 8);
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  }
}

// Save helper
async function saveSettingChange(delta) {
  currentSettings = { ...currentSettings, ...delta };
  if (window.mtcAPI && window.mtcAPI.updateSettings) {
    await window.mtcAPI.updateSettings(delta);
    showToast();
  }
}

// Event Listeners
selectSearchEngine.addEventListener('change', () => {
  saveSettingChange({ searchEngine: selectSearchEngine.value });
});

selectStartup.addEventListener('change', () => {
  saveSettingChange({ startupBehavior: selectStartup.value === 'restore' ? 'restore' : 'newtab' });
});

toggleBookmarksBar.addEventListener('change', () => {
  saveSettingChange({ showBookmarksBar: toggleBookmarksBar.checked });
});

function timeAgo(ms) {
  if (!ms) return 'never';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

let adblockPoll = null;
async function loadAdBlockerStatus() {
  if (!adblockEngineStatus || !window.mtcAPI || !window.mtcAPI.getAdBlockerStatus) return;
  let st = null;
  try { st = await window.mtcAPI.getAdBlockerStatus(); } catch (_) { /* leave the text */ }
  if (!st) return;
  if (st.engine === 'full') {
    adblockEngineStatus.textContent = `Working: ${st.networkRules.toLocaleString()} blocking rules and ${st.cosmeticRules.toLocaleString()} element-hiding rules from ${st.listsLoaded} of ${st.listsTotal} lists`
      + (st.scriptlets ? ', with anti-popup / anti-adblock scripts' : ', without scripts (could not be downloaded)')
      + `. Checked ${timeAgo(st.updatedAt)}${st.refreshing ? ' — updating now…' : ''}.`;
  } else if (st.engine === 'loading' || st.refreshing) {
    adblockEngineStatus.textContent = 'Loading the filter lists… until they are ready only a short built-in list of the biggest ad networks is active.';
  } else {
    adblockEngineStatus.textContent = 'The filter lists could not be loaded, so only a short built-in list of the biggest ad networks is active. '
      + 'Check the internet connection (some networks block GitHub / jsDelivr), then press “Update now”.' + (st.error ? ` (${st.error})` : '');
  }
  const failed = (st.lists || []).filter((l) => !l.ok);
  adblockEngineFailed.style.display = failed.length ? '' : 'none';
  adblockEngineFailed.textContent = failed.length ? `Not loaded: ${failed.map((l) => l.name).join(', ')}.` : '';
  clearTimeout(adblockPoll);
  if (st.refreshing || st.engine === 'loading') adblockPoll = setTimeout(loadAdBlockerStatus, 3000);
}

if (btnUpdateFilterLists) {
  btnUpdateFilterLists.addEventListener('click', async () => {
    btnUpdateFilterLists.disabled = true;
    adblockEngineStatus.textContent = 'Downloading the filter lists…';
    try { await window.mtcAPI.updateAdBlockerLists(); } catch (_) { /* shown by the status below */ }
    btnUpdateFilterLists.disabled = false;
    loadAdBlockerStatus();
  });
}

if (togglePopups) {
  togglePopups.addEventListener('change', () => saveSettingChange({ popupBlockerEnabled: togglePopups.checked }));
}

for (const [id, key] of Object.entries(PRIVACY_TOGGLES)) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => saveSettingChange({ [key]: el.checked }));
}
const btnPrivacyReport = document.getElementById('btn-open-privacy-report');
if (btnPrivacyReport) {
  btnPrivacyReport.addEventListener('click', () => {
    if (window.mtcAPI && window.mtcAPI.navigateCurrentTab) window.mtcAPI.navigateCurrentTab('mtc://privacy');
  });
}

/** The sites allowed cross-site cookies, each with a Remove button (built with DOM calls). */
function renderCookieSites(list) {
  const ul = document.getElementById('privacy-cookie-sites');
  if (!ul) return;
  ul.replaceChildren();
  const sites = Array.isArray(list) ? list : [];
  if (!sites.length) {
    const li = document.createElement('li');
    li.className = 'setting-desc';
    li.textContent = 'None.';
    ul.appendChild(li);
    return;
  }
  for (const site of sites) {
    const li = document.createElement('li');
    li.className = 'cookie-site';
    li.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:4px 0;';
    const name = document.createElement('span');
    name.textContent = site;
    const btn = document.createElement('button');
    btn.className = 'btn-secondary';
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      const rest = sites.filter((s) => s !== site);
      await saveSettingChange({ privacyCookieAllowSites: rest });
      renderCookieSites(rest);
    });
    li.append(name, btn);
    ul.appendChild(li);
  }
}

if (btnSaveCustomFilters) {
  btnSaveCustomFilters.addEventListener('click', async () => {
    await saveSettingChange({ adBlockerCustomFilters: inputCustomFilters.value });
    const n = inputCustomFilters.value.split(/\r?\n/).filter((l) => l.trim()).length;
    customFiltersStatus.textContent = n ? `Saved ${n} line${n === 1 ? '' : 's'}.` : 'Saved (empty).';
    loadAdBlockerStatus();
  });
}

if (btnTestDns && window.mtcAPI && window.mtcAPI.testSecureDns) {
  btnTestDns.addEventListener('click', async () => {
    btnTestDns.disabled = true;
    dnsTestResult.textContent = 'Testing…';
    try {
      const r = await window.mtcAPI.testSecureDns();
      const d = r.details || {};
      dnsTestResult.textContent = `${r.message}  [ad domain via secure DNS: ${d.adDomainSecure}; via system DNS: ${d.adDomainSystem}; example.com: ${d.ordinarySecure}]`;
    } catch (err) {
      dnsTestResult.textContent = 'The test could not run.';
    }
    btnTestDns.disabled = false;
  });
}

// Default browser: what Windows opens links with; Windows lets only the user change it, on its own page
const defaultBrowserStatus = document.getElementById('default-browser-status');
const btnMakeDefault = document.getElementById('btn-make-default');

async function refreshDefaultBrowser() {
  if (!defaultBrowserStatus || !window.mtcAPI || !window.mtcAPI.getDefaultBrowserStatus) return;
  let s;
  try { s = await window.mtcAPI.getDefaultBrowserStatus(); } catch (_) { return; }
  let text;
  if (!s.supported) text = 'Available in SHMMOTH Browser installed on Windows.';
  else if (!s.registered) text = 'Install SHMMOTH Browser with its installer to make it your default browser.';
  else if (s.isDefault) text = 'SHMMOTH is your default browser. Links from other apps open here.';
  else text = 'Links from other apps open in another browser.';
  defaultBrowserStatus.textContent = text;
  btnMakeDefault.classList.toggle('hidden', !(s.supported && s.registered && !s.isDefault));
}

if (btnMakeDefault) {
  btnMakeDefault.addEventListener('click', async () => {
    const opened = await window.mtcAPI.openDefaultBrowserSettings().catch(() => false);
    if (opened) showToast('In Windows Settings, choose SHMMOTH Browser for HTTP and HTTPS');
  });
  // the choice is made in Windows Settings: check again when the user comes back
  window.addEventListener('focus', refreshDefaultBrowser);
  refreshDefaultBrowser();
}

// Import bookmarks and history from Chrome / Edge / Brave on this computer
const modalImport = document.getElementById('modal-import');
const selectImportSource = document.getElementById('select-import-source');
const importStatus = document.getElementById('import-status');
const btnRunImport = document.getElementById('btn-run-import');
let importSources = [];

function setImportLine(kind, text) {
  importStatus.style.display = 'block';
  importStatus.className = 'status-line ' + kind;
  importStatus.textContent = text;
}

async function openImportModal() {
  importStatus.style.display = 'none';
  selectImportSource.textContent = '';
  try { importSources = await window.mtcAPI.detectImportSources(); } catch (_) { importSources = []; }
  for (const b of importSources) {
    for (const p of b.profiles) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ browserId: b.id, profileDir: p.dir });
      opt.textContent = b.profiles.length > 1 ? `${b.name} — ${p.name}` : b.name;
      selectImportSource.appendChild(opt);
    }
  }
  btnRunImport.disabled = importSources.length === 0;
  if (!importSources.length) setImportLine('error', 'No Chrome, Edge or Brave profile was found on this computer.');
  modalImport.classList.remove('hidden');
}

function closeImportModal() { modalImport.classList.add('hidden'); }

if (modalImport && window.mtcAPI && window.mtcAPI.detectImportSources) {
  document.getElementById('btn-open-import').addEventListener('click', openImportModal);
  document.getElementById('btn-close-import-modal').addEventListener('click', closeImportModal);
  document.getElementById('btn-cancel-import').addEventListener('click', closeImportModal);
  btnRunImport.addEventListener('click', async () => {
    const source = JSON.parse(selectImportSource.value || '{}');
    const bookmarks = document.getElementById('cb-import-bookmarks').checked;
    const history = document.getElementById('cb-import-history').checked;
    if (!bookmarks && !history) { setImportLine('error', 'Choose bookmarks, history or both.'); return; }
    btnRunImport.disabled = true;
    setImportLine('busy', 'Importing…');
    const res = await window.mtcAPI.importFromBrowser({ ...source, bookmarks, history }).catch((err) => ({ success: false, error: err.message }));
    btnRunImport.disabled = false;
    if (!res || !res.success) { setImportLine('error', (res && res.error) || 'The import did not work.'); return; }
    const parts = [];
    if (bookmarks) parts.push(`${res.bookmarks} bookmark${res.bookmarks === 1 ? '' : 's'}${res.bookmarks && res.folder ? ` (in "${res.folder}")` : ''}`);
    if (history) parts.push(`${res.history} page${res.history === 1 ? '' : 's'} of history`);
    setImportLine('success', `Imported ${parts.join(' and ')}.`);
  });
}

// Settings → Downloads → "Check Multi-Network Setup": one line per check, each with what to do
const btnMultiCheck = document.getElementById('btn-multi-check');
const multiCheckResults = document.getElementById('multi-check-results');
const CHECK_ICONS = { ok: 'check', warn: 'warning', fail: 'close' };

if (btnMultiCheck && window.mtcAPI && window.mtcAPI.checkMultiNetwork) {
  btnMultiCheck.addEventListener('click', async () => {
    btnMultiCheck.disabled = true;
    btnMultiCheck.textContent = 'Checking…';
    let result = null;
    try { result = await window.mtcAPI.checkMultiNetwork(); } catch (_) { result = null; }
    btnMultiCheck.disabled = false;
    btnMultiCheck.textContent = 'Check again';
    multiCheckResults.textContent = '';
    for (const c of (result && result.checks) || [{ status: 'fail', title: 'The check could not run.' }]) {
      const li = document.createElement('li');
      li.className = 'check-item ' + c.status;
      const icon = document.createElement('span');
      icon.className = 'sh-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.dataset.icon = CHECK_ICONS[c.status] || 'info';
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = c.title;
      text.appendChild(title);
      if (c.detail) {
        const detail = document.createElement('p');
        detail.textContent = c.detail;
        text.appendChild(detail);
      }
      li.append(icon, text);
      multiCheckResults.appendChild(li);
    }
    window.ShIcons.drawAll(multiCheckResults);
    multiCheckResults.classList.remove('hidden');
  });
}

// Windows 11 Mica: the switch is shown only where Windows has it
if (toggleMica && window.mtcAPI && window.mtcAPI.getPlatformFeatures) {
  window.mtcAPI.getPlatformFeatures().then((f) => {
    if (f && f.mica) document.getElementById('row-mica').classList.remove('hidden');
  }).catch(() => {});
  toggleMica.addEventListener('change', () => saveSettingChange({ micaEffect: toggleMica.checked }));
}

if (togglePasswordAutofill) {
  togglePasswordAutofill.addEventListener('change', () => {
    saveSettingChange({ passwordAutofillEnabled: togglePasswordAutofill.checked });
  });
}

toggleAdblocker.addEventListener('change', () => {
  saveSettingChange({ adBlockerEnabled: toggleAdblocker.checked });
});

toggleRamSaver.addEventListener('change', () => {
  saveSettingChange({ ramSaverEnabled: toggleRamSaver.checked });
});

selectRamTimeout.addEventListener('change', () => {
  saveSettingChange({ ramSaverTimeoutMinutes: parseInt(selectRamTimeout.value, 10) });
});

selectTheme.addEventListener('change', () => {
  saveSettingChange({ theme: selectTheme.value });   // the page follows by itself (theme.js)
  syncThemeButtons();
});

// Theme: three buttons (Follow Windows / Light / Dark) that set the select above
const themeButtons = document.querySelectorAll('#theme-buttons [data-theme-value]');
function syncThemeButtons() {
  themeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeValue === selectTheme.value)));
}
themeButtons.forEach((b) => b.addEventListener('click', () => {
  if (selectTheme.value === b.dataset.themeValue) return;
  selectTheme.value = b.dataset.themeValue;
  selectTheme.dispatchEvent(new Event('change'));
}));

// ─── Search settings ────────────────────────────────────────────────────────
// Typing shows every section at once with only the settings whose label or description match; clearing it goes back
// to the section that was open.
const searchInput = document.getElementById('settings-search-input');
const searchEmpty = document.getElementById('settings-search-empty');
function filterSettings(query) {
  const q = String(query || '').trim().toLowerCase();
  document.body.classList.toggle('searching', Boolean(q));
  let anyShown = false;
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    let paneShown = false;
    pane.querySelectorAll('.card').forEach((card) => {
      const rows = card.querySelectorAll('.setting-row');
      let cardShown = false;
      if (rows.length) {
        rows.forEach((row) => {
          const hit = !q || row.textContent.toLowerCase().includes(q);
          row.classList.toggle('search-miss', !hit);
          if (hit) cardShown = true;
        });
      } else {
        cardShown = !q || card.textContent.toLowerCase().includes(q);
      }
      card.classList.toggle('search-miss', !cardShown);
      if (cardShown) paneShown = true;
    });
    const title = pane.querySelector('.section-title');
    if (q && title && title.textContent.toLowerCase().includes(q)) {
      paneShown = true;
      pane.querySelectorAll('.search-miss').forEach((el) => el.classList.remove('search-miss'));
    }
    pane.classList.toggle('search-hit', Boolean(q) && paneShown);
    if (paneShown && q) anyShown = true;
  });
  searchEmpty.classList.toggle('hidden', !q || anyShown);
}
if (searchInput) {
  searchInput.addEventListener('input', () => filterSettings(searchInput.value));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { searchInput.value = ''; filterSettings(''); } });
}

// ─── Download Settings Handlers ─────────────────────────────────────────────
if (toggleAskWhereToSave) {
  toggleAskWhereToSave.addEventListener('change', () => {
    saveSettingChange({ askWhereToSave: toggleAskWhereToSave.checked });
  });
}

if (toggleTurboDownload) {
  toggleTurboDownload.addEventListener('change', () => {
    saveSettingChange({ turboDownloadEnabled: toggleTurboDownload.checked });
  });
}

if (toggleMultiSourceBonding) {
  toggleMultiSourceBonding.addEventListener('change', () => {
    saveSettingChange({ multiSourceBonding: toggleMultiSourceBonding.checked });
  });
}

if (selectTurboThreads) {
  selectTurboThreads.addEventListener('change', () => {
    saveSettingChange({ turboThreads: Number(selectTurboThreads.value) });
  });
}

if (btnChangeDownloadFolder) {
  btnChangeDownloadFolder.addEventListener('click', async () => {
    if (window.mtcAPI && window.mtcAPI.chooseDownloadFolder) {
      const res = await window.mtcAPI.chooseDownloadFolder();
      if (res && res.success && res.path) {
        if (labelDownloadPath) labelDownloadPath.textContent = res.path;
        await saveSettingChange({ downloadPath: res.path });
      }
    }
  });
}

if (btnOpenDownloadFolderSettings) {
  btnOpenDownloadFolderSettings.addEventListener('click', async () => {
    if (window.mtcAPI && window.mtcAPI.openDownloadsFolder) {
      await window.mtcAPI.openDownloadsFolder();
    }
  });
}

// ─── Stage 4: Clear Browsing Data Modal Handlers ────────────────────────────
if (btnOpenClearData) {
  btnOpenClearData.addEventListener('click', () => {
    if (modalClearData) modalClearData.classList.remove('hidden');
  });
}

function closeClearModal() {
  if (modalClearData) modalClearData.classList.add('hidden');
}

if (btnCloseClearModal) btnCloseClearModal.addEventListener('click', closeClearModal);
if (btnCancelClearModal) btnCancelClearModal.addEventListener('click', closeClearModal);

if (btnConfirmClearData) {
  btnConfirmClearData.addEventListener('click', async () => {
    const range = selectClearRange ? selectClearRange.value : 'all';
    const dataTypes = {
      history:   Boolean(cbClearHistory && cbClearHistory.checked),
      cookies:   Boolean(cbClearCookies && cbClearCookies.checked),
      cache:     Boolean(cbClearCache && cbClearCache.checked),
      downloads: Boolean(cbClearDownloads && cbClearDownloads.checked)
    };

    if (window.mtcAPI && window.mtcAPI.clearBrowsingData) {
      btnConfirmClearData.disabled = true;
      btnConfirmClearData.textContent = 'Clearing...';
      try {
        await window.mtcAPI.clearBrowsingData({ range, dataTypes });
        showToast('Browsing data cleared!');
        closeClearModal();
      } catch (err) {
        showToast('Failed to clear browsing data');
      } finally {
        btnConfirmClearData.disabled = false;
        btnConfirmClearData.textContent = 'Clear Data';
      }
    }
  });
}

// ─── Stage 4: Cookies & Site Data Manager Handlers ──────────────────────────
if (btnOpenCookiesModal) {
  btnOpenCookiesModal.addEventListener('click', async () => {
    if (modalCookiesData) modalCookiesData.classList.remove('hidden');
    await loadCookies();
  });
}

function closeCookiesModal() {
  if (modalCookiesData) modalCookiesData.classList.add('hidden');
}

if (btnCloseCookiesModal) btnCloseCookiesModal.addEventListener('click', closeCookiesModal);
if (btnDoneCookiesModal) btnDoneCookiesModal.addEventListener('click', closeCookiesModal);

async function loadCookies() {
  if (window.mtcAPI && window.mtcAPI.getCookies) {
    try {
      allCookies = await window.mtcAPI.getCookies();
      renderCookies();
    } catch (err) {
      if (cookiesList) {
        cookiesList.innerHTML = '<div class="cookies-empty-state">Failed to load cookies</div>';
      }
    }
  }
}

function renderCookies() {
  if (!cookiesList) return;
  const query = cookiesSearchInput ? cookiesSearchInput.value.toLowerCase().trim() : '';
  const filtered = allCookies.filter(c =>
    (!query || (c.name && c.name.toLowerCase().includes(query)) || (c.domain && c.domain.toLowerCase().includes(query)))
  );

  if (cookiesCountLabel) {
    cookiesCountLabel.textContent = `${allCookies.length} total cookies stored`;
  }

  if (filtered.length === 0) {
    cookiesList.innerHTML = `<div class="cookies-empty-state">${query ? 'No matching cookies found' : 'No cookies saved yet'}</div>`;
    return;
  }

  cookiesList.innerHTML = '';
  filtered.forEach(cookie => {
    const row = document.createElement('div');
    row.className = 'cookie-row';
    row.innerHTML = `
      <div class="cookie-info">
        <span class="cookie-name">${escapeHtml(cookie.name)}</span>
        <span class="cookie-domain">${escapeHtml(cookie.domain)}${escapeHtml(cookie.path || '/')}</span>
        <span class="cookie-meta">${cookie.secure ? 'Secure' : 'HTTP'} • ${cookie.session ? 'Session' : 'Persistent'}</span>
      </div>
      <button class="cookie-del-btn" title="Delete cookie">Remove</button>
    `;

    const delBtn = row.querySelector('.cookie-del-btn');
    delBtn.addEventListener('click', async () => {
      if (window.mtcAPI && window.mtcAPI.removeCookie) {
        await window.mtcAPI.removeCookie(cookie);
        allCookies = allCookies.filter(c => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path));
        renderCookies();
        showToast('Cookie removed');
      }
    });

    cookiesList.appendChild(row);
  });
}

if (cookiesSearchInput) {
  cookiesSearchInput.addEventListener('input', () => {
    renderCookies();
  });
}

if (btnClearAllCookies) {
  btnClearAllCookies.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete all stored cookies? You will be signed out of websites.')) {
      if (window.mtcAPI && window.mtcAPI.clearCookies) {
        await window.mtcAPI.clearCookies();
        allCookies = [];
        renderCookies();
        showToast('All cookies deleted!');
      }
    }
  });
}

// ─── 1-Click Google / Site Session Importer Handlers ────────────────────────
function openSessionImportModal() {
  if (modalSessionImport) modalSessionImport.classList.remove('hidden');
  if (sessionImportStatus) {
    sessionImportStatus.style.display = 'none';
    sessionImportStatus.textContent = '';
  }
  if (inputSessionJson) inputSessionJson.focus();
}

function closeSessionImportModal() {
  if (modalSessionImport) modalSessionImport.classList.add('hidden');
}

if (btnOpenSessionImport)   btnOpenSessionImport.addEventListener('click', openSessionImportModal);
if (btnCloseSessionImport)  btnCloseSessionImport.addEventListener('click', closeSessionImportModal);
if (btnCancelSessionImport) btnCancelSessionImport.addEventListener('click', closeSessionImportModal);

// kind: 'error' | 'busy' | 'success' — the colour comes from the tokens (.status-line in settings.css)
function setImportStatus(kind, text) {
  sessionImportStatus.style.display = 'block';
  sessionImportStatus.className = 'status-line ' + kind;
  sessionImportStatus.textContent = text;
}

async function handleSessionImport(targetService = null) {
  if (!inputSessionJson || !sessionImportStatus) return;
  const rawText = inputSessionJson.value.trim();
  if (!rawText) {
    setImportStatus('error', 'Please paste the exported Cookie-Editor JSON data first.');
    return;
  }

  let cookieData;
  try {
    cookieData = JSON.parse(rawText);
  } catch (err) {
    setImportStatus('error', 'Invalid JSON format: ' + err.message);
    return;
  }

  if (!Array.isArray(cookieData) || cookieData.length === 0) {
    setImportStatus('error', 'JSON must be an array of cookies from Cookie-Editor.');
    return;
  }

  setImportStatus('busy', 'Importing cookies into session…');

  try {
    if (window.mtcAPI && window.mtcAPI.importCookies) {
      const result = await window.mtcAPI.importCookies(cookieData);
      setImportStatus('success', `Imported ${result.count} cookies.`);
      showToast(`Imported ${result.count} cookies!`);

      setTimeout(() => {
        closeSessionImportModal();
        if (targetService === 'youtube') {
          window.location.href = 'https://www.youtube.com';
        } else if (targetService === 'google') {
          window.location.href = 'https://www.google.com';
        }
      }, 900);
    } else {
      throw new Error('API not available');
    }
  } catch (err) {
    setImportStatus('error', 'Import failed: ' + err.message);
  }
}

if (btnDoImportYoutube) {
  btnDoImportYoutube.addEventListener('click', () => handleSessionImport('youtube'));
}
if (btnDoImportGoogle) {
  btnDoImportGoogle.addEventListener('click', () => handleSessionImport('google'));
}

// ─── Stage 5: Site Permissions Manager Handlers ─────────────────────────────
if (btnOpenPermissionsModal) {
  btnOpenPermissionsModal.addEventListener('click', async () => {
    if (modalPermissionsData) modalPermissionsData.classList.remove('hidden');
    await loadPermissions();
  });
}

function closePermissionsModal() {
  if (modalPermissionsData) modalPermissionsData.classList.add('hidden');
}

if (btnClosePermissionsModal) btnClosePermissionsModal.addEventListener('click', closePermissionsModal);
if (btnDonePermissionsModal) btnDonePermissionsModal.addEventListener('click', closePermissionsModal);

async function loadPermissions() {
  if (window.mtcAPI && window.mtcAPI.getAllPermissions) {
    try {
      allPermissions = await window.mtcAPI.getAllPermissions();
      renderPermissions();
    } catch (err) {
      if (permissionsList) {
        permissionsList.innerHTML = '<div class="permissions-empty-state">Failed to load permissions</div>';
      }
    }
  }
}

function renderPermissions() {
  if (!permissionsList) return;
  const query = permissionsSearchInput ? permissionsSearchInput.value.toLowerCase().trim() : '';
  const origins = Object.keys(allPermissions || {}).filter(origin =>
    !query || origin.toLowerCase().includes(query)
  );

  if (permissionsCountLabel) {
    permissionsCountLabel.textContent = `${Object.keys(allPermissions || {}).length} configured site origins`;
  }

  if (origins.length === 0) {
    permissionsList.innerHTML = `<div class="permissions-empty-state">${query ? 'No matching sites found' : 'No custom site permissions configured yet'}</div>`;
    return;
  }

  permissionsList.innerHTML = '';
  origins.forEach(origin => {
    const perms = allPermissions[origin] || {};
    const card = document.createElement('div');
    card.className = 'permission-origin-card';

    let tagsHtml = '';
    for (const [perm, decision] of Object.entries(perms)) {
      let icon = 'lock';
      if (perm === 'media') icon = 'camera';
      else if (perm === 'geolocation') icon = 'map-pin';
      else if (perm === 'notifications') icon = 'bell';
      tagsHtml += `
        <span class="perm-tag ${escapeHtml(decision)}">
          <span><span class="sh-icon" data-icon="${icon}" aria-hidden="true"></span> ${escapeHtml(perm)}:</span>
          <strong>${escapeHtml(decision)}</strong>
        </span>
      `;
    }

    card.innerHTML = `
      <div class="perm-origin-header">
        <span class="perm-origin-title">${escapeHtml(origin)}</span>
        <button class="perm-origin-reset-btn" title="Reset permissions for this site">Reset Site</button>
      </div>
      <div class="perm-tags-list">
        ${tagsHtml || '<span class="muted" style="font-size:12px;">No active rules</span>'}
      </div>
    `;

    const resetBtn = card.querySelector('.perm-origin-reset-btn');
    resetBtn.addEventListener('click', async () => {
      if (window.mtcAPI && window.mtcAPI.removeSitePermission) {
        await window.mtcAPI.removeSitePermission(origin);
        delete allPermissions[origin];
        renderPermissions();
        showToast(`Permissions reset for ${origin}`);
      }
    });

    window.ShIcons.drawAll(card);
    permissionsList.appendChild(card);
  });
}

if (permissionsSearchInput) {
  permissionsSearchInput.addEventListener('input', () => {
    renderPermissions();
  });
}

if (btnClearAllPermissions) {
  btnClearAllPermissions.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all site permissions to default?')) {
      if (window.mtcAPI && window.mtcAPI.clearAllPermissions) {
        await window.mtcAPI.clearAllPermissions();
        allPermissions = {};
        renderPermissions();
        showToast('All site permissions reset!');
      }
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 6: PASSWORD MANAGER CONTROLLER
// ═════════════════════════════════════════════════════════════════════════════

async function loadPasswords() {
  if (window.mtcAPI && window.mtcAPI.getAllPasswords) {
    try {
      allPasswords = await window.mtcAPI.getAllPasswords();
    } catch (err) {
      console.error('Failed to load passwords:', err);
      allPasswords = [];
    }
    renderPasswords();
  }
}

// the eye on a hidden password, the crossed-out eye on a shown one
function setRevealIcon(btn, shown) {
  const svg = window.ShIcons.create(shown ? 'eye-off' : 'eye');
  if (svg) btn.replaceChildren(svg);
  btn.setAttribute('aria-label', shown ? 'Hide password' : 'Reveal password');
}

/** The hide functions of the passwords currently on screen (see renderPasswords). */
const shownPasswordHiders = new Set();
function hideAllShownPasswords() { for (const hide of Array.from(shownPasswordHiders)) hide(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) hideAllShownPasswords(); });
window.addEventListener('blur', hideAllShownPasswords);
window.addEventListener('pagehide', hideAllShownPasswords);

function renderPasswords() {
  if (!passwordsList) return;
  hideAllShownPasswords();
  passwordsList.innerHTML = '';

  const q = (passwordsSearchInput ? passwordsSearchInput.value : '').trim().toLowerCase();
  const filtered = (allPasswords || []).filter(p => {
    if (!q) return true;
    return (p.origin && p.origin.toLowerCase().includes(q)) ||
           (p.username && p.username.toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    passwordsList.innerHTML = `<div class="permissions-empty-state">${q ? 'No matching passwords found' : 'No saved passwords yet. Passwords you save will be securely encrypted and stored here.'}</div>`;
    return;
  }

  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'password-item-row';
    row.dataset.id = item.id;

    row.innerHTML = `
      <div class="password-info-col">
        <span class="password-origin-label">${escapeHtml(item.origin)}</span>
        <span class="password-user-label">${escapeHtml(item.username)}</span>
      </div>
      <div class="password-secret-col">
        <span class="password-val-display" data-revealed="false">••••••••</span>
        <button class="btn-icon btn-reveal-pw" title="Reveal Password" aria-label="Reveal password"><span class="sh-icon" data-icon="eye" aria-hidden="true"></span></button>
      </div>
      <div class="password-actions-col">
        <button class="btn-icon btn-copy-user" title="Copy Username"><span class="sh-icon" data-icon="copy" aria-hidden="true"></span>User</button>
        <button class="btn-icon btn-copy-pass" title="Copy Password"><span class="sh-icon" data-icon="copy" aria-hidden="true"></span>Pass</button>
        <button class="btn-icon btn-edit-pw" title="Edit" aria-label="Edit"><span class="sh-icon" data-icon="edit" aria-hidden="true"></span></button>
        <button class="btn-icon btn-delete-pw" title="Delete" aria-label="Delete"><span class="sh-icon" data-icon="trash" aria-hidden="true"></span></button>
      </div>
    `;

    const valDisplay = row.querySelector('.password-val-display');
    const btnReveal = row.querySelector('.btn-reveal-pw');
    const btnCopyUser = row.querySelector('.btn-copy-user');
    const btnCopyPass = row.querySelector('.btn-copy-pass');
    const btnEdit = row.querySelector('.btn-edit-pw');
    const btnDelete = row.querySelector('.btn-delete-pw');

    // The browser asks the user in a native window before it hands out a password (see services/passwordGate.js).
    // A shown password is only in the page while it is on screen: it hides itself after 15 s, when the page is left
    // or hidden, and when the list is redrawn; nothing is kept in a variable.
    let hideTimer = null;
    const hide = () => {
      clearTimeout(hideTimer);
      hideTimer = null;
      valDisplay.textContent = '••••••••';
      valDisplay.dataset.revealed = 'false';
      setRevealIcon(btnReveal, false);
      shownPasswordHiders.delete(hide);
    };

    btnReveal.addEventListener('click', async () => {
      if (valDisplay.dataset.revealed === 'true') { hide(); return; }
      if (!window.mtcAPI || !window.mtcAPI.revealPassword) return;
      const res = await window.mtcAPI.revealPassword(item.id);
      if (res && res.success) {
        valDisplay.textContent = res.password;
        valDisplay.dataset.revealed = 'true';
        setRevealIcon(btnReveal, true);
        shownPasswordHiders.add(hide);
        hideTimer = setTimeout(hide, Number(res.hideAfterMs) > 0 ? Number(res.hideAfterMs) : 15000);
      } else if (res && !res.cancelled) {
        showToast(res.error || 'The password could not be shown');
      }
    });

    btnCopyUser.addEventListener('click', () => {
      navigator.clipboard.writeText(item.username || '').then(() => {
        showToast('Username copied to clipboard!');
      });
    });

    // The password goes from the vault to the clipboard inside the browser; this page never receives it.
    btnCopyPass.addEventListener('click', async () => {
      if (!window.mtcAPI || !window.mtcAPI.copyPassword) return;
      const res = await window.mtcAPI.copyPassword(item.id);
      if (res && res.success) showToast(`Password copied. The clipboard is cleared in ${Math.round((res.clearAfterMs || 30000) / 1000)} seconds.`);
      else if (res && !res.cancelled) showToast(res.error || 'The password could not be copied');
    });

    btnEdit.addEventListener('click', () => {
      if (modalPasswordEdit) {
        inputPasswordId.value = item.id;
        inputPasswordOrigin.value = item.origin;
        inputPasswordUser.value = item.username;
        inputPasswordVal.value = '';
        inputPasswordVal.placeholder = 'Leave blank to keep unchanged';
        passwordModalTitle.textContent = 'Edit Password';
        modalPasswordEdit.classList.remove('hidden');
      }
    });

    btnDelete.addEventListener('click', async () => {
      if (confirm(`Delete saved password for ${item.origin}?`)) {
        if (window.mtcAPI && window.mtcAPI.deletePassword) {
          await window.mtcAPI.deletePassword(item.id);
          await loadPasswords();
          showToast('Password deleted');
        }
      }
    });

    window.ShIcons.drawAll(row);
    passwordsList.appendChild(row);
  });
}

function setupPasswordsController() {
  if (passwordsSearchInput) {
    passwordsSearchInput.addEventListener('input', renderPasswords);
  }

  if (btnAddPasswordModal) {
    btnAddPasswordModal.addEventListener('click', () => {
      if (modalPasswordEdit) {
        inputPasswordId.value = '';
        inputPasswordOrigin.value = '';
        inputPasswordUser.value = '';
        inputPasswordVal.value = '';
        inputPasswordVal.placeholder = 'Password';
        passwordModalTitle.textContent = 'Add Saved Password';
        modalPasswordEdit.classList.remove('hidden');
      }
    });
  }

  if (btnClosePasswordModal) {
    btnClosePasswordModal.addEventListener('click', () => modalPasswordEdit.classList.add('hidden'));
  }
  if (btnCancelPasswordModal) {
    btnCancelPasswordModal.addEventListener('click', () => modalPasswordEdit.classList.add('hidden'));
  }

  if (btnSavePasswordEntry) {
    btnSavePasswordEntry.addEventListener('click', async () => {
      const id = (inputPasswordId.value || '').trim();
      const origin = (inputPasswordOrigin.value || '').trim();
      const username = (inputPasswordUser.value || '').trim();
      const password = inputPasswordVal.value;

      if (!origin || !username) {
        alert('Origin and Username are required.');
        return;
      }

      if (id) {
        const updates = { origin, username };
        if (password) updates.password = password;
        if (window.mtcAPI && window.mtcAPI.updatePassword) {
          const res = await window.mtcAPI.updatePassword(id, updates);
          if (!res || !res.success) {
            alert('Could not update the password: ' + ((res && res.error) || 'unknown error'));
            return;
          }
          showToast('Password updated!');
        }
      } else {
        if (!password) {
          alert('Password is required for new credential.');
          return;
        }
        if (window.mtcAPI && window.mtcAPI.savePassword) {
          const res = await window.mtcAPI.savePassword({ origin, username, password });
          if (!res || !res.success) {
            alert('Could not save the password: ' + ((res && res.error) || 'unknown error'));
            return;
          }
          showToast('Password saved securely!');
        }
      }

      modalPasswordEdit.classList.add('hidden');
      await loadPasswords();
    });
  }

  if (btnClearAllPasswords) {
    btnClearAllPasswords.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete ALL saved passwords? This cannot be undone.')) {
        if (window.mtcAPI && window.mtcAPI.clearAllPasswords) {
          await window.mtcAPI.clearAllPasswords();
          await loadPasswords();
          showToast('All passwords removed!');
        }
      }
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 6: AUTOFILL CONTROLLER
// ═════════════════════════════════════════════════════════════════════════════

async function loadAutofill() {
  if (window.mtcAPI) {
    try {
      if (window.mtcAPI.isAutofillEnabled && toggleAutofill) {
        toggleAutofill.checked = await window.mtcAPI.isAutofillEnabled();
      }
      if (window.mtcAPI.getAutofillProfiles) {
        allProfiles = await window.mtcAPI.getAutofillProfiles();
      }
    } catch (err) {
      console.error('Failed to load autofill data:', err);
    }
    renderAutofillProfiles();
  }
}

function renderAutofillProfiles() {
  if (!autofillList) return;
  autofillList.innerHTML = '';

  if (!allProfiles || allProfiles.length === 0) {
    autofillList.innerHTML = `<div class="permissions-empty-state" style="grid-column: 1 / -1;">No autofill profiles saved yet. Click "+ Add Profile" to add one.</div>`;
    return;
  }

  allProfiles.forEach(prof => {
    const card = document.createElement('div');
    card.className = 'autofill-card';
    card.dataset.id = prof.id;

    const locParts = [prof.city, prof.state, prof.postalCode, prof.country].filter(Boolean).join(', ');

    card.innerHTML = `
      <div class="autofill-card-header">
        <span class="autofill-name">${escapeHtml(prof.name || 'Unnamed Profile')}</span>
      </div>
      <div class="autofill-card-details">
        ${prof.email ? `<div><span class="sh-icon" data-icon="mail" aria-hidden="true"></span> ${escapeHtml(prof.email)}</div>` : ''}
        ${prof.phone ? `<div><span class="sh-icon" data-icon="phone" aria-hidden="true"></span> ${escapeHtml(prof.phone)}</div>` : ''}
        ${prof.address ? `<div><span class="sh-icon" data-icon="home" aria-hidden="true"></span> ${escapeHtml(prof.address)}</div>` : ''}
        ${locParts ? `<div><span class="sh-icon" data-icon="map-pin" aria-hidden="true"></span> ${escapeHtml(locParts)}</div>` : ''}
      </div>
      <div class="autofill-actions">
        <button class="btn-icon btn-edit-prof" title="Edit Profile"><span class="sh-icon" data-icon="edit" aria-hidden="true"></span>Edit</button>
        <button class="btn-icon btn-delete-prof" title="Delete Profile"><span class="sh-icon" data-icon="trash" aria-hidden="true"></span>Delete</button>
      </div>
    `;

    card.querySelector('.btn-edit-prof').addEventListener('click', () => {
      if (modalAutofillEdit) {
        inputAutofillId.value = prof.id;
        inputAutofillName.value = prof.name || '';
        inputAutofillEmail.value = prof.email || '';
        inputAutofillPhone.value = prof.phone || '';
        inputAutofillCountry.value = prof.country || '';
        inputAutofillAddress.value = prof.address || '';
        inputAutofillCity.value = prof.city || '';
        inputAutofillState.value = prof.state || '';
        inputAutofillPostal.value = prof.postalCode || '';
        autofillModalTitle.textContent = 'Edit Profile';
        modalAutofillEdit.classList.remove('hidden');
      }
    });

    card.querySelector('.btn-delete-prof').addEventListener('click', async () => {
      if (confirm(`Delete profile for "${prof.name || 'Unnamed'}"?`)) {
        if (window.mtcAPI && window.mtcAPI.deleteAutofillProfile) {
          await window.mtcAPI.deleteAutofillProfile(prof.id);
          await loadAutofill();
          showToast('Profile deleted');
        }
      }
    });

    window.ShIcons.drawAll(card);
    autofillList.appendChild(card);
  });
}

function setupAutofillController() {
  if (toggleAutofill) {
    toggleAutofill.addEventListener('change', async () => {
      if (window.mtcAPI && window.mtcAPI.setAutofillEnabled) {
        await window.mtcAPI.setAutofillEnabled(toggleAutofill.checked);
        showToast(toggleAutofill.checked ? 'Autofill enabled' : 'Autofill disabled');
      }
    });
  }

  if (btnAddProfileModal) {
    btnAddProfileModal.addEventListener('click', () => {
      if (modalAutofillEdit) {
        inputAutofillId.value = '';
        inputAutofillName.value = '';
        inputAutofillEmail.value = '';
        inputAutofillPhone.value = '';
        inputAutofillCountry.value = '';
        inputAutofillAddress.value = '';
        inputAutofillCity.value = '';
        inputAutofillState.value = '';
        inputAutofillPostal.value = '';
        autofillModalTitle.textContent = 'Add Autofill Profile';
        modalAutofillEdit.classList.remove('hidden');
      }
    });
  }

  if (btnCloseAutofillModal) {
    btnCloseAutofillModal.addEventListener('click', () => modalAutofillEdit.classList.add('hidden'));
  }
  if (btnCancelAutofillModal) {
    btnCancelAutofillModal.addEventListener('click', () => modalAutofillEdit.classList.add('hidden'));
  }

  if (btnSaveAutofillProfile) {
    btnSaveAutofillProfile.addEventListener('click', async () => {
      const id = (inputAutofillId.value || '').trim();
      const profileData = {
        name: (inputAutofillName.value || '').trim(),
        email: (inputAutofillEmail.value || '').trim(),
        phone: (inputAutofillPhone.value || '').trim(),
        country: (inputAutofillCountry.value || '').trim(),
        address: (inputAutofillAddress.value || '').trim(),
        city: (inputAutofillCity.value || '').trim(),
        state: (inputAutofillState.value || '').trim(),
        postalCode: (inputAutofillPostal.value || '').trim(),
      };

      if (!profileData.name && !profileData.email) {
        alert('Please provide at least a Name or Email.');
        return;
      }

      if (id) {
        if (window.mtcAPI && window.mtcAPI.updateAutofillProfile) {
          await window.mtcAPI.updateAutofillProfile(id, profileData);
          showToast('Profile updated!');
        }
      } else {
        if (window.mtcAPI && window.mtcAPI.saveAutofillProfile) {
          await window.mtcAPI.saveAutofillProfile(profileData);
          showToast('Profile added!');
        }
      }

      modalAutofillEdit.classList.add('hidden');
      await loadAutofill();
    });
  }

  if (btnClearAllProfiles) {
    btnClearAllProfiles.addEventListener('click', async () => {
      if (confirm('Delete all autofill profiles?')) {
        if (window.mtcAPI && window.mtcAPI.clearAllAutofillProfiles) {
          await window.mtcAPI.clearAllAutofillProfiles();
          await loadAutofill();
          showToast('All profiles cleared!');
        }
      }
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 6: NETWORK & PROXY CONTROLLER
// ═════════════════════════════════════════════════════════════════════════════

async function loadProxySettings() {
  if (!window.mtcAPI || !window.mtcAPI.getProxyConfig) return;
  try {
    const cfg = await window.mtcAPI.getProxyConfig();
    if (!cfg) return;

    if (selectProxyMode) selectProxyMode.value = cfg.mode || 'system';
    updateProxyFieldsVisibility(cfg.mode || 'system');

    if (cfg.rules) {
      if (selectProxyProtocol) selectProxyProtocol.value = cfg.rules.protocol || 'http';
      if (inputProxyHost) inputProxyHost.value = cfg.rules.host || '';
      if (inputProxyPort) inputProxyPort.value = cfg.rules.port || 8080;
      if (inputProxyUser) inputProxyUser.value = cfg.rules.username || '';
      if (inputProxyBypass) inputProxyBypass.value = cfg.rules.bypassRules || '<local>;localhost;127.0.0.1';
    }
    if (inputProxyPass) {
      inputProxyPass.value = '';
      inputProxyPass.placeholder = (cfg.rules && cfg.rules.hasPassword) ? '•••••••• (Stored encrypted)' : 'Password (optional)';
    }
  } catch (err) {
    console.error('Failed to load proxy config:', err);
  }
}

function updateProxyFieldsVisibility(mode) {
  if (!manualProxyContainer) return;
  if (mode === 'manual') {
    manualProxyContainer.classList.remove('hidden');
  } else {
    manualProxyContainer.classList.add('hidden');
  }
}

function setupProxyController() {
  if (selectProxyMode) {
    selectProxyMode.addEventListener('change', () => {
      updateProxyFieldsVisibility(selectProxyMode.value);
    });
  }

  if (btnTestProxy) {
    btnTestProxy.addEventListener('click', async () => {
      if (!window.mtcAPI || !window.mtcAPI.testProxyConnection) return;
      proxyTestStatus.className = 'proxy-test-status pending';
      proxyTestStatus.textContent = 'Testing connection...';

      const mode = selectProxyMode.value;
      let testRules = null;
      if (mode === 'manual') {
        testRules = {
          protocol: selectProxyProtocol.value,
          host: inputProxyHost.value.trim(),
          port: parseInt(inputProxyPort.value, 10),
        };
      }

      try {
        const res = await window.mtcAPI.testProxyConnection(testRules);
        if (res && res.success) {
          proxyTestStatus.className = 'proxy-test-status success';
          proxyTestStatus.textContent = res.latencyMs !== undefined ? `Connected (${res.latencyMs} ms)` : 'Connection active';
        } else {
          proxyTestStatus.className = 'proxy-test-status error';
          proxyTestStatus.textContent = res && res.error ? res.error : 'Connection failed';
        }
      } catch (err) {
        proxyTestStatus.className = 'proxy-test-status error';
        proxyTestStatus.textContent = err.message;
      }
    });
  }

  if (btnResetProxy) {
    btnResetProxy.addEventListener('click', async () => {
      if (confirm('Reset proxy configuration to System Default?')) {
        if (window.mtcAPI && window.mtcAPI.resetProxyConfig) {
          await window.mtcAPI.resetProxyConfig();
          await loadProxySettings();
          if (proxyTestStatus) proxyTestStatus.textContent = '';
          showToast('Proxy reset to System Default!');
        }
      }
    });
  }

  if (btnSaveProxy) {
    btnSaveProxy.addEventListener('click', async () => {
      if (!window.mtcAPI || !window.mtcAPI.saveProxyConfig) return;

      const mode = selectProxyMode.value;
      const config = { mode, rules: {} };

      if (mode === 'manual') {
        const host = inputProxyHost.value.trim();
        const port = parseInt(inputProxyPort.value, 10);
        if (!host) {
          alert('Proxy host is required for manual configuration.');
          return;
        }
        if (isNaN(port) || port < 1 || port > 65535) {
          alert('Proxy port must be a valid port number (1-65535).');
          return;
        }

        config.rules = {
          protocol: selectProxyProtocol.value,
          host,
          port,
          username: inputProxyUser.value.trim(),
          bypassRules: inputProxyBypass.value.trim() || '<local>;localhost;127.0.0.1',
        };

        if (inputProxyPass.value) {
          config.rules.password = inputProxyPass.value;
        }
      }

      try {
        const res = await window.mtcAPI.saveProxyConfig(config);
        if (res && res.success) {
          showToast('Proxy settings saved & applied!');
          await loadProxySettings();
        } else {
          alert(`Failed to save proxy: ${res ? res.error : 'Unknown error'}`);
        }
      } catch (err) {
        alert(`Error saving proxy settings: ${err.message}`);
      }
    });
  }
}

// escapeHtml() comes from safe-html.js (loaded before this script)

// ─── Hash Navigation (e.g. #privacy) ────────────────────────────────────────
function handleHash() {
  const hash = (window.location.hash || '').replace('#', '');
  if (hash) {
    const targetLink = document.querySelector(`.nav-item[data-tab="${CSS.escape(hash)}"]`);
    if (targetLink) targetLink.click();
  }
}
window.addEventListener('hashchange', handleHash);

// Return to browsing
btnBackToBrowsing.addEventListener('click', () => {
  if (window.mtcAPI && window.mtcAPI.navigateCurrentTab) {
    window.mtcAPI.navigateCurrentTab('mtc://newtab');
  }
});

// Reset defaults
btnResetDefaults.addEventListener('click', async () => {
  if (confirm('Reset all settings to default values?')) {
    const defaults = {
      searchEngine: 'google',
      adBlockerEnabled: true,
      passwordAutofillEnabled: true,
      popupBlockerEnabled: true,
      privacyBlockThirdPartyCookies: true,
      privacyStripTrackingParams: true,
      privacyGpc: true,
      privacyHttpsOnly: true,
      privacyFingerprintProtection: true,
      ramSaverEnabled: true,
      ramSaverTimeoutMinutes: 15,
      theme: 'dark',
      startupBehavior: 'newtab',
      showBookmarksBar: true
    };
    await saveSettingChange(defaults);
    initSettings();
    showToast('Reset to Defaults!');
  }
});

// Stage 6 Controllers Setup
setupPasswordsController();
setupAutofillController();
setupProxyController();
setupAutoUpdateController();

initSettings();
handleHash();

// ─── Chrome-Style Auto-Update Controller ─────────────────────────────────────
function setupAutoUpdateController() {
  const btnCheckUpdates = document.getElementById('btn-check-updates');
  const btnRelaunchUpdate = document.getElementById('btn-relaunch-update');
  const updateStatusTitle = document.getElementById('update-status-title');
  const updateStatusDesc = document.getElementById('update-status-desc');
  const updateStatusIcon = document.getElementById('update-status-icon');
  const updateSpinner = document.getElementById('update-spinner');
  // the status icon of the update card (an icon of icons.js; the frame of the card colours it)
  const setUpdateIcon = (name) => {
    const svg = window.ShIcons.create(name);
    if (updateStatusIcon && svg) { updateStatusIcon.replaceChildren(svg); updateStatusIcon.dataset.state = name; }
  };
  const updateProgressContainer = document.getElementById('update-progress-container');
  const updateProgressBar = document.getElementById('update-progress-bar');
  const updateProgressText = document.getElementById('update-progress-text');
  const updateProgressSpeed = document.getElementById('update-progress-speed');
  const aboutBrowserVersion = document.getElementById('about-browser-version');
  const aboutMetaVersion = document.getElementById('about-meta-version');

  if (!btnCheckUpdates || !window.mtcAPI) return;

  const RELEASES_PAGE = 'https://github.com/jaydipvirja/shmmoth-browser/releases/latest';
  let lastManualDownloadUrl = RELEASES_PAGE;

  function renderStatus(status) {
    if (!status) return;
    if (status.manualDownloadUrl) lastManualDownloadUrl = status.manualDownloadUrl;

    const currentVer = status.currentVersion || '1.0.0';
    if (aboutBrowserVersion) aboutBrowserVersion.textContent = currentVer;
    if (aboutMetaVersion) aboutMetaVersion.textContent = currentVer;

    switch (status.status) {
      case 'checking':
        if (updateSpinner) updateSpinner.classList.remove('hidden');
        if (updateStatusIcon) updateStatusIcon.classList.add('hidden');
        if (updateStatusTitle) updateStatusTitle.textContent = 'Checking for updates...';
        if (updateStatusDesc) updateStatusDesc.textContent = `Current version ${currentVer}`;
        if (btnCheckUpdates) btnCheckUpdates.disabled = true;
        if (updateProgressContainer) updateProgressContainer.classList.add('hidden');
        break;

      case 'available':
        if (updateSpinner) updateSpinner.classList.add('hidden');
        if (updateStatusIcon) {
          setUpdateIcon('download');
          updateStatusIcon.classList.remove('hidden');
        }
        if (updateStatusTitle) updateStatusTitle.textContent = `Update available: v${status.availableVersion || ''}`;
        if (status.autoInstall === false) {
          // Cannot be installed automatically (unsigned release / signing not configured): point to the releases page
          if (updateStatusDesc) updateStatusDesc.textContent = status.message || 'Download the new version from the releases page.';
          if (btnCheckUpdates) { btnCheckUpdates.disabled = false; btnCheckUpdates.classList.remove('hidden'); }
          if (updateProgressContainer) updateProgressContainer.classList.add('hidden');
        } else {
          if (updateStatusDesc) updateStatusDesc.textContent = 'Downloading update in background...';
          if (btnCheckUpdates) btnCheckUpdates.disabled = true;
          if (updateProgressContainer) updateProgressContainer.classList.remove('hidden');
        }
        break;

      case 'downloading':
        if (updateSpinner) updateSpinner.classList.add('hidden');
        if (updateStatusIcon) {
          setUpdateIcon('download');
          updateStatusIcon.classList.remove('hidden');
        }
        if (updateStatusTitle) updateStatusTitle.textContent = 'Downloading update...';
        if (updateProgressContainer) updateProgressContainer.classList.remove('hidden');
        if (updateProgressBar) updateProgressBar.style.width = `${status.percent || 0}%`;
        if (updateProgressText) updateProgressText.textContent = `Downloading: ${status.percent || 0}%`;
        if (updateProgressSpeed && status.bytesPerSecond) {
          const mbps = (status.bytesPerSecond / (1024 * 1024)).toFixed(1);
          updateProgressSpeed.textContent = `${mbps} MB/s`;
        }
        break;

      case 'downloaded':
        if (updateSpinner) updateSpinner.classList.add('hidden');
        if (updateStatusIcon) {
          setUpdateIcon('check');
          updateStatusIcon.classList.remove('hidden');
        }
        if (updateStatusTitle) updateStatusTitle.textContent = 'Update ready to install!';
        if (updateStatusDesc) updateStatusDesc.textContent = `Version ${status.availableVersion || ''} is downloaded. Restart SHMMOTH Browser to apply.`;
        if (updateProgressContainer) updateProgressContainer.classList.add('hidden');
        if (btnCheckUpdates) btnCheckUpdates.classList.add('hidden');
        if (btnRelaunchUpdate) btnRelaunchUpdate.classList.remove('hidden');
        break;

      case 'not-available':
        if (updateSpinner) updateSpinner.classList.add('hidden');
        if (updateStatusIcon) {
          setUpdateIcon('check');
          updateStatusIcon.classList.remove('hidden');
        }
        if (updateStatusTitle) updateStatusTitle.textContent = 'SHMMOTH Browser is up to date';
        if (updateStatusDesc) updateStatusDesc.textContent = `Version ${currentVer} (Official 64-bit Build)`;
        if (btnCheckUpdates) {
          btnCheckUpdates.disabled = false;
          btnCheckUpdates.classList.remove('hidden');
        }
        if (btnRelaunchUpdate) btnRelaunchUpdate.classList.add('hidden');
        if (updateProgressContainer) updateProgressContainer.classList.add('hidden');
        break;

      case 'error':
        if (updateSpinner) updateSpinner.classList.add('hidden');
        if (updateStatusIcon) {
          setUpdateIcon('warning');
          updateStatusIcon.classList.remove('hidden');
        }
        if (updateStatusTitle) updateStatusTitle.textContent = 'Could not check for updates';
        if (updateStatusDesc) updateStatusDesc.textContent = status.message || status.error || 'Server unreachable';
        if (btnCheckUpdates) {
          btnCheckUpdates.disabled = false;
          btnCheckUpdates.classList.remove('hidden');
        }
        if (updateProgressContainer) updateProgressContainer.classList.add('hidden');
        break;

      default:
        if (updateSpinner) updateSpinner.classList.add('hidden');
        if (updateStatusIcon) {
          setUpdateIcon('check');
          updateStatusIcon.classList.remove('hidden');
        }
        if (updateStatusTitle) updateStatusTitle.textContent = 'SHMMOTH Browser is up to date';
        if (updateStatusDesc) updateStatusDesc.textContent = `Version ${currentVer} (Official 64-bit Build)`;
        if (btnCheckUpdates) btnCheckUpdates.disabled = false;
        break;
    }
  }

  // Load initial status
  if (typeof window.mtcAPI.getUpdateStatus === 'function') {
    window.mtcAPI.getUpdateStatus().then(status => {
      renderStatus(status);
    }).catch(() => {});
  }

  // Subscribe to live push events
  if (typeof window.mtcAPI.onUpdateStatus === 'function') {
    window.mtcAPI.onUpdateStatus(status => {
      renderStatus(status);
    });
  }

  // Handle "Check for updates" click
  btnCheckUpdates.addEventListener('click', async () => {
    renderStatus({ status: 'checking', currentVersion: aboutBrowserVersion ? aboutBrowserVersion.textContent : '1.0.0' });
    if (typeof window.mtcAPI.checkForUpdates === 'function') {
      try {
        const res = await window.mtcAPI.checkForUpdates();
        renderStatus(res);
      } catch (err) {
        renderStatus({ status: 'error', error: err.message });
      }
    }
  });

  // Handle "Relaunch to update" click
  if (btnRelaunchUpdate) {
    btnRelaunchUpdate.addEventListener('click', () => {
      if (typeof window.mtcAPI.installUpdate === 'function') {
        window.mtcAPI.installUpdate();
      }
    });
  }

  // Handle direct installer download button click
  const btnDownloadInstaller = document.getElementById('btn-download-installer');
  if (btnDownloadInstaller) {
    btnDownloadInstaller.addEventListener('click', async () => {
      btnDownloadInstaller.disabled = true;
      try {
        if (window.mtcAPI && window.mtcAPI.downloadLatestInstaller) {
          const res = await window.mtcAPI.downloadLatestInstaller();
          if (res && res.success) {
            showToast('Starting installer download! Check Downloads (Ctrl+J)');
          } else {
            const url = lastManualDownloadUrl || RELEASES_PAGE;
            if (window.mtcAPI.createTab) window.mtcAPI.createTab(url);
          }
        } else {
          const url = lastManualDownloadUrl || RELEASES_PAGE;
          if (window.mtcAPI && window.mtcAPI.createTab) {
            window.mtcAPI.createTab(url);
          } else {
            window.open(url, '_blank');
          }
        }
      } catch (err) {
        showToast('Download error: ' + err.message);
      } finally {
        setTimeout(() => { btnDownloadInstaller.disabled = false; }, 1500);
      }
    });
  }

  // Handle direct manual download button click
  const btnManualDownload = document.getElementById('btn-manual-download');
  if (btnManualDownload) {
    btnManualDownload.addEventListener('click', () => {
      // Opens the releases page (always the newest release) instead of a hard-coded old installer
      const url = lastManualDownloadUrl || RELEASES_PAGE;
      if (window.mtcAPI && window.mtcAPI.createTab) {
        window.mtcAPI.createTab(url);
      } else {
        window.open(url, '_blank');
      }
    });
  }
}

