/**
 * DEPENDENCY AUDIT — scripts/audit.js (CI: "Unit tests + npm audit")
 *
 * `npm audit --audit-level=high`, with one difference: an advisory listed in audit-exceptions.json does not fail the
 * check. An exception is only for an advisory that has no fixed release yet and that sits in the build tooling only
 * (nothing of it ships in the browser), agreed by the owner; each one names the reason and a date by which it must be
 * looked at again — after that date it fails the check like any other advisory. Electron is a devDependency but IS the
 * browser: its advisories are never excepted (and the audit still covers devDependencies for that reason).
 *
 * Run: npm run audit
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FAIL_AT = new Set(['high', 'critical']);
const NEVER_EXCEPTED = new Set(['electron']);

function loadExceptions(file, today) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')).exceptions || []; } catch (_) { list = []; }
  const active = new Map();
  const expired = [];
  for (const e of list) {
    if (!e || typeof e.advisory !== 'string') continue;
    if (typeof e.reviewBy !== 'string' || e.reviewBy < today) expired.push(e);
    else active.set(e.advisory, e);
  }
  return { active, expired };
}

/** The advisories (GHSA ids) behind a vulnerability, following "via" through the packages that depend on it. */
function rootAdvisories(vulns, name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const v = vulns[name];
  if (!v) return [];
  const out = [];
  for (const via of v.via || []) {
    if (typeof via === 'string') out.push(...rootAdvisories(vulns, via, seen));
    else if (via && typeof via.url === 'string') out.push({ id: via.url.split('/').pop(), pkg: via.name || name, severity: via.severity, title: via.title });
  }
  return out;
}

/** @returns {{ failing: object[], excepted: object[], expired: object[] }} */
function evaluate(report, exceptions) {
  const vulns = (report && report.vulnerabilities) || {};
  const failing = new Map();
  const excepted = new Map();
  for (const [name, v] of Object.entries(vulns)) {
    if (!FAIL_AT.has(v.severity)) continue;
    for (const a of rootAdvisories(vulns, name)) {
      if (!FAIL_AT.has(a.severity)) continue;
      const ok = exceptions.active.has(a.id) && !NEVER_EXCEPTED.has(a.pkg) && !NEVER_EXCEPTED.has(name);
      (ok ? excepted : failing).set(a.id + ' ' + a.pkg, a);
    }
  }
  return { failing: [...failing.values()], excepted: [...excepted.values()], expired: exceptions.expired };
}

function main() {
  const root = path.join(__dirname, '..');
  const res = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  let report;
  try { report = JSON.parse(res.stdout); } catch (_) {
    console.error('npm audit gave no report:', (res.stderr || '').slice(0, 500));
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  const r = evaluate(report, loadExceptions(path.join(root, 'audit-exceptions.json'), today));
  for (const a of r.excepted) console.log(`  excepted (audit-exceptions.json): ${a.id} ${a.pkg} — ${a.title}`);
  for (const e of r.expired) console.error(`  ❌ exception past its review date (${e.reviewBy}): ${e.advisory} — look again: is there a fix now?`);
  for (const a of r.failing) console.error(`  ❌ ${a.severity}: ${a.id} ${a.pkg} — ${a.title}`);
  const bad = r.failing.length + r.expired.length;
  console.log(bad ? `\n  npm audit: ${bad} problem(s)` : '\n  npm audit: no high or critical advisory (apart from the listed exceptions)');
  process.exit(bad ? 1 : 0);
}

if (require.main === module) main();
module.exports = { evaluate, loadExceptions, rootAdvisories };
