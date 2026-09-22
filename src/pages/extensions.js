/**
 * SHMMOTH BROWSER — EXTENSIONS PAGE CONTROLLER (extensions.js)
 *
 * Drives the mtc://extensions internal page.
 * Strictly communicates via window.mtcAPI / window.shmmothAPI.
 */

'use strict';

(function () {
  const api = window.mtcAPI || window.shmmothAPI;
  if (!api) {
    console.error('[EXTENSIONS] Privileged internal API not available.');
    return;
  }

  // State
  let extensions = [];
  let isDevMode = false;
  let pendingInstall = null;
  let activeDetailsId = null;
  let activeErrorsId = null;

  // DOM Elements
  const devModeToggle        = document.getElementById('dev-mode-toggle');
  const devToolbar           = document.getElementById('dev-toolbar');
  const btnLoadUnpacked      = document.getElementById('btn-load-unpacked');
  const btnUpdateExtensions  = document.getElementById('btn-update-extensions');
  const searchInput          = document.getElementById('ext-search-input');
  const extensionsGrid       = document.getElementById('extensions-grid');
  const emptyState           = document.getElementById('ext-empty-state');
  const extCountBadge        = document.getElementById('ext-count-badge');
  const toastContainer       = document.getElementById('toast-container');

  // Modals
  const modalInstall         = document.getElementById('modal-install-approval');
  const btnCloseInstall      = document.getElementById('btn-close-install-modal');
  const btnCancelInstall     = document.getElementById('btn-cancel-install');
  const btnConfirmInstall    = document.getElementById('btn-confirm-install');

  const modalDetails         = document.getElementById('modal-extension-details');
  const btnCloseDetails      = document.getElementById('btn-close-details-modal');
  const btnDetailsDone       = document.getElementById('btn-details-done');
  const btnDetailsRemove     = document.getElementById('btn-details-remove');

  const modalErrors          = document.getElementById('modal-extension-errors');
  const btnCloseErrors       = document.getElementById('btn-close-errors-modal');
  const btnErrorsClear       = document.getElementById('btn-errors-clear');
  const btnErrorsReload      = document.getElementById('btn-errors-reload');

  // ─── Initialization ───────────────────────────────────────────────────────

  async function init() {
    try {
      const res = await api.getAllExtensions();
      if (res) {
        extensions = Array.isArray(res.extensions) ? res.extensions : (Array.isArray(res) ? res : []);
        isDevMode = Boolean(res.developerMode);
      }

      devModeToggle.checked = isDevMode;
      updateDevModeUI();
      renderGrid();

      // Listen for main process updates
      if (api.onExtensionsUpdated) {
        api.onExtensionsUpdated((updatedList) => {
          extensions = Array.isArray(updatedList) ? updatedList : [];
          renderGrid();
        });
      }

      // Theme sync
      if (api.getSettings) {
        const s = await api.getSettings().catch(() => ({}));
        if (s && s.theme) {
          document.body.classList.toggle('theme-light', s.theme === 'light');
        }
      }
      if (api.onThemeChanged) {
        api.onThemeChanged((theme) => {
          document.body.classList.toggle('theme-light', theme === 'light');
        });
      }
    } catch (err) {
      console.error('[EXTENSIONS] Failed to load extensions:', err);
      showToast('Error loading extensions: ' + err.message);
    }
  }

  function updateDevModeUI() {
    if (isDevMode) {
      devToolbar.classList.remove('hidden');
    } else {
      devToolbar.classList.add('hidden');
    }
    // Re-render to show/hide developer-only card actions (e.g. reload button)
    renderGrid();
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  function renderGrid() {
    const query = (searchInput.value || '').trim().toLowerCase();
    const filtered = extensions.filter(ext => {
      if (!query) return true;
      const name = (ext.name || '').toLowerCase();
      const desc = (ext.description || '').toLowerCase();
      const id   = (ext.id || '').toLowerCase();
      return name.includes(query) || desc.includes(query) || id.includes(query);
    });

    extCountBadge.textContent = `${extensions.length} extension${extensions.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
      extensionsGrid.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    extensionsGrid.innerHTML = '';

    for (const ext of filtered) {
      const card = createExtensionCard(ext);
      extensionsGrid.appendChild(card);
    }
  }

  function createExtensionCard(ext) {
    const card = document.createElement('div');
    card.className = 'ext-card';
    card.dataset.id = ext.id;

    const isMV2 = ext.isLegacyMV2 || ext.manifestVersion === 2;
    const statusClass = ext.status === 'active' ? 'active' : (ext.status === 'error' ? 'error' : (ext.status === 'missing' ? 'missing' : 'disabled'));
    const statusText  = ext.status || (ext.enabled ? 'Active' : 'Disabled');

    // Icon handling
    let iconHtml = '<span class="default-icon">🧩</span>';
    if (ext.icons && (ext.icons['48'] || ext.icons['32'] || ext.icons['128'] || ext.icons['16'])) {
      const iconRel = ext.icons['48'] || ext.icons['128'] || ext.icons['32'] || ext.icons['16'];
      const iconPath = `file:///${ext.path.replace(/\\/g, '/')}/${iconRel.replace(/^[\/\\]+/, '')}`;
      iconHtml = `<img src="${escapeHtml(iconPath)}" alt="icon" onerror="this.parentElement.innerHTML='🧩'">`;
    }

    card.innerHTML = `
      <div class="ext-card-header">
        <div class="ext-card-icon-wrapper">
          ${iconHtml}
        </div>
        <div class="ext-card-title-group">
          <div class="ext-card-title" title="${escapeHtml(ext.name)}">${escapeHtml(ext.name)}</div>
          <div class="ext-card-meta">
            <span class="ext-version-badge">v${escapeHtml(ext.version)}</span>
            <span class="badge-status ${statusClass}">${statusText}</span>
            ${isMV2 ? '<span class="badge-mv2">Manifest V2 — Legacy</span>' : ''}
          </div>
        </div>
      </div>

      <div class="ext-card-desc" title="${escapeHtml(ext.description || 'No description provided.')}">
        ${escapeHtml(ext.description || 'No description provided.')}
      </div>

      <div class="ext-card-path" title="${escapeHtml(ext.path || '')}">
        ${escapeHtml(ext.path || '')}
      </div>

      <div class="ext-card-footer">
        <div class="ext-card-buttons">
          <button class="btn-card-action btn-details" data-id="${ext.id}">Details</button>
          ${ext.hasErrors ? `<button class="btn-card-action has-error btn-errors" data-id="${ext.id}">⚠️ Errors (${ext.errorsCount})</button>` : ''}
          ${isDevMode ? `<button class="btn-card-action btn-reload" data-id="${ext.id}" title="Reload extension from disk">Reload</button>` : ''}
          <button class="btn-card-action danger btn-remove" data-id="${ext.id}">Remove</button>
        </div>

        <label class="switch" title="${ext.enabled ? 'Disable extension' : 'Enable extension'}">
          <input type="checkbox" class="toggle-ext-enable" data-id="${ext.id}" ${ext.enabled ? 'checked' : ''}>
          <span class="slider round"></span>
        </label>
      </div>
    `;

    // Wire Card Events
    const toggle = card.querySelector('.toggle-ext-enable');
    toggle.addEventListener('change', async () => {
      try {
        if (toggle.checked) {
          await api.enableExtension(ext.id);
          showToast(`Enabled ${ext.name}`);
        } else {
          await api.disableExtension(ext.id);
          showToast(`Disabled ${ext.name}`);
        }
        await refreshData();
      } catch (err) {
        showToast('Error: ' + err.message);
        toggle.checked = !toggle.checked;
      }
    });

    card.querySelector('.btn-details').addEventListener('click', () => showDetailsModal(ext.id));

    const btnErrors = card.querySelector('.btn-errors');
    if (btnErrors) {
      btnErrors.addEventListener('click', () => showErrorsModal(ext.id));
    }

    const btnReload = card.querySelector('.btn-reload');
    if (btnReload) {
      btnReload.addEventListener('click', async () => {
        try {
          await api.reloadExtension(ext.id);
          showToast(`Reloaded ${ext.name}`);
          await refreshData();
        } catch (err) {
          showToast('Failed to reload: ' + err.message);
        }
      });
    }

    card.querySelector('.btn-remove').addEventListener('click', async () => {
      if (confirm(`Remove "${ext.name}" from SHMMOTH Browser?`)) {
        try {
          await api.removeExtension(ext.id);
          showToast(`Removed ${ext.name}`);
          await refreshData();
        } catch (err) {
          showToast('Failed to remove: ' + err.message);
        }
      }
    });

    return card;
  }

  async function refreshData() {
    const res = await api.getAllExtensions();
    if (res) {
      extensions = Array.isArray(res.extensions) ? res.extensions : (Array.isArray(res) ? res : []);
    }
    renderGrid();
  }

  // ─── Install Approval Modal ───────────────────────────────────────────────

  async function handleLoadUnpacked() {
    try {
      const folderPath = await api.browseExtensionFolder();
      if (!folderPath) return; // User cancelled

      const res = await api.validateExtension(folderPath);
      if (!res || !res.success || !res.validation) {
        showToast('Invalid extension: ' + (res ? res.error : 'Unknown validation failure'));
        return;
      }

      pendingInstall = {
        folderPath,
        validation: res.validation
      };

      displayInstallApprovalModal(res.validation);
    } catch (err) {
      showToast('Validation error: ' + err.message);
    }
  }

  function displayInstallApprovalModal(v) {
    document.getElementById('install-ext-name').textContent = v.name;
    document.getElementById('install-ext-version').textContent = `Version ${v.version}`;
    document.getElementById('install-ext-mv').textContent = v.manifestVersion === 2 ? 'Manifest V2 (Legacy)' : 'Manifest V3';
    document.getElementById('install-ext-desc').textContent = v.description || 'No description provided.';

    // High risk alert
    const highRiskAlert = document.getElementById('install-high-risk-alert');
    const highRiskList  = document.getElementById('install-high-risk-list');
    highRiskList.innerHTML = '';

    if (v.highRiskPermissions && v.highRiskPermissions.length > 0) {
      highRiskAlert.classList.remove('hidden');
      for (const p of v.highRiskPermissions) {
        const li = document.createElement('li');
        li.textContent = `${p.name}: ${p.description}`;
        highRiskList.appendChild(li);
      }
    } else {
      highRiskAlert.classList.add('hidden');
    }

    // Standard permissions
    const permsList = document.getElementById('install-permissions-list');
    permsList.innerHTML = '';
    if (v.safePermissions && v.safePermissions.length > 0) {
      for (const p of v.safePermissions) {
        const li = document.createElement('li');
        li.textContent = `${p.name}: ${p.description}`;
        permsList.appendChild(li);
      }
    } else if (!v.highRiskPermissions || v.highRiskPermissions.length === 0) {
      permsList.innerHTML = '<li style="color:#94a3b8;">No special permissions requested.</li>';
    }

    // Host permissions
    const hostSection = document.getElementById('install-host-perms-section');
    const hostList    = document.getElementById('install-host-list');
    hostList.innerHTML = '';
    if (v.hostPermissions && v.hostPermissions.length > 0) {
      hostSection.classList.remove('hidden');
      for (const h of v.hostPermissions) {
        const li = document.createElement('li');
        li.textContent = h;
        hostList.appendChild(li);
      }
    } else {
      hostSection.classList.add('hidden');
    }

    modalInstall.classList.remove('hidden');
  }

  async function confirmInstall() {
    if (!pendingInstall) return;
    try {
      const res = await api.installExtension(pendingInstall.folderPath);
      if (res && res.success) {
        showToast(`Successfully installed ${res.extension.name}`);
        closeInstallModal();
        await refreshData();
      } else {
        showToast('Installation failed: ' + (res ? res.error : 'Unknown error'));
      }
    } catch (err) {
      showToast('Install error: ' + err.message);
    }
  }

  function closeInstallModal() {
    modalInstall.classList.add('hidden');
    pendingInstall = null;
  }

  // ─── Details Modal ────────────────────────────────────────────────────────

  async function showDetailsModal(extId) {
    activeDetailsId = extId;
    try {
      const details = await api.getExtensionDetails(extId);
      if (!details) {
        showToast('Could not retrieve extension details');
        return;
      }

      document.getElementById('details-ext-title').textContent = details.name;
      document.getElementById('details-version').textContent = details.version;
      document.getElementById('details-mv').textContent = details.manifestVersion === 2 ? 'Manifest V2 (Legacy)' : 'Manifest V3';
      document.getElementById('details-id').textContent = details.id;
      document.getElementById('details-size').textContent = details.sizeFormatted || '0 B';
      document.getElementById('details-path').textContent = details.path;

      // Permissions list
      const permsList = document.getElementById('details-permissions-list');
      permsList.innerHTML = '';
      const allPerms = [...(details.safePermissions || []), ...(details.highRiskPermissions || [])];
      if (allPerms.length > 0) {
        for (const p of allPerms) {
          const li = document.createElement('li');
          li.textContent = `${p.name} — ${p.description}`;
          permsList.appendChild(li);
        }
      } else {
        permsList.innerHTML = '<li style="color:#94a3b8;">No permissions requested.</li>';
      }

      // Toggles
      const cbIncog = document.getElementById('details-toggle-incognito');
      const cbFile  = document.getElementById('details-toggle-file-access');
      cbIncog.checked = Boolean(details.allowIncognito);
      cbFile.checked  = Boolean(details.allowFileAccess);

      cbIncog.onchange = async () => {
        await api.updateExtensionSettings(details.id, { allowIncognito: cbIncog.checked });
      };
      cbFile.onchange = async () => {
        await api.updateExtensionSettings(details.id, { allowFileAccess: cbFile.checked });
      };

      modalDetails.classList.remove('hidden');
    } catch (err) {
      showToast('Error loading details: ' + err.message);
    }
  }

  function closeDetailsModal() {
    modalDetails.classList.add('hidden');
    activeDetailsId = null;
  }

  // ─── Errors Modal ─────────────────────────────────────────────────────────

  async function showErrorsModal(extId) {
    activeErrorsId = extId;
    try {
      const details = await api.getExtensionDetails(extId);
      if (!details) return;

      document.getElementById('errors-ext-title').textContent = `${details.name} - Errors`;
      const container = document.getElementById('errors-log-container');
      container.innerHTML = '';

      const errors = Array.isArray(details.errors) ? details.errors : [];
      if (errors.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8;">No active errors recorded.</p>';
      } else {
        for (const err of errors) {
          const div = document.createElement('div');
          div.className = 'error-log-entry';
          div.innerHTML = `
            <div class="error-log-header">
              <span class="error-log-time">${new Date(err.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="error-log-msg">${escapeHtml(err.message)}</div>
            ${err.stack ? `<pre class="error-log-stack">${escapeHtml(err.stack)}</pre>` : ''}
          `;
          container.appendChild(div);
        }
      }

      modalErrors.classList.remove('hidden');
    } catch (err) {
      showToast('Error loading error log: ' + err.message);
    }
  }

  function closeErrorsModal() {
    modalErrors.classList.add('hidden');
    activeErrorsId = null;
  }

  // ─── Utility Helpers ──────────────────────────────────────────────────────

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  // ─── Event Listeners ───

  devModeToggle.addEventListener('change', async () => {
    isDevMode = devModeToggle.checked;
    await api.setDeveloperMode(isDevMode);
    updateDevModeUI();
    showToast(isDevMode ? 'Developer mode enabled' : 'Developer mode disabled');
  });

  btnLoadUnpacked.addEventListener('click', handleLoadUnpacked);

  btnUpdateExtensions.addEventListener('click', async () => {
    showToast('Checking for extension updates...');
    let updatedCount = 0;
    for (const ext of extensions) {
      try {
        const res = await api.checkExtensionUpdates(ext.id);
        if (res && res.updateAvailable) {
          await api.reloadExtension(ext.id);
          updatedCount++;
        }
      } catch (_) {}
    }
    showToast(updatedCount > 0 ? `Updated ${updatedCount} extensions` : 'All extensions are up to date');
    await refreshData();
  });

  searchInput.addEventListener('input', renderGrid);

  // Install modal
  btnCancelInstall.addEventListener('click', closeInstallModal);
  btnCloseInstall.addEventListener('click', closeInstallModal);
  btnConfirmInstall.addEventListener('click', confirmInstall);

  // Details modal
  btnCloseDetails.addEventListener('click', closeDetailsModal);
  btnDetailsDone.addEventListener('click', closeDetailsModal);
  btnDetailsRemove.addEventListener('click', async () => {
    if (activeDetailsId && confirm('Remove this extension from SHMMOTH Browser?')) {
      await api.removeExtension(activeDetailsId);
      closeDetailsModal();
      await refreshData();
      showToast('Extension removed');
    }
  });

  // Errors modal
  btnCloseErrors.addEventListener('click', closeErrorsModal);
  btnErrorsClear.addEventListener('click', async () => {
    if (activeErrorsId) {
      await api.clearExtensionErrors(activeErrorsId);
      showToast('Errors cleared');
      closeErrorsModal();
      await refreshData();
    }
  });
  btnErrorsReload.addEventListener('click', async () => {
    if (activeErrorsId) {
      await api.reloadExtension(activeErrorsId);
      showToast('Extension reloaded');
      closeErrorsModal();
      await refreshData();
    }
  });

  // Start controller
  init();
})();
