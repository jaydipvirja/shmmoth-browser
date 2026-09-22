'use strict';
const AIProvider = require('../AIProvider');

/**
 * CUSTOM URL PROVIDER — CustomProvider.js
 *
 * Loads a user-defined AI web application in the AI side panel.
 * The URL is provided at construction time from storage settings.
 *
 * SECURITY:
 *   The custom URL is run through urlPolicy.isSafeToLoad() before use.
 *   javascript:, data:, and other dangerous schemes are rejected.
 */
class CustomProvider extends AIProvider {
  /**
   * @param {Object} config
   * @param {string} config.customUrl — the user-configured AI URL
   */
  constructor(config = {}) {
    super(config);
    this._customUrl = (config.customUrl || 'https://gemini.google.com').trim();
  }

  getName()        { return 'custom'; }
  getDisplayName() { return 'Custom AI'; }
  getDisplayUrl()  { return this._customUrl; }
}

module.exports = CustomProvider;
