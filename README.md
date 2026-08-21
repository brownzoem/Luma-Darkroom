# Luma Darkroom

Luma Darkroom™ is a local-first, non-destructive desktop photo editor built
with Electron. It organizes photographs, stores edit instructions in a local
catalog, renders previews in the application, and exports new files without
modifying the originals.

Luma Darkroom is independent open-source software. Its controls and output are
its own, and compatibility or pixel parity with other photo editors is not a
project goal.

Project website and user guide: <https://lumadarkroom.com>

## Current capabilities

- Local library with search, ratings, pick/reject flags, color labels,
  keywords, captions, sorting, batch selection, and simple quality analysis.
- Non-destructive develop controls for profiles, light, tone curves, white
  balance, vibrance, saturation, an eight-channel color mixer, point color,
  color grading, effects, detail, optics, and geometry.
- A vertical tool rail with the single-key tools professional editors expect:
  Move/Transform (V), rectangular/elliptical/preset-shape marquee (M),
  freehand and polygonal lasso (L), magic-wand auto select (W), vector pen
  paths with editable anchors (P), mask brush and eraser (B/E), gradients (G),
  crop (C), color sampler (I), heal (J), zoom (Z), and hand (H) — each with a
  contextual options bar.
- On-canvas selections with marching-ants feedback that become regular mask
  layers: combine with Shift (add), Alt (subtract), and Shift+Alt (intersect),
  deselect with Ctrl+D (Ctrl+Shift+D reselects), invert with Ctrl+Shift+I,
  and refine any selection with the add/subtract brushes, feathering, and
  range intersections. Drawing never multiplies layers: a fresh drag
  replaces the active selection's shape (its adjustments stay), and new
  layers come only from the ＋ Add mask dropdown or the ＋ New layer button.
- A pro-style mask layers panel: each row shows a live grayscale thumbnail
  of its mask, its name and type, drag-and-drop reordering, double-click
  (or F2) inline renaming, and a ⋯ / right-click menu with Rename,
  Duplicate, Invert, Disable, Move, and Delete. Alt+click a thumbnail to
  view the mask itself in grayscale on the canvas; Shift+click disables it.
- A non-destructive stack of up to eight independent subject, object, people,
  background, sky, brush, linear-gradient, radial-gradient, range, and
  geometry-selection masks.
  Layers can be reordered,
  renamed, hidden, inverted, duplicated, refined with add/subtract brushes,
  and blended with per-mask opacity.
- An interactive crop tool with drag handles, aspect presets and lock,
  drag-to-straighten, cycling guide overlays, and preset crop shapes (oval,
  star, heart, polygons, arrow, or the outline of the active selection) with
  feathered edges. While cropping, drag the photo to reposition it under the
  crop, drag its corners to zoom, and drag its edges to stretch — all
  non-destructive and revertable. Shape crops export with transparency on
  PNG/WebP/TIFF and flatten to white on JPEG.
- Local exposure, color, clarity, blur, dodge, and burn controls plus bounded
  spot healing, clone sampling, and red-eye correction. Optional object and
  people models run locally after explicit approval; sky selection is a
  bounded offline heuristic. No photograph is uploaded for selection.
- Smooth pressure-aware brush paths, immediate in-progress feedback, familiar
  brush shortcuts, and crop-consistent brush sizing for pointer and keyboard
  workflows.
- Curated color, portrait, landscape, cinematic, film, black-and-white, and
  dynamic-range-look presets plus searchable custom presets with an amount
  control. Custom presets autosave locally and can be renamed, deleted, or
  moved between computers with validated JSON export/import.
- Before/original comparison, two-photo comparison, a filmstrip, zoom, rotate,
  flip, and edit history.
- JPEG, PNG, WebP, and TIFF export, original-file copy, size and quality
  controls, and optional text watermarks.
- JPEG, PNG, WebP, BMP, GIF, TIFF, and AVIF import. Camera-RAW and HEIC import
  are not advertised because the packaged Windows decoder does not reliably
  support them.
- Simple SDR exposure averaging and panorama-strip helpers. They do not
  perform professional alignment, deghosting, true HDR fusion/output, or
  feature-based stitching.
- Sparse autosaved local catalog with an in-progress recovery copy, a small
  last-good snapshot, checksums, bounded undo history, and manual JSON
  backup/restore.
- No telemetry, accounts, cloud sync, advertising, photo upload, or remote
  editing service. The only application network workflow is an optional,
  user-approved download of fixed, verified local-selection models.

## Keyboard workflow

Shortcuts are ignored while typing in a field or while a dialog is open.

In the Develop view, single letters select editing tools; culling letters
(P/X/U for flags) still work from the Library view.

| Action | Shortcut |
| --- | --- |
| Move / Transform tool | V |
| Marquee select (Shift cycles rect → ellipse → shape) | M / Shift + M |
| Lasso select (Shift cycles freehand → polygonal) | L / Shift + L |
| Auto select (magic wand) | W |
| Pen (vector selection) | P |
| Crop and shape crop | C |
| Gradient mask (Shift cycles linear → radial) | G / Shift + G |
| Color sampler / Heal | I / J |
| Zoom tool / Hand tool | Z / H |
| Add / subtract / intersect while drawing a selection | Shift / Alt / Shift + Alt |
| Constrain square (during marquee drag) / draw from center | Shift / Alt |
| Close a polygon or pen path / remove last point | Enter or double-click / Backspace |
| Deselect / reselect / invert the active mask | Ctrl + D / Ctrl + Shift + D / Ctrl + Shift + I |
| Rename the selected mask layer | Double-click its row, or F2 |
| View mask in grayscale / disable mask | Alt + click / Shift + click its thumbnail |
| Select all | Ctrl + A |
| Crop: apply / cancel / cycle guides / swap aspect | Enter / Esc / O / X |
| Previous / next photograph | Left / Right |
| Set rating | 1–5 |
| Clear rating | 0 |
| Pick / reject / unflag (Library view) | P / X / U |
| Library / Develop | G (Library) / D |
| Hold original | Backslash |
| Undo / redo | Ctrl or Cmd + Z / Shift + Ctrl or Cmd + Z |
| Open export | Ctrl or Cmd + E |
| Open Help Center | F1 or ? |
| Move the active canvas tool cursor | Arrow keys; hold Shift for larger steps |
| Apply the active canvas tool | Enter |
| Decrease / increase brush or repair size | [ / ] |
| Make the brush edge softer / harder | Shift + [ / Shift + ] |
| Select Add Brush / Subtract (Eraser) | B / E |
| Select Dodge / cycle Dodge and Burn | O / Shift + O |
| Temporarily subtract while painting | Hold Alt |
| Pan a zoomed photograph | Hold Space and drag |
| Zoom in / out / Fit | Ctrl + + / Ctrl + - / Ctrl + 0 |
| Zoom at the cursor | Ctrl + scroll wheel (pinch on trackpads) |
| Copy / paste develop settings between photos | Ctrl + Shift + C / Ctrl + Shift + V |
| Reset a single slider to its default | Double-click the slider or its label |
| Add / select / move / delete a tone-curve point | Enter / Ctrl + Left or Right / Arrow keys / Delete |

## Install

The maintained packaged target is a Windows NSIS installer. Obtain installers
only from a release channel you trust. Published builds may be unsigned; an
unsigned or locally built installer can trigger an operating-system
unknown-publisher warning.

To run from source:

    npm ci
    npm start

To build the Windows installer:

    npm run build:native-source
    npm run build:notices
    npm run dist
    npm run verify:release

Build artifacts are written to **outputs/release**. The configured installer is
not code-signed. See [Releasing](docs/RELEASING.md) before distributing a build.

## Project layout

| Path | Responsibility |
| --- | --- |
| **electron/main.js** | Window lifecycle, filesystem dialogs, atomic writes, image protocol, Sharp decoding, and validated IPC |
| **electron/custom-presets.js** | Strict custom-preset file schema, bounds, validation, and canonical serialization |
| **electron/preload.js** | Narrow context-bridge API exposed to the renderer |
| **src/app.js** | Catalog, UI, culling workflow, autosave, presets, and renderer orchestration |
| **src/tools.js** | Tool rail, options bar, on-canvas selection tools (marquee, lasso, wand, pen), Move/Transform, and overlay rendering |
| **src/crop-tool.js** | Interactive crop mode: handles, aspect lock, guides, shape crops, and photo transform under the crop |
| **src/engine.js** | Edit schema, migration, geometry, pixel processing, analysis, and canvas export |
| **src/preview-worker.js** | Coalesced background preview rendering with watchdog recovery |
| **src/render-worker.js** | Background full-size render, encoding, progress, and cancellation |
| **src/index.html** | Static interface and Content Security Policy |
| **src/styles.css** | Desktop UI presentation |
| **assets/** | Application icons |
| **docs/** | Architecture, privacy, release, and security design notes |

More detail is in [Architecture](docs/ARCHITECTURE.md) and the
[Security model](docs/SECURITY_MODEL.md). The automated and manual quality
matrix is documented in [Testing](docs/TESTING.md). The release-by-release
truth contract is the [Capability status matrix](docs/FEATURE_PARITY.md).

## Data and privacy

Photographs are read from their existing locations. The catalog contains file
paths and user-created metadata and is stored in Electron's local browser
storage. Custom presets are stored separately in the same local application
profile. Catalog backups, custom-preset files, and exports are written only
after a save dialog.
Crash reporting is configured for local dumps with server upload disabled.

The catalog is not encrypted and is not a substitute for backups. Anyone with
access to the operating-system account or application data may be able to read
paths and metadata. See [Privacy](docs/PRIVACY.md).

When creating a custom preset, exposure and white balance are excluded by
default because they are often photograph-specific; the creation dialog can
include them explicitly. Crop/geometry, masks, cleanup/repair operations, and
tool state are never captured in a custom preset.

## Important limitations

- Originals are intended to remain untouched, but software and storage can
  fail. Keep independent backups and verify important exports.
- Full-resolution canvas processing is bounded to reduce out-of-memory crashes.
  Very large photographs or panoramas may require a smaller export size.
- TIFF and AVIF sources use a lossless 8-bit PNG handoff, which avoids an
  extra lossy encode but does not preserve every source bit depth and metadata
  field. A scene-referred camera-RAW workflow is not implemented.
- Object, subject, background, and people selection can use optional verified
  local models; sky selection uses bounded local analysis. Fine hair,
  translucent edges, and difficult boundaries can require manual add/subtract
  refinement.
- Rendering is an sRGB-oriented Canvas 2D pipeline, not a full camera-profile,
  scene-referred RAW, or print color-management system.
- The local catalog is browser storage rather than a multi-user database. It
  has no cross-device synchronization or conflict resolution.
- The software is provided without warranty. Documentation describes intended
  behavior, not a guarantee of data preservation, security, compatibility, or
  legal compliance.

## Contributing and community

Read [Contributing](CONTRIBUTING.md), the
[Code of Conduct](CODE_OF_CONDUCT.md), and [Governance](GOVERNANCE.md).
For bugs and usage help, see [Support](SUPPORT.md). Report vulnerabilities
through the private process in [Security](SECURITY.md), not a public issue.

## License and marks

Source code and project documentation are available under the
[MIT License](LICENSE), except where a file says otherwise. Dependencies retain
their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).

The MIT License does not grant rights to the Luma Darkroom™ name or logo.
Forks and redistributed modified applications must use a distinct name and
branding. See [Trademarks](TRADEMARKS.md).
