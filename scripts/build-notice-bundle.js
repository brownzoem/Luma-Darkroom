const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const releaseDir = path.join(root, 'outputs', 'release');
const bundleName = `Luma-Darkroom-${pkg.version}-Third-Party-Notices`;
const staging = path.join(releaseDir, bundleName);
const archive = path.join(releaseDir, `${bundleName}.zip`);

function assertSafeOutput(target) {
  const relative = path.relative(releaseDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to replace path outside the release directory: ${target}`);
  }
}

async function copy(relativeSource, relativeTarget = relativeSource) {
  const source = path.join(root, relativeSource);
  const target = path.join(staging, relativeTarget);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
}

async function main() {
  assertSafeOutput(staging);
  assertSafeOutput(archive);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.rm(archive, { force: true });
  await fs.mkdir(staging, { recursive: true });

  await copy('LICENSE');
  await copy('THIRD_PARTY_NOTICES.md');
  await copy('third_party');
  await copy('node_modules/sharp/LICENSE', 'packages/sharp/Apache-2.0.txt');
  await copy('node_modules/@img/sharp-win32-x64/LICENSE', 'packages/sharp-win32-x64/Apache-2.0.txt');
  await copy('node_modules/@img/sharp-win32-x64/README.md', 'packages/sharp-win32-x64/NATIVE-LIBRARY-NOTICES.md');
  await copy('node_modules/@img/colour/LICENSE.md', 'packages/colour/LICENSES.md');
  await copy('node_modules/electron/dist/LICENSE', 'runtime/LICENSE.electron.txt');
  await copy('node_modules/electron/dist/LICENSES.chromium.html', 'runtime/LICENSES.chromium.html');
  await fs.writeFile(path.join(staging, 'README.md'), `# Luma Darkroom ${pkg.version} notice bundle\n\nThis release-adjacent archive mirrors the license, copyright, source-location, patent, and library-replacement materials delivered with the Windows x64 installation. Upstream terms control if this index conflicts with an included license.\n`);

  const result = spawnSync('tar.exe', ['-a', '-cf', archive, '-C', releaseDir, bundleName], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Could not create notice archive: ${result.stderr || result.stdout}`);
  const stat = await fs.stat(archive);
  process.stdout.write(`${archive}: ${stat.size} bytes\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
