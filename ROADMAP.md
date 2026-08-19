# Roadmap

This roadmap communicates direction, not a promise, deadline, funded plan, or
guarantee that an item will ship. Priorities may change after testing, security
review, maintenance constraints, or contributor feedback.

## Current focus: trustworthy daily workflow

- Keep arrow-key culling and slider feedback responsive on large libraries.
- Expand automated tests for catalog recovery, IPC validation, rendering
  invariants, shortcuts, malformed inputs, and packaged startup.
- Improve missing-file relinking without discarding edits or metadata.
- Make catalog diagnostics, recovery source, storage use, and backup state
  visible to users.
- Strengthen accessibility, focus order, keyboard operation, and contrast.
- Validate more source formats with clear codec-specific errors.

## Next: durable and scalable editing

- Move expensive preview and histogram work away from the UI thread.
- Add bounded thumbnail and preview caches with explicit rebuild controls.
- Evaluate a transactional catalog backend and sidecar export while preserving
  import compatibility with the current JSON catalog.
- Add interactive crop handles and a normalized geometry model shared by
  preview and export.
- Add manual brush, radial, and linear-gradient masks with independent IDs,
  feathering, add/subtract/intersect, and cached rasterization.
- Add a background export queue with cancel, retry, progress, and saved recipes.
- Add two-up synchronized pan/zoom and a multi-photo survey view.

## Later explorations

- Perceptual or GPU-assisted color processing with controlled CPU fallback.
- Color-profile and metadata preservation improvements.
- Reversible stacking and duplicate/similar-image assistance.
- Preset import/export, tags, favorites, duplicate detection, and preview cache.
- Optional sidecar interoperability using documented, non-proprietary formats.
- Maintained installers for additional desktop platforms if test and release
  capacity exists.

## Explicit non-goals

- Uploading photographs or telemetry without an explicit opt-in architecture
  and corresponding policy review.
- Claiming pixel parity, preset compatibility, or affiliation with another
  product or vendor.
- Automatically deleting or hiding photographs based on heuristic analysis.
- Generative replacement of user content as a prerequisite for core editing.
- Sacrificing original-file safety for convenience.

Proposals are welcome through [Contributing](CONTRIBUTING.md). A roadmap entry
still requires design, implementation, review, and verification before release.
