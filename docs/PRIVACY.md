# Privacy

## Summary

Luma Darkroom is designed to run locally. The current runtime has no account,
telemetry, advertising, analytics, cloud upload, remote preset service, or
application network API. The page Content Security Policy sets
**connect-src 'none'**, and the main process does not implement an HTTP client
workflow.

This document describes the inspected 2.1.0 source. It is not a warranty,
privacy certification, or promise about modified builds, operating systems,
package registries, hosting platforms, or other software.

## Data the application handles

### Source photographs

The application stores paths to imported photographs and reads image bytes on
demand. Originals remain in their existing filesystem locations. Direct types
are read into the main process; additional formats may be decoded with Sharp
and sent to the renderer as JPEG bytes.

The current application does not upload photographs. The operating system,
filesystem provider, backup software, synchronized folder, antivirus product,
or a modified distribution may behave independently of Luma Darkroom.

### Catalog and metadata

Electron local browser storage contains:

- source paths and display names;
- edit instructions and cleanup coordinates;
- ratings, flags, color labels, keywords, and captions;
- quality-analysis scores and issue labels;
- import timestamps and internal IDs;
- catalog checksum, save time, and generation;
- up to three recent watermark strings.

The application maintains a primary catalog, an in-progress recovery copy, and
for small catalogs a previous last-good copy. A legacy catalog key may remain
after migration. These copies exist to improve recovery and can contain older
metadata values.

### Memory caches

The renderer retains the active decoded image and at most four neighboring
prefetch Image objects. The main process may retain up to three converted image
buffers totaling at most 256 MB. These are memory caches, not intentional disk
thumbnail archives, but operating systems can page process memory to disk.

### Exports and backups

Exports, original copies, and JSON catalog backups are written to a location
chosen in a native save dialog. These files remain until the user or another
program removes them. A catalog backup contains paths, edits, and metadata but
not source-image bytes.

### Crash data and logs

Electron crash reporting is enabled with upload disabled. Crash artifacts may
be written to Electron's local crash-dump directory. Console logs remain local
unless a user, diagnostic tool, operating system, or modified build captures or
shares them. Logs and dumps can contain technical details; inspect and redact
them before sharing.

## Network behavior

Runtime photo editing does not require a network connection. Installing npm
dependencies, building Electron, obtaining an installer, checking a source
hosting site, or using operating-system services can involve network access
outside the running application.

The project has no auto-update implementation. A distributor that adds updates,
telemetry, remote AI, cloud storage, or online assets must disclose and secure
that behavior and must not present this document unchanged as describing the
modified build.

## Storage location and retention

Autosaved data resides under Electron's per-user application-data location for
the application. The installer identity is **com.luma.darkroom**, but the exact
user-data directory name and path are determined by Electron and the operating
system and should not be inferred from that identifier.

Luma Darkroom currently has no in-app erase-all control. To remove data:

1. save any catalog backup or export that should be retained;
2. close the application;
3. uninstall the application if desired;
4. remove its per-user application-data directory using operating-system
   tools;
5. separately remove manual backups, exports, crash dumps, and originals as
   appropriate.

Uninstallers do not always remove user data. Deletion, backups, filesystem
snapshots, and secure erasure depend on the operating system and storage device.

## Security and confidentiality

The catalog and watermark history are not encrypted by Luma Darkroom. The
application has no login, access-control layer, or separation between people
who can use the same operating-system account. Anyone able to read application
data may be able to learn paths, filenames, captions, tags, ratings, and edits.

Use operating-system account security, disk encryption, restrictive filesystem
permissions, and appropriate backup protection for sensitive work. Do not
assume that a catalog backup is safe to publish merely because it excludes
image bytes.

See [Security model](SECURITY_MODEL.md) and [Security](../SECURITY.md).

## Sharing diagnostics

Before attaching material to an issue:

- reproduce with a synthetic or public-domain test image where possible;
- remove usernames, client names, paths, captions, keywords, and identifiers;
- do not upload a real catalog or crash dump publicly;
- use the private reporting route for a suspected vulnerability.

## Children, regulated data, and legal compliance

The project does not operate an account service or intentionally collect data
from users, including children. That design statement does not determine
whether a user's own photo workflow is subject to privacy, employment,
biometric, records-management, contractual, or other law. Users and
distributors are responsible for their own obligations. No compliance,
confidentiality, retention, or deletion outcome is guaranteed.

## Policy changes

A contribution that changes runtime data collection, network access, storage,
retention, or disclosure must update this document, the architecture and
security model, user-facing consent or controls where appropriate, and release
notes before distribution.
