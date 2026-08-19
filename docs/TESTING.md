# Testing

Luma Darkroom uses layered checks because a desktop photo workflow can fail in
ways that ordinary unit assertions do not reveal.

## Automated checks

Install the exact locked dependencies, then run:

    npm ci
    npm test

The suite includes:

- JavaScript syntax checks for the main process, preload, edit engine, and UI;
- an Electron workflow smoke test covering develop, presets, masks, metadata,
  minimum-window layout, persistence, and restart;
- a control-regression pass that exercises every generated range and toggle,
  representative selects, comparison, batch operations, watermarks, layout,
  and renderer-security invariants;
- a resilience pass covering quota failure, recovery records, missing files,
  rapid navigation, tiny images, corrupt values, unsupported drops, undo, and
  a 5,000-record catalog;
- an export-worker pass covering encoded-image validity, selected-photo
  targeting, event-loop responsiveness, cancellation, and worker cleanup.

Tests create synthetic redistributable image fixtures in the operating-system
temporary directory. Test profiles and screenshots must not be committed.

## Dependency and notice checks

Run:

    npm audit --audit-level=high
    npm run verify:notices

The required notice check verifies committed hashes and the installed native
inventory without network access. `npm run verify:notices:upstream` additionally
downloads the canonical sources when their hosts are reachable. Network
success does not itself prove that a license review is complete.

## Packaged application

Build all release assets, then run the packaged checks:

    npm run build:native-source
    npm run build:notices
    npm run dist
    npm run test:packaged
    npm run verify:release

The packaged smoke test launches the unpacked executable. Release verification
checks version agreement, expected license delivery, the packaged ASAR file
list, native-library notice hashes, Authenticode status, and SHA-256 values for
the installer, native corresponding-source archive, and notice archive.

## Human release session

Use disposable photographs and a disposable user-data profile. Exercise a
fresh launch, tutorial, import, keyboard-only culling, every panel, preset
amount, masks, cleanup, undo/redo, backup/restore, missing originals, all
export formats, cancellation, restart recovery, minimum-window layout, Windows
display scaling, install/upgrade/uninstall, and the exact hashed installer.

Record failures as reproducible issues. Do not put private photographs,
catalogs, file paths, crash dumps, or credentials in screenshots or logs.
