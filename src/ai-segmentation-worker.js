importScripts('../node_modules/onnxruntime-web/dist/ort.all.min.js');

ort.env.wasm.wasmPaths = new URL('../node_modules/onnxruntime-web/dist/', self.location.href).href;
ort.env.wasm.numThreads = Math.max(1, Math.min(4, (self.navigator?.hardwareConcurrency || 2) - 1));

const MODEL_IDS = new Set(['object-efficient-sam-ti', 'people-pphumanseg']);
const sessions = new Map();

function readVarint(bytes, start) {
  let value = 0, shift = 0, offset = start;
  while (offset < bytes.length && shift < 53) {
    const byte = bytes[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return { value, offset };
    shift += 7;
  }
  throw new Error('The model metadata is malformed');
}

function encodeVarint(value) {
  const bytes = [];
  let remaining=value;for (; remaining >= 0x80; remaining = Math.floor(remaining / 128)) bytes.push((remaining & 0x7f) | 0x80);
  bytes.push(remaining & 0x7f);
  return new Uint8Array(bytes);
}

function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0), result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function fieldInfo(bytes, start) {
  const tag = readVarint(bytes, start), field = tag.value >>> 3, wire = tag.value & 7;
  let dataStart = tag.offset, dataEnd;
  if (wire === 0) dataEnd = readVarint(bytes, dataStart).offset;
  else if (wire === 1) dataEnd = dataStart + 8;
  else if (wire === 2) { const size = readVarint(bytes, dataStart); dataStart = size.offset; dataEnd = dataStart + size.value; }
  else if (wire === 5) dataEnd = dataStart + 4;
  else throw new Error('The model uses unsupported metadata encoding');
  if (dataEnd > bytes.length) throw new Error('The model metadata is truncated');
  return { field, wire, tagEnd: tag.offset, dataStart, dataEnd };
}

function valueInfoName(bytes) {
  const decoder = new TextDecoder();
  for (let offset = 0; offset < bytes.length;) {
    const info = fieldInfo(bytes, offset);
    if (info.field === 1 && info.wire === 2) return decoder.decode(bytes.subarray(info.dataStart, info.dataEnd));
    offset = info.dataEnd;
  }
  return '';
}

// OpenCV Zoo's immutable EfficientSAM export contains one empty ValueInfo rank.
// OpenCV DNN ignores it, while ONNX Runtime rejects the contradiction. Remove
// only that redundant entry in memory; the verified download remains unchanged.
function repairEfficientSamForOrt(source) {
  const model = source instanceof Uint8Array ? source : new Uint8Array(source), modelChunks = [];
  let modelOffset = 0, repaired = false;
  while (modelOffset < model.length) {
    const info = fieldInfo(model, modelOffset);
    if (info.field !== 7 || info.wire !== 2) {
      modelChunks.push(model.subarray(modelOffset, info.dataEnd)); modelOffset = info.dataEnd; continue;
    }
    const graph = model.subarray(info.dataStart, info.dataEnd), graphChunks = [];
    let graphOffset = 0;
    while (graphOffset < graph.length) {
      const graphInfo = fieldInfo(graph, graphOffset);
      const target = graphInfo.field === 13 && graphInfo.wire === 2 && valueInfoName(graph.subarray(graphInfo.dataStart, graphInfo.dataEnd)) === '/mask_decoder/Tile_output_0';
      if (!target) graphChunks.push(graph.subarray(graphOffset, graphInfo.dataEnd)); else repaired = true;
      graphOffset = graphInfo.dataEnd;
    }
    const nextGraph = concatBytes(graphChunks);
    modelChunks.push(model.subarray(modelOffset, info.tagEnd), encodeVarint(nextGraph.length), nextGraph);
    modelOffset = info.dataEnd;
  }
  if (!repaired) throw new Error('The object model did not match its reviewed metadata contract');
  return concatBytes(modelChunks);
}

function packMask(length, predicate) {
  const bits = new Uint8Array(Math.ceil(length / 8));
  for (let index = 0; index < length; index++) if (predicate(index)) bits[index >> 3] |= 1 << (index & 7);
  return bits;
}

function bitmapPixels(bitmap, width, height) {
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

function planarRgb(pixels, width, height, normalize = false) {
  const plane = width * height, values = new Float32Array(plane * 3), scale = normalize ? 1 / 127.5 : 1 / 255, bias = normalize ? -1 : 0;
  for (let pixel = 0, offset = 0; pixel < plane; pixel++, offset += 4) {
    values[pixel] = pixels[offset] * scale + bias;
    values[plane + pixel] = pixels[offset + 1] * scale + bias;
    values[plane * 2 + pixel] = pixels[offset + 2] * scale + bias;
  }
  return values;
}

function promptPoints(strokes) {
  const positive = [], negative = [];
  for (const stroke of Array.isArray(strokes) ? strokes.slice(0, 64) : []) {
    const target = stroke?.mode === 'subtract' ? negative : positive, points = Array.isArray(stroke?.points) ? stroke.points : [];
    if (!points.length) continue;
    const indexes = points.length > 2 ? [0, Math.floor(points.length / 2), points.length - 1] : points.map((_, index) => index);
    for (const index of indexes) {
      const point = points[index], x = Number(point?.[0] ?? point?.x), y = Number(point?.[1] ?? point?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) target.push([Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]);
    }
  }
  return { positive: positive.slice(0, 6), negative: negative.slice(0, 32) };
}

async function initialize(message) {
  const { requestId, model } = message;
  if (!model || !MODEL_IDS.has(model.id) || model.format !== 'onnx' || !(model.buffer instanceof ArrayBuffer)) throw new Error('Invalid local model payload');
  await sessions.get(model.id)?.release?.();
  self.postMessage({ type: 'progress', requestId, stage: 'initializing' });
  const bytes = model.id === 'object-efficient-sam-ti' ? repairEfficientSamForOrt(new Uint8Array(model.buffer)) : new Uint8Array(model.buffer);
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', enableCpuMemArena: true });
  sessions.set(model.id, session);
  self.postMessage({ type: 'initialized', requestId, modelId: model.id, labels: model.labels || [] });
}

async function segmentObject(message, session) {
  const { requestId, bitmap, strokes = [], threshold = 50 } = message;
  if (!bitmap) throw new Error('The source image is unavailable');
  const prompts = promptPoints(strokes);
  if (!prompts.positive.length) { bitmap.close?.(); throw new Error('Click or paint on the object before selecting it'); }
  self.postMessage({ type: 'progress', requestId, stage: 'preparing-image' });
  const started = performance.now(), pixels = bitmapPixels(bitmap, 1024, 1024); bitmap.close?.();
  const image = planarRgb(pixels, 1024, 1024), coords = new Float32Array(12), labels = new Float32Array(6).fill(-1);
  prompts.positive.forEach((point, index) => { coords[index * 2] = point[0] * 1024; coords[index * 2 + 1] = point[1] * 1024; labels[index] = 1; });
  self.postMessage({ type: 'progress', requestId, stage: 'selecting-object' });
  const output = await session.run({
    batched_images: new ort.Tensor('float32', image, [1, 3, 1024, 1024]),
    batched_point_coords: new ort.Tensor('float32', coords, [1, 1, 6, 2]),
    batched_point_labels: new ort.Tensor('float32', labels, [1, 1, 6]),
  });
  const logits = output.output_masks.data, ious = output.iou_predictions.data, plane = 1024 * 1024, ranked = [0, 1, 2].sort((a, b) => ious[b] - ious[a]);
  let candidate = ranked[0];
  for (const next of ranked) {
    if (!prompts.negative.some(([x, y]) => logits[next * plane + Math.min(1023, Math.floor(y * 1024)) * 1024 + Math.min(1023, Math.floor(x * 1024))] >= 0)) { candidate = next; break; }
  }
  const logitThreshold = Math.max(-4, Math.min(4, (Number(threshold) - 50) / 12.5));
  const bits = packMask(plane, index => logits[candidate * plane + index] >= logitThreshold);
  self.postMessage({ type: 'result', requestId, modelId: 'object-efficient-sam-ti', width: 1024, height: 1024, sourceWidth: message.sourceWidth, sourceHeight: message.sourceHeight, categories: [], labels: [], elapsed: performance.now() - started, bits: bits.buffer }, [bits.buffer]);
}

async function segmentPeople(message, session) {
  const { requestId, bitmap } = message;
  if (!bitmap) throw new Error('The source image is unavailable');
  self.postMessage({ type: 'progress', requestId, stage: 'finding-people' });
  const started = performance.now(), pixels = bitmapPixels(bitmap, 192, 192); bitmap.close?.();
  const input = planarRgb(pixels, 192, 192, true);
  const output = await session.run({ x: new ort.Tensor('float32', input, [1, 3, 192, 192]) });
  const logits = output['save_infer_model/scale_0.tmp_1'].data, plane = 192 * 192;
  const bits = packMask(plane, index => logits[plane + index] > logits[index]);
  self.postMessage({ type: 'result', requestId, modelId: 'people-pphumanseg', width: 192, height: 192, sourceWidth: message.sourceWidth, sourceHeight: message.sourceHeight, categories: [1], labels: ['background', 'person'], elapsed: performance.now() - started, bits: bits.buffer }, [bits.buffer]);
}

function smartSkyMask(message) {
  const { requestId, bitmap } = message;
  if (!bitmap) throw new Error('The source image is unavailable');
  const width = Math.max(1, Math.min(512, bitmap.width)), height = Math.max(1, Math.round(bitmap.height * width / bitmap.width));
  const pixels = bitmapPixels(bitmap, width, height); bitmap.close?.();
  const count = width * height, selected = new Uint8Array(count), queued = new Uint8Array(count), queue = new Uint32Array(count);
  let head = 0, tail = 0;
  const colorDistance = (a, b) => { const ai = a * 4, bi = b * 4, dr = pixels[ai] - pixels[bi], dg = pixels[ai + 1] - pixels[bi + 1], db = pixels[ai + 2] - pixels[bi + 2]; return Math.sqrt(dr * dr * .25 + dg * dg * .5 + db * db * .25); };
  for (let x = 0; x < width; x++) { queued[x] = 1; queue[tail++] = x; }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width), offset = index * 4;
    const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2], max = Math.max(r, g, b), min = Math.min(r, g, b), saturation = max ? (max - min) / max : 0, luminance = .2126*r+.7152*g+.0722*b;
    const blueSky=b>80&&b>=r*1.04&&b>=g*.9,brightCloud=saturation<.16&&luminance>135&&b>=r*.92;
    if (!(blueSky || brightCloud || y < height * .035) || y > height * .84) continue;
    selected[index] = 1;
    for (const next of [index - 1, index + 1, index - width, index + width]) {
      if (next < 0 || next >= count || queued[next] || Math.abs(next % width - x) > 1) continue;
      const nextY = Math.floor(next / width), gradient = colorDistance(index, next), edgeLimit = 30-nextY/height*14;
      if (gradient <= edgeLimit) { queued[next] = 1; queue[tail++] = next; }
    }
  }
  const bits = packMask(count, index => selected[index] > 0);
  self.postMessage({ type: 'result', requestId, modelId: 'smart-sky-v1', width, height, sourceWidth: message.sourceWidth, sourceHeight: message.sourceHeight, categories: [], labels: ['sky'], elapsed: 0, bits: bits.buffer }, [bits.buffer]);
}

self.onmessage = async event => {
  const message = event.data || {};
  try {
    if (message.type === 'init') return await initialize(message);
    if (message.type === 'close') { for (const session of sessions.values()) await session.release?.(); sessions.clear(); self.close(); return; }
    if (message.type !== 'segment') return;
    if (message.modelId === 'smart-sky-v1') return smartSkyMask(message);
    const session = sessions.get(message.modelId);
    if (!session) throw new Error('The requested local model is not initialized');
    if (message.modelId === 'object-efficient-sam-ti') await segmentObject(message, session); else if (message.modelId === 'people-pphumanseg') await segmentPeople(message, session); else throw new Error('Unknown local model');
  } catch (error) {
    event.data?.bitmap?.close?.();
    self.postMessage({ type: 'error', requestId: message.requestId, error: String(error?.message || error || 'Local segmentation failed') });
  }
};
