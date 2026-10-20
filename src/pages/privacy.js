// SHMMOTH BROWSER — Privacy Report (mtc://privacy)
// What the privacy shield stopped in the last 30 days (services/privacyStats.js). Everything is written with DOM calls
// and textContent: site names come from the web.
'use strict';

const api = window.shmmothAPI || window.mtcAPI;

const fmt = (n) => Number(n || 0).toLocaleString();

function setNum(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = fmt(n);
}

function row(title, sub, value, max, countText) {
  const r = document.createElement('div');
  r.className = 'row';
  const name = document.createElement('div');
  name.className = 'name';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = sub;
  name.append(strong, span);
  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('i');
  fill.style.width = `${Math.max(4, Math.round((value / Math.max(1, max)) * 100))}%`;
  bar.appendChild(fill);
  const count = document.createElement('div');
  count.className = 'count';
  count.textContent = countText;
  r.append(name, bar, count);
  return r;
}

function empty(text) {
  const d = document.createElement('div');
  d.className = 'empty';
  d.textContent = text;
  return d;
}

async function load() {
  let report = null;
  try { report = api && api.getPrivacyReport ? await api.getPrivacyReport() : null; } catch (_) { report = null; }
  const t = (report && report.totals) || {};
  setNum('stat-trackers', t.trackers);
  setNum('stat-sites', t.sitesWithTrackers);
  setNum('stat-blocked', t.blocked);
  setNum('stat-cookies', t.cookies);
  setNum('stat-params', t.params);
  setNum('stat-https', t.https);
  if (report && report.since) {
    document.getElementById('report-period').textContent =
      `Since ${new Date(report.since + 'T00:00:00').toLocaleDateString()} (at most the last ${report.days} days). Kept on this computer only; Incognito windows are never counted.`;
  }

  const trackers = document.getElementById('list-trackers');
  trackers.replaceChildren();
  const tt = (report && report.topTrackers) || [];
  if (!tt.length) trackers.appendChild(empty('Nothing yet. Trackers show up here as the shield stops them on the sites you visit.'));
  const maxSites = Math.max(1, ...tt.map((x) => x.sites));
  for (const x of tt) {
    const who = x.company ? `${x.company} — ` : '';
    const where = x.examples && x.examples.length ? `seen on ${x.examples.join(', ')}${x.sites > x.examples.length ? ' …' : ''}` : 'stopped';
    trackers.appendChild(row(x.site, who + where, x.sites, maxSites, `${fmt(x.sites)} site${x.sites === 1 ? '' : 's'}`));
  }

  const sites = document.getElementById('list-sites');
  sites.replaceChildren();
  const ts = (report && report.topSites) || [];
  if (!ts.length) sites.appendChild(empty('No website has tried to track you yet in this period.'));
  const maxT = Math.max(1, ...ts.map((x) => x.trackers));
  for (const x of ts) sites.appendChild(row(x.site, '', x.trackers, maxT, `${fmt(x.trackers)} tracker${x.trackers === 1 ? '' : 's'}`));
}

document.getElementById('btn-clear-report').addEventListener('click', async () => {
  if (!confirm('Clear the Privacy Report? The shield keeps protecting you; only the counts start again.')) return;
  try { await api.clearPrivacyReport(); } catch (_) { /* shown by the reload below */ }
  load();
});
document.getElementById('btn-settings').addEventListener('click', () => {
  if (api && api.navigateCurrentTab) api.navigateCurrentTab('mtc://settings#privacy');
});
document.getElementById('btn-back').addEventListener('click', () => {
  if (api && api.navigateCurrentTab) api.navigateCurrentTab('mtc://newtab');
});

load();
