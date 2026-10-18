# CHANGELOG

## 1.4.6

- **Resume no longer downloads a half-finished part again.** A fast download is fetched in parts of 1–8 MB over several connections. When it stopped, 1.4.5 kept the finished parts, but each part that was still being downloaded started again from its beginning on *Resume* (up to 8 MB per connection). Now every part continues from its last byte on the disk, like IDM.
- What *Resume* relies on is written through to the disk before it is saved (so a power cut cannot leave it pointing at bytes that never reached the disk), and a part file that is shorter than expected is never trusted beyond its end.
- Fixed: a progress save that arrived just after a download stopped could replace the newer one.

## 1.4.5

- **Multi-network downloads now really use two connections.** Before a fast download starts, the browser tests which way the server accepts. It tested the browser's own network stack first, which nearly every server accepts, and then always downloaded that way. But only the other way can send connections out through a chosen network card, so with Wi-Fi and a cable (or a phone on USB) connected, a download still used one connection. Now, when two connections can reach the server, SHMMOTH also tries the way that can use both, and splits the download over them when the server accepts it.
- When a fast download uses one connection although multi-network is on, the Downloads page says why: only one connection reaches the server, or the site only accepts the browser's own connection.
- **Settings → Downloads → Check Multi-Network Setup** tests your computer and says what to change:
  - which connections really reach the internet (each one is tested on its own);
  - whether a VPN or a proxy is in the way;
  - whether the switches in Settings are on;
  - on Windows, whether the "minimize simultaneous connections" policy can drop one of them, with the one command that fixes it.
- **Resume where it stopped, like IDM, also after closing the browser.** A fast download that was cut off (the connection dropped for minutes, the server stopped answering, the browser or the PC was closed) used to start again from 0 B. Now the parts already downloaded are kept, and the card shows *Resume*, which fetches only the missing parts. Before it continues, SHMMOTH asks the server whether the file is still the same (size, ETag / Last-Modified); if it changed, the download starts over, so versions are never mixed. *Start over* (and *Remove*) delete the kept parts.
- A connection reset during the first test request of a download is now tried once more, instead of giving up on splitting the download.

## 1.4.4

- **YouTube: the newest ad and anti-adblock fixes.** YouTube changes how it shows ads and how it detects ad blockers several times a week, and uBlock Origin answers with new rules just as often. SHMMOTH took uBlock's lists from a mirror that was days to weeks behind, and it was missing three of uBlock's lists altogether (2025, 2026 and the general list). Now:
  - uBlock's lists come straight from uBlock's own repository (the mirror stays as a fallback), with the 2025, 2026 and general lists added; on youtube.com 45 fixes are now in force where there were 29.
  - The quick-fixes list, where uBlock puts YouTube's fixes first, is fetched again every 4 hours (the other lists: once a day).
  - When YouTube still shows its "Ad blockers are not allowed" notice, the browser fetches the newest fixes at once (at most every 30 minutes); reloading the page then uses them.
- The arguments of uBlock's script rules are converted to the form the engine needs for lists taken from anywhere other than the mirror (this also fixes AdGuard's script rules with a "%" in them).
- Checked again: the ad blocker's on/off switch (Settings and the shield), the per-site pause and "My filters" work in normal and Incognito tabs (22 automated tests).

## 1.4.3

- **New logo: the moth.** SHMMOTH has a logo of its own: a simple moth on an indigo tile (SHM-*MOTH*). It replaces the blue "S" everywhere: the app icon on the taskbar, desktop and Start menu, the installer, the tab of the New Tab page, the top of the New Tab page, Settings and the other pages. It stays clear down to 16 px.

## 1.4.2

- **Import from Chrome, Edge or Brave.** *Settings → Search Engine & General → Import Bookmarks & History* lists the browsers and profiles on this computer and brings over their bookmarks (into a folder *Imported from …*) and their most recent 2,000 pages of history, with the original visit times. On first start, the Welcome card offers it in one click (*Import from Google Chrome*). Importing again never doubles anything. Passwords and cookies are not imported: the other browsers keep them encrypted for themselves.
- The other browser's files are only read: its history database is copied and opened read-only, so the browser can stay open (if it holds the file, SHMMOTH says to close it and try again).

## 1.4.1

- **SHMMOTH can be your default browser.** The installer now registers SHMMOTH with Windows as a web browser for http and https links, so it appears in *Settings → Apps → Default apps*. In SHMMOTH, *Settings → Search Engine & General → Default Browser* says whether it is your default; *Make default* opens Windows' Default apps page right at SHMMOTH (Windows 10 and 11 let only you make this choice). Links from other apps (mail, chat, documents) then open in a new SHMMOTH tab. Uninstalling removes the registration.
- Links arrive after `--`, so nothing in a link can be taken as a start-up option of the browser (the precaution Electron recommends for link handlers).
- The installer is now built and tried on every change (CI job *Installer (Windows)*): silent install, the registration with Windows, a start from a link, uninstall.

## 1.4.0

Redesign, Phase 5: polish (`docs/redesign-plan.md`).
- **Welcome card on first start.** A new installation opens with two quick choices on the New Tab page, *Look* (Follow Windows / Light / Dark) and *Search with* (Google / DuckDuckGo / Bing); both apply at once, and *Start browsing* closes the card for good. Existing users never see it. The search box now names the engine you chose.
- **Windows 11 Mica** (Settings → Appearance, off by default): your desktop colour shows faintly through the tab strip. The switch appears only on Windows 11 22H2 and newer.
- **Calm motion:** a new tab slides into the strip, and the small windows (ad blocker, downloads, extensions, permissions, ⋮ menu, saved logins, save password) drop in from their button. Everything is still when Windows' *Animation effects* are off.
- **No emoji left anywhere:** the last ones in Settings (passwords, autofill profiles, site permissions, the update card and About, the Google session import), in the save-password and saved-login windows, and in the browser frame (tab close button, find bar, extension pins) are now icons or plain text. The save-password and saved-login windows follow the light theme too.
- Settings' coloured status lines (session import, proxy test) take their colours from the theme.

## 1.3.3

Redesign, Phase 4: History, Bookmarks, Downloads, Extensions, Notes and the error and crash pages (`docs/redesign-plan.md`).
- **Icons instead of emoji on every one of these pages:** search, folders, edit / delete, pause / resume / retry, the Turbo and network status, the extension icons and dialogs, the Notes title and "saved" mark, and one clear icon for each kind of error page (server not found, no internet, timed out, proxy, blocked by the ad blocker, certificate …). A site without its own icon shows a globe; a download shows its file type as a short label (ZIP, PDF, EXE …), as in the downloads window.
- **The same rounded search box with a search icon** on History, Bookmarks, Downloads and Extensions, and the SHMMOTH logo at the top of each page.
- **Empty lists say what to do** ("Pages you visit will show up here", "Files you download will show up here", "No bookmark matches your search") with an icon, instead of a grey line.
- Fixed: the blue main buttons on these pages and in Settings (*Add Turbo Download*, *Add Password*, *Save & Apply* …) had no style of their own and looked like plain grey buttons; the Extensions page's messages were white on white in the light theme; status colours on Downloads and Notes were fixed dark-theme colours, now they follow the theme.

## 1.3.2

Redesign, Phase 3: the New Tab page and Settings (`docs/redesign-plan.md`).
- **New Tab:** the SHMMOTH logo and name above a larger search box; the clock is now small and sits on one line with the date and the greeting; shortcuts show the site's first letter on a colour of its own instead of emoji (nothing is fetched from the web for them); the status at the bottom (ad blocker, RAM saver, engine) is shown as three small chips with icons. The Incognito notice got the same calm look.
- **Settings → Search settings:** type a word (e.g. "proxy", "theme", "password") and only the matching settings of every section are shown; if nothing matches it says so; Escape or clearing the box goes back to the section that was open.
- **Settings → Appearance → Theme:** three buttons, *Follow Windows*, *Light*, *Dark*, instead of a drop-down.
- Settings cards have a thin line between their rows, the logo heads the side menu, and the add-shortcut dialog follows the theme.

## 1.3.1

Redesign, Phase 2 (second part): the small windows next to the toolbar (`docs/redesign-plan.md`).
- **The ad blocker, downloads, extensions and site-permission windows follow the theme** (Dark, Light, Follow Windows) and use the same colours, corners, shadow and Inter font as the rest of the browser. Before, they were always dark.
- **Icons instead of emoji** in all of them: shield, downloads, folder, pause / resume, cancel, retry, pin, camera, location, notifications. In the downloads list each file shows its type as a short label (ZIP, PDF, EXE …).
- Buttons on a blue or red background always have white text, also in the light theme (Allow, Delete, the download actions), and the shield's green and red status texts are readable in both themes.

## 1.3.0

Redesign, Phase 2 (first part): the browser frame, as in the approved mockup (`docs/redesign-plan.md`).
- **A calmer toolbar.** Next to the address bar there are now only the everyday buttons: the ad blocker (with the number blocked on this page), downloads, extensions and a new **⋮ main menu**. The rest moved into that menu: *New tab*, *New Incognito window*, *History*, *Downloads*, *Bookmarks*, *Passwords*, *Quick notes*, *Extensions*, *Import Google & YouTube sign-in*, *Developer tools*, *Check for updates*, *Settings* and *About*, each with its keyboard shortcut. The keyboard shortcuts work as before.
- **Theme and zoom in the menu:** *Windows / Light / Dark* switch the whole browser at once, and − / + / the percentage change the zoom of the page; the menu stays open and shows the new value.
- **Updates:** a small dot on ⋮ while an update downloads (green when it is ready); the menu entry then reads *Restart to update*.
- **New look for tabs, address bar and bookmarks bar:** the SHMMOTH logo instead of the "SHMMOTH" chip, the active tab joined to the toolbar, site icons (and the browser's own pages with their own icons) instead of emoji, a rounded address bar with a clear lock / warning icon, and bookmark icons instead of stars. Dark, Light and the violet Incognito window all come from the design tokens of 1.2.1. The page area keeps its exact size and place.
- Menus and the find bar in the frame follow the theme too.

## 1.2.1

Redesign, Phase 1: one design system for the whole browser (`docs/redesign-plan.md`).
- **The light theme works on every page.** Settings showed dark cards with dark, unreadable text; History, Bookmarks, Downloads and Notes stayed dark; the Extensions page kept a dark box; the New Tab search box stayed dark. All of them now take their colours from one set of design tokens (`src/pages/design-tokens.css`), so light is light and dark is dark everywhere.
- **New theme choice: Follow Windows.** Settings → Appearance → Theme: *Follow Windows*, *Light* or *Dark*. *Follow Windows* switches together with Windows' own dark / light setting, at once, also on pages that are already open. New installations start with *Follow Windows*; an existing choice is kept (the old *Midnight OLED* shows as Dark).
- **Icons instead of emoji** in the Settings menu and on the New Tab page: one clean SVG icon set that takes the theme's colours.
- **Easier to use with the keyboard and easier to read:** a clear focus ring on whatever the keyboard is on, text contrast of at least 4.5 : 1 in every theme (checked by the tests), and no animations when Windows' *Animation effects* are off.
- A slightly deeper navy for the dark theme and a calmer selected item in the Settings menu, as in the approved mockup.

## 1.2.0

Groundwork for the redesign (`docs/redesign-plan.md`). Nothing changes in how the browser looks or works.
- **The main process is split into files by area.** `src/main.js` (4,600 lines) now holds only the start-up; tabs, windows, bubbles, network, passwords, session and the IPC handlers each have their own file in `src/browser/`. The code was moved unchanged, so every existing test passes as before. The redesign can now change the browser frame without touching one 4,600-line file.
- **Every screen is photographed by the tests**, in the dark and the light theme: the browser frame, New Tab, Settings, History, Bookmarks, Downloads, Extensions, Notes, the error and crash pages, and the four bubbles. CI keeps the pictures, so each redesign step can be compared with the one before. The first pictures already show what the redesign has to fix: in the light theme the Settings cards stay dark with dark text (hard to read), History stays dark, and the New Tab search box stays dark.
- Downloads: a small download that finished while the browser was still testing the fast engine now also says on its card why it was a normal download (before, the note was left out in that case).

## 1.1.15

### Google sign-in — "Couldn't sign you in: This browser or app may not be secure"
- **The browser no longer disguises itself, which is what Google refused.** Up to 1.1.14 a script in every page replaced `navigator.userAgentData` with JavaScript functions that claimed "Google Chrome", and the requests to Google got a rewritten header saying the same. Google's sign-in check runs inside the page and is built to catch exactly that: the replaced functions are not native code, frames and workers the script never reached still said "Chromium", and the version fields did not match the engine. A browser that lies about itself looks like the man-in-the-middle tools the check is there to stop, so the sign-in was refused. Now every page sees the browser's real, native values, and no header is rewritten.
- **On Google's sign-in pages the browser names itself honestly**, like Opera or Edge do: `… SHMMOTH/1.1.15 Chrome/152.… Safari/537.36` (never "Electron", which Google blocks outright).
- **If Google refuses anyway, the browser tries again by itself.** It recognises Google's refusal page and starts the sign-in again from the beginning (same destination, e.g. back to YouTube or Gmail) with the next identity: plain Chromium, then Firefox. The one that works is remembered for next time. If Google refuses all of them, you get one plain message with *Try again* instead of an endless loop — that is a decision on Google's side, often for a while after several attempts from the same computer.
- The sign-in identity now always matches the real operating system (a Mac never claims to be Windows), and an address that merely *contains* "accounts.google.com" (e.g. in a search query) is no longer treated as Google's sign-in.

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
