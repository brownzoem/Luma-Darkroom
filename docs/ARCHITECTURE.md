# Architecture

## Overview

Luma Darkroom is a static Electron desktop application with five code
boundaries:

1. the Electron main process owns native windows, filesystem dialogs, custom
   image loading, Sharp decoding, and writes;
2. a context-isolated preload exposes a small asynchronous API;
3. the renderer owns catalog state, interaction, worker orchestration, and the
   visible UI;
4. a persistent preview worker coalesces interactive render requests away from
   the UI thread;
5. a dedicated export worker performs full export rendering and encoding away
   from the UI thread.

There is no runtime web server, frontend bundler, account service, or remote API.
The renderer loads **src/index.html**, **src/styles.css**, **src/engine.js**, and
**src/app.js** directly from the installed application. Preview and export jobs
load **src/preview-worker.js** or **src/render-worker.js** and the same engine in
a worker context.

## Component map

### electron/main.js

- Obtains a single-instance lock and focuses the existing window for a second
  launch.
- Starts Electron crash reporting with server upload disabled.
- Registers **local-image:** as a privileged custom scheme.
- Creates the BrowserWindow with context isolation, disabled renderer Node
  integration, preferred sandboxing, navigation denial, new-window denial, and
  permission denial.
- Retries once without the renderer sandbox after a platform launch failure.
- Validates IPC, shows native open/save dialogs, writes through same-directory
  temporary files and rename, and reveals completed files.
- Serves direct image types and uses Sharp for best-effort conversion of
  additional types.
- Keeps at most three converted buffers and 256 MB in the main-process decoded
  cache.

### electron/preload.js

The preload uses Electron's context bridge to expose **window.desktop**:

| Method | Main-process operation |
| --- | --- |
| pickImages | Select one or more supported source paths |
| exportImage | Validate and save encoded image data; convert TIFF through Sharp |
| copyOriginal | Copy a validated supported source through an atomic temporary file |
| revealFile | Reveal a validated existing image or catalog path |
| pathForFile | Resolve a dropped File to its native path |
| saveCatalog | Save a bounded JSON catalog backup |
| openCatalog | Read a bounded JSON catalog backup |
| openHelpGuide | Open the fixed, main-process-owned HTTPS guide URL |

No raw Node, filesystem, shell, or IPC object is exposed to renderer code.

### src/app.js

The application layer:

- builds panels and binds controls;
- owns the in-memory photo list and current photo;
- migrates, validates, autosaves, recovers, backs up, and restores the catalog;
- manages presets, metadata, filtering, culling shortcuts, selection, compare,
  merge, watermark history, and bounded undo/redo;
- loads the active image and four bounded neighboring prefetch images;
- creates a persistent, coalescing preview worker with stale-result rejection,
  watchdog recovery, and a bounded main-thread fallback;
- creates, monitors, cancels, and releases bounded background export workers;
- contains user-facing recovery for async, decode, render, storage, and export
  failures.

### src/engine.js

The engine is a browser-global module. It provides:

- the versioned default edit schema;
- defensive merge and old-schema migration;
- photo-record normalization;
- orientation, flip, transform, and crop;
- tone, curve, color, mixer, point-color, grading, masks, vignette, grain,
  detail, focus blur, retouch, and watermark processing;
- image-quality analysis.

It accepts an already decoded image plus edit state and returns a canvas.

### src/preview-worker.js

The preview worker retains one transferred bitmap for the active photograph,
renders only the latest pending request, and returns an ImageBitmap to the
renderer. Request IDs and photo tokens reject stale frames. Startup and render
watchdogs dispose a failed or hung worker and allow bounded fallback rendering.

### src/render-worker.js

The export worker accepts one transferred image bitmap, migrated edits, and
validated export options. It uses the shared engine with OffscreenCanvas,
reports render and encode progress, returns encoded binary bytes, and releases
its bitmap and worker resources on success, failure, cancellation, or timeout.

## Image path

1. Import stores a native path and metadata; it does not copy or modify the
   source.
2. The renderer requests a URL such as **local-image://load?path=...**.
3. The main-process handler validates that the path is absolute, exists, is a
   regular supported file, and is below the relevant input-size limit.
4. JPEG, PNG, WebP, GIF, and BMP are returned directly.
5. TIFF, AVIF, HEIF/HEIC, and listed camera-file extensions are attempted
   through Sharp with a 150-megapixel decode limit and automatic orientation.
   Codec support is not guaranteed.
6. Converted images are returned as lossless 8-bit PNG for renderer
   processing, subject to a 350 MB decoded-buffer limit. This avoids an extra
   lossy generation but is not a scene-referred RAW or metadata-preserving
   development path.
7. The renderer decodes the active image into an Image object. A selection token
   discards stale callbacks; errors and a 30-second timeout return the user to
   the library without dropping catalog metadata.

The custom scheme permits a trusted renderer to request any absolute supported
image path that the operating-system account can read. It is not a per-catalog
capability system. Renderer restrictions are therefore part of the same
security boundary.

## Edit and render path

Edits are nested, versioned, non-destructive instructions:

- profile and basic tone;
- RGB and per-channel tone curves;
- white balance, vibrance, and saturation;
- eight-channel HSL mixer and point color;
- shadows, midtones, highlights, and global grading;
- texture, clarity, dehaze, post-crop vignette, and deterministic grain;
- sharpening and luminance/color noise controls;
- optics toggles and manual corrections;
- rotation, flip, straighten, perspective-like transforms, aspect, scale,
  offsets, and crop zoom/position;
- up to eight ordered local-mask layers with bounded brush strokes, plus a
  bounded source-anchored retouch list.

Interactive preview requests use a capped draft long edge and then settle at a
zoom-, viewport-, and display-density-aware edge between 1050 and 3200 pixels.
The preview worker coalesces superseded requests; allocation failures retry at
a smaller size, and a watchdog recovers from a hung worker. Export transfers a
decoded image to a dedicated worker, which calls the same engine at a requested
size or full resolution and encodes the result. Export supports progress,
cancellation, a 180-second timeout, and deterministic cleanup. The engine
rejects output above 16,384 pixels on an edge or 50 million pixels to avoid
predictable memory exhaustion.

Pixel processing remains CPU-heavy. Local object/sky selection is bounded
image analysis rather than semantic AI, mask maps are capped at a 512-pixel
analysis edge, and some effect controls are visual approximations rather than
camera-science or perceptual reference implementations. A controlled GPU or
perceptual pipeline remains a roadmap possibility.

## Catalog

Each photo record contains:

- an opaque ID;
- source path and display name;
- migrated edit instructions;
- rating, flag, color label, tags, caption, and optional quality score;
- import time.

Selection and decoded-image state are transient.

The renderer uses these local-storage keys:

| Key | Purpose |
| --- | --- |
| luma-catalog-v2 | Primary versioned catalog envelope |
| luma-catalog-v2-recovery | New payload written before replacement of primary |
| luma-catalog-v2-last-good | Previous valid small primary snapshot |
| luma-library | Read-only legacy migration source |
| luma-watermark-history | Up to three recent non-empty watermark strings |

The catalog envelope has a version, timestamp, monotonic generation, checksum,
and photo array. Startup parses candidates independently and chooses the newest
valid generation, preferring the primary on a tie. Individual malformed records
are skipped. A catalog that is wholly unreadable is preserved rather than
replaced by an empty save.

Autosave occurs after a short debounce, every five seconds while dirty, when
the document becomes hidden, and during pagehide/beforeunload. Local-storage
writes are synchronous and individually atomic, but the recovery sequence is
not a transactional database and is constrained by browser-storage quota.
Manual JSON backup is the durable interchange and recovery mechanism.

## Memory and reliability bounds

| Resource | Bound |
| --- | ---: |
| Renderer catalog input | 24 million string characters, 50,000 records |
| Main-process catalog backup input | 50 MB |
| Undo history | 50 entries per photo, 24 recently used photos |
| One history entry | 750 KB serialized before + after |
| Cleanup spots | 200 per photo |
| Mask layers | Eight per photo |
| Mask strokes | 256 per layer and 1,024 total per photo |
| Curve points | 64 per channel |
| Prefetch images | Four, two on either side |
| Selected merge input | 12 photographs |
| Converted main-process cache | Three buffers and 256 MB |
| Direct source-file size | 256 MB |
| Conversion source-file size | 2 GB |
| Sharp input pixels | 150 million |
| Converted decoded buffer | 350 MB |
| Encoded export IPC payload | 350 MB binary; legacy data URL capped at 350 million characters |
| Engine output canvas | 16,384-pixel edge and 50 million pixels |

Bounds are defenses against accidental and hostile resource exhaustion, not
proof that every machine can process the maximum safely.

## Filesystem writes

Export, original copy, and catalog backup require a native save dialog. The
main process writes or copies to a unique temporary file in the destination
directory, flushes it, renames it into place, and attempts temporary cleanup.
Atomic rename behavior still depends on the filesystem and operating system.

Source files are not opened for write. There is no delete, move, overwrite-
original, or automatic folder-management feature.

## Extension guidance

- Add settings to **defaultEdits**, migration, UI descriptors, render behavior,
  presets where appropriate, catalog tests, and documentation together.
- Add an IPC method only when a renderer task cannot be safely completed
  without native privilege. Validate again in the main process.
- A network capability requires an explicit threat model and updates to
  [Privacy](PRIVACY.md) and [Security model](SECURITY_MODEL.md).
- A new native codec or binary dependency requires artifact-level license and
  malformed-input review.
- A catalog format change must preserve older valid data or provide an explicit
  export-and-migrate path.

## Non-goals of the current architecture

- multi-user or cross-device catalog synchronization;
- compatibility with proprietary catalog, preset, or profile formats;
- a professional RAW development pipeline or full color-management system;
- unbounded full-resolution processing;
- unattended destructive file operations;
- claims that recovery, privacy, or atomicity are guaranteed.
