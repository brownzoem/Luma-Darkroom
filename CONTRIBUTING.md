# Contributing to Luma Darkroom

Thank you for helping improve Luma Darkroom. Contributions may include bug
reports, design discussion, documentation, tests, accessibility work, and code.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
Potential vulnerabilities must follow [Security](SECURITY.md), not the normal
issue workflow.

## Before starting

1. Search existing issues and changes to avoid duplicate work.
2. Open an issue for a substantial feature, dependency, data-format change, or
   security-boundary change before investing in implementation.
3. Keep a pull request focused. Unrelated refactors make review and recovery
   harder.
4. Do not submit photographs, catalogs, crash dumps, file paths, credentials,
   signing material, or other private data.

No response time or acceptance is guaranteed. Maintainers may decline work
that conflicts with the local-first scope, reliability goals, or available
maintenance capacity.

## Development setup

Prerequisites are a Node.js/npm environment supported by the locked
dependencies and, for installer creation, Windows.

    npm ci
    npm start

The application intentionally has no renderer bundler. Source files are loaded
directly by Electron. Do not introduce a framework or build step without prior
design agreement.

## Required checks

Run the checks relevant to the change. At minimum:

    node --check electron/main.js
    node --check electron/preload.js
    node --check src/engine.js
    node --check src/app.js

Then exercise the affected workflow manually with disposable test images:

- launch, import, navigate, edit, undo/redo, close, and relaunch;
- compare preview and export;
- test a missing, corrupt, unusually large, and unsupported image;
- verify that canceling each filesystem dialog leaves state unchanged;
- verify catalog backup and restore with both valid and invalid JSON;
- check keyboard-only use and visible focus where UI changed.

For release-impacting changes, also run:

    npm run dist

Inspect the unpacked application and installer according to
[Releasing](docs/RELEASING.md).

## Engineering principles

- Preserve originals. Editing operations should change catalog instructions,
  never source bytes.
- Keep runtime behavior local by default. A network feature, telemetry, or
  remote service requires explicit design review and updates to privacy and
  security documentation.
- Treat images, catalogs, IPC messages, paths, metadata, and filenames as
  untrusted input.
- Maintain context isolation, disabled renderer Node integration, navigation
  restrictions, permission denial, and a narrow preload bridge.
- Validate IPC in the main process even when the renderer already validates it.
- Bound image dimensions, payloads, caches, arrays, histories, and long-running
  work. Prefer recoverable errors to renderer or main-process termination.
- Keep preview and export behavior driven by the same edit schema and engine.
- Migrate persisted data defensively. Never silently overwrite an unreadable
  catalog with an empty one.
- Avoid synchronous filesystem work on normal interaction paths.
- Use plain, accessible HTML controls before custom interaction widgets.

## Source style

- Use two-space indentation, UTF-8, LF line endings, semicolons where the
  surrounding file uses them, and descriptive names for security-sensitive
  limits.
- Preserve the existing plain-JavaScript style unless a separate refactor is
  approved.
- Escape user-visible strings inserted into HTML; prefer DOM construction when
  practical.
- Explain non-obvious bounds, migrations, and trust decisions in code or docs.
- Avoid unrelated formatting churn in compact source files.

## Dependencies and assets

New dependencies must have a clear benefit, an actively reviewed maintenance
story, and a license compatible with distribution. Update
[Third-party notices](THIRD_PARTY_NOTICES.md) and the lockfile when dependency
metadata changes.

Only submit images, icons, preset recipes, or other assets that you created or
have permission to distribute. Record provenance. Do not copy proprietary
third-party assets, profiles, presets, documentation, branding, or interface
artwork.

## Pull requests

A pull request should include:

- the problem and intended user outcome;
- a concise implementation explanation;
- risks to catalogs, source files, memory, privacy, and security;
- tests run and their results;
- screenshots for visible UI changes, using non-sensitive test images;
- documentation, migration, and third-party-notice updates where applicable.

By submitting a contribution for inclusion, you agree that it may be licensed
under the repository's MIT License, unless a file is clearly submitted under a
compatible separate license accepted by maintainers. This statement is not
legal advice or a warranty that a contribution can be accepted.
