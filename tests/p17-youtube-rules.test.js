/**
 * P17 — YouTube gets only uBlock Origin's page scripts (1.5.8)
 *
 * With AdGuard's YouTube scriptlets on top of uBlock's (AdGuard forced "web_streaming_watch" off and set traps on the
 * player's data, uBlock rewrites the player's requests) YouTube videos kept buffering and never played.
 *   - the scriptlet and HTML rules of the other lists leave YouTube's sites out; a rule for YouTube only is dropped;
 *     "~youtube.com" stays; the other sites of a rule keep it; a rule left with exceptions only is dropped
 *   - uBlock's own lists are untouched; element hiding and network rules of the others are untouched
 *   - the engine is built from the prepared text, and the kept engine of 1.5.7 is not used (format version 3)
 *   - the browser's YouTube ad helper never changes the video's speed any more
 *
 * Run: node tests/p17-youtube-rules.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { withoutYouTubePageScripts, prepareForEngine } = require('../src/services/filterLists');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS: ${name}`); passed++; } catch (err) { console.error(`  ❌ FAIL: ${name}\n         ${err.stack || err.message}`); failed++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'values differ'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const SRC = path.join(__dirname, '..', 'src');

console.log('\n══════════════════════════════════════════════════════');
console.log('  SHMMOTH Browser — YouTube gets only uBlock Origin\'s page scripts');
console.log('══════════════════════════════════════════════════════\n');

const ADGUARD = [
  '! Title: AdGuard Base',
  'www.youtube.com##+js(set-constant, ytcfg.data_.EXPERIMENT_FLAGS.web_streaming_watch, false)',
  'youtubekids.com,youtube-nocookie.com,youtube.com##+js(set-constant, ytInitialPlayerResponse.adPlacements, undefined)',
  'm.youtube.com,example.org##+js(json-prune, playerResponse.adPlacements)',
  'youtube.com,~m.youtube.com##+js(nowoif)',
  'youtube.*##+js(aopr, adBlock)',
  'news.example,~youtube.com##+js(nowoif)',
  'ssyoutube.com##+js(no-window-open-if)',
  'nsfwyoutube.com,example.net##+js(aopr, pops)',
  'www.youtube.com##^script:has-text(adPlacements)',
  'www.youtube.com#@#+js(nowoif)',
  'youtube.com##.ytd-ad-slot-renderer',
  '||youtube.com/api/stats/ads^',
  '##+js(set-constant, generic, 1)'
].join('\n');

console.log('📋 The other lists on YouTube');
test('YouTube-only scriptlet and HTML rules are dropped', () => {
  const out = withoutYouTubePageScripts(ADGUARD).split('\n');
  for (const gone of ['web_streaming_watch', 'ytInitialPlayerResponse.adPlacements', 'youtube.*##', 'has-text(adPlacements)', 'www.youtube.com#@#+js(nowoif)']) {
    assert(!out.some((l) => l.includes(gone)), 'still there: ' + gone);
  }
});

test('the other sites of a rule keep it; a rule left with exceptions only is dropped', () => {
  const out = withoutYouTubePageScripts(ADGUARD).split('\n');
  assert(out.includes('example.org##+js(json-prune, playerResponse.adPlacements)'), 'example.org keeps its rule');
  assert(!out.some((l) => l.startsWith('~m.youtube.com##')), 'left with "~m.youtube.com" only: it would have run on every other site');
});

test('"~youtube.com" stays, and look-alike sites (ssyoutube.com, nsfwyoutube.com) are not YouTube', () => {
  const out = withoutYouTubePageScripts(ADGUARD).split('\n');
  for (const kept of ['news.example,~youtube.com##+js(nowoif)', 'ssyoutube.com##+js(no-window-open-if)', 'nsfwyoutube.com,example.net##+js(aopr, pops)']) {
    assert(out.includes(kept), 'missing: ' + kept);
  }
});

test('element hiding, network rules, generic rules and comments are untouched', () => {
  const out = withoutYouTubePageScripts(ADGUARD).split('\n');
  for (const kept of ['! Title: AdGuard Base', 'youtube.com##.ytd-ad-slot-renderer', '||youtube.com/api/stats/ads^', '##+js(set-constant, generic, 1)']) {
    assert(out.includes(kept), 'missing: ' + kept);
  }
});

test('uBlock\'s own lists go in as they are; a list without YouTube is returned unchanged', () => {
  const ubo = 'www.youtube.com##+js(nano-stb, [native code], 17000, 0.001)\nwww.youtube.com##+js(trusted-rpfr, \'"adSlots"\', \'"no_ads"\', player?)';
  eq(prepareForEngine('ubo-quick-fixes', ubo), ubo);
  eq(prepareForEngine('ubo-filters', ubo), ubo);
  assert(!prepareForEngine('adguard-base', ubo).includes('nano-stb'), 'AdGuard: taken out');
  const plain = 'example.com##+js(nowoif)\n||ads.example^';
  eq(prepareForEngine('easylist', plain), plain);
});

console.log('\n📋 Wiring');
test('the engine is built from the prepared text; format version 3; the ad helper never touches the speed', () => {
  const ab = fs.readFileSync(path.join(SRC, 'services', 'adblocker.js'), 'utf8');
  assert(/usable\.map\(\(l\) => filterLists\.prepareForEngine\(l\.id, l\.text\)\)\.join/.test(ab), 'prepared text');
  assert(/const META_VERSION = 3;/.test(ab), 'the kept engine of 1.5.7 (version 2) is built again');
  const tabs = fs.readFileSync(path.join(SRC, 'browser', 'tabs.js'), 'utf8');
  const helper = tabs.slice(tabs.indexOf('_applyYouTubeOptimizer('), tabs.indexOf('module.exports'));
  assert(!/playbackRate/.test(helper), 'the speed is never touched');
  assert(/video\.muted = true/.test(helper) && /skip\.click\(\)/.test(helper), 'still muted and skipped');
});

console.log(`\n  p17-youtube-rules: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
