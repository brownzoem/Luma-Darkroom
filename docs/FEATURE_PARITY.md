# Capability status

This document is the release contract for Luma Darkroom's editing features.
“Available” means there is a working, tested workflow in the current desktop
application. “Limited” means the named workflow is useful but materially
narrower than a professional scene-referred implementation. “Not available”
means the project does not claim or display that capability.

Luma Darkroom currently renders through an 8-bit, sRGB-oriented Canvas
pipeline. It is not a scene-referred camera-RAW or floating-point HDR engine.
Optional selection models are downloaded only after approval, verified by
size and SHA-256, and run locally; photographs are not uploaded for selection.

## Editing and output

| Capability | Status | Current behavior |
| --- | --- | --- |
| Exposure, contrast, highlights, shadows, whites, blacks | Available | Non-destructive global controls with history and batch sync. |
| Tone curves | Available | RGB and per-channel point curves with pointer and keyboard editing. |
| Color adjustments | Available | Neutral and analyzed Auto white balance, temperature, tint, vibrance, saturation, profiles, B&W, and an eight-band mixer. |
| Point Color | Available | Up to eight independent hue, saturation, and luminance target ranges with visualize, resample, delete, and undo. |
| Color grading | Available | Shadow, midtone, highlight, and global grading with blending and balance. |
| Texture, clarity, dehaze | Limited | Deterministic local-contrast and blur-based approximations, not a multiscale scene-referred pipeline. |
| Sharpening, noise reduction, grain | Limited | Deterministic rendered-image detail controls; no machine-learning or camera-RAW denoise. |
| AI-powered denoise | Not available | No model has yet passed provenance, redistribution, runtime, tiling, and photographic-quality gates. |
| Manual lens adjustments | Limited | Manual distortion and lens-vignette strength; no metadata-selected lens-profile database. |
| Fringe color reduction | Limited | Purple and green fringe-hue reduction; no spatial channel realignment. |
| Geometric corrections | Limited | Manual vertical, horizontal, rotation, aspect, scale, and offset controls; no automatic line detection. |
| Camera calibration | Limited | Decoded-RGB primary mixing and shadow tint; it does not replace a camera profile or RAW pipeline. |
| Crop and straighten | Available | Interactive on-canvas crop with drag handles, aspect presets and lock, drag-to-straighten, guide overlays, rotate, flip, and constrained crop. |
| Shape crops | Available | Oval, rounded, star, heart, polygon, arrow, and selection-outline crop shapes with feathered edges; PNG/WebP/TIFF exports keep the transparency and JPEG flattens to white. |
| Photo transform inside crop | Available | Drag the photo under the crop to reposition it; corner handles zoom, edge handles stretch/distort, all non-destructive. |
| Lens blur | Limited | Mask-local inside/outside Gaussian blur; no depth map, focus plane, bokeh-shape simulation, or highlight model. |
| Post-crop vignette | Available | Amount, midpoint, roundness, feather, and highlight protection after crop geometry. |
| HDR edit and output | Not available | Exposure averaging produces an ordinary SDR image; there is no floating-point HDR display or export path. |
| Exposure averaging | Limited | Bounded average of same-size decoded frames with no alignment, deghosting, or HDR encoding. |
| Panorama helper | Limited | Bounded horizontal strip with overlap; no feature matching, warping, projection, or seam optimization. |
| Export | Limited | JPEG, PNG, WebP, 8-bit TIFF, original copy, sizing, quality, text watermark, and batch export of selected photographs into one folder; no HDR/color-space/metadata controls. |

## Masks and retouching

| Capability | Status | Current behavior |
| --- | --- | --- |
| Layered masks | Available | Up to eight named, ordered, invertible, duplicable, hideable masks with per-layer opacity and independent local edits. |
| Freehand and polygonal lasso selections | Available | Single-key lasso tools with marching-ants feedback; selections become editable mask layers with the full local-adjustment set. |
| Marquee and preset-shape selections | Available | Rectangle, ellipse, and preset shapes (star, heart, polygons, arrow) drawn on canvas with square/from-center modifiers. |
| Vector pen selections | Available | Click-and-drag cubic-curve paths with editable anchors and handles after closing. |
| Magic-wand selection | Available | Click-to-select by color similarity with tolerance and contiguous controls; combines with every other selection. |
| Selection combine modes | Available | New, add (Shift), subtract (Alt), and intersect (Shift+Alt) for all selection tools, plus deselect and invert shortcuts. |
| Brushes | Available | Pressure-aware compact paths, live feedback, Add/Subtract, source anchoring, one gesture per undo, and size/hardness shortcuts. |
| Linear and radial gradients | Available | Two-point source-anchored gradients with editable local settings. |
| Color and luminance range masks | Available | Sampled H/S/L range and luminance range intersections with feathering. |
| Select object | Available | User-guided local segmentation using an optional verified model, followed by brush/range refinement. |
| Select subject | Limited | User-guided foreground segmentation; it is not automatic primary-subject ranking. |
| Select people | Limited | Optional local all-people segmentation; no individual-person or body-part chooser. |
| Select background | Available | Guided foreground segmentation followed by inversion, with normal refinement controls. |
| Select sky | Limited | Deterministic top-connected color/luminance analysis; difficult skies may need brush refinement. |
| Select landscape elements | Not available | No independent vegetation, water, ground, architecture, mountain, or snow classes. |
| Dodge and burn | Available | Independent local-light mask layers with tone protection, smooth brushes, familiar shortcuts, and one-step undo. |
| Heal and clone | Available | Bounded manual heal plus aligned or explicit-source clone records that remain attached through geometry changes. |
| Content-aware or generative remove | Not available | No removal model has passed model-rights, tiling, cancellation, persistence, and quality gates. |
| Reflection removal | Not available | There is no reflection-separation model. |
| Background-people removal | Not available | People can be selected for adjustment, but pixels are not synthesized or removed. |
| Red-eye correction | Limited | Precise manual red-eye correction; no automatic eye detection. |
| Pet-eye correction | Limited | Manual green, blue, and yellow eye-reflection correction with catchlight preservation; no automatic detection. |

## Workflow

| Capability | Status | Current behavior |
| --- | --- | --- |
| Presets and batch editing | Available | Built-in looks plus searchable user presets, amount 0–200, safe JSON import/export, one-step undo, and batch sync. |
| Library and culling | Available | Search, metadata, ratings, flags, labels, keywords, paging, keyboard culling, and bounded technical analysis. |
| Assisted culling | Limited | Sharpness and average-exposure checks only; no eye-state, face, or duplicate model. |
| Catalog recovery | Available | Sparse autosave, checksum validation, recovery and last-good records, manual backup/restore, and bounded history. |
| Cloud synchronization | Not available | The project is local-first and has no account, cloud catalog, or conflict-resolution service. |
| Camera-RAW development | Not available | Camera-RAW import and scene-referred demosaicing/profile processing are not implemented. |

See [Architecture](ARCHITECTURE.md), [Security model](SECURITY_MODEL.md),
[Privacy](PRIVACY.md), and [Testing](TESTING.md) for implementation and
verification details. Feature proposals must update this matrix only after the
corresponding behavior and regression coverage exist.
