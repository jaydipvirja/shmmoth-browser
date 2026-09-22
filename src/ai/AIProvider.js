/**
 * AI PROVIDER BASE CLASS — AIProvider.js
 *
 * Abstract base class for all AI provider implementations.
 *
 * ARCHITECTURE:
 *   The browser UI and future SHMMOTH agent interact with AI through
 *   this abstraction rather than depending directly on a specific
 *   provider's URL or API endpoint.
 *
 *   Current implementations are "display URL" providers — they load
 *   the AI provider's web interface in the side panel. Future implementations
 *   will add native API integration (streaming, function calling, etc.)
 *   without changing the interface consumed by the browser.
 *
 * SECURITY:
 *   ✗ API keys must NEVER be passed to or stored by renderer pages.
 *   ✓ API keys are held in main-process configuration only.
 *   ✓ The renderer asks for an AI response; the main process makes the request.
 *
 * FUTURE SHMMOTH AGENT NOTE:
 *   When SHMMOTH needs AI reasoning, it calls AIProvider.query() in the
 *   main process. The result (text) is returned to the agent. The agent
 *   never directly holds API keys or constructs raw API requests.
 */

'use strict';

class AIProvider {
  /**
   * @param {Object} config — provider configuration object
   * @param {string} [config.apiKey] — API key (main process only, never sent to renderer)
   */
  constructor(config = {}) {
    if (new.target === AIProvider) {
      throw new TypeError('AIProvider is abstract — instantiate a concrete provider instead.');
    }
    // Store config in main process memory only.
    // The config object (including apiKey) must never be forwarded to any renderer.
    this._config = config;
  }

  /**
   * Returns the provider's identifier string.
   * Used to match against settings.aiProvider.
   *
   * @abstract
   * @returns {string}
   */
  getName() {
    throw new Error('AIProvider.getName() must be implemented by subclass');
  }

  /**
   * Returns the human-readable display name for the provider.
   * Shown in the settings UI.
   *
   * @returns {string}
   */
  getDisplayName() {
    return this.getName();
  }

  /**
   * Returns the URL to load in the AI side panel WebContentsView.
   * For web-UI providers this is the chat page URL.
   * For native API providers this may return an internal mtc:// page URL.
   *
   * @abstract
   * @returns {string}
   */
  getDisplayUrl() {
    throw new Error('AIProvider.getDisplayUrl() must be implemented by subclass');
  }

  /**
   * Returns true if this provider supports native API calls (not just web UI).
   * Subclasses that implement query() should override this to return true.
   *
   * @returns {boolean}
   */
  supportsNativeApi() {
    return false;
  }

  /**
   * [FUTURE] Sends a prompt to the AI provider and returns the response.
   *
   * This method is NOT yet implemented — it is defined here to establish
   * the interface contract for future SHMMOTH integration.
   *
   * WHEN IMPLEMENTED:
   *   - Must be called from main process only.
   *   - Must not expose apiKey in return values or logs.
   *   - Must enforce a timeout.
   *   - Must handle rate limiting and errors gracefully.
   *
   * @param {string} prompt — the user/agent prompt text
   * @param {Object} [options] — provider-specific options
   * @returns {Promise<string>} — the AI response text
   */
  async query(prompt, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error(`AIProvider '${this.getName()}' does not support native API queries yet.`);
  }
}

module.exports = AIProvider;
