# Third-party notices

Luma Darkroom includes and uses third-party software. Those components are
licensed by their respective authors under their own terms. This file is an
inventory and attribution aid based on **package-lock.json**, the installed
packages, and the Windows x64 application inputs inspected on 2026-08-20. It
is not legal advice or a guarantee that a particular distribution satisfies
every obligation.

Dependency versions and platform payloads can change. Distributors must repeat
the inventory for the exact artifact they publish, preserve upstream notices,
and provide any source, relinking, patent, or license materials required by the
applicable terms.

## Distribution status

The source packaging configuration now includes the project **LICENSE**, this
notice, the installed **@img/sharp-win32-x64/README.md**, and every file under
[third_party](third_party/). The bundled directory contains the complete GNU
GPLv3 and LGPLv3 texts, Mozilla Public License 2.0, AOM software and patent
licenses, the Sharp/libvips notice table, the exact Windows native version
inventory, checksums, canonical source locations, and practical library
replacement information.

The release process also produces a version-matched native source archive from
the checked-in `NATIVE_SOURCE_MANIFEST.json`. It retains the reported
LGPL-family sources, Cairo source, exact matching build and packaging recipes,
and sharp source. That source archive is distributed alongside the Windows
installer rather than embedded inside it.

This remediates the previously identified source-configuration gap. It does not
retroactively repair an installer already built, and it does not prove that a
new artifact contains every required file. Before publishing, verify the exact
delivered installer and unpacked application as required by
[Releasing](docs/RELEASING.md). Preserve upstream notices and any corresponding
source or relinking materials required for the actual binaries.

## Runtime components

### Electron 43.4.0

- License: MIT
- Copyright: Electron contributors; 2013–2020 GitHub Inc.
- Use: desktop runtime

Electron includes Chromium, Node.js, and many other components. The generated
Windows application contains **LICENSE.electron.txt** and
**LICENSES.chromium.html**. Preserve both files unmodified with every Electron
binary distribution. The Chromium notice file is the authoritative detailed
inventory for those embedded components and is intentionally not reproduced
here.

### ONNX Runtime Web 1.27.0

- License: MIT
- Copyright: Microsoft Corporation and contributors
- Use: local, offline execution of optional image-selection models in a Web Worker

The npm package also brings in `onnxruntime-common`, FlatBuffers, protobufjs,
Long, platform.js, and small JavaScript support packages under their respective
MIT, Apache-2.0, BSD-3-Clause, or ISC terms. The complete upstream ONNX Runtime
MIT license and its release-pinned third-party notice are included as
`third_party/ONNXRUNTIME-MIT.txt` and
`third_party/ONNXRUNTIME-THIRD-PARTY-NOTICES.txt`. Preserve both with every
binary distribution that contains ONNX Runtime Web or its WASM runtime.

Optional EfficientSAM-Ti and PP-HumanSeg model files are not bundled in the
installer. Luma downloads them only after explicit approval from immutable
OpenCV Zoo commit `47534e27c9851bb1128ccc0102f1145e27f23f98`, verifies their
exact sizes and SHA-256 values, and stores them locally. OpenCV Zoo documents
those model packages as Apache-2.0. Their upstream training-image provenance is
not a warranty from this project; redistributors must perform their own review
before pre-bundling or mirroring model files.

### sharp 0.35.3

- License: Apache-2.0
- Copyright: 2013 Lovell Fuller and contributors
- Use: source-image decoding/conversion and TIFF encoding

### @img/sharp-win32-x64 0.35.3

- License declared by the package: Apache-2.0 AND LGPL-3.0-or-later
- Copyright: 2013 Lovell Fuller and contributors
- Use: Windows x64 native Sharp payload and bundled image libraries

The installed platform package reports the following embedded libraries:

| Component | Version or revision | Reported license family |
| --- | --- | --- |
| FriBidi | 1.0.16 | LGPL |
| GLib | 2.89.0 | LGPL |
| libexif | 0.6.26 | LGPL |
| libheif | 1.23.0 | LGPL |
| librsvg | 2.62.3 | LGPL |
| libvips | 8.18.3 | LGPL |
| Pango | 1.57.1 | LGPL |
| proxy-libintl | 0.5 | LGPL |
| Cairo | 1.18.4 | MPL-2.0 |
| AOM | 3.14.1 | BSD-2-Clause and Alliance for Open Media Patent License 1.0 |
| libarchive | 3.8.7 | BSD-2-Clause |
| libimagequant | 2.4.1 | BSD-2-Clause |
| Highway | 1.4.0 | BSD-3-Clause |
| libwebp | 1.6.0 | BSD-3-Clause |
| cgif | 0.5.3 | MIT |
| Expat | 2.8.1 | MIT |
| libffi | 3.5.2 | MIT |
| HarfBuzz | 14.2.1 | MIT |
| Little CMS | 2.19.1 | MIT |
| libultrahdr | revision 13a058f | MIT |
| libxml2 | 2.15.3 | MIT |
| libnsgif | version not recorded | MIT |
| fontconfig | 2.18.1 | Upstream permissive/custom terms |
| FreeType | 2.14.3 | FreeType or GPL terms |
| libpng | 1.6.58 | libpng license |
| libtiff | revision 732665c | libtiff license |
| mozjpeg | revision 0826579 | zlib, IJG, and BSD-3-Clause terms |
| zlib-ng | 2.3.3 | zlib terms |

The short labels above are not substitutes for the complete upstream license
texts. In particular, distributors must review LGPL replacement/relinking and
reverse-engineering rights, corresponding-source availability, Cairo's MPL
requirements, and the AOM patent-license terms for the exact binary payload.
Do not infer compliance from the npm package's top-level Apache license alone.
The packaged copies and their provenance are indexed in
[third_party/SOURCES.md](third_party/SOURCES.md), while
[third_party/SOURCE_AVAILABILITY.md](third_party/SOURCE_AVAILABILITY.md)
records source locations and replacement guidance for this Windows payload.

### @img/colour 1.1.0

- License: MIT
- Use: Sharp color dependency

Its installed license aggregates notices for:

- **color**, copyright Heather Arthur, 2012;
- **color-convert**, copyright Heather Arthur, 2011–2016, and Josh Junon,
  2016–2021;
- **color-string**, copyright Heather Arthur, 2011;
- **color-name**, copyright Dmitry Ivanov, 2015.

### detect-libc 2.1.2

- License: Apache-2.0
- Copyright: 2017 Lovell Fuller and contributors
- Use: Sharp platform detection

### semver 7.8.5

- License: ISC
- Copyright: Isaac Z. Schlueter and contributors
- Use: Sharp runtime dependency

## Direct development and release tools

These packages are present in the locked development tree but are not intended
to be shipped inside the application ASAR:

| Package | Resolved version | License | Purpose |
| --- | --- | --- | --- |
| electron-builder | 26.15.3 | MIT | Packaging and NSIS installer creation |
| playwright-core | 1.62.1 | Apache-2.0 | Browser/Electron test automation |

Playwright's NOTICE attributes Microsoft Corporation and code derived from
Puppeteer, which is available under Apache-2.0. Preserve that NOTICE if
Playwright is ever redistributed.

Electron is declared as a development dependency but its 43.4.0 runtime is the
desktop runtime shipped with packaged applications, so its runtime notices are
listed above.

## Locked dependency-license summary

The current lockfile contains 375 package entries excluding the project root:
50 production or platform-optional entries and 325 development entries. Every
entry declares license metadata. Counts include packages for platforms that are
not present in the inspected Windows x64 application.

| Declared SPDX expression | Lockfile entries |
| --- | ---: |
| MIT | 250 |
| ISC | 45 |
| Apache-2.0 | 23 |
| BlueOak-1.0.0 | 12 |
| LGPL-3.0-or-later | 10 |
| BSD-3-Clause | 19 |
| BSD-2-Clause | 6 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| Python-2.0 | 1 |
| WTFPL OR ISC | 1 |
| WTFPL | 1 |
| 0BSD | 1 |
| (MIT OR CC0-1.0) | 1 |
| (WTFPL OR MIT) | 1 |

Less-common build-tree packages include **argparse** under Python-2.0,
**truncate-utf8-bytes** under WTFPL, **sanitize-filename** under WTFPL OR ISC,
**utf8-byte-length** under WTFPL OR MIT, **type-fest 0.13.1** under MIT OR
CC0-1.0, and several BlueOak-1.0.0 packages. Their complete terms remain in
their installed package directories after **npm ci**.

## Installer toolchain

The generated installer uses NSIS components obtained by electron-builder.
Those artifact-level components are not represented completely by
**package-lock.json**. The inspected toolchain identifies NSIS 3.0.4.1 and
notices covering, among other components, zlib/libpng, bzip2, and CPL-1.0
material. Release maintainers must inspect and preserve the exact NSIS
COPYING/license payload used for each installer.

## Locating complete terms

After **npm ci**, package license and notice files are available beneath
**node_modules**. The unpacked Electron application supplies the Electron and
Chromium files named above. Sharp platform-package metadata and its README
identify the native payload. The committed [third-party bundle](third_party/)
records the complete copyleft and AOM terms added for this payload, exact source
URLs, checksums, source-availability information, and library replacement
guidance. Corresponding upstream locations also remain in package metadata and
the lockfile.

If this inventory conflicts with an included upstream license or notice, the
upstream text controls. Report discrepancies as documentation bugs and do not
remove an upstream notice merely because it is absent from this summary.
