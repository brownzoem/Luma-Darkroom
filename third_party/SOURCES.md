# Notice bundle sources

This directory records license and notice material for the Windows x64 native
runtime inspected on 2026-08-18. The URLs below are the canonical retrieval
endpoints used by `scripts/fetch-upstream-notices.js`. The helper's `--check`
mode verifies committed checksums and the installed native inventory without
network access. Its `--check-upstream` mode also downloads each remote source
without writing and compares it byte for byte with the committed copy.

| Included file | Canonical source |
| --- | --- |
| `GNU-GPL-3.0.txt` | Free Software Foundation: <https://www.gnu.org/licenses/gpl-3.0.txt> |
| `GNU-LGPL-3.0.txt` | Free Software Foundation: <https://www.gnu.org/licenses/lgpl-3.0.txt> |
| `MPL-2.0.txt` | Mozilla license page: <https://www.mozilla.org/MPL/>; plain-text asset verified 2026-08-18: <https://www.mozilla.org/media/MPL/2.0/index.f75d2927d3c1.txt> |
| `NATIVE_SOURCE_MANIFEST.json` | Release-specific source identities generated and verified by `scripts/build-native-source-bundle.js`; each entry records its immutable upstream URL. |
| `AOM-LICENSE.txt` | AOM 3.14.1 `LICENSE` (Gitiles blob `fc340c37643472ced912d5acc4ec21a722505e30`): <https://aomedia.googlesource.com/aom/+/refs/tags/v3.14.1/LICENSE> |
| `AOM-PATENTS.txt` | AOM 3.14.1 `PATENTS` (Gitiles blob `fc4de9edf8952978e0a84b51cab0f1e37fc47ef7`): <https://aomedia.googlesource.com/aom/+/refs/tags/v3.14.1/PATENTS> |
| `SHARP-LIBVIPS-THIRD-PARTY-NOTICES.md` | sharp-libvips 1.3.1: <https://raw.githubusercontent.com/lovell/sharp-libvips/v1.3.1/THIRD-PARTY-NOTICES.md> |
| `SHARP-WIN32-X64-VERSIONS.json` | Installed `@img/sharp-win32-x64@0.35.3/versions.json`; exact package archive recorded by the lockfile: <https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-0.35.3.tgz> |

The AOM raw endpoints append `?format=TEXT` and return base64-encoded bytes;
the fetch helper decodes them. The npm archive has lockfile integrity
`sha512-D4y1vNeZrIIJCN+uHaWVtH86B+aCrdMYYjicy9pXHvbGZeGYLLSd3wdVuC37FxVXlU1ARsk84eKWfWMXGYEqvA==`.

`SHA256SUMS` identifies the exact committed copies. A matching checksum proves
file identity only; it is not a legal-compliance, authenticity, or security
guarantee. If a source changes, do not silently accept it: inspect the upstream
change, the resolved native package, and the delivered artifact before updating
the committed copy and checksum.

`npm run build:native-source` is the distribution source-retention gate. It
refuses any source whose URL, size, or SHA-256 differs from
`NATIVE_SOURCE_MANIFEST.json` and produces the release-adjacent source archive.
