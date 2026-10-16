/**
 * The main process's source as one text, for the tests that look for a piece of main-process code: src/main.js followed
 * by the modules it is split into (src/browser/shared.js, then the files src/browser/mixins.js adds to the application,
 * in its order). A check therefore finds the code wherever it lives. Reads the files only (nothing is required, so no
 * Electron is needed).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

function mainSourceFiles() {
  const mixins = fs.readFileSync(path.join(SRC, 'browser', 'mixins.js'), 'utf8');
  const parts = Array.from(mixins.matchAll(/require\('\.\/([\w-]+)'\)/g), (m) => path.join('browser', m[1] + '.js'));
  return ['main.js', path.join('browser', 'shared.js'), ...parts];
}

function mainSource() {
  return mainSourceFiles().map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
}

module.exports = { mainSource, mainSourceFiles, SRC };
