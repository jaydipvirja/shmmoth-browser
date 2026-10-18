// SHMMOTH BROWSER — Downloads Page Controller (mtc://downloads)
// Ultra-fast IDM-style Turbo Engine & Multi-Source Internet Bonding Controller

'use strict';

const api = window.shmmothAPI || window.mtcAPI;

let downloads = [];
const downloadsList     = document.getElementById('downloads-list');
const searchInput       = document.getElementById('search-downloads');
const btnRefresh        = document.getElementById('btn-refresh');
const btnClearCompleted = document.getElementById('btn-clear-completed');
const btnBack           = document.getElementById('btn-back');
const btnOpenFolder     = document.getElementById('btn-open-folder');
const btnDownloadInstallerSidebar = document.getElementById('btn-download-installer-sidebar');

// Modal Elements
const btnAddDownload    = document.getElementById('btn-add-download');
const modalAddDl        = document.getElementById('modal-add-dl');
const inputDlUrl        = document.getElementById('input-dl-url');
const btnModalCancel    = document.getElementById('btn-modal-cancel');
const btnModalStart     = document.getElementById('btn-modal-start');

// Network Adapters Status Elements
const activeAdaptersList = document.getElementById('active-adapters-list');
const bondingStatusBadge = document.getElementById('bonding-status-badge');

function formatBytes(bytes) {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, safeI)).toFixed(1)) + ' ' + sizes[safeI];
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatETA(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s left`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m left`;
}

// The file type as a short label (PDF, ZIP, EXE …) instead of an emoji, as in the downloads bubble.
// Why a fast download uses one network although multi-network downloading is on (networkNote of the engine)
const NETWORK_NOTES = {
  'one-network': 'One network: only one internet connection reaches this server (connect a second one, e.g. Wi-Fi + cable or phone USB tethering).',
  'site-browser-only': "One network: this site only accepts the browser's own connection, so it cannot be split over networks."
};

function getFileIcon(filename) {
  const name = String(filename || '');
  const ext = name.includes('.') ? name.split('.').pop().slice(0, 4).toUpperCase() : '';
  return ext || 'FILE';
}

function getProgressPercent(record) {
  if (!record.total || record.total <= 0) return 0;
  return Math.min(100, Math.round((record.received / record.total) * 100));
}

// escapeHtml() comes from safe-html.js (loaded before this script)

// state: '' | 'ready' | 'turbo' | 'offline'; html is built from escaped values only
function setBondingStatus(state, icon, html) {
  bondingStatusBadge.className = 'bonding-status' + (state ? ' ' + state : '');
  bondingStatusBadge.innerHTML = `<span class="sh-icon" data-icon="${icon}" aria-hidden="true"></span><span>${html}</span>`;
  window.ShIcons.drawAll(bondingStatusBadge);
}

/**
 * Updates the network status bar showing detected hardware network interfaces.
 */
async function refreshNetworkInterfaces() {
  if (!api || !api.getNetworkInterfaces) return;
  try {
    const ifaces = await api.getNetworkInterfaces();
    if (!activeAdaptersList) return;

    if (!ifaces || ifaces.length === 0) {
      activeAdaptersList.innerHTML = '<span class="net-badge">No active network adapters</span>';
      if (bondingStatusBadge) setBondingStatus('offline', 'wifi-off', 'Offline');
      return;
    }

    // Adapters that only exist inside the computer (WSL, virtual machines, VPNs, containers) leave through the same
    // connection as everything else: they never add speed, so they are not counted as sources.
    const onlineIfaces = ifaces.filter(i => i.isOnline !== false && !i.isVirtual);
    const anyOnline = ifaces.some(i => i.isOnline !== false);

    let bondingOn = true;
    try {
      const settings = api.getSettings ? await api.getSettings() : null;
      if (settings && (settings.multiSourceBonding === false || settings.turboDownloadEnabled === false)) bondingOn = false;
    } catch (_) {}

    activeAdaptersList.innerHTML = ifaces.map((i) => {
      const isOnline = i.isOnline !== false;
      const dotClass = i.isVirtual ? '' : (isOnline ? 'dot-green' : 'dot-amber');
      const statusText = i.isVirtual ? 'Virtual, not used' : (isOnline ? 'Online' : 'No Internet');
      return `
        <span class="net-badge ${dotClass}" title="Interface: ${escapeHtml(i.name)} (${escapeHtml(i.address)}) - ${statusText}">
          ${escapeHtml(i.name)}: <strong>${escapeHtml(i.address)}</strong> <small style="opacity:0.85">(${statusText})</small>
        </span>
      `;
    }).join('');

    if (bondingStatusBadge) {
      if (!bondingOn) {
        setBondingStatus('', 'pause', '<strong>Multi-network downloading is off</strong> (Settings → Downloads)');
      } else if (onlineIfaces.length > 1) {
        const names = onlineIfaces.map(i => i.name).join(' + ');
        setBondingStatus('ready', 'bolt', `<strong>Multi-network ready (${onlineIfaces.length} networks: ${escapeHtml(names)})</strong> • used when the server can be reached through each`);
      } else if (anyOnline) {
        const only = onlineIfaces[0] || ifaces.find(i => i.isOnline !== false);
        setBondingStatus('turbo', 'bolt', `<strong>Turbo active (${escapeHtml(only.name)})</strong> • connect a 2nd network (Wi-Fi + Ethernet or a phone hotspot) for multi-network speed`);
      } else {
        setBondingStatus('offline', 'wifi-off', 'Offline (No Internet Available)');
      }
    }
  } catch (_) {}
}

function renderDownloads() {
  const query = (searchInput.value || '').trim().toLowerCase();

  let filtered = downloads;
  if (query) {
    filtered = filtered.filter(d =>
      (d.filename && d.filename.toLowerCase().includes(query)) ||
      (d.url && d.url.toLowerCase().includes(query))
    );
  }

  if (!filtered || filtered.length === 0) {
    downloadsList.innerHTML = `<div class="empty-state"><span class="sh-icon" data-icon="download" aria-hidden="true"></span><p>${query ? 'No download matches your search.' : 'Files you download will show up here.'}</p></div>`;
    window.ShIcons.drawAll(downloadsList);
    return;
  }

  downloadsList.innerHTML = '';

  [...filtered].reverse().forEach(record => {
    const pct = getProgressPercent(record);
    const sizeStr = record.total > 0
      ? `${formatBytes(record.received)} / ${formatBytes(record.total)} (${pct}%)`
      : formatBytes(record.received);

    const speedStr = (record.state === 'progressing' && record.speed > 0)
      ? formatSpeed(record.speed)
      : '';

    const etaStr = (record.state === 'progressing' && record.eta > 0)
      ? formatETA(record.eta)
      : '';

    const fileIcon = getFileIcon(record.filename);

    const div = document.createElement('div');
    div.className = 'dl-item';
    div.dataset.id = record.id;

    // Action buttons based on state
    let actionButtons = '';
    if (record.state === 'progressing') {
      actionButtons = `
        <button class="btn-dl-action btn-pause" data-id="${escapeHtml(record.id)}"><span class="sh-icon" data-icon="pause" aria-hidden="true"></span>Pause</button>
        <button class="btn-dl-action danger btn-cancel" data-id="${escapeHtml(record.id)}"><span class="sh-icon" data-icon="close" aria-hidden="true"></span>Cancel</button>
      `;
    } else if (record.state === 'paused') {
      actionButtons = `
        <button class="btn-dl-action btn-resume" data-id="${escapeHtml(record.id)}"><span class="sh-icon" data-icon="play" aria-hidden="true"></span>Resume</button>
        <button class="btn-dl-action danger btn-cancel" data-id="${escapeHtml(record.id)}"><span class="sh-icon" data-icon="close" aria-hidden="true"></span>Cancel</button>
      `;
    } else if (record.state === 'completed') {
      actionButtons = `
        <button class="btn-dl-action btn-open" data-id="${escapeHtml(record.id)}">Open File</button>
        <button class="btn-dl-action btn-folder" data-id="${escapeHtml(record.id)}">Show in Folder</button>
        <button class="btn-dl-action danger btn-remove" data-id="${escapeHtml(record.id)}" title="Remove from list" aria-label="Remove from list"><span class="sh-icon" data-icon="close" aria-hidden="true"></span></button>
      `;
    } else {
      // Cancelled or Interrupted
      actionButtons = `
        <button class="btn-dl-action btn-retry" data-url="${escapeHtml(record.url)}"><span class="sh-icon" data-icon="reload" aria-hidden="true"></span>Retry</button>
        <button class="btn-dl-action btn-folder" data-id="${escapeHtml(record.id)}">Show Folder</button>
        <button class="btn-dl-action danger btn-remove" data-id="${escapeHtml(record.id)}" title="Remove from list" aria-label="Remove from list"><span class="sh-icon" data-icon="close" aria-hidden="true"></span></button>
      `;
    }

    // Turbo & Bonding Badges
    let turboBadges = '';
    if (record.isTurbo) {
      turboBadges += `<span class="badge-turbo"><span class="sh-icon" data-icon="bolt" aria-hidden="true"></span>Turbo (${record.threadsCount || 8} Streams)</span>`;
      if (record.isMultiSource) {
        turboBadges += `<span class="badge-turbo badge-bonding"><span class="sh-icon" data-icon="globe" aria-hidden="true"></span>Multi-Source</span>`;
      }
    }

    // IDM-Style Segmented Visualizer Bar vs Flat Bar
    let visualizerHtml = '';
    const isRunning = record.state === 'progressing' || record.state === 'paused';

    if (isRunning) {
      if (record.isTurbo && record.segments && record.segments.length > 0) {
        // IDM Segmented Visualizer
        const segmentsHtml = record.segments.map((seg, sIdx) => {
          const segPct = seg.percent || (seg.total > 0 ? Math.min(100, Math.round((seg.received / seg.total) * 100)) : 0);
          const ifaceClass = `iface-${sIdx % 4}`;
          const ifaceTooltip = seg.interfaceName ? `Part ${sIdx + 1} (${segPct}%) via ${seg.interfaceName}` : `Part ${sIdx + 1} (${segPct}%)`;
          return `
            <div class="dl-segment-slot" title="${escapeHtml(ifaceTooltip)}">
              <div class="dl-segment-fill ${ifaceClass}" style="width: ${segPct}%;"></div>
            </div>
          `;
        }).join('');

        visualizerHtml = `<div class="dl-segments-container">${segmentsHtml}</div>`;
      } else {
        // Standard Single-stream bar
        visualizerHtml = `
          <div class="dl-progress-bar">
            <div class="dl-progress-fill ${record.state === 'paused' ? 'paused' : ''}" style="width:${pct}%"></div>
          </div>
        `;
      }
    }

    // Per-interface speed chips
    let ifaceChipsHtml = '';
    if (record.isTurbo && record.interfaces && record.interfaces.length > 1 && record.state === 'progressing') {
      ifaceChipsHtml = `<div class="dl-interfaces-chips">` + record.interfaces.map(i => {
        const iSpeed = i.speed > 0 ? `${formatSpeed(i.speed)}` : 'Idle';
        return `<span class="iface-chip ${i.speed > 0 ? 'active' : ''}">${escapeHtml(i.name)}: ${iSpeed}</span>`;
      }).join('') + `</div>`;
    }

    div.innerHTML = `
      <div class="dl-icon-container">${escapeHtml(fileIcon)}</div>
      <div class="dl-body">
        <div class="dl-header">
          <div class="dl-title-row">
            <span class="dl-filename" title="${escapeHtml(record.savePath || record.filename)}">${escapeHtml(record.filename)}</span>
            ${turboBadges}
          </div>
          <span class="dl-state ${escapeHtml(record.state)}">${escapeHtml(record.state)}</span>
        </div>
        <div class="dl-url" title="${escapeHtml(record.url)}">${escapeHtml(record.url)}</div>
        ${record.turboNote && !record.isTurbo ? `<div class="dl-note" title="${escapeHtml(record.turboNote)}">${escapeHtml(record.turboNote)}</div>` : ''}
        ${record.isTurbo && !record.isMultiSource && NETWORK_NOTES[record.networkNote] ? `<div class="dl-note">${NETWORK_NOTES[record.networkNote]}</div>` : ''}
        ${visualizerHtml}
        <div class="dl-footer">
          <div class="dl-meta">
            <span class="dl-size">${sizeStr}</span>
            ${record.error && (record.state === 'interrupted' || record.state === 'cancelled') ? `<span class="dl-error" title="${escapeHtml(record.error)}">${escapeHtml(record.error)}</span>` : ''}
            ${speedStr ? `<span class="dl-speed">${speedStr}</span>` : ''}
            ${etaStr ? `<span class="dl-eta">• ${etaStr}</span>` : ''}
            ${ifaceChipsHtml}
          </div>
          <div class="dl-actions">
            ${actionButtons}
          </div>
        </div>
      </div>
    `;

    // Wire button events
    const pauseBtn  = div.querySelector('.btn-pause');
    const resumeBtn = div.querySelector('.btn-resume');
    const cancelBtn = div.querySelector('.btn-cancel');
    const openBtn   = div.querySelector('.btn-open');
    const folderBtn = div.querySelector('.btn-folder');
    const removeBtn = div.querySelector('.btn-remove');
    const retryBtn  = div.querySelector('.btn-retry');

    if (pauseBtn) {
      pauseBtn.addEventListener('click', async () => {
        if (api && api.pauseDownload) {
          await api.pauseDownload(record.id);
          loadDownloads();
        }
      });
    }

    if (resumeBtn) {
      resumeBtn.addEventListener('click', async () => {
        if (api && api.resumeDownload) {
          await api.resumeDownload(record.id);
          loadDownloads();
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        if (api && api.cancelDownload) {
          await api.cancelDownload(record.id);
          loadDownloads();
        }
      });
    }

    if (openBtn) {
      openBtn.addEventListener('click', async () => {
        if (api && api.openDownloadedFile) {
          const res = await api.openDownloadedFile(record.id);
          if (res && !res.success) alert(res.error || 'Could not open file.');
        }
      });
    }

    if (folderBtn) {
      folderBtn.addEventListener('click', async () => {
        if (api && api.showDownloadInFolder) {
          const shown = await api.showDownloadInFolder(record.id);
          if (!shown && api.openDownloadsFolder) {
            await api.openDownloadsFolder();
          }
        }
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        if (api && api.removeDownload) {
          await api.removeDownload(record.id);
          downloads = downloads.filter(d => d.id !== record.id);
          renderDownloads();
        }
      });
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        if (api && api.retryDownload) {
          await api.retryDownload(record.url);
        } else if (api && api.navigateCurrentTab) {
          api.navigateCurrentTab(record.url);
        }
      });
    }

    window.ShIcons.drawAll(div);
    downloadsList.appendChild(div);
  });
}

async function loadDownloads() {
  if (api && api.getDownloads) {
    try {
      downloads = await api.getDownloads();
    } catch (_) {
      downloads = [];
    }
  }
  renderDownloads();
  refreshNetworkInterfaces();
}

// Real-time updates from DownloadManager via IPC push
if (api && api.onDownloadUpdate) {
  api.onDownloadUpdate((record) => {
    if (!record || !record.id) return;
    const idx = downloads.findIndex(d => d.id === record.id);
    if (idx >= 0) {
      downloads[idx] = record;
    } else {
      downloads.push(record);
    }
    renderDownloads();
  });
}

searchInput.addEventListener('input', () => {
  renderDownloads();
});

btnRefresh.addEventListener('click', loadDownloads);

if (btnOpenFolder) {
  btnOpenFolder.addEventListener('click', async () => {
    if (api && api.openDownloadsFolder) {
      await api.openDownloadsFolder();
    }
  });
}

btnClearCompleted.addEventListener('click', async () => {
  if (api && api.clearDownloads) {
    await api.clearDownloads();
    loadDownloads();
  }
});

btnBack.addEventListener('click', () => {
  if (api && api.navigateCurrentTab) {
    api.navigateCurrentTab('mtc://newtab');
  }
});

if (btnDownloadInstallerSidebar) {
  btnDownloadInstallerSidebar.addEventListener('click', async () => {
    btnDownloadInstallerSidebar.disabled = true;
    try {
      if (api && api.downloadLatestInstaller) {
        await api.downloadLatestInstaller();
      } else if (api && api.createTab) {
        api.createTab('https://github.com/jaydipvirja/shmmoth-browser/releases/latest');
      }
    } catch (err) {
      alert('Could not start installer download: ' + err.message);
    } finally {
      setTimeout(() => { btnDownloadInstallerSidebar.disabled = false; }, 1500);
    }
  });
}

// Modal Logic
if (btnAddDownload && modalAddDl) {
  btnAddDownload.addEventListener('click', () => {
    modalAddDl.classList.add('open');
    if (inputDlUrl) {
      inputDlUrl.value = '';
      inputDlUrl.focus();
    }
  });
}

if (btnModalCancel && modalAddDl) {
  btnModalCancel.addEventListener('click', () => {
    modalAddDl.classList.remove('open');
  });
}

if (btnModalStart && inputDlUrl) {
  btnModalStart.addEventListener('click', async () => {
    const url = inputDlUrl.value.trim();
    if (!url) return;

    if (api && api.startTurboDownload) {
      btnModalStart.disabled = true;
      btnModalStart.textContent = 'Connecting...';
      try {
        const res = await api.startTurboDownload({ url });
        if (res && res.success) {
          modalAddDl.classList.remove('open');
          loadDownloads();
        } else {
          alert('Could not start download: ' + (res.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        btnModalStart.disabled = false;
        btnModalStart.textContent = 'Download Now';
      }
    }
  });
}

loadDownloads();
refreshNetworkInterfaces();
