/**
 * E2E 15 — saved logins are offered on sign-in pages and filled in after the user picks one
 *
 * The browser could save passwords but never filled them back in. Real app, real pages:
 *   - clicking a user-name / password field on a site with a saved login opens a small list of user names,
 *   - nothing reaches the page until an entry is clicked, and then only that one login, and nothing is submitted,
 *   - it works on forms, on form-less single-page layouts, on fields created later, on "controlled" inputs,
 *     on a user-name-only first step,
 *   - it stays out of sign-up forms, search boxes, other sites, and when switched off,
 *   - a page cannot fake the request, and cannot see the machinery,
 *   - signing in with a login that is already saved does not ask to save it again (a changed password still does).
 *
 * The test vault key is only honoured by an unpackaged run (SHMMOTH_E2E_INSECURE_VAULT); the packaged build on
 * Windows uses the real OS encryption (DPAPI).
 *
 * Run: npm run test:e2e   (or: node tests/e2e/15-password-autofill.e2e.js)
 */

'use strict';

const {
  runSuite, assert, assertEqual, waitFor, sleep,
  launchApp, api, listWebContents, waitForWebContents, evalIn, startServer
} = require('./helpers');

const PASSWORD = 'Pa55-w0rd-Z9';

const PAGES = {
  '/login': `<!doctype html><title>login</title><body style="margin:20px">
    <form id="f" method="post" action="/signed-in">
      <input id="u" name="username" autocomplete="username" style="display:block;width:260px;height:30px;margin-bottom:12px">
      <input id="p" name="password" type="password" autocomplete="current-password" style="display:block;width:260px;height:30px;margin-bottom:12px">
      <button id="go" type="submit">Sign in</button>
    </form>
    <script>
      window.__events = [];
      ['input', 'change'].forEach(function (n) { document.addEventListener(n, function (e) { window.__events.push(n + ':' + e.target.id); }, true); });
    </script></body>`,

  '/spa': `<!doctype html><title>spa</title><body style="margin:20px"><div id="root"></div>
    <script>
      // no <form>, and the fields only appear a moment after the page loaded
      setTimeout(function () {
        document.getElementById('root').innerHTML =
          '<div><input id="u" type="email" style="display:block;width:260px;height:30px;margin-bottom:12px">' +
          '<input id="p" type="password" style="display:block;width:260px;height:30px"></div>';
      }, 300);
    </script></body>`,

  '/controlled': `<!doctype html><title>controlled</title><body style="margin:20px">
    <form><input id="u" name="email" autocomplete="username" style="display:block;width:260px;height:30px;margin-bottom:12px">
    <input id="p" type="password" style="display:block;width:260px;height:30px"></form>
    <script>
      // like React: remember the last value set through the page's own setter and only accept an input event when the
      // value really differs from it
      window.__changes = [];
      Array.prototype.forEach.call(document.querySelectorAll('input'), function (el) {
        var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
        var current = '';
        Object.defineProperty(el, 'value', { configurable: true, get: function () { return d.get.call(this); }, set: function (v) { current = '' + v; d.set.call(this, v); } });
        el.addEventListener('input', function () { var now = d.get.call(el); if (now !== current) { current = now; window.__changes.push(el.id + '=' + now); } });
      });
    </script></body>`,

  '/step1': `<!doctype html><title>step 1</title><body style="margin:20px">
    <input id="u" type="email" autocomplete="username" style="display:block;width:260px;height:30px"></body>`,

  '/signup': `<!doctype html><title>sign up</title><body style="margin:20px"><form>
    <input id="u" name="email" style="display:block;width:260px;height:30px;margin-bottom:12px">
    <input id="p" type="password" autocomplete="new-password" style="display:block;width:260px;height:30px"></form></body>`,

  '/search': `<!doctype html><title>search</title><body style="margin:20px"><input id="q" type="text" placeholder="Search" style="width:260px;height:30px"></body>`,

  '/signed-in': `<!doctype html><title>signed in</title><body>welcome</body>`,
};

runSuite('SHMMOTH Browser — E2E 15: saved logins on sign-in pages', async (t) => {
  const posts = [];
  const handler = (req, res) => {
    if (req.method === 'POST') { posts.push(req.url); }
    const path = req.url.split('?')[0];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(PAGES[path] || '<!doctype html><title>nothing</title>');
    if (req.method === 'POST') req.resume();
  };
  const site = await startServer(handler);
  const otherSite = await startServer(handler);   // another origin (other port): nothing is saved for it

  const ctx = await launchApp({ env: { SHMMOTH_E2E_INSECURE_VAULT: '1' } });
  const { app } = ctx;

  const open = async (base, p) => {
    await api(ctx.chrome, 'createTab', base.url + p);
    await waitForWebContents(app, base.url + p);
    await sleep(500);                      // dom-ready work (the detection script) settles
    return base.url + p;
  };
  const clickIn = (url, selector) => app.evaluate(async ({ webContents }, { url, selector }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
    const r = await wc.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    wc.focus();
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  }, { url, selector });
  const keyIn = (url, keyCode) => app.evaluate(({ webContents }, { url, keyCode }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
  }, { url, keyCode });
  const val = (url, id) => evalIn(app, url, `document.getElementById(${JSON.stringify(id)}).value`);

  const bubble = () => app.windows().find((w) => !w.isClosed() && w.url().includes('autofill-bubble.html'));
  const waitBubble = async () => {
    const win = await waitFor(() => bubble() || null, { message: 'the list of saved logins', timeout: 10000 });
    await waitFor(() => win.evaluate(() => document.querySelectorAll('.row').length > 0).catch(() => false), { message: 'entries in the list' });
    return win;
  };
  const expectNoBubble = async (why) => { await sleep(900); assert(!bubble(), 'a list opened, but it should not: ' + why); };
  const entries = (win) => win.evaluate(() => Array.from(document.querySelectorAll('.row')).map((r) => r.textContent.replace('🔑', '').trim()));
  const pick = (win, name) => win.evaluate((name) => {
    const row = Array.from(document.querySelectorAll('.row')).find((r) => r.textContent.includes(name));
    row.click();
  }, name);
  const passwordBubbleOpen = async () => (await listWebContents(app)).some((w) => w.url.includes('password-bubble.html'));
  const closePasswordBubble = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => {
    if (w.webContents.getURL().includes('password-bubble.html')) w.close();
  }));

  try {
    // two logins for the site; none for the other one
    for (const [username, password] of [['alice@example.com', PASSWORD], ['bob', 'bob-pass-1']]) {
      const res = await api(ctx.chrome, 'savePassword', { origin: site.url, username, password });
      assert(res && res.success, 'saving a login for the test: ' + JSON.stringify(res));
    }

    t.section('Choosing a saved login');

    await t.test('clicking the user-name field lists the saved user names — and no password has reached the page', async () => {
      const url = await open(site, '/login');
      await clickIn(url, '#u');
      const win = await waitBubble();
      assertEqual((await entries(win)).sort().join(','), 'alice@example.com,bob');
      const html = await win.evaluate(() => document.documentElement.outerHTML);
      assert(!html.includes(PASSWORD) && !html.includes('bob-pass-1'), 'the list must not contain passwords');
      assertEqual(await val(url, 'u'), '');
      assertEqual(await val(url, 'p'), '');
    });

    await t.test('the list sits right under the field the user clicked', async () => {
      const url = site.url + '/login';
      const m = await app.evaluate(async ({ BrowserWindow, webContents }, url) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
        const bubble = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('autofill-bubble.html'));
        const owner = BrowserWindow.fromWebContents(wc);
        const page = await wc.executeJavaScript('({ r: document.getElementById("u").getBoundingClientRect().toJSON(), iw: innerWidth, ih: innerHeight })');
        return { bubble: bubble.getBounds(), content: owner.getContentBounds(), focusable: bubble.isFocusable(), ...page };
      }, url);
      const edge = (m.content.width - m.iw) / 2;                      // the page view leaves the same margin left, right and bottom
      const viewTop = m.content.height - m.ih - edge;
      const near = (a, b, what) => assert(Math.abs(a - b) <= 3, `${what}: ${a} is not near ${b}`);
      near(m.bubble.x, m.content.x + edge + m.r.left, 'left edge of the list vs the field');
      near(m.bubble.y, m.content.y + viewTop + m.r.bottom + 2, 'top of the list vs the bottom of the field');
      assert(m.bubble.width >= 260 && m.bubble.x + m.bubble.width <= m.content.x + m.content.width, 'inside the window');
      assertEqual(m.focusable, false, 'the list must not take the keyboard from the page');
    });

    await t.test('picking an entry fills user name and password, the page sees real input/change events, and nothing is submitted', async () => {
      const url = site.url + '/login';
      const win = await waitBubble();
      await pick(win, 'alice@example.com');
      await waitFor(async () => (await val(url, 'p')) === PASSWORD, { message: 'the password to be filled in' });
      assertEqual(await val(url, 'u'), 'alice@example.com');
      const events = await evalIn(app, url, 'window.__events.join(",")');
      assert(/input:u/.test(events) && /change:u/.test(events) && /input:p/.test(events) && /change:p/.test(events), 'events: ' + events);
      await waitFor(() => !bubble(), { message: 'the list to close after the choice' });
      await sleep(500);
      assertEqual(posts.length, 0, 'the form must not be submitted for the user');
    });

    await t.test('clicking the password field lists them as well, and picking the other login replaces what was there', async () => {
      const url = site.url + '/login';
      await evalIn(app, url, 'document.getElementById("p").value = ""; document.getElementById("u").value = ""');
      await clickIn(url, '#p');
      const win = await waitBubble();
      await pick(win, 'bob');
      await waitFor(async () => (await val(url, 'p')) === 'bob-pass-1', { message: 'the second login to be filled in' });
      assertEqual(await val(url, 'u'), 'bob');
    });

    await t.test('a field that already holds text gets no list on top of it', async () => {
      const url = site.url + '/login';
      await clickIn(url, '#u');         // holds "bob"
      await expectNoBubble('the user-name field is not empty');
    });

    t.section('Different kinds of pages');

    await t.test('a form-less layout whose fields are created after the page loaded', async () => {
      const url = await open(site, '/spa');
      await sleep(500);
      await clickIn(url, '#u');
      const win = await waitBubble();
      await pick(win, 'alice@example.com');
      await waitFor(async () => (await val(url, 'p')) === PASSWORD, { message: 'filled in' });
      assertEqual(await val(url, 'u'), 'alice@example.com');
    });

    await t.test('a controlled input (React-style) notices the change', async () => {
      const url = await open(site, '/controlled');
      await clickIn(url, '#u');
      const win = await waitBubble();
      await pick(win, 'alice@example.com');
      await waitFor(async () => (await evalIn(app, url, 'window.__changes.length')) >= 2, { message: 'the page to see both changes' });
      const changes = await evalIn(app, url, 'window.__changes.join("|")');
      assert(changes.includes('u=alice@example.com') && changes.includes('p=' + PASSWORD), changes);
    });

    await t.test('a user-name-only first step fills just the user name and does not hand over a password', async () => {
      const url = await open(site, '/step1');
      await clickIn(url, '#u');
      const win = await waitBubble();
      await pick(win, 'alice@example.com');
      await waitFor(async () => (await val(url, 'u')) === 'alice@example.com', { message: 'user name filled in' });
      const everything = await evalIn(app, url, 'document.documentElement.outerHTML + Array.from(document.querySelectorAll("input")).map(i => i.value).join()');
      assert(!everything.includes(PASSWORD), 'the password must not be in the page at the first step');
    });

    t.section('Where it stays out');

    await t.test('not on a sign-up form (new-password), not on a search box', async () => {
      let url = await open(site, '/signup');
      await clickIn(url, '#u');
      await expectNoBubble('sign-up form, e-mail field');
      await clickIn(url, '#p');
      await expectNoBubble('sign-up form, new-password field');
      url = await open(site, '/search');
      await clickIn(url, '#q');
      await expectNoBubble('search box');
    });

    await t.test('not on another site (the login belongs to one site only)', async () => {
      const url = await open(otherSite, '/login');
      await clickIn(url, '#u');
      await expectNoBubble('nothing is saved for this origin');
    });

    await t.test('the list closes on Escape and when navigating away', async () => {
      const url = await open(site, '/login');
      await clickIn(url, '#u');
      await waitBubble();
      await keyIn(url, 'Escape');
      await waitFor(() => !bubble(), { message: 'Escape to close the list' });

      await clickIn(url, '#u');
      await waitBubble();
      await evalIn(app, url, 'location.href = "/signed-in"');
      await waitFor(() => !bubble(), { message: 'navigation to close the list' });
    });

    t.section('Safety');

    await t.test('a web page cannot fake the request, cannot see the machinery, and cannot reach the list\'s API', async () => {
      const url = await open(site, '/login');
      await evalIn(app, url, `console.log('__SHMMOTH_PWFILL__:' + '0'.repeat(24) + ':' + JSON.stringify({ t: 'show', l: 20, tp: 20, w: 200, h: 30 })); 1`);
      await expectNoBubble('forged message');
      assertEqual(await evalIn(app, url, 'typeof window.__shmmothPwFill'), 'undefined');
      assertEqual(await evalIn(app, url, 'typeof window.mtcAPI + "," + typeof window.shmmothAPI'), 'undefined,undefined');
    });

    await t.test('a page script that only dispatches a fake click gets no list (only real user input counts)', async () => {
      const url = site.url + '/login';
      await evalIn(app, url, 'document.getElementById("u").dispatchEvent(new MouseEvent("click", { bubbles: true })); document.getElementById("u").dispatchEvent(new FocusEvent("focusin", { bubbles: true })); 1');
      await expectNoBubble('synthetic events');
    });

    await t.test('switching it off in Settings stops the list', async () => {
      await api(ctx.chrome, 'updateSettings', { passwordAutofillEnabled: false });
      const url = await open(site, '/login');
      await clickIn(url, '#u');
      await expectNoBubble('switched off');
      await api(ctx.chrome, 'updateSettings', { passwordAutofillEnabled: true });
      const again = await open(site, '/login');
      await clickIn(again, '#u');
      await waitBubble();                 // and it is back on
      await keyIn(again, 'Escape');
    });

    t.section('Saving after signing in');

    await t.test('signing in with a changed password still asks to save it', async () => {
      const url = await open(site, '/login');
      await evalIn(app, url, 'document.getElementById("u").value = "alice@example.com"; document.getElementById("p").value = "a-new-password"; document.getElementById("f").requestSubmit()', { gesture: true });
      await waitFor(passwordBubbleOpen, { message: 'the save prompt for a changed password', timeout: 10000 });
      await closePasswordBubble();
      await sleep(300);
    });

    await t.test('signing in with the login that is saved, as filled in, does not ask again', async () => {
      const url = await open(site, '/login');
      await evalIn(app, url, 'document.getElementById("u").value = "bob"; document.getElementById("p").value = "bob-pass-1"; document.getElementById("f").requestSubmit()', { gesture: true });
      await sleep(1500);
      assert(!(await passwordBubbleOpen()), 'no "Save password?" for a login that is already saved exactly like this');
    });

    await t.test('no deprecation warnings or errors from this feature in the log', async () => {
      const text = ctx.log.text;
      assert(!/Password autofill (failed|could not attach)/.test(text), (text.match(/Password autofill[^\n]*/) || [''])[0]);
      assertEqual((text.match(/\(electron\)[^\n]*/g) || []).join(' | '), '');
    });
  } finally {
    await ctx.close();
    await site.close();
    await otherSite.close();
  }
});
