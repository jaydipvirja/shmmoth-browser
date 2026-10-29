/**
 * E2E 27 — address autofill on web forms, and saving passwords of sites that sign in with a script
 *
 * Until 1.4.7 the profiles of Settings → Autofill (name, email, phone, address …) were saved but never filled into a
 * page, and a password was only offered for saving when a form was really submitted — most sites sign in with a
 * script (a button click, Enter), so their passwords were never saved and could never be filled in later.
 *
 *   - clicking a recognised field lists the saved profiles; nothing reaches the page until one is picked
 *   - picking one fills the empty recognised fields of the form (text, email, phone, textarea, select, PIN code),
 *     leaves search / coupon / filled fields alone, the page sees input/change events, nothing is submitted
 *   - switched off in Settings: no list
 *   - a sign-in by a button with a script (no form submit) offers to save the password
 *   - a two-step sign-in (user name, then password on the next page) offers it with the user name of the first step
 *
 * Run: npm run test:e2e   (or: node tests/e2e/27-form-autofill.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, listWebContents, waitForWebContents, evalIn, startServer
} = require('./helpers');

const PAGES = {
  '/checkout': `<!doctype html><title>checkout</title><body style="margin:20px">
    <input id="search" type="search" placeholder="Search products" style="display:block;width:260px;height:28px;margin-bottom:10px">
    <form id="f" action="/order" method="post">
      <label>Full name <input id="name" name="full_name" style="display:block;width:260px;height:28px;margin-bottom:8px"></label>
      <input id="email" type="email" name="email" style="display:block;width:260px;height:28px;margin-bottom:8px">
      <input id="phone" name="mobile_number" placeholder="Mobile" style="display:block;width:260px;height:28px;margin-bottom:8px">
      <textarea id="address" name="address" style="display:block;width:260px;height:40px;margin-bottom:8px"></textarea>
      <input id="line2" name="address_line2" placeholder="Landmark" style="display:block;width:260px;height:28px;margin-bottom:8px">
      <input id="city" name="city" style="display:block;width:260px;height:28px;margin-bottom:8px">
      <select id="state" name="state" style="display:block;width:260px;height:28px;margin-bottom:8px">
        <option value="">Choose…</option><option value="MH">Maharashtra</option><option value="GJ">Gujarat</option>
      </select>
      <input id="pin" name="pincode" type="number" style="display:block;width:260px;height:28px;margin-bottom:8px">
      <input id="coupon" name="coupon_code" style="display:block;width:260px;height:28px;margin-bottom:8px">
      <button type="submit">Place order</button>
    </form>
    <script>
      window.__events = [];
      ['input', 'change'].forEach(function (n) { document.addEventListener(n, function (e) { window.__events.push(n + ':' + e.target.id); }, true); });
    </script></body>`,

  '/jslogin': `<!doctype html><title>js login</title><body style="margin:20px">
    <div><input id="u" type="email" style="display:block;width:260px;height:28px;margin-bottom:8px">
    <input id="p" type="password" style="display:block;width:260px;height:28px;margin-bottom:8px">
    <button id="eye" type="button" aria-label="Show password">👁</button>
    <button id="go" type="button">Sign in</button></div>
    <script>document.getElementById('go').addEventListener('click', function () { fetch('/api/login', { method: 'POST' }); });</script></body>`,

  '/step1': `<!doctype html><title>step 1</title><body style="margin:20px">
    <div><input id="id" name="identifier" type="email" style="display:block;width:260px;height:28px;margin-bottom:8px">
    <button id="next" type="button">Next</button></div>
    <script>document.getElementById('next').addEventListener('click', function () { setTimeout(function () { location.href = '/step2'; }, 50); });</script></body>`,

  '/step2': `<!doctype html><title>step 2</title><body style="margin:20px">
    <div><input id="p" type="password" style="display:block;width:260px;height:28px;margin-bottom:8px">
    <button id="go" type="button">Next</button></div></body>`
};

runSuite('SHMMOTH Browser — E2E 27: form autofill', async (t) => {
  const posts = [];
  const site = await startServer((req, res) => {
    if (req.method === 'POST') { posts.push(req.url); res.writeHead(200); return res.end('ok'); }
    const page = PAGES[req.url.split('?')[0]];
    res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html' });
    res.end(page || 'not found');
  });

  const ctx = await launchApp({ env: { SHMMOTH_E2E_INSECURE_VAULT: '1' } });
  const { app } = ctx;

  const open = async (p) => {
    await api(ctx.chrome, 'createTab', site.url + p);
    await waitForWebContents(app, site.url + p);
    await sleep(500);
    return site.url + p;
  };
  const clickIn = (url, selector) => app.evaluate(async ({ webContents }, { url, selector }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
    const r = await wc.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    wc.focus();
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  }, { url, selector });
  const typeIn = (url, text) => app.evaluate(({ webContents }, { url, text }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
    for (const ch of text) wc.sendInputEvent({ type: 'char', keyCode: ch });
  }, { url, text });
  const val = (url, id) => evalIn(app, url, `document.getElementById(${JSON.stringify(id)}).value`);

  const bubble = () => app.windows().find((w) => !w.isClosed() && w.url().includes('form-autofill-bubble.html'));
  const waitBubble = async () => {
    const win = await waitFor(() => bubble() || null, { message: 'the list of saved addresses', timeout: 10000 });
    await waitFor(() => win.evaluate(() => document.querySelectorAll('.row').length > 0).catch(() => false), { message: 'entries in the list' });
    return win;
  };
  const expectNoBubble = async (why) => { await sleep(900); assert(!bubble(), 'a list opened, but it should not: ' + why); };
  const passwordBubbleText = async () => {
    const win = app.windows().find((w) => !w.isClosed() && w.url().includes('password-bubble.html'));
    return win ? win.evaluate(() => document.body.textContent).catch(() => null) : null;
  };
  const closePasswordBubble = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => {
    if (w.webContents.getURL().includes('password-bubble.html')) w.close();
  }));

  try {
    const saved = await api(ctx.chrome, 'saveAutofillProfile', {
      name: 'Asha Patel', email: 'asha@example.com', phone: '9876543210', address: '12 Lake Road',
      city: 'Ahmedabad', state: 'Gujarat', country: 'India', postalCode: '380001'
    });
    assert(saved && saved.success !== false, 'saving a profile for the test: ' + JSON.stringify(saved));

    t.section('Filling an address');

    await t.test('clicking a recognised field lists the profile — and nothing has reached the page yet', async () => {
      const url = await open('/checkout');
      await clickIn(url, '#name');
      const win = await waitBubble();
      const rows = await win.evaluate(() => Array.from(document.querySelectorAll('.row')).map((r) => r.textContent.trim()));
      assertEqual(rows.length, 1);
      assert(/Asha Patel/.test(rows[0]), rows[0]);
      assertEqual(await win.evaluate(() => Boolean(document.querySelector('.row .icon svg'))), true, 'icon');
      assertEqual(await val(url, 'email'), '');
    });

    await t.test('picking it fills the form: text, email, phone, textarea, select, PIN; search, coupon and landmark stay empty; nothing is submitted', async () => {
      const url = site.url + '/checkout';
      const win = await waitBubble();
      // clicked after evaluate has answered: picking closes the list's window (else "Target page … has been closed")
      await win.evaluate(() => { const row = document.querySelector('.row'); setTimeout(() => row.click(), 0); });
      await waitFor(async () => (await val(url, 'email')) === 'asha@example.com', { message: 'the form to be filled in' });
      assertEqual(await val(url, 'name'), 'Asha Patel');
      assertEqual(await val(url, 'phone'), '9876543210');
      assertEqual(await val(url, 'address'), '12 Lake Road');
      assertEqual(await val(url, 'city'), 'Ahmedabad');
      assertEqual(await val(url, 'state'), 'GJ', 'the option whose text is the state');
      assertEqual(await val(url, 'pin'), '380001');
      assertEqual(await val(url, 'search'), '', 'search box');
      assertEqual(await val(url, 'coupon'), '', 'coupon');
      assertEqual(await val(url, 'line2'), '', 'second address line');
      const events = await evalIn(app, url, 'window.__events.join(",")');
      assert(/input:email/.test(events) && /change:state/.test(events), events);
      await waitFor(() => !bubble(), { message: 'the list to close' });
      assertEqual(posts.length, 0, 'nothing submitted');
    });

    await t.test('a field that already has text, a search box and a coupon field get no list', async () => {
      const url = site.url + '/checkout';
      await clickIn(url, '#city');
      await expectNoBubble('the field is filled');
      await clickIn(url, '#search');
      await expectNoBubble('a search box');
      await clickIn(url, '#coupon');
      await expectNoBubble('a coupon field');
    });

    await t.test('switched off in Settings → Autofill: no list', async () => {
      await api(ctx.chrome, 'setAutofillEnabled', false);
      const url = await open('/checkout?off');
      await clickIn(url, '#email');
      await expectNoBubble('autofill is off');
      await api(ctx.chrome, 'setAutofillEnabled', true);
    });

    await t.test('a web page cannot see the machinery', async () => {
      const url = await open('/checkout?again');
      assertEqual(await evalIn(app, url, 'typeof window.__shmmothFormFill'), 'undefined');
    });

    t.section('Saving passwords of script sign-ins');

    await t.test('"Show password" does not ask; the Sign in button of a form-less, script sign-in does', async () => {
      const url = await open('/jslogin');
      await clickIn(url, '#u');
      await typeIn(url, 'ravi@example.com');
      await clickIn(url, '#p');
      await typeIn(url, 'secret-1');
      await clickIn(url, '#eye');
      await sleep(1200);
      assertEqual(await passwordBubbleText(), null, 'no save prompt for the eye button');
      await clickIn(url, '#go');
      const text = await waitFor(passwordBubbleText, { message: 'the save prompt', timeout: 10000 });
      assert(/ravi@example\.com/.test(await waitFor(async () => { const x = await passwordBubbleText(); return x && /@/.test(x) ? x : null; }, { message: 'the user name in the prompt' })), text);
      await closePasswordBubble();
    });

    await t.test('a two-step sign-in offers the password with the user name of the first step', async () => {
      const url1 = await open('/step1');
      await clickIn(url1, '#id');
      await typeIn(url1, 'meera@example.com');
      await clickIn(url1, '#next');
      const url2 = site.url + '/step2';
      await waitFor(async () => (await listWebContents(app)).some((w) => w.url.startsWith(url2) && !w.loading), { message: 'the second step' });
      await sleep(500);
      await clickIn(url2, '#p');
      await typeIn(url2, 'meera-pass');
      await clickIn(url2, '#go');
      const text = await waitFor(async () => { const x = await passwordBubbleText(); return x && /@/.test(x) ? x : null; }, { message: 'the save prompt with the user name', timeout: 10000 });
      assert(/meera@example\.com/.test(text), text);
      await closePasswordBubble();
    });

    await t.test('no errors from these features in the log', async () => {
      assert(!/Form autofill (failed|could not attach)/.test(ctx.log.text), (ctx.log.text.match(/Form autofill[^\n]*/) || [''])[0]);
    });
  } finally {
    await ctx.close();
    await site.close();
  }
});
