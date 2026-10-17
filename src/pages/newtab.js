// SHMMOTH BROWSER - New Tab Dashboard Logic

// Update Clock & Greeting
function updateClock() {
  const now = new Date();
  
  // Format Time (HH:MM:SS or HH:MM)
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('live-time').textContent = `${hours}:${minutes}`;

  // Format Date
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('live-date').textContent = now.toLocaleDateString(undefined, options);

  // Greeting
  let greeting = "Good Morning";
  const h = now.getHours();
  if (h >= 12 && h < 17) greeting = "Good Afternoon";
  else if (h >= 17 && h < 21) greeting = "Good Evening";
  else if (h >= 21 || h < 5) greeting = "Good Night";

  document.getElementById('live-greeting').textContent = greeting;
}

setInterval(updateClock, 1000);
updateClock();

// Shortcuts Management
let shortcuts = [
  { id: 'sc_1', title: 'Google', url: 'https://www.google.com' },
  { id: 'sc_2', title: 'YouTube', url: 'https://www.youtube.com' },
  { id: 'sc_3', title: 'GitHub', url: 'https://github.com' },
  { id: 'sc_4', title: 'Gemini AI', url: 'https://gemini.google.com' },
  { id: 'sc_5', title: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'sc_6', title: 'Wikipedia', url: 'https://www.wikipedia.org' }
];

async function loadShortcuts() {
  try {
    if (window.mtcAPI && window.mtcAPI.getShortcuts) {
      shortcuts = await window.mtcAPI.getShortcuts();
    }
  } catch (e) {
    console.log('Using default shortcuts');
  }
  renderShortcuts();
}

// A tile for a shortcut: the first letter of its name on a colour picked from its address, so each site keeps its colour.
// Nothing is fetched (no favicon service learns which sites are on the page). The colours all carry white text at
// 4.5 : 1 or more.
const TILE_COLORS = ['#c5221f', '#1d4ed8', '#0b7a3e', '#7c3aed', '#a15c00', '#0e7490', '#be185d', '#475569'];
function tileFor(item) {
  let host = '';
  try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch (_) { host = String(item.url || ''); }
  const name = String(item.title || host || '?').trim();
  let h = 0;
  for (const ch of host || name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return { letter: (name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase(), color: TILE_COLORS[h % TILE_COLORS.length] };
}

function renderShortcuts() {
  const grid = document.getElementById('shortcuts-grid');
  grid.innerHTML = '';

  shortcuts.forEach(item => {
    const card = document.createElement('div');
    card.className = 'shortcut-card';
    const tile = tileFor(item);
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.innerHTML = `
      <span class="tile-letter" style="background: ${tile.color}">${escapeHtml(tile.letter)}</span>
      <span class="card-label">${escapeHtml(item.title)}</span>
      <button class="delete-shortcut-btn" title="Remove" aria-label="Remove ${escapeHtml(item.title)}"><span class="sh-icon" data-icon="close" aria-hidden="true"></span></button>
    `;
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigateTo(item.url); });

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-shortcut-btn')) return;
      navigateTo(item.url);
    });

    const deleteBtn = card.querySelector('.delete-shortcut-btn');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (window.mtcAPI && window.mtcAPI.removeShortcut) {
        shortcuts = await window.mtcAPI.removeShortcut(item.id);
      } else {
        shortcuts = shortcuts.filter(s => s.id !== item.id);
      }
      renderShortcuts();
    });

    grid.appendChild(card);
  });
  if (window.ShIcons) window.ShIcons.drawAll(grid);
}

// Navigation Helper
function navigateTo(targetUrl) {
  if (window.mtcAPI && window.mtcAPI.navigateCurrentTab) {
    window.mtcAPI.navigateCurrentTab(targetUrl);
  } else {
    window.location.href = targetUrl;
  }
}

// Search Form Handler (Default: Google Search)
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  let targetUrl = '';
  // Check if it's already a URL
  if (/^https?:\/\//i.test(query)) {
    targetUrl = query;
  } else if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(query)) {
    targetUrl = 'https://' + query;
  } else {
    // Search using selected engine
    const engineMap = {
      google:     'https://www.google.com/search?q=',
      duckduckgo: 'https://duckduckgo.com/?q=',
      bing:       'https://www.bing.com/search?q='
    };
    let searchEngineUrl = 'https://www.google.com/search?q=';
    if (window.mtcAPI && window.mtcAPI.getSettings) {
      try {
        const settings = await window.mtcAPI.getSettings();
        if (settings && settings.searchEngine) {
          const se = settings.searchEngine.toLowerCase();
          searchEngineUrl = (settings.searchEngineUrls && settings.searchEngineUrls[se]) ||
                            engineMap[se] ||
                            'https://www.google.com/search?q=';
        }
      } catch (err) {}
    }
    targetUrl = searchEngineUrl + encodeURIComponent(query);
  }

  navigateTo(targetUrl);
});

// Top Navigation Buttons
document.getElementById('btn-open-bookmarks').addEventListener('click', () => {
  navigateTo('mtc://bookmarks');
});

document.getElementById('btn-open-history').addEventListener('click', () => {
  navigateTo('mtc://history');
});

document.getElementById('btn-open-settings').addEventListener('click', () => {
  navigateTo('mtc://settings');
});

// Add Shortcut Modal
const modal = document.getElementById('shortcut-modal');
const btnAddShortcut = document.getElementById('btn-add-shortcut');
const btnCancelModal = document.getElementById('modal-cancel-btn');
const btnSaveModal = document.getElementById('modal-save-btn');
const modalName = document.getElementById('modal-name');
const modalUrl = document.getElementById('modal-url');

btnAddShortcut.addEventListener('click', () => {
  modalName.value = '';
  modalUrl.value = '';
  modal.classList.remove('hidden');
  modalName.focus();
});

btnCancelModal.addEventListener('click', () => {
  modal.classList.add('hidden');
});

btnSaveModal.addEventListener('click', async () => {
  const title = modalName.value.trim();
  let url = modalUrl.value.trim();
  if (!title || !url) return;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const newShortcut = { title, url };
  if (window.mtcAPI && window.mtcAPI.addShortcut) {
    shortcuts = await window.mtcAPI.addShortcut(newShortcut);
  } else {
    shortcuts.push({ id: 'sc_' + Date.now(), ...newShortcut });
  }

  modal.classList.add('hidden');
  renderShortcuts();
});

// The engine version is the one this browser really runs (it was a fixed "130" in the page)
(function showEngineVersion() {
  const el = document.getElementById('stat-engine');
  const major = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1];
  if (el && major) el.textContent = `Engine: Chromium ${major}`;
})();

// Load stats
async function loadStats() {
  if (window.mtcAPI && window.mtcAPI.getSettings) {
    try {
      const settings = await window.mtcAPI.getSettings();
      const adsBlocked = await window.mtcAPI.getAdsBlockedCount();
      document.getElementById('stat-ads-blocked').textContent = `Ad-Blocker: ${settings.adBlockerEnabled ? 'Active (' + adsBlocked + ' blocked)' : 'Disabled'}`;
      document.getElementById('stat-ram-saver').textContent = `RAM Saver: ${settings.ramSaverEnabled ? 'On (' + settings.ramSaverTimeoutMinutes + 'm)' : 'Off'}`;
    } catch (e) {}
  }
}

// Incognito Mode Detection (Stage 4)
async function checkIncognito() {
  try {
    if (window.mtcAPI && window.mtcAPI.isIncognitoWindow) {
      const isIncognito = await window.mtcAPI.isIncognitoWindow();
      if (isIncognito) {
        document.body.classList.add('incognito-theme');
        const incognitoPanel = document.getElementById('incognito-panel');
        const shortcutsSection = document.getElementById('shortcuts-section');
        const brandBadge = document.querySelector('.brand-badge');
        if (brandBadge) {
          brandBadge.innerHTML = '<span class="brand-dot" style="background:#a855f7;box-shadow:0 0 10px #a855f7;"></span><span class="brand-text">SHMMOTH INCOGNITO</span>';
        }
        if (incognitoPanel) incognitoPanel.classList.remove('hidden');
        if (shortcutsSection) shortcutsSection.classList.add('hidden');
      }
    }
  } catch (_) {}
}

// First start: theme and search engine, until "Start browsing" (settings.welcomeDone; existing users never see it)
const ENGINE_NAMES = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing', yahoo: 'Yahoo' };

function showEngineInPlaceholder(engine) {
  const input = document.getElementById('search-input');
  const name = ENGINE_NAMES[engine] || 'Google';
  input.placeholder = `Search ${name} or type a web address`;
  input.setAttribute('aria-label', input.placeholder);
}

function markPressed(group, value) {
  for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === value));
}

// "Import from Chrome": the first browser found on this computer, both bookmarks and history
async function setupWelcomeImport(api) {
  if (!api.detectImportSources || !api.importFromBrowser) return;
  let sources = [];
  try { sources = await api.detectImportSources(); } catch (_) { return; }
  const source = sources[0];
  if (!source) return;
  const row = document.getElementById('welcome-import-row');
  const label = document.getElementById('welcome-import-label');
  const btn = document.getElementById('welcome-import');
  btn.textContent = `Import from ${source.name}`;
  row.classList.remove('hidden');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Importing…';
    const res = await api.importFromBrowser({ browserId: source.id, profileDir: source.profiles[0].dir }).catch((err) => ({ success: false, error: err.message }));
    if (res && res.success) {
      label.textContent = `Imported ${res.bookmarks} bookmarks and ${res.history} pages of history`;
      btn.textContent = 'Done';
    } else {
      label.textContent = (res && res.error) || 'The import did not work.';
      btn.textContent = 'Try again';
      btn.disabled = false;
    }
  });
}

async function setupWelcome() {
  const api = window.mtcAPI;
  if (!api || !api.getSettings || !api.updateSettings) return;
  let settings;
  try { settings = await api.getSettings(); } catch (_) { return; }
  showEngineInPlaceholder(settings.searchEngine);
  if (settings.welcomeDone !== false) return;
  if (api.isIncognitoWindow && await api.isIncognitoWindow().catch(() => false)) return;

  const card = document.getElementById('welcome-card');
  const themeGroup = document.getElementById('welcome-theme');
  const engineGroup = document.getElementById('welcome-engine');
  markPressed(themeGroup, settings.theme || 'system');
  markPressed(engineGroup, settings.searchEngine || 'google');

  themeGroup.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    markPressed(themeGroup, b.dataset.value);
    await api.updateSettings({ theme: b.dataset.value });      // every page switches at once (theme:changed)
  });
  engineGroup.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    markPressed(engineGroup, b.dataset.value);
    showEngineInPlaceholder(b.dataset.value);
    await api.updateSettings({ searchEngine: b.dataset.value });
  });
  setupWelcomeImport(api);
  document.getElementById('welcome-done').addEventListener('click', async () => {
    card.classList.add('hidden');
    await api.updateSettings({ welcomeDone: true });
    document.getElementById('search-input').focus();
  });
  card.classList.remove('hidden');
}

checkIncognito();
loadShortcuts();
loadStats();
setupWelcome();

