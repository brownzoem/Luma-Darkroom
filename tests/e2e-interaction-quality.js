const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { createPhotoFixtures } = require('./helpers/photo-fixtures');

const root = path.resolve(__dirname, '..');
const userData = path.join(root, 'work', `interaction-quality-${process.pid}`);
const runtimeCwd = path.join(userData, 'cwd');
fs.mkdirSync(runtimeCwd, { recursive: true });
let app;
let fixtures;

async function waitForPreview(page) {
  await page.waitForFunction(() => !previewWorkerPreparing && !previewWorkerBusy && !previewWorkerPending && Math.max(canvas.width, canvas.height) >= 1050, null, { timeout: 30000 });
}

(async () => {
  fixtures = await createPhotoFixtures(1);
  const convertedFixture = path.join(fixtures.directory, 'lossless-source.tiff');
  const convertedRaw = Buffer.alloc(48 * 32 * 3); for (let index = 0; index < convertedRaw.length; index++) convertedRaw[index] = (index * 73 + 19) % 256;
  await sharp(convertedRaw, { raw: { width: 48, height: 32, channels: 3 } }).tiff({ compression: 'lzw' }).toFile(convertedFixture);
  const errors = [];
  app = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer', '--in-process-gpu', `--user-data-dir=${userData}`, root],
    cwd: runtimeCwd
  });
  let page = await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1200));
  page = app.windows().filter(window => !window.isClosed()).at(-1) || page;
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForSelector('body');
  if (await page.locator('#tutorialDialog[open]').count()) await page.click('#tutorialSkip');
  await page.evaluate(filePath => {
    photos = [E.migratePhoto({ id: 'interaction-photo', filePath, name: 'interaction.jpg', importedAt: Date.now() })];
    updateLibrary();
    selectPhoto(photos[0]);
  }, fixtures.paths[0]);
  await waitForPreview(page);

  const convertedSource = await page.evaluate(async filePath => {
    const image = new Image(); image.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Converted source did not load')); image.src = `local-image://load?path=${encodeURIComponent(filePath)}`; });
    const surface = document.createElement('canvas'); surface.width = image.naturalWidth; surface.height = image.naturalHeight; const context = surface.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    return { width: image.naturalWidth, height: image.naturalHeight, samples: [...context.getImageData(0, 0, 4, 1).data] };
  }, convertedFixture);

  const presetBaseline = await page.evaluate(() => {
    current.edits = E.defaultEdits();
    current.edits.light.exposure = .31;
    current.edits.geometry.rotate = 6;
    clearPresetTracking();
    refreshControls();
    scheduleRender();
    return E.clone(current.edits);
  });
  await page.click('#presetsPanelTab');
  await page.click('.preset[data-name="Classic B&W"]');
  const blackAndWhite = await page.evaluate(() => ({ bw: current.edits.bw, curvePoints: current.edits.curve.rgb.length, grade: current.edits.grading.highlights.saturation }));
  await page.click('.preset[data-name="Clean Natural"]');
  const color = await page.evaluate(baseline => {
    const preset = presets.find(candidate => candidate.name === 'Clean Natural');
    const expected = blendPreset(baseline, resolvedPresetPatch(preset), 1);
    return {
      bw: current.edits.bw,
      curvePoints: current.edits.curve.rgb.length,
      grade: current.edits.grading.highlights.saturation,
      exposure: current.edits.light.exposure,
      rotate: current.edits.geometry.rotate,
      exactReplacement: JSON.stringify(current.edits) === JSON.stringify(expected)
    };
  }, presetBaseline);

  await page.evaluate(() => {
    current.edits = E.defaultEdits();
    current.edits.curve.rgb = [[0, 20], [80, 90], [255, 240]];
    clearPresetTracking();
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    presetAmount.value = '0';
    presetAmountOut.value = '0';
    refreshControls();
  });
  await page.click('.preset[data-name="Natural Portrait"]');
  const amountAtZero = await page.evaluate(() => E.clone(current.edits.curve.rgb));
  await page.locator('#presetAmount').evaluate(element => { element.value = '50'; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
  const amountAtFifty = await page.evaluate(() => E.clone(current.edits.curve.rgb));
  await page.click('#undoBtn');
  const amountAfterUndo = await page.evaluate(() => E.clone(current.edits.curve.rgb));
  await page.click('#redoBtn');
  const amountAfterRedo = await page.evaluate(() => E.clone(current.edits.curve.rgb));
  const migratedMixerHue = await page.evaluate(() => E.migratedEdits({ mixer: { green: { hue: -15 } } }).mixer.green.hue);

  await page.evaluate(() => {
    current.edits = E.defaultEdits();
    clearPresetTracking();
    undoByPhoto.set(current.id, []);
    redoByPhoto.set(current.id, []);
    refreshControls();
    scheduleRender();
  });
  await page.click('#maskPanelTab');
  // Exercise migration-compatible manual object selection without downloading
  // the optional semantic model in this rendering/latency suite.
  await page.evaluate(() => addMaskAndActivate('subject'));
  let canvasBox = await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvasBox.x + canvasBox.width * .5, canvasBox.y + canvasBox.height * .78);
  await waitForPreview(page);

  const maskStats = () => page.evaluate(() => {
    const edits = E.clone(current.edits);
    const mask = edits.masks.layers.find(layer => layer.id === edits.masks.activeId);
    mask.show = false;
    const plain = E.render(sourceImage, edits, { maxEdge: 220 });
    mask.show = true;
    const overlay = E.render(sourceImage, edits, { maxEdge: 220, visualizeMask: true });
    const a = plain.getContext('2d').getImageData(0, 0, plain.width, plain.height).data;
    const b = overlay.getContext('2d').getImageData(0, 0, overlay.width, overlay.height).data;
    const rows = [];
    let covered = 0, sumX = 0, sumY = 0;
    for (let y = 0; y < overlay.height; y++) {
      let first = -1, last = -1;
      for (let x = 0; x < overlay.width; x++) {
        const index = (y * overlay.width + x) * 4;
        const selected = Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]) > 12;
        if (selected) { covered++; sumX += x; sumY += y; if (first < 0) first = x; last = x; }
      }
      if (first >= 0) rows.push((first + last) / 2);
    }
    return { covered, centerRange: rows.length ? Math.max(...rows) - Math.min(...rows) : 0, rows: rows.length, centerX: covered ? sumX / covered / overlay.width : 0, centerY: covered ? sumY / covered / overlay.height : 0 };
  });

  const baseMask = await maskStats();
  await page.click('#rotateRight');
  await waitForPreview(page);
  const rotatedMask = await maskStats();
  await page.click('#rotateLeft');
  await waitForPreview(page);
  const hardBrushPixels = await page.evaluate(() => {
    const withoutStroke = E.clone(current.edits);
    const withoutMask = withoutStroke.masks.layers.find(layer => layer.id === withoutStroke.masks.activeId);
    withoutMask.strokes = [];
    const withStroke = E.clone(withoutStroke);
    const withMask = withStroke.masks.layers.find(layer => layer.id === withStroke.masks.activeId);
    withMask.strokes = [{ x: withMask.x, y: withMask.y, size: 20, feather: 0, flow: 100, mode: 'subtract' }];
    const a = E.render(sourceImage, withoutStroke, { maxEdge: 220, visualizeMask: true }).getContext('2d').getImageData(0, 0, 220, 138).data;
    const b = E.render(sourceImage, withStroke, { maxEdge: 220, visualizeMask: true }).getContext('2d').getImageData(0, 0, 220, 138).data;
    let changed = 0;
    for (let index = 0; index < Math.min(a.length, b.length); index += 4) if (Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]) > 8) changed++;
    return changed;
  });
  const historyBefore = await page.evaluate(() => historyStacks()[0].length);
  await page.click('#maskAddBtn');
  canvasBox = await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width * .82, canvasBox.y + canvasBox.height * .18);
  const brushCursor = await page.evaluate(() => ({ visible: !brushCursor.classList.contains('hidden'), width: brushCursor.getBoundingClientRect().width }));
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * .9, canvasBox.y + canvasBox.height * .25, { steps: 12 });
  await page.mouse.up();
  await waitForPreview(page);
  const addedMask = await maskStats();
  const historyAfterAdd = await page.evaluate(() => historyStacks()[0].length);

  await page.click('#maskSubtractBtn');
  canvasBox = await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width * .47, canvasBox.y + canvasBox.height * .74);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * .55, canvasBox.y + canvasBox.height * .82, { steps: 12 });
  await page.mouse.up();
  await waitForPreview(page);
  const subtractedMask = await maskStats();
  const maskState = await page.evaluate(() => ({
    modes: activeMask().strokes.map(stroke => stroke.mode),
    history: historyStacks()[0].length,
    // v3.0 removed the never-shown legacy #maskOverlay element entirely; its absence is the contract now.
    legacyOverlayRemoved: !document.querySelector('#maskOverlay')
  }));

  await page.click('#editPanelTab');
  await page.evaluate(() => {
    current.edits.masks.layers.forEach(layer => { layer.enabled = false; layer.show = false; });
    refreshControls();
    scheduleRender();
  });
  await waitForPreview(page);
  const slider = page.locator('[data-path="light.exposure"]');
  const sliderBox = await slider.boundingBox();
  const startingRevision = Number(await page.locator('#canvas').getAttribute('data-preview-revision') || 0);
  await page.evaluate(() => {
    window.__heartbeat = [];
    window.__heartbeatTimer = setInterval(() => window.__heartbeat.push(performance.now()), 10);
  });
  const dragStarted = Date.now();
  await page.mouse.move(sliderBox.x + sliderBox.width * .2, sliderBox.y + sliderBox.height / 2);
  await page.mouse.down();
  for (let step = 0; step <= 40; step++) {
    await page.mouse.move(sliderBox.x + sliderBox.width * (.2 + .6 * step / 40), sliderBox.y + sliderBox.height / 2);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await waitForPreview(page);
  const dragMs = Date.now() - dragStarted;
  const responsiveness = await page.evaluate(startRevision => {
    clearInterval(window.__heartbeatTimer);
    const gaps = window.__heartbeat.slice(1).map((value, index) => value - window.__heartbeat[index]);
    return {
      heartbeatTicks: window.__heartbeat.length,
      maxHeartbeatGap: gaps.length ? Math.max(...gaps) : Infinity,
      previewRevisionAdvanced: Number(canvas.dataset.previewRevision || 0) > startRevision,
      settledWidth: canvas.width,
      workerReady: previewWorkerReady,
      workerBusy: previewWorkerBusy,
      pending: !!previewWorkerPending,
      exposure: current.edits.light.exposure
    };
  }, startingRevision);
  const zoomBaseWidth = responsiveness.settledWidth;
  const zoomSourceWidth = await page.evaluate(() => sourceImage.naturalWidth);
  const zoomEdgePolicy = await page.evaluate(() => {
    const wrap = document.querySelector('#canvasWrap'), range = document.querySelector('#zoomRange'), originalBounds = wrap.getBoundingClientRect, originalZoom = range.value;
    wrap.getBoundingClientRect = () => ({ width: 420, height: 300 });
    range.value = '100'; const fit = previewEdge(false);
    range.value = '200'; const zoomed = previewEdge(false);
    range.value = originalZoom; wrap.getBoundingClientRect = originalBounds;
    return { fit, zoomed };
  });
  await page.locator('#zoomRange').evaluate(element => { element.value = '200'; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(({ base, source }) => !previewWorkerBusy && !previewWorkerPending && (canvas.width > base || base >= source), { base: zoomBaseWidth, source: zoomSourceWidth }, { timeout: 30000 });
  const zoomedWidth = await page.evaluate(() => canvas.width);
  await page.click('#fitBtn');
  await waitForPreview(page);

  const failures = [];
  if (!blackAndWhite.bw || blackAndWhite.curvePoints !== 5 || blackAndWhite.grade !== 8) failures.push('B&W preset did not apply its complete state');
  if (color.bw || color.curvePoints !== 2 || color.grade !== 0 || color.exposure !== .31 || color.rotate !== 6 || !color.exactReplacement) failures.push('Color preset retained state from the prior B&W preset');
  if (JSON.stringify(amountAtZero) !== JSON.stringify([[0, 20], [80, 90], [255, 240]]) || amountAtFifty[0]?.[1] !== 14 || amountAtFifty.at(-1)?.[1] !== 248 || JSON.stringify(amountAfterUndo) !== JSON.stringify([[0, 20], [80, 90], [255, 240]]) || JSON.stringify(amountAfterRedo) !== JSON.stringify(amountAtFifty)) failures.push('Preset Amount did not preserve the base curve or exact undo/redo state');
  if (migratedMixerHue !== -15) failures.push('Negative Color Mixer hue was lost during migration');
  if (convertedSource.width !== 48 || convertedSource.height !== 32 || JSON.stringify(convertedSource.samples) !== JSON.stringify([19,92,165,255,238,55,128,255,201,18,91,255,164,237,54,255])) failures.push('Converted source pixels were altered before editing');
  if (baseMask.covered < 50 || baseMask.rows < 3 || baseMask.centerRange < 2) failures.push('Object selection did not produce a useful irregular pixel mask');
  if (Math.abs(rotatedMask.centerX - (1 - baseMask.centerY)) > .08 || Math.abs(rotatedMask.centerY - baseMask.centerX) > .08) failures.push('Object mask did not remain attached after rotation');
  if (hardBrushPixels < 20) failures.push('A zero-feather mask brush did not paint a hard edge');
  if (addedMask.covered <= baseMask.covered) failures.push('Add brush did not increase mask coverage');
  if (subtractedMask.covered >= addedMask.covered) failures.push('Subtract brush did not reduce mask coverage');
  if (!maskState.modes.includes('add') || !maskState.modes.includes('subtract') || historyAfterAdd !== historyBefore + 1 || maskState.history !== historyAfterAdd + 1 || !maskState.legacyOverlayRemoved) failures.push('Mask refinement state or one-gesture undo history failed');
  if (!responsiveness.workerReady || responsiveness.workerBusy || responsiveness.pending || responsiveness.heartbeatTicks < 10 || responsiveness.maxHeartbeatGap > 200 || !responsiveness.previewRevisionAdvanced || responsiveness.settledWidth < 1050 || dragMs > 4000) failures.push('Slider preview was blocking, stale, or failed to restore high quality');
  if (!brushCursor.visible || brushCursor.width < 8) failures.push('Mask brush radius cursor was not visible');
  if (zoomEdgePolicy.fit !== 1050 || zoomEdgePolicy.zoomed !== 2100) failures.push('Preview resolution did not scale from its minimum fit resolution when zoomed');
  if (zoomedWidth <= zoomBaseWidth && zoomBaseWidth < zoomSourceWidth) failures.push('Zoom did not request a higher-resolution settled preview');
  if (errors.length) failures.push('Renderer emitted unexpected errors');
  const report = { preset: { blackAndWhite, color, amountAtZero, amountAtFifty, amountAfterUndo, amountAfterRedo, migratedMixerHue }, convertedSource, mask: { baseMask, rotatedMask, hardBrushPixels, brushCursor, addedMask, subtractedMask, historyBefore, historyAfterAdd, maskState }, responsiveness: { ...responsiveness, dragMs, zoomBaseWidth, zoomSourceWidth, zoomedWidth, zoomEdgePolicy }, errors, failures };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await app.close();
  await fixtures.cleanup();
  if (failures.length) throw new Error(failures.join('; '));
})().catch(async error => {
  console.error(error.stack || error);
  try { await app?.close(); } catch {}
  try { await fixtures?.cleanup(); } catch {}
  process.exitCode = 1;
});
