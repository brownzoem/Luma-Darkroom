# Releasing

This is the maintainer checklist for a Windows release. It documents the
current NSIS target; it does not confer release authority, promise that an
artifact is safe, or replace legal, security, or platform review.

## 1. Prepare

- Confirm release authority under [Governance](../GOVERNANCE.md).
- Review open correctness, data-loss, security, privacy, and dependency issues.
- Ensure the worktree contains only intended release changes.
- Update every current-version surface together: **package.json**,
  **package-lock.json**, the in-app Help/About copy in **src/index.html**,
  **docs/PRIVACY.md**, **docs/SECURITY_MODEL.md**,
  **third_party/NATIVE_SOURCE_MANIFEST.json**, and the versioned filenames in
  **third_party/SOURCE_AVAILABILITY.md**. Refresh
  **third_party/SHA256SUMS** after changing the native-source manifest.
- Update [Changelog](../CHANGELOG.md) with the release date and user-visible
  changes.
- Re-read [Privacy](PRIVACY.md), [Security model](SECURITY_MODEL.md),
  [Trademarks](../TRADEMARKS.md), and
  [Third-party notices](../THIRD_PARTY_NOTICES.md).
- Never commit code-signing keys, passwords, tokens, private reports, crash
  dumps, catalogs, or release-service credentials.

Use a clean dependency installation:

    npm ci
    npm ls --all

Review unexpected lockfile changes before continuing.

## 2. Verify source

Run syntax checks:

    node --check electron/main.js
    node --check electron/preload.js
    node --check electron/model-manager.js
    node --check electron/custom-presets.js
    node --check src/engine.js
    node --check src/preview-worker.js
    node --check src/render-worker.js
    node --check src/ai-client.js
    node --check src/ai-segmentation-worker.js
    node --check src/app.js

Run the automated syntax, Electron smoke, control-regression, and resilience
suite. Manual verification remains required for operating-system dialogs and
installer behavior rather than serving as a substitute for automation.

    npm test

Start from source and exercise disposable test data:

    npm start

Minimum manual matrix:

- first launch and second-instance focusing;
- sandboxed startup and a documented compatibility-fallback environment;
- import direct JPEG/PNG/WebP and at least one Sharp-converted source;
- missing, corrupt, unsupported, oversized, and permission-denied input;
- rapid arrows, 0–5 ratings, P/X/U flags, G/D views, held original, undo/redo;
- every develop panel, preset replacement and amount, layered object/sky/brush/
  gradient masks, reorder/invert/opacity/add/subtract, dodge/burn, clone/heal/
  red-eye, cleanup cap, rotate, flip, zoom, and reset;
- the tool rail end to end: lasso and polygonal lasso, marquee (rect, ellipse,
  preset shape) with Shift/Alt combine and constrain modifiers, magic wand
  tolerance and contiguous, pen paths with anchor editing, Move/Transform pan
  and corner/edge handles, Ctrl+D / Ctrl+Shift+I, and marching-ants overlay;
- the crop tool: handles, aspect presets and X swap, drag-outside straighten,
  guide cycling with O, shape crops (including "From selection") with feather,
  photo pan/zoom/stretch inside the crop, Enter apply / Esc cancel, and a
  transparent-PNG plus flattened-JPEG shape-crop export;
- close/relaunch autosave, recovery selection, quota failure, valid backup,
  corrupt backup, duplicate IDs, duplicate paths, and legacy migration;
- two-photo compare, analysis, batch sync, exposure average (SDR), panorama bounds;
- JPEG, PNG, WebP, TIFF, original copy, resize, quality, watermark history,
  destination cancellation, unwritable destination, and reveal;
- keyboard-only dialogs and focus behavior;
- no unexpected runtime network connections; optional model acquisition must
  occur only after approval and only from the fixed documented HTTPS origin.

Use synthetic or redistributable images. Do not put private client work into
release logs or screenshots.

## 3. Audit dependencies and notices

The lockfile is not a complete binary inventory. Review both npm metadata and
the unpacked artifact.

- Confirm direct and transitive licenses against the exact lockfile.
- Inspect the resolved **sharp** platform package and its native-library
  inventory.
- Run the upstream notice comparison after **npm ci**:

      npm run verify:notices

  The required command verifies committed hashes and the installed native
  inventory without depending on a third-party site's availability. When the
  canonical hosts are reachable, also run the stronger source comparison:

      npm run verify:notices:upstream

- Review [notice sources](../third_party/SOURCES.md),
  [source availability and relinking](../third_party/SOURCE_AVAILABILITY.md),
  and **third_party/SHA256SUMS**. A checksum match establishes file identity,
  not legal completeness.
- Preserve Electron's **LICENSE.electron.txt** and
  **LICENSES.chromium.html**.
- Preserve complete Sharp/libvips LGPL, Cairo MPL, AOM patent, BSD, MIT, ISC,
  zlib, libpng, FreeType, fontconfig, libtiff, mozjpeg, and other applicable
  upstream materials.
- Review the exact NSIS compiler/plugin payload and its COPYING files.
- Record source-availability and replacement/relinking information required by
  the exact native binaries.
- Build the pinned native source-retention asset and verify every archive
  against the committed manifest:

      npm run build:native-source

  Do not publish the Windows binary unless the resulting version-matched source
  archive will be published beside it without login or payment.

The earlier source-configuration gap is remediated: **package.json** now carries
the root license and notice, the installed Sharp platform notice, and
`third_party/**/*` into the application's **resources/licenses** directory.
Artifact verification remains a release gate. In the final unpacked application
confirm the project license, root notice, complete third-party directory, Sharp
and colour package notices, and Electron/Chromium notices are readable and
unmodified. Do not mark this check complete based only on source-tree files or
packaging configuration.

## 4. Build

On a clean Windows build host:

    npm run build:native-source
    npm run build:notices
    npm run dist
    npm run verify:release

Expected primary artifact:

    outputs/release/Luma-Darkroom-Setup-<version>.exe

The version-matched native corresponding-source and third-party-notice ZIP
archives are required adjacent release assets. `verify:release` fails when
either archive is missing or malformed.

Also inspect **outputs/release/win-unpacked**. Confirm:

- application and installer versions match;
- icons and product name are correct;
- no source maps, caches, work files, test images, catalogs, or credentials are
  included;
- production dependencies load from the packaged ASAR/unpacked resources;
- the model manager, custom-preset validator, selection workers, and required
  local inference runtime assets exist in the packaged ASAR;
- Electron and Chromium notices exist;
- **resources/licenses/LUMA-DARKROOM-MIT.txt** and
  **resources/licenses/THIRD_PARTY_NOTICES.md** exist;
- **resources/licenses/third_party** contains both GNU texts, MPL 2.0, the AOM
  license and patent license, local inference runtime license/notices,
  Sharp/native inventories, source/relinking guidance, and a matching
  **SHA256SUMS**;
- project and native-library notice delivery is complete for the exact artifact;
- install, repair/upgrade, launch, second launch, and uninstall work in a clean
  environment;
- existing 2.x user data survives the upgrade.

The configured installer is not signed. If an authorized distributor signs a
release, use protected external key storage and verify the signature after the
final packaging step. Never claim an unsigned build is signed or an unofficial
build is an official project artifact.

## 5. Artifact checks

Scan the installer and unpacked files with tools appropriate to the release
environment. Record cryptographic hashes, for example:

    Get-FileHash outputs/release/Luma-Darkroom-Setup-<version>.exe -Algorithm SHA256

Test the exact hashed installer, not a later rebuild. A malware scan, signature,
hash, or successful test reduces particular risks but does not prove an
artifact is defect-free or secure.

## 6. Publish

- Create a release in the repository hosting platform using the version.
- Attach the exact tested installer, hash, project license, third-party notice
  bundle, version-matched native corresponding-source archive, and release
  notes.
- Clearly identify supported platform/architecture and whether the build is
  signed.
- Link to source corresponding to the release and preserve required native
  component source/notice access.
- State known data, codec, performance, and security limitations.
- Do not imply affiliation with another vendor or use Luma Darkroom branding
  for a modified third-party build.

Tags, release notes, package versions, artifact filenames, and in-app version
must agree.

## 7. After release

- Install from the published artifact and repeat a short launch/import/edit/
  relaunch/export smoke test.
- Verify downloads and notices are accessible.
- Monitor issue and private security channels as maintainer capacity allows.
- If a serious issue is discovered, preserve evidence, stop or mark the
  affected artifact as appropriate, communicate the scope without exposing
  private details, and prepare a corrected release.

There is no automatic updater. Corrected versions do not silently replace
already-installed builds.
