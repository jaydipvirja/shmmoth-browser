// SHMMOTH BROWSER — Bookmarks Manager Controller (mtc://bookmarks)
// Stage 2: Folder organization, bookmark editing, moving, and instant search

'use strict';

const api = window.shmmothAPI || window.mtcAPI;

let allBookmarks = [];
let allFolders = ['Bookmarks Bar', 'Other Bookmarks'];
let activeFolder = 'All Bookmarks';
let searchDebounce = null;

// DOM Elements
const folderList             = document.getElementById('folder-list');
const bookmarksContainer     = document.getElementById('bookmarks-container');
const currentFolderTitle     = document.getElementById('current-folder-title');
const bmSearchInput          = document.getElementById('bm-search-input');
const btnAddBookmark         = document.getElementById('btn-add-bookmark');
const btnNewFolder           = document.getElementById('btn-new-folder');
const btnBack                = document.getElementById('btn-back');

// Bookmark Modal
const bookmarkModal          = document.getElementById('bookmark-modal');
const bmModalTitle           = document.getElementById('bm-modal-title');
const bmModalId              = document.getElementById('bm-modal-id');
const bmModalName            = document.getElementById('bm-modal-name');
const bmModalUrl             = document.getElementById('bm-modal-url');
const bmModalFolder          = document.getElementById('bm-modal-folder');
const btnCancelBmModal       = document.getElementById('btn-cancel-bm-modal');
const btnSaveBmModal         = document.getElementById('btn-save-bm-modal');

// Folder Modal
const folderModal            = document.getElementById('folder-modal');
const folderModalName        = document.getElementById('folder-modal-name');
const btnCancelFolderModal   = document.getElementById('btn-cancel-folder-modal');
const btnSaveFolderModal     = document.getElementById('btn-save-folder-modal');

// ─── Helpers ────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Load Data ──────────────────────────────────────────────────────────────
async function loadData() {
  if (api && api.getBookmarkFolders) {
    try {
      allFolders = await api.getBookmarkFolders();
    } catch (_) {
      allFolders = ['Bookmarks Bar', 'Other Bookmarks'];
    }
  }

  if (api && api.getBookmarks) {
    try {
      allBookmarks = await api.getBookmarks();
    } catch (_) {
      allBookmarks = [];
    }
  }

  renderFolders();
  renderBookmarks();
}

// ─── Render Folders in Sidebar ──────────────────────────────────────────────
function renderFolders() {
  folderList.innerHTML = '';

  const folderEntries = ['All Bookmarks', ...allFolders];

  folderEntries.forEach(folderName => {
    const item = document.createElement('div');
    item.className = `folder-item ${activeFolder === folderName ? 'active' : ''}`;

    let count = 0;
    if (folderName === 'All Bookmarks') {
      count = allBookmarks.length;
    } else {
      count = allBookmarks.filter(b => (b.folder || 'Bookmarks Bar') === folderName).length;
    }

    let deleteBtnHtml = '';
    // Protected folders cannot be deleted
    if (folderName !== 'All Bookmarks' && folderName !== 'Bookmarks Bar' && folderName !== 'Other Bookmarks') {
      deleteBtnHtml = `<button class="delete-folder-btn" title="Delete Folder">✕</button>`;
    }

    const folderIcon = folderName === 'Bookmarks Bar' ? '⭐' : (folderName === 'All Bookmarks' ? '📁' : '📑');

    item.innerHTML = `
      <span style="display:flex; align-items:center; gap:6px;">
        <span>${folderIcon}</span>
        <span>${escapeHtml(folderName)}</span>
      </span>
      <span style="display:flex; align-items:center;">
        <span class="folder-count">${count}</span>
        ${deleteBtnHtml}
      </span>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-folder-btn')) return;
      activeFolder = folderName;
      currentFolderTitle.textContent = folderName;
      renderFolders();
      renderBookmarks();
    });

    const delBtn = item.querySelector('.delete-folder-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete folder "${folderName}"? Bookmarks inside will be moved to "Other Bookmarks".`)) {
          if (api && api.removeBookmarkFolder) {
            allFolders = await api.removeBookmarkFolder(folderName);
            if (activeFolder === folderName) activeFolder = 'All Bookmarks';
            await loadData();
          }
        }
      });
    }

    folderList.appendChild(item);
  });
}

// ─── Render Bookmarks Grid ──────────────────────────────────────────────────
function renderBookmarks() {
  bookmarksContainer.innerHTML = '';
  const query = (bmSearchInput.value || '').trim().toLowerCase();

  let filtered = allBookmarks;

  // Filter by folder if not 'All Bookmarks'
  if (activeFolder !== 'All Bookmarks') {
    filtered = filtered.filter(b => (b.folder || 'Bookmarks Bar') === activeFolder);
  }

  // Filter by search query
  if (query) {
    filtered = filtered.filter(b =>
      (b.title && b.title.toLowerCase().includes(query)) ||
      (b.url && b.url.toLowerCase().includes(query)) ||
      (b.folder && b.folder.toLowerCase().includes(query))
    );
  }

  if (!filtered || filtered.length === 0) {
    bookmarksContainer.innerHTML = '<p style="color:#64748b; padding:36px 0; grid-column: 1 / -1; text-align:center;">No bookmarks found.</p>';
    return;
  }

  filtered.forEach(bm => {
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.dataset.id = bm.id;

    let iconHtml = '⭐';
    if (bm.favicon) {
      iconHtml = `<img src="${escapeHtml(bm.favicon)}" onerror="this.parentElement.textContent='⭐'"/>`;
    }

    const folderTag = escapeHtml(bm.folder || 'Bookmarks Bar');

    card.innerHTML = `
      <div class="bm-header">
        <div class="bm-icon">${iconHtml}</div>
        <span class="bm-title" title="${escapeHtml(bm.title || bm.url)}">${escapeHtml(bm.title || bm.url)}</span>
      </div>
      <div class="bm-url" title="${escapeHtml(bm.url)}">${escapeHtml(bm.url)}</div>
      <div class="bm-footer">
        <span class="bm-folder-badge">📁 ${folderTag}</span>
        <div class="bm-actions">
          <button class="bm-action-btn edit" title="Edit Bookmark">✏️</button>
          <button class="bm-action-btn delete" title="Delete Bookmark">🗑️</button>
        </div>
      </div>
    `;

    // Click card to open in current tab
    card.addEventListener('click', (e) => {
      if (e.target.closest('.bm-actions')) return;
      if (api && api.navigateCurrentTab) {
        api.navigateCurrentTab(bm.url);
      }
    });

    // Edit button
    card.querySelector('.bm-action-btn.edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(bm);
    });

    // Delete button
    card.querySelector('.bm-action-btn.delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Remove bookmark "${bm.title || bm.url}"?`)) {
        if (api && api.removeBookmark) {
          allBookmarks = await api.removeBookmark(bm.id || bm.url);
          renderFolders();
          renderBookmarks();
        }
      }
    });

    bookmarksContainer.appendChild(card);
  });
}

// ─── Modal Handlers ─────────────────────────────────────────────────────────
function populateFolderDropdown(selectedFolder = '') {
  bmModalFolder.innerHTML = '';
  allFolders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    if (f === selectedFolder) opt.selected = true;
    bmModalFolder.appendChild(opt);
  });
}

function openAddModal() {
  bmModalTitle.textContent = 'Add Bookmark';
  bmModalId.value = '';
  bmModalName.value = '';
  bmModalUrl.value = 'https://';
  populateFolderDropdown(activeFolder !== 'All Bookmarks' ? activeFolder : 'Bookmarks Bar');
  bookmarkModal.classList.remove('hidden');
  bmModalName.focus();
}

function openEditModal(bm) {
  bmModalTitle.textContent = 'Edit Bookmark';
  bmModalId.value = bm.id;
  bmModalName.value = bm.title || '';
  bmModalUrl.value = bm.url || '';
  populateFolderDropdown(bm.folder || 'Bookmarks Bar');
  bookmarkModal.classList.remove('hidden');
  bmModalName.focus();
}

function closeBookmarkModal() {
  bookmarkModal.classList.add('hidden');
}

btnCancelBmModal.addEventListener('click', closeBookmarkModal);
bookmarkModal.addEventListener('click', (e) => {
  if (e.target === bookmarkModal) closeBookmarkModal();
});

btnSaveBmModal.addEventListener('click', async () => {
  const title = bmModalName.value.trim();
  const url   = bmModalUrl.value.trim();
  const folder = bmModalFolder.value;
  const id    = bmModalId.value;

  if (!url) {
    alert('Please enter a valid URL.');
    return;
  }

  closeBookmarkModal();

  if (id) {
    // Edit existing bookmark
    if (api && api.editBookmark) {
      await api.editBookmark(id, { title: title || url, url, folder });
    }
  } else {
    // Add new bookmark
    if (api && api.addBookmark) {
      await api.addBookmark({ title: title || url, url, folder });
    }
  }

  await loadData();
});

btnAddBookmark.addEventListener('click', openAddModal);

// ─── New Folder Modal ───────────────────────────────────────────────────────
function openFolderModal() {
  folderModalName.value = '';
  folderModal.classList.remove('hidden');
  folderModalName.focus();
}

function closeFolderModal() {
  folderModal.classList.add('hidden');
}

btnNewFolder.addEventListener('click', openFolderModal);
btnCancelFolderModal.addEventListener('click', closeFolderModal);
folderModal.addEventListener('click', (e) => {
  if (e.target === folderModal) closeFolderModal();
});

btnSaveFolderModal.addEventListener('click', async () => {
  const name = folderModalName.value.trim();
  if (!name) return;

  closeFolderModal();
  if (api && api.addBookmarkFolder) {
    allFolders = await api.addBookmarkFolder(name);
    renderFolders();
  }
});

// ─── Search Input ───────────────────────────────────────────────────────────
bmSearchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    renderBookmarks();
  }, 150);
});

// ─── Return to Browsing ────────────────────────────────────────────────────
btnBack.addEventListener('click', () => {
  if (api && api.navigateCurrentTab) {
    api.navigateCurrentTab('mtc://newtab');
  }
});

// Initial load
loadData();
