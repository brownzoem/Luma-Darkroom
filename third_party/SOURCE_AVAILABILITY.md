# Native source availability and library replacement

This notice covers the Windows x64 native image stack shipped through
`@img/sharp-win32-x64@0.35.3`. It is an operational aid, not legal advice and
not a conclusion that any particular artifact satisfies every license term.
Distributors remain responsible for the exact binaries they publish.

## Exact binary inventory

`SHARP-WIN32-X64-VERSIONS.json` is copied from the installed platform package
and is the controlling version inventory for this release line. The npm package
archive and its lockfile integrity are recorded in `SOURCES.md`. The generic
Sharp/libvips notice table is retained separately because short license-family
labels are not substitutes for the complete texts.

`NATIVE_SOURCE_MANIFEST.json` pins the immutable retrieval URL, byte size, and
SHA-256 value of each retained source snapshot for this release. Running
`npm run build:native-source` downloads and verifies those sources, then creates
`Luma-Darkroom-2.2.0-Native-Corresponding-Source.zip`. The release archive
contains all reported LGPL-family component sources, Cairo source, matching
Windows build recipes and patches, matching native packaging recipes, and the
sharp source. Publish that archive next to every 2.2.0 Windows installer and
keep it available for as long as the binary is offered.

## Corresponding source locations

The native package reports these LGPL-family components. These upstream
locations provide the indicated source versions:

| Component | Version | Source |
| --- | --- | --- |
| FriBidi | 1.0.16 | <https://github.com/fribidi/fribidi/releases/tag/v1.0.16> |
| GLib | 2.89.0 | <https://download.gnome.org/sources/glib/2.89/glib-2.89.0.tar.xz> |
| libexif | 0.6.26 | <https://github.com/libexif/libexif/releases/tag/v0.6.26> |
| libheif | 1.23.0 | <https://github.com/strukturag/libheif/releases/tag/v1.23.0> |
| librsvg | 2.62.3 | <https://download.gnome.org/sources/librsvg/2.62/librsvg-2.62.3.tar.xz> |
| libvips | 8.18.3 | <https://github.com/libvips/libvips/releases/tag/v8.18.3> |
| Pango | 1.57.1 | <https://download.gnome.org/sources/pango/1.57/pango-1.57.1.tar.xz> |
| proxy-libintl | 0.5 | <https://github.com/frida/proxy-libintl/tree/0.5> |

Related copyleft and patent-bearing native sources are available from:

- Cairo 1.18.4: <https://cairographics.org/releases/cairo-1.18.4.tar.xz>
- AOM 3.14.1: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.14.1/>
- Windows libvips build recipes at `bca68727eb1df12c5d2b204a13a392989d505774`:
  <https://github.com/libvips/build-win64-mxe/tree/bca68727eb1df12c5d2b204a13a392989d505774>
- Native packaging recipes at `a2d035c4b72d8f33942c2dfa8e020e49fcacc0dc`:
  <https://github.com/lovell/sharp-libvips/tree/a2d035c4b72d8f33942c2dfa8e020e49fcacc0dc>
- Sharp 0.35.3 source: <https://github.com/lovell/sharp/tree/v0.35.3>

Release maintainers must still review the generated archive against the exact
binary artifact they distribute. The checked-in manifest prevents silent source
substitution, while the adjacent release asset prevents continued availability
from depending only on moving upstream branches or third-party retention.

## Replacing the shared libraries

In a packaged Windows installation, electron-builder normally unpacks the
native package beneath:

`resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/`

The source tree uses the equivalent path beneath `node_modules`. The package
contains `libvips-42.dll`, `libvips-cpp-8.18.3.dll`, and the Sharp native
addon. Luma Darkroom does not add a checksum or signature check that prevents
replacement of those DLLs.

To test a modified, interface-compatible build, close the application, preserve
a recoverable copy of the original directory, and replace the two libvips DLLs
together with Windows x64 builds that keep the expected filenames and ABI. If
the ABI changes, the Sharp native addon may also need to be rebuilt from source.
Test only with disposable images first. Operating-system policy, antivirus, or
code signing may independently block a modified binary.

No warranty or support promise is made for replacement builds. Nothing in the
project's terms is intended to prohibit reverse engineering of the covered
libraries for debugging modifications where the applicable license grants that
right.
