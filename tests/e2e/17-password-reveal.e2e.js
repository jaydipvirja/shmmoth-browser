/**
 * E2E 17 — showing or copying a saved password asks first
 *
 * Settings → Passwords used to show the plain password on one click, keep it on screen, and copy it to the clipboard
 * through the page for ever. Real app, native dialog replaced by a stand-in that records the question and answers:
 *   - Cancel: nothing is shown and nothing reaches the page; the question names the user and the site
 *   - Show: the password appears and hides itself again after 15 s, and at once when the window loses focus
 *   - Copy: the password is on the clipboard but the page never receives it; the clipboard is emptied after 30 s
 *     ("unless the user copied something else meanwhile" is covered by tests/p1-password-gate.test.js)
 *   - another internal page (the browser's own toolbar window) cannot ask for a password at all
 *   - a flood of requests is stopped
 *
 * Run: npm run test:e2e   (or: node tests/e2e/17-password-reveal.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, waitForWebContents, evalIn
} = require('./helpers');

const PASSWORD = 'Rev3al-me-Z9!';
const ORIGIN = 'https://example.com';
const USER = 'alice@example.com';

runSuite('SHMMOTH Browser — E2E 17: showing and copying a saved password', async (t) => {
  const ctx = await launchApp({ env: { SHMMOTH_E2E_INSECURE_VAULT: '1' } });
  const { app } = ctx;

  try {
    const saved = await api(ctx.chrome, 'savePassword', { origin: ORIGIN, username: USER, password: PASSWORD });
    assert(saved && saved.success, 'saving a login for the test: ' + JSON.stringify(saved));
    const id = saved.credential.id;

    // a stand-in for the native question: records it, answers with global.__answer (0 = the first button, 1 = Cancel)
    await app.evaluate(({ dialog }) => {
      global.__asked = []; global.__answer = 1;
      dialog.showMessageBox = async (...args) => { global.__asked.push(args[args.length - 1]); return { response: global.__answer }; };
    });
    const answer = (n) => app.evaluate((_, n) => { global.__answer = n; }, n);
    const asked = () => app.evaluate(() => global.__asked);
    const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());

    await api(ctx.chrome, 'createTab', 'mtc://settings#passwords');
    await waitForWebContents(app, 'mtc://settings');
    await waitFor(() => evalIn(app, 'mtc://settings', 'document.querySelectorAll(".password-item-row").length > 0'), { message: 'the saved login in the list' });
    const inPage = (code) => evalIn(app, 'mtc://settings', code);
    const shown = () => inPage('document.querySelector(".password-val-display").dataset.revealed');
    const pageText = () => inPage('document.documentElement.outerHTML');
    let lastAsk = Date.now();
    const click = (sel) => { lastAsk = Date.now(); return inPage(`document.querySelector(${JSON.stringify(sel)}).click()`); };

    t.section('Show');

    await t.test('Cancel: nothing is shown, nothing reached the page, and the question names the user and the site', async () => {
      await answer(1);
      await click('.btn-reveal-pw');
      await waitFor(async () => (await asked()).length === 1, { message: 'the question' });
      await sleep(400);
      assertEqual(await shown(), 'false');
      assert(!(await pageText()).includes(PASSWORD), 'the password is in the page');
      const q = (await asked())[0];
      assert(q.message.includes(USER) && q.message.includes(ORIGIN), q.message);
      assertEqual(q.buttons.join(), 'Show,Cancel'); assertEqual(q.defaultId, 1, 'Cancel must be the default'); assertEqual(q.type, 'question');
    });

    await t.test('leaving the page hides a shown password at once (the window loses focus / the tab is hidden)', async () => {
      await answer(0);
      await click('.btn-reveal-pw');
      await waitFor(async () => (await shown()) === 'true', { message: 'the password to appear' });
      await inPage('window.dispatchEvent(new Event("blur"))');
      assertEqual(await shown(), 'false', 'still shown after the window lost focus');
      assert(!(await pageText()).includes(PASSWORD), 'the password is still in the page');
    });

    await t.test('Show: the password appears, and hides itself again after 15 seconds', async () => {
      await answer(0);
      await click('.btn-reveal-pw');
      await waitFor(async () => (await shown()) === 'true', { message: 'the password to appear' });
      assert((await inPage('document.querySelector(".password-val-display").textContent')) === PASSWORD);
      const t0 = Date.now();
      await waitFor(async () => (await shown()) === 'false', { timeout: 25000, message: 'the password to hide itself' });
      const took = Date.now() - t0;
      assert(took > 10000 && took < 22000, 'hid after ' + took + ' ms');
      assert(!(await pageText()).includes(PASSWORD), 'the password is still in the page after hiding');
    });

    t.section('Copy');

    await t.test('Cancel: the clipboard keeps what it had', async () => {
      await app.evaluate(({ clipboard }) => clipboard.writeText('before'));
      await answer(1);
      const asks = (await asked()).length;
      await click('.btn-copy-pass');
      await waitFor(async () => (await asked()).length === asks + 1, { message: 'the question' });
      await sleep(300);
      assertEqual(await clipboard(), 'before');
      assert(/Copy/.test((await asked())[asks].buttons[0]), 'the button says Copy');
    });

    await t.test('Copy: the password is on the clipboard, the page never received it, and the clipboard is emptied after 30 seconds', async () => {
      await answer(0);
      lastAsk = Date.now();
      const res = await inPage(`window.mtcAPI.copyPassword(${JSON.stringify(id)})`);
      assert(res && res.success === true && res.clearAfterMs === 30000, JSON.stringify(res));
      assert(!JSON.stringify(res).includes(PASSWORD), 'the answer to the page contains the password');
      assertEqual(await clipboard(), PASSWORD);
      assert(!(await pageText()).includes(PASSWORD), 'the password is in the page');
      await waitFor(async () => (await clipboard()) === '', { timeout: 40000, interval: 500, message: 'the clipboard to be emptied' });
    });

    t.section('Who may ask');

    await t.test('the browser\'s own toolbar window (also an internal page) cannot get a password: no question, no password', async () => {
      const before = (await asked()).length;
      const res = await api(ctx.chrome, 'revealPassword', id);
      assert(res && res.success === false && /Settings/.test(res.error) && !JSON.stringify(res).includes(PASSWORD), JSON.stringify(res));
      const res2 = await api(ctx.chrome, 'copyPassword', id);
      assert(res2 && res2.success === false, JSON.stringify(res2));
      assertEqual((await asked()).length, before, 'a question was shown');
    });

    await t.test('a flood of requests is stopped (5 questions in 30 s, then "too many")', async () => {
      await sleep(Math.max(0, 31000 - (Date.now() - lastAsk)));       // the earlier requests leave the 30 s window
      await answer(1);
      const results = [];
      for (let i = 0; i < 7; i++) results.push(await inPage(`window.mtcAPI.revealPassword(${JSON.stringify(id)})`));
      const limited = results.filter((r) => /Too many/.test(r.error || '')).length;
      assertEqual(limited, 2, 'requests refused for rate: ' + JSON.stringify(results.map((r) => r.error || 'ok')));
      assert(results.every((r) => !r.password), 'a password was returned');
    });

    await t.test('no password in the log', async () => {
      assert(!ctx.log.text.includes(PASSWORD), 'the password is in the log');
    });
  } finally {
    await ctx.close();
  }
});
