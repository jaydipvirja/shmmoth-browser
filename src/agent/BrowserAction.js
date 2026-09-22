/**
 * BROWSER ACTION SCHEMA — BrowserAction.js
 *
 * Defines the structured action vocabulary used by the SHMMOTH agent.
 *
 * ════════════════════════════════════════════════════════════════════
 * STATUS: SCHEMA DEFINITION ONLY — AGENT NOT YET IMPLEMENTED
 * ════════════════════════════════════════════════════════════════════
 *
 * PRINCIPLE:
 *   The SHMMOTH agent NEVER executes arbitrary code or arbitrary JavaScript.
 *   Instead, it expresses intent as a BrowserAction object drawn from a
 *   predefined, validated vocabulary. The browser validates and executes
 *   the action in a controlled way.
 *
 * SECURITY:
 *   - Actions must be validated by BrowserAction.validate() before execution.
 *   - Each action declares its required permission — checked before execution.
 *   - Actions include a `reason` field (human-readable) for the audit log.
 *   - The `target` field is always a CSS selector or structured descriptor,
 *     never arbitrary JavaScript.
 *
 * ACTION SCHEMA:
 *   {
 *     action:     string,   // Action type (see ACTIONS map below)
 *     tabId:      string,   // Target tab ID (required for tab-scoped actions)
 *     target:     string,   // CSS selector, URL, or structured target descriptor
 *     value:      string,   // Input value (for type/fill actions)
 *     reason:     string,   // Human-readable reason for the action (audit log)
 *     permission: string,   // Required permission string
 *   }
 */

'use strict';

// ─── Action type constants ────────────────────────────────────────────────────

const ACTIONS = Object.freeze({
  // Navigation actions
  NAVIGATE:      { id: 'navigate',      permission: 'browser.navigate',    requiresTabId: true  },
  GO_BACK:       { id: 'goBack',        permission: 'browser.navigate',    requiresTabId: true  },
  GO_FORWARD:    { id: 'goForward',     permission: 'browser.navigate',    requiresTabId: true  },
  RELOAD:        { id: 'reload',        permission: 'browser.navigate',    requiresTabId: true  },

  // Tab management actions
  NEW_TAB:       { id: 'newTab',        permission: 'browser.tabs',        requiresTabId: false },
  CLOSE_TAB:     { id: 'closeTab',      permission: 'browser.tabs',        requiresTabId: true  },
  SWITCH_TAB:    { id: 'switchTab',     permission: 'browser.tabs',        requiresTabId: true  },

  // Page interaction actions
  CLICK:         { id: 'click',         permission: 'browser.interaction', requiresTabId: true  },
  TYPE:          { id: 'type',          permission: 'browser.interaction', requiresTabId: true  },
  SCROLL:        { id: 'scroll',        permission: 'browser.interaction', requiresTabId: true  },
  SELECT:        { id: 'select',        permission: 'browser.interaction', requiresTabId: true  },

  // Observation actions (read-only, lower permission requirement)
  READ_PAGE:     { id: 'readPage',      permission: 'browser.observe',     requiresTabId: true  },
  GET_URL:       { id: 'getUrl',        permission: 'browser.observe',     requiresTabId: true  },
  GET_TITLE:     { id: 'getTitle',      permission: 'browser.observe',     requiresTabId: true  },

  // Bookmark/history actions (require explicit user data permission)
  ADD_BOOKMARK:  { id: 'addBookmark',   permission: 'browser.data.write',  requiresTabId: false },
  READ_HISTORY:  { id: 'readHistory',   permission: 'browser.data.read',   requiresTabId: false },
});

// ─── Permission constants ─────────────────────────────────────────────────────

const PERMISSIONS = Object.freeze({
  NAVIGATE:    'browser.navigate',
  TABS:        'browser.tabs',
  INTERACT:    'browser.interaction',
  OBSERVE:     'browser.observe',
  DATA_READ:   'browser.data.read',
  DATA_WRITE:  'browser.data.write',
});

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates a BrowserAction object.
 *
 * @param {Object} obj — the action object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Action must be a plain object'] };
  }

  // action type
  const actionDef = Object.values(ACTIONS).find(a => a.id === obj.action);
  if (!actionDef) {
    errors.push(`Unknown action type: ${JSON.stringify(obj.action)}`);
    return { valid: false, errors };
  }

  // tabId
  if (actionDef.requiresTabId) {
    if (typeof obj.tabId !== 'string' || !/^tab_\d+$/.test(obj.tabId)) {
      errors.push(`Action '${obj.action}' requires a valid tabId`);
    }
  }

  // reason (always required — for audit log)
  if (typeof obj.reason !== 'string' || obj.reason.trim().length === 0) {
    errors.push('Action must include a non-empty reason field for the audit log');
  }

  // permission (must match expected permission for this action type)
  if (obj.permission !== actionDef.permission) {
    errors.push(`Action '${obj.action}' declares permission '${obj.permission}' but requires '${actionDef.permission}'`);
  }

  // target: must be a string if present, and must not be executable code
  if (obj.target !== undefined) {
    if (typeof obj.target !== 'string') {
      errors.push('Action target must be a string (CSS selector or URL)');
    } else if (/javascript:/i.test(obj.target)) {
      errors.push('Action target must not contain javascript: scheme');
    }
  }

  // value: string if present
  if (obj.value !== undefined && typeof obj.value !== 'string') {
    errors.push('Action value must be a string if provided');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Creates a validated BrowserAction object.
 * Throws if validation fails.
 *
 * @param {Object} obj
 * @returns {Object} validated action
 */
function create(obj) {
  const result = validate(obj);
  if (!result.valid) {
    throw new Error(`Invalid BrowserAction: ${result.errors.join('; ')}`);
  }
  return Object.freeze({ ...obj });
}

module.exports = {
  ACTIONS,
  PERMISSIONS,
  validate,
  create,
};
