'use strict';
const AIProvider = require('../AIProvider');

/**
 * GEMINI PROVIDER — GeminiProvider.js
 *
 * Loads Google Gemini web interface in the AI side panel.
 * Future: will support native Gemini API calls from main process.
 */
class GeminiProvider extends AIProvider {
  getName()        { return 'gemini'; }
  getDisplayName() { return 'Google Gemini'; }
  getDisplayUrl()  { return 'https://gemini.google.com'; }
}

module.exports = GeminiProvider;
