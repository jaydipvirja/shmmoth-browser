'use strict';
const AIProvider = require('../AIProvider');

/**
 * OPENAI / CHATGPT PROVIDER — OpenAIProvider.js
 *
 * Loads ChatGPT web interface in the AI side panel.
 * Future: will support native OpenAI API calls from main process.
 */
class OpenAIProvider extends AIProvider {
  getName()        { return 'chatgpt'; }
  getDisplayName() { return 'OpenAI ChatGPT'; }
  getDisplayUrl()  { return 'https://chatgpt.com'; }
}

module.exports = OpenAIProvider;
