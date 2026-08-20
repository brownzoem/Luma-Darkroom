const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'third_party');
const upstreamCheck = process.argv.includes('--check-upstream');
const checkOnly = process.argv.includes('--check') || upstreamCheck;
const refreshOnnxRuntime = process.argv.includes('--refresh-onnxruntime');

const remoteSources = [
  {
    filename: 'GNU-GPL-3.0.txt',
    url: 'https://www.gnu.org/licenses/gpl-3.0.txt',
    minimumBytes: 30_000,
  },
  {
    filename: 'GNU-LGPL-3.0.txt',
    url: 'https://www.gnu.org/licenses/lgpl-3.0.txt',
    minimumBytes: 7_000,
  },
  {
    filename: 'MPL-2.0.txt',
    url: 'https://www.mozilla.org/media/MPL/2.0/index.f75d2927d3c1.txt',
    minimumBytes: 15_000,
  },
  {
    filename: 'AOM-LICENSE.txt',
    url: 'https://aomedia.googlesource.com/aom/+/refs/tags/v3.14.1/LICENSE?format=TEXT',
    encoding: 'base64',
    minimumBytes: 1_000,
  },
  {
    filename: 'AOM-PATENTS.txt',
    url: 'https://aomedia.googlesource.com/aom/+/refs/tags/v3.14.1/PATENTS?format=TEXT',
    encoding: 'base64',
    minimumBytes: 5_000,
  },
  {
    filename: 'SHARP-LIBVIPS-THIRD-PARTY-NOTICES.md',
    url: 'https://raw.githubusercontent.com/lovell/sharp-libvips/v1.3.1/THIRD-PARTY-NOTICES.md',
    minimumBytes: 4_000,
  },
  {
    filename: 'ONNXRUNTIME-MIT.txt',
    url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.27.0/LICENSE',
    minimumBytes: 1_000,
  },
  {
    filename: 'ONNXRUNTIME-THIRD-PARTY-NOTICES.txt',
    url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.27.0/ThirdPartyNotices.txt',
    minimumBytes: 300_000,
    maximumBytes: 400_000,
  },
];

const localSources = [
  {
    filename: 'NATIVE_SOURCE_MANIFEST.json',
    sourcePath: path.join(root, 'third_party', 'NATIVE_SOURCE_MANIFEST.json'),
  },
  {
    filename: 'SHARP-WIN32-X64-VERSIONS.json',
    sourcePath: path.join(
      root,
      'node_modules',
      '@img',
      'sharp-win32-x64',
      'versions.json',
    ),
    transform(bytes) {
      const parsed = JSON.parse(bytes.toString('utf8'));
      return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
    },
  },
];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function fetchSource(source) {
  const response = await fetch(source.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'User-Agent': 'Luma-Darkroom-license-audit (+https://lumadarkroom.com)',
      Accept: 'text/plain, application/octet-stream;q=0.9, */*;q=0.1',
    },
  });
  if (!response.ok) {
    throw new Error(`${source.url}: HTTP ${response.status}`);
  }

  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (responseBytes.length > (source.maximumBytes || 256 * 1024)) {
    throw new Error(`${source.url}: unexpectedly large response`);
  }

  const bytes = source.encoding === 'base64'
    ? Buffer.from(responseBytes.toString('ascii').trim(), 'base64')
    : responseBytes;
  if (bytes.length < source.minimumBytes) {
    throw new Error(`${source.url}: unexpectedly short response`);
  }
  return bytes;
}

async function readLocalSource(source) {
  let bytes;
  try {
    bytes = await fs.readFile(source.sourcePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(
        `${source.sourcePath} is missing; run npm ci before refreshing notices`,
      );
    }
    throw error;
  }
  return source.transform ? source.transform(bytes) : bytes;
}

async function writeAtomic(filename, bytes) {
  const target = path.join(output, filename);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: 'wx' });
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function assertCommittedCopy(filename, expectedBytes) {
  const target = path.join(output, filename);
  let actualBytes;
  try {
    actualBytes = await fs.readFile(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`${filename}: committed copy is missing`);
    }
    throw error;
  }
  if (!actualBytes.equals(expectedBytes)) {
    throw new Error(
      `${filename}: committed sha256 ${sha256(actualBytes)} does not match source sha256 ${sha256(expectedBytes)}`,
    );
  }
}

async function verifyCommittedChecksums() {
  const sumsPath = path.join(output, 'SHA256SUMS');
  const lines = (await fs.readFile(sumsPath, 'utf8')).trim().split(/\r?\n/);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`SHA256SUMS: malformed line: ${line}`);
    const bytes = await fs.readFile(path.join(output, match[2]));
    if (sha256(bytes) !== match[1]) {
      throw new Error(`${match[2]}: committed checksum mismatch`);
    }
    console.log(`${match[2]}: committed checksum verified`);
  }
  for (const source of localSources) {
    await assertCommittedCopy(source.filename, await readLocalSource(source));
    console.log(`${source.filename}: installed package inventory verified`);
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/fetch-upstream-notices.js [--check|--check-upstream|--refresh-onnxruntime]');
    console.log('--check verifies committed hashes and the installed native inventory without network access.');
    console.log('--check-upstream also downloads each canonical source and compares it with the committed copy.');
    console.log('Without an option, refreshes third_party and SHA256SUMS from canonical sources.');
    return;
  }

  if (refreshOnnxRuntime) {
    const selected = remoteSources.filter(source => source.filename.startsWith('ONNXRUNTIME-'));
    for (const source of selected) {
      const bytes = await fetchSource(source);
      await writeAtomic(source.filename, bytes);
      console.log(`${source.filename}: wrote ${bytes.length} bytes`);
    }
    const tracked = [...new Set([...remoteSources, ...localSources].map(source => source.filename))].sort();
    const sums = Buffer.from((await Promise.all(tracked.map(async filename => {
      const bytes = await fs.readFile(path.join(output, filename));
      return `${sha256(bytes)}  ${filename}\n`;
    }))).join(''));
    await writeAtomic('SHA256SUMS', sums);
    console.log('SHA256SUMS: updated');
    return;
  }

  if (checkOnly && !upstreamCheck) {
    await verifyCommittedChecksums();
    return;
  }

  const resolved = [];
  for (const source of remoteSources) {
    resolved.push([source.filename, await fetchSource(source)]);
  }
  for (const source of localSources) {
    resolved.push([source.filename, await readLocalSource(source)]);
  }
  resolved.sort(([left], [right]) => left.localeCompare(right));

  const sums = Buffer.from(
    resolved.map(([filename, bytes]) => `${sha256(bytes)}  ${filename}\n`).join(''),
  );

  if (checkOnly) {
    for (const [filename, bytes] of resolved) {
      await assertCommittedCopy(filename, bytes);
      console.log(`${filename}: verified ${bytes.length} bytes`);
    }
    await assertCommittedCopy('SHA256SUMS', sums);
    console.log('SHA256SUMS: verified');
    return;
  }

  await fs.mkdir(output, { recursive: true });
  for (const [filename, bytes] of resolved) {
    await writeAtomic(filename, bytes);
    console.log(`${filename}: wrote ${bytes.length} bytes`);
  }
  await writeAtomic('SHA256SUMS', sums);
  console.log('SHA256SUMS: updated');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
