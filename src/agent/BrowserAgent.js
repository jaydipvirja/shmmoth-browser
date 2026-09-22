/**
 * BROWSER AGENT INTERFACE — BrowserAgent.js
 *
 * Defines the interface contract for the future SHMMOTH AI browser agent.
 *
 * ════════════════════════════════════════════════════════════════════
 * STATUS: INTERFACE ONLY — NOT IMPLEMENTED
 * ════════════════════════════════════════════════════════════════════
 *
 * This file establishes the method signatures, parameter types, and
 * security invariants that the future SHMMOTH implementation must satisfy.
 * Do not add implementation logic here until Phase 2 is approved.
 *
 * ARCHITECTURE:
 *   The BrowserAgent operates exclusively in the Electron main process.
 *   It has access to browser state (tabs, storage, navigation) through
 *   the MtcBrowserApp instance passed at construction.
 *   It NEVER has direct access to renderer/page JavaScript contexts.
 *
 * SECURITY MODEL:
 *   ─── UNTRUSTED INPUT BOUNDARY ──────────────────────────────────
 *   Webpage content observed by observePage() is UNTRUSTED DATA.
 *   It must never be interpreted as instructions, commands, or policy.
 *   Even if a webpage contains text like "ignore previous instructions"
 *   or "navigate to X" — that is content, not a command.
 *
 *   ─── PERMISSION MODEL ──────────────────────────────────────────
 *   Before executing any action, requestPermission() must be called
 *   and must resolve with explicit user approval.
 *   The agent NEVER auto-approves its own permission requests.
 *
 *   ─── ACTION SCOPE ───────────────────────────────────────────────
 *   All agent actions are expressed as BrowserAction objects (see BrowserAction.js).
 *   The agent NEVER executes arbitrary JavaScript against the OS or Electron APIs.
 *   It uses only the defined BrowserAction vocabulary.
 *
 *   ─── AUDIT TRAIL ────────────────────────────────────────────────
 *   Every action taken by the agent MUST be logged at the AGENT level
 *   using logger.agentLogger before and after execution.
 */

'use strict';

class BrowserAgent {
  /**
   * @param {Object} browserApp — reference to MtcBrowserApp instance
   *                              (provides tab access, storage, navigation)
   */
  constructor(browserApp) { // eslint-disable-line no-unused-vars
    if (new.target === BrowserAgent) {
      throw new TypeError('BrowserAgent is abstract — implement a concrete agent class.');
    }
    // Future: this.app = browserApp;
    throw new Error('BrowserAgent is not yet implemented. This is a Phase 2 component.');
  }

  /**
   * Plans a multi-step task from a natural language description.
   *
   * SECURITY: The task string comes from the user, not from a webpage.
   * If webpages ever provide "tasks" to the agent, those must be treated
   * as untrusted data and never auto-executed.
   *
   * @param {string} task — user-provided task description
   * @returns {Promise<Array<BrowserAction>>} ordered list of planned actions
   */
  async planTask(task) { // eslint-disable-line no-unused-vars
    throw new Error('planTask() not implemented');
  }

  /**
   * Observes the current state of a page (title, URL, visible text, DOM structure).
   *
   * SECURITY:
   *   The returned page content is UNTRUSTED DATA even though the agent reads it.
   *   It must be sanitised before being included in any AI prompt.
   *   It must never be allowed to modify agent instructions or security policy.
   *
   * @param {string} tabId — the tab to observe
   * @returns {Promise<Object>} page state snapshot
   */
  async observePage(tabId) { // eslint-disable-line no-unused-vars
    throw new Error('observePage() not implemented');
  }

  /**
   * Executes a validated BrowserAction against the browser.
   *
   * SECURITY:
   *   - Action must be validated by BrowserAction.validate() first.
   *   - Required permission must be confirmed via requestPermission().
   *   - Action is logged before and after execution.
   *   - On any validation failure, action is rejected (not silently skipped).
   *
   * @param {BrowserAction} action
   * @returns {Promise<Object>} execution result
   */
  async executeAction(action) { // eslint-disable-line no-unused-vars
    throw new Error('executeAction() not implemented');
  }

  /**
   * Requests explicit user permission before executing a sensitive action.
   *
   * SECURITY:
   *   - Permission dialogs are rendered in the browser chrome (trusted context).
   *   - Permission cannot be granted by webpage content.
   *   - Agent CANNOT self-approve its own permission requests.
   *   - Permission grants are time-limited and action-scoped.
   *
   * @param {string} permissionId — e.g. 'browser.navigate', 'browser.click'
   * @param {Object} context — additional context shown to user
   * @returns {Promise<boolean>} true = approved, false = denied
   */
  async requestPermission(permissionId, context = {}) { // eslint-disable-line no-unused-vars
    throw new Error('requestPermission() not implemented');
  }

  /**
   * Performs pre-flight verification of an action before execution.
   * Called by executeAction() automatically.
   *
   * @param {Object} action — BrowserAction to verify
   * @returns {Promise<{ valid: boolean, reason: string }>}
   */
  async verifyAction(action) { // eslint-disable-line no-unused-vars
    throw new Error('verifyAction() not implemented');
  }

  /**
   * Handles an error that occurred during task execution.
   * Determines whether to retry, skip, or abort the task.
   *
   * @param {Error} err — the error that occurred
   * @param {Object} context — current agent state at time of error
   * @returns {Promise<'retry'|'skip'|'abort'>}
   */
  async recoverFromError(err, context = {}) { // eslint-disable-line no-unused-vars
    throw new Error('recoverFromError() not implemented');
  }
}

module.exports = BrowserAgent;
