/**
 * E2E 14 — a login must survive the app being ended
 *
 * Chromium writes cookies to disk in batches (about every 30 s). When the browser is ended the hard way — the update
 * installer closes it, Task Manager, a crash, a power cut — whatever was in the last batch is gone. Google rotates its
 * session cookies every few minutes and refuses the old ones, so a lost batch means "signed out" after the restart.
 * The browser therefore writes cookie changes to disk by itself (a moment after they happen) and once more before
 * it quits.
 *
 *   - a cookie set while the app runs is on disk a few seconds later (checked by killing the process)
 *   - a cookie set right before a normal quit is on disk too
 *
 * Run: npm run test:e2e   (or: node tests/e2e/14-login-durability.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, tmpDir
} = require('./helpers');

const COOKIE = (name) => ({
  url: 'https://accounts.example.test/', name, value: 'v-' + name, secure: true, httpOnly: true, sameSite: 'no_restriction',
  expirationDate: Math.floor(Date.now() / 1000) + 86400 * 30
});

const setCookie = (app, cookie) => app.evaluate(({ session }, c) => session.defaultSession.cookies.set(c).then(() => 'ok', (e) => String(e)), cookie);
const getCookies = (app, name) => app.evaluate(({ session }, n) => session.defaultSession.cookies.get({ name: n }).then((l) => l.map((c) => c.value)), name);

runSuite('SHMMOTH Browser — E2E 14: logins survive the app being ended', async (t) => {
  t.section('Hard end (installer, Task Manager, crash)');

  await t.test('a cookie set while the app runs is on disk a few seconds later: it is still there after the process is killed', async () => {
    const ud = tmpDir('shmmoth-e2e-login-');
    const first = await launchApp({ userData: ud });
    assertEqual(await setCookie(first.app, COOKIE('rotating')), 'ok');
    await sleep(6000);                                           // far less than Chromium's own 30 s batch
    first.app.process().kill('SIGKILL');
    await sleep(1500);
    const again = await launchApp({ userData: ud });
    try {
      assertEqual(JSON.stringify(await getCookies(again.app, 'rotating')), JSON.stringify(['v-rotating']));
    } finally { await again.close(); }
  });

  await t.test('a cookie that is renewed (new value, same name) is renewed on disk as well', async () => {
    const ud = tmpDir('shmmoth-e2e-login-');
    const first = await launchApp({ userData: ud });
    await setCookie(first.app, COOKIE('rotating'));
    await sleep(3500);
    await setCookie(first.app, { ...COOKIE('rotating'), value: 'second' });
    await sleep(6000);
    first.app.process().kill('SIGKILL');
    await sleep(1500);
    const again = await launchApp({ userData: ud });
    try {
      assertEqual(JSON.stringify(await getCookies(again.app, 'rotating')), JSON.stringify(['second']), 'the newest value must have been stored');
    } finally { await again.close(); }
  });

  t.section('Normal end');

  await t.test('a cookie set right before a normal quit is on disk', async () => {
    const ud = tmpDir('shmmoth-e2e-login-');
    const first = await launchApp({ userData: ud });
    await setCookie(first.app, COOKIE('lastminute'));
    await first.close();                                         // app.close() = a normal quit
    const again = await launchApp({ userData: ud });
    try {
      assertEqual(JSON.stringify(await getCookies(again.app, 'lastminute')), JSON.stringify(['v-lastminute']));
    } finally { await again.close(); }
  });
});
