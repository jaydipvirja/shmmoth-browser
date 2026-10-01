# Releasing SHMMOTH Browser (signed updates)

The browser installs an update **only if its installer carries a valid signature** from a key whose public half is compiled into the app (`src/services/updateKeys.js`). GitHub never holds the private key, so someone who gets hold of your GitHub account / token / release page can swap files but **cannot make users install malware**.

Why a plain checksum is not enough: GitHub's asset `digest`, `latest.yml`, a `.sha256` file all live on the same release and are replaced together with the installer (the v1.0.16 installer was in fact re-uploaded a day after the release was published).

## One-time setup

```bash
npm run release:keygen
```

* writes the **private** key to `release-signing-key.pem` (git-ignored, mode 0600) — keep it secret and **back it up** (password manager / offline USB). If it is lost, installed browsers can only be updated by a manual install of a build that contains a new key.
* prints the **public** key. Paste it into `UPDATE_PUBLIC_KEYS` in `src/services/updateKeys.js`, commit, and ship it in your next release.

Until a key is compiled in, the browser still *tells* the user that a new version exists but does not download or run anything by itself; it points to the releases page.

## Every release

1. Bump `version` in `package.json`, then build: `npm run dist` → `dist/SHMMOTH-Browser-Setup-<version>.exe`
   (`nsis.artifactName` in `package.json` fixes the file name; the updater only accepts exactly `SHMMOTH-Browser-Setup-<version>.exe`).
2. Sign it:
   ```bash
   npm run release:sign -- dist/SHMMOTH-Browser-Setup-1.0.17.exe
   ```
   This creates `SHMMOTH-Browser-Setup-1.0.17.exe.sig` next to it and re-verifies it with the same code the app uses.
3. Create the GitHub release with tag `v1.0.17` (final release, not draft / pre-release) and upload **both** files:
   * `SHMMOTH-Browser-Setup-1.0.17.exe`
   * `SHMMOTH-Browser-Setup-1.0.17.exe.sig`
4. Optional check: `npm run release:verify -- dist/SHMMOTH-Browser-Setup-1.0.17.exe`

The signature covers *file name + size + SHA-256*, so it cannot be reused for another version or a modified file (downgrade/replay protection comes from that plus the version check).

## What the app checks before it runs an update

1. release tag is a plain `x.y.z`, newer than the running version, not a draft/pre-release
2. the installer and `.sig` are the release's own assets (exact names and URLs); every request and redirect stays on `github.com` / `*.githubusercontent.com` over HTTPS
3. size matches the metadata, SHA-256 matches GitHub's published digest (when present)
4. the Ed25519 signature verifies against a trusted key
5. the file sits in a private folder (`<userData>/updates`) and is hashed again immediately before it is launched

Any failure deletes the file and shows a message; nothing is ever run.

## Rolling out the first signed release (bridge)

Browsers older than the first release that contains the new updater (v1.0.16 and earlier) still use the old, unverified updater: they will install the first signed release without checks, and every release after that is verified. Publish that bridge release soon.

## Key rotation

Release a build whose `UPDATE_PUBLIC_KEYS` lists **both** the old and the new key, sign the following releases with the new key, and remove the old key in a later release.

## Also recommended (separate from update signing)

Authenticode-sign the installer with a code-signing certificate (electron-builder `win.certificateFile` / `certificateSubjectName`). It removes the Windows SmartScreen warning for new installs; update signing above is what protects *updates*.
