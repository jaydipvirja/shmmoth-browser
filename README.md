# 🚀 MTC BROWSER

A Fast, Modern, and Private Personal Desktop Browser powered by Chromium.

---

## 🌟 Built-in Features (ખાસ ફીચર્સ)

1. **Google Chrome-Style Interface**:
   - Smooth curved tabs with sound & sleep status indicators
   - Smart Omnibox (Direct navigation + Google search)
   - Chrome navigation controls (Back, Forward, Reload, Home)
   - Bookmark Star button and Bookmarks Bar
   - Windows frameless controls (Minimize, Maximize, Close)

2. **Default Search Engine: Google**:
   - Address bar ma direct kai pan lakhi enter karso etle Google search ma open thase.
   - Settings mathi DuckDuckGo, Bing k Yahoo pan switch kari shakay che.

3. **Built-in Ad-Blocker & Tracker Protection (એડ-બ્લોકર)**:
   - DoubleClick, AdSense, popups ane annoying ad networks ne automatic block kare che.
   - Websites 2x fast load thay che.
   - Settings mathi on/off kari shakay che ane blocked ads no live count joi shakay che.

4. **RAM Saver / Tab Memory Saver (ઓછું રેમ વપરાશ)**:
   - Background tabs je 15 min thi inactive hoy tene automatic sleep mode ma muki de che jethi computer slow na thay.
   - Tab par click karta j te instant wake up thai jaay che.

5. **MTC Smart Dashboard (New Tab Page)**:
   - Live Digital Clock, Date & Greeting.
   - Google Omnisearch box.
   - Quick Speed-Dial Shortcuts (YouTube, Google, GitHub, ChatGPT, Gemini, etc.) + Add Custom Shortcut.

6. **Quick Notes Scratchpad (નોટ્સ પેનલ)**:
   - Toolbar ma **📝** button par click kari koi pan link, note k idea lakho.
   - Auto-saved to local computer.

7. **Comprehensive Settings (`mtc://settings`)**:
   - Change Default Search Engine (Google, Bing, DuckDuckGo, Yahoo)
   - Toggle Ad-Blocker ON / OFF
   - On Start-up: open the new tab page, or **Continue where I left off** (tabs come back after a restart or a crash; incognito tabs never do)
   - Toggle RAM Saver ON / OFF & set sleep timer
   - Change Themes (Dark Glass / Classic Light / Midnight OLED)
   - Clear Browsing History & Cache

---

## ⌨️ Keyboard Shortcuts (કીબોર્ડ શોર્ટકટ્સ)

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + T` | New Tab (નવી ટેબ ખોલો) |
| `Ctrl + W` | Close Active Tab (ટેબ બંધ કરો) |
| `Ctrl + R` / `F5` | Reload Page (રીલોડ કરો) |
| `Ctrl + L` | Focus Address Bar (એડ્રેસ બાર પર જાઓ) |
| `Ctrl + D` | Bookmark Tab (બુકમાર્ક કરો) |
| `Ctrl + H` | Open History (બ્રાઉઝિંગ હિસ્ટ્રી ખોલો) |
| `F12` | Developer Tools / Inspect Element |

---

## 🚀 How to Run (કેવી રીતે શરૂ કરવું)

1. **One-Click Launch**: 
   - `run-mtc-browser.bat` ફાઇલ પર ડબલ ક્લિક કરો.
2. **Terminal / Command Prompt**:
   ```powershell
   npm start
   ```

---

## 🧪 Tests (ટેસ્ટ)

```powershell
npm test                    # unit tests (~15 s)
npm run test:e2e            # end-to-end tests against the real app (~30 s)
npm run test:e2e:packaged   # same, against a packaged build
```

Details: `docs/testing.md`. Releasing signed updates: `docs/releasing.md`. Upgrading Electron: `docs/upgrading-electron.md`.
