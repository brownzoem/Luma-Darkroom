const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const releaseDir = path.join(root, 'outputs', 'release');
const bundleName = `Luma-Darkroom-${pkg.version}-Native-Corresponding-Source`;
const staging = path.join(releaseDir, bundleName);
const archive = path.join(releaseDir, `${bundleName}.zip`);
const committedManifestPath = path.join(root, 'third_party', 'NATIVE_SOURCE_MANIFEST.json');
const bootstrap = process.argv.includes('--bootstrap');

const sources = [
  { component: 'FriBidi', version: '1.0.16', file: 'fribidi-1.0.16.tar.gz', url: 'https://codeload.github.com/fribidi/fribidi/tar.gz/refs/tags/v1.0.16' },
  { component: 'GLib', version: '2.89.0', file: 'glib-2.89.0.tar.xz', url: 'https://download.gnome.org/sources/glib/2.89/glib-2.89.0.tar.xz' },
  { component: 'libexif', version: '0.6.26', file: 'libexif-0.6.26.tar.gz', url: 'https://codeload.github.com/libexif/libexif/tar.gz/refs/tags/v0.6.26' },
  { component: 'libheif', version: '1.23.0', file: 'libheif-1.23.0.tar.gz', url: 'https://codeload.github.com/strukturag/libheif/tar.gz/refs/tags/v1.23.0' },
  { component: 'librsvg', version: '2.62.3', file: 'librsvg-2.62.3.tar.xz', url: 'https://download.gnome.org/sources/librsvg/2.62/librsvg-2.62.3.tar.xz' },
  { component: 'libvips', version: '8.18.3', file: 'libvips-8.18.3.tar.gz', url: 'https://codeload.github.com/libvips/libvips/tar.gz/refs/tags/v8.18.3' },
  { component: 'Pango', version: '1.57.1', file: 'pango-1.57.1.tar.xz', url: 'https://download.gnome.org/sources/pango/1.57/pango-1.57.1.tar.xz' },
  { component: 'proxy-libintl', version: '0.5', file: 'proxy-libintl-0.5.tar.gz', url: 'https://codeload.github.com/frida/proxy-libintl/tar.gz/refs/tags/0.5' },
  { component: 'Cairo', version: '1.18.4', file: 'cairo-1.18.4.tar.xz', url: 'https://cairographics.org/releases/cairo-1.18.4.tar.xz' },
  { component: 'Windows build recipes', version: 'bca68727eb1df12c5d2b204a13a392989d505774', file: 'build-win64-mxe-bca68727.tar.gz', url: 'https://codeload.github.com/libvips/build-win64-mxe/tar.gz/bca68727eb1df12c5d2b204a13a392989d505774' },
  { component: 'Native packaging recipes', version: 'a2d035c4b72d8f33942c2dfa8e020e49fcacc0dc', file: 'sharp-libvips-a2d035c4.tar.gz', url: 'https://codeload.github.com/lovell/sharp-libvips/tar.gz/a2d035c4b72d8f33942c2dfa8e020e49fcacc0dc' },
  { component: 'sharp', version: '0.35.3', file: 'sharp-0.35.3.tar.gz', url: 'https://codeload.github.com/lovell/sharp/tar.gz/refs/tags/v0.35.3' },
];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertSafeOutput(target) {
  const relative = path.relative(releaseDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to replace path outside the release directory: ${target}`);
  }
}

async function fetchBytes(source) {
  const response = await fetch(source.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
    headers: {
      'User-Agent': `Luma-Darkroom-source-bundle/${pkg.version} (+https://lumadarkroom.com)`,
      Accept: 'application/octet-stream, application/x-xz, application/gzip;q=0.9, */*;q=0.1',
    },
  });
  if (!response.ok) throw new Error(`${source.component}: ${response.url} returned HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 250_000_000) throw new Error(`${source.component}: declared source archive is unexpectedly large`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000 || bytes.length > 250_000_000) throw new Error(`${source.component}: source archive size is outside the safety bounds`);
  return bytes;
}

async function readExpectedManifest() {
  try {
    const manifest = JSON.parse(await fs.readFile(committedManifestPath, 'utf8'));
    if (manifest.release !== pkg.version || !Array.isArray(manifest.sources)) throw new Error('manifest release or sources are invalid');
    return new Map(manifest.sources.map(source => [source.file, source]));
  } catch (error) {
    if (bootstrap && error?.code === 'ENOENT') return new Map();
    throw new Error(`Native source manifest is unavailable or invalid: ${error.message}`);
  }
}

async function main() {
  const expected = await readExpectedManifest();
  assertSafeOutput(staging);
  assertSafeOutput(archive);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.rm(archive, { force: true });
  await fs.mkdir(path.join(staging, 'archives'), { recursive: true });

  const resolved = [];
  for (const source of sources) {
    const bytes = await fetchBytes(source);
    const record = { ...source, bytes: bytes.length, sha256: sha256(bytes) };
    const pinned = expected.get(source.file);
    if (!bootstrap && (!pinned || pinned.sha256 !== record.sha256 || pinned.bytes !== record.bytes || pinned.url !== record.url)) {
      throw new Error(`${source.file}: source identity differs from third_party/NATIVE_SOURCE_MANIFEST.json`);
    }
    await fs.writeFile(path.join(staging, 'archives', source.file), bytes, { flag: 'wx' });
    resolved.push(record);
    process.stdout.write(`${source.file}: ${bytes.length} bytes ${record.sha256}\n`);
  }

  const manifest = {
    release: pkg.version,
    platformPayload: '@img/sharp-win32-x64@0.35.3',
    nativeInventory: 'third_party/SHARP-WIN32-X64-VERSIONS.json',
    generatedAt: new Date().toISOString(),
    sources: resolved,
  };
  const sums = resolved.map(source => `${source.sha256}  archives/${source.file}`).join('\n') + '\n';
  const readme = `# Native corresponding-source bundle\n\nThis release-specific bundle accompanies Luma Darkroom ${pkg.version} for Windows x64. It retains exact source snapshots for every LGPL-family component reported by the shipped native payload, Cairo under MPL-2.0, the matching Windows build recipes and patches, the matching native packaging recipes, and sharp ${sources.at(-1).version}.\n\nThe build-recipe revisions were selected because their recorded dependency versions match the installed \`@img/sharp-win32-x64@0.35.3\` inventory. The application loads the native shared libraries at runtime and does not add a checksum or signature requirement that prevents replacement. See the installed \`resources/licenses/third_party/SOURCE_AVAILABILITY.md\` for replacement guidance.\n\n\`MANIFEST.json\` records immutable retrieval URLs, byte sizes, and SHA-256 values. \`SHA256SUMS\` covers every retained archive. Upstream license terms control; this bundle is provided to preserve source availability and is not legal advice or a warranty that modified binaries will function.\n`;
  await fs.writeFile(path.join(staging, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await fs.writeFile(path.join(staging, 'SHA256SUMS'), sums, { flag: 'wx' });
  await fs.writeFile(path.join(staging, 'README.md'), readme, { flag: 'wx' });

  if (bootstrap) {
    const generated = path.join(releaseDir, 'NATIVE_SOURCE_MANIFEST.generated.json');
    assertSafeOutput(generated);
    await fs.writeFile(generated, `${JSON.stringify({ ...manifest, generatedAt: undefined }, null, 2)}\n`);
    process.stdout.write(`Bootstrap manifest: ${generated}\n`);
  }

  const result = spawnSync('tar.exe', ['-a', '-cf', archive, '-C', releaseDir, bundleName], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Could not create source archive: ${result.stderr || result.stdout}`);
  const archiveBytes = await fs.readFile(archive);
  process.stdout.write(`${archive}: ${archiveBytes.length} bytes ${sha256(archiveBytes)}\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
