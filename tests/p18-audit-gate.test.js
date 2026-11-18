/**
 * P18 — the dependency audit gate (scripts/audit.js, CI "Unit tests + npm audit")
 *
 *   - a high advisory fails the check, as `npm audit --audit-level=high` did
 *   - an advisory in audit-exceptions.json does not, until its review date; after that it fails again
 *   - Electron's advisories are never excepted, even when listed
 *   - moderate advisories do not fail (as before); an advisory reached through other packages ("via") is found
 *   - the exception list holds only what the owner agreed to (picomatch GHSA-fc5q-39xc-vjpf), each with a reason and a date
 *
 * Run: node tests/p18-audit-gate.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { evaluate, loadExceptions } = require('../scripts/audit');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; } catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const adv = (name, id, severity) => ({ source: 1, name, severity, title: name + ' issue', url: 'https://github.com/advisories/' + id });
const REPORT = {
  vulnerabilities: {
    picomatch: { severity: 'high', via: [adv('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high')] },
    tinyglobby: { severity: 'high', via: ['picomatch'] },
    'node-gyp': { severity: 'high', via: ['tinyglobby'] },
    minimatch: { severity: 'moderate', via: [adv('minimatch', 'GHSA-g3hv-75wg-m249', 'moderate')] }
  }
};
const exceptions = (list, today = '2026-11-18') => {
  const f = path.join(require('os').tmpdir(), `shmmoth-p18-${process.pid}-${Math.random()}.json`);
  fs.writeFileSync(f, JSON.stringify({ exceptions: list }));
  try { return loadExceptions(f, today); } finally { fs.unlinkSync(f); }
};
const PICO = { advisory: 'GHSA-fc5q-39xc-vjpf', reviewBy: '2027-01-31' };

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — the dependency audit gate');
console.log('══════════════════════════════════════════════════════\n');

test('a high advisory fails the check (also when only reached through other packages)', () => {
  const r = evaluate(REPORT, exceptions([]));
  eq(r.failing.map((a) => a.id), ['GHSA-fc5q-39xc-vjpf']);
});

test('a listed advisory does not fail until its review date', () => {
  const r = evaluate(REPORT, exceptions([PICO]));
  eq(r.failing, []);
  eq(r.excepted.map((a) => a.id), ['GHSA-fc5q-39xc-vjpf']);
});

test('after its review date it fails again (and the expired exception is reported)', () => {
  const r = evaluate(REPORT, exceptions([PICO], '2027-02-01'));
  eq(r.failing.map((a) => a.id), ['GHSA-fc5q-39xc-vjpf']);
  eq(r.expired.map((e) => e.advisory), ['GHSA-fc5q-39xc-vjpf']);
});

test('only the listed advisory is excepted: another high one still fails', () => {
  const report = { vulnerabilities: { ...REPORT.vulnerabilities, undici: { severity: 'high', via: [adv('undici', 'GHSA-aaaa-bbbb-cccc', 'high')] } } };
  eq(evaluate(report, exceptions([PICO])).failing.map((a) => a.id), ['GHSA-aaaa-bbbb-cccc']);
});

test('Electron\'s advisories are never excepted, even when listed', () => {
  const report = { vulnerabilities: { electron: { severity: 'high', via: [adv('electron', 'GHSA-elec-tron-0001', 'high')] } } };
  eq(evaluate(report, exceptions([{ advisory: 'GHSA-elec-tron-0001', reviewBy: '2099-01-01' }])).failing.map((a) => a.id), ['GHSA-elec-tron-0001']);
});

test('moderate advisories do not fail (as with --audit-level=high)', () => {
  const report = { vulnerabilities: { minimatch: REPORT.vulnerabilities.minimatch } };
  eq(evaluate(report, exceptions([])).failing, []);
});

test('the exception list: only picomatch GHSA-fc5q-39xc-vjpf, with a reason and a review date; CI runs the gate', () => {
  const root = path.join(__dirname, '..');
  const list = JSON.parse(fs.readFileSync(path.join(root, 'audit-exceptions.json'), 'utf8')).exceptions;
  eq(list.map((e) => e.advisory), ['GHSA-fc5q-39xc-vjpf']);
  for (const e of list) assert(e.reason && /^\d{4}-\d{2}-\d{2}$/.test(e.reviewBy) && e.reviewBy <= '2027-12-31', 'reason and a near review date');
  assert(/- run: npm run audit/.test(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')), 'CI runs the gate');
  assert(require(path.join(root, 'package.json')).scripts.audit === 'node scripts/audit.js');
});

console.log(`\n  p18-audit-gate: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
