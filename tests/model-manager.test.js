'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MODEL_MANIFEST, ModelManager } = require('../electron/model-manager');

const TEST_ID = 'test-model';
const TEST_URL = 'https://models.example.test/model.bin';
const TEST_FILE = 'test-model.bin';
const GOOD_BYTES = Buffer.from('verified local model bytes');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const testManifest = (overrides = {}) => ({
  [TEST_ID]: {
    id: TEST_ID,
    kind: 'test-segmentation',
    format: 'test-binary',
    filename: TEST_FILE,
    url: TEST_URL,
    size: GOOD_BYTES.byteLength,
    sha256: digest(GOOD_BYTES),
    labels: ['background', 'subject'],
    ...overrides
  }
});

const responseFor = (bytes, options = {}) => {
  const chunks = options.chunks || [bytes];
  const contentLength = Object.hasOwn(options, 'contentLength') ? options.contentLength : String(bytes.byteLength);
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    url: options.url ?? TEST_URL,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-length' ? contentLength : null;
      }
    },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      }
    }
  };
};

const tempStorage = async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'luma-model-manager-'));
  const baseDir = path.join(root, 'ai-models');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  return { root, baseDir };
};

const assertRedacted = (value, baseDir) => {
  const json = JSON.stringify(value);
  assert.equal(json.includes('url'), false);
  assert.equal(json.includes('filename'), false);
  assert.equal(json.includes('models.example.test'), false);
  assert.equal(json.includes(baseDir), false);
};

test('production manifest is the exact immutable OpenCV Zoo allowlist', () => {
  assert.deepEqual(Object.keys(MODEL_MANIFEST), ['object-efficient-sam-ti', 'people-pphumanseg']);
  assert.deepEqual(MODEL_MANIFEST['object-efficient-sam-ti'], {
    id: 'object-efficient-sam-ti',
    kind: 'interactive-segmentation',
    format: 'onnx',
    filename: 'object-efficient-sam-ti.onnx',
    url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/image_segmentation_efficientsam/image_segmentation_efficientsam_ti_2025april.onnx',
    size: 48_312_857,
    sha256: '4eb496e0a7259d435b49b66faf1754aa45a5c382a34558ddda9a8c6fe5915d77',
    labels: ['background', 'foreground']
  });
  assert.deepEqual(MODEL_MANIFEST['people-pphumanseg'], {
    id: 'people-pphumanseg',
    kind: 'image-segmentation',
    format: 'onnx',
    filename: 'people-pphumanseg.onnx',
    url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/human_segmentation_pphumanseg/human_segmentation_pphumanseg_2023mar.onnx',
    size: 6_163_938,
    sha256: '552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24',
    labels: ['background', 'person']
  });
  assert.equal(Object.isFrozen(MODEL_MANIFEST), true);
  assert.equal(Object.isFrozen(MODEL_MANIFEST['object-efficient-sam-ti']), true);
  assert.equal(Object.isFrozen(MODEL_MANIFEST['object-efficient-sam-ti'].labels), true);
});

test('download streams, verifies, reports progress, returns an ArrayBuffer, and removes', async t => {
  const { baseDir } = await tempStorage(t);
  let fetchCalls = 0;
  const manager = new ModelManager({
    baseDir,
    manifest: testManifest(),
    fetchImpl: async (url, options) => {
      fetchCalls++;
      assert.equal(url, TEST_URL);
      assert.equal(options.redirect, 'follow');
      assert.ok(options.signal instanceof AbortSignal);
      return responseFor(GOOD_BYTES, {
        chunks: [GOOD_BYTES.subarray(0, 4), GOOD_BYTES.subarray(4, 15), GOOD_BYTES.subarray(15)]
      });
    }
  });
  const progress = [];
  manager.on('progress', event => progress.push(event));

  await fs.promises.mkdir(baseDir, { recursive: true });
  await fs.promises.writeFile(path.join(baseDir, `${TEST_FILE}.part`), 'stale partial');
  const downloaded = await manager.download(TEST_ID);
  assert.equal(fetchCalls, 1);
  assert.equal(downloaded.state, 'available');
  assert.equal(downloaded.verified, true);
  assertRedacted(downloaded, baseDir);
  assert.deepEqual(progress.map(event => event.state), [
    'downloading', 'downloading', 'downloading', 'downloading', 'available'
  ]);
  assert.equal(progress.at(-1).progress, 1);

  const status = await manager.status(TEST_ID);
  const list = await manager.list();
  assert.equal(status.state, 'available');
  assert.deepEqual(list, [status]);
  assertRedacted(status, baseDir);

  const model = await manager.get(TEST_ID);
  assert.ok(model.buffer instanceof ArrayBuffer);
  assert.deepEqual(Buffer.from(model.buffer), GOOD_BYTES);
  assert.deepEqual(model.labels, ['background', 'subject']);
  assertRedacted(model, baseDir);

  const removed = await manager.remove(TEST_ID);
  assert.equal(removed.removed, true);
  assert.equal(removed.state, 'missing');
  assert.equal((await manager.status(TEST_ID)).state, 'missing');
});

test('concurrent downloads are deduplicated to one operation', async t => {
  const { baseDir } = await tempStorage(t);
  let fetchCalls = 0;
  let releaseBody;
  let markFetchStarted;
  const fetchStarted = new Promise(resolve => { markFetchStarted = resolve; });
  const bodyGate = new Promise(resolve => { releaseBody = resolve; });
  const manager = new ModelManager({
    baseDir,
    manifest: testManifest(),
    fetchImpl: async () => {
      fetchCalls++;
      markFetchStarted();
      return {
        ...responseFor(GOOD_BYTES),
        body: {
          async *[Symbol.asyncIterator]() {
            await bodyGate;
            yield GOOD_BYTES;
          }
        }
      };
    }
  });

  const first = manager.download(TEST_ID);
  const second = manager.download(TEST_ID);
  assert.strictEqual(first, second);
  await fetchStarted;
  assert.equal((await manager.status(TEST_ID)).state, 'downloading');
  releaseBody();
  const [one, two] = await Promise.all([first, second]);
  assert.deepEqual(one, two);
  assert.equal(fetchCalls, 1);
});

test('hash mismatch cleans partial data and a later download recovers', async t => {
  const { baseDir } = await tempStorage(t);
  const bad = Buffer.from(GOOD_BYTES);
  bad[0] ^= 0xff;
  let fetchCalls = 0;
  const manager = new ModelManager({
    baseDir,
    manifest: testManifest(),
    fetchImpl: async () => responseFor(fetchCalls++ === 0 ? bad : GOOD_BYTES)
  });

  await assert.rejects(manager.download(TEST_ID), error => error.code === 'MODEL_DOWNLOAD_HASH');
  await assert.rejects(fs.promises.access(path.join(baseDir, TEST_FILE)), { code: 'ENOENT' });
  await assert.rejects(fs.promises.access(path.join(baseDir, `${TEST_FILE}.part`)), { code: 'ENOENT' });
  assert.equal((await manager.status(TEST_ID)).state, 'missing');

  assert.equal((await manager.download(TEST_ID)).state, 'available');
  assert.equal(fetchCalls, 2);
});

test('network failures are reported as failures rather than cancellations', async t => {
  const { baseDir } = await tempStorage(t);
  const manager = new ModelManager({
    baseDir,
    manifest: testManifest(),
    fetchImpl: async () => { throw new TypeError('simulated network failure with private details'); }
  });
  await assert.rejects(manager.download(TEST_ID), error => {
    assert.equal(error.code, 'MODEL_DOWNLOAD_FAILED');
    assert.equal(error.name, 'ModelManagerError');
    assert.equal(error.message, 'Model download failed');
    return true;
  });
});

test('cancel aborts one shared download, cleans it, and permits retry', async t => {
  const { baseDir } = await tempStorage(t);
  let firstChunkSeen;
  const firstChunk = new Promise(resolve => { firstChunkSeen = resolve; });
  let attempt = 0;
  const manager = new ModelManager({
    baseDir,
    manifest: testManifest(),
    fetchImpl: async (_url, { signal }) => {
      attempt++;
      if (attempt > 1) return responseFor(GOOD_BYTES);
      return {
        ...responseFor(GOOD_BYTES),
        body: {
          async *[Symbol.asyncIterator]() {
            yield GOOD_BYTES.subarray(0, 5);
            firstChunkSeen();
            await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
            yield GOOD_BYTES.subarray(5);
          }
        }
      };
    }
  });

  const download = manager.download(TEST_ID);
  await firstChunk;
  assert.equal(manager.cancel(TEST_ID), true);
  assert.equal(manager.cancel(TEST_ID), true);
  await assert.rejects(download, error => error.name === 'AbortError' && error.code === 'MODEL_DOWNLOAD_CANCELED');
  assert.equal(manager.cancel(TEST_ID), false);
  await assert.rejects(fs.promises.access(path.join(baseDir, `${TEST_FILE}.part`)), { code: 'ENOENT' });

  assert.equal((await manager.download(TEST_ID)).state, 'available');
  assert.equal(attempt, 2);
});

test('size bounds, response origin, and HTTPS manifest validation are enforced', async t => {
  const cases = [
    {
      name: 'declared size',
      response: responseFor(GOOD_BYTES, { contentLength: String(GOOD_BYTES.byteLength + 1) }),
      code: 'MODEL_DOWNLOAD_SIZE'
    },
    {
      name: 'stream bound',
      response: responseFor(Buffer.concat([GOOD_BYTES, Buffer.from([0])]), { contentLength: null }),
      code: 'MODEL_DOWNLOAD_SIZE'
    },
    {
      name: 'final origin',
      response: responseFor(GOOD_BYTES, { url: 'https://untrusted.example/model.bin' }),
      code: 'MODEL_DOWNLOAD_ORIGIN'
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async nested => {
      const { baseDir } = await tempStorage(nested);
      const manager = new ModelManager({
        baseDir,
        manifest: testManifest(),
        fetchImpl: async () => item.response
      });
      await assert.rejects(manager.download(TEST_ID), error => error.code === item.code);
      await assert.rejects(fs.promises.access(path.join(baseDir, TEST_FILE)), { code: 'ENOENT' });
      await assert.rejects(fs.promises.access(path.join(baseDir, `${TEST_FILE}.part`)), { code: 'ENOENT' });
    });
  }

  assert.throws(() => new ModelManager({
    baseDir: path.resolve(os.tmpdir(), 'model-test'),
    fetchImpl: async () => {},
    manifest: testManifest({ url: 'http://models.example.test/model.bin' })
  }), /credential-free HTTPS/);
});

test('corrupt installed files are detected and replaced only by verified bytes', async t => {
  const { baseDir } = await tempStorage(t);
  let fetchCalls = 0;
  const manager = new ModelManager({
    baseDir,
    manifest: testManifest(),
    fetchImpl: async () => {
      fetchCalls++;
      return responseFor(GOOD_BYTES);
    }
  });

  await manager.download(TEST_ID);
  const corrupt = Buffer.from(GOOD_BYTES);
  corrupt[corrupt.byteLength - 1] ^= 0xff;
  await fs.promises.writeFile(path.join(baseDir, TEST_FILE), corrupt);
  assert.equal((await manager.status(TEST_ID)).state, 'corrupt');
  await assert.rejects(manager.get(TEST_ID), error => error.code === 'MODEL_NOT_VERIFIED');

  await manager.download(TEST_ID);
  assert.equal(fetchCalls, 2);
  assert.deepEqual(Buffer.from((await manager.get(TEST_ID)).buffer), GOOD_BYTES);
});

test('IDs, manifest filenames, storage roots, and symlink leaves cannot escape storage', async t => {
  const { root, baseDir } = await tempStorage(t);
  const manager = new ModelManager({
    baseDir,
    manifest: testManifest(),
    fetchImpl: async () => responseFor(GOOD_BYTES)
  });

  for (const id of ['../test-model', '..\\test-model', 'C:\\outside', '/outside', '', 'TEST-MODEL']) {
    await assert.rejects(Promise.resolve().then(() => manager.status(id)), error => error.code === 'MODEL_ID_INVALID');
  }
  await assert.rejects(manager.status('unknown-model'), error => error.code === 'MODEL_ID_NOT_ALLOWED');
  assert.throws(() => manager.download('../test-model'), error => error.code === 'MODEL_ID_INVALID');
  assert.throws(() => new ModelManager({
    baseDir,
    fetchImpl: async () => {},
    manifest: testManifest({ filename: '../escape.bin' })
  }), /invalid filename/);
  assert.throws(() => new ModelManager({
    baseDir: 'relative/ai-models',
    fetchImpl: async () => {},
    manifest: testManifest()
  }), /must be absolute/);

  await fs.promises.mkdir(baseDir, { recursive: true });
  const outside = path.join(root, 'outside.bin');
  await fs.promises.writeFile(outside, 'outside must remain');
  const leaf = path.join(baseDir, TEST_FILE);
  try {
    await fs.promises.symlink(outside, leaf, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.diagnostic('File symlink checks skipped because this Windows account cannot create symlinks');
      return;
    }
    throw error;
  }

  assert.equal((await manager.status(TEST_ID)).state, 'unsafe');
  await assert.rejects(manager.download(TEST_ID), error => error.code === 'MODEL_PATH_UNSAFE');
  const removed = await manager.remove(TEST_ID);
  assert.equal(removed.removed, true);
  assert.equal(await fs.promises.readFile(outside, 'utf8'), 'outside must remain');
});

test('a symlinked storage root is rejected', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'luma-model-root-link-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'real-models');
  const linked = path.join(root, 'linked-models');
  await fs.promises.mkdir(target);
  try {
    await fs.promises.symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('Directory symlinks are unavailable in this environment');
      return;
    }
    throw error;
  }

  const manager = new ModelManager({
    baseDir: linked,
    manifest: testManifest(),
    fetchImpl: async () => responseFor(GOOD_BYTES)
  });
  await assert.rejects(manager.status(TEST_ID), error => error.code === 'MODEL_STORAGE_UNSAFE');
});
