# Changelog

Notable project changes are recorded here. The format follows Keep a Changelog
principles, and versions follow Semantic Versioning where practical.

## Unreleased

## 3.2.0 - 2026-08-21

### Added

- Batch export: select photographs in the Library, open Export, and choose
  "Selected photographs" — every photo renders in the background with the
  chosen format, size, quality, and watermark, written into one approved
  folder with automatic name uniquing, per-file progress, cancellation, and
  a per-file failure summary. No dialog per file.
- A live RGB readout in the canvas toolbar shows the values under the
  cursor while editing.
- The Zoom tool gains scrubby zoom: drag left or right to zoom smoothly
  around the point you pressed.

### Changed

- The export dialog explains the batch scope and disables "Original file"
  for batch runs (batch always renders edits).

## 3.1.1 - 2026-08-21

### Fixed

- The magic wand now measures color similarity against the globally adjusted
  image — what is actually on screen — instead of the raw decode, so it no
  longer floods underexposed photographs that have been lifted. Its
  tolerance curve is also retuned to the range professionals expect from a
  wand; existing wand selections re-rasterize slightly tighter. Discovered
  while testing against real 20-megapixel dusk photographs; verified there
  alongside the click-to-subject and people selections.

## 3.1.0 - 2026-08-21

### Added

- A pro-style mask layers panel: every mask row shows a live grayscale
  thumbnail of its mask (with a red × when disabled), the mask's name and
  type, drag-and-drop reordering with a drop indicator, double-click (or F2)
  inline renaming, and a ⋯ / right-click menu with Rename, Duplicate,
  Invert, Disable, Move, and Delete.
- One ＋ Add mask dropdown replaces the wall of mask-type buttons; every
  mask kind (Selection, Brush, gradients, AI selections, Sky, ranges,
  Dodge/Burn) is created from it — or from the ＋ New layer button in the
  selection tools' options bar.
- Thumbnail gestures from the pro-editor playbook: Alt+click views the mask
  itself in grayscale on the canvas (Esc returns), Shift+click disables the
  mask, and Ctrl+Shift+D reselects the last deselected mask.
- A neutral white-balance eyedropper in the Color panel: click anything that
  should be neutral gray and temperature/tint solve to match.
- Ctrl/⌘ + scroll wheel zooms about the cursor (trackpad pinch included),
  with the full-quality render following when the gesture settles.
- Copy and paste develop settings between photographs with Ctrl+Shift+C and
  Ctrl+Shift+V; crop, masks, and repairs stay per-photo, matching preset
  scope.
- Double-click any adjustment slider (or its label) to reset just that
  control to its default.
- The export dialog now explains shape-crop transparency per format: JPEG
  fills the outside of the shape with white, while PNG/WebP/TIFF keep it
  transparent.

### Changed

- Drawing a selection no longer creates a mask layer per drag: with combine
  "New" the drawn shape replaces the active selection's regions (its
  adjustments, feather, and refinements stay); layers are only added through
  the explicit ＋ actions. Shift/Alt/Shift+Alt still add, subtract, and
  intersect.
- The per-mask opacity slider is labeled Density, matching the terminology
  professionals expect.
- Tool instruction toasts appear once per session per tool; the options bar
  carries the hint from then on.

### Fixed

- Marching-ants overlay paths are cached and the idle overlay animates at
  half rate, removing tool-rail sluggishness with large lasso selections.
- Moving, zooming, stretching, or straightening the photo now previews by
  warping the existing frame at full frame-rate instead of re-rendering the
  pipeline on every pointer move; one real render lands on release.

## 3.0.0 - 2026-08-20

### Added

- A vertical editing tool rail with crisp monochrome icons and the single-key
  shortcuts professional editors expect — V Move/Transform, M Marquee,
  L Lasso, W Auto select, P Pen, B Brush, E Eraser, G Gradient, C Crop,
  I Color sampler, J Heal, Z Zoom, H Hand — plus a contextual options bar for
  each tool.
- On-canvas selection tools that create non-destructive "Selection" mask
  layers with marching-ants feedback: freehand lasso, polygonal lasso
  (click points, Enter/double-click closes, Backspace removes), rectangular
  and elliptical marquee (Shift constrains square, Alt draws from center),
  preset-shape marquee (star, heart, triangle, diamond, pentagon, hexagon,
  rounded, arrow), a color-similarity magic wand with tolerance and contiguous
  controls, and a vector pen with click-for-corner / drag-for-curve input and
  editable anchors and handles after closing.
- Selection combine modes across every selection tool: New, Add (Shift),
  Subtract (Alt), and Intersect (Shift+Alt), plus Ctrl+D deselect,
  Ctrl+Shift+I invert, and Ctrl+A select-all. Every selection supports the
  full local-adjustment set, edge feathering, tone/range intersections,
  opacity, and add/subtract brush refinement, and stays anchored through
  crop, rotate, and flip.
- An interactive on-canvas crop tool: eight drag handles, aspect presets with
  ratio lock and X orientation swap, drag-outside-to-straighten, cycling
  guide overlays (thirds, golden, grid), arrow-key nudging, Enter/Esc
  apply/cancel, and a live full-frame preview while cropping.
- Shape crops: crop the photo to an oval, rounded rectangle, star, heart,
  triangle, diamond, pentagon, hexagon, arrow, or the outline of the active
  selection, with a feathered-edge control. Transparency is preserved in
  PNG/WebP/TIFF exports and flattened to white for JPEG; the workspace
  shows a checkerboard behind transparent areas.
- Photo transform inside the crop: drag the photo to reposition it under the
  crop window, drag its corner handles to zoom in or out, and drag its edge
  handles to stretch/distort horizontally or vertically — available in crop
  mode and through the Move/Transform (V) tool, with a one-step history
  entry per gesture and a reset control.
- A magic-wand and geometry-selection engine (schema version 8): polygon,
  cubic-curve, parametric-shape, and wand regions rasterize inside the same
  bounded mask pipeline with per-region add/subtract/intersect compositing,
  strict sanitization, point budgets, and full catalog persistence.

### Changed

- The mask panel now lists geometry selections as regular layers with a
  region summary, an "Add to selection on photo" action, and a
  clear-regions control.
- The Help Center and README document the expanded keyboard map, including
  context notes for Library-view culling keys that share letters with
  Develop-view tools.
- Legacy zoom/offset crops are read transparently: opening the crop tool on
  an older edit converts it to the new rectangle model on apply, and older
  catalogs render pixel-identically without modification.

### Fixed

- The preview clipping indicator no longer marks fully transparent
  shape-crop pixels as crushed shadows.
- Shape and crop rotations wrap at ±180° instead of clamping, so extreme
  rotation values migrate cleanly.

## 2.4.0 - 2026-08-20

### Added

- Optional, user-approved local model packs for guided object/subject/background
  selection and all-people selection. Downloads use a fixed allowlist, exact
  size and SHA-256 verification, bounded storage, cancellation, and local
  worker inference; photographs are not uploaded for selection.
- Point Color with eight independent hue/saturation/luminance target ranges,
  sampled visualization, resampling, deletion, persistence, and undo.
- Decoded-RGB primary calibration controls and manual pet-eye correction with
  catchlight preservation.
- Searchable custom presets with 0–200 amount, reusable/photo-specific capture
  scopes, rename/delete, restart recovery, and bounded validated JSON
  import/export.
- Guided Subject and Background masks, all-people masks, Smart Sky selection,
  and color/luminance range intersections in the existing layered-mask stack.
- An analyzed neutral-pixel Auto white balance and an explicit capability
  status document that distinguishes available, limited, and unavailable
  workflows.

### Changed

- Optimized Point Color with bounded lookup tables and kept preview/export
  pixels exact while reducing normal worker render time.
- Reduced semantic-mask preview memory, coalesced stale work, and prevented
  superseded frames from painting over the latest edit.
- Made color-range and Point Color sampling independent of active Point Color
  output, avoiding selection drift after large color shifts.
- Renamed exposure averaging, dynamic-range looks, manual lens controls, fringe
  reduction, neutral white balance, and selection choices to describe their
  actual behavior without implying unimplemented HDR, RAW, lens-profile, or
  automatic semantic capabilities.
- Restricted the Windows import picker to codecs confirmed in the packaged
  decoder and kept TIFF/AVIF conversion as a lossless 8-bit PNG handoff.

### Reliability and security

- Added strict model-file origin, path, symlink, size, stream, hash, temporary-
  file, atomic-install, recovery, and IPC validation with focused hostile-input
  tests.
- Serialized local inference, rejected rapid duplicate launches, and made
  cancellation release worker/model resources before the next selection.
- Added dual renderer/main custom-preset validation, prototype-key and
  non-finite blocking, structural and byte limits, atomic export writes,
  pre-import last-good recovery, and collision-safe import-as-copy behavior.
- Increased and globally bounded edit-history memory so large semantic masks
  retain independent Undo/Redo steps instead of leaving a stale undo timeline.
- Added real-model offline inference tests, semantic-mask sanitization and
  parity tests, Point Color legacy and adversarial tests, custom-preset
  Electron tests, and a product-neutral capability-contract check.

## 2.3.0 - 2026-08-19

### Added

- Pressure-aware, geometrically resampled brush paths with immediate visual
  feedback and one-step undo for each gesture.
- Familiar brush, eraser, dodge/burn, hardness, size, zoom, Fit, temporary
  subtract, and Space-pan keyboard shortcuts.
- Bounded lazy thumbnail generation and caching for the Library and filmstrip.

### Changed

- Kept draft previews at a stable displayed size so painting no longer shrinks
  the photograph, and coalesced live drafts without repeatedly restarting the
  preview worker.
- Stored compact brush paths with crop-consistent source sizing, reducing
  catalog growth while keeping pointer and keyboard strokes aligned through
  crop, rotate, flip, preview, and export.
- Preserved the nearest-sampled appearance of masks saved by earlier releases
  while using smoother bounded sampling for newly created masks.
- Made zoomed canvases fully pannable, preserved image aspect after geometry
  and window changes, softened live dodge/burn feedback, and gave repeated
  local-light layers distinct names.
- Sparse-encoded default catalog edits so large, lightly edited libraries use
  substantially less local storage without dropping scalar profile or
  black-and-white settings.

### Reliability

- Limited full-resolution neighbor prefetch to one image, bounded thumbnail
  work and cache memory, and added one-shot renderer reload/restart recovery.
- Applied mask-point budgets while parsing rather than after allocation, so a
  hostile oversized path cannot create a large temporary sanitizer graph.
- Added catalog persistence, brush workflow, crop-size, zoom/pan, pressure,
  overlay lifecycle, shortcut-guard, and malformed-path regression coverage.

## 2.2.0 - 2026-08-19

### Added

- A non-destructive local-mask stack with independent object, sky, brush,
  linear-gradient, and radial-gradient layers; reorder, rename, duplicate,
  visibility, invert, opacity, overlay, and add/subtract refinement controls.
- Dedicated dodge and burn brushes with flow, tone-range, and protect-tones
  controls.
- Bounded spot-heal, source-and-target clone, and red-eye correction tools
  whose coordinates remain attached to the photograph through geometry edits.
- Persistent on-canvas gradient guides and brush-size feedback.
- Keyboard operation for canvas tools and tone curves, visible keyboard
  cursors, and content reachability at 400% application zoom.

### Changed

- Replaced the fixed oval focus selection with bounded connected-image
  analysis plus manual refinement.
- Moved interactive previews to a coalescing background worker with timeout,
  recovery, and zoom-aware settled resolution.
- Made consecutive presets replace the prior preset recipe while preserving
  pre-preset manual edits; color presets now reliably leave monochrome mode.
- Corrected preset curve amount blending, amount undo/redo, negative color-
  mixer hue migration, zero-feather brush painting, and mask geometry
  anchoring across every rotate-and-flip combination.
- Changed converted TIFF, AVIF, HEIF/HEIC, and camera-file handoff from a lossy
  JPEG intermediate to lossless 8-bit PNG with a decoded-buffer limit.
- Preserved the rendered shape and repair behavior of version 2 masks and
  cleanup records when older catalogs are opened.

### Reliability

- Bounded mask layers, strokes, analysis maps, retouch records, preview jobs,
  and decoded conversion buffers to reduce runaway memory use and stale work.
- Clipped repair work buffers to the visible output intersection so malformed
  catalog radii cannot request multi-gigabyte temporary canvases.
- Added layered-mask, preset-switch, conversion-fidelity, preview-latency,
  zoom-resolution, frozen legacy-render, source-space geometry, transform-
  matrix, hostile-input, keyboard-tool, 400%-zoom, and responsive-layout
  regression coverage.

## 2.1.0 - 2026-08-18

### Added

- Open-source project documentation, community policies, repository templates,
  architecture notes, privacy disclosures, and release guidance.
- A first-run interactive tutorial, searchable Help Center, external user-guide
  link, sixteen editable preset recipes, and bounded large-library paging.
- Automated smoke, control-regression, resilience, packaged-application, legal
  notice, and Windows release verification helpers.

### Changed

- Improved catalog crash recovery, migration hardening, autosave failure
  visibility, bounded history and prefetch, import deduplication, and missing
  file handling.
- Improved culling shortcuts, real detail/lens rendering, preset blending,
  export validation, deterministic rendering, tool cancellation, and rotation
  cycling.
- Moved standard export rendering and encoding to a cancellable background
  worker with progress feedback to reduce interface stalls.

### Security

- Hardened catalog field validation, renderer failure containment, resource
  limits, protocol handling, IPC validation, local-only crash reporting, and
  packaged third-party notice delivery.

## 2.0.0 - 2026-08-17

### Added

- Develop panels for profiles, light, tone curves, color, color mixer, point
  color, color grading, effects, detail, optics, crop, and geometry.
- Offline local masks, focus blur, sky adjustments, and bounded spot cleanup.
- Searchable grouped presets with adjustable amount.
- Ratings, flags, labels, keywords, captions, quality analysis, filtering,
  sorting, batch edit sync, and two-photo comparison.
- Keyboard culling workflow and bounded neighbor-image prefetch.
- JPEG, PNG, WebP, TIFF, original-copy, resized export, and watermark history.
- Best-effort Sharp/libvips decoding for additional image and camera formats.
- Simple HDR-average and panorama-strip helpers.
- Versioned catalog backup and restore.

### Changed

- Reworked rendering into a versioned non-destructive edit schema with
  defensive migration.
- Added deterministic grain, selective tonal processing, HSL mixing, grading,
  geometry, detail, and effect stages.
- Added bounded preview, history, cleanup, merge, cache, payload, and
  full-resolution processing limits.
- Added autosave, crash recovery, checksum validation, corrupt-entry skipping,
  last-good fallback, and flush-on-close behavior.

### Security

- Added context isolation, disabled renderer Node integration, preferred
  renderer sandboxing, a compatibility fallback, a restrictive Content
  Security Policy, denied permissions, blocked navigation and new windows,
  validated IPC payloads, bounded local-image decoding, atomic file writes, and
  local-only crash reporting.

This changelog begins with the documented 2.0.0 codebase. Earlier prototype
history was not reconstructed.
