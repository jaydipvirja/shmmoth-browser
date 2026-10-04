# Testing

| Command | What it runs | Needs | Time |
|---|---|---|---|
| `npm test` | **Unit tests** (`tests/*.test.js`) — plain Node, Electron is mocked | Node ≥ 22.12 | ~15 s |
| `npm run test:e2e` | **End-to-end tests** (`tests/e2e/*.e2e.js`) — the real app driven through Playwright | a display (Linux: Xvfb, started automatically) | ~30 s |
| `npm run test:e2e:packaged` | E2E suites 01–04, 06–12 against an `electron-builder --dir` build (`app.asar`, `app.isPackaged`, production Electron fuses except `--inspect`, which Playwright needs; the other fuses are verified on the binary first) | as above + a build (~1 min) | ~1.5 min |
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
| `06-adblock` | an ad script from a known ad host is blocked in normal **and incognito** tabs (page still works), counted, lets through when switched off, blocks again when switched on; the shield bubble's *On this site* pause (reload, every tab of the site, other sites stay protected, resume) and its master switch |
| `07-single-instance` | a second launch on the same profile hands its URL to the running window and exits (no second window); command-line URLs open as tabs, only `http(s)` is accepted |
| `08-session-restore` | open tabs written to disk (never incognito), restored after a normal exit and after SIGKILL with order / titles / pinned / selected tab, only the selected tab loads until the others are opened, command-line URL added on top, default setting restores nothing, damaged session file kept aside |
| `09-error-pages` | an unreachable page shows mtc://error (plain explanation + error code) instead of a blank tab; the address bar keeps the failed address with a warning icon; not in history; session saves the failed address; Try again / Reload retry it; ERR_ABORTED (downloads) is not an error; markup in the address is inert; works in incognito |
| `10-quality` | history shows each page under its own title (no stale title from the previous page); opening a downloaded program (.exe …) asks first and Cancel does not start it |
| `11-secure-dns` | what the browser tells Chromium for each DNS choice (stubbed `configureHostResolver`), invalid custom addresses refused without changing anything, the Settings controls, the choice restored after a restart (a live DoH lookup needs the internet and is not asserted) |
| `12-right-click-clipboard` | a page can copy to the clipboard on a click (Copy link / Copy video URL) but not read it; a page with its own right-click menu (YouTube) gets no second native menu; the browser's menu on a video offers Play/Pause, Mute, Loop, Show controls, Picture in picture, Save / Copy address / Open (http(s) sources only) and they act on the video |
| `13-downloads` | a server that gives parts only to the browser's own network stack is still split (and one that needs the Referer, via the direct connection); a server that never gives parts: the card lists what each way of asking got; a server that refuses the Turbo engine's byte-range requests: the card says why ("Normal download: …") and finishes with the standard downloader and the right bytes (no hang, no file of error pages); Retry uses the standard downloader and is not dropped as a duplicate; Cancel stops a running card and leaves no file; download records carry no request headers (cookies); the new-tab page names the real Chromium version; a link that works once keeps the browser's own download (the fast engine is proven first); a 24 MiB file over 1 MiB/s connections arrives over several connections in seconds; Retry sends the page as Referer |
| `14-login-durability` | a cookie set while the app runs is on disk a few seconds later (the process is killed, then the profile is reopened); a renewed cookie value is the stored one; a cookie set right before a normal quit is stored |
| `15-password-autofill` | clicking a user-name / password field on a site with saved logins lists the user names only (no password in the list or the page); picking one fills user name + password with real `input`/`change` events and submits nothing; works on form-less layouts with fields created later, on controlled (React-style) inputs and on a user-name-only first step (no password at step 1); stays out of sign-up (`new-password`) forms, search boxes and other sites; closes on Escape and navigation; a forged request from the page and synthetic clicks are ignored; the page cannot see the machinery; the Settings switch; no "Save password?" for a login that is already saved exactly as typed (a changed password still asks) |
| `16-adblock-engine` | with the lists seeded into the profile (no internet needed): the status says the real engine is in force; a slot a list hides is hidden while its neighbours stay, a blocked script never reaches the server, a uBlock scriptlet rule runs in the page; paused for the site / switched off → nothing hidden, blocked or defused, and it works again when switched on; *My filters* hide an element and removing the line brings it back; a real click on a link or a button still opens a tab, a `window.open()` to an ad address (even after a click) and one out of a timer are refused, and are let through for a paused site or with the switch off; the secure-DNS test returns a verdict; no ad-blocker errors in the log |
| `17-password-reveal` | the native question for *Show* / *Copy* names the user and the site and defaults to Cancel; Cancel shows nothing and nothing reaches the page; a shown password hides itself after 15 s and at once when the list is redrawn; *Copy* puts the password on the clipboard without the page ever receiving it and the clipboard is emptied after 30 s; the browser's toolbar window is refused (no question, no password); a flood of requests is stopped; no password in the log |

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

`.github/workflows/ci.yml`: unit tests + `npm audit --audit-level=high`, E2E on Linux, E2E on Windows, packaged E2E on Windows and a Linux build of the **production** configuration whose Electron fuses are read back with `scripts/check-fuses.js` all run on every push and pull request. Make the five jobs required status checks in the repository's branch protection settings so a red job blocks merging. `.github/workflows/release.yml` is separate: a `vX.Y.Z` tag builds the production installer, smoke-tests it (`scripts/smoke-installer.js`: silent install, fuses, first start) and creates a *draft* release (see `releasing.md`). `.github/dependabot.yml` opens weekly PRs for npm packages (Electron grouped with electron-builder and Playwright) and monthly ones for GitHub Actions.

## Not automated

`tests/google-login-verification.test.js` (talks to live Google), `tests/live-download-smoke.js` (predates the duplicate-download protection and needs updating) and `tests/test-browser-click-download.js` are Electron-run scripts kept for manual use. Manual Windows smoke checks are listed in `docs/upgrading-electron.md`.
