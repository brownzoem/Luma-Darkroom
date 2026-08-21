# Testing

Luma Darkroom uses layered checks because a desktop photo workflow can fail in
ways that ordinary unit assertions do not reveal.

## Automated checks

Install the exact locked dependencies, then run:

    npm ci
    npm test

The suite includes:

- JavaScript syntax checks for the main process, preload, model and preset
  boundaries, edit engine, preview/export/selection workers, and UI;
- a capability-contract check that requires the public feature matrix and
  blocks unsupported features from being marked available;
- an Electron workflow smoke test covering develop, presets, masks, metadata,
  minimum-window layout, persistence, and restart;
- a control-regression pass that exercises every generated range and toggle,
  representative selects, comparison, batch operations, watermarks, layout,
  and renderer-security invariants;
- a resilience pass covering quota failure, recovery records, missing files,
  rapid navigation, tiny images, corrupt values, unsupported drops, undo, and
  a 5,000-record catalog including an actual sparse save and migration round
  trip;
- an interaction-quality pass covering preset replacement, converted-source
  fidelity, zoom-aware preview resolution, mask refinement, and UI heartbeat
  latency;
- a custom-preset validator and Electron workflow covering default and explicit
  capture scope, search, apply amount, one-step undo, rename/delete, autosave,
  restart recovery, ID-conflict import-as-copy, pre-import recovery, JSON round
  trips, and hostile/oversized import rejection;
- model-manager tests covering exact-ID allowlisting, redirect/origin and size
  checks, streamed hash verification, atomic storage, cancellation, symlink
  defenses, and removal;
- real offline selection-model tests plus semantic-mask schema, range,
  single-flight, large-mask undo, restart, and preview/export parity checks;
- a Point Color and calibration contract covering hostile inputs, range
  behavior, eight-target limits, undo/restart, and preview/export parity;
- a frozen legacy-render migration pass covering version 2 mask and cleanup
  appearance plus hostile repair-radius allocation bounds;
- a layered-tools pass covering mask order and opacity, all rotate/flip and
  crop anchoring combinations, gradient/brush behavior, dodge/burn,
  clone/heal/red-eye, persistence, undo, sanitization limits, and exact
  preview/export parity;
- a keyboard-accessibility pass covering object selection, brush refinements,
  two-step gradients, heal/clone/red-eye, color sampling, tone-curve editing,
  focus feedback, and content reachability at 400% application zoom;
- an export-worker pass covering encoded-image validity, selected-photo
  targeting, event-loop responsiveness, cancellation, and worker cleanup.
- a brush-workflow pass covering compact paths, coarse/coalesced and
  pressure-varying strokes, stable draft layout, crop-consistent sizing,
  shortcut guards, overlay lifecycle, and zoom/pan geometry;
- a selection-tools pass driving the tool rail with real mouse and keyboard
  input: freehand and polygonal lasso, marquee and preset-shape selections
  with combine modifiers, magic wand, pen paths, Move/Transform pan and
  corner zoom, geometry-mask rendering, undo/redo storms, and the
  deselect/invert shortcuts;
- a crop-and-transform pass covering crop handles, aspect lock, shape crops
  with verified alpha output, exact Esc-cancel restoration, catalog reload
  persistence, rotate/flip coordinate round-trips, hostile-region
  sanitization, mask-layer limits, degenerate gestures, and exact
  preview/export worker parity.

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

The packaged smoke test launches the unpacked executable and checks the narrow
custom-preset and model-manager preload surfaces. Release verification checks
version agreement, expected license delivery, required render/selection/model
runtime ASAR files, native-library notice hashes, Authenticode status, and SHA-256 values for
the installer, native corresponding-source archive, and notice archive.

If Windows Application Control blocks the unsigned unpacked executable, run
`npm run test:packaged-asar` to launch the exact packaged ASAR through the
development Electron runtime. This verifies the packaged application code and
resources, but it does not replace an installer/install/uninstall check on a
normal disposable Windows VM.

## Human release session

Use disposable photographs and a disposable user-data profile. Exercise a
fresh launch, tutorial, import, keyboard-only culling, every panel, built-in
and custom preset creation/search/amount/import/export/undo, multiple mask
layers and refinements, gradients, dodge/burn,
clone/heal/red-eye, undo/redo, backup/restore, missing originals, all export
formats, cancellation, restart recovery, minimum-window layout, Windows display
scaling, install/upgrade/uninstall, and the exact hashed installer.

Record failures as reproducible issues. Do not put private photographs,
catalogs, file paths, crash dumps, or credentials in screenshots or logs.
