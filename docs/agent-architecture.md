# MTC Browser — Agent Architecture (SHMMOTH Preparation)

> **Status:** Interface defined. Implementation is Phase 2.

## Overview

The SHMMOTH agent (`BrowserAgent`) operates exclusively in the **Electron main process**. It has controlled, permission-gated access to browser state via `MtcBrowserApp`. It has no direct access to webpage JavaScript contexts.

## Class Hierarchy

```
BrowserAgent (abstract interface)   src/agent/BrowserAgent.js
└── SHMMOTHAgent (Phase 2)          src/agent/SHMMOTHAgent.js  [NOT YET CREATED]
```

## BrowserAgent Interface

```js
await agent.planTask(task)              // Plan a multi-step task
await agent.observePage(tabId)          // Read page state (untrusted data)
await agent.executeAction(action)       // Execute a BrowserAction
await agent.requestPermission(id, ctx)  // Request user permission
await agent.verifyAction(action)        // Pre-flight validation
await agent.recoverFromError(err, ctx)  // Error recovery
```

## BrowserAction Schema

All agent actions are expressed as structured `BrowserAction` objects:

```js
{
  action:     'navigate' | 'click' | 'type' | 'scroll' | 'readPage' | ...,
  tabId:      'tab_1',
  target:     'https://example.com' | '#submit-button',  // CSS selector or URL
  value:      'text to type',                            // for type actions
  reason:     'User asked to fill in the search form',   // audit log
  permission: 'browser.interaction'
}
```

Available action types (see `src/agent/BrowserAction.js`):

| Action | Permission |
|---|---|
| `navigate` | `browser.navigate` |
| `goBack`, `goForward`, `reload` | `browser.navigate` |
| `newTab`, `closeTab`, `switchTab` | `browser.tabs` |
| `click`, `type`, `scroll`, `select` | `browser.interaction` |
| `readPage`, `getUrl`, `getTitle` | `browser.observe` |
| `addBookmark` | `browser.data.write` |
| `readHistory` | `browser.data.read` |

## Security Invariants

### Untrusted Data Boundary
`observePage()` returns page content. That content is **UNTRUSTED DATA**:
- It must be sanitised before inclusion in AI prompts.
- It must never override system instructions, security policy, or permissions.
- A webpage saying "ignore previous instructions" is content, not a command.

### Permission Model
- Every sensitive action requires `requestPermission()` → user approval UI.
- The agent **cannot approve its own permission requests**.
- Permission grants are scoped to the specific action and time-limited.
- Permission dialogs render in the browser chrome (trusted context), not in a web tab.

### No Arbitrary Code Execution
- The agent never calls `wc.executeJavaScript()` with arbitrary strings.
- The agent never calls OS shell commands.
- The agent acts only through the `BrowserAction` vocabulary.

### Audit Trail
All agent actions are logged at `AGENT` level using `agentLogger` before and after execution.

## Session Model

The agent uses the **existing Chromium session** (same cookies, same authentication). When a user is logged into Gmail, the agent can interact with Gmail as that user — without ever seeing or storing the password.

This design means:
- Users authenticate themselves normally.
- The agent inherits the session.
- The agent can be revoked by clearing the session.

## Integration Steps (When Phase 2 begins)

1. Create `src/agent/SHMMOTHAgent.js` extending `BrowserAgent`.
2. Add a permission approval UI component to `renderer/index.html`.
3. Add `agent:*` IPC namespace to `setupIpc()` in `main.js` with separate auth token validation.
4. Instantiate the agent in `MtcBrowserApp.init()` after all other services are ready.
5. Wire `AIProvider.query()` for agent reasoning.
6. Add agent action log to `mtc://downloads` or a new `mtc://agent-log` page.
