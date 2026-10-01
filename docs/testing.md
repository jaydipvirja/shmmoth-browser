# Testing

| Command | What it runs | Needs | Time |
|---|---|---|---|
| `npm test` | **Unit tests** (`tests/*.test.js`) — plain Node, Electron is mocked | Node ≥ 22.12 | ~15 s |
| `npm run test:e2e` | **End-to-end tests** (`tests/e2e/*.e2e.js`) — the real app driven through Playwright | a display (Linux: Xvfb, started automatically) | ~30 s |
| `npm run test:e2e:packaged` | E2E suites 01–04 and 06–08 against an `electron-builder --dir` build (`app.asar`, `app.isPackaged`, production Electron fuses except `--inspect`, which Playwright needs; the other fuses are verified on the binary first) | as above + a build (~1 min) | ~1.5 min |
| `npm run test:all` | unit + E2E | | |

Useful options (after `--`): `--grep=<text>` (file name filter), `--list`, `--no-build` (reuse `dist/`). Set `APP_EXE=<path>` to test any other build. In containers/CI as root, or where user namespaces are restricted, set `E2E_NO_SANDBOX=1` (done automatically for root).

## What the E2E suites cover

| Suite | Scenarios |
|---|---|
| `01-boot-ui` | boot, every internal page, no CSP violations, bundled fonts / no Google requests, bubbles, side panel, incognito window, update-UI states, installing an unpacked MV3 extension + its popup + removal, no Electron deprecation warnings |
| `02-security` | stored XSS through page titles, `mtc://` / `file://` isolation, inline-handler CSP, sandbox + context isolation on every web contents, page environment (no `require`/`process`), UA / Client Hints, login capture |
| `03-network-privacy` | Turbo download, manual proxy for normal **and incognito** tabs and downloads, WebRTC leak guard, proxy reset |
| `04-persistence` | crash-damaged data file restored from `.bak`, damaged file preserved, settings survive restart, stale registry entry of the retired bundled uBlock Origin dropped, vault never stores a weak-key password |
| `05-updater` | real `UpdateManager` + Electron `net` against a fake GitHub: only correctly signed releases install, malware / attacker key / bad redirect rejected, proxy honoured |
| `06-adblock` | an ad script from a known ad host is blocked in normal **and incognito** tabs (page still works), counted, lets through when switched off, blocks again when switched on |
| `07-single-instance` | a second launch on the same profile hands its URL to the running window and exits (no second window); command-line URLs open as tabs, only `http(s)` is accepted |
| `08-session-restore` | open tabs written to disk (never incognito), restored after a normal exit and after SIGKILL with order / titles / pinned / selected tab, only the selected tab loads until the others are opened, command-line URL added on top, default setting restores nothing, damaged session file kept aside |

The suites replay the actual attacks and failures that were fixed (they fail on the original code: 24 failures across suites 01–04), so a regression shows up as a red test, not as a user report.

## Writing an E2E test

```js
const { runSuite, assert, assertEqual, launchApp, api, openTab, evalIn } = require('./helpers');

runSuite('My feature', async (t) => {
  const ctx = await launchApp();                       // real app, fresh profile; ctx.chrome = browser window page
  try {
    await t.test('does the thing', async () => {
      await openTab(ctx, 'mtc://settings');            // waits until loaded
      assertEqual(await evalIn(ctx.app, 'mtc://settings', 'typeof window.mtcAPI'), 'object');
    });
  } finally { await ctx.close(); }
});
```

`ctx.app.evaluate(({ webContents, session, app }) => …)` runs in the **main process**; `ctx.log.text` is everything the app printed (complete from the first byte for unpackaged runs); `launchApp({ userData })` re-uses a profile to simulate a restart; `launchApp({ env: NO_SYSTEM_PROXY_ENV })` strips inherited proxy variables.

## CI

`.github/workflows/ci.yml`: unit tests + `npm audit --audit-level=high`, E2E on Linux, E2E on Windows, packaged E2E on Windows and a Linux build of the **production** configuration whose Electron fuses are read back with `scripts/check-fuses.js` all run on every push and pull request. Make the five jobs required status checks in the repository's branch protection settings so a red job blocks merging. `.github/dependabot.yml` opens weekly PRs for npm packages (Electron grouped with electron-builder and Playwright) and monthly ones for GitHub Actions.

## Not automated

`tests/google-login-verification.test.js` (talks to live Google), `tests/live-download-smoke.js` (predates the duplicate-download protection and needs updating) and `tests/test-browser-click-download.js` are Electron-run scripts kept for manual use. Manual Windows smoke checks are listed in `docs/upgrading-electron.md`.
