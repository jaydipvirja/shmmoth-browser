# CHANGELOG

## 1.1.14

### YouTube — play / pause and right-click work again
- **Pause stays paused, play plays.** The browser's own YouTube ad script was the cause: every 100 ms it pressed *play* again whenever YouTube's "ad blockers are not allowed" notice was anywhere in the page (even hidden), so a video started by itself and could not be paused. It also muted the video, set it to 16x and jumped to its end whenever an ad element was left over in the player — also during the real video — clicked every "Dismiss" button of the page, and hid the anti-adblock notice but not the dark layer behind it, which then swallowed every click on the player. That script is replaced: it now only acts while YouTube itself marks an ad as playing (mutes it, speeds it up, presses its *Skip* button) and puts sound and speed back afterwards. It never presses play or pause, never jumps in the video and never touches the page's dialogs.
- **uBlock's YouTube rules now run before YouTube's own scripts**, the only moment they work (they remove the ad data before the player reads it). Before, they ran some time after the page had started, when the player had already seen the ads and the anti-adblock check had already run, and the half-applied patches could leave the player broken. This applies to every site with such rules, in every frame.
- **Right-click on YouTube works like in Chrome.** On the video, the first right-click opens YouTube's own menu (Loop, Copy video URL, …) and a second right-click opens the browser's menu — exactly one, never on top of YouTube's. 1.1.12/1.1.13 opened the browser's menu from three places at once (the page, a message from the page, a timer), which gave two menus or a menu over YouTube's own.
- **New: Shift + right-click always opens the browser's menu**, on any site, also on players and web apps that replace it with their own (as in Firefox).
- In the browser's video menu, **Play / Pause / Mute on YouTube go through YouTube's player**, so its buttons show the right state. The menu never waits more than a quarter of a second for the page, so a busy page can no longer keep it from opening, and a fast second right-click never produces a second menu.
- If YouTube still shows its anti-adblock notice: update the lists (Settings → Ad-Blocker & Privacy → *Update now*), or pause the blocker for youtube.com with the shield button.

## 1.1.13

### Fixes
- **YouTube right-click fallback hardened.** A native Electron mouse-event fallback now catches real YouTube right-clicks when both the page context-menu and preload path are suppressed, without interfering with YouTube's normal page menu unless the video target is confirmed.
- **Google sign-in networking hardened.** The full ad blocker now bypasses the Google authentication document and only the supporting Google/Gstatic/Googleusercontent/Google APIs/reCAPTCHA resources needed by an active sign-in flow; ordinary Google pages remain blocked normally.
- **Google login durability retained.** The existing immediate Google/YouTube cookie flush and Google navigation persistence remain enabled in this release.


## 1.1.12

### Fixes
- **YouTube video right-click is now intercepted at the trusted user-input layer.** When YouTube suppresses the page context-menu event, SHMMOTH captures a real right-click inside the video and routes it into the same native media menu used elsewhere.
- **Google session persistence is stronger.** All Google/YouTube cookie changes are treated as authentication-related and flushed immediately, so newly issued session cookies are not left waiting for a delayed batch write.

## 1.1.11

### Fixes
- **Startup crash fix:** Restored missing `logLoginHealth` method declaration in `src/main.js` that caused packaged app startup failure, and added automated syntax verification for all core scripts in the release test suite.
- **Google login stays signed in more reliably:** Google authentication now uses one stable desktop Chrome identity instead of switching between Android and Windows identities. Fresh Google sign-in cookies are flushed immediately, and Google navigation boundaries trigger an additional persistence flush.
- **YouTube/video right-click is more reliable when player controls cover the video:** The browser now performs a media hit-test whenever Chromium does not identify the target as video/audio, without restricting the fallback to a specific host.
- Added regression coverage for immediate Google-cookie persistence and video-player overlay right-clicks.

## 1.1.10

### Fixes
- **Google login stays signed in more reliably.** Google authentication now uses one stable desktop Chrome identity instead of switching between Android and Windows identities. Fresh Google sign-in cookies are flushed immediately, and Google navigation boundaries trigger an additional persistence flush.
- **YouTube/video right-click is more reliable when player controls cover the video.** The browser now performs a media hit-test whenever Chromium does not identify the target as video/audio, without restricting the fallback to a specific host.
- Added regression coverage for immediate Google-cookie persistence and video-player overlay right-clicks.

# Changelog

## 1.1.9

### Fixes
- **YouTube video right-click is more reliable across PCs.** When Chromium does not report the underlying video because YouTube's player overlay is on top of it, SHMMOTH now hit-tests the page to find the actual `<video>`/`<audio>` element and builds the video context menu from that fallback data.
- Existing Chromium media metadata is still used when available, while Save / Copy address / Open actions use the detected media source when necessary.
- Context-menu frame/source metadata is preserved when opening the native browser menu.

## 1.1.8

### Passwords — a saved password no longer comes out on a single click
- **Showing a password (👁️) or copying it (📋 Pass) first asks in a window of the browser itself** ("Show the saved password for “alice” on https://example.com?"), outside any web page, with *Cancel* as the default. Before, one click showed it — to anyone at the keyboard, and to any script that might ever run in an internal page.
- **A shown password hides itself after 15 seconds**, when you leave or switch away from the Settings page, and when the list is redrawn. It is no longer kept in the page in between.
- **Copy never passes the password through the page.** It goes from the vault straight to the clipboard, and the browser **empties the clipboard after 30 seconds** (only if it still holds that password — something you copied meanwhile stays) and when the browser quits. Before, the page wrote it to the clipboard and it stayed there for ever.
- **Only Settings can ask**; the browser's toolbar window or any other internal page gets a refusal. At most 5 requests per 30 seconds and one question at a time, so nothing can bury the screen in dialogs or try passwords one after another. User names that come from web pages are shown as plain one-line text in the question.
- Honest limit: this is a confirmation, not a login — anyone who can press *Show* on your unlocked browser can still see the passwords. Asking for the Windows PIN / Windows Hello needs a native component and is planned.

## 1.1.7

Includes everything from 1.1.6 below (1.1.6 itself was never published).

### Ad blocker — it now does what a real blocker does
- **Empty ad slots, banners and overlays are hidden.** Until now only the *requests* of ads were cancelled; the boxes they were meant for stayed on the page, and the scripts that open pop-ups or show "please turn off your ad blocker" walls ran untouched. Element hiding and uBlock Origin's page scripts (the same ones uBlock Origin runs) are now switched on, for the normal and the private window. Pausing the blocker for a site (shield button) switches them off there too, and the browser's own pages are never touched.
- **More and better lists:** EasyList, EasyPrivacy, uBlock Origin's lists, Peter Lowe's list and now **AdGuard Base and AdGuard Popups**. Every list has several addresses (GitHub, the jsDelivr CDN, the list's own server), so a network that blocks one of them no longer leaves the browser with the short emergency list. A downloaded file is only accepted if it really is a filter list (a Wi-Fi login page is not). The lists are kept on disk, so a start-up without internet still has the full protection; the compiled engine is reused instead of rebuilt (230 ms instead of 2 s), lists are refreshed in the background every day, and a browser that stays open for days keeps itself current.
- **Pop-ups and pop-unders are refused before a tab exists.** Every `window.open()` used to open a new tab, whoever asked. Now it is refused when the address is an ad address on the lists, when a background tab opens it, when you did not click or press a key in the last 5 seconds, or when one tab opens more than 3 at once. Links you click yourself open as before; Google sign-in windows are never affected. Settings → Ad-Blocker & Privacy → "Block pop-ups and pop-unders" switches it off.
- **Settings → Ad-Blocker & Privacy shows what is really loaded** ("Working: 144,654 blocking rules and 86,663 element-hiding rules from 16 of 16 lists", which list failed, when it was checked) and has **Update now**.
- **My filters:** your own rules (`example.com##.banner` hides an element, `||ads.example.net^` blocks an address), applied at once.

### AdGuard DNS
- **Settings → Secure DNS → "Test secure DNS"** asks the browser's own resolver for an ad domain that every AdGuard list blocks, once through secure DNS and once through the system DNS, and says plainly whether AdGuard DNS is really in use, was quietly replaced by the network's DNS (automatic mode), is bypassed by a proxy, or the network blocks it. DNS can only stop ads that come from their own server names; ads served from the page's own address are the ad blocker's job — which the points above improve.

## 1.1.6

### Passwords — saved logins are now filled in
- **The browser saved passwords but never put them back into a sign-in page — that is now done.** On a site you have a saved login for, clicking the user-name or password field shows a small list of the saved user names under the field. Pick one and the user name and password are filled in. (The "Autofill" tab in Settings is for addresses and contact details; this is separate.)
- **Safe by design.** The page gets nothing until you pick an entry — it cannot see that a login is saved, and the list shows user names only. Only the one login you pick is read, and only for the exact site it was saved for (https, or localhost while developing); if the tab has moved to another address in the meantime nothing is filled. Nothing is submitted for you. Sign-up and "new password" fields, search boxes, other sites, frames inside a page and private windows are left alone.
- Works on normal forms, on pages without a `<form>`, on fields that appear later, on sign-in forms built with React-style frameworks, and on user-name-only first steps (only the user name is filled there; the password is never sent to the page before its own step).
- **Settings → Passwords → "Offer saved logins on sign-in pages"** switches it off.
- Signing in with a login that is already saved exactly as typed no longer asks "Save password?" again; a changed password still does.

## 1.1.5

### Downloads
- **Fast (multi-part) downloads now ask the server the way Chrome does.** The engine first asks through the browser's own network stack — the same TLS handshake, certificate store, DNS settings and cookies as the browser's own download — and only then with a direct connection (which is needed for servers that insist on the page address, and for using several networks). Before, only the direct connection was tried, and a server that answered it with the whole file (or refused it) was written off, although Chrome and download managers get parts from it.
- The card's note now says what each way of asking got, for example "browser network stack: HTTP 200; direct connection: HTTP 403".

## 1.1.4

### Fixes
- **Logins are kept more reliably (Google and other sites).** Chromium writes cookies to disk in batches, about every 30 seconds. If the browser was ended the hard way — the update installer closing it, Task Manager, a crash, a power cut — the last batch was lost. Google renews its session cookies every few minutes and refuses the old ones, so the next start came back "signed out". The browser now writes cookie changes to disk by itself a moment after they happen, once more before it quits, and before the update installer is started. Private (incognito) windows still keep nothing.

### Downloads
- **The download list now says why a download is not split into parts.** When the fast multi-connection mode is not used (the server refuses extra connections, cannot send a file in parts, the link works only once, the file is small, a proxy is in use …) the card shows "Normal download: …" with the reason, instead of silently using one connection.
- The fast engine's requests now carry the same headers the browser's own download request carries (language, client hints, the page it came from), which some servers check before they allow extra connections.

## 1.1.3

### Fixes — fast downloads and multi-network downloading
- **Fast download engine rebuilt.** The file is now cut into small blocks that every connection takes from a shared queue, instead of one equal part per connection. A fast connection simply does more blocks than a slow one, a stuck connection no longer holds up the end (another connection repeats its block), and a connection that keeps failing steps aside while the others carry on. Data is written to disk in file order without blocking the browser, so a big file no longer makes the disk "pre-fill" gigabytes before the first byte is saved.
- **Multi-network (Wi-Fi + Ethernet / phone hotspot) now really adds up.** The work follows the speed of each network, instead of waiting for the slow network to finish its half. A network is used only if it can really reach the download server (tested through that network, not with a connection to port 53 that many mobile networks block); virtual adapters (WSL, virtual machines, VPNs, containers) are no longer counted as extra networks; a network that stops working is dropped and its connections move to a working one. The Downloads page shows which networks take part.
- **The browser's own download is no longer thrown away first.** The fast engine takes over only after one test request has shown that the link allows it (it works for links that can be used once, and for servers that refuse extra connections). Otherwise the normal download simply goes on. No more "Save as" window flashing up (or the download hanging) before a fast download starts.
- **Retry keeps the page of the original download** (Referer), as every browser does, so servers that only answer requests coming from their own page accept it.
- Downloads with "Ask where to save each file" turned on no longer open a second, built-in Save dialog.
- Cancelling a fast download no longer risks that a late disk write lands in another file.

### Also
- The Downloads page no longer fails to read the network list (Turbo state).

## 1.1.2

### Fixes
- **Downloads can no longer get stuck at "0 B"** (for example a 13 GB file that never started). The fast multi-stream engine now checks every answer from the server. If the server refuses its requests, ignores byte ranges, hangs, or closes the connection early, the browser handles it instead of waiting for ever: a refused or silent start continues automatically with the standard Chromium downloader (same entry in the list), a connection that drops is resumed where it stopped, and a download that really cannot continue is shown as *Failed* with the reason (hover for the full text). Before, a refusing server could even end with a "completed" file full of error text.
- **Retry** now always uses the standard downloader (the most compatible one) and is no longer ignored because the same link is still listed.
- A download that was still running when the browser was closed no longer comes back as a download that looks alive (Pause and Cancel did nothing). It is shown as interrupted; Retry or remove it.
- **Cancel** and **Remove** now really stop a fast download (it used to continue in the background), also when pressed right after it started. A cancelled or failed download leaves no half-written file of the full size behind.
- Privacy: the cookies of the page a download came from are no longer written to the download history, and are not passed on when a download is redirected to another website.
- The new tab page showed "Chromium 130" whatever the real version was; it now shows the version that runs.

## 1.1.1

### New
- **Secure DNS (DNS-over-HTTPS), AdGuard DNS by default** (Settings → Network & Proxy). Website-name lookups are encrypted, and AdGuard also refuses to resolve known ad, tracker and malware domains. If AdGuard cannot be reached the browser quietly falls back to your normal DNS (optional *never fall back* switch). Choose AdGuard Family / Non-filtering, your own DNS-over-HTTPS address, or the system DNS (no secure DNS).
- **Ad blocker on/off, per site**: the shield button now has *Ad & Tracker Blocking* (everywhere) and *On this site* (pause the blocker only for the site you are on). Both reload the page so the change shows at once.

### Fixes
- **Copy buttons work again**, including **YouTube's right-click menu on the video** ("Copy video URL", "Copy video URL at current time", "Copy embed code"), the Share dialog and the Copy buttons of other sites. Websites were refused permission to write to the clipboard ("Write permission denied"). Reading the clipboard still needs your permission.
- **Right-click on a video** (and on YouTube's second right-click) now shows the usual video items: Play/Pause, Mute, Loop, Show controls, Picture in picture, Save video as, Copy video address, Open video in new tab.
- Switching the ad blocker off now also switches off the built-in YouTube ad skipping, which used to keep running.
- Switching the ad blocker off twice in a row no longer raises an error.

## 1.1.0

A large security and reliability release. **Updates are now signed**: from this version on the browser installs an update only if it carries a valid signature from the publisher's key.

### New
- **Continue where I left off** (Settings → On Start-up): your tabs come back after a restart or a crash. Background tabs load only when you open them. Incognito tabs are never saved.
- **Error pages**: a page that cannot be loaded now explains why (no internet, server not found, connection refused, proxy problem, untrusted certificate …) instead of showing a blank tab. The address bar keeps the address, and *Try again* / *Reload* retry it.
- **One window per profile**: opening SHMMOTH again (or a link from another app) brings the running window to the front and opens the link in a new tab.
- **New logo** and app icon.
- Opening a downloaded program (`.exe`, `.msi`, `.bat`, `.js`, …) now asks for confirmation first.

### Security
- Signed updates (Ed25519); the installer is hashed again right before it is started.
- Page titles can no longer run code inside the browser's own pages (stored XSS), and local `file://` documents no longer receive the browser API. A Content-Security-Policy protects every internal page.
- All pages, windows and tabs run in the Chromium sandbox.
- Passwords are stored only with the operating system's encryption (Windows DPAPI); if it is unavailable the browser refuses to save them instead of using a weak key. Data files are written atomically with a backup, and a damaged file is kept aside instead of being overwritten.
- Incognito tabs now use the configured proxy, and downloads use the proxy-aware downloader while a proxy is active. WebRTC no longer reveals the real IP when a proxy is configured.
- The browser no longer contacts Google Fonts (Inter is bundled).
- Hardened build: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are disabled, and the app loads only from its signed archive.

### Fixes
- Internal pages (new tab, Settings, History …) were blank inside incognito tabs.
- The ad blocker now blocks from the very first request, caches its filter lists (faster start, works offline) and fetches them through the browser's proxy. Switching it off applies to normal and incognito tabs alike.
- History showed the *previous* page's title; it is now correct, and history is written more efficiently.
- The RAM Saver could put the tab you were using to sleep.
- The page context menu's *Reload* did nothing.
- The bundled uBlock Origin copy (which never worked in installed builds) was removed; the built-in blocker does the work.
- Removed the non-functional "AI Assistant" settings.

### Under the hood
- Electron 33 → 44 (Chromium 152).
- Automated tests: unit tests plus end-to-end tests of the real app on Linux and Windows, including the packaged build, on every change.
