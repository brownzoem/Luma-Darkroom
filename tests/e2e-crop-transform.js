/**
 * End-to-end coverage for the interactive crop tool and geometry safety rails:
 * crop handles, aspect + shape crops (with alpha), cancel/apply semantics,
 * catalog persistence, rotate/flip remapping, hostile-input sanitization,
 * layer limits, degenerate gestures, and preview/export worker parity.
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `crop-transform-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });

const failures = [];
const check = (condition, message, detail) => {
  if (!condition) failures.push(message + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
};

(async () => {
  const fixtures = await createPhotoFixtures(1);
  const app = await electron.launch({ args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--in-process-gpu', `--user-data-dir=${userData}`, root], cwd: runtimeCwd });
  let page = await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1400));
  page = app.windows().filter(w => !w.isClosed()).at(-1) || page;
  const errors = [];
  const hookErrors = target => { target.on('pageerror', e => errors.push(`PAGE: ${e.stack || e}`)); target.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); }); };
  hookErrors(page);

  await page.locator('#tutorialDialog[open]').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if (await page.locator('#tutorialDialog[open]').count()) { await page.click('#tutorialSkip'); await page.locator('#tutorialDialog').waitFor({ state: 'hidden' }); }
  await page.evaluate(paths => {
    const catalog = paths.map((filePath, i) => ({ id: `crop-${i}`, filePath, name: 'crop-' + i, importedAt: Date.now(), edits: null }));
    localStorage.setItem('luma-catalog-v2', JSON.stringify(catalog));
    photos = catalog.map(p => E.migratePhoto(p));
    updateLibrary();
    selectPhoto(photos[0]);
  }, fixtures.paths);
  await page.waitForFunction(() => document.querySelector('#canvas').width > 500, null, { timeout: 30000 });
  const settle = () => page.waitForFunction(() => !previewWorkerPreparing && !previewWorkerBusy && !previewWorkerPending && canvas.dataset.previewQuality === 'full', null, { timeout: 20000 });
  await settle();

  const box = await page.locator('#canvas').boundingBox();
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  // Hostile region / geometry input is sanitized without side effects.
  const fuzz = await page.evaluate(() => {
    const hostile = E.migratedEdits({
      version: 5,
      geometry: { cropL: 'NaN', cropT: -3, cropR: 99, cropB: 0.5, stretchX: 1e9, cropShapeKind: '<x>', cropShapeRotation: 725, cropShapePoints: [[NaN, 1], 'junk', [0.1, 0.2], [0.3, 0.4], [0.5, 0.6]] },
      masks: {
        activeId: 'x', layers: [{
          id: 'x', type: 'geometry', enabled: true,
          regions: [
            { kind: 'polygon', mode: 'add', points: Array.from({ length: 5000 }, (_, i) => [i / 5000, (i % 7) / 7]) },
            { kind: 'polygon', mode: 'add', points: [[0, 0], [1, NaN], [1, 1]] },
            { kind: 'shape', mode: 'weird', shape: 'pentagram', cx: 55, cy: -55, w: 1e9, h: -5, rotation: 720, roundness: 1e6 },
            { kind: 'wand', mode: 'intersect', x: 2, y: -1, tolerance: 5000, contiguous: 'maybe' },
            { kind: 'exploit', mode: 'add' }, null, 42, 'region'
          ]
        }]
      }
    });
    const layer = hostile.masks.layers[0];
    const shape = layer.regions.find(region => region.kind === 'shape');
    const wand = layer.regions.find(region => region.kind === 'wand');
    return {
      regionCount: layer.regions.length,
      polygonCapped: layer.regions[0].points.length <= 1200,
      noNaN: !layer.regions.some(region => region.points?.some(point => point.some(value => !Number.isFinite(value)))),
      shapeOk: shape && shape.shape === 'rect' && shape.mode === 'add' && shape.cx === 2 && shape.w === 2 && shape.rotation === 0 && shape.roundness === 100,
      wandOk: wand && wand.x === 1 && wand.tolerance === 100 && wand.contiguous === true && wand.mode === 'intersect',
      geometryOk: hostile.geometry.cropL === 0 && hostile.geometry.cropR === 1 && hostile.geometry.stretchX === 400 && hostile.geometry.cropShapeKind === '' && hostile.geometry.cropShapeRotation === 5
    };
  });
  check(fuzz.regionCount === 3 && fuzz.polygonCapped && fuzz.noNaN, 'hostile regions sanitized', fuzz);
  check(fuzz.shapeOk && fuzz.wandOk && fuzz.geometryOk, 'hostile shape/wand/geometry values clamped', fuzz);

  // Crop mode: 8 handles, SE handle drag, Enter applies.
  await page.keyboard.press('c');
  await page.waitForTimeout(300);
  const cropState = await page.evaluate(() => ({ active: LumaCropTool.isActive(), handles: document.querySelectorAll('.crop-handle').length, hidden: document.querySelector('#cropHandles').classList.contains('hidden') }));
  check(cropState.active && cropState.handles === 8 && !cropState.hidden, 'crop mode active with 8 handles', cropState);
  const seHandle = await page.locator('.crop-handle-se').boundingBox();
  check(!!seHandle, 'SE handle is on screen');
  if (seHandle) {
    await page.mouse.move(seHandle.x + seHandle.width / 2, seHandle.y + seHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(seHandle.x - box.width * 0.25, seHandle.y - box.height * 0.2, { steps: 6 });
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const cropResult = await page.evaluate(() => ({ r: current.edits.geometry.cropR, b: current.edits.geometry.cropB, active: LumaCropTool.isActive() }));
  check(!cropResult.active && (cropResult.r < 0.999 || cropResult.b < 0.999), 'handle drag + Enter commits a rect crop', cropResult);

  // Aspect lock produces the requested ratio.
  await page.keyboard.press('c');
  await page.waitForTimeout(250);
  await page.evaluate(() => LumaCropTool.setAspect('1 : 1'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const square = await page.evaluate(() => {
    const g = current.edits.geometry;
    const rotation = ((g.rotation90 % 360) + 360) % 360, swap = rotation === 90 || rotation === 270;
    const width = (swap ? sourceImage.naturalHeight : sourceImage.naturalWidth) * (g.cropR - g.cropL);
    const height = (swap ? sourceImage.naturalWidth : sourceImage.naturalHeight) * (g.cropB - g.cropT);
    return { ratio: width / height };
  });
  check(Math.abs(square.ratio - 1) < 0.02, 'aspect preset locks crop to 1:1', square);

  // Swapping a locked crop orientation is a stable two-state toggle. It must
  // not repeatedly fit the new ratio inside the already-shrunken rectangle.
  await page.keyboard.press('c');
  await page.waitForTimeout(250);
  await page.evaluate(() => { LumaCropTool.setRect(0.08, 0.12, 0.92, 0.88); LumaCropTool.setAspect('3 : 2'); });
  const readOrientation = () => page.evaluate(() => {
    const state = LumaCropTool.state, rect = state.rect, geometry = current.edits.geometry;
    const rotation = ((geometry.rotation90 % 360) + 360) % 360, rotated = rotation === 90 || rotation === 270;
    const frameWidth = rotated ? sourceImage.naturalHeight : sourceImage.naturalWidth;
    const frameHeight = rotated ? sourceImage.naturalWidth : sourceImage.naturalHeight;
    const width = (rect.r - rect.l) * frameWidth, height = (rect.b - rect.t) * frameHeight;
    return { rect: [rect.l, rect.t, rect.r, rect.b], ratio: state.ratio, label: state.ratioLabel, width, height, area: width * height };
  });
  const orientationStates = [await readOrientation()];
  await page.locator('[title="Swap crop orientation (X)"]').click();
  orientationStates.push(await readOrientation());
  for (let index = 0; index < 10; index++) { await page.keyboard.press('x'); orientationStates.push(await readOrientation()); }
  const closeRect = (a, b) => a.every((value, index) => Math.abs(value - b[index]) < 1e-8);
  const stableOrientation = orientationStates.every((state, index) => closeRect(state.rect, orientationStates[index % 2].rect));
  const correctRatios = orientationStates.every((state, index) => Math.abs(state.ratio - (index % 2 ? 2 / 3 : 3 / 2)) < 1e-8 && state.label === (index % 2 ? '2 : 3' : '3 : 2'));
  check(stableOrientation, 'repeated crop orientation swaps do not progressively shrink', orientationStates);
  check(correctRatios, 'crop orientation swap updates and alternates the locked aspect', orientationStates);
  await page.evaluate(() => { LumaCropTool.setRect(0.3, 0.3, 0.7, 0.7); LumaCropTool.setAspect('4 : 5'); });
  const areaBeforeSwap = await readOrientation();
  await page.keyboard.press('x');
  const areaAfterSwap = await readOrientation();
  await page.keyboard.press('x');
  const areaAfterRoundTrip = await readOrientation();
  const center = state => [(state.rect[0] + state.rect[2]) / 2, (state.rect[1] + state.rect[3]) / 2];
  const centerBefore = center(areaBeforeSwap), centerAfter = center(areaAfterSwap);
  check(Math.abs(areaAfterSwap.area - areaBeforeSwap.area) < 1e-6 && Math.abs(centerAfter[0] - centerBefore[0]) < 1e-8 && Math.abs(centerAfter[1] - centerBefore[1]) < 1e-8, 'crop orientation swap preserves area and center when both orientations fit', { areaBeforeSwap, areaAfterSwap });
  check(closeRect(areaAfterRoundTrip.rect, areaBeforeSwap.rect) && areaAfterSwap.label === '5 : 4' && areaAfterRoundTrip.label === '4 : 5', 'two crop orientation swaps restore the exact starting rectangle and label', { areaBeforeSwap, areaAfterSwap, areaAfterRoundTrip });

  // The dimmed margin is still part of the photograph. Starting a normal drag
  // there must pan the photo and remain a pan after crossing into the crop; it
  // must never become the old implicit straighten gesture.
  await page.evaluate(() => {
    LumaCropTool.setRect(0.3, 0.25, 0.7, 0.75);
    Object.assign(current.edits.geometry, { straighten: 7.5, xOffset: 0, yOffset: 0 });
    scheduleRender();
  });
  await page.waitForTimeout(200);
  const cropCanvasBox = await page.locator('#canvas').boundingBox();
  const cropPoint = (fx, fy) => ({ x: cropCanvasBox.x + cropCanvasBox.width * fx, y: cropCanvasBox.y + cropCanvasBox.height * fy });
  const marginDragStart = cropPoint(0.12, 0.36), marginDragEnd = cropPoint(0.44, 0.58);
  const marginCursorBefore = await page.evaluate(() => getComputedStyle(document.querySelector('#canvas')).cursor);
  await page.mouse.move(marginDragStart.x, marginDragStart.y);
  await page.mouse.down();
  const marginGesture = await page.evaluate(() => ({
    kind: LumaCropTool.state.gesture?.kind,
    part: LumaCropTool.state.gesture?.part,
    cursor: getComputedStyle(document.querySelector('#canvas')).cursor
  }));
  await page.mouse.move(marginDragEnd.x, marginDragEnd.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const marginPan = await page.evaluate(() => ({
    straighten: current.edits.geometry.straighten,
    xOffset: current.edits.geometry.xOffset,
    yOffset: current.edits.geometry.yOffset,
    rect: { ...LumaCropTool.state.rect },
    gesture: LumaCropTool.state.gesture,
    cursor: getComputedStyle(document.querySelector('#canvas')).cursor
  }));
  check(marginGesture.kind === 'photo' && marginGesture.part === 'photo-pan', 'dimmed photo margin starts a pan gesture', marginGesture);
  check(marginCursorBefore === 'grab' && marginGesture.cursor === 'grabbing' && marginPan.cursor === 'grab', 'crop cursor communicates grab and active panning', { marginCursorBefore, marginGesture, marginPan });
  check(Math.abs(marginPan.straighten - 7.5) < 1e-8, 'dragging the photo outside a smaller crop does not rotate it', marginPan);
  check(Math.abs(marginPan.xOffset) > 1e-4 || Math.abs(marginPan.yOffset) > 1e-4, 'dragging the dimmed photo margin pans the photo', marginPan);
  check(closeRect(Object.values(marginPan.rect), [0.3, 0.25, 0.7, 0.75]) && marginPan.gesture === null, 'margin pan leaves the crop rectangle fixed and finishes cleanly', marginPan);

  // Canceling while the pointer is still down must release the fast canvas
  // preview as well as restoring the entry snapshot. A later pointerup must be
  // harmless instead of leaving a stale gesture or grabbing cursor behind.
  const interruptedStart = cropPoint(0.14, 0.38), interruptedEnd = cropPoint(0.2, 0.42);
  await page.mouse.move(interruptedStart.x, interruptedStart.y);
  await page.mouse.down();
  await page.evaluate(() => {
    window.__interruptedCropGesture = LumaCropTool.state.gesture;
    window.__cropEntrySnapshot = JSON.stringify(LumaCropTool.state.snapshot);
  });
  await page.mouse.move(interruptedEnd.x, interruptedEnd.y, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const interruptedPan = await page.evaluate(() => ({
    active: LumaCropTool.isActive(),
    gesture: LumaCropTool.state.gesture,
    warp: window.__interruptedCropGesture?.warp,
    restored: JSON.stringify(current.edits) === window.__cropEntrySnapshot,
    grabbing: document.querySelector('.canvas-wrap')?.classList.contains('panning')
  }));
  check(!interruptedPan.active && interruptedPan.gesture === null && interruptedPan.warp === null, 'Esc during a margin pan releases the gesture and canvas warp', interruptedPan);
  check(interruptedPan.restored && !interruptedPan.grabbing, 'Esc during a margin pan restores edits and clears the grabbing cursor', interruptedPan);

  // Shape crop renders transparency; Esc cancel restores exactly.
  const beforeShape = await page.evaluate(() => JSON.stringify(current.edits));
  await page.keyboard.press('c');
  await page.waitForTimeout(250);
  await page.evaluate(() => { LumaCropTool.setShape('star'); });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterCancel = await page.evaluate(() => JSON.stringify(current.edits));
  check(beforeShape === afterCancel, 'Esc cancels crop changes exactly');

  await page.keyboard.press('c');
  await page.waitForTimeout(250);
  await page.evaluate(() => { LumaCropTool.setShape('heart'); });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const shapeRender = await page.evaluate(() => {
    const out = E.render(sourceImage, E.clone(current.edits), { maxEdge: 240 });
    const data = out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, out.width, out.height).data;
    let transparent = 0, opaque = 0;
    for (let i = 3; i < data.length; i += 4) { if (data[i] < 16) transparent++; else if (data[i] > 240) opaque++; }
    return { kind: current.edits.geometry.cropShapeKind, transparent, opaque, total: data.length / 4 };
  });
  check(shapeRender.kind === 'heart' && shapeRender.transparent > shapeRender.total * 0.08 && shapeRender.opaque > shapeRender.total * 0.2, 'heart crop renders transparent corners', shapeRender);

  // Add a lasso selection with a local adjustment, then persist + reload.
  await page.keyboard.press('l');
  await page.evaluate(() => { LumaToolRail.state.lassoVariant = 'freehand'; });
  const lasso = [[0.3, 0.3], [0.6, 0.32], [0.55, 0.6], [0.32, 0.55]];
  const first = at(...lasso[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [fx, fy] of lasso.slice(1)) { const point = at(fx, fy); await page.mouse.move(point.x, point.y, { steps: 4 }); }
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.evaluate(() => commit('Local pop', () => { activeMask().subjectExposure = 1.2; activeMask().feather = 25; }));
  const beforePersist = await page.evaluate(() => { flushCatalog(); return JSON.stringify({ regions: activeMask()?.regions, g: current.edits.geometry }); });
  await page.reload();
  hookErrors(page);
  await page.waitForFunction(() => typeof photos !== 'undefined' && photos.length === 1 && current, null, { timeout: 20000 });
  const afterPersist = await page.evaluate(() => JSON.stringify({ regions: activeMask()?.regions, g: current.edits.geometry }));
  check(beforePersist === afterPersist, 'selection + shape crop survive catalog reload');

  // Rotate right+left and flip twice keep pixels and coordinates stable.
  const rotateRoundTrip = await page.evaluate(() => {
    const snapshot = E.clone(current.edits);
    const renderBytes = edits => {
      const out = E.render(sourceImage, E.clone(edits), { maxEdge: 160 });
      return out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, out.width, out.height).data;
    };
    const before = renderBytes(current.edits);
    commit('Rotate right', () => { current.edits.geometry.rotation90 += 90; remapEditPoints('right'); }, { render: false });
    const rotatedRegions = JSON.stringify(activeMask().regions);
    commit('Rotate left', () => { current.edits.geometry.rotation90 -= 90; remapEditPoints('left'); }, { render: false });
    const after = renderBytes(current.edits);
    let maxDelta = 0;
    for (let i = 0; i < before.length; i++) maxDelta = Math.max(maxDelta, Math.abs(before[i] - after[i]));
    return {
      maxDelta,
      stateMatch: JSON.stringify(E.migratedEdits(current.edits).masks.layers[0].regions) === JSON.stringify(E.migratedEdits(snapshot).masks.layers[0].regions),
      remapped: rotatedRegions !== JSON.stringify(snapshot.masks.layers[0].regions)
    };
  });
  check(rotateRoundTrip.maxDelta <= 24 && rotateRoundTrip.stateMatch && rotateRoundTrip.remapped, 'rotate round-trip stable + regions remapped', rotateRoundTrip);
  const flipRoundTrip = await page.evaluate(() => {
    const snapshot = JSON.stringify(E.migratedEdits(current.edits).masks.layers[0].regions);
    commit('Flip', () => { current.edits.geometry.flipX = !current.edits.geometry.flipX; remapEditPoints('flip-x'); }, { render: false });
    commit('Flip', () => { current.edits.geometry.flipX = !current.edits.geometry.flipX; remapEditPoints('flip-x'); }, { render: false });
    return snapshot === JSON.stringify(E.migratedEdits(current.edits).masks.layers[0].regions);
  });
  check(flipRoundTrip, 'flip twice restores region coordinates');

  // Mask layer cap (layers now come only from the explicit ＋ action) and degenerate gestures.
  const limit = await page.evaluate(() => {
    let guard = 0;
    while (current.edits.masks.layers.length < 8 && guard++ < 12) LumaToolRail.addSelectionLayer();
    const accepted = !!LumaToolRail.addSelectionLayer();
    return { layers: current.edits.masks.layers.length, accepted };
  });
  check(limit.layers === 8 && limit.accepted === false, 'ninth mask layer rejected', limit);
  const layersBefore = await page.evaluate(() => current.edits.masks.layers.length);
  await page.keyboard.press('m');
  await page.evaluate(() => { LumaToolRail.state.marqueeVariant = 'rect'; });
  const clickPoint = at(0.5, 0.5);
  await page.mouse.move(clickPoint.x, clickPoint.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  check(await page.evaluate(() => current.edits.masks.layers.length) === layersBefore, 'zero-size marquee creates nothing');

  // Tool switch mid-drag leaves no stuck gesture.
  const dragA = at(0.2, 0.2), dragB = at(0.4, 0.4);
  await page.mouse.move(dragA.x, dragA.y);
  await page.mouse.down();
  await page.mouse.move(dragB.x, dragB.y, { steps: 3 });
  await page.keyboard.press('v');
  await page.mouse.up();
  await page.waitForTimeout(150);
  check(await page.evaluate(() => !LumaToolRail.state.gesture) === true, 'no stuck gesture after mid-drag tool switch');

  // Preview worker and export worker agree exactly (premultiplied compare).
  const parity = await page.evaluate(async () => {
    const edits = E.clone(current.edits);
    const previewBitmap = await createImageBitmap(sourceImage);
    const previewWorkerInstance = new Worker('preview-worker.js');
    const previewResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('preview worker timeout')), 15000);
      previewWorkerInstance.onmessage = message => {
        if (message.data.type === 'ready') previewWorkerInstance.postMessage({ type: 'render', token: 't', id: 1, edits, maxEdge: 220, visualizeMask: false, clipping: false, draft: false, preserveCanvas: false });
        if (message.data.type === 'rendered') { clearTimeout(timer); resolve(message.data); }
        if (message.data.type === 'error') { clearTimeout(timer); reject(new Error(message.data.error)); }
      };
      previewWorkerInstance.postMessage({ type: 'init', token: 't', bitmap: previewBitmap }, [previewBitmap]);
    });
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = previewResult.width; previewCanvas.height = previewResult.height;
    const previewContext = previewCanvas.getContext('2d', { willReadFrequently: true });
    previewContext.drawImage(previewResult.bitmap, 0, 0);
    const previewData = previewContext.getImageData(0, 0, previewCanvas.width, previewCanvas.height).data;
    previewWorkerInstance.postMessage({ type: 'close' });

    const exportBitmap = await createImageBitmap(sourceImage);
    const exportWorker = new Worker('render-worker.js');
    const exportResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('export worker timeout')), 20000);
      exportWorker.onmessage = message => {
        if (message.data.bytes) { clearTimeout(timer); resolve(message.data); }
        if (message.data.error) { clearTimeout(timer); reject(new Error(message.data.error)); }
      };
      exportWorker.postMessage({ id: 'parity', bitmap: exportBitmap, edits, maxEdge: 220, watermark: '', mime: 'image/png', quality: undefined }, [exportBitmap]);
    });
    exportWorker.terminate();
    const decoded = await createImageBitmap(new Blob([exportResult.bytes], { type: 'image/png' }));
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = decoded.width; exportCanvas.height = decoded.height;
    const exportContext = exportCanvas.getContext('2d', { willReadFrequently: true });
    exportContext.drawImage(decoded, 0, 0);
    const exportData = exportContext.getImageData(0, 0, exportCanvas.width, exportCanvas.height).data;
    if (exportData.length !== previewData.length) return { match: false, reason: 'size mismatch' };
    let maxDelta = 0;
    for (let index = 0; index < previewData.length; index += 4) {
      const alphaA = previewData[index + 3] / 255, alphaB = exportData[index + 3] / 255;
      maxDelta = Math.max(maxDelta,
        Math.abs(previewData[index] * alphaA - exportData[index] * alphaB),
        Math.abs(previewData[index + 1] * alphaA - exportData[index + 1] * alphaB),
        Math.abs(previewData[index + 2] * alphaA - exportData[index + 2] * alphaB),
        Math.abs(previewData[index + 3] - exportData[index + 3]));
    }
    return { match: maxDelta <= 2, maxDelta };
  });
  check(parity.match, 'preview and export workers agree on geometry masks + shape crop', parity);

  const report = { failures, errors };
  process.stdout.write(JSON.stringify(report, null, 2));
  await app.close().catch(() => {});
  fixtures.cleanup();
  fs.rmSync(userData, { recursive: true, force: true });
  if (failures.length || errors.length) throw new Error([...failures, ...errors].join('; '));
})().catch(error => { console.error('\n' + (error?.stack || error)); process.exitCode = 2; });
