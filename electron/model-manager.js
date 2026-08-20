'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MODEL_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MODEL_BYTES = 100_000_000;
const READ_CHUNK_BYTES = 64 * 1024;

const deepFreeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const MODEL_MANIFEST = deepFreeze({
  'object-efficient-sam-ti': {
    id: 'object-efficient-sam-ti',
    kind: 'interactive-segmentation',
    format: 'onnx',
    filename: 'object-efficient-sam-ti.onnx',
    url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/image_segmentation_efficientsam/image_segmentation_efficientsam_ti_2025april.onnx',
    size: 48_312_857,
    sha256: '4eb496e0a7259d435b49b66faf1754aa45a5c382a34558ddda9a8c6fe5915d77',
    labels: ['background', 'foreground']
  },
  'people-pphumanseg': {
    id: 'people-pphumanseg',
    kind: 'image-segmentation',
    format: 'onnx',
    filename: 'people-pphumanseg.onnx',
    url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/human_segmentation_pphumanseg/human_segmentation_pphumanseg_2023mar.onnx',
    size: 6_163_938,
    sha256: '552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24',
    labels: ['background', 'person']
  }
});

class ModelManagerError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'ModelManagerError';
    this.code = code;
  }
}

const managerError = (code, message, cause) => new ModelManagerError(
  code,
  message,
  cause === undefined ? undefined : { cause }
);

const abortedError = cause => {
  const error = managerError('MODEL_DOWNLOAD_CANCELED', 'Model download was canceled', cause);
  error.name = 'AbortError';
  return error;
};

const isAbortError = error => error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'MODEL_DOWNLOAD_CANCELED';

const normalizedPath = filePath => {
  const resolved = path.resolve(filePath).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const isContainedPath = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const toBuffer = chunk => {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  throw managerError('MODEL_DOWNLOAD_INVALID', 'Model download returned invalid data');
};

const validateManifest = manifest => {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('Model manifest must be an object');
  }

  const entries = new Map();
  const filenames = new Set();
  for (const [id, source] of Object.entries(manifest)) {
    if (!MODEL_ID_PATTERN.test(id) || !source || typeof source !== 'object' || source.id !== id) {
      throw new TypeError('Model manifest contains an invalid ID');
    }
    if (!MODEL_FILE_PATTERN.test(source.filename) || path.basename(source.filename) !== source.filename) {
      throw new TypeError('Model manifest contains an invalid filename');
    }
    if (filenames.has(source.filename)) throw new TypeError('Model manifest filenames must be unique');
    if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > MAX_MODEL_BYTES) {
      throw new TypeError('Model manifest contains an invalid size');
    }
    if (!SHA256_PATTERN.test(source.sha256)) throw new TypeError('Model manifest contains an invalid SHA-256');
    if (typeof source.kind !== 'string' || !source.kind || typeof source.format !== 'string' || !source.format) {
      throw new TypeError('Model manifest contains invalid public metadata');
    }
    if (!Array.isArray(source.labels) || source.labels.some(label => typeof label !== 'string')) {
      throw new TypeError('Model manifest contains invalid labels');
    }

    let sourceUrl;
    try {
      sourceUrl = new URL(source.url);
    } catch {
      throw new TypeError('Model manifest contains an invalid URL');
    }
    if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) {
      throw new TypeError('Model manifest URLs must use credential-free HTTPS');
    }

    filenames.add(source.filename);
    entries.set(id, deepFreeze({
      id,
      kind: source.kind,
      format: source.format,
      filename: source.filename,
      url: sourceUrl.href,
      origin: sourceUrl.origin,
      size: source.size,
      sha256: source.sha256,
      labels: [...source.labels]
    }));
  }
  if (entries.size === 0) throw new TypeError('Model manifest must not be empty');
  return entries;
};

class ModelManager extends EventEmitter {
  constructor({ baseDir, fetchImpl = globalThis.fetch, manifest = MODEL_MANIFEST } = {}) {
    super();
    if (typeof baseDir !== 'string' || !path.isAbsolute(baseDir)) {
      throw new TypeError('Model storage directory must be absolute');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

    this._baseDir = path.resolve(baseDir);
    this._fetch = fetchImpl;
    this._entries = validateManifest(manifest);
    this._inFlight = new Map();
  }

  _entry(id) {
    if (typeof id !== 'string' || !MODEL_ID_PATTERN.test(id)) {
      throw managerError('MODEL_ID_INVALID', 'Invalid model ID');
    }
    const entry = this._entries.get(id);
    if (!entry) throw managerError('MODEL_ID_NOT_ALLOWED', 'Model ID is not allowed');
    return entry;
  }

  _paths(entry) {
    const destination = path.resolve(this._baseDir, entry.filename);
    const partial = `${destination}.part`;
    if (!isContainedPath(this._baseDir, destination) || !isContainedPath(this._baseDir, partial)) {
      throw managerError('MODEL_PATH_UNSAFE', 'Model storage path is unsafe');
    }
    return { destination, partial };
  }

  _metadata(entry) {
    return {
      id: entry.id,
      kind: entry.kind,
      format: entry.format,
      size: entry.size,
      sha256: entry.sha256,
      labels: [...entry.labels]
    };
  }

  _publicStatus(entry, state, overrides = {}) {
    const available = state === 'available';
    return {
      ...this._metadata(entry),
      state,
      installed: available,
      verified: available,
      receivedBytes: available ? entry.size : 0,
      totalBytes: entry.size,
      ...overrides
    };
  }

  _emitProgress(entry, state, receivedBytes, extra = {}) {
    const payload = {
      id: entry.id,
      state,
      receivedBytes,
      totalBytes: entry.size,
      progress: entry.size ? Math.max(0, Math.min(1, receivedBytes / entry.size)) : 0,
      ...extra
    };
    this.emit('progress', payload);
  }

  _wrap(error, fallbackCode, fallbackMessage) {
    if (error instanceof ModelManagerError) return error;
    if (isAbortError(error)) return abortedError(error);
    return managerError(fallbackCode, fallbackMessage, error);
  }

  async _ensureRoot() {
    try {
      await fs.promises.mkdir(this._baseDir, { recursive: true, mode: 0o700 });
      const stat = await fs.promises.lstat(this._baseDir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw managerError('MODEL_STORAGE_UNSAFE', 'Model storage directory is unsafe');
      }
      // Windows temp and user-profile directories can legitimately live below
      // junctions or use an 8.3 alias. Resolve the parent first so those safe
      // ancestors do not make the model directory look like a redirected leaf.
      // The lstat above still rejects a symlink/junction at the storage leaf.
      const [real, realParent] = await Promise.all([
        fs.promises.realpath(this._baseDir),
        fs.promises.realpath(path.dirname(this._baseDir))
      ]);
      const expected = path.join(realParent, path.basename(this._baseDir));
      if (normalizedPath(real) !== normalizedPath(expected)) {
        throw managerError('MODEL_STORAGE_UNSAFE', 'Model storage directory is unsafe');
      }
    } catch (error) {
      throw this._wrap(error, 'MODEL_STORAGE_UNAVAILABLE', 'Model storage is unavailable');
    }
  }

  async _lstatOptional(filePath) {
    try {
      return await fs.promises.lstat(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async _openReadOnly(filePath) {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    return fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow);
  }

  async _hashHandle(handle, expectedSize) {
    const hash = crypto.createHash('sha256');
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, expectedSize));
    let offset = 0;
    while (offset < expectedSize) {
      const length = Math.min(chunk.byteLength, expectedSize - offset);
      const { bytesRead } = await handle.read(chunk, 0, length, offset);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return { bytesRead: offset, sha256: hash.digest('hex') };
  }

  async _inspect(entry) {
    await this._ensureRoot();
    const { destination } = this._paths(entry);
    const pathStat = await this._lstatOptional(destination);
    if (!pathStat) return this._publicStatus(entry, 'missing');
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      return this._publicStatus(entry, 'unsafe', { installed: true, verified: false });
    }
    if (pathStat.size !== entry.size) {
      return this._publicStatus(entry, 'corrupt', { installed: true, verified: false });
    }

    let handle;
    try {
      handle = await this._openReadOnly(destination);
      const before = await handle.stat();
      if (!before.isFile() || before.size !== entry.size) {
        return this._publicStatus(entry, 'corrupt', { installed: true, verified: false });
      }
      const digest = await this._hashHandle(handle, entry.size);
      const after = await handle.stat();
      if (digest.bytesRead !== entry.size || digest.sha256 !== entry.sha256 || !after.isFile() || after.size !== entry.size) {
        return this._publicStatus(entry, 'corrupt', { installed: true, verified: false });
      }
      return this._publicStatus(entry, 'available');
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ELOOP') {
        return this._publicStatus(entry, error.code === 'ENOENT' ? 'missing' : 'unsafe', {
          installed: error.code !== 'ENOENT',
          verified: false
        });
      }
      throw error;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async status(id) {
    const entry = this._entry(id);
    const active = this._inFlight.get(id);
    if (active) {
      return this._publicStatus(entry, 'downloading', {
        receivedBytes: active.receivedBytes,
        installed: false,
        verified: false
      });
    }
    try {
      return await this._inspect(entry);
    } catch (error) {
      throw this._wrap(error, 'MODEL_STATUS_FAILED', 'Model status could not be read');
    }
  }

  async list() {
    return Promise.all([...this._entries.keys()].map(id => this.status(id)));
  }

  download(id) {
    const entry = this._entry(id);
    const existing = this._inFlight.get(id);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const active = { controller, receivedBytes: 0, promise: null };
    const operation = this._download(entry, active).catch(error => {
      const wrapped = error instanceof ModelManagerError && error.code !== 'MODEL_DOWNLOAD_CANCELED'
        ? error
        : isAbortError(error)
          ? abortedError(error)
          : this._wrap(error, 'MODEL_DOWNLOAD_FAILED', 'Model download failed');
      this._emitProgress(entry, wrapped.code === 'MODEL_DOWNLOAD_CANCELED' ? 'canceled' : 'error', active.receivedBytes, {
        errorCode: wrapped.code
      });
      throw wrapped;
    });
    active.promise = operation.finally(() => {
      if (this._inFlight.get(id) === active) this._inFlight.delete(id);
    });
    this._inFlight.set(id, active);
    return active.promise;
  }

  _throwIfAborted(signal) {
    if (signal.aborted) throw abortedError(signal.reason);
  }

  async _removeRegularForReplacement(filePath) {
    const stat = await this._lstatOptional(filePath);
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw managerError('MODEL_PATH_UNSAFE', 'Model storage contains an unsafe entry');
    }
    await fs.promises.unlink(filePath);
  }

  async _preparePartial(partial) {
    const stat = await this._lstatOptional(partial);
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw managerError('MODEL_PATH_UNSAFE', 'Model storage contains an unsafe partial file');
    }
    await fs.promises.unlink(partial);
  }

  _validateResponse(entry, response) {
    if (!response || response.ok !== true || response.status !== 200) {
      throw managerError('MODEL_DOWNLOAD_RESPONSE', 'Model server returned an invalid response');
    }

    let finalUrl;
    try {
      finalUrl = new URL(response.url);
    } catch {
      throw managerError('MODEL_DOWNLOAD_ORIGIN', 'Model server returned an invalid final URL');
    }
    if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password || finalUrl.origin !== entry.origin) {
      throw managerError('MODEL_DOWNLOAD_ORIGIN', 'Model download was redirected to an untrusted origin');
    }

    const contentLength = response.headers?.get?.('content-length');
    if (contentLength !== null && contentLength !== undefined && contentLength !== '') {
      if (!/^\d+$/.test(contentLength) || Number(contentLength) !== entry.size) {
        throw managerError('MODEL_DOWNLOAD_SIZE', 'Model server returned an unexpected download size');
      }
    }
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
      throw managerError('MODEL_DOWNLOAD_RESPONSE', 'Model server returned no streaming body');
    }
  }

  async _writeAll(handle, chunk) {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null);
      if (bytesWritten < 1) throw managerError('MODEL_STORAGE_WRITE', 'Model download could not be stored');
      offset += bytesWritten;
    }
  }

  async _download(entry, active) {
    await this._ensureRoot();
    const signal = active.controller.signal;
    this._throwIfAborted(signal);

    const current = await this._inspect(entry);
    if (current.state === 'available') {
      active.receivedBytes = entry.size;
      this._emitProgress(entry, 'available', entry.size);
      return current;
    }
    if (current.state === 'unsafe') {
      throw managerError('MODEL_PATH_UNSAFE', 'Model storage contains an unsafe entry');
    }

    const { destination, partial } = this._paths(entry);
    if (current.state === 'corrupt') await this._removeRegularForReplacement(destination);
    await this._preparePartial(partial);
    this._throwIfAborted(signal);

    this._emitProgress(entry, 'downloading', 0);
    let response;
    let handle;
    try {
      response = await this._fetch(entry.url, { redirect: 'follow', signal });
      this._throwIfAborted(signal);
      this._validateResponse(entry, response);

      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
      handle = await fs.promises.open(partial, flags, 0o600);
      const hash = crypto.createHash('sha256');

      for await (const value of response.body) {
        this._throwIfAborted(signal);
        const chunk = toBuffer(value);
        if (chunk.byteLength === 0) continue;
        if (active.receivedBytes + chunk.byteLength > entry.size) {
          throw managerError('MODEL_DOWNLOAD_SIZE', 'Model download exceeded its expected size');
        }
        await this._writeAll(handle, chunk);
        hash.update(chunk);
        active.receivedBytes += chunk.byteLength;
        this._emitProgress(entry, 'downloading', active.receivedBytes);
      }

      this._throwIfAborted(signal);
      if (active.receivedBytes !== entry.size) {
        throw managerError('MODEL_DOWNLOAD_SIZE', 'Model download did not match its expected size');
      }
      if (hash.digest('hex') !== entry.sha256) {
        throw managerError('MODEL_DOWNLOAD_HASH', 'Model download failed integrity verification');
      }
      await handle.sync();
      await handle.close();
      handle = null;
      this._throwIfAborted(signal);
      await fs.promises.rename(partial, destination);

      this._emitProgress(entry, 'available', entry.size);
      return this._publicStatus(entry, 'available');
    } catch (error) {
      const canceled = signal.aborted || isAbortError(error);
      if (!signal.aborted) active.controller.abort();
      throw canceled ? abortedError(error) : error;
    } finally {
      await handle?.close().catch(() => {});
      await fs.promises.unlink(partial).catch(() => {});
    }
  }

  cancel(id) {
    this._entry(id);
    const active = this._inFlight.get(id);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  cancelAll() {
    for (const active of this._inFlight.values()) active.controller.abort();
  }

  async get(id) {
    const entry = this._entry(id);
    try {
      await this._ensureRoot();
      const { destination } = this._paths(entry);
      const pathStat = await this._lstatOptional(destination);
      if (!pathStat || pathStat.isSymbolicLink() || !pathStat.isFile()) {
        throw managerError('MODEL_NOT_AVAILABLE', 'Verified model is not available');
      }
      if (pathStat.size !== entry.size) {
        throw managerError('MODEL_NOT_VERIFIED', 'Stored model failed integrity verification');
      }

      let handle;
      try {
        handle = await this._openReadOnly(destination);
        const before = await handle.stat();
        if (!before.isFile() || before.size !== entry.size) {
          throw managerError('MODEL_NOT_VERIFIED', 'Stored model failed integrity verification');
        }

        const buffer = new ArrayBuffer(entry.size);
        const bytes = new Uint8Array(buffer);
        const hash = crypto.createHash('sha256');
        let offset = 0;
        while (offset < bytes.byteLength) {
          const length = Math.min(READ_CHUNK_BYTES, bytes.byteLength - offset);
          const { bytesRead } = await handle.read(bytes, offset, length, offset);
          if (bytesRead === 0) break;
          hash.update(bytes.subarray(offset, offset + bytesRead));
          offset += bytesRead;
        }
        const after = await handle.stat();
        if (offset !== entry.size || hash.digest('hex') !== entry.sha256 || !after.isFile() || after.size !== entry.size) {
          throw managerError('MODEL_NOT_VERIFIED', 'Stored model failed integrity verification');
        }
        return { ...this._metadata(entry), buffer };
      } finally {
        await handle?.close().catch(() => {});
      }
    } catch (error) {
      throw this._wrap(error, 'MODEL_READ_FAILED', 'Verified model could not be read');
    }
  }

  async remove(id) {
    const entry = this._entry(id);
    const active = this._inFlight.get(id);
    if (active) {
      active.controller.abort();
      await active.promise.catch(() => {});
    }

    try {
      await this._ensureRoot();
      const { destination, partial } = this._paths(entry);
      let removed = false;
      for (const filePath of [destination, partial]) {
        const stat = await this._lstatOptional(filePath);
        if (!stat) continue;
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          throw managerError('MODEL_PATH_UNSAFE', 'Model storage contains an unsafe entry');
        }
        await fs.promises.unlink(filePath);
        removed = true;
      }
      this._emitProgress(entry, 'missing', 0);
      return { ...this._publicStatus(entry, 'missing'), removed };
    } catch (error) {
      throw this._wrap(error, 'MODEL_REMOVE_FAILED', 'Model could not be removed');
    }
  }
}

module.exports = {
  MODEL_MANIFEST,
  ModelManager,
  ModelManagerError
};
