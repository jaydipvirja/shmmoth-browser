/**
 * TRUSTED UPDATE SIGNING KEYS — updateKeys.js
 *
 * Public Ed25519 key(s), base64 of the SPKI DER (the value `npm run release:keygen` prints).
 * The updater installs an update only if its installer carries a signature made by one of
 * these keys. The matching PRIVATE key must stay off GitHub (and out of this repository).
 *
 * While this list is empty the app still tells the user that a new version exists, but it
 * will NOT download or run installers by itself (it points to the releases page instead).
 * See docs/releasing.md for the one-time setup and the per-release signing step.
 *
 * Key rotation: ship a release that lists BOTH the old and the new key, sign the following
 * releases with the new key, and drop the old key later.
 */

'use strict';

const UPDATE_PUBLIC_KEYS = [
  'MCowBQYDK2VwAyEAKxX80hFTtDlOh3kMldZ9xImrtkm68i/6Q8Wh3p22Ql4='
];

module.exports = { UPDATE_PUBLIC_KEYS };
