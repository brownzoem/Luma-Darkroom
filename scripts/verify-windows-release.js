const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseDir = path.join(root, 'outputs', 'release');
const installerName = `Luma-Darkroom-Setup-${pkg.version}.exe`;
const installer = path.join(releaseDir, installerName);
const sourceBundleName = `Luma-Darkroom-${pkg.version}-Native-Corresponding-Source.zip`;
const noticeBundleName = `Luma-Darkroom-${pkg.version}-Third-Party-Notices.zip`;
const sourceBundle = path.join(releaseDir, sourceBundleName);
const noticeBundle = path.join(releaseDir, noticeBundleName);
const unpacked = path.join(releaseDir, 'win-unpacked');
const appAsar = path.join(unpacked, 'resources', 'app.asar');

const requiredFiles = [
  'Luma Darkroom.exe',
  'LICENSE.electron.txt',
  'LICENSES.chromium.html',
  'resources/app.asar',
  'resources/licenses/LUMA-DARKROOM-MIT.txt',
  'resources/licenses/THIRD_PARTY_NOTICES.md',
  'resources/licenses/sharp/Apache-2.0.txt',
  'resources/licenses/sharp-win32-x64/Apache-2.0.txt',
  'resources/licenses/colour/LICENSES.md',
  'resources/licenses/third_party/GNU-GPL-3.0.txt',
  'resources/licenses/third_party/GNU-LGPL-3.0.txt',
  'resources/licenses/third_party/MPL-2.0.txt',
  'resources/licenses/third_party/NATIVE_SOURCE_MANIFEST.json',
  'resources/licenses/third_party/AOM-LICENSE.txt',
  'resources/licenses/third_party/AOM-PATENTS.txt',
  'resources/licenses/third_party/ONNXRUNTIME-MIT.txt',
  'resources/licenses/third_party/ONNXRUNTIME-THIRD-PARTY-NOTICES.txt',
  'resources/licenses/third_party/SHARP-LIBVIPS-THIRD-PARTY-NOTICES.md',
  'resources/licenses/third_party/SHARP-WIN32-X64-VERSIONS.json',
  'resources/licenses/third_party/SOURCE_AVAILABILITY.md',
  'resources/licenses/third_party/SOURCES.md',
  'resources/licenses/third_party/SHA256SUMS',
];

function fail(message) {
  throw new Error(message);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyThirdPartyHashes(directory) {
  const sumsPath = path.join(directory, 'SHA256SUMS');
  const lines = fs.readFileSync(sumsPath, 'utf8').trim().split(/\r?\n/);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) fail(`Malformed third-party checksum line: ${line}`);
    const target = path.join(directory, match[2]);
    if (!fs.existsSync(target)) fail(`Third-party checksum target is missing: ${match[2]}`);
    if (sha256(target) !== match[1]) fail(`Third-party checksum mismatch: ${match[2]}`);
  }
  return lines.length;
}

function readSignature(filePath) {
  if (process.platform !== 'win32') return { status: 'Not checked', signed: false };
  const command = [
    '$s = Get-AuthenticodeSignature -LiteralPath $env:LUMA_RELEASE_ARTIFACT;',
    '$v = (Get-Item -LiteralPath $env:LUMA_RELEASE_APP).VersionInfo;',
    '[pscustomobject]@{Status=[string]$s.Status;Signer=if($s.SignerCertificate){$s.SignerCertificate.Subject}else{$null};ProductVersion=$v.ProductVersion;FileVersion=$v.FileVersion} | ConvertTo-Json -Compress',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      LUMA_RELEASE_ARTIFACT: filePath,
      LUMA_RELEASE_APP: path.join(unpacked, 'Luma Darkroom.exe'),
    },
  });
  if (result.status !== 0) fail(`Could not inspect Windows signature: ${result.stderr.trim()}`);
  const parsed = JSON.parse(result.stdout);
  return { ...parsed, signed: parsed.Status === 'Valid' };
}

function matchesWindowsVersion(actual, expected) {
  const normalized = String(actual || '').trim();
  return normalized === expected || normalized === `${expected}.0`;
}

function assertArchiveEntries(archivePath, requiredEntries) {
  const result = spawnSync('tar.exe', ['-tf', archivePath], { encoding: 'utf8' });
  if (result.status !== 0) fail(`Could not inspect release archive ${path.basename(archivePath)}: ${result.stderr.trim()}`);
  const entries = result.stdout.split(/\r?\n/).map(entry => entry.replaceAll('\\', '/'));
  for (const required of requiredEntries) {
    if (!entries.some(entry => entry.endsWith(required))) fail(`${path.basename(archivePath)} is missing ${required}`);
  }
}

if (!fs.existsSync(installer)) fail(`Installer is missing: ${installer}`);
if (!fs.existsSync(sourceBundle)) fail(`Native source bundle is missing: ${sourceBundle}`);
if (!fs.existsSync(noticeBundle)) fail(`Third-party notice bundle is missing: ${noticeBundle}`);
assertArchiveEntries(sourceBundle, ['/MANIFEST.json', '/SHA256SUMS', '/README.md']);
assertArchiveEntries(noticeBundle, ['/THIRD_PARTY_NOTICES.md', '/third_party/NATIVE_SOURCE_MANIFEST.json', '/runtime/LICENSES.chromium.html']);
if (!fs.existsSync(unpacked)) fail(`Unpacked application is missing: ${unpacked}`);
for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(unpacked, relative))) fail(`Packaged file is missing: ${relative}`);
}

const packagedPackage = JSON.parse(asar.extractFile(appAsar, 'package.json').toString('utf8'));
if (packagedPackage.name !== pkg.name || packagedPackage.version !== pkg.version) {
  fail(`Packaged version mismatch: expected ${pkg.name}@${pkg.version}, got ${packagedPackage.name}@${packagedPackage.version}`);
}

const asarEntries = asar.listPackage(appAsar);
const normalizedAsarEntries = new Set(
  asarEntries.map((entry) => entry.replaceAll('\\', '/').replace(/^\/+/, '')),
);
const requiredAsarEntries = [
  'electron/model-manager.js',
  'electron/custom-presets.js',
  'src/render-worker.js',
  'src/ai-client.js',
  'src/ai-segmentation-worker.js',
  'node_modules/onnxruntime-web/dist/ort.all.min.js',
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs',
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
];
for (const required of requiredAsarEntries) {
  if (!normalizedAsarEntries.has(required)) fail(`Packaged application is missing required ASAR file: ${required}`);
}
const disallowed = asarEntries.filter((entry) =>
  /(^|[\\/])(work|tests?|docs|guide-site|outputs|\.git|\.openai|\.env)([\\/]|$)/i.test(entry)
  || /\.(pem|p12|pfx|key|log|tmp|map)$/i.test(entry),
);
if (disallowed.length) fail(`Unexpected development or sensitive files in app.asar: ${disallowed.slice(0, 12).join(', ')}`);

const thirdPartyCount = verifyThirdPartyHashes(path.join(unpacked, 'resources', 'licenses', 'third_party'));
const signature = readSignature(installer);
if (process.platform === 'win32') {
  if (!matchesWindowsVersion(signature.ProductVersion, pkg.version)) {
    fail(`Packaged ProductVersion mismatch: expected ${pkg.version}, got ${signature.ProductVersion || 'missing'}`);
  }
  if (!matchesWindowsVersion(signature.FileVersion, pkg.version)) {
    fail(`Packaged FileVersion mismatch: expected ${pkg.version}, got ${signature.FileVersion || 'missing'}`);
  }
}
const assets = [installer, sourceBundle, noticeBundle].map(filePath => ({
  filePath,
  name: path.basename(filePath),
  bytes: fs.statSync(filePath).size,
  sha256: sha256(filePath),
}));
const hash = assets[0].sha256;
const hashFile = path.join(releaseDir, 'SHA256SUMS.txt');
fs.writeFileSync(hashFile, assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(''), { encoding: 'utf8', flag: 'w' });

const result = {
  product: pkg.build.productName,
  version: pkg.version,
  installer,
  bytes: fs.statSync(installer).size,
  sha256: hash,
  releaseAssets: assets,
  checksumFile: hashFile,
  signature,
  packagedAsarEntries: asarEntries.length,
  verifiedThirdPartyFiles: thirdPartyCount,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!signature.signed) {
  process.stderr.write('NOTICE: the installer is not Authenticode-signed; release notes must say so explicitly.\n');
}
