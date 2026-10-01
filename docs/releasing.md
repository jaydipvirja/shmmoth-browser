# Releasing SHMMOTH Browser (signed updates)

The browser installs an update **only if its installer carries a valid signature** from a key whose public half is compiled into the app (`src/services/updateKeys.js`). GitHub never holds the private key, so someone who gets hold of your GitHub account / token / release page can swap files but **cannot make users install malware**.

Why a plain checksum is not enough: GitHub's asset `digest`, `latest.yml`, a `.sha256` file all live on the same release and are replaced together with the installer (the v1.0.16 installer was in fact re-uploaded a day after the release was published).

## One-time setup (on YOUR PC, not in a chat or a cloud session)

```bash
npm install
npm run release:keygen
```

* writes the **private** key to `release-signing-key.pem` (git-ignored, mode 0600) — keep it secret and **back it up** (password manager / offline USB). If it is lost, installed browsers can only be updated by a manual install of a build that contains a new key.
* prints the **public** key. This one is *not* secret. Paste it into `UPDATE_PUBLIC_KEYS` in `src/services/updateKeys.js`, commit, and ship it in your next release.

The private key should exist **only** on your PC: never commit it, never paste it into a chat, a ticket or a CI secret — whoever holds it can make every installed browser accept malware. (That is also why the build below does not sign: CI builds the installer, *you* sign it.)

Until a key is compiled in, the browser still *tells* the user that a new version exists but does not download or run anything by itself; it points to the releases page. `npm run release:check` (and the release workflow) refuse to build a release without a valid key, because such a build could never accept a signed update again.

## Every release

1. Update `CHANGELOG.md` (a `## x.y.z` section — it becomes the release notes) and bump `version` in `package.json` (`npm version x.y.z --no-git-tag-version`). Merge to `main`.
2. `npm run release:check` — is everything in place (key, version, changelog, icon)?
3. Tag it: `git tag vX.Y.Z && git push origin vX.Y.Z`. The **Release (draft)** workflow (`.github/workflows/release.yml`) then, on a Windows runner: re-checks, runs the unit tests, builds `dist/SHMMOTH-Browser-Setup-X.Y.Z.exe` with the production configuration, **installs it silently, starts it once, verifies the Electron fuses and uninstalls it** (`scripts/smoke-installer.js`), and creates a **draft** GitHub release with the installer and `SHA256SUMS.txt`. The job summary shows the SHA-256.
4. On your PC: download the installer from the draft, compare its hash with the one in the job summary (`certutil -hashfile SHMMOTH-Browser-Setup-X.Y.Z.exe SHA256`), then sign it:
   ```bash
   npm run release:sign -- SHMMOTH-Browser-Setup-X.Y.Z.exe
   ```
   This creates `SHMMOTH-Browser-Setup-X.Y.Z.exe.sig` next to it and re-verifies it with the same code the app uses.
5. Upload the `.sig` to the draft release and **publish** it (a normal release, not a pre-release). The updater only accepts exactly `SHMMOTH-Browser-Setup-<version>.exe` plus its `.sig`.
6. Optional: `npm run release:verify -- SHMMOTH-Browser-Setup-X.Y.Z.exe`.

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

## App icon

The logo lives in `build/`: `icon.svg` (the editable source), `icon.png` (1024×1024) and `icon.ico` (16–256 px). electron-builder picks them up by itself for the exe, the installer and the shortcuts; no configuration is needed. To change the logo, edit `icon.svg`, re-render the PNG/ICO (Chromium or any SVG tool; ImageMagick `convert` builds the `.ico` from several sizes) and copy the SVG to `src/pages/logo.svg` (shown on the Settings → About page). After changing it, build once (`npm run pack`) and check the taskbar, the Start-menu entry and the installer.
