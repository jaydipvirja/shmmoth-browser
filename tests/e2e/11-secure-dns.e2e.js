/**
 * E2E 11 — Secure DNS (DNS-over-HTTPS, AdGuard by default)
 *
 * A live DoH lookup needs the internet and cannot be asserted from a test, so this checks what the browser does with
 * the setting: what it tells Chromium (app.configureHostResolver, stubbed to record), what it saves and restores after a
 * restart, that an invalid address is refused without changing anything, and the Settings controls.
 *
 * Run: npm run test:e2e   (or: node tests/e2e/11-secure-dns.e2e.js)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const {
  runSuite, assert, assertEqual, waitFor,
  launchApp, api, tmpDir, openTab, evalIn
} = require('./helpers');

const ADGUARD = 'https://dns.adguard-dns.com/dns-query';

runSuite('SHMMOTH Browser — E2E 11: secure DNS', async (t) => {
  const userData = tmpDir('shmmoth-e2e-dns-');
  let ctx = await launchApp({ userData });
  const calls = () => ctx.app.evaluate(() => global.__dnsCalls);
  const stub = () => ctx.app.evaluate(({ app }) => {
    global.__dnsCalls = [];
    const original = app.configureHostResolver.bind(app);
    app.configureHostResolver = (options) => { global.__dnsCalls.push(options); return original(options); };
  });
  const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'mtc-data.json'), 'utf8')).settings;

  try {
    t.section('Default');

    await t.test('AdGuard DNS is on by default, in "automatic" mode (falls back to normal DNS if unreachable)', async () => {
      const st = await api(ctx.chrome, 'getSecureDns');
      assertEqual(st.provider, 'adguard');
      assertEqual(st.servers.join(), ADGUARD);
      assertEqual(st.strict, false);
      assertEqual(st.providers.map((p) => p.id).join(), 'system,adguard,adguard-family,adguard-unfiltered,custom');
      if (ctx.log.complete) assert(/Secure DNS configured[^\n]*"provider":"adguard"[^\n]*"mode":"automatic"/.test(ctx.log.text), 'start-up did not configure secure DNS');
    });

    t.section('Changing it');
    await stub();

    await t.test('"System default" switches secure DNS off and is saved', async () => {
      const r = await api(ctx.chrome, 'setSecureDns', { provider: 'system', strict: false });
      assertEqual(r.success, true, JSON.stringify(r));
      assertEqual(r.state.effectiveProvider, 'system');
      const c = await calls();
      assertEqual(c.length, 1);
      assertEqual(c[0].secureDnsMode, 'off');
      assertEqual(saved().secureDnsProvider, 'system');
    });

    await t.test('the family / non-filtering AdGuard flavours use their own official addresses', async () => {
      await api(ctx.chrome, 'setSecureDns', { provider: 'adguard-family' });
      await api(ctx.chrome, 'setSecureDns', { provider: 'adguard-unfiltered' });
      const c = await calls();
      assertEqual(c[c.length - 2].secureDnsServers.join(), 'https://family.adguard-dns.com/dns-query');
      assertEqual(c[c.length - 1].secureDnsServers.join(), 'https://unfiltered.adguard-dns.com/dns-query');
    });

    await t.test('a custom address is validated first: an insecure or malformed one is refused and nothing changes', async () => {
      const before = (await calls()).length;
      const stateBefore = await api(ctx.chrome, 'getSecureDns');
      for (const bad of ['http://dns.example.com/dns-query', 'dns.example.com', 'https://user:pw@dns.example.com/q', '']) {
        const r = await api(ctx.chrome, 'setSecureDns', { provider: 'custom', customUrl: bad });
        assertEqual(r.success, false, `accepted "${bad}"`);
        assert(r.error && r.error.length > 5, 'an explanation is expected');
      }
      assertEqual((await calls()).length, before, 'Chromium must not have been reconfigured');
      assertEqual((await api(ctx.chrome, 'getSecureDns')).provider, stateBefore.provider, 'saved choice must be unchanged');
    });

    await t.test('a valid custom address with "never fall back" configures strict mode', async () => {
      const r = await api(ctx.chrome, 'setSecureDns', { provider: 'custom', customUrl: ' https://dns.example.net/dns-query ', strict: true });
      assertEqual(r.success, true, JSON.stringify(r));
      const c = await calls();
      const last = c[c.length - 1];
      assertEqual(last.secureDnsMode, 'secure');
      assertEqual(last.secureDnsServers.join(), 'https://dns.example.net/dns-query');
      assertEqual(last.enableBuiltInResolver, true);
    });

    t.section('Settings page');

    await t.test('the Network tab shows the choices, reflects the saved state and applies a change', async () => {
      await api(ctx.chrome, 'setSecureDns', { provider: 'adguard', strict: false });
      await openTab(ctx, 'mtc://settings#network', { waitPrefix: 'mtc://settings' });
      const ui = () => evalIn(ctx.app, 'mtc://settings', `(() => ({
        options: Array.from(document.getElementById('select-dns-provider').options).map(o => o.value).join(),
        selected: document.getElementById('select-dns-provider').value,
        customHidden: document.getElementById('dns-custom-row').classList.contains('hidden'),
        status: document.getElementById('dns-status').textContent
      }))()`);
      const first = await waitFor(async () => { const u = await ui(); return u.options ? u : null; }, { message: 'the DNS options to appear' });
      assertEqual(first.options, 'system,adguard,adguard-family,adguard-unfiltered,custom');
      assertEqual(first.selected, 'adguard');
      assertEqual(first.customHidden, true);
      assert(first.status.includes(ADGUARD), first.status);

      await evalIn(ctx.app, 'mtc://settings', '(() => { const s = document.getElementById("select-dns-provider"); s.value = "adguard-family"; s.dispatchEvent(new Event("change")); })()');
      await waitFor(async () => (await api(ctx.chrome, 'getSecureDns')).provider === 'adguard-family', { message: 'the choice to be saved' });

      await evalIn(ctx.app, 'mtc://settings', '(() => { const s = document.getElementById("select-dns-provider"); s.value = "custom"; s.dispatchEvent(new Event("change")); })()');
      assertEqual((await ui()).customHidden, false, 'the address field must appear for "Custom"');
      await evalIn(ctx.app, 'mtc://settings', '(() => { const i = document.getElementById("input-dns-custom"); i.value = "http://not-secure.example/q"; i.dispatchEvent(new Event("change")); })()');
      const refused = await waitFor(async () => { const u = await ui(); return /https/i.test(u.status) ? u : null; }, { message: 'an explanation for the refused address' });
      assertEqual((await api(ctx.chrome, 'getSecureDns')).provider, 'adguard-family', 'a refused address must not replace the saved choice');
      assert(refused.status.length > 10);
    });

    t.section('After a restart');

    await t.test('the choice is restored and applied at start-up', async () => {
      await api(ctx.chrome, 'setSecureDns', { provider: 'custom', customUrl: 'https://dns.example.net/dns-query', strict: true });
      await ctx.close();
      ctx = await launchApp({ userData });
      const st = await api(ctx.chrome, 'getSecureDns');
      assertEqual(st.provider, 'custom');
      assertEqual(st.strict, true);
      assertEqual(st.servers.join(), 'https://dns.example.net/dns-query');
      if (ctx.log.complete) assert(/Secure DNS configured[^\n]*"provider":"custom"[^\n]*"mode":"secure"/.test(ctx.log.text), 'start-up did not apply the saved choice');
    });
  } finally {
    await ctx.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
