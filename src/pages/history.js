// SHMMOTH BROWSER — History Page Controller (mtc://history)
// Stage 2: Search, time-range clearing, batch item selection, date grouping

'use strict';

const api = window.shmmothAPI || window.mtcAPI;

let historyItems = [];
let selectedIds = new Set();
let debounceTimer = null;

const historyContainer     = document.getElementById('history-container');
const historySearchInput   = document.getElementById('history-search-input');
const selectionBar         = document.getElementById('selection-bar');
const selectionCount       = document.getElementById('selection-count');
const btnSelectAll         = document.getElementById('btn-select-all');
const btnDeleteSelected    = document.getElementById('btn-delete-selected');
const btnCancelSelection   = document.getElementById('btn-cancel-selection');
const clearRangeModal      = document.getElementById('clear-range-modal');
const btnOpenClearModal    = document.getElementById('btn-open-clear-modal');
const btnCloseModal        = document.getElementById('btn-close-modal');
const btnConfirmRangeClear = document.getElementById('btn-confirm-range-clear');
const rangeSelect          = document.getElementById('range-select');
const btnBack              = document.getElementById('btn-back');

// ─── Helpers ────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getDateGroupLabel(timestamp) {
  if (!timestamp) return 'Older';
  const itemDate = new Date(timestamp);
  const now = new Date();

  const isToday =
    itemDate.getDate() === now.getDate() &&
    itemDate.getMonth() === now.getMonth() &&
    itemDate.getFullYear() === now.getFullYear();

  if (isToday) return 'Today';

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    itemDate.getDate() === yesterday.getDate() &&
    itemDate.getMonth() === yesterday.getMonth() &&
    itemDate.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return 'Yesterday';

  return itemDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Render History ─────────────────────────────────────────────────────────
function renderHistory() {
  historyContainer.innerHTML = '';
  selectedIds.clear();
  updateSelectionBar();

  if (!historyItems || historyItems.length === 0) {
    historyContainer.innerHTML = '<p style="color:#64748b; padding: 36px 0; text-align: center;">No browsing history found.</p>';
    return;
  }

  // Group by date
  const groups = {};
  historyItems.forEach(item => {
    const t = item.visitTime || item.timestamp || Date.now();
    const group = getDateGroupLabel(t);
    if (!groups[group]) groups[group] = [];
    groups[group].push(item);
  });

  for (const [groupLabel, items] of Object.entries(groups)) {
    const groupHeader = document.createElement('div');
    groupHeader.className = 'date-group-header';
    groupHeader.textContent = groupLabel;
    historyContainer.appendChild(groupHeader);

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-item';
      row.dataset.id = item.id;

      const t = item.visitTime || item.timestamp || Date.now();
      const timeStr = new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const visitCount = item.visitCount || 1;
      const countBadge = visitCount > 1 ? `<span class="visit-count-badge">${visitCount} visits</span>` : '';

      let iconHtml = '🌐';
      if (item.favicon) {
        iconHtml = `<img src="${escapeHtml(item.favicon)}" onerror="this.parentElement.textContent='🌐'"/>`;
      }

      row.innerHTML = `
        <input type="checkbox" class="history-checkbox" data-id="${escapeHtml(item.id)}">
        <div class="history-favicon">${iconHtml}</div>
        <div class="history-main">
          <span class="history-title" title="${escapeHtml(item.title || item.url)}">${escapeHtml(item.title || item.url)}</span>
          <span class="history-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span>
        </div>
        <div class="history-meta">
          ${countBadge}
          <span>${timeStr}</span>
        </div>
        <button class="delete-item-btn" title="Delete from history" data-id="${escapeHtml(item.id)}">✕</button>
      `;

      // Click row title to navigate
      row.querySelector('.history-main').addEventListener('click', () => {
        if (api && api.navigateCurrentTab) {
          api.navigateCurrentTab(item.url);
        }
      });

      // Single item delete
      row.querySelector('.delete-item-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (api && api.deleteHistoryItem) {
          await api.deleteHistoryItem(item.id);
          loadHistory(historySearchInput.value);
        }
      });

      // Checkbox toggle
      const cb = row.querySelector('.history-checkbox');
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selectedIds.add(item.id);
        } else {
          selectedIds.delete(item.id);
        }
        updateSelectionBar();
      });

      historyContainer.appendChild(row);
    });
  }
}

function updateSelectionBar() {
  if (selectedIds.size > 0) {
    selectionBar.classList.remove('hidden');
    selectionCount.textContent = `${selectedIds.size} item${selectedIds.size === 1 ? '' : 's'} selected`;
  } else {
    selectionBar.classList.add('hidden');
  }
}

// ─── Data Loading ───────────────────────────────────────────────────────────
async function loadHistory(query = '') {
  if (api && api.getHistory) {
    try {
      historyItems = await api.getHistory(query);
    } catch (_) {
      historyItems = [];
    }
  }
  renderHistory();
}

// ─── Event Handlers ─────────────────────────────────────────────────────────
historySearchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    loadHistory(historySearchInput.value);
  }, 200);
});

// Selection actions
btnSelectAll.addEventListener('click', () => {
  document.querySelectorAll('.history-checkbox').forEach(cb => {
    cb.checked = true;
    selectedIds.add(cb.dataset.id);
  });
  updateSelectionBar();
});

btnCancelSelection.addEventListener('click', () => {
  document.querySelectorAll('.history-checkbox').forEach(cb => {
    cb.checked = false;
  });
  selectedIds.clear();
  updateSelectionBar();
});

btnDeleteSelected.addEventListener('click', async () => {
  if (selectedIds.size === 0) return;
  if (confirm(`Delete ${selectedIds.size} selected item(s) from your browsing history?`)) {
    if (api && api.deleteHistoryItems) {
      await api.deleteHistoryItems([...selectedIds]);
    }
    loadHistory(historySearchInput.value);
  }
});

// Time-range clear modal
btnOpenClearModal.addEventListener('click', () => {
  clearRangeModal.classList.remove('hidden');
});

btnCloseModal.addEventListener('click', () => {
  clearRangeModal.classList.add('hidden');
});

clearRangeModal.addEventListener('click', (e) => {
  if (e.target === clearRangeModal) {
    clearRangeModal.classList.add('hidden');
  }
});

btnConfirmRangeClear.addEventListener('click', async () => {
  const range = rangeSelect.value;
  clearRangeModal.classList.add('hidden');
  if (api && api.clearHistoryByRange) {
    await api.clearHistoryByRange(range);
  }
  loadHistory();
});

btnBack.addEventListener('click', () => {
  if (api && api.navigateCurrentTab) {
    api.navigateCurrentTab('mtc://newtab');
  }
});

// Initial load
loadHistory();
