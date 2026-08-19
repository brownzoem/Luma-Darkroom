# Changelog

Notable project changes are recorded here. The format follows Keep a Changelog
principles, and versions follow Semantic Versioning where practical.

## Unreleased

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
