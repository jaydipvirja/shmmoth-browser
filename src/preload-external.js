/**
 * EXTERNAL WEB PRELOAD — preload-external.js
 *
 * Used for ALL external web content loaded in tab WebContentsViews:
 *   - Google, YouTube, GitHub, Reddit, and all other websites
 *
 * SECURITY POLICY:
 *   External web pages MUST NOT have access to any privileged browser APIs.
 *   This preload intentionally exposes NO privileged functionality.
 *
 *   External pages cannot access:
 *     ✗ Tab management (create, close, switch, navigate)
 *     ✗ History data
 *     ✗ Bookmarks data
 *     ✗ Storage / settings
 *     ✗ Filesystem
 *     ✗ IPC channels
 *     ✗ Session / cookies
 *     ✗ System APIs
 *     ✗ Window controls
 *
 * MINIMAL READ-ONLY EXPOSURE:
 *   Only non-privileged, informational data is exposed — nothing that
 *   can be used to interact with the browser application.
 */

// Nothing about the browser is disguised here either. Up to 1.1.14 this script replaced navigator.userAgentData.brands
// and getHighEntropyValues() with JavaScript functions that said "Google Chrome"; Google's sign-in check sees such
// replaced (non-native) functions and refuses the browser as "not secure". Pages now see the engine's own values; how
// the browser presents itself on Google's sign-in pages is decided in services/googleSignIn.js.

// External web pages have zero access to privileged browser APIs.
// window.mtcAPI and window.shmmothAPI are intentionally NOT defined for external pages.
