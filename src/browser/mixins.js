// Adds the methods of src/browser/*.js to ShmmothBrowserApp (main.js). Each file holds one area of the browser as a
// class whose methods are copied onto the application's prototype: `this` inside them is the application.
'use strict';

const MIXINS = [
  require('./session'),
  require('./network'),
  require('./extensions'),
  require('./bubbles'),
  require('./windows'),
  require('./broadcast'),
  require('./tabs'),
  require('./passwords'),
  require('./ipc'),
];

module.exports = function addMethods(App) {
  for (const Mixin of MIXINS) {
    for (const name of Object.getOwnPropertyNames(Mixin.prototype)) {
      if (name === 'constructor') continue;
      if (Object.prototype.hasOwnProperty.call(App.prototype, name)) throw new Error(`ShmmothBrowserApp.${name} is defined twice`);
      Object.defineProperty(App.prototype, name, Object.getOwnPropertyDescriptor(Mixin.prototype, name));
    }
  }
  return App;
};

module.exports.FILES = ['session.js', 'network.js', 'extensions.js', 'bubbles.js', 'windows.js', 'broadcast.js', 'tabs.js', 'passwords.js', 'ipc.js'];
