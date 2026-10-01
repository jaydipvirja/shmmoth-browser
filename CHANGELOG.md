# Changelog

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
