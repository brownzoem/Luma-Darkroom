# Security model

## Purpose and assumptions

This document records intended trust boundaries and known limitations of the
2.3.0 codebase. It helps reviewers reason about changes; it is not a formal
audit, proof, certification, warranty, or legal guarantee.

The model assumes:

- the operating-system account and installed application files are trusted;
- imported images and catalog backups may be malformed or hostile;
- filenames, paths, metadata, control values, and renderer messages are
  untrusted;
- an attacker who already controls the user's operating-system account is
  outside the primary boundary;
- unofficial or modified builds can change every property described here.

## Assets

- original photograph bytes and filesystem locations;
- edit instructions, ratings, flags, labels, tags, captions, and quality data;
- catalog recovery and backup copies;
- exported photographs and original-file copies;
- application code-signing material, if a distributor uses any;
- the privilege boundary between renderer and main process.

The most important safety property is that routine editing must not write,
move, delete, or overwrite an original photograph.

## Boundaries

### Renderer

The renderer parses catalog data, constructs HTML, processes image pixels, and
requests privileged operations. It should be treated as lower privilege than
the main process.

Controls include:

- **contextIsolation: true**;
- **nodeIntegration: false**;
- a Content Security Policy with no default resources and no network connects;
- denied permission requests;
- denied new windows;
- navigation limited to the packaged local page;
- bounded and migrated catalog values;
- HTML escaping for catalog-derived display strings.

The main process prefers **sandbox: true**. If the renderer process exits with
the Electron **launch-failed** reason, the application retries once with
**sandbox: false** for platform compatibility. Context isolation and disabled
Node integration remain enabled, but the fallback reduces defense in depth and
must not be described as equivalent to full renderer sandboxing.

### Preload bridge

The preload exposes eight narrow functions rather than raw Electron APIs. It
does not expose arbitrary IPC channel names. Every privileged message must
still be validated by the main process because renderer-side checks are not a
security boundary.

### Main process and filesystem

The main process has Node and filesystem privileges. Native dialogs determine
import and save locations. Supported operations are bounded image read,
best-effort conversion, export write, original copy, catalog backup read/write,
and reveal-in-folder.

Writes use a destination-directory temporary file, flush, and rename. This
reduces partial outputs but does not eliminate filesystem races, device
failure, malicious mount behavior, symbolic-link concerns, or all
time-of-check/time-of-use cases.

### Custom image scheme

The **local-image:** handler requires an absolute existing regular-file path, a
recognized extension, and a size below the direct or converted limit. It
returns a restricted content type with no-sniff and private cache headers.
Sharp conversion has a pixel limit and failures return an error response.

The handler does not maintain an allowlist of catalog-selected paths. A
compromised renderer could request any supported image path readable by the
current operating-system account. CSP, packaged-code integrity, navigation
blocking, and the renderer boundary are therefore important mitigations. A
future capability/token allowlist would narrow this exposure.

### Native decoders

Sharp/libvips and Electron image codecs process complex untrusted formats in
native code. Size and pixel limits reduce resource risk but do not eliminate
decoder vulnerabilities. Dependency updates and malformed-file tests remain
security work.

## IPC validation

| Channel | Main-process validation |
| --- | --- |
| pick-images | Native filtered dialog; returns selected paths |
| export-image | Object payload, allowed encoded-image MIME, binary or legacy Base64 form, 350 MB payload limit, decoded-pixel and format validation, sanitized suggested name |
| copy-original | String path, existence, recognized extension, native save destination |
| reveal-file | Absolute existing path and image/catalog extension allowlist |
| save-catalog | String input and 50 MB limit |
| open-catalog | Native file selection, regular file, 50 MB limit |

Export and backup destinations come from save dialogs. The application does not
accept a renderer-specified arbitrary destination path.

## Catalog defenses

- The renderer caps catalog string length and record count before use.
- A catalog envelope includes generation, timestamp, and checksum.
- Primary, recovery, and last-good candidates are parsed independently.
- Records and edit keys are whitelisted and normalized.
- Prototype-related keys and unknown edit properties are ignored.
- Non-finite and extreme values are replaced or bounded.
- Strings, tags, curve points, mask layers/strokes, retouch points, history,
  workers, and caches are capped.
- Duplicate paths are skipped and duplicate IDs are replaced.
- A completely unreadable catalog is preserved rather than autosaved as empty.
- Restore happens in memory only after complete validation.

A checksum detects accidental inconsistency; it is not a signature or
authenticator. Anyone able to modify local storage can replace both content and
checksum.

## Availability and resource controls

The code bounds input file size, decode pixels, cache bytes/count, catalog
bytes/count, history entries, cleanup spots, prefetch count, merge count,
panorama size, output canvas size, image-load time, and export IPC size.

These limits mitigate common out-of-memory and denial-of-service paths. They do
not guarantee availability at the maximum on every computer. Canvas and native
decoder memory can exceed simple byte estimates.

## Runtime network and crash behavior

The renderer's CSP denies network connections. No runtime telemetry or updater
is implemented. Electron crashReporter is started with **uploadToServer:
false**, so crash dumps are local unless another system collects them.

Installation and build dependencies can use the network outside the running
application. The operating system may perform its own reputation checks or
diagnostics.

## Known limitations

- The Windows installer is not configured for code signing. Users cannot rely
  on publisher identity from the current build.
- The sandbox compatibility fallback weakens renderer isolation.
- The custom image scheme authorizes by readable absolute path and extension,
  not an import-scoped token.
- Local browser storage and backups are unencrypted and unauthenticated.
- There is no automatic dependency-vulnerability scanning or update mechanism
  represented in the repository scripts.
- Native decoders remain a significant input surface.
- Large encoded exports can still duplicate memory across the worker, renderer,
  IPC, and main process.
- Atomic writes reduce but cannot eliminate storage failure.
- There is no secure erase, multi-user authorization, or tamper-evident audit
  log.
- Third-party notice packaging requires the release action documented in
  [Third-party notices](../THIRD_PARTY_NOTICES.md).

## Review checklist for boundary changes

- Can an untrusted image, catalog, filename, or UI string reach this code?
- Does the renderer gain a new privileged primitive?
- Is validation repeated in main, with explicit type and size bounds?
- Does the change write, replace, move, reveal, or delete a path?
- Can cancellation or a crash leave a partial file or corrupt catalog?
- Are caches, queues, arrays, dimensions, and time bounded?
- Does a network connection or new stored field require a privacy update?
- Does a native dependency add codecs, binaries, notices, or source duties?
- Is sandbox-fallback behavior still safe enough for the new capability?

Report vulnerabilities through [Security](../SECURITY.md).
