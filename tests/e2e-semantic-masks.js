'use strict';

const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `semantic-mask-user-data-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });

let runningApp;

async function livePage(app) {
  let page = await app.firstWindow();
  await page.waitForTimeout(900);
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  await page.waitForSelector('body', { timeout: 15_000 });
  return page;
}

(async () => {
  const rendererErrors = [];
  runningApp = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--disable-software-rasterizer',
      '--in-process-gpu',
      `--user-data-dir=${userData}`,
      root,
    ],
    cwd: runtimeCwd,
  });
  const page = await livePage(runningApp);
  page.on('pageerror', error => rendererErrors.push(`PAGE: ${error.stack || error}`));
  page.on('console', message => {
    if (message.type() === 'error') rendererErrors.push(`CONSOLE: ${message.text()}`);
  });

  if (await page.locator('#tutorialDialog[open]').count()) {
    await page.click('#tutorialSkip');
    await page.locator('#tutorialDialog').waitFor({ state: 'hidden' });
  }

  const report = await page.evaluate(async () => {
    const failures = [];
    const makeCanvas = (width, height, paint) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      paint(context, width, height);
      return canvas;
    };
    const canvasPixels = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    const pixel = (canvas, x, y) => [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data];
    const difference = (left, right) => {
      let maximum = 0;
      let total = 0;
      let changed = 0;
      for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const delta = Math.abs(left[index] - right[index]);
        maximum = Math.max(maximum, delta);
        total += delta;
        if (delta) changed++;
      }
      return { maximum, mean: total / Math.max(1, Math.min(left.length, right.length)), changed };
    };
    const bitsBase64 = (width, height, predicate) => {
      const bytes = new Uint8Array(Math.ceil(width * height / 8));
      for (let index = 0; index < width * height; index++) {
        if (predicate(index % width, Math.floor(index / width), index)) bytes[index >> 3] |= 1 << (index & 7);
      }
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    const semantic = (modelId = 'object-efficient-sam-ti') => ({
      kind: modelId === 'people-pphumanseg' ? 'people' : 'object',
      modelId,
      modelVersion: 'opencv-zoo-pinned',
      width: 4,
      height: 2,
      bits: bitsBase64(4, 2, x => x < 2),
      categories: modelId === 'people-pphumanseg' ? [1, 1, -1, 999, 2.5] : [],
      threshold: 50,
      sourceWidth: 16,
      sourceHeight: 8,
    });

    // Sanitization is the catalog trust boundary. Exact bit lengths and the
    // same fixed model IDs used by the Worker/model manager must survive it.
    const validObject = E.migratedEdits({
      version: 6,
      masks: { activeId: 'object', layers: [{ id: 'object', type: 'object', semantic: semantic() }] },
    }).masks.layers[0].semantic;
    const validPeople = E.migratedEdits({
      version: 6,
      masks: { activeId: 'people', layers: [{ id: 'people', type: 'people', semantic: semantic('people-pphumanseg') }] },
    }).masks.layers[0].semantic;
    if (!validObject || validObject.modelId !== 'object-efficient-sam-ti') failures.push('Object model ID was not preserved by the semantic-mask sanitizer');
    if (!validPeople || validPeople.modelId !== 'people-pphumanseg') failures.push('People model ID was not preserved by the semantic-mask sanitizer');
    if (JSON.stringify(validPeople?.categories) !== '[1]') failures.push(`Semantic categories were not bounded and deduplicated: ${JSON.stringify(validPeople?.categories)}`);

    const sanitized = raw => E.migratedEdits({
      version: 6,
      masks: { activeId: 'malicious', layers: [{ id: 'malicious', type: 'object', semantic: raw }] },
    }).masks.layers[0].semantic;
    const maliciousCases = {
      oversizedDimensions: sanitized({ ...semantic(), width: 100_000_000, height: 100_000_000, bits: 'AAAA' }),
      overPixelBudget: sanitized({ ...semantic(), width: 2048, height: 2048, bits: 'AAAA' }),
      wrongByteCount: sanitized({ ...semantic(), bits: 'AAAA' }),
      malformedBase64: sanitized({ ...semantic(), bits: '!!!!' }),
      nonObject: sanitized('not-an-object'),
    };
    for (const [name, value] of Object.entries(maliciousCases)) {
      if (value !== null) failures.push(`Rejected semantic payload survived sanitization: ${name}`);
    }

    // Render a coarse semantic map against a larger source. The left half is
    // selected and receives exactly one stop; the right half is untouched.
    const source = makeCanvas(16, 8, context => {
      context.fillStyle = 'rgb(48, 48, 48)';
      context.fillRect(0, 0, 16, 8);
    });
    const edits = E.defaultEdits();
    const layer = E.defaultMaskLayer({
      id: 'semantic-left',
      name: 'Semantic left',
      type: 'object',
      feather: 0,
      subjectExposure: 1,
      show: false,
      semantic: semantic(),
    });
    edits.masks = { activeId: layer.id, layers: [layer] };
    const rendered = E.render(source, edits, { maxEdge: 16 });
    const inside = pixel(rendered, 2, 4);
    const outside = pixel(rendered, 13, 4);
    if (inside[0] < outside[0] + 35 || Math.abs(outside[0] - 48) > 2) {
      failures.push(`Semantic mask did not isolate the selected half: inside=${inside} outside=${outside}`);
    }

    // A sampled color range intersects the semantic result rather than
    // replacing it. Only the red selected quadrant should receive exposure.
    const rangedSource = makeCanvas(16, 8, context => {
      context.fillStyle = 'rgb(140, 28, 25)';
      context.fillRect(0, 0, 8, 4);
      context.fillStyle = 'rgb(25, 55, 140)';
      context.fillRect(0, 4, 8, 4);
      context.fillStyle = 'rgb(70, 70, 70)';
      context.fillRect(8, 0, 8, 8);
    });
    const rangedEdits = E.clone(edits);
    Object.assign(rangedEdits.masks.layers[0], {
      rangeType: 'color',
      rangeHue: 1,
      rangeSaturation: 70,
      rangeLuminance: 32,
      rangeAmount: 12,
    });
    const ranged = E.render(rangedSource, rangedEdits, { maxEdge: 16 });
    const rangedRed = pixel(ranged, 2, 2);
    const rangedBlue = pixel(ranged, 2, 6);
    const rangedGray = pixel(ranged, 13, 2);
    if (rangedRed[0] < 180 || rangedBlue[2] > 155 || Math.abs(rangedGray[0] - 70) > 3) {
      failures.push(`Color range did not intersect the semantic mask: red=${rangedRed} blue=${rangedBlue} gray=${rangedGray}`);
    }

    // Frozen v5-shaped data must migrate without mutating the source or
    // changing pixels when compared with its explicit current representation.
    const v5 = {
      version: 5,
      profile: 'Luma Color',
      light: { exposure: 0.25, contrast: 18, highlights: -12, shadows: 9, whites: 4, blacks: -6 },
      color: { wb: 'As Shot', temperature: 8, tint: -3, vibrance: 15, saturation: -4 },
      effects: { texture: 10, clarity: 7, dehaze: 3, vignette: -8, grain: 4 },
      masks: {
        activeId: 'v5-radial',
        layers: [{
          id: 'v5-radial', name: 'v5 radial', enabled: true, type: 'radial', space: 'source',
          x: 0.5, y: 0.5, x2: 0.78, y2: 0.5, feather: 35, opacity: 85,
          subjectExposure: 0.4, localSaturation: 12, show: false, strokes: [],
        }],
      },
      cleanup: [],
    };
    const frozenV5 = JSON.stringify(v5);
    const v7 = E.migratedEdits(v5);
    const v5Canvas = E.render(rangedSource, v5, { maxEdge: 16 });
    const v7Canvas = E.render(rangedSource, v7, { maxEdge: 16 });
    const migrationPixels = difference(canvasPixels(v5Canvas), canvasPixels(v7Canvas));
    const migration = {
      version: v7.version,
      rangeType: v7.masks.layers[0].rangeType,
      semantic: v7.masks.layers[0].semantic,
      exposure: v7.light.exposure,
      subjectExposure: v7.masks.layers[0].subjectExposure,
      inputUnchanged: frozenV5 === JSON.stringify(v5),
      pixels: migrationPixels,
    };
    if (migration.version !== E.EDIT_SCHEMA_VERSION || migration.rangeType !== 'none' || migration.semantic !== null || migration.exposure !== 0.25 || migration.subjectExposure !== 0.4 || !migration.inputUnchanged || migrationPixels.maximum !== 0) {
      failures.push(`v5-to-current migration changed legacy state or pixels: ${JSON.stringify(migration)}`);
    }

    const workerRender = async workerEdits => {
      const previewWorker = new Worker('preview-worker.js');
      const exportWorker = new Worker('render-worker.js');
      const previewId = 'semantic-preview';
      const token = 'semantic-source';
      const sourceForWorkers = makeCanvas(96, 64, context => {
        const gradient = context.createLinearGradient(0, 0, 96, 64);
        gradient.addColorStop(0, '#2d5487');
        gradient.addColorStop(1, '#d98045');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 96, 64);
      });
      const waitPreview = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Preview semantic-mask worker timed out')), 30_000);
        previewWorker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message || 'Preview worker failed')); };
        previewWorker.onmessage = event => {
          if (event.data?.type === 'ready') {
            previewWorker.postMessage({ type: 'render', id: previewId, token, edits: workerEdits, maxEdge: 96, visualizeMask: false, clipping: false });
          } else if (event.data?.type === 'rendered' && event.data.id === previewId) {
            clearTimeout(timeout);
            resolve(event.data);
          } else if (event.data?.type === 'error') {
            clearTimeout(timeout);
            reject(new Error(event.data.error));
          }
        };
      });
      const previewSource = await createImageBitmap(sourceForWorkers);
      previewWorker.postMessage({ type: 'init', token, bitmap: previewSource }, [previewSource]);

      const exportId = 'semantic-export';
      const waitExport = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Export semantic-mask worker timed out')), 30_000);
        exportWorker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message || 'Export worker failed')); };
        exportWorker.onmessage = event => {
          if (event.data?.id !== exportId || event.data.progress) return;
          clearTimeout(timeout);
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data);
        };
      });
      const exportSource = await createImageBitmap(sourceForWorkers);
      exportWorker.postMessage({ id: exportId, bitmap: exportSource, edits: workerEdits, maxEdge: 96, watermark: '', mime: 'image/png', quality: 1 }, [exportSource]);

      try {
        const [previewResult, exportResult] = await Promise.all([waitPreview, waitExport]);
        const previewCanvas = makeCanvas(previewResult.width, previewResult.height, context => context.drawImage(previewResult.bitmap, 0, 0));
        previewResult.bitmap.close();
        const exportBitmap = await createImageBitmap(new Blob([exportResult.bytes], { type: exportResult.mime }));
        const exportCanvas = makeCanvas(exportBitmap.width, exportBitmap.height, context => context.drawImage(exportBitmap, 0, 0));
        exportBitmap.close();
        return {
          previewSize: [previewCanvas.width, previewCanvas.height],
          exportSize: [exportCanvas.width, exportCanvas.height],
          difference: difference(canvasPixels(previewCanvas), canvasPixels(exportCanvas)),
        };
      } finally {
        previewWorker.postMessage({ type: 'close' });
        previewWorker.terminate();
        exportWorker.terminate();
        sourceForWorkers.width = sourceForWorkers.height = 1;
      }
    };

    const parityEdits = E.defaultEdits();
    const parityLayer = E.defaultMaskLayer({
      id: 'semantic-parity', type: 'object', feather: 0, subjectExposure: 0.65, localSaturation: 24, show: false,
      semantic: {
        kind: 'object', modelId: 'object-efficient-sam-ti', modelVersion: 'opencv-zoo-pinned',
        width: 12, height: 8, bits: bitsBase64(12, 8, (x, y) => x >= 2 && x <= 9 && y >= 1 && y <= 6),
        categories: [], threshold: 50, sourceWidth: 96, sourceHeight: 64,
      },
    });
    parityEdits.masks = { activeId: parityLayer.id, layers: [parityLayer] };
    const previewExportParity = await workerRender(parityEdits);
    if (previewExportParity.previewSize.join(',') !== '96,64' || previewExportParity.exportSize.join(',') !== '96,64' || previewExportParity.difference.maximum !== 0) {
      failures.push(`Preview/export semantic render diverged: ${JSON.stringify(previewExportParity)}`);
    }

    // Large semantic bitsets must not create gaps in the undo timeline. A
    // later Undo may remove only the most recent mask, never every edit made
    // after an older recorded snapshot.
    const historyPhoto = E.migratePhoto({ id: 'semantic-history', filePath: 'C:\\semantic-history.jpg', name: 'semantic-history.jpg' });
    photos = [historyPhoto]; current = historyPhoto; undoByPhoto.clear(); redoByPhoto.clear(); historyLru.clear();
    const largeBits = bitsBase64(1024, 1024, x => x < 512);
    const additions = [
      ['history-subject', 'Subject', 'subject'],
      ['history-background', 'Background', 'background'],
      ['history-people', 'People', 'people'],
      ['history-sky', 'Sky', 'sky'],
      ['history-brush', 'Brush', 'brush'],
    ];
    for (const [id, name, type] of additions) {
      const before = E.clone(current.edits);
      const layer = E.defaultMaskLayer({
        id, name, type, show: false,
        semantic: type === 'brush' ? null : {
          kind: type, modelId: 'object-efficient-sam-ti', modelVersion: 'test',
          width: 1024, height: 1024, bits: largeBits, categories: [], threshold: 50,
          sourceWidth: 1024, sourceHeight: 1024,
        },
      });
      current.edits.masks.layers.unshift(layer);
      current.edits.masks.activeId = id;
      pushHistory(before, current.edits, `Select ${name}`);
    }
    const stackBeforeUndo = current.edits.masks.layers.map(layer => layer.name);
    const [historyUndo, historyRedo] = historyStacks();
    const historyCount = historyUndo.length;
    const undoItem = historyUndo.pop(); historyRedo.push(undoItem); applyHistoryItem(undoItem, 'before');
    const stackAfterUndo = current.edits.masks.layers.map(layer => layer.name);
    const redoItem = historyRedo.pop(); historyUndo.push(redoItem); applyHistoryItem(redoItem, 'after');
    const stackAfterRedo = current.edits.masks.layers.map(layer => layer.name);
    const semanticHistory = { historyCount, stackBeforeUndo, stackAfterUndo, stackAfterRedo, retainedBytes: historyUndo.reduce((sum, item) => sum + historyItemBytes(item), 0) };
    if (historyCount !== additions.length || stackAfterUndo.join(',') !== stackBeforeUndo.slice(1).join(',') || stackAfterRedo.join(',') !== stackBeforeUndo.join(',') || semanticHistory.retainedBytes > MAX_HISTORY_BYTES_PER_PHOTO) {
      failures.push(`Semantic-mask undo timeline was not exact and bounded: ${JSON.stringify(semanticHistory)}`);
    }

    for (const canvas of [source, rendered, rangedSource, ranged, v5Canvas, v7Canvas]) canvas.width = canvas.height = 1;
    return { validObject, validPeople, maliciousCases, inside, outside, rangedRed, rangedBlue, rangedGray, migration, previewExportParity, semanticHistory, failures };
  });

  if (rendererErrors.length) report.failures.push('Renderer emitted unexpected errors');
  report.rendererErrors = rendererErrors;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await runningApp.close();
  await fs.promises.rm(userData, { recursive: true, force: true });
  if (report.failures.length) throw new Error(report.failures.join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await runningApp?.close(); } catch {}
  await fs.promises.rm(userData, { recursive: true, force: true }).catch(() => {});
  process.exitCode = 1;
});
