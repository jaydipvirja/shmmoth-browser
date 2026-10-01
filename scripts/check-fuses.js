#!/usr/bin/env node
/**
 * Verifies that a packaged SHMMOTH Browser binary really carries the Electron fuses configured in
 * package.json ("build.electronFuses"). electron-builder flips them at build time; this reads them back from the
 * binary so a build that silently skipped the step (or a config typo) cannot ship.
 *
 *   node scripts/check-fuses.js <path to the packaged executable> [--ignore=fuseName,otherFuse]
 *
 * --ignore is for the test build: Playwright cannot attach to an Electron binary whose
 * enableNodeCliInspectArguments fuse is off, so `npm run test:e2e:packaged` builds with that single fuse on.
 * Fuses that package.json does not mention are left alone (they keep Electron's defaults).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/** @returns {{ ok: boolean, problems: string[], checked: string[] }} */
function compareFuses(expected, actual, { ignore = [] } = {}) {
  const problems = [];
  const checked = [];
  for (const [name, want] of Object.entries(expected)) {
    if (ignore.includes(name)) continue;
    checked.push(name);
    if (!(name in actual)) { problems.push(`${name}: unknown fuse (not in this Electron build)`); continue; }
    if (actual[name] !== want) problems.push(`${name}: expected ${want}, binary has ${actual[name]}`);
  }
  return { ok: problems.length === 0, problems, checked };
}

/**
 * Maps the fuse wire read from the binary to the option names used in electron-builder's config.
 * The wire holds one character code per fuse: '1' enabled, '0' disabled (anything else, e.g. 'r' = removed, is skipped).
 */
async function readFuses(executable) {
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  const wire = await getCurrentFuseWire(executable);
  const actual = {};
  for (const [name, index] of Object.entries(FuseV1Options)) {
    if (typeof index !== 'number') continue;                       // the enum is a two-way map
    const camel = name.charAt(0).toLowerCase() + name.slice(1);
    if (wire[index] === 49) actual[camel] = true;
    else if (wire[index] === 48) actual[camel] = false;
  }
  return actual;
}

async function main() {
  const args = process.argv.slice(2);
  const exe = args.find((a) => !a.startsWith('--'));
  const ignore = ((args.find((a) => a.startsWith('--ignore=')) || '').slice(9)).split(',').filter(Boolean);
  if (!exe) { console.error('usage: node scripts/check-fuses.js <executable> [--ignore=a,b]'); process.exit(2); }
  if (!fs.existsSync(exe)) { console.error(`not found: ${exe}`); process.exit(2); }

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const expected = (pkg.build && pkg.build.electronFuses) || {};
  if (Object.keys(expected).length === 0) { console.error('package.json has no build.electronFuses'); process.exit(1); }

  const actual = await readFuses(exe);
  const res = compareFuses(expected, actual, { ignore });
  for (const name of res.checked) console.log(`${res.problems.some((p) => p.startsWith(name + ':')) ? '❌' : '✅'} ${name} = ${actual[name]}`);
  if (ignore.length) console.log(`(ignored: ${ignore.join(', ')})`);
  if (!res.ok) { console.error('\nFuse mismatch:\n  ' + res.problems.join('\n  ')); process.exit(1); }
  console.log(`\nAll ${res.checked.length} configured fuses are set in ${exe}`);
}

module.exports = { compareFuses, readFuses };

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
