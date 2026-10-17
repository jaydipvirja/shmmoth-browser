// Notes side-panel controller (mtc://notes)
// (extracted from an inline <script> so the mtc:// Content-Security-Policy can forbid inline scripts)
'use strict';

const textarea = document.getElementById('notes-content');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const stats = document.getElementById('stats');
const btnCopy = document.getElementById('btn-copy');
const btnClear = document.getElementById('btn-clear');

let debounceTimer = null;

function updateStats() {
  const text = textarea.value.trim();
  const chars = textarea.value.length;
  const words = text ? text.split(/\s+/).length : 0;
  stats.textContent = `${words} words | ${chars} chars`;
}

async function loadNotes() {
  if (window.mtcAPI && window.mtcAPI.getNotes) {
    const content = await window.mtcAPI.getNotes();
    textarea.value = content || '';
    updateStats();
  }
}

textarea.addEventListener('input', () => {
  statusText.textContent = 'Saving…';
  status.classList.add('saving');
  updateStats();

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    if (window.mtcAPI && window.mtcAPI.saveNotes) {
      await window.mtcAPI.saveNotes(textarea.value);
      statusText.textContent = 'All changes saved';
      status.classList.remove('saving');
    }
  }, 500);
});

btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(textarea.value);
  const prev = btnCopy.textContent;
  btnCopy.textContent = 'Copied!';
  setTimeout(() => btnCopy.textContent = prev, 1500);
});

btnClear.addEventListener('click', async () => {
  if (confirm('Clear all notes?')) {
    textarea.value = '';
    updateStats();
    if (window.mtcAPI && window.mtcAPI.saveNotes) {
      await window.mtcAPI.saveNotes('');
    }
  }
});

loadNotes();
