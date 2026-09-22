// MTC BROWSER - Settings Controller

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
const toggleBookmarksBar = document.getElementById('toggle-bookmarks-bar');
const toggleAdblocker = document.getElementById('toggle-adblocker');
const badgeBlockedCount = document.getElementById('badge-blocked-count');
const btnOpenClearData = document.getElementById('btn-open-clear-data');
const btnOpenCookiesModal = document.getElementById('btn-open-cookies-modal');
const toggleAiSidebar = document.getElementById('toggle-ai-sidebar');
const selectAiProvider = document.getElementById('select-ai-provider');
const rowCustomAi = document.getElementById('row-custom-ai');
const inputCustomAi = document.getElementById('input-custom-ai');
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

// Load Settings
async function initSettings() {
  if (window.mtcAPI && window.mtcAPI.getSettings) {
    try {
      currentSettings = await window.mtcAPI.getSettings();
      
      // Populate fields
      selectSearchEngine.value = currentSettings.searchEngine || 'google';
      toggleBookmarksBar.checked = currentSettings.showBookmarksBar ?? true;
      toggleAdblocker.checked = currentSettings.adBlockerEnabled ?? true;
      toggleAiSidebar.checked = currentSettings.aiSidebarEnabled ?? true;
      selectAiProvider.value = currentSettings.aiProvider || 'gemini';
      inputCustomAi.value = currentSettings.aiCustomUrl || 'https://gemini.google.com';
      toggleRamSaver.checked = currentSettings.ramSaverEnabled ?? true;
      selectRamTimeout.value = String(currentSettings.ramSaverTimeoutMinutes || 15);
      selectTheme.value = currentSettings.theme || 'dark';
      document.body.classList.toggle('theme-light', (currentSettings.theme === 'light'));

      if (selectAiProvider.value === 'custom') {
        rowCustomAi.style.display = 'flex';
      } else {
        rowCustomAi.style.display = 'none';
      }

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

toggleBookmarksBar.addEventListener('change', () => {
  saveSettingChange({ showBookmarksBar: toggleBookmarksBar.checked });
});

toggleAdblocker.addEventListener('change', () => {
  saveSettingChange({ adBlockerEnabled: toggleAdblocker.checked });
});

toggleAiSidebar.addEventListener('change', () => {
  saveSettingChange({ aiSidebarEnabled: toggleAiSidebar.checked });
});

selectAiProvider.addEventListener('change', () => {
  const prov = selectAiProvider.value;
  rowCustomAi.style.display = (prov === 'custom') ? 'flex' : 'none';
  
  let targetUrl = 'https://gemini.google.com';
  if (prov === 'chatgpt') targetUrl = 'https://chatgpt.com';
  else if (prov === 'custom') targetUrl = inputCustomAi.value;

  saveSettingChange({
    aiProvider: prov,
    aiCustomUrl: targetUrl
  });
});

inputCustomAi.addEventListener('change', () => {
  if (selectAiProvider.value === 'custom') {
    saveSettingChange({ aiCustomUrl: inputCustomAi.value.trim() });
  }
});

toggleRamSaver.addEventListener('change', () => {
  saveSettingChange({ ramSaverEnabled: toggleRamSaver.checked });
});

selectRamTimeout.addEventListener('change', () => {
  saveSettingChange({ ramSaverTimeoutMinutes: parseInt(selectRamTimeout.value, 10) });
});

selectTheme.addEventListener('change', () => {
  const newTheme = selectTheme.value;
  document.body.classList.toggle('theme-light', (newTheme === 'light'));
  saveSettingChange({ theme: newTheme });
});

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
        <span class="cookie-meta">${cookie.secure ? '🔒 Secure' : 'HTTP'} • ${cookie.session ? 'Session' : 'Persistent'}</span>
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
      let icon = '🔒';
      if (perm === 'media') icon = '📷';
      else if (perm === 'geolocation') icon = '📍';
      else if (perm === 'notifications') icon = '🔔';
      tagsHtml += `
        <span class="perm-tag ${escapeHtml(decision)}">
          <span>${icon} ${escapeHtml(perm)}:</span>
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
        ${tagsHtml || '<span style="color:#64748b;font-size:12px;">No active rules</span>'}
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

function renderPasswords() {
  if (!passwordsList) return;
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
        <button class="btn-icon btn-reveal-pw" title="Reveal Password">👁️</button>
      </div>
      <div class="password-actions-col">
        <button class="btn-icon btn-copy-user" title="Copy Username">📋 User</button>
        <button class="btn-icon btn-copy-pass" title="Copy Password">📋 Pass</button>
        <button class="btn-icon btn-edit-pw" title="Edit">✏️</button>
        <button class="btn-icon btn-delete-pw" title="Delete">🗑️</button>
      </div>
    `;

    const valDisplay = row.querySelector('.password-val-display');
    const btnReveal = row.querySelector('.btn-reveal-pw');
    const btnCopyUser = row.querySelector('.btn-copy-user');
    const btnCopyPass = row.querySelector('.btn-copy-pass');
    const btnEdit = row.querySelector('.btn-edit-pw');
    const btnDelete = row.querySelector('.btn-delete-pw');

    let revealedPlaintext = null;

    btnReveal.addEventListener('click', async () => {
      if (valDisplay.dataset.revealed === 'true') {
        valDisplay.textContent = '••••••••';
        valDisplay.dataset.revealed = 'false';
        btnReveal.textContent = '👁️';
      } else {
        if (!revealedPlaintext && window.mtcAPI && window.mtcAPI.revealPassword) {
          const res = await window.mtcAPI.revealPassword(item.id);
          if (res && res.success) {
            revealedPlaintext = res.password;
          }
        }
        if (revealedPlaintext !== null) {
          valDisplay.textContent = revealedPlaintext;
          valDisplay.dataset.revealed = 'true';
          btnReveal.textContent = '🔒';
        }
      }
    });

    btnCopyUser.addEventListener('click', () => {
      navigator.clipboard.writeText(item.username || '').then(() => {
        showToast('Username copied to clipboard!');
      });
    });

    btnCopyPass.addEventListener('click', async () => {
      let pass = revealedPlaintext;
      if (!pass && window.mtcAPI && window.mtcAPI.revealPassword) {
        const res = await window.mtcAPI.revealPassword(item.id);
        if (res && res.success) pass = res.password;
      }
      if (pass) {
        navigator.clipboard.writeText(pass).then(() => {
          showToast('Password copied to clipboard!');
        });
      }
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
          await window.mtcAPI.updatePassword(id, updates);
          showToast('Password updated!');
        }
      } else {
        if (!password) {
          alert('Password is required for new credential.');
          return;
        }
        if (window.mtcAPI && window.mtcAPI.savePassword) {
          await window.mtcAPI.savePassword({ origin, username, password });
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
        ${prof.email ? `<div>✉️ ${escapeHtml(prof.email)}</div>` : ''}
        ${prof.phone ? `<div>📞 ${escapeHtml(prof.phone)}</div>` : ''}
        ${prof.address ? `<div>🏠 ${escapeHtml(prof.address)}</div>` : ''}
        ${locParts ? `<div>📍 ${escapeHtml(locParts)}</div>` : ''}
      </div>
      <div class="autofill-actions">
        <button class="btn-icon btn-edit-prof" title="Edit Profile">✏️ Edit</button>
        <button class="btn-icon btn-delete-prof" title="Delete Profile">🗑️ Delete</button>
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
          proxyTestStatus.textContent = res.latencyMs !== undefined ? `✅ Connected (${res.latencyMs} ms)` : '✅ Connection active';
        } else {
          proxyTestStatus.className = 'proxy-test-status error';
          proxyTestStatus.textContent = `❌ ${res && res.error ? res.error : 'Connection failed'}`;
        }
      } catch (err) {
        proxyTestStatus.className = 'proxy-test-status error';
        proxyTestStatus.textContent = `❌ ${err.message}`;
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

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Hash Navigation (e.g. #privacy) ────────────────────────────────────────
function handleHash() {
  const hash = (window.location.hash || '').replace('#', '');
  if (hash) {
    const targetLink = document.querySelector(`.nav-item[data-tab="${hash}"]`);
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
      ramSaverEnabled: true,
      ramSaverTimeoutMinutes: 15,
      aiSidebarEnabled: true,
      aiProvider: 'gemini',
      aiCustomUrl: 'https://gemini.google.com',
      theme: 'dark',
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
  const updateProgressContainer = document.getElementById('update-progress-container');
  const updateProgressBar = document.getElementById('update-progress-bar');
  const updateProgressText = document.getElementById('update-progress-text');
  const updateProgressSpeed = document.getElementById('update-progress-speed');
  const aboutBrowserVersion = document.getElementById('about-browser-version');
  const aboutMetaVersion = document.getElementById('about-meta-version');

  if (!btnCheckUpdates || !window.mtcAPI) return;

  function renderStatus(status) {
    if (!status) return;

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
          updateStatusIcon.textContent = '📥';
          updateStatusIcon.classList.remove('hidden');
        }
        if (updateStatusTitle) updateStatusTitle.textContent = `Update available: v${status.availableVersion || ''}`;
        if (updateStatusDesc) updateStatusDesc.textContent = 'Downloading update in background...';
        if (btnCheckUpdates) btnCheckUpdates.disabled = true;
        if (updateProgressContainer) updateProgressContainer.classList.remove('hidden');
        break;

      case 'downloading':
        if (updateSpinner) updateSpinner.classList.add('hidden');
        if (updateStatusIcon) {
          updateStatusIcon.textContent = '⏳';
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
          updateStatusIcon.textContent = '🎉';
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
          updateStatusIcon.textContent = '✅';
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
          updateStatusIcon.textContent = '⚠️';
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
          updateStatusIcon.textContent = '🚀';
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
}

