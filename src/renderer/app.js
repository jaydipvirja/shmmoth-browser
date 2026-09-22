// SHMMOTH BROWSER - Main Chrome Renderer Controller
// Stage 1: Tab System, Navigation, Omnibox

let activeTabId = null;
let currentTabs = [];
let bookmarks = [];
let settings = {};
let contextMenuTabId = null;
let draggedTabId = null;

// DOM Elements
const tabsStrip          = document.getElementById('tabs-strip');
const btnNewTab          = document.getElementById('btn-new-tab');
const btnBack            = document.getElementById('btn-back');
const btnForward         = document.getElementById('btn-forward');
const btnReload          = document.getElementById('btn-reload');
const iconReload         = document.getElementById('icon-reload');
const iconStop           = document.getElementById('icon-stop');
const btnHome            = document.getElementById('btn-home');
const omniboxInput       = document.getElementById('omnibox-input');
const omniboxSecurity    = document.getElementById('omnibox-security');
const btnStarBookmark    = document.getElementById('btn-star-bookmark');
const btnAdblockerStatus = document.getElementById('btn-adblocker-status');
const adCounter          = document.getElementById('ad-counter');
const btnDownloads       = document.getElementById('btn-downloads');
const btnToggleNotes     = document.getElementById('btn-toggle-notes');
const btnDevtools        = document.getElementById('btn-devtools');
const btnCheckUpdateToolbar = document.getElementById('btn-check-update-toolbar');
const updateToolbarBadge    = document.getElementById('update-toolbar-badge');
const btnSettings        = document.getElementById('btn-settings');
const bookmarksBar       = document.getElementById('bookmarks-bar');

let currentUpdateStatus  = null;

// Window Controls
const btnWinMin   = document.getElementById('btn-win-min');
const btnWinMax   = document.getElementById('btn-win-max');
const btnWinClose = document.getElementById('btn-win-close');

// Notes Drawer
const notesDrawer   = document.getElementById('notes-drawer');
const btnCloseNotes = document.getElementById('btn-close-notes');
const notesTextarea = document.getElementById('notes-textarea');
const notesStatus   = document.getElementById('notes-status');

// Context Menus
const tabContextMenu      = document.getElementById('tab-context-menu');
const tabstripContextMenu = document.getElementById('tabstrip-context-menu');
const ctxPinLabel         = document.getElementById('ctx-pin-label');
const ctxMuteLabel        = document.getElementById('ctx-mute-label');

// Stage 3: Zoom & Find in Page Elements
const omniboxZoomBadge = document.getElementById('omnibox-zoom-badge');
const findBar          = document.getElementById('find-bar');
const findInput        = document.getElementById('find-input');
const findMatchCount   = document.getElementById('find-match-count');
const btnFindPrev      = document.getElementById('btn-find-prev');
const btnFindNext      = document.getElementById('btn-find-next');
const btnFindClose     = document.getElementById('btn-find-close');

// Stage 4: Incognito Elements
const incognitoBadge = document.getElementById('incognito-badge');
const btnIncognito   = document.getElementById('btn-incognito');

// Stage 5: Site Info & Permissions Elements
const siteInfoPopup        = document.getElementById('site-info-popup');
const siteSecurityBadge    = document.getElementById('site-security-badge');
const siteSecurityIcon     = document.getElementById('site-security-icon');
const siteSecurityTitle    = document.getElementById('site-security-title');
const siteSecurityHost     = document.getElementById('site-security-host');
const permSelectCamera     = document.getElementById('perm-select-camera');
const permSelectMic        = document.getElementById('perm-select-mic');
const permSelectGeo        = document.getElementById('perm-select-geo');
const permSelectNotif      = document.getElementById('perm-select-notif');
const btnResetSitePerms    = document.getElementById('btn-reset-site-perms');

const permissionPromptCard = document.getElementById('permission-prompt-card');
const permPromptIcon       = document.getElementById('perm-prompt-icon');
const permPromptOrigin     = document.getElementById('perm-prompt-origin');
const permPromptDesc       = document.getElementById('perm-prompt-desc');
const btnPermClose         = document.getElementById('btn-perm-close');
const cbPermRemember       = document.getElementById('cb-perm-remember');
const btnPermBlock         = document.getElementById('btn-perm-block');
const btnPermAllow         = document.getElementById('btn-perm-allow');
let activePermissionReqId   = null;

// Stage 6: Password Save Prompt Elements
const passwordSaveCard     = document.getElementById('password-save-card');
const passwordPromptOrigin = document.getElementById('password-prompt-origin');
const passwordPromptUser   = document.getElementById('password-prompt-user');
const btnPasswordClose     = document.getElementById('btn-password-close');
const btnPasswordNever     = document.getElementById('btn-password-never');
const btnPasswordNotnow    = document.getElementById('btn-password-notnow');
const btnPasswordSave      = document.getElementById('btn-password-save');
let activePasswordPromptId = null;

// Stage 7: Extensions Elements
const extensionActionIcons  = document.getElementById('extension-action-icons');
const btnExtensions         = document.getElementById('btn-extensions');
const extensionMenuDropdown  = document.getElementById('extension-menu-dropdown');
const extMenuList           = document.getElementById('ext-menu-list');
const btnManageExtensions   = document.getElementById('btn-manage-extensions');
let installedExtensions     = [];

// Stage 3 / Core: Downloads Elements & State
const downloadBadge        = document.getElementById('download-badge');
const downloadTray         = document.getElementById('download-tray');
const downloadTrayList     = document.getElementById('download-tray-list');
const btnTrayOpenFolder    = document.getElementById('btn-tray-open-folder');
const btnTrayClose         = document.getElementById('btn-tray-close');
const btnTrayAllDownloads  = document.getElementById('btn-tray-all-downloads');
const btnTrayClear         = document.getElementById('btn-tray-clear');
const downloadToast        = document.getElementById('download-toast');
const downloadToastTitle   = document.getElementById('download-toast-title');
const downloadToastFilename= document.getElementById('download-toast-filename');
const btnToastOpen         = document.getElementById('btn-toast-open');
const btnToastFolder       = document.getElementById('btn-toast-folder');
const btnToastClose        = document.getElementById('btn-toast-close');

// Live toolbar download status chip
const toolbarDownloadStatus   = document.getElementById('toolbar-download-status');
const toolbarDownloadFilename = document.getElementById('toolbar-download-filename');
const toolbarDownloadBar      = document.getElementById('toolbar-download-bar');
const toolbarDownloadMeta     = document.getElementById('toolbar-download-meta');

let downloadsMap           = new Map();
let toastTimer             = null;
let trayAutoCloseTimer     = null;
let toolbarChipTimer       = null;
let currentToastId         = null;

const api = window.shmmothAPI || window.mtcAPI;

// ─── Initialize ─────────────────────────────────────────────────────────────
async function init() {
  const isIncognito = window.location.search.includes('incognito=true') ||
    (api && api.isIncognitoWindow && await api.isIncognitoWindow().catch(() => false));

  if (isIncognito) {
    document.body.classList.add('theme-incognito');
    if (incognitoBadge) incognitoBadge.classList.remove('hidden');
    document.title = 'SHMMOTH Browser (Incognito)';
  }

  setupEventListeners();
  setupKeyboardShortcuts();
  setupContextMenuHandlers();
  await loadSettings();
  await loadBookmarks();
  await loadNotes();
  await loadExtensions();
  await loadDownloads();
  setupDownloadListeners();
  setupUpdateToolbarListeners();

  if (api && api.onThemeChanged) {
    api.onThemeChanged((theme) => {
      applyTheme(theme);
    });
  }

  if (api && api.onSettingsUpdated) {
    api.onSettingsUpdated((newSettings) => {
      settings = Object.assign({}, settings, newSettings);
      applySettings();
    });
  }

  // Fallback: ensure at least one tab exists if main process hasn't created one
  setTimeout(() => {
    if (currentTabs.length === 0 && api && api.createTab) {
      api.createTab('mtc://newtab');
    }
  }, 300);
}

// ─── Settings & Theme ───────────────────────────────────────────────────────
function applyTheme(themeName) {
  if (document.body.classList.contains('theme-incognito')) return;
  document.body.classList.remove('theme-dark', 'theme-light');
  if (themeName === 'light') {
    document.body.classList.add('theme-light');
  } else if (themeName === 'system') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
  } else {
    document.body.classList.add('theme-dark');
  }
}

async function loadSettings() {
  if (api && api.getSettings) {
    try {
      settings = await api.getSettings();
      applySettings();
    } catch (_) {}
  }
}

function applySettings() {
  if (settings.showBookmarksBar === false) {
    bookmarksBar.classList.add('hidden');
  } else {
    bookmarksBar.classList.remove('hidden');
  }
  if (settings.theme) {
    applyTheme(settings.theme);
  }
}

// ─── Bookmarks Bar ─────────────────────────────────────────────────────────
async function loadBookmarks() {
  if (api && api.getBookmarks) {
    try {
      bookmarks = await api.getBookmarks();
      renderBookmarksBar();
    } catch (_) {}
  }
}

let activeFolderDropdown = null;

function renderBookmarksBar() {
  bookmarksBar.innerHTML = '';

  // 1. Direct bookmarks in 'Bookmarks Bar' (or default)
  const barBookmarks = bookmarks.filter(b => !b.folder || b.folder === 'Bookmarks Bar');
  barBookmarks.forEach(bm => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    let iconHtml = '⭐';
    if (bm.favicon) {
      iconHtml = `<img src="${escapeHtml(bm.favicon)}" class="bookmark-favicon" onerror="this.parentElement.textContent='⭐'"/>`;
    }
    item.innerHTML = `
      <span class="bookmark-icon">${iconHtml}</span>
      <span class="bookmark-label">${escapeHtml(bm.title || bm.url)}</span>
    `;
    item.addEventListener('click', () => {
      navigate(bm.url);
    });
    bookmarksBar.appendChild(item);
  });

  // 2. Folders with bookmarks (excluding 'Bookmarks Bar')
  const otherFolders = [...new Set(bookmarks.map(b => b.folder).filter(f => f && f !== 'Bookmarks Bar'))];
  otherFolders.forEach(folderName => {
    const folderItems = bookmarks.filter(b => b.folder === folderName);
    if (folderItems.length === 0) return;

    const folderChip = document.createElement('div');
    folderChip.className = 'bookmark-item bookmark-folder-chip';
    folderChip.innerHTML = `
      <span class="bookmark-icon">📁</span>
      <span class="bookmark-label">${escapeHtml(folderName)}</span>
      <span style="font-size: 9px; margin-left: 2px;">▼</span>
    `;

    folderChip.addEventListener('click', (e) => {
      e.stopPropagation();
      showBookmarkFolderDropdown(folderChip, folderItems);
    });

    bookmarksBar.appendChild(folderChip);
  });
}

function showBookmarkFolderDropdown(anchorEl, items) {
  if (activeFolderDropdown) {
    activeFolderDropdown.remove();
    activeFolderDropdown = null;
  }

  const dropdown = document.createElement('div');
  dropdown.className = 'custom-context-menu';
  const rect = anchorEl.getBoundingClientRect();
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.top  = `${rect.bottom + 4}px`;

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'menu-item';
    row.innerHTML = `
      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px;">
        ⭐ ${escapeHtml(item.title || item.url)}
      </span>
    `;
    row.addEventListener('click', () => {
      navigate(item.url);
      dropdown.remove();
      activeFolderDropdown = null;
    });
    dropdown.appendChild(row);
  });

  document.body.appendChild(dropdown);
  activeFolderDropdown = dropdown;

  const closeHandler = (e) => {
    if (!dropdown.contains(e.target) && e.target !== anchorEl) {
      dropdown.remove();
      activeFolderDropdown = null;
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

// ─── Tab Rendering (Stage 1 Core) ──────────────────────────────────────────
function renderTabs(tabs, activeId) {
  currentTabs = tabs || [];
  activeTabId = activeId;
  tabsStrip.innerHTML = '';

  currentTabs.forEach((tab, index) => {
    const tabEl = document.createElement('div');
    tabEl.className = `browser-tab ${tab.id === activeTabId ? 'active' : ''} ${tab.isPinned ? 'pinned' : ''}`;
    tabEl.title = tab.title || 'New Tab';
    tabEl.dataset.tabId = tab.id;
    tabEl.dataset.index = index;
    tabEl.draggable = true;

    // Loading indicator vs Favicon
    let iconHtml = '';
    if (tab.isLoading) {
      iconHtml = `<div class="tab-spinner" title="Loading..."></div>`;
    } else {
      let icon = '🌐';
      if (tab.url && tab.url.startsWith('mtc://settings'))  icon = '⚙️';
      else if (tab.url && tab.url.startsWith('mtc://newtab')) icon = '🚀';
      else if (tab.url && tab.url.startsWith('mtc://history')) icon = '🕒';
      else if (tab.url && tab.url.startsWith('mtc://bookmarks')) icon = '★';
      else if (tab.url && tab.url.startsWith('mtc://downloads')) icon = '⬇️';
      else if (tab.url && tab.url.startsWith('mtc://extensions')) icon = '🧩';
      else if (tab.favicon) icon = `<img src="${escapeHtml(tab.favicon)}" onerror="this.parentElement.textContent='🌐'"/>`;

      iconHtml = `<div class="tab-favicon">${icon}</div>`;
    }

    // Audio / Mute badge
    let audioHtml = '';
    if (tab.isAudible) {
      const audioIcon = tab.isMuted ? '🔇' : '🔊';
      const audioTitle = tab.isMuted ? 'Unmute tab' : 'Mute tab';
      audioHtml = `<button class="tab-audio-btn" title="${audioTitle}">${audioIcon}</button>`;
    }

    // Sleep badge (RAM saver)
    let badgeHtml = '';
    if (tab.isSleeping) {
      badgeHtml = '<span class="tab-badge" title="Sleeping (RAM Saver)">💤</span>';
    }

    tabEl.innerHTML = `
      ${iconHtml}
      <div class="tab-title">${escapeHtml(tab.title || 'New Tab')}</div>
      ${audioHtml}
      ${badgeHtml}
      <button class="tab-close-btn" title="Close Tab (Ctrl+W)">✕</button>
    `;

    // Audio button click (mute / unmute toggle)
    const audioBtn = tabEl.querySelector('.tab-audio-btn');
    if (audioBtn) {
      audioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (api && api.toggleMuteTab) {
          api.toggleMuteTab(tab.id);
        }
      });
    }

    // Left click to switch tab
    tabEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close-btn') || e.target.classList.contains('tab-audio-btn')) return;
      if (api && api.switchTab) {
        api.switchTab(tab.id);
      }
    });

    // Middle click to close tab
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        if (api && api.closeTab) {
          api.closeTab(tab.id);
        }
      }
    });

    // Close button
    const closeBtn = tabEl.querySelector('.tab-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (api && api.closeTab) {
          api.closeTab(tab.id);
        }
      });
    }

    // ── Drag and Drop Tab Reordering ──
    tabEl.addEventListener('dragstart', (e) => {
      draggedTabId = tab.id;
      tabEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.id);
    });

    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('dragging');
      document.querySelectorAll('.browser-tab').forEach(el => {
        el.classList.remove('drag-over-left', 'drag-over-right');
      });
      draggedTabId = null;
    });

    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedTabId || draggedTabId === tab.id) return;
      const rect = tabEl.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      tabEl.classList.toggle('drag-over-left', e.clientX < midpoint);
      tabEl.classList.toggle('drag-over-right', e.clientX >= midpoint);
    });

    tabEl.addEventListener('dragleave', () => {
      tabEl.classList.remove('drag-over-left', 'drag-over-right');
    });

    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
      tabEl.classList.remove('drag-over-left', 'drag-over-right');
      if (!draggedTabId || draggedTabId === tab.id) return;

      const rect = tabEl.getBoundingClientRect();
      const insertBefore = e.clientX < (rect.left + rect.width / 2);
      let targetIndex = Number(tabEl.dataset.index);
      if (!insertBefore) targetIndex += 1;

      if (api && api.reorderTabs) {
        api.reorderTabs(draggedTabId, targetIndex);
      }
    });

    // Right-click context menu on tab
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideContextMenus();
      contextMenuTabId = tab.id;

      // Update dynamic labels
      if (ctxPinLabel) {
        ctxPinLabel.textContent = tab.isPinned ? 'Unpin Tab' : 'Pin Tab';
      }
      if (ctxMuteLabel) {
        ctxMuteLabel.textContent = tab.isMuted ? 'Unmute Tab' : 'Mute Tab';
      }

      showContextMenu(tabContextMenu, e.clientX, e.clientY);
    });

    tabsStrip.appendChild(tabEl);
  });

  // Update Omnibox & Toolbar state for active tab
  const activeTab = currentTabs.find(t => t.id === activeTabId);
  if (activeTab) {
    updateOmnibox(activeTab.url);
    updateBookmarkStarState(activeTab.url);
    updateReloadStopButton(activeTab.isLoading);
    if (api && api.getZoomFactor) {
      api.getZoomFactor(activeTab.id).then(factor => {
        if (activeTabId === activeTab.id) updateZoomBadge(factor);
      }).catch(() => {});
    }
  }
}

// ─── Context Menus ──────────────────────────────────────────────────────────
function showContextMenu(menu, x, y) {
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top  = `${Math.min(y, maxY)}px`;
}

function hideContextMenus() {
  tabContextMenu.classList.add('hidden');
  tabstripContextMenu.classList.add('hidden');
}

function setupContextMenuHandlers() {
  // Right click on empty tab strip area
  tabsStrip.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.browser-tab')) return;
    e.preventDefault();
    hideContextMenus();
    showContextMenu(tabstripContextMenu, e.clientX, e.clientY);
  });

  // Close menus on click outside or on ESC
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-context-menu')) {
      hideContextMenus();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenus();
    }
  });

  // Tab context menu actions
  tabContextMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const action = item.dataset.action;
    hideContextMenus();

    const targetTabId = contextMenuTabId || activeTabId;
    const tab = currentTabs.find(t => t.id === targetTabId);

    switch (action) {
      case 'new-tab':
        if (api && api.createTab) api.createTab('mtc://newtab');
        break;
      case 'reload-tab':
        if (api && api.reloadTab && targetTabId) api.reloadTab(targetTabId);
        break;
      case 'duplicate-tab':
        if (api && api.duplicateTab && targetTabId) api.duplicateTab(targetTabId);
        break;
      case 'pin-tab':
        if (api && api.togglePinTab && targetTabId) api.togglePinTab(targetTabId);
        break;
      case 'mute-tab':
        if (api && api.toggleMuteTab && targetTabId) api.toggleMuteTab(targetTabId);
        break;
      case 'close-tab':
        if (api && api.closeTab && targetTabId) api.closeTab(targetTabId);
        break;
      case 'close-other-tabs':
        if (api && api.closeOtherTabs && targetTabId) api.closeOtherTabs(targetTabId);
        break;
      case 'close-tabs-right':
        if (api && api.closeTabsToRight && targetTabId) api.closeTabsToRight(targetTabId);
        break;
      case 'reopen-closed-tab':
        if (api && api.reopenClosedTab) api.reopenClosedTab();
        break;
    }
  });

  // Tabstrip context menu actions
  tabstripContextMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const action = item.dataset.action;
    hideContextMenus();

    if (action === 'new-tab' && api && api.createTab) {
      api.createTab('mtc://newtab');
    } else if (action === 'reopen-closed-tab' && api && api.reopenClosedTab) {
      api.reopenClosedTab();
    }
  });
}

// ─── Navigation & Omnibox ──────────────────────────────────────────────────
function navigate(query) {
  const target = (query || '').trim();
  if (!target) return;

  if (api && api.navigateTab) {
    api.navigateTab(activeTabId, target);
  }
}

function updateOmnibox(url) {
  if (!url || url === 'mtc://newtab') {
    omniboxInput.value = '';
    omniboxSecurity.textContent = '🚀';
    omniboxSecurity.title = 'SHMMOTH Start Dashboard';
  } else if (url.startsWith('mtc://')) {
    omniboxInput.value = url;
    omniboxSecurity.textContent = '🛡️';
    omniboxSecurity.title = 'SHMMOTH Internal Page';
  } else {
    omniboxInput.value = url;
    if (url.startsWith('https://')) {
      omniboxSecurity.textContent = '🔒';
      omniboxSecurity.title = 'Secure Connection (HTTPS)';
    } else {
      omniboxSecurity.textContent = '⚠️';
      omniboxSecurity.title = 'Not Secure';
    }
  }
}

function updateReloadStopButton(isLoading) {
  if (isLoading) {
    iconReload.classList.add('hidden');
    iconStop.classList.remove('hidden');
    btnReload.title = 'Stop loading (Esc)';
  } else {
    iconReload.classList.remove('hidden');
    iconStop.classList.add('hidden');
    btnReload.title = 'Reload (Ctrl+R)';
  }
}

function updateBookmarkStarState(url) {
  const isBookmarked = bookmarks.some(b => b.url === url);
  if (isBookmarked) {
    btnStarBookmark.classList.add('active');
    btnStarBookmark.title = 'Remove Bookmark';
  } else {
    btnStarBookmark.classList.remove('active');
    btnStarBookmark.title = 'Bookmark this tab (Ctrl+D)';
  }
}

// ─── Zoom & Find in Page (Stage 3) ──────────────────────────────────────────
function updateZoomBadge(zoomFactor) {
  if (!omniboxZoomBadge) return;
  const factor = Number(zoomFactor) || 1.0;
  const pct = Math.round(factor * 100);
  if (pct === 100) {
    omniboxZoomBadge.classList.add('hidden');
  } else {
    omniboxZoomBadge.textContent = `${pct}%`;
    omniboxZoomBadge.classList.remove('hidden');
  }
}

function openFindBar() {
  if (!findBar) return;
  findBar.classList.remove('hidden');
  findInput.focus();
  findInput.select();
  const val = findInput.value.trim();
  if (val && api && api.findInPage && activeTabId) {
    api.findInPage(activeTabId, val, { forward: true, findNext: false });
  }
}

function closeFindBar() {
  if (!findBar) return;
  findBar.classList.add('hidden');
  findMatchCount.textContent = '0 of 0';
  if (api && api.stopFindInPage && activeTabId) {
    api.stopFindInPage(activeTabId, 'clearSelection');
  }
}

function updateFindResult(res) {
  if (!findMatchCount) return;
  if (!res || res.matches === 0) {
    findMatchCount.textContent = findInput.value.trim() ? '0 of 0' : '';
  } else {
    findMatchCount.textContent = `${res.activeMatchOrdinal} of ${res.matches}`;
  }
}

// ─── Site Info & Permissions (Stage 5) ──────────────────────────────────────
async function toggleSiteInfoPopup() {
  if (!siteInfoPopup) return;
  if (!siteInfoPopup.classList.contains('hidden')) {
    siteInfoPopup.classList.add('hidden');
    return;
  }

  const activeTab = currentTabs.find(t => t.id === activeTabId);
  const currentUrl = (activeTab && activeTab.url) ? activeTab.url : 'mtc://newtab';

  let host = 'Internal Page';
  let isHttps = false;
  let isInternal = false;
  try {
    const parsed = new URL(currentUrl);
    if (parsed.protocol === 'https:') {
      isHttps = true;
      host = parsed.host;
    } else if (parsed.protocol === 'http:') {
      host = parsed.host;
    } else if (parsed.protocol === 'mtc:' || parsed.protocol === 'file:') {
      isInternal = true;
      host = parsed.protocol + '//' + (parsed.host || parsed.pathname || '');
    }
  } catch (_) {
    host = currentUrl;
  }

  if (siteSecurityHost) siteSecurityHost.textContent = host;

  if (siteSecurityBadge && siteSecurityIcon && siteSecurityTitle) {
    if (isHttps) {
      siteSecurityIcon.textContent = '🔒';
      siteSecurityTitle.textContent = 'Connection is secure';
      siteSecurityBadge.style.color = '#10b981';
    } else if (isInternal) {
      siteSecurityIcon.textContent = '🛡️';
      siteSecurityTitle.textContent = 'SHMMOTH Internal Page';
      siteSecurityBadge.style.color = '#3b82f6';
    } else {
      siteSecurityIcon.textContent = '⚠️';
      siteSecurityTitle.textContent = 'Connection is not secure';
      siteSecurityBadge.style.color = '#f59e0b';
    }
  }

  // Load origin permissions
  let origin = '';
  try {
    origin = new URL(currentUrl).origin;
  } catch (_) {
    origin = currentUrl;
  }

  if (api && api.getSitePermissions && origin && !isInternal) {
    try {
      const perms = await api.getSitePermissions(origin);
      if (permSelectCamera) permSelectCamera.value = perms.media || 'ask';
      if (permSelectMic)    permSelectMic.value    = perms.media || 'ask';
      if (permSelectGeo)    permSelectGeo.value    = perms.geolocation || 'ask';
      if (permSelectNotif)  permSelectNotif.value  = perms.notifications || 'ask';
    } catch (_) {}
  } else {
    if (permSelectCamera) permSelectCamera.value = isInternal ? 'allow' : 'ask';
    if (permSelectMic)    permSelectMic.value    = isInternal ? 'allow' : 'ask';
    if (permSelectGeo)    permSelectGeo.value    = isInternal ? 'allow' : 'ask';
    if (permSelectNotif)  permSelectNotif.value  = isInternal ? 'allow' : 'ask';
  }

  siteInfoPopup.classList.remove('hidden');
}

function setupPermissionDropdowns() {
  const selects = [permSelectCamera, permSelectMic, permSelectGeo, permSelectNotif].filter(Boolean);
  selects.forEach(select => {
    select.addEventListener('change', async () => {
      const activeTab = currentTabs.find(t => t.id === activeTabId);
      if (!activeTab || !activeTab.url) return;
      try {
        const origin = new URL(activeTab.url).origin;
        const perm = select.getAttribute('data-perm');
        if (api && api.setSitePermission && origin && perm) {
          await api.setSitePermission(origin, perm, select.value);
        }
      } catch (_) {}
    });
  });

  if (btnResetSitePerms) {
    btnResetSitePerms.addEventListener('click', async () => {
      const activeTab = currentTabs.find(t => t.id === activeTabId);
      if (!activeTab || !activeTab.url) return;
      try {
        const origin = new URL(activeTab.url).origin;
        if (api && api.removeSitePermission && origin) {
          await api.removeSitePermission(origin);
          if (permSelectCamera) permSelectCamera.value = 'ask';
          if (permSelectMic)    permSelectMic.value    = 'ask';
          if (permSelectGeo)    permSelectGeo.value    = 'ask';
          if (permSelectNotif)  permSelectNotif.value  = 'ask';
        }
      } catch (_) {}
    });
  }
}

function setupPermissionPromptListeners() {
  // Website permissions are now handled via native floating bubble (permission-bubble.html)
  // to avoid WebContentsView occlusion. In-DOM card is kept hidden.
  if (permissionPromptCard) permissionPromptCard.classList.add('hidden');

  function closePrompt(decision) {
    if (activePermissionReqId && api && api.respondPermissionRequest) {
      const remember = cbPermRemember ? cbPermRemember.checked : false;
      api.respondPermissionRequest(activePermissionReqId, decision, remember);
    }
    activePermissionReqId = null;
    if (permissionPromptCard) permissionPromptCard.classList.add('hidden');
  }

  if (btnPermAllow) btnPermAllow.addEventListener('click', () => closePrompt('allow'));
  if (btnPermBlock) btnPermBlock.addEventListener('click', () => closePrompt('block'));
  if (btnPermClose) btnPermClose.addEventListener('click', () => closePrompt('block'));
}

// ─── Password Save Prompt Listeners (Stage 6) ──────────────────────────────
function setupPasswordPromptListeners() {
  // Password saving is displayed in native floating bubble (password-bubble.html)
  // to prevent WebContentsView occlusion. In-DOM card is kept hidden.
  if (passwordSaveCard) passwordSaveCard.classList.add('hidden');

  function respond(action) {
    if (activePasswordPromptId && api && api.respondPasswordSavePrompt) {
      api.respondPasswordSavePrompt(activePasswordPromptId, action);
    }
    activePasswordPromptId = null;
    if (passwordSaveCard) passwordSaveCard.classList.add('hidden');
  }

  if (btnPasswordSave)   btnPasswordSave.addEventListener('click',   () => respond('save'));
  if (btnPasswordNever)  btnPasswordNever.addEventListener('click',  () => respond('never'));
  if (btnPasswordNotnow) btnPasswordNotnow.addEventListener('click', () => respond('dismiss'));
  if (btnPasswordClose)  btnPasswordClose.addEventListener('click',  () => respond('dismiss'));
}

// ─── Event Listeners ────────────────────────────────────────────────────────
function setupEventListeners() {
  // New Tab Button
  btnNewTab.addEventListener('click', () => {
    if (api && api.createTab) api.createTab('mtc://newtab');
  });

  // Navigation Buttons
  btnBack.addEventListener('click', () => {
    if (api && api.goBack) api.goBack(activeTabId);
  });

  btnForward.addEventListener('click', () => {
    if (api && api.goForward) api.goForward(activeTabId);
  });

  // Reload / Stop Toggle
  btnReload.addEventListener('click', () => {
    const activeTab = currentTabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.isLoading) {
      if (api && api.stopTab) api.stopTab(activeTabId);
    } else {
      if (api && api.reloadTab) api.reloadTab(activeTabId);
    }
  });

  btnHome.addEventListener('click', () => {
    if (api && api.navigateTab) api.navigateTab(activeTabId, 'mtc://newtab');
  });

  // Omnibox Security & Site Info (Stage 5)
  if (omniboxSecurity) {
    omniboxSecurity.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSiteInfoPopup();
    });
  }

  // Omnibox submit
  omniboxInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      navigate(omniboxInput.value);
      omniboxInput.blur();
    } else if (e.key === 'Escape') {
      const activeTab = currentTabs.find(t => t.id === activeTabId);
      if (activeTab) {
        if (activeTab.isLoading && api && api.stopTab) {
          api.stopTab(activeTabId);
        }
        updateOmnibox(activeTab.url);
      }
      omniboxInput.blur();
    }
  });

  omniboxInput.addEventListener('focus', () => {
    omniboxInput.select();
  });

  // Bookmark Star Button
  btnStarBookmark.addEventListener('click', async () => {
    const activeTab = currentTabs.find(t => t.id === activeTabId);
    if (!activeTab || !activeTab.url || activeTab.url.startsWith('mtc://')) return;

    const isBookmarked = bookmarks.some(b => b.url === activeTab.url);
    if (isBookmarked) {
      bookmarks = await api.removeBookmark(activeTab.url);
    } else {
      bookmarks = await api.addBookmark({
        title: activeTab.title,
        url: activeTab.url,
        favicon: activeTab.favicon
      });
    }
    updateBookmarkStarState(activeTab.url);
    renderBookmarksBar();
  });

  // Ad blocker button (Chrome-style Shield Floating Bubble)
  btnAdblockerStatus.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = btnAdblockerStatus.getBoundingClientRect();
    if (api && api.toggleShieldBubble) {
      api.toggleShieldBubble({
        x: Math.round(rect.x),
        y: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    } else {
      openSettingsTab('privacy');
    }
  });

  // Downloads Button & Live Toolbar Status Trigger (Chrome Style Flyout)
  if (btnDownloads) {
    btnDownloads.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = btnDownloads.getBoundingClientRect();
      if (api && api.toggleDownloadBubble) {
        api.toggleDownloadBubble({
          x: Math.round(rect.right),
          y: Math.round(rect.bottom)
        });
      } else {
        openDownloadsTab();
      }
    });
  }

  if (toolbarDownloadStatus) {
    toolbarDownloadStatus.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = toolbarDownloadStatus.getBoundingClientRect();
      if (api && api.toggleDownloadBubble) {
        api.toggleDownloadBubble({
          x: Math.round(rect.right),
          y: Math.round(rect.bottom)
        });
      } else {
        openDownloadsTab();
      }
    });
  }

  // Notes Side Panel toggle
  btnToggleNotes.addEventListener('click', () => {
    if (api && api.toggleSidePanel) {
      api.toggleSidePanel('notes');
    }
  });

  // DevTools Toggle
  btnDevtools.addEventListener('click', () => {
    if (api && api.toggleDevTools) {
      api.toggleDevTools(activeTabId);
    }
  });

  // Settings Button
  btnSettings.addEventListener('click', () => {
    openSettingsTab();
  });

  // New Incognito Window Button (Stage 4)
  if (btnIncognito) {
    btnIncognito.addEventListener('click', () => {
      if (api && api.newIncognitoWindow) api.newIncognitoWindow();
    });
  }

  // Window Controls & Double-Click Maximize/Restore
  btnWinMin.addEventListener('click', () => api && api.minimizeWindow && api.minimizeWindow());
  btnWinMax.addEventListener('click', () => api && api.maximizeWindow && api.maximizeWindow());
  btnWinClose.addEventListener('click', () => api && api.closeWindow && api.closeWindow());

  const dragRegion = document.getElementById('drag-region');
  if (dragRegion) {
    dragRegion.addEventListener('dblclick', () => {
      if (api && api.maximizeWindow) api.maximizeWindow();
    });
  }

  // Update Maximize / Restore icon based on live window state
  function updateMaximizeButton(isMaximized) {
    if (!btnWinMax) return;
    if (isMaximized) {
      btnWinMax.textContent = '❐';
      btnWinMax.title = 'Restore';
    } else {
      btnWinMax.textContent = '□';
      btnWinMax.title = 'Maximize';
    }
  }

  if (api && api.onWindowState) {
    api.onWindowState((state) => {
      if (state && typeof state.isMaximized === 'boolean') {
        updateMaximizeButton(state.isMaximized);
      }
    });
  }

  if (api && api.isWindowMaximized) {
    api.isWindowMaximized().then(isMax => updateMaximizeButton(isMax)).catch(() => {});
  }

  if (api && api.onFullScreenChange) {
    api.onFullScreenChange((state) => {
      const isFull = Boolean(state && state.isFullScreen);
      document.body.classList.toggle('is-fullscreen', isFull);
    });
  }

  // IPC Event Listeners from Main Process
  if (api && api.onTabsUpdated) {
    api.onTabsUpdated((tabs, activeId) => {
      renderTabs(tabs, activeId);
    });
  }

  if (api && api.onNavigationState) {
    api.onNavigationState((state) => {
      btnBack.disabled = !state.canGoBack;
      btnForward.disabled = !state.canGoForward;
      updateReloadStopButton(state.isLoading);
    });
  }

  if (api && api.onAdsCountUpdate) {
    api.onAdsCountUpdate((count) => {
      adCounter.textContent = count;
    });
  }

  // ── Find in Page & Zoom Listeners (Stage 3) ──
  if (omniboxZoomBadge) {
    omniboxZoomBadge.addEventListener('click', () => {
      if (api && api.resetZoom && activeTabId) {
        api.resetZoom(activeTabId);
      }
    });
  }

  if (findInput) {
    findInput.addEventListener('input', () => {
      const val = findInput.value.trim();
      if (!val) {
        if (findMatchCount) findMatchCount.textContent = '';
        if (api && api.stopFindInPage && activeTabId) {
          api.stopFindInPage(activeTabId, 'clearSelection');
        }
      } else {
        if (api && api.findInPage && activeTabId) {
          api.findInPage(activeTabId, val, { forward: true, findNext: false });
        }
      }
    });

    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = findInput.value.trim();
        if (val && api && api.findNext && activeTabId) {
          api.findNext(activeTabId, val, !e.shiftKey);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFindBar();
      }
    });
  }

  if (btnFindPrev) {
    btnFindPrev.addEventListener('click', () => {
      const val = findInput ? findInput.value.trim() : '';
      if (val && api && api.findNext && activeTabId) {
        api.findNext(activeTabId, val, false);
      }
    });
  }

  if (btnFindNext) {
    btnFindNext.addEventListener('click', () => {
      const val = findInput ? findInput.value.trim() : '';
      if (val && api && api.findNext && activeTabId) {
        api.findNext(activeTabId, val, true);
      }
    });
  }

  if (btnFindClose) {
    btnFindClose.addEventListener('click', () => {
      closeFindBar();
    });
  }

  if (api && api.onZoomChanged) {
    api.onZoomChanged((data) => {
      if (data && data.tabId === activeTabId) {
        updateZoomBadge(data.zoomFactor);
      }
    });
  }

  if (api && api.onFindResult) {
    api.onFindResult((res) => {
      if (res && res.tabId === activeTabId) {
        updateFindResult(res);
      }
    });
  }

  // Stage 5: Permissions & Site Info initialization
  setupPermissionDropdowns();
  setupPermissionPromptListeners();

  // Stage 6: Password prompt initialization
  setupPasswordPromptListeners();

  // Stage 7: Extensions Toolbar & Menu Listeners (Chrome-style Floating Bubble)
  if (btnExtensions) {
    btnExtensions.addEventListener('click', (e) => {
      e.stopPropagation();
      if (api && api.toggleExtensionBubble) {
        const rect = btnExtensions.getBoundingClientRect();
        api.toggleExtensionBubble({
          x: Math.round(rect.x),
          y: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      } else if (extensionMenuDropdown) {
        extensionMenuDropdown.classList.toggle('hidden');
      }
    });
  }

  if (btnManageExtensions) {
    btnManageExtensions.addEventListener('click', () => {
      if (extensionMenuDropdown) extensionMenuDropdown.classList.add('hidden');
      openExtensionsTab();
    });
  }

  if (api && api.onExtensionsUpdated) {
    api.onExtensionsUpdated((list) => {
      installedExtensions = Array.isArray(list) ? list : [];
      renderExtensionChrome();
    });
  }

  window.addEventListener('click', (e) => {
    if (siteInfoPopup && !siteInfoPopup.classList.contains('hidden')) {
      if (!siteInfoPopup.contains(e.target) && e.target !== omniboxSecurity) {
        siteInfoPopup.classList.add('hidden');
      }
    }
    if (extensionMenuDropdown && !extensionMenuDropdown.classList.contains('hidden')) {
      if (!extensionMenuDropdown.contains(e.target) && !e.target.closest('#btn-extensions')) {
        extensionMenuDropdown.classList.add('hidden');
      }
    }
  });
}

// ─── Quick Notes ───────────────────────────────────────────────────────────
async function loadNotes() {
  if (api && api.getNotes) {
    try {
      const savedNotes = await api.getNotes();
      notesTextarea.value = savedNotes || '';
    } catch (_) {}
  }
}

// ─── Chromium Extensions Management (Stage 7) ──────────────────────────────
async function loadExtensions() {
  if (!api || !api.getAllExtensions) return;
  try {
    const res = await api.getAllExtensions();
    if (res) {
      installedExtensions = Array.isArray(res.extensions) ? res.extensions : (Array.isArray(res) ? res : []);
    }
    renderExtensionChrome();
  } catch (err) {
    console.warn('Failed to load extensions in chrome:', err);
  }
}

function renderExtensionChrome() {
  // 1. Render pinned icons in toolbar
  if (extensionActionIcons) {
    extensionActionIcons.innerHTML = '';
    const pinned = installedExtensions.filter(e => e.enabled && e.pinned);
    for (const ext of pinned) {
      const btn = document.createElement('button');
      btn.className = 'btn-ext-action';
      btn.title = (ext.action && ext.action.default_title) ? ext.action.default_title : ext.name;
      btn.dataset.id = ext.id;

      let iconHtml = '🧩';
      if (ext.icons && (ext.icons['16'] || ext.icons['32'] || ext.icons['48'])) {
        const iconRel = ext.icons['16'] || ext.icons['32'] || ext.icons['48'];
        const iconPath = `file:///${ext.path.replace(/\\/g, '/')}/${iconRel.replace(/^[\/\\]+/, '')}`;
        iconHtml = `<img src="${escapeHtml(iconPath)}" alt="icon" onerror="this.parentElement.textContent='🧩'">`;
      }
      btn.innerHTML = iconHtml;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = btn.getBoundingClientRect();
        if (api && api.openExtensionPopup) {
          api.openExtensionPopup(ext.id, {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          });
        }
      });

      extensionActionIcons.appendChild(btn);
    }
  }

  // 2. Render items in Extension Menu dropdown
  if (extMenuList) {
    extMenuList.innerHTML = '';
    const enabledExts = installedExtensions.filter(e => e.enabled);
    if (enabledExts.length === 0) {
      extMenuList.innerHTML = '<div class="ext-menu-empty">No enabled extensions</div>';
    } else {
      for (const ext of enabledExts) {
        const item = document.createElement('div');
        item.className = 'ext-menu-item';

        let iconHtml = '🧩';
        if (ext.icons && (ext.icons['16'] || ext.icons['32'] || ext.icons['48'])) {
          const iconRel = ext.icons['16'] || ext.icons['32'] || ext.icons['48'];
          const iconPath = `file:///${ext.path.replace(/\\/g, '/')}/${iconRel.replace(/^[\/\\]+/, '')}`;
          iconHtml = `<img src="${escapeHtml(iconPath)}" alt="icon" onerror="this.parentElement.textContent='🧩'">`;
        }

        item.innerHTML = `
          <div class="ext-menu-item-main" title="${escapeHtml(ext.name)}">
            <span class="ext-menu-item-icon">${iconHtml}</span>
            <span class="ext-menu-item-name">${escapeHtml(ext.name)}</span>
          </div>
          <button class="btn-ext-pin ${ext.pinned ? 'pinned' : ''}" title="${ext.pinned ? 'Unpin extension' : 'Pin extension'}">
            ${ext.pinned ? '📌' : '📍'}
          </button>
        `;

        // Click item main to trigger popup
        const mainBtn = item.querySelector('.ext-menu-item-main');
        mainBtn.addEventListener('click', () => {
          if (extensionMenuDropdown) extensionMenuDropdown.classList.add('hidden');
          if (api && api.openExtensionPopup) {
            const rect = btnExtensions.getBoundingClientRect();
            api.openExtensionPopup(ext.id, {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            });
          }
        });

        // Pin toggle
        const pinBtn = item.querySelector('.btn-ext-pin');
        pinBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const newPinned = !ext.pinned;
            if (api && api.setExtensionPinned) {
              await api.setExtensionPinned(ext.id, newPinned);
              ext.pinned = newPinned;
              renderExtensionChrome();
            }
          } catch (_) {}
        });

        extMenuList.appendChild(item);
      }
    }
  }
}

// ─── Keyboard Shortcuts ─────────────────────────────────────────────────────
function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // Ctrl+T: New Tab
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      if (api && api.createTab) api.createTab('mtc://newtab');
    }
    // Ctrl+W: Close Tab
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (activeTabId && api && api.closeTab) api.closeTab(activeTabId);
    }
    // Ctrl+Shift+T: Reopen Closed Tab
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      if (api && api.reopenClosedTab) api.reopenClosedTab();
    }
    // Ctrl+Shift+N: New Incognito Window (Stage 4)
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      if (api && api.newIncognitoWindow) api.newIncognitoWindow();
    }
    // Ctrl+Shift+Delete: Open Clear Browsing Data / Privacy Settings (Stage 4)
    else if (e.ctrlKey && e.shiftKey && (e.key === 'Delete' || e.key === 'Del')) {
      e.preventDefault();
      openSettingsTab('privacy');
    }
    // Ctrl+Tab / Ctrl+Shift+Tab: Switch Tab
    else if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      if (currentTabs.length > 1) {
        const currentIndex = currentTabs.findIndex(t => t.id === activeTabId);
        let nextIndex;
        if (e.shiftKey) {
          nextIndex = (currentIndex - 1 + currentTabs.length) % currentTabs.length;
        } else {
          nextIndex = (currentIndex + 1) % currentTabs.length;
        }
        if (api && api.switchTab) api.switchTab(currentTabs[nextIndex].id);
      }
    }
    // Ctrl+1 through Ctrl+8: Switch to Tab 1-8
    else if (e.ctrlKey && e.key >= '1' && e.key <= '8') {
      const idx = parseInt(e.key, 10) - 1;
      if (currentTabs[idx] && api && api.switchTab) {
        e.preventDefault();
        api.switchTab(currentTabs[idx].id);
      }
    }
    // Ctrl+9: Switch to Last Tab
    else if (e.ctrlKey && e.key === '9') {
      if (currentTabs.length > 0 && api && api.switchTab) {
        e.preventDefault();
        api.switchTab(currentTabs[currentTabs.length - 1].id);
      }
    }
    // F11: Toggle Fullscreen
    else if (e.key === 'F11') {
      e.preventDefault();
      if (api && api.toggleFullScreen) api.toggleFullScreen();
    }
    // Ctrl+R or F5: Reload (Ctrl+Shift+R = Hard Reload)
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      if (activeTabId && api && api.reloadTabIgnoringCache) {
        api.reloadTabIgnoringCache(activeTabId);
      }
    }
    else if ((e.ctrlKey && e.key.toLowerCase() === 'r') || e.key === 'F5') {
      e.preventDefault();
      if (activeTabId && api && api.reloadTab) {
        api.reloadTab(activeTabId);
      }
    }
    // Ctrl+L or Alt+D: Focus Omnibox
    else if ((e.ctrlKey && e.key.toLowerCase() === 'l') || (e.altKey && e.key.toLowerCase() === 'd')) {
      e.preventDefault();
      omniboxInput.focus();
      omniboxInput.select();
    }
    // Ctrl+D: Bookmark Tab
    else if (e.ctrlKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      btnStarBookmark.click();
    }
    // Ctrl+H: Open History
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      openHistoryTab();
    }
    // Ctrl+J: Open Downloads Tab
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      openDownloadsTab();
    }
    // Ctrl+F: Find in Page (Stage 3)
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFindBar();
    }
    // Ctrl+P: Print Tab / PDF (Stage 3)
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      if (activeTabId && api && api.printTab) api.printTab(activeTabId);
    }
    // Ctrl++ / Ctrl+=: Zoom In (Stage 3)
    else if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) {
      e.preventDefault();
      if (activeTabId && api && api.zoomIn) api.zoomIn(activeTabId);
    }
    // Ctrl+-: Zoom Out (Stage 3)
    else if (e.ctrlKey && (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')) {
      e.preventDefault();
      if (activeTabId && api && api.zoomOut) api.zoomOut(activeTabId);
    }
    // Ctrl+0: Reset Zoom (Stage 3)
    else if (e.ctrlKey && (e.key === '0' || e.code === 'Numpad0')) {
      e.preventDefault();
      if (activeTabId && api && api.resetZoom) api.resetZoom(activeTabId);
    }
    // F12: Toggle DevTools
    else if (e.key === 'F12') {
      e.preventDefault();
      if (activeTabId && api && api.toggleDevTools) api.toggleDevTools(activeTabId);
    }
  });
}

// ─── Stage 3 / Core: Downloads Management ──────────────────────────────────
function formatDownloadBytes(bytes) {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, safeI)).toFixed(1)) + ' ' + sizes[safeI];
}

function formatDownloadSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  return `${formatDownloadBytes(bytesPerSec)}/s`;
}

function formatDownloadETA(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s left`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m left`;
}

function getDownloadFileIcon(filename) {
  if (!filename) return '📁';
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'pdf': return '📄';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz': return '📦';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg': return '🖼️';
    case 'mp4':
    case 'webm':
    case 'mkv':
    case 'mov':
    case 'mp3':
    case 'wav':
    case 'flac': return '🎬';
    case 'exe':
    case 'msi':
    case 'bat':
    case 'cmd':
    case 'dmg': return '⚙️';
    case 'js':
    case 'ts':
    case 'json':
    case 'html':
    case 'css':
    case 'py': return '📝';
    default: return '📁';
  }
}

function getDownloadPercent(record) {
  if (!record.total || record.total <= 0) return 0;
  return Math.min(100, Math.round((record.received / record.total) * 100));
}

function updateDownloadBadge() {
  if (!downloadBadge || !btnDownloads) return;
  const list = Array.from(downloadsMap.values());
  const activeCount = list.filter(d => d.state === 'progressing' && !d.isPaused).length;
  if (activeCount > 0) {
    downloadBadge.textContent = activeCount > 99 ? '99+' : activeCount;
    downloadBadge.classList.remove('hidden');
    btnDownloads.classList.add('downloading');
  } else {
    downloadBadge.classList.add('hidden');
    btnDownloads.classList.remove('downloading');
  }
}

function openDownloadsTab() {
  const existingTab = currentTabs.find(t => t.url && (t.url === 'mtc://downloads' || t.url.startsWith('mtc://downloads')));
  if (existingTab && api && api.switchTab) {
    api.switchTab(existingTab.id);
  } else if (api && api.createTab) {
    api.createTab('mtc://downloads');
  }
}

function openSettingsTab(hash = '') {
  const targetUrl = hash ? `mtc://settings#${hash.replace(/^#/, '')}` : 'mtc://settings';
  const existingTab = currentTabs.find(t => t.url && t.url.startsWith('mtc://settings'));
  if (existingTab && api && api.switchTab) {
    api.switchTab(existingTab.id);
    if (hash && api.navigateTab) {
      api.navigateTab(existingTab.id, targetUrl);
    }
  } else if (api && api.createTab) {
    api.createTab(targetUrl);
  }
}

function openHistoryTab() {
  const existingTab = currentTabs.find(t => t.url && (t.url === 'mtc://history' || t.url.startsWith('mtc://history')));
  if (existingTab && api && api.switchTab) {
    api.switchTab(existingTab.id);
  } else if (api && api.createTab) {
    api.createTab('mtc://history');
  }
}

function updateToolbarDownloadStatus(record) {
  if (!toolbarDownloadStatus) return;

  const list = Array.from(downloadsMap.values());
  const activeList = list.filter(d => d.state === 'progressing');

  if (activeList.length > 0) {
    const active = activeList[0];
    const pct = getDownloadPercent(active);
    const speed = active.isPaused ? 'Paused' : formatDownloadSpeed(active.speed);

    toolbarDownloadStatus.classList.remove('hidden', 'completed');
    if (toolbarDownloadFilename) toolbarDownloadFilename.textContent = active.filename || 'Downloading...';
    if (toolbarDownloadBar) toolbarDownloadBar.style.width = `${pct}%`;
    if (toolbarDownloadMeta) toolbarDownloadMeta.textContent = speed ? `${pct}% • ${speed}` : `${pct}%`;
    if (toolbarChipTimer) clearTimeout(toolbarChipTimer);
  } else if (record && record.state === 'completed') {
    toolbarDownloadStatus.classList.remove('hidden');
    toolbarDownloadStatus.classList.add('completed');
    if (toolbarDownloadFilename) toolbarDownloadFilename.textContent = record.filename || 'File';
    if (toolbarDownloadBar) toolbarDownloadBar.style.width = '100%';
    if (toolbarDownloadMeta) toolbarDownloadMeta.textContent = 'Complete';

    if (toolbarChipTimer) clearTimeout(toolbarChipTimer);
    toolbarChipTimer = setTimeout(() => {
      toolbarDownloadStatus.classList.add('hidden');
    }, 6000);
  } else {
    toolbarDownloadStatus.classList.add('hidden');
  }
}

function showDownloadToast(record) {
  if (!downloadToast || !record) return;
  currentToastId = record.id;
  if (downloadToastTitle) downloadToastTitle.textContent = 'Download complete';
  if (downloadToastFilename) downloadToastFilename.textContent = record.filename || 'File';
  downloadToast.classList.remove('hidden');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (downloadToast) downloadToast.classList.add('hidden');
    currentToastId = null;
  }, 7000);
}

function renderDownloadTray() {
  if (!downloadTrayList) return;
  downloadTrayList.innerHTML = '';

  const list = Array.from(downloadsMap.values()).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

  if (list.length === 0) {
    downloadTrayList.innerHTML = `<div class="download-tray-empty">No recent downloads</div>`;
    return;
  }

  list.slice(0, 15).forEach(d => {
    const item = document.createElement('div');
    item.className = 'download-tray-item';
    item.id = `tray-dl-${d.id}`;

    const icon = getDownloadFileIcon(d.filename);
    const pct = getDownloadPercent(d);

    let progressBarClass = '';
    let metaText = '';

    if (d.state === 'completed') {
      progressBarClass = 'completed';
      metaText = `${formatDownloadBytes(d.total || d.received)} • Complete`;
    } else if (d.state === 'cancelled') {
      progressBarClass = 'cancelled';
      metaText = `Cancelled`;
    } else if (d.state === 'interrupted') {
      progressBarClass = 'interrupted';
      metaText = `Interrupted`;
    } else if (d.isPaused) {
      progressBarClass = 'paused';
      metaText = `${formatDownloadBytes(d.received)} / ${formatDownloadBytes(d.total)} • Paused`;
    } else {
      const speedStr = formatDownloadSpeed(d.speed);
      const etaStr = formatDownloadETA(d.eta);
      const parts = [
        `${formatDownloadBytes(d.received)} / ${formatDownloadBytes(d.total || 0)}`,
        speedStr,
        etaStr
      ].filter(Boolean);
      metaText = parts.join(' • ');
    }

    let buttonsHtml = '';
    if (d.state === 'progressing') {
      if (d.isPaused) {
        buttonsHtml = `
          <button class="btn-tray-action btn-tray-resume" data-id="${escapeHtml(d.id)}" title="Resume">▶️</button>
          <button class="btn-tray-action btn-tray-cancel" data-id="${escapeHtml(d.id)}" title="Cancel">✕</button>
        `;
      } else {
        buttonsHtml = `
          <button class="btn-tray-action btn-tray-pause" data-id="${escapeHtml(d.id)}" title="Pause">⏸️</button>
          <button class="btn-tray-action btn-tray-cancel" data-id="${escapeHtml(d.id)}" title="Cancel">✕</button>
        `;
      }
    } else if (d.state === 'completed') {
      buttonsHtml = `
        <button class="btn-tray-action btn-open btn-tray-open" data-id="${escapeHtml(d.id)}">Open</button>
        <button class="btn-tray-action btn-tray-folder" data-id="${escapeHtml(d.id)}" title="Show in folder">📁</button>
      `;
    } else if (d.state === 'cancelled' || d.state === 'interrupted') {
      buttonsHtml = `
        <button class="btn-tray-action btn-tray-retry" data-url="${escapeHtml(d.url)}" title="Retry download">🔄</button>
      `;
    }

    item.innerHTML = `
      <div class="download-tray-icon">${icon}</div>
      <div class="download-tray-details">
        <div class="download-tray-filename" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename)}</div>
        <div class="download-tray-progress-bg">
          <div class="download-tray-progress-bar ${progressBarClass}" style="width: ${pct}%;"></div>
        </div>
        <div class="download-tray-meta">${escapeHtml(metaText)}</div>
      </div>
      <div class="download-tray-buttons">
        ${buttonsHtml}
      </div>
    `;

    downloadTrayList.appendChild(item);
  });
}

function openDownloadTray(autoCloseMs = 0) {
  if (!downloadTray) return;
  renderDownloadTray();
  downloadTray.classList.remove('hidden');

  if (trayAutoCloseTimer) clearTimeout(trayAutoCloseTimer);
  if (autoCloseMs > 0) {
    trayAutoCloseTimer = setTimeout(() => {
      if (downloadTray && !downloadTray.matches(':hover')) {
        downloadTray.classList.add('hidden');
      }
    }, autoCloseMs);
  }
}

function closeDownloadTray() {
  if (downloadTray) downloadTray.classList.add('hidden');
  if (trayAutoCloseTimer) clearTimeout(trayAutoCloseTimer);
}

function toggleDownloadTray() {
  if (!downloadTray) return;
  if (downloadTray.classList.contains('hidden')) {
    openDownloadTray();
  } else {
    closeDownloadTray();
  }
}

async function loadDownloads() {
  if (!api || !api.getDownloads) return;
  try {
    const list = await api.getDownloads();
    if (Array.isArray(list)) {
      list.forEach(d => {
        if (d && d.id) downloadsMap.set(d.id, d);
      });
      updateDownloadBadge();
      updateToolbarDownloadStatus();
    }
  } catch (_) {}
}

function setupDownloadListeners() {
  if (!api) return;

  if (api.onDownloadUpdate) {
    api.onDownloadUpdate((record) => {
      if (!record || !record.id) return;
      const wasExisting = downloadsMap.has(record.id);
      const prev = downloadsMap.get(record.id);
      downloadsMap.set(record.id, record);

      updateDownloadBadge();
      updateToolbarDownloadStatus(record);

      // If new download started, auto-show Chrome-style download bubble for 5s
      if (!wasExisting && record.state === 'progressing') {
        const rect = btnDownloads ? btnDownloads.getBoundingClientRect() : null;
        if (api && api.openDownloadBubble) {
          api.openDownloadBubble(rect ? { x: Math.round(rect.right), y: Math.round(rect.bottom), autoCloseMs: 5000 } : { autoCloseMs: 5000 });
        }
      }

      // If completed just now, show toast notification
      if (record.state === 'completed' && (!prev || prev.state !== 'completed')) {
        showDownloadToast(record);
      }
    });
  }

  // Tray buttons delegate
  if (downloadTrayList) {
    downloadTrayList.addEventListener('click', async (e) => {
      const target = e.target.closest('button');
      if (!target) return;

      const id = target.dataset.id;
      const url = target.dataset.url;

      if (target.classList.contains('btn-tray-pause') && id && api.pauseDownload) {
        await api.pauseDownload(id);
      } else if (target.classList.contains('btn-tray-resume') && id && api.resumeDownload) {
        await api.resumeDownload(id);
      } else if (target.classList.contains('btn-tray-cancel') && id && api.cancelDownload) {
        await api.cancelDownload(id);
      } else if (target.classList.contains('btn-tray-open') && id && api.openDownloadedFile) {
        await api.openDownloadedFile(id);
      } else if (target.classList.contains('btn-tray-folder') && id && api.showDownloadInFolder) {
        await api.showDownloadInFolder(id);
      } else if (target.classList.contains('btn-tray-retry') && url && api.retryDownload) {
        await api.retryDownload(url);
      }
    });
  }

  // Tray Header / Footer buttons
  if (btnTrayOpenFolder) {
    btnTrayOpenFolder.addEventListener('click', () => {
      if (api && api.openDownloadsFolder) api.openDownloadsFolder();
    });
  }

  if (btnTrayClose) {
    btnTrayClose.addEventListener('click', () => {
      closeDownloadTray();
    });
  }

  if (btnTrayAllDownloads) {
    btnTrayAllDownloads.addEventListener('click', () => {
      closeDownloadTray();
      if (api && api.createTab) {
        api.createTab('mtc://downloads');
      }
    });
  }

  if (btnTrayClear) {
    btnTrayClear.addEventListener('click', async () => {
      if (api && api.clearDownloads) {
        await api.clearDownloads();
        for (const [k, v] of downloadsMap.entries()) {
          if (v.state === 'completed' || v.state === 'cancelled') {
            downloadsMap.delete(k);
          }
        }
        renderDownloadTray();
        updateDownloadBadge();
        updateToolbarDownloadStatus();
      }
    });
  }

  // Toast actions
  if (btnToastOpen) {
    btnToastOpen.addEventListener('click', () => {
      if (currentToastId && api && api.openDownloadedFile) {
        api.openDownloadedFile(currentToastId);
      }
      if (downloadToast) downloadToast.classList.add('hidden');
    });
  }

  if (btnToastFolder) {
    btnToastFolder.addEventListener('click', () => {
      if (currentToastId && api && api.showDownloadInFolder) {
        api.showDownloadInFolder(currentToastId);
      }
      if (downloadToast) downloadToast.classList.add('hidden');
    });
  }

  if (btnToastClose) {
    btnToastClose.addEventListener('click', () => {
      if (downloadToast) downloadToast.classList.add('hidden');
    });
  }

  // Click outside tray to close
  document.addEventListener('click', (e) => {
    if (downloadTray && !downloadTray.classList.contains('hidden')) {
      if (!downloadTray.contains(e.target) && !btnDownloads.contains(e.target)) {
        closeDownloadTray();
      }
    }
  });
}

// ─── Auto-Update Toolbar Controller ─────────────────────────────────────────
function setupUpdateToolbarListeners() {
  if (!btnCheckUpdateToolbar) return;

  function renderToolbarUpdateStatus(status) {
    if (!status) return;
    currentUpdateStatus = status;

    switch (status.status) {
      case 'checking':
        btnCheckUpdateToolbar.classList.add('spinning');
        btnCheckUpdateToolbar.classList.remove('update-ready');
        if (updateToolbarBadge) updateToolbarBadge.classList.add('hidden');
        btnCheckUpdateToolbar.title = 'Checking for updates...';
        break;

      case 'available':
      case 'downloading':
        btnCheckUpdateToolbar.classList.remove('spinning');
        btnCheckUpdateToolbar.classList.remove('update-ready');
        if (updateToolbarBadge) {
          updateToolbarBadge.classList.remove('hidden');
          const pct = Math.round(status.percent || 0);
          updateToolbarBadge.textContent = pct > 0 ? `${pct}%` : '↓';
        }
        btnCheckUpdateToolbar.title = `Downloading update: ${Math.round(status.percent || 0)}% (Click to view)`;
        break;

      case 'downloaded':
        btnCheckUpdateToolbar.classList.remove('spinning');
        btnCheckUpdateToolbar.classList.add('update-ready');
        if (updateToolbarBadge) {
          updateToolbarBadge.classList.remove('hidden');
          updateToolbarBadge.textContent = '!';
        }
        btnCheckUpdateToolbar.title = `Update ready (v${status.availableVersion || ''})! Click to restart and install.`;
        break;

      case 'not-available':
        btnCheckUpdateToolbar.classList.remove('spinning');
        btnCheckUpdateToolbar.classList.remove('update-ready');
        if (updateToolbarBadge) updateToolbarBadge.classList.add('hidden');
        btnCheckUpdateToolbar.title = `SHMMOTH Browser is up to date (v${status.currentVersion || ''})`;
        break;

      case 'error':
        btnCheckUpdateToolbar.classList.remove('spinning');
        btnCheckUpdateToolbar.classList.remove('update-ready');
        if (updateToolbarBadge) updateToolbarBadge.classList.add('hidden');
        btnCheckUpdateToolbar.title = 'Update check: ' + (status.error || status.message || 'Error occurred');
        break;

      default:
        btnCheckUpdateToolbar.classList.remove('spinning');
        btnCheckUpdateToolbar.classList.remove('update-ready');
        if (updateToolbarBadge) updateToolbarBadge.classList.add('hidden');
        btnCheckUpdateToolbar.title = 'Check for updates';
        break;
    }
  }

  // Subscribe to live status pushes from UpdateManager
  if (api && api.onUpdateStatus) {
    api.onUpdateStatus((status) => {
      renderToolbarUpdateStatus(status);
    });
  }

  // Fetch initial status on startup
  if (api && api.getUpdateStatus) {
    api.getUpdateStatus().then(status => {
      renderToolbarUpdateStatus(status);
    }).catch(() => {});
  }

  // Click handler
  btnCheckUpdateToolbar.addEventListener('click', async () => {
    // 1. If an update has already finished downloading, offer instant restart & install
    if (currentUpdateStatus && currentUpdateStatus.status === 'downloaded') {
      const confirmRelaunch = window.confirm(
        `SHMMOTH Browser Update Ready!\n\nVersion ${currentUpdateStatus.availableVersion || ''} is downloaded and ready to install.\n\nRestart now to finish updating?`
      );
      if (confirmRelaunch && api && api.installUpdate) {
        api.installUpdate();
      }
      return;
    }

    // 2. Open About Settings in a NEW TAB (or switch to existing) so active user work is NEVER lost!
    openSettingsTab('about');

    // 3. Trigger manual check if idle, not-available, or error
    if (!currentUpdateStatus || currentUpdateStatus.status === 'idle' || currentUpdateStatus.status === 'not-available' || currentUpdateStatus.status === 'error') {
      renderToolbarUpdateStatus({ status: 'checking', currentVersion: currentUpdateStatus?.currentVersion || '1.0.10' });
      if (api && api.checkForUpdates) {
        try {
          const res = await api.checkForUpdates();
          renderToolbarUpdateStatus(res);
        } catch (err) {
          renderToolbarUpdateStatus({ status: 'error', error: err.message });
        }
      }
    }
  });

  // Secondary / contextmenu: open settings about in a new tab without overwriting active work
  btnCheckUpdateToolbar.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openSettingsTab('about');
  });
}

function openSettingsTab(hash = '') {
  const targetUrl = hash ? `mtc://settings#${hash}` : 'mtc://settings';
  const existingTab = currentTabs.find(t => t.url && t.url.startsWith('mtc://settings'));
  if (existingTab) {
    if (api && api.switchTab) api.switchTab(existingTab.id);
    if (hash && api && api.navigateTab) api.navigateTab(existingTab.id, targetUrl);
  } else {
    if (api && api.createTab) api.createTab(targetUrl);
  }
}

function openDownloadsTab() {
  const existingTab = currentTabs.find(t => t.url && t.url.startsWith('mtc://downloads'));
  if (existingTab) {
    if (api && api.switchTab) api.switchTab(existingTab.id);
  } else {
    if (api && api.createTab) api.createTab('mtc://downloads');
  }
}

function openExtensionsTab() {
  const existingTab = currentTabs.find(t => t.url && t.url.startsWith('mtc://extensions'));
  if (existingTab) {
    if (api && api.switchTab) api.switchTab(existingTab.id);
  } else {
    if (api && api.createTab) api.createTab('mtc://extensions');
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

init();
