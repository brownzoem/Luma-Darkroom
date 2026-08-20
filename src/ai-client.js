(() => {
  const MODEL_TIMEOUT_MS = 180_000;

  class LocalSegmentationClient {
    constructor() {
      this.worker = null;
      this.requestId = 0;
      this.pending = new Map();
      this.initialized = new Set();
      this.initializing = new Map();
      this.segmenting = false;
    }

    modelApi() {
      const api = globalThis.desktop?.aiModels;
      if (!api) throw new Error('Local AI models are unavailable in this build');
      return api;
    }

    ensureWorker() {
      if (this.worker) return this.worker;
      const worker = new Worker('ai-segmentation-worker.js');
      worker.onmessage = event => this.handleMessage(event.data || {});
      worker.onerror = event => this.failWorker(new Error(event.message || 'The local segmentation worker stopped'));
      worker.onmessageerror = () => this.failWorker(new Error('The local segmentation worker returned invalid data'));
      this.worker = worker;
      return worker;
    }

    handleMessage(message) {
      const pending = this.pending.get(message.requestId);
      if (message.type === 'progress') {
        pending?.onProgress?.(message.stage);
        return;
      }
      if (!pending) return;
      if (message.type === 'initialized' || message.type === 'result') {
        clearTimeout(pending.timeout);
        this.pending.delete(message.requestId);
        pending.resolve(message);
      } else if (message.type === 'error') {
        clearTimeout(pending.timeout);
        this.pending.delete(message.requestId);
        pending.reject(new Error(message.error || 'Local segmentation failed'));
      }
    }

    failWorker(error) {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
      this.initialized.clear();
      this.initializing.clear();
      this.segmenting = false;
    }

    request(message, transfer = [], onProgress) {
      const worker = this.ensureWorker(), requestId = ++this.requestId;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error('Local image analysis timed out. Try a smaller photo or restart the tool.'));
          this.cancelActive();
        }, MODEL_TIMEOUT_MS);
        this.pending.set(requestId, { resolve, reject, timeout, onProgress });
        try { worker.postMessage({ ...message, requestId }, transfer); }
        catch (error) { clearTimeout(timeout); this.pending.delete(requestId); reject(error); }
      });
    }

    runSegment(operation) {
      if (this.segmenting) {
        const error = new Error('Local image analysis is already running');
        error.code = 'MODEL_BUSY';
        return Promise.reject(error);
      }
      this.segmenting = true;
      return Promise.resolve().then(operation).finally(() => { this.segmenting = false; });
    }

    async initialize(modelId, onProgress) {
      if (this.initialized.has(modelId)) return;
      if (this.initializing.has(modelId)) return this.initializing.get(modelId);
      const promise = (async () => {
        const model = await this.modelApi().get(modelId);
        if (!model?.buffer) {
          const error = new Error('This local model must be downloaded before the tool can run');
          error.code = 'MODEL_REQUIRED';
          error.modelId = modelId;
          throw error;
        }
        const result = await this.request({ type: 'init', model }, [model.buffer], onProgress);
        this.initialized.add(modelId);
        return result;
      })().finally(() => this.initializing.delete(modelId));
      this.initializing.set(modelId, promise);
      return promise;
    }

    async makeBitmap(image, maxEdge = 1280) {
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      if (!width || !height) throw new Error('The source photograph is unavailable');
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const outputWidth = Math.max(1, Math.round(width * scale)), outputHeight = Math.max(1, Math.round(height * scale));
      if (outputWidth === width && outputHeight === height) return createImageBitmap(image);
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth; canvas.height = outputHeight;
      const context = canvas.getContext('2d', { alpha: false });
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, outputWidth, outputHeight);
      const bitmap = await createImageBitmap(canvas);
      canvas.width = canvas.height = 1;
      return bitmap;
    }

    segmentObject(image, token, strokes, { threshold = 50, onProgress } = {}) {
      return this.runSegment(async () => {
        const modelId = 'object-efficient-sam-ti';
        await this.initialize(modelId, onProgress);
        const bitmap = await this.makeBitmap(image, 1280);
        return this.request({ type: 'segment', modelId, token, bitmap, strokes, threshold, sourceWidth: image.naturalWidth || image.width, sourceHeight: image.naturalHeight || image.height }, [bitmap], onProgress);
      });
    }

    segmentCategories(image, modelId, categories, { onProgress } = {}) {
      return this.runSegment(async () => {
        await this.initialize(modelId, onProgress);
        const bitmap = await this.makeBitmap(image);
        return this.request({ type: 'segment', modelId, bitmap, categories, sourceWidth: image.naturalWidth || image.width, sourceHeight: image.naturalHeight || image.height }, [bitmap], onProgress);
      });
    }

    async segmentPeople(image, options = {}) {
      return this.segmentCategories(image, 'people-pphumanseg', [1], options);
    }

    segmentSky(image, { onProgress } = {}) {
      return this.runSegment(async () => {
        const bitmap = await this.makeBitmap(image, 768);
        return this.request({ type: 'segment', modelId: 'smart-sky-v1', bitmap, sourceWidth: image.naturalWidth || image.width, sourceHeight: image.naturalHeight || image.height }, [bitmap], onProgress);
      });
    }

    cancelActive() {
      if (!this.worker) return;
      const error = new DOMException('Local image analysis was cancelled', 'AbortError');
      this.failWorker(error);
    }

    close() {
      try { this.worker?.postMessage({ type: 'close' }); } catch {}
      this.failWorker(new DOMException('Local image analysis closed', 'AbortError'));
    }
  }

  function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer); let output = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) output += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    return btoa(output);
  }

  globalThis.LumaAI = { LocalSegmentationClient, bytesToBase64 };
})();
