# Support

Luma Darkroom is community-maintained software. Support is best effort and has
no guaranteed response time, resolution, compatibility commitment, or warranty.

## Before asking for help

1. Back up the catalog from the application if it can still open.
2. Preserve original photographs independently.
3. Try the latest supported release.
4. Reproduce with a disposable copy or a synthetic image.
5. Review [README](README.md), [Privacy](docs/PRIVACY.md), and
   [Security model](docs/SECURITY_MODEL.md).

## Where to ask

Use the repository's normal issue tracker for reproducible bugs and feature
requests. Use [Security](SECURITY.md) for vulnerabilities and the
[Code of Conduct](CODE_OF_CONDUCT.md) private route for conduct reports.

Do not attach real photographs, catalog backups, crash dumps, signing keys, or
logs containing usernames and full paths. Create a minimal sanitized sample
when a file-specific reproduction is essential.

## Useful information

- Luma Darkroom version and source versus packaged build;
- operating-system version and architecture;
- source image format and approximate pixel dimensions;
- exact steps, expected behavior, and actual behavior;
- whether the problem persists after relaunch;
- whether the source file is still present at the cataloged path;
- sanitized console or crash details;
- the smallest non-sensitive reproduction.

## Common problems

### A photograph is missing or will not open

Confirm that the original remains at its cataloged path and that the current
operating-system account can read it. The packaged Windows build accepts JPEG,
PNG, WebP, BMP, GIF, TIFF, and AVIF. Camera-RAW and HEIC files are not currently
supported. The catalog record is retained when decoding fails.

### Export fails on a very large image

Select a smaller long-edge value. Processing is deliberately bounded to reduce
out-of-memory crashes. Confirm that the destination is writable and has enough
free space.

### The catalog reports a storage error

Immediately save a manual catalog backup. Local browser-storage quotas vary.
Removing application data can erase the autosaved catalog, so do not clear it
until a verified backup exists.

### Windows warns about an unknown publisher

The repository's build configuration does not include a code-signing identity.
Local and unofficial installers may therefore trigger a warning. Only run
artifacts from a source you trust. A warning alone does not prove safety or
malice.

### The application starts in compatibility mode

The main process prefers a sandboxed renderer and can retry without the
renderer sandbox after a platform launch failure. Context isolation and
disabled renderer Node integration remain enabled, but this fallback reduces
defense in depth. Include GPU and renderer failure details in a sanitized bug
report.

## Professional recovery

If the only copy of valuable work may be at risk, stop experimenting on that
storage and consult an appropriate data-recovery professional. Project
contributors cannot guarantee recovery or accept responsibility for lost
photographs, edits, metadata, or business interruption.
