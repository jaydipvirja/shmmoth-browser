# Redesign plan

The plan for SHMMOTH Browser's new look, phase by phase. One phase is worked on at a time, by one person or agent, so
changes never collide. Every phase changes how the browser looks, not what it does: the existing unit and E2E suites
must keep passing unchanged, and each phase ships as its own release.

Mockups of the three directions to choose from (private canvas, owner only):
https://claude.ai/artifact/Exv3JURvZXHF83S3JyDpUM — A Clean (Chrome-like), B Sidebar (vertical tabs), C Compact (one
row). Each has a Dark / Light switch.

## Decisions (2026-10-16)

| Question | Decision |
|---|---|
| Direction | **A — Clean**: tabs on top, address bar, bookmarks bar (vertical tabs may come later as an option, Phase 6) |
| Brand | Keep the "S" logo and the navy / cyan colours |
| Default theme | Follow Windows (light or dark), with Dark and Light still selectable |
| Windows 11 Mica | Yes, with a solid background on Windows 10 |

## Where the UI stands (1.1.15)

| Part | Files | Size |
|---|---|---|
| Browser frame (tabs, address bar, toolbar, bookmarks bar, find bar, menus) | `src/renderer/index.html`, `app.js`, `style.css` | ~4,200 lines |
| Internal pages | `src/pages/`: newtab, settings, history, bookmarks, downloads, extensions, notes, error, crash | ~8,700 lines |
| Bubble windows (separate `BrowserWindow`s) | download, shield, password, permission, extension, autofill | ~1,800 lines |
| Layout (header height, tab view bounds, side panel, bubble positions) | `src/main.js` | part of 4,539 lines |

- Each page carries its own CSS; there are about 50 different hard-coded colours. Only the frame has CSS variables
  (`:root` + `body.theme-light`, ~15 tokens); the pages repeat their own values.
- Icons are a mix of inline SVG and emoji.
- Brand: the "S" tile (navy `#0b1220` → `#16348f` → `#2563eb`, cyan `#7dd3fc`/`#22d3ee` stroke), bundled Inter font.

**Technical constraint that shapes the design:** web pages are `WebContentsView`s laid over the frame window. Nothing
drawn in the frame's DOM can overlap the page area. Anything that has to (address-bar suggestions, menus, bubbles)
must be its own small window, as the bubbles already are. The page area starts at `headerHeight` (cached at 114 px,
`updateViewBounds` in `main.js`).

## Phases

| Phase | What | Size | Release |
|---|---|---|---|
| 0 | Groundwork: direction chosen, screenshot baselines, `main.js` split | M | 1.2.0 (no visible change) |
| 1 | Design system: tokens, components, icon set | M | 1.2.1 |
| 2 | Browser frame: tabs, address bar, toolbar, bookmarks bar, bubbles | L | 1.3.0 |
| 3 | New Tab + Settings | L | 1.3.x |
| 4 | Remaining pages: History, Bookmarks, Downloads, Extensions, Notes, Error, Crash | M | 1.3.x |
| 5 | Polish: motion, Windows 11 Mica, logo/icon/installer art, first-run screen | M | 1.4.0 |
| 6 | Optional features: vertical tabs (if not the chosen direction), tab groups, split view, reading mode | L | later |

### Phase 0 — Groundwork (nothing visible changes)
- ~~Choose the direction, brand, default theme and Mica~~ — done, see Decisions.
- **Screenshot baselines:** an E2E suite captures every screen (frame, each internal page, each bubble, dark and light)
  so later phases show their differences and catch accidental breakage.
- **Split `main.js`** into modules (window/layout, tabs, context menu, downloads IPC, settings IPC, Google sign-in
  wiring) with no behaviour change. This takes the layout code out of the 4,500-line file before Phase 2 touches it.

### Phase 1 — Design system
- One `src/pages/design-tokens.css`, loaded by the frame, every internal page and every bubble. It defines colours,
  type scale, spacing, radii, shadows and motion, with Dark, Light and Incognito sets. All hard-coded colours are
  replaced by tokens.
- Shared component styles: button, icon button, input, toggle, select, card, list row, menu, dialog, tab, badge.
- One SVG icon set replacing the emoji (🔍 ▶️ 📚 …).
- Accessibility: text contrast at least 4.5:1, a visible focus ring, full keyboard navigation, `prefers-reduced-motion`.

### Phase 2 — Browser frame (largest)
- Tabs: new shape, audio/mute indicator, pinned tabs, hover preview. The tab strip becomes vertical if direction B is
  chosen.
- Address bar: new look, security chip, suggestions drawn in a bubble window above the page.
- Toolbar, bookmarks bar, Windows title-bar buttons.
- Header height reduced (114 px → about 84 px for A, about 46 px for C).
- The six bubbles restyled with the Phase 1 components.

### Phase 3 — New Tab + Settings
- New Tab: search box, editable shortcuts, optional wallpaper, protection status (ad blocker, pop-ups, secure DNS).
  It must render instantly.
- Settings (~3,500 lines across html/css/js): left navigation with General, Privacy & security, Passwords,
  Appearance, Downloads and Advanced, plus a search box over all settings.

### Phase 4 — Remaining pages
- History, Bookmarks, Downloads, Extensions, Notes, Error and Crash pages rebuilt from the Phase 1 components:
  consistent lists, search and empty states.

### Phase 5 — Polish
- Tab open/close and menu motion, switched off under reduced motion.
- Windows 11 Mica / acrylic backgrounds (`backgroundMaterial`), with a solid fallback on Windows 10.
- Refreshed logo, app icon and installer art.
- First-run screen: theme, default search engine, import.

## How each phase is done
1. Mockup of the phase's screens; the owner approves it.
2. Implementation with no behaviour change. The existing suites pass unchanged, and the screenshot diffs are reviewed.
3. Pull request → CI green → merge → tag → signed release, then the owner checks on Windows.
4. One phase at a time, by one author.
